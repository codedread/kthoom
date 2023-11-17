/**
 * epub-allowlists.js
 *
 * Licensed under the MIT License
 *
 * Copyright(c) 2019 Google Inc.
 */

import { NodeType } from '../common/dom-walker.js';

export const EPUB_NAMESPACE = 'http://www.idpf.org/2007/ops';
export const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
export const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';
export const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';

/**
 * Map of XML namespace prefix to XML namespace URL.
 *
 * @type {Object<string, string>}
 */
export const NS = {
  'epub': EPUB_NAMESPACE,
  'html': HTML_NAMESPACE,
  'svg': SVG_NAMESPACE,
  'xlink': XLINK_NAMESPACE,
  'xmlns': XMLNS_NAMESPACE,
}

/**
 * Map of XML namespace URL to XML namespace prefix.
 *
 * @type {Object<string, string>}
 */
export const REVERSE_NS = Object.fromEntries(Object.entries(NS).map(([pre, url]) => [url, pre]));

/**
 * Common attributes used in any namespace.
 */
const COMMON_ATTRS = [
  'id',
];

const STYLED_ATTRS = [
  ...COMMON_ATTRS,
  'class',
  'style',
];

/**
 * A map of XML namespace URLs to allowed Element maps.
 * An Element map is a map of allowed Element names to allowed Attribute maps.
 * An Attribute map is a map of XML namespace URLs to an array of allowed attribute names.
 *
 * For example, FULL_ALLOWLIST[NS.svg]['image'][NS.xlink] contains all the attributes in the xlink
 * namespaces that are allowed on SVG <image> elements.
 *
 * @type {Object<string, Object<string, Object<string, Array<string>>>}
 */
const FULL_ALLOWLIST = {
  // HTML elements.
  [NS.html]: {
    'a': {
      [NS.html]: [
        ...STYLED_ATTRS,
        'title',
      ],
      [NS.epub]: [ 'type' ],
    },
    'body': {
      [NS.html]: [
        ...STYLED_ATTRS,
      ],
      [NS.epub]: [ 'type' ],
    },
    'br': {
      [NS.html]: [
        ...STYLED_ATTRS,
      ],
      [NS.epub]: [ 'type' ],
    },
    'div': {
      [NS.html]: [
        ...STYLED_ATTRS,
      ],
      [NS.epub]: [ 'type' ],
    },
    'head': {
      [NS.html]: [
        ...COMMON_ATTRS,
      ],
    },
    'h1': {
      [NS.html]: [
        ...STYLED_ATTRS,
      ],
      [NS.epub]: [ 'type' ],
    },
    'h2': {
      [NS.html]: [
        ...STYLED_ATTRS,
      ],
      [NS.epub]: [ 'type' ],
    },
    'h3': {
      [NS.html]: [
        ...STYLED_ATTRS,
      ],
      [NS.epub]: [ 'type' ],
    },
    'h4': {
      [NS.html]: [
        ...STYLED_ATTRS,
      ],
      [NS.epub]: [ 'type' ],
    },
    'h5': {
      [NS.html]: [
        ...STYLED_ATTRS,
      ],
      [NS.epub]: [ 'type' ],
    },
    'h6': {
      [NS.html]: [
        ...STYLED_ATTRS,
      ],
      [NS.epub]: [ 'type' ],
    },
    'hr': {
      [NS.html]: [
        ...STYLED_ATTRS,
      ],
      [NS.epub]: [ 'type' ],
    },
    'img': {
      [NS.html]: [
        ...STYLED_ATTRS,
        'alt',
        'src',
      ],
      [NS.epub]: [ 'type' ],
    },
    'link': {
      [NS.html]: [
        ...COMMON_ATTRS,
        'href',
        'rel',
        'type',
      ],
    },
    'p': {
      [NS.html]: [
        ...STYLED_ATTRS,
      ],
      [NS.epub]: [ 'type' ],
    },
    'span': {
      [NS.html]: [
        ...STYLED_ATTRS,
      ],
      [NS.epub]: [ 'type' ],
    },
    'style': {
      [NS.html]: [
        ...COMMON_ATTRS,
      ],
    },
    'title': {
      [NS.html]: [
        ...COMMON_ATTRS,
      ],
    },
  },

  // SVG elements.
  [NS.svg]: {
    // <image> element.
    'image': {
      [NS.svg]: [
        ...STYLED_ATTRS,
        'height',
        'width',
      ],
      [NS.xlink]: [ 'href' ],
      [NS.epub]: [ 'type' ],
    },
    // <svg> element.
    'svg': {
      [NS.svg]: [
        ...STYLED_ATTRS,
        'height',
        'preserveAspectRatio',
        'version',
        'viewBox',
        'width',
      ],
      [NS.epub]: [ 'type' ],
    }
  },
};

/**
 * A map of XML namespace URLs to Element Blob URL maps.
 * A Element Blob URL map is a map of Element name to Blob URL Attribute maps.
 * A Blob URL Attribute map is a map of XML namespace URL to an array of Blob URL attributes.
 * A Blob URL Attribute is one in which...
 * @type {Object<string, Object<string, Object<string, Array<string>>>}
 */
const BLOBURL_ATTRIBUTES = {
  [NS.html]: {
    'img': {
      [NS.html]: [ 'src' ],
    },
    'link': {
      [NS.html]: [ 'href' ],
    },
  },
  [NS.svg]: {
    'image': {
      [NS.xlink]: [ 'href' ],
    },
  },
};

/**
 * @param {Element} el 
 * @param {Attr} attr 
 * @returns {boolean} Whether this attribute is allowed on this element.
 */
export function isAllowedAttr(el, attr) {
  if (attr?.nodeType !== NodeType.ATTR) throw `attr was not an Attr in isAllowedAttr()`;
  if (!isAllowedElement(el)) {
    return false;
  }

  /** @type {string} */
  const elNS = el.namespaceURI;
  const attrNS = attr.namespaceURI || elNS;
  const attrList = FULL_ALLOWLIST[elNS][el.localName][attrNS];
  return !!(attrList && attrList.includes(attr.localName));
}

export function isAllowedBlobAttr(el, attr) {
  if (attr?.nodeType !== NodeType.ATTR) throw `attr was not an Attr in isAllowedBlobAttr()`;
  if (!isAllowedElement(el)) {
    return false;
  }

  /** @type {string} */
  const elNS = el.namespaceURI;
  const attrNS = attr.namespaceURI || elNS;
  const blobUrlAttrMap = BLOBURL_ATTRIBUTES[elNS];
  if (blobUrlAttrMap && blobUrlAttrMap[el.localName]) {
    const attrList = BLOBURL_ATTRIBUTES[elNS][el.localName][attrNS];
    return !!(attrList && attrList.includes(attr.localName));
  }
  return false;
}

/**
 * @param {Element} el 
 * @returns {boolean} Whether this element is allowed.
 */
export function isAllowedElement(el) {
  if (el?.nodeType !== NodeType.ELEMENT) throw `el was not an Element in isAllowedElement()`;
  const ns = el.namespaceURI;
  return !!(FULL_ALLOWLIST[ns] && FULL_ALLOWLIST[ns][el.localName]);
}