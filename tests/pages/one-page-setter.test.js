import { FitMode } from '../../code/book-viewer-types.js';
import { OnePageSetter } from '../../code/pages/one-page-setter.js';

import 'mocha';
import { expect } from 'chai';

/** @typedef {import('../../code/book-viewer-types.js').Box} Box */
/** @typedef {import('../../code/book-viewer-types.js').PageLayoutParams} PageLayoutParams */
/** @typedef {import('../../code/book-viewer-types.js').PageSetting} PageSetting */

describe('OnePageSetter', () => {
  /** @type {PageLayoutParams} */
  let layoutParams;

  /** @type {OnePageSetter} */
  let setter;

  beforeEach(() => {
    layoutParams = {};
    setter = new OnePageSetter();
  });

  describe('FitMode.Width', () => {
    beforeEach(() => {
      layoutParams.fitMode = FitMode.Width;
    });

    describe('no rotation', () => {
      beforeEach(() => {
        layoutParams.rotateTimes = 0;
      });

      it(`sizes page properly when par < bvar`, () => {
        const PAGE_ASPECT_RATIO = 0.5;
        const BV_WIDTH = 400;
        const BV_HEIGHT = 400;
        layoutParams.pageAspectRatio = PAGE_ASPECT_RATIO;
        layoutParams.bv = { left: 0, top: 0, width: BV_WIDTH, height: BV_HEIGHT };

        /** @type {PageSetting} */
        const pageSetting = setter.updateLayout(layoutParams);
        expect(pageSetting.boxes).to.be.an('array');
        expect(pageSetting.boxes).to.have.lengthOf(1);

        /** @type {Box} */
        const box1 = pageSetting.boxes[0];
        expect(box1.width).equals(BV_WIDTH);
        expect(box1.height).equals(BV_WIDTH/PAGE_ASPECT_RATIO);
        expect(box1.left).equals(0);
        expect(box1.top).equals(0);
      });

      it(`centers page vertically when par > bvar`, () => {
        const PAGE_ASPECT_RATIO = 0.5;
        const BV_WIDTH = 400;
        const BV_HEIGHT = 1200;
        layoutParams.pageAspectRatio = PAGE_ASPECT_RATIO;
        layoutParams.bv = { left: 0, top: 0, width: BV_WIDTH, height: BV_HEIGHT };

        /** @type {PageSetting} */
        const pageSetting = setter.updateLayout(layoutParams);
        expect(pageSetting.boxes).to.be.an('array');
        expect(pageSetting.boxes).to.have.lengthOf(1);

        /** @type {Box} */
        const box1 = pageSetting.boxes[0];
        expect(box1.width).equals(BV_WIDTH);
        expect(box1.height).equals(BV_WIDTH / PAGE_ASPECT_RATIO);
        expect(box1.left).equals(0);
        expect(box1.top).equals((BV_HEIGHT - BV_WIDTH / PAGE_ASPECT_RATIO) / 2);
      });
    });

    describe('rotated cw', () => {
      beforeEach(() => {
        layoutParams.rotateTimes = 1;
      });

      it(`sizes page properly when par <= 1/bvar`, () => {
        const PAGE_ASPECT_RATIO = 0.5;
        const BV_WIDTH = 200;
        const BV_HEIGHT = 400;
        layoutParams.pageAspectRatio = PAGE_ASPECT_RATIO;
        layoutParams.bv = { left: 0, top: 0, width: BV_WIDTH, height: BV_HEIGHT };

        /** @type {PageSetting} */
        const pageSetting = setter.updateLayout(layoutParams);

        /** @type {Box} */
        const box1 = pageSetting.boxes[0];
        expect(box1.width).equals(BV_HEIGHT);
        expect(box1.height).equals(BV_HEIGHT / PAGE_ASPECT_RATIO);

        const center = { x: BV_WIDTH / 2, y: BV_HEIGHT / 2 };
        expect(box1.left).equals(center.x - BV_HEIGHT / 2);
        // Since it's been rotated clockwise, we expect the top to extend above.
        expect(box1.top).equals(center.y - BV_WIDTH / 2 + BV_WIDTH - box1.height);

        // Since the page's aspect ratio is 1/2, but it's been rotated (aspect ratio = 2)
        // We expect the bookViewer's width to have been expanded so it can scroll.
        expect(pageSetting.bv.width).equals(BV_HEIGHT / PAGE_ASPECT_RATIO);
        expect(pageSetting.bv.height).equals(BV_HEIGHT);
      });

      it(`centers page horizontally when par > 1/bvar`, () => {
        const PAGE_ASPECT_RATIO = 0.5;
        const BV_WIDTH = 1200;
        const BV_HEIGHT = 400; // bvar = 3
        layoutParams.pageAspectRatio = PAGE_ASPECT_RATIO;
        layoutParams.bv = { left: 0, top: 0, width: BV_WIDTH, height: BV_HEIGHT };

        /** @type {PageSetting} */
        const pageSetting = setter.updateLayout(layoutParams);

        /** @type {Box} */
        const box1 = pageSetting.boxes[0];
        expect(box1.width).equals(BV_HEIGHT);
        expect(box1.height).equals(BV_HEIGHT / PAGE_ASPECT_RATIO);

        const center = { x: BV_WIDTH / 2, y: BV_HEIGHT / 2 };
        expect(box1.left).equals(center.x - BV_HEIGHT / 2);
        expect(box1.top).equals(center.y - box1.height / 2);
      });
    });
  });

  describe('FitMode.Height', () => {
    beforeEach(() => {
      layoutParams.fitMode = FitMode.Height;
    });

    describe('no rotation', () => {
      beforeEach(() => {
        layoutParams.rotateTimes = 0;
      });

      it(`sizes page properly when par > bvar`, () => {
        const PAGE_ASPECT_RATIO = 2;
        const BV_WIDTH = 200;
        const BV_HEIGHT = 400;
        layoutParams.pageAspectRatio = PAGE_ASPECT_RATIO;
        layoutParams.bv = { left: 0, top: 0, width: BV_WIDTH, height: BV_HEIGHT };

        /** @type {PageSetting} */
        const pageSetting = setter.updateLayout(layoutParams);
        expect(pageSetting.boxes).to.be.an('array');
        expect(pageSetting.boxes).to.have.lengthOf(1);

        /** @type {Box} */
        const box1 = pageSetting.boxes[0];
        expect(box1.top).equals(0);
        expect(box1.height).equals(BV_HEIGHT);
        expect(box1.left).equals(0);
        expect(box1.width).equals(BV_HEIGHT * PAGE_ASPECT_RATIO);

        // Width of the book viewer should have been changed.
        expect(pageSetting.bv.width).equals(BV_HEIGHT * PAGE_ASPECT_RATIO);
      });

      it(`centers horizontally when par < bvar`, () => {
        const PAGE_ASPECT_RATIO = 0.5;
        const BV_WIDTH = 400;
        const BV_HEIGHT = 400;
        layoutParams.pageAspectRatio = PAGE_ASPECT_RATIO;
        layoutParams.bv = { left: 0, top: 0, width: BV_WIDTH, height: BV_HEIGHT };

        /** @type {PageSetting} */
        const pageSetting = setter.updateLayout(layoutParams);

        /** @type {Box} */
        const box1 = pageSetting.boxes[0];
        expect(box1.top).equals(0);
        expect(box1.height).equals(BV_HEIGHT);
        expect(box1.width).equals(BV_HEIGHT * PAGE_ASPECT_RATIO);
        expect(box1.left).equals((BV_WIDTH - box1.width)/2);
      });
    });

    describe('rotated cw', () => {
      beforeEach(() => {
        layoutParams.rotateTimes = 1;
      });

      it(`sizes page properly when par >= 1/bvar`, () => {
        const PAGE_ASPECT_RATIO = 2;
        const BV_WIDTH = 400;
        const BV_HEIGHT = 200;
        layoutParams.pageAspectRatio = PAGE_ASPECT_RATIO;
        layoutParams.bv = { left: 0, top: 0, width: BV_WIDTH, height: BV_HEIGHT };

        /** @type {PageSetting} */
        const pageSetting = setter.updateLayout(layoutParams);
        expect(pageSetting.boxes).to.be.an('array');
        expect(pageSetting.boxes).to.have.lengthOf(1);

        /** @type {Box} */
        const box1 = pageSetting.boxes[0];
        expect(box1.height).equals(BV_WIDTH);
        expect(box1.width).equals(BV_WIDTH * PAGE_ASPECT_RATIO);

        const center = { x: BV_WIDTH / 2, y: BV_HEIGHT / 2 };
        expect(box1.top).equals(center.y - BV_WIDTH / 2);
        // Since it's been rotated clockwise, we expect the top to extend above.
        expect(box1.left).equals(center.x - BV_HEIGHT / 2); // + BV_HEIGHT - box1.width);

        // Width of the book viewer should have been changed.
        expect(pageSetting.bv.height).equals(box1.width);
      });

      it(`centers page horizontally when par < 1/bvar`, () => {
        const PAGE_ASPECT_RATIO = 0.5;
        const BV_WIDTH = 400;
        const BV_HEIGHT = 800; // bvar = 0.5
        layoutParams.pageAspectRatio = PAGE_ASPECT_RATIO;
        layoutParams.bv = { left: 0, top: 0, width: BV_WIDTH, height: BV_HEIGHT };

        /** @type {PageSetting} */
        const pageSetting = setter.updateLayout(layoutParams);

        /** @type {Box} */
        const box1 = pageSetting.boxes[0];
        expect(box1.height).equals(BV_WIDTH);
        expect(box1.width).equals(BV_WIDTH * PAGE_ASPECT_RATIO);

        const center = { x: BV_WIDTH / 2, y: BV_HEIGHT / 2 };
        expect(box1.top).equals(center.y - box1.height / 2);
        expect(box1.left).equals(center.x - box1.width / 2);
      });
    });

    // TODO: Add tests for rotate 180deg and rotate 270deg.
  });
});
