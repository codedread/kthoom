/**
 * page.js
 *
 * Licensed under the MIT License
 *
 * Copyright(c) 2018 Google Inc.
 */

import { convertWebPtoJPG } from './bitjs/image/webp-shim/webp-shim.js';
import { findMimeType } from './bitjs/file/sniffer.js';
import { PageContainer } from './pages/page-container.js';

// This is from Googling, I've seen different numbers.
const DEFAULT_ASPECT_RATIO = 6.625 / 10.25;

/**
 * @param {Uint8Array} typedArray
 * @param {string} mimeType
 * @returns {string} A URL representing the ArrayBuffer.
 */
function createURLFromArray(typedArray, mimeType) {
  if (mimeType === 'image/xml+svg') {
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(new TextDecoder('utf-8').decode(ab));
  }
  let blob = new Blob([typedArray], { type: mimeType });
  return URL.createObjectURL(blob);
};

/**
 * Base class for Pages.
 */
export class Page {
  /**
   * @param {string} pageName
   * @param {string} mimeType
   * @param {Uint8Array} fileData The raw bytes for this page.
   * @param {number} lastModFileTime
   */
  constructor(pageName, mimeType, fileData, lastModFileTime) {
    /**
     * @private
     * @type {string}
     */
    this.pageName_ = pageName;

    /**
     * @private
     * @type {string}
     */
    this.mimeType_ = mimeType;

    /**
     * @protected
     * @type {Uint8Array}
     */
    this.bytes = fileData;

    /**
     * @private
     * @type {number}
     */
    this.pageLastModTime_ = lastModFileTime || Date.now();
  }

  /** @returns {number} */
  getAspectRatio() { return DEFAULT_ASPECT_RATIO; }
  /** @returns {string} */
  getMimeType() { return this.mimeType_; }
  /** @returns {string} */
  getPageName() { return this.pageName_; }
  /** @returns {Uint8Array} */
  getBytes() { return this.bytes; }
  /** @returns {number} */
  getLastModTime() { return this.pageLastModTime_; }

  /**
   * Renders this page into the page container.
   * @param {PageContainer} pageContainer
   * @param {number} pageNum
   */
  renderIntoContainer(pageContainer, pageNum) {
    throw 'Cannot render an abstract Page object into a Pagecontainer, use a subclass.';
  }

  /**
   * Renders this page into the page viewer.
   * @param {SVGImageElement} imageEl
   * @param {SVGForeignObjectElement} objEl
   */
  renderIntoViewer(imageEl, objEl) {
    throw 'Cannot render an abstract Page object, use a subclass.';
  }
}

/**
 * A page that holds a single image. ImagePages are different than other types of pages because
 * the aspect ratio is fully driven by the contents (the image) and can change with each page
 * in a book.
 */
export class ImagePage extends Page {
  /**
   * @param {string} name
   * @param {string} mimeType
   * @param {number} aspectRatio
   * @param {Uint8Array} bytes
   * @param {number=} lastModTime
   */
  constructor(name, mimeType, aspectRatio, bytes, lastModTime) {
    super(name, mimeType, bytes, lastModTime);

    /** @private {number} */
    this.aspectRatio_ = aspectRatio;
  }

  getAspectRatio() { return this.aspectRatio_; }

  /** @returns {string} */
  getURI() {
    return createURLFromArray(this.bytes, this.getMimeType());
  }

  /**
   * Renders this page into the page container.
   * @param {PageContainer} pageContainer
   * @param {number} pageNum
   */
  renderIntoContainer(pageContainer, pageNum) {
    pageContainer.renderRasterImage(this.getURI(), pageNum);
  }

  /**
   * Renders this page into the page viewer.
   * TODO: Remove this.
   * @param {SVGImageElement} imgEl
   * @param {SVGForeignObjectElement} objEl
   */
  renderIntoViewer(imageEl, objEl) {
    imageEl.style.display = '';
    objEl.style.display = 'none';
    imageEl.setAttribute('href', this.getURI());
  }
}

/**
 * A page that needs to use the webp-shim to convert, done on first render.
 */
export class WebPShimImagePage extends Page {
  /**
   * @param {string} name
   * @param {Uint8Array} webpBuffer
   * @param {number=} lastModTime
   */
  constructor(name, webpBuffer, lastModTime) {
    super(name, 'image/webp', webpBuffer, lastModTime);

    /**
     * @private
     * @type {number}
     */
    this.aspectRatio_ = DEFAULT_ASPECT_RATIO;

    /**
     * @private
     * @type {string}
     */
    this.dataURI_ = null;

    /**
     * @private
     * @type {Promise}
     */
    this.inflatingPromise_ = null;
  }

  getAspectRatio() { return this.aspectRatio_; }

