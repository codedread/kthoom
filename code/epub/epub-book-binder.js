/**
 * epub-book-binder.js
 *
 * Licensed under the MIT License
 *
 * Copyright(c) 2019 Google Inc.
 */

/**
 * Notes:
 *
 * - Have a page-setting phase where we go through all DOM nodes, rendering to a non-displayed
 *   iframe to size things right.  Each page can remember the DOM it needs to show.
 * - Once that phase is done, we can eject the archive files from memory and just keep around the
 *   page objects.
 * - TODO: Find an example of an EPUB book that uses a custom font.
 *   - Parse CSS and see if any rules reference a url() and do Blob URLs at render time.
 */

import { UnarchiveEventType } from '../bitjs/archive/decompress.js';
import { BookBinder, BookType } from '../book-binder.js';
import { BookBindingCompleteEvent, BookLoadingCompleteEvent, BookPageExtractedEvent, BookProgressEvent } from '../book-events.js';
import { NodeType, walkDom } from '../common/dom-walker.js';
import { HTML_NAMESPACE, XMLNS_NAMESPACE, REVERSE_NS,
         isAllowedElement, isAllowedAttr, isAllowedBlobAttr } from './epub-allowlists.js';
import { FileRef } from '../file-ref.js';
import { XhtmlPage } from '../page.js';
import { Params, assert } from '../common/helpers.js';

const ATTR_KTHOOM_URL = 'data-kthoom-url';
const CONTAINER_FILE = 'META-INF/container.xml';
const CONTAINER_NAMESPACE = 'urn:oasis:names:tc:opendocument:xmlns:container';
const EPUB_MIMETYPE = 'application/epub+zip';
const OPF_NAMESPACE = 'http://www.idpf.org/2007/opf';
const XHTML_MIMETYPE = 'application/xhtml+xml';

const textDecoder = new TextDecoder();

/**
 * @param {ArrayBuffer} bytes
 */
function toText(bytes) {
  return textDecoder.decode(bytes);
}

/**
 * The BookBinder for EPUB files.  Do not use, since this is a WIP.
 */
export class EPUBBookBinder extends BookBinder {
  constructor(filenameOrUri, ab, totalExpectedSize) {
    super(filenameOrUri, ab, totalExpectedSize);

    /**
     * A map of all files in the archive, keyed by its full path in the archive with the value
     * being the raw ArrayBuffer.
     * @private {Map<string, Uint8Array>}
     */
    this.fileMap_ = new Map();

    /** @private {string} */
    this.opfFilename_ = undefined;

    /**
     * Maps the id of each manifest item to its file reference.
     * @private {Map<string, FileRef>}
     */
    this.manifestFileMap_ = new Map();

    /**
     * The ordered list of reading items.
     * @private {Array<FileRef>}
     */
    this.spineRefs_ = [];
  }

  /** @override */
  beforeStart_() {
    let firstFile = true;
    this.unarchiver.addEventListener(UnarchiveEventType.EXTRACT, evt => {
      /** @type {import('../bitjs/archive/decompress.js').UnarchivedFile} */
      const theFile = evt.unarchivedFile;
      this.fileMap_.set(theFile.filename, theFile.fileData);
      if (Params['debugFetch'] === 'true') {
        console.log(`debugFetch: Extracted file ${theFile.filename} of size ${theFile.fileData.byteLength}`);
      }

      // The first file must be 'mimetype'.
      if (firstFile) {
        firstFile = false;
        this.validateMimetype_(theFile);
      }
    });
    this.unarchiver.addEventListener(UnarchiveEventType.FINISH, evt => {
      this.setUnarchiveComplete();
      this.dispatchEvent(new BookProgressEvent(this));
      this.parseContainer_();
      this.parseOPF_();

      // All files have been archived and spine elements have been cross-referenced.
      this.inflateSpine_();  
    });
  }

  getBookType() { return BookType.EPUB; }

  getMIMEType() { return EPUB_MIMETYPE; }

  // TODO: Proper error handling throughout.

