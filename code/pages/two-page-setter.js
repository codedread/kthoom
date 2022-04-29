/** Defines the most basic page setter of having just a single page. */
import { FitMode } from '../book-viewer-types.js';
import { PageSetter } from './page-setter.js';

/** @typedef {import('../book-viewer-types.js').Box} Box */
/** @typedef {import('../book-viewer-types.js').PageLayoutParams} PageLayoutParams */
/** @typedef {import('../book-viewer-types.js').PageSetting} PageSetting */

// TODO: Add unit tests.

export class TwoPageSetter extends PageSetter {
  /**
   * @param {PageLayoutParams} layoutParams
   * @returns {PageSetting} A set of Page bounding boxes.
   */
  updateLayout(layoutParams) {
    const par = layoutParams.pageAspectRatio;
    const portraitMode = (layoutParams.rotateTimes % 2 === 0);
    const bv = layoutParams.bv;
    let bvar = bv.width / bv.height;

    // This is the center of rotation, always rotating around the center of the book viewer.
    const rotx = bv.left + bv.width / 2;
    const roty = bv.top + bv.height / 2;

    // These are the dimensions before transformation.  They can go beyond the bv dimensions.
    let pw, ph, pl1, pt1, pl2, pt2;

    if (portraitMode) {
      // It is as if the book viewer width is cut in half horizontally for the purposes of
      // measuring the page fit.
      bvar /= 2;

      // Portrait, 2-page.
      if (layoutParams.fitMode === FitMode.Width ||
          (layoutParams.fitMode === FitMode.Best && bvar <= par)) {
        // fit-width, 2-page.
        // fit-best, 2-page, width maxed.
        pw = bv.width / 2;
        ph = pw / par;
        pl1 = bv.left;
        if (par > bvar) {  // not scrollable.
          pt1 = roty - ph / 2;
        } else {  // fit-width, scrollable.
          pt1 = roty - bv.height / 2;
          if (layoutParams.rotateTimes === 2) {
            pt1 += bv.height - ph;
          }
        }
      } else {
        // fit-height, 2-page.
        // fit-best, 2-page, height maxed.
        ph = bv.height;
        pw = ph * par;
        pt1 = bv.top;
        if (par < bvar) {  // not scrollable.
          pl1 = rotx - pw;
        } else {  // fit-height, scrollable.
          pl1 = bv.left;
          if (layoutParams.rotateTimes === 2) {
            pl1 += bv.width - pw * 2;
          }
        }
      }

      if (bv.width < pw * 2) bv.width = pw * 2;
      if (bv.height < ph) bv.height = ph;
    } else {
      bvar *= 2;

      // Landscape, 2-page.
      if (layoutParams.fitMode === FitMode.Width ||
         (layoutParams.fitMode === FitMode.Best && par > (1 / bvar))) {
        // fit-best, 2-page, width-maxed.
        // fit-width, 2-page.
        pw = bv.height / 2;
        ph = pw / par;
        pl1 = rotx - pw;
        if (par > (1 / bvar)) { // not scrollable.
          pt1 = roty - ph / 2;
        } else { // fit-width, scrollable.
          pt1 = roty - bv.width / 2;
          if (layoutParams.rotateTimes === 1) {
            pt1 += bv.width - ph;
          }
        }
      } else {
        // fit-best, 2-page, height-maxed.
        // fit-height, 2-page.
        ph = bv.width;
        pw = ph * par;
        pt1 = roty - ph / 2;
        if (par < (1 / bvar)) { // not scrollable.
          pl1 = rotx - pw;
        } else { // fit-height, scrollable.
          pl1 = rotx - bv.height / 2;
          if (layoutParams.rotateTimes === 3) {
            pl1 += bv.height - pw * 2;
          }
        }
      }

      if (bv.width < ph) bv.width = ph;
      if (bv.height < pw * 2) bv.height = pw * 2;
    } // Landscape

    pl2 = pl1 + pw;
    pt2 = pt1;

    /** @type {PageSetting} */
    return {
      boxes: [
        { left: pl1, top: pt1, width: pw, height: ph },
        { left: pl2, top: pt2, width: pw, height: ph },
      ],
      bv,
    };
  }
}
