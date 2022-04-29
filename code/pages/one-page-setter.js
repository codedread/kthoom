/** Defines the most basic page setter of having just a single page. */
import { FitMode } from '../book-viewer-types.js';
import { PageSetter } from './page-setter.js';

/** @typedef {import('../book-viewer-types.js').Box} Box */
/** @typedef {import('../book-viewer-types.js').PageLayoutParams} PageLayoutParams */
/** @typedef {import('../book-viewer-types.js').PageSetting} PageSetting */

export class OnePageSetter extends PageSetter {
  /**
   * @param {PageLayoutParams} layoutParams
   * @returns {PageSetting} A set of Page bounding boxes.
   */
  updateLayout(layoutParams) {
    const par = layoutParams.pageAspectRatio;
    const portraitMode = (layoutParams.rotateTimes % 2 === 0);
    const bv = layoutParams.bv;
    const bvar = bv.width / bv.height;

    // This is the center of rotation, always rotating around the center of the book viewer.
    const rotx = bv.left + bv.width / 2;
    const roty = bv.top + bv.height / 2;

    // This is the dimensions before transformation.  They can go beyond the bv dimensions.
    let pw, ph, pl, pt;

    if (portraitMode) {
      // Portrait.
      if (layoutParams.fitMode === FitMode.Width ||
         (layoutParams.fitMode === FitMode.Best && bvar <= par)) {
        // fit-width OR
        // fit-best, width maxed.
        pw = bv.width;
        ph = pw / par;
        pl = bv.left;
        if (par > bvar) { // not scrollable.
          pt = roty - ph / 2;
        } else { // fit-width, scrollable.
          pt = roty - bv.height / 2;
          if (layoutParams.rotateTimes === 2) {
            pt += bv.height - ph;
          }
        }
      } else {
        // fit-height, OR
        // fit-best, height maxed.
        ph = bv.height;
        pw = ph * par;
        pt = bv.top;
        if (par < bvar) { // not scrollable.
          pl = rotx - pw / 2;
        } else { // fit-height, scrollable.
          pl = bv.left;
          if (layoutParams.rotateTimes === 2) {
            pl += bv.width - pw;
          }
        }
      }

      if (bv.width < pw) bv.width = pw;
      if (bv.height < ph) bv.height = ph;
    } else {
      // Landscape.
      if (layoutParams.fitMode === FitMode.Width ||
         (layoutParams.fitMode === FitMode.Best && par > (1 / bvar))) {
        // fit-best, width-maxed OR
        // fit-width.
        pw = bv.height;
        ph = pw / par;
        pl = rotx - pw / 2;
        if (par > (1 / bvar)) { // not scrollable.
          pt = roty - ph / 2;
        } else { // fit-width, scrollable.
          pt = roty - bv.width / 2;
          if (layoutParams.rotateTimes === 1) {
            pt += bv.width - ph;
          }
        }
      } else {
        // fit-best, height-maxed OR
        // fit-height.
        ph = bv.width;
        pw = ph * par;
        pt = roty - ph / 2;
        if (par < (1 / bvar)) { // not scrollable.
          pl = rotx - pw / 2;
        } else { // fit-height, scrollable.
          pl = rotx - bv.height / 2;
          if (layoutParams.rotateTimes === 3) {
            pl += bv.height - pw;
          }
        }
      }

      if (bv.width < ph) bv.width = ph;
      if (bv.height < pw) bv.height = pw;
    } // Landscape

    /** @type {PageSetting} */
    return {
      boxes: [
        { left: pl, top: pt, width: pw, height: ph },
      ],
      bv,
    };
  }
}