/** Defines the most basic page setter of having just a single page. */
import { FitMode } from '../book-viewer-types.js';
import { PageSetter } from './page-setter.js';
import { assert } from '../common/helpers.js';
import { OnePageSetter } from './one-page-setter.js';

/** @typedef {import('../book-viewer-types.js').Box} Box */
/** @typedef {import('../book-viewer-types.js').PageLayoutParams} PageLayoutParams */
/** @typedef {import('../book-viewer-types.js').PageSetting} PageSetting */

// TODO: Add unit tests.

export class WideStripPageSetter extends PageSetter {
  /** @type {num} */
  #numPages = 0;

  /** @type {OnePageSetter} */
  #onePageSetter = new OnePageSetter();

  constructor() {
    super();
  }

  /**
   * Get the scroll delta for the book viewer by a give # of pages.
   * @param {number} numPages The number of pages to scroll.
   * @param {Box} pageContainerBox The box of the page container.
   * @param {number} rotateTimes The # of clockwise 90-degree rotations.
   * @returns {Point} The number of pixels to scroll in x,y directions.
   */
  getScrollDelta(numPages, pageContainerBox, rotateTimes) {
    const pxDeltaScroll = numPages * pageContainerBox.width;
    switch (rotateTimes) {
      case 0: return { x: 0, y: 0 };
      case 1: return { x: 0, y: 0 };
      case 2: return { x: pxDeltaScroll, y: 0 };
      case 3: return { x: 0, y: pxDeltaScroll };
    }
    throw `Invalid rotateTimes ${rotateTimes}`;
  }

  /**
   * @param {number} docScrollLeft The x-scroll position of the document.
   * @param {number} docScrollTop The y-scroll position of the document.
   * @param {Box[]} pageBoxes The dimensions of all visible PageContainers.
   * @param {number} rotateTimes The # of clockwise 90-degree rotations.
   * @returns {number} How far the viewer is scrolled into the book.
   */
  getScrollPosition(docScrollLeft, docScrollTop, pageBoxes, rotateTimes) {
    if (pageBoxes.length === 0) {
      return 0;
    }

    const onePageWidth = pageBoxes[0].width;
    const fullWidth = pageBoxes.reduce((prev, cur) => prev + cur.width, 0);
    let scrollPosPx;
    switch (rotateTimes) {
      case 0: scrollPosPx = docScrollLeft; break;
      case 1: scrollPosPx = docScrollTop; break;
      case 2: scrollPosPx = fullWidth - docScrollLeft - onePageWidth; break;
      case 3: scrollPosPx = fullWidth - docScrollTop - onePageWidth; break;
    }

    return scrollPosPx / onePageWidth;
  }

  /** @param {number} np */
  // TODO: Remove this special method and pass aspectRatios in as layoutParams below.
  setNumPages(np) {
    this.#numPages = np;
  }

  /**
   * @param {PageLayoutParams} layoutParams
   * @param {Box} bv The BookViewer bounding box.
   * @returns {PageSetting} A set of Page bounding boxes.
   */
  updateLayout(layoutParams) {
    assert(this.#numPages > 0, `WideStripPageSetter.updateLayout() has #numPages=${this.#numPages}`);
    const portraitMode = (layoutParams.rotateTimes % 2 === 0);

    // Use the OnePageSetter to get the dimensions of the first page.
    // /** @type {PageSetting} */
    const pageSetting = this.#onePageSetter.updateLayout(layoutParams);
    // And then use that to size the remaining PageSetting boxes, being careful to update the
    // book viewer dimensions as appropriate to the rotation.
    for (let i = 1; i < this.#numPages; ++i) {
      const prevBox = pageSetting.boxes[i - 1];
      pageSetting.boxes.push({
        left: prevBox.left + prevBox.width,
        top: prevBox.top,
        width: prevBox.width,
        height: prevBox.height,
      });

      if (portraitMode) {
        pageSetting.bv.width += prevBox.width;
        if (layoutParams.rotateTimes === 2) { // 180 deg.
          pageSetting.bv.left -= prevBox.width;
        }
      } else {
        pageSetting.bv.height += prevBox.width;
        if (layoutParams.rotateTimes === 3) { // counter-clockwise.
          pageSetting.bv.top -= prevBox.width;
        }
      }
    }
    return pageSetting;
  }
}