  /**
   * @param {string} href
   * @param {string} rootDir
   * @returns {FileRef}
   * @private
   */
  getManifestFileRef_(href, rootDir) {
    // TODO: Do full path resolution here.
    // TODO: Strip off the anchor part of the URL here.
    const fullPath = rootDir + href;
    for (const ref of this.manifestFileMap_.values()) {
      if (ref.href === fullPath) {
        return ref;
      }
    }
    return null;
  }

  inflateSpine_() {
    let xhtmlChunks = [];
    const numSpineRefs = this.spineRefs_.length;
    for (let i = 0; i < numSpineRefs; ++i) {
      const spref = this.spineRefs_[i];
      const { mediaType, data } = spref;
      if (mediaType === XHTML_MIMETYPE) {
        const htmlDoc = new DOMParser().parseFromString(toText(data), XHTML_MIMETYPE);
        xhtmlChunks.push(htmlDoc);
      }
    }

    const allPages = [];

    // Process all serialized nodes of XHTML and make sanitized copies in the new DOM context.
    this.layoutPercentage = 0;
    for (let i = 0; i < xhtmlChunks.length; ++i) {
      const xhtmlChunk = xhtmlChunks[i];

      // Create an iframe element and add it to our document so that the contentWindow is available.
      // We need the contentWindow to ensure the elements and Blob URLs are created in the right
      // HTML context.
      const iframeEl = document.createElement('iframe');
      iframeEl.style.display = 'none';
      document.body.appendChild(iframeEl);
      const contentWindow = iframeEl.contentWindow;
      const htmlDoc = iframeEl.contentDocument;
      const pageEl = htmlDoc.documentElement;

      let outEl = pageEl;

      /**
       * A map of a parallel, sanitized DOM tree. The keys are the source elements and the values
       * are the copied and sanitized node.
       * @type {Map<Element, Element>}
       */
      const nodeCopyMap = new Map();

      /** @type {Element} */
      let docEl = xhtmlChunk.documentElement;
      nodeCopyMap.set(docEl, pageEl);

      /**
       * Walk the DOM of the XHTML doc and create sanitized copies of allowlisted elements and
       * attributes for use inside an iframe. For any attribute that references a file inside the
       * EPUB file (like a CSS or image file) should be remembered and a Blob URL should be
       * substituted.
       */
      walkDom(docEl, (/** @type {Element} */ curNode) => {
        // Ensure that we are in the current place in the copy tree to insert the new element.
        if (nodeCopyMap.has(curNode.parentElement)) {
          outEl = nodeCopyMap.get(curNode.parentElement);
        }

        let localName = curNode.localName;
        // Special handling for text nodes.
        if (curNode.nodeType === NodeType.TEXT) {
          outEl.appendChild(curNode.cloneNode());
        }
        // If it is an allowed XHTML or SVG element, make a sanitized copy, but skip the top of the
        // DOM tree.
        else if (curNode.nodeType === NodeType.ELEMENT && docEl !== curNode
            && isAllowedElement(curNode)) {
          const elNS = curNode.namespaceURI;
          let newEl;
          // Special handling for the iframe's head and body elements which are created for us.
          if (elNS === HTML_NAMESPACE && localName === 'head') {
            newEl = htmlDoc.head;
          } else if (elNS === HTML_NAMESPACE && localName === 'body') {
            newEl = htmlDoc.body;
          } else {
            // Make a safe copy of the current node, allowed node.
            newEl = contentWindow.document.createElementNS(elNS, localName);
          }

          // Update map of serialized XHTML/SVG nodes to iframe'd sanitized nodes.
          nodeCopyMap.set(curNode, newEl);

          // Copy over all allowlisted attributes.
          const attrs = curNode.attributes;
          for (let i = 0; i < attrs.length; ++i) {
            const attr = attrs.item(i);
            // Handle xmlns and xmlns:* attributes, 
            if (attr.namespaceURI === XMLNS_NAMESPACE) {
              const nsUrl = attr.value;
              const nsPrefix = REVERSE_NS[nsUrl];
              if (nsPrefix) {
                let attrName = attr.localName === 'xmlns' ? 'xmlns' : `xmlns:${nsPrefix}`;
                newEl.setAttributeNS(XMLNS_NAMESPACE, attrName, nsUrl);
              }
            }
            // Handle all other allowed attributes.
            else if (isAllowedAttr(curNode, attr)) {
              const attrNS = attr.namespaceURI;
              if (!attrNS || attrNS === elNS) {
                newEl.setAttribute(attr.localName, attr.value);
              } else {
                const prefixedAttrName = `${REVERSE_NS[attrNS]}:${attr.localName}`;
                newEl.setAttributeNS(attrNS, prefixedAttrName, attr.value);
              }
            }

            if (isAllowedBlobAttr(curNode, attr)) {
              const ref = this.getManifestFileRef_(attr.value, this.spineRefs_[0].rootDir);
              if (!ref) {
                throw `Could not find a referenced file: ${attr.value}`;
              }

              // Remember the url in the default namespace.
              newEl.setAttribute(ATTR_KTHOOM_URL, attr.value);

              const attrNS = attr.namespaceURI;
              if (!attrNS || attrNS === elNS) {
                newEl.setAttribute(attr.localName, ref.getBlobURL(contentWindow));
              } else {
                newEl.setAttributeNS(attrNS, attr.localName, ref.getBlobURL(contentWindow));
              }
            }
          }

          outEl.appendChild(newEl);
        }
      }); // Finished walking XHTML DOM.

      // TODO: The book viewer is still stuck at the unzipping stage...
      this.layoutPercentage = (i + 1) / xhtmlChunks.length;
      this.dispatchEvent(new BookProgressEvent(this, allPages.length));

      /**
       * Now create a XhtmlPage of the XHTML document inside the iframe, including an "inflater"
       * function that will walk the DOM of the page, and update any Blob URLs that are no longer
       * valid in the new HTML context (window inside the iframe).
       */
      const curHead = htmlDoc.head;
      const curBody = htmlDoc.body;
      const nextPage = new XhtmlPage('htmlpage', iframeEl, () => {
        const cdoc = iframeEl.contentDocument;
        const cwin = iframeEl.contentWindow;
        cdoc.head.innerHTML = new XMLSerializer().serializeToString(curHead);
        cdoc.body.innerHTML = new XMLSerializer().serializeToString(curBody);

        walkDom(cdoc.documentElement, curNode => {
          if (curNode.nodeType === NodeType.ELEMENT && curNode.hasAttributes()) {
            const elNS = curNode.namespaceURI;
            const attrs = curNode.attributes;
            for (let i = 0; i < attrs.length; ++i) {
              const attr = attrs.item(i);
              if (isAllowedBlobAttr(curNode, attr)) {
                const attrValue = curNode.getAttribute(ATTR_KTHOOM_URL);
                const ref = this.getManifestFileRef_(attrValue, this.spineRefs_[0].rootDir);
                if (!ref) {
                  throw `Could not find a referenced file: ${attr.value}`;
                }

                let newBlobUrl = ref.getBlobURL(cwin);
                const attrNS = attr.namespaceURI;
                if (!attrNS || attrNS === elNS) {
                  curNode.setAttribute(attr.localName, newBlobUrl);
                } else {
                  curNode.setAttributeNS(attrNS, attr.localName, newBlobUrl);
                }
              }
            }
          }
        });

        // TODO: Decide where this style should go.
        iframeEl.setAttribute('style', 'width:100%;height:100%;border:0;background-color:#999');
      });

      allPages.push(nextPage);
      this.dispatchEvent(new BookPageExtractedEvent(this, nextPage, allPages.length));        
    } // for each XHTML chunk.

    this.dispatchEvent(new BookBindingCompleteEvent(this));
  }

