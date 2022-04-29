import { getElem } from '../common/helpers.js';

/** @typedef {import('../book-viewer-types.js').Box} Box */

/** A class that manages the DOM elements of a page in the viewer. */
export class PageContainer {
  /** @type {SVGGElement} */
  #g = null;

  /** @type {SVGImageElement} */
  #image = null;

  /** @type {SVGForeignObjectElement} */
  #foreignObject = null;

  /**
   * Clones and inflates the page container.
   */
  constructor() {
    this.#g = getElem('pageTemplate').cloneNode(true);
    this.#g.removeAttribute('id');
    this.#g.style.display = 'none';
    this.#image = this.#g.querySelector('image');
    this.#foreignObject = this.#g.querySelector('foreignObject');
  }

  clear() {
    for (const el of [this.#image, this.#foreignObject]) {
      el.removeAttribute('x');
      el.removeAttribute('y');
      el.removeAttribute('height');
      el.removeAttribute('width');
    }
    this.#image.setAttribute('href', '');
    while (this.#foreignObject.firstChild) {
      this.#foreignObject.lastChild.remove();
    }
  }

  /** @returns {Box} */
  getBox() {
    const left = parseInt(this.#image.getAttribute('x'));
    const top = parseInt(this.#image.getAttribute('y'));
    const width = parseInt(this.#image.getAttribute('width'));
    const height = parseInt(this.#image.getAttribute('height'));
    return { left, top, width, height };
  }

  /** @returns {SVGGElement} */
  getElement() {
    return this.#g;
  }

  /** @returns {number} */
  getHeight() {
    return parseInt(this.#image.getAttribute('height'));
  }

  /** @returns {boolean} */
  isShown() {
    return this.#g.style.display !== 'none';
  }

  /**
   * Renders a chunk of HTML into the page container.
   * @param {HTMLElement} el The HTML element containing the contents of the page.
   * @param {number} pageNum The page number.
   */
  renderHtml(el, pageNum) {
    this.#g.dataset.pagenum = pageNum;
    this.#image.style.display = 'none';
    while (this.#foreignObject.firstChild) {
      this.#foreignObject.firstChild.remove();
    }
    this.#foreignObject.appendChild(textDiv);
    this.#foreignObject.style.display = '';
  }

  /**
   * Renders a raster image into the page container.
   * @param {string} url The URL of the raster image. 
   * @param {number} pageNum The page number.
   */
  renderRasterImage(url, pageNum) {
    this.#g.dataset.pagenum = pageNum;
    this.#image.style.display = '';
    this.#foreignObject.style.display = 'none';
    this.#image.setAttribute('href', url);
  }

  /** @param {Box} box */
  setFrame(box) {
    for (const el of [this.#image, this.#foreignObject]) {
      el.setAttribute('x', box.left);
      el.setAttribute('y', box.top);
      el.setAttribute('width', box.width);
      el.setAttribute('height', box.height);
    }
  }

  /** @param {boolean} isShown */
  show(isShown) {
    this.#g.style.display = isShown ? '' : 'none';
  }
}
