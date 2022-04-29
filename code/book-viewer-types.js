/** @enum */
export const FitMode = {
  Width: 1,
  Height: 2,
  Best: 3,
}

/**
 * @typedef Point Defines a pair of x/y values.
 * @property {number} x
 * @property {number} y
 */

/**
 * @typedef Box Defines a box/rectangle.
 * @property {number} left The left edge.
 * @property {number} top The top edge.
 * @property {number} width The width.
 * @property {number} height The height.
 */

// TODO: Add in a pageAspectRatios array for all the pages needing setting.
/**
 * @typedef PageLayoutParams Configurable parameters for a page layout.
 * @property {number} rotateTimes The number of 90 degree clockwise rotations.
 * @property {FitMode} fitMode The fit mode.
 * @property {number} pageAspectRatio The aspect ratio of the pages in the book.
 * @property {Box} bv The BookViewer bounding box.
 */

/**
 * @typedef PageSetting A description of how pages and the book viewer should be layed out.
 * @property {Box[]} boxes Page bounding boxes.
 * @property {Box} bv The adjusted box for the book viewer.
 */