  /** @private */
  parseContainer_() {
    // META-INF/container.xml must exist.
    assert(this.fileMap_.has(CONTAINER_FILE),
      `The file ${CONTAINER_FILE} did not exist inside the epub archive`);

    const containerXml = toText(this.fileMap_.get(CONTAINER_FILE));
    const parser = new DOMParser();
    const doc = parser.parseFromString(containerXml, 'text/xml');
    assert(!!doc, `Container file did not parse as XML`);
    assert(doc.documentElement.namespaceURI === CONTAINER_NAMESPACE,
      `The root element in the container was not in the correct namespace:
           ${doc.documentElement.namespaceURI}`,
      doc.documentElement);
    assert(doc.documentElement.localName === 'container',
      `The root element was not a 'container' element.`,
      doc.documentElement);

    const rootFile = doc.querySelector(
      'container > rootfiles > rootfile[media-type="application/oebps-package+xml"]');
    assert(!!rootFile,
      `Did not find a rootfile with the proper media-type="application/oebps-package+xml"`,
      doc.documentElement);

    this.opfFilename_ = rootFile.getAttribute('full-path');
    assert(!!this.opfFilename_,
      `rootfile did not have a 'full-path' attribute`,
      doc.documentElement);
  }

  /** @private */
  parseOPF_() {
    assert(this.fileMap_.has(this.opfFilename_),
      `EPUB archive file did not have a file named '${this.opfFilename_}`);

    const lastSlash = this.opfFilename_.lastIndexOf('/');
    const rootDir = lastSlash === -1 ? '' : this.opfFilename_.substr(0, lastSlash + 1);

    const opfFile = toText(this.fileMap_.get(this.opfFilename_));

    const doc = new DOMParser().parseFromString(opfFile, 'text/xml');
    assert(!!doc, 'OPF file did not parse as XML');
    assert(doc.documentElement.namespaceURI === OPF_NAMESPACE,
      `OPF document was not in the correct namespace: ${doc.documentElement.namespaceURI}`);
    assert(doc.documentElement.localName === 'package',
      `The root element was not a 'package' element.`,
      doc.documentElement);
    assert(doc.documentElement.hasAttribute('unique-identifier'),
      `package element did not have a unique-identifier.`,
      doc.documentElement);

    const manifestItems = doc.querySelectorAll('package > manifest > item');
    const numManifestItems = manifestItems.length;
    assert(numManifestItems > 0, `OPF manifest did not have any item elements`);
    for (let i = 0; i < numManifestItems; ++i) {
      const item = manifestItems.item(i);
      const id = item.getAttribute('id');
      const mediaType = item.getAttribute('media-type');
      const href = item.getAttribute('href');
      assert(id && mediaType && href, `Manifest item was missing a required attribute`, item);

      const filename = (rootDir + href);
      assert(this.fileMap_.has(filename), `EPUB archive was missing file: ${filename}`);

      const fileRef = new FileRef(id, filename, rootDir, mediaType, this.fileMap_.get(filename));
      this.manifestFileMap_.set(id, fileRef);
    }

    const spineItemRefs = doc.querySelectorAll('package > spine > itemref');
    assert(spineItemRefs.length > 0, 'OPF spine did not have any itemref elements');
    for (let i = 0; i < spineItemRefs.length; ++i) {
      const itemRef = spineItemRefs.item(i);
      const idref = itemRef.getAttribute('idref');
      assert(!!idref, `Spine itemref did not have an idref`, itemRef);

      // Skip spine itemref elements that are not part of the linear reading order (for now).
      if (itemRef.getAttribute('linear') === 'no') {
        continue;
      }

      assert(this.manifestFileMap_.has(idref), `Manifest file map missing a spine item: ${idref}`);
      this.spineRefs_.push(this.manifestFileMap_.get(idref));
    }
  }

  /** @private */
  validateMimetype_(theFile) {
    assert(theFile.filename === 'mimetype', `The first file was not named 'mimetype'`);
    const fileText = toText(theFile.fileData);
    assert(fileText === EPUB_MIMETYPE, `The 'mimetype' file had invalid contents: ${fileText}`);
  }
}
