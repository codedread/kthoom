/**
 * A thing that sets up page containers in the UI.
 */

/** @typedef {import('../book-viewer-types.js').Box} Box */
/** @typedef {import('../book-viewer-types.js').Point} Point */
/** @typedef {import('../book-viewer-types.js').PageLayoutParams} PageLayoutParams */
/** @typedef {import('../book-viewer-types.js').PageSetting} PageSetting */

// TODO: topw and toph need to be returned from updateLayout() as well.

/**
 * The job of a PageSetter is to tell the BookViewer how many pages to render and their
 * dimensions. Override the updateLayout() method.
 * @abstract
 */
export class PageSetter {
  /**
   * Get the scroll delta for the book viewer by a give # of pages.
   * @param {number} numPages The number of pages to scroll.
   * @param {Box} pageContainerBox The box of the page container.
   * @param {number} rotateTimes The # of clockwise 90-degree rotations.
   * @returns {Point} The number of pixels to scroll in x,y directions.
   */
  getScrollDelta(numPages, pageContainerBox, rotateTimes) {
    // Only useful for the Long-Strip or Wide-Strip setters.
    return { x: 0, y: 0 };
  }

  /**
   * @param {number} docScrollLeft The x-scroll position of the document.
   * @param {number} docScrollTop The y-scroll position of the document.
   * @param {Box[]} pageBoxes The dimensions of all visible PageContainers.
   * @param {number} rotateTimes The # of clockwise 90-degree rotations.
   * @returns {number} How far the viewer is scrolled into the book.
   */
  getScrollPosition(docScrollLeft, docScrollTop, pageBoxes, rotateTimes) {
    return 0;
  }

  /**
   * The job of this function is to lay out the dimensions of all the page boxes that the
   * BookViewer needs to render. It returns an array of page container frames that the
   * BookViewer will fill as well as the adjusted bookViewer box.
   * @abstract
   * @param {PageLayoutParams} layoutParams
   * @param {Box} bv The BookViewer bounding box.
   * @returns {PageSetting} A set of Page bounding boxes.
   */
  updateLayout(layoutParams, bv) {
    throw 'Unimplemented PageSetter error!';
  }
}