  /** @returns {Promise} A Promise that resolves when conversion is complete. */
  inflate() {
    if (this.dataURI_) {
      return Promise.resolve();
    } else if (this.inflatingPromise_) {
      return this.inflatingPromise_;
    }
    return this.inflatingPromise_ = convertWebPtoJPG(this.bytes).then(jpgBuffer => {
      this.mimeType_ = 'image/jpeg';
      return createURLFromArray(jpgBuffer, 'image/jpeg');
    });
  }

  isInflated() { return !!this.dataURI_; }

  /**
   * Renders this page into the page container.
   * @param {PageContainer} pageContainer
   * @param {number} pageNum
   */
  renderIntoContainer(pageContainer, pageNum) {
    if (!this.isInflated()) {
      this.inflate().then(dataURI => {
        this.dataURI_ = dataURI;
        this.inflatingPromise_ = null;
        this.renderIntoContainer(pageContainer, pageNum);
      });
      return;
    }

    pageContainer.renderRasterImage(this.dataURI_, pageNum);
  }

  /**
   * Renders this page into the page viewer.
   * TODO: Remove this.
   * @param {SVGImageElement} imgEl
   * @param {SVGForeignObjectElement} objEl
   */
  renderIntoViewer(imageEl, objEl) {
    if (!this.isInflated()) {
      this.inflate().then(dataURI => {
        this.dataURI_ = dataURI;
        this.inflatingPromise_ = null;
        this.renderIntoViewer(imageEl, objEl);
      });
      return;
    }

    imageEl.style.display = '';
    objEl.style.display = 'none';
    imageEl.setAttribute('href', this.dataURI_);
    // TODO: Set aspect ratio properly from here?
  }
}

/**
 * A page that holds raw text.
 */
export class TextPage extends Page {
  /**
   * @param {string} name
   * @param {string} text The raw text in the page.
   * @param {number=} lastModTime
   */
  constructor(name, text, lastModTime) {
    super(name, 'text/plain', new TextEncoder().encode(text), lastModTime);

    /** @private {string} */
    this.rawText_ = text;
  }

  /**
   * Renders this page into the page container.
   * @param {PageContainer} pageContainer
   * @param {number} pageNum
   */
  renderIntoContainer(pageContainer, pageNum) {
    const textDiv = document.createElement('div');
    textDiv.innerHTML = `<pre>${this.rawText_}</pre>`;
    pageContainer.renderHtml(textDiv, pageNum);
  }

  /**
   * Renders this page into the page viewer.
   * TODO: Remove this.
   * @param {SVGImageElement} imageEl
   * @param {SVGForeignObjectElement} objEl
   */
  renderIntoViewer(imageEl, objEl) {
    imageEl.style.display = 'none';
    while (objEl.firstChild) {
      objEl.firstChild.remove();
    }
    const textDiv = document.createElement('div');
    textDiv.innerHTML = `<pre>${this.rawText_}</pre>`;
    objEl.appendChild(textDiv);
    objEl.style.display = '';
  }
}

/**
 * A page that holds an iframe with sanitized XHTML. Every time this page is added into a
 * Book Viewer page <g> element, it inflates itself.
 */
export class XhtmlPage extends Page {
  /**
   * @param {string} name
   * @param {HTMLIframeElement} iframeEl
   * @param {Function(HTMLIframeElement)} inflaterFn Function to be called after the iframe is
   *     appended to the foreignObject element.
   * @param {number=} lastModTime
   */
  constructor(name, iframeEl, inflaterFn, lastModTime) {
    super(name, 'application/xhtml+xml', new TextEncoder().encode(iframeEl.innerHTML), lastModTime);

    /** @private {HTMLIframeElement} */
    this.iframeEl_ = iframeEl;

    /** @private {Function} */
    this.inflaterFn_ = inflaterFn;
  }

  /**
   * Renders this page into the page container.
   * @param {PageContainer} pageContainer
   */
  renderIntoContainer(pageContainer) {
    pageContainer.renderHtml(this.iframeEl_);
    this.inflaterFn_(this.iframeEl_);
  }

  /**
   * Renders this page into the page viewer.
   * TODO: Remove this.
   * @param {SVGImageElement} imageEl
   * @param {SVGForeignObjectElement} objEl
   */
  renderIntoViewer(imageEl, objEl) {
    imageEl.style.display = 'none';
    while (objEl.firstChild) {
      objEl.firstChild.remove();
    }
    objEl.appendChild(this.iframeEl_);
    this.inflaterFn_(this.iframeEl_);
    objEl.style.display = '';
  }
}

/**
 * TODO: Add something to bitjs.image to sniff the bytes of an image file and get its MIME type?
 * @param {string} filename
 * @returns {string|undefined} The MIME type or undefined if we could not guess it.
 */
export function guessMimeType(filename) {
  const fileExtension = filename.split('.').pop().toLowerCase();
  switch (fileExtension) {
    case 'png': return 'image/png';
    case 'gif': return 'image/gif';
    case 'svg': return 'image/xml+svg';
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'webp': return 'image/webp';
    case 'bmp': return 'image/bmp';
    case 'htm': case 'html': return 'text/html';
    case 'sfv': return 'text/x-sfv';
    case 'txt': return 'text/plain';
  }

  // Skip over PAR files (.PAR, .PAR2, .P01, etc).
  if (fileExtension === 'par' || fileExtension === 'par2' || /^p\d\d$/.test(fileExtension)) {
    return 'application/octet-stream';
  }

  return undefined;
};

function isSafari() {
  var ua = navigator.userAgent.toLowerCase();
  return ua.indexOf('safari') !== -1 && ua.indexOf('chrome') === -1;
}

/**
 * @param {number} dosDate The DOS date (16-bit number).
 * @param {number} dosTime The DOS time (16-bit number).
 * @returns {number} The number of ms since the Unix epoch (1970-01-01 at midnight).
 */
function dosDateTimeToJSDate(dosDate, dosTime) {
  // DOS month is a 16-bit number.
  // Lowest 5 bits are the date of the month, 1-based (1-31).
  const dayOfMonth = dosDate & 0x1f;
  // Next 4 bits are the month of the year, 1-based (1-12).
  const monthOfYear = ((dosDate >> 5) & 0xf) - 1;
  // Next 7 bits are the number of years since 1980 (1980-2108).
  const year = ((dosDate >> 9) & 0x7f) + 1980;

  // DOS time is a 16-bit number.
  // Lowest 5 bits are the number of seconds in the minute divided by 2 (!), 0-29.
  const numSeconds = (dosTime & 0x1f) * 2;
  // Next 6 bits are the number of minutes in the hour (0-59).
  const numMinutes = ((dosTime >> 5) & 0x3f);
  // Next 5 bits are the number of hours in the day (0-23).
  const numHours = ((dosTime >> 11) & 0x1f);

  const jsDate = new Date(year, monthOfYear, dayOfMonth, numHours, numMinutes, numSeconds);
  return jsDate.valueOf();
}

/**
 * Factory method that creates a Page from a File.
 * @param {UnarchivedFile} unarchivedFile
 * @returns {Promise<Page>} A Promise that resolves to a Page (like an ImagePage).
 */
export const createPageFromFileAsync = function (unarchivedFile) {
  return new Promise((resolve, reject) => {
    const filename = unarchivedFile.filename;
    const sniffedMimeType = findMimeType(unarchivedFile.fileData);
    const mimeType = guessMimeType(filename);
    if (!mimeType) {
      resolve(new TextPage(filename, `Could not determine type of file "${filename}"`));
      return;
    }
    if (sniffedMimeType !== mimeType) {
      console.error(`mime type mismatch: ${sniffedMimeType} vs ${mimeType}`);
    }

    /** @type {Uint8Array} */
    const typedArray = unarchivedFile.fileData;

    // Extract the last modification time... bitjs needs to handle this consistently (add
    // lastModTimestamp to the UnarchivedFile interface). But for now, we cheat and peak into the
    // unarchivedFile. This will only work for files extracted via unzip.js.
    let lastModTime;
    if (unarchivedFile.lastModFileDate && unarchivedFile.lastModFileTime) {
      const lastModFileTime = unarchivedFile.lastModFileTime;
      const lastModFileDate = unarchivedFile.lastModFileDate;
      lastModTime = dosDateTimeToJSDate(lastModFileDate, lastModFileTime);
    }

    if (mimeType === 'image/webp' && isSafari()) {
      resolve(new WebPShimImagePage(filename, typedArray, lastModTime));
      return;
    }

    const dataURI = createURLFromArray(typedArray, mimeType);

    if (mimeType.indexOf('image/') === 0) {
      const img = new Image();
      img.onload = () => {
        resolve(new ImagePage(filename, mimeType, img.naturalWidth / img.naturalHeight, typedArray, lastModTime));
      };
      img.onerror = (e) => { resolve(new TextPage(filename, `Could not open file ${filename}`, lastModTime)); };
      img.src = dataURI;
    } else if (mimeType.startsWith('text/')) {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', dataURI, true);
      xhr.onload = () => {
        if (xhr.responseText.length < 1000 * 1024) {
          resolve(new TextPage(filename, xhr.responseText, lastModTime));
        } else {
          reject('Could not create a new text page from file ' + filename);
        }
      };
      xhr.onerror = (e) => { reject(e); };
      xhr.send(null);
    } else if (mimeType === 'application/octet-stream') {
      resolve(new TextPage(filename, `Could not display binary file ${filename}`, lastModTime));
    }
  });
}
