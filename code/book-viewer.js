/**
 * book-viewer.js
 *
 * Licensed under the MIT License
 *
 * Copyright(c) 2018 Google Inc.
 */

import { Book } from './book.js';
import { BookEvent, BookEventType } from './book-events.js';
import { FitMode } from './book-viewer-types.js';
import { LongStripPageSetter } from './pages/long-strip-page-setter.js';
import { OnePageSetter } from './pages/one-page-setter.js';
import { PageContainer } from './pages/page-container.js';
import { PageSetter } from './pages/page-setter.js';
import { TwoPageSetter } from './pages/two-page-setter.js';
import { WideStripPageSetter } from './pages/wide-strip-page-setter.js';
import { assert, getElem, Params } from './common/helpers.js';

/** @typedef {import('./book-viewer-types.js').Box} Box */
/** @typedef {import('./book-viewer-types.js').PageLayoutParams} PageLayoutParams */
/** @typedef {import('./book-viewer-types.js').PageSetting} PageSetting */

const BOOK_VIEWER_ELEM_ID = 'bookViewer';
const SWIPE_THRESHOLD = 50;

const THROBBER_TIMER_MS = 60;
const MAX_THROBBING_TIME_MS = 10000;
const NUM_THROBBERS = 4;
const THROBBER_WIDTH = 4.2;
const MIN_THROBBER_X = 3;
const MAX_THROBBER_X = 86;

// Statically rendered DOM elements.
const bvElem = getElem(BOOK_VIEWER_ELEM_ID);
const svgTop = getElem('pages');
const bvViewport = getElem('bvViewport');

/**
 * The BookViewer is responsible for letting the user view the current book, navigate its pages,
 * update the orientation, page-mode and fit-mode of the viewer. It delegates to PageSetters to
 * layout the pages.
 */
export class BookViewer {
  // All PageSetters.
  #onePageSetter = new OnePageSetter();
  #twoPageSetter = new TwoPageSetter();
  #longStripPageSetter = new LongStripPageSetter();
  #wideStripPageSetter = new WideStripPageSetter();

  /** @type {Book} */
  #currentBook = null;

  /**
   * The current page number (zero-based).
   * @type {number}
   */
  #currentPageNum = -1;

  /**
   * The number of 90-degree clockwise rotations the viewer has. An integer from 0 to 3.
   * @type {number}
   */
  #rotateTimes = 0;

  /** @type {!FitMode} */
  #fitMode = FitMode.Best;

  /**
   * The number of pages visible in the viewer at one time. Defaults to 1 (one-page mode),
   * but can also be set to 2 (two-page mode), 3 (long-strip mode).
   * @type {number}
   */
  #numPagesInViewer = 1;

  /** @type {PageContainer[]} */
  #pageContainers = [];

  constructor() {
    this.wheelTimer_ = null;
    this.wheelTurnedPageAt_ = 0;

    this.throbberTimerId_ = null;
    this.throbbers_ = new Array(NUM_THROBBERS);
    this.throbberDirections_ = new Array(NUM_THROBBERS);
    for (let thr = 0; thr < this.throbberDirections_.length; ++thr) {
      this.throbbers_[thr] = getElem(`throbber_${thr}`);
      this.throbberDirections_[thr] = (thr % 2 == 0) ? 1 : -1;
    }
    this.throbbingTime_ = 0;

    this.#initProgressMeter();
  }

  handleSwipeEvent(evt) {
    if (!this.#currentBook) {
      return;
    }

    // If a swipe/scroll event occurs, let it happen normally, but update the page
    // number, if required.
    if (this.getNumPagesInViewer() >= 3) {
      const pageSetter = this.getNumPagesInViewer() === 3 ?
          this.#longStripPageSetter :
          this.#wideStripPageSetter;
      const pageBoxes = this.#pageContainers.filter(c => c.isShown()).map(c => c.getBox());
      const newPageNum = Math.floor(pageSetter.getScrollPosition(
          document.documentElement.scrollLeft,
          document.documentElement.scrollTop,
          pageBoxes,
          this.#rotateTimes));
      if (newPageNum != this.#currentPageNum) {
        this.#currentPageNum = newPageNum;
      }
      return;
    }

    // Let scroll events happen if we are displaying text.
    if (evt.target.id === 'firstText') {
      return;
    }

    // Keep the timer going if it has been started.
    if (this.wheelTimer_) {
      clearTimeout(this.wheelTimer_);
    }
    // If we haven't received wheel events for some time, reset things.
    this.wheelTimer_ = setTimeout(() => {
      this.wheelTimer_ = null;
      this.wheelTurnedPageAt_ = 0;
    }, 200);

    // Determine what delta is relevant based on orientation.
    const delta = (this.#rotateTimes % 2 == 0 ? evt.deltaX : evt.deltaY);

    // If we turned the page, we won't let the page turn again until the delta
    // is below the hysteresis threshold (i.e. the swipe has lost its momentum).
    if (this.wheelTurnedPageAt_ !== 0) {
      if (Math.abs(delta) < SWIPE_THRESHOLD / 3) {
        this.wheelTurnedPageAt_ = 0;
      }
    } else {
      // If we haven't turned the page yet, see if this delta would turn the page.
      let turnPageFn = null;
      if (this.#rotateTimes <= 1) {
        if (delta > SWIPE_THRESHOLD) turnPageFn = () => this.showNextPage();
        else if (delta < -SWIPE_THRESHOLD) turnPageFn = () => this.showPrevPage();
      } else if (this.#rotateTimes <= 3) {
        if (delta < -SWIPE_THRESHOLD) turnPageFn = () => this.showNextPage();
        else if (delta > SWIPE_THRESHOLD) turnPageFn = () => this.showPrevPage();
      }
      if (turnPageFn) {
        turnPageFn();
        this.wheelTurnedPageAt_ = delta;
      }
    }
  }

  /**
   * @param {BookEvent} evt The BookEvent.
   * @private
   */
  handleEvent(evt) {
    this.#killThrobbing();

    if (evt.source === this.#currentBook) {
      switch (evt.type) {
        case BookEventType.PROGRESS:
          getElem('header').classList.add('animating');
          this.updateProgressMeter();
          break;
        case BookEventType.PAGE_EXTRACTED:
          // Display first page(s) if we haven't yet. If this is the long-strip view, update
          // layout every time we get a page so the top-level SVG is lengthened.
          if (evt.pageNum <= this.#numPagesInViewer ||
              this.getNumPagesInViewer() === 3) {
            this.updateLayout();
          } else {
            this.#updatePageMeter();
          }
          break;
        case BookEventType.BINDING_COMPLETE:
          getElem('header').classList.remove('animating');
          this.updateLayout();
          this.updateProgressMeter();

          this.#currentBook.removeEventListener(BookEventType.PROGRESS, this);
          this.#currentBook.removeEventListener(BookEventType.PAGE_EXTRACTED, this);
          this.#currentBook.removeEventListener(BookEventType.BINDING_COMPLETE, this);
    
          break;
      }
    }
  }

  /** @returns {number} The number of 90-degree clockwise rotations the book viewer has. */
  getRotateTimes() { return this.#rotateTimes; }

  /** @param {number} n The number of 90-degree clockwise rotations the book viewer should have. */
  setRotateTimes(n) {
    n = parseInt(n, 10) % 4;
    if (n < 0) n += 4;

    if (this.#rotateTimes !== n) {
      this.#rotateTimes = n;
      this.updateLayout();
    }
  }

  rotateCounterClockwise() {
    this.setRotateTimes(this.#rotateTimes - 1);
  }

  rotateClockwise() {
    this.setRotateTimes(this.#rotateTimes + 1);
  }

  /** @returns {FitMode} */
  getFitMode() { return this.#fitMode; }

  /** @param {FitMode} m */
  setFitMode(m) {
    if (this.#fitMode !== m) {
      this.#fitMode = m;
      this.updateLayout();
    }
  }

  /** @returns {number} The number of pages being shown in the viewer (1, 2, or 3 which means long-strip). */
  getNumPagesInViewer() { return this.#numPagesInViewer; }

  /**
   * Sets the number of pages in the viewer (1-page, 2-page, or Long Strip (3) are supported).
   * @param {Number} numPages Can be 1, 2, or 3.
   */
  setNumPagesInViewer(numPages) {
    numPages = parseInt(numPages, 10);
    if (numPages < 1 || numPages > 4) return;

    if (this.#numPagesInViewer !== numPages) {
      this.#numPagesInViewer = numPages;
      this.updateLayout();
    }
  }

  /**
   * Updates the layout based on window size, scale mode, fit mode, rotations, and page mode and
   * then sets the page contents based on the current page of the current book.  If there is no
   * current book, we clear the contents of all the page elements.
   * This is also called every time a new page is loaded.
   */
  updateLayout() {
    if (!this.#currentBook || this.#currentPageNum === -1) {
      this.#clearPageContents();
      return;
    }

    this.#updatePageMeter();
    this.#updateProgressBackgroundPosition();

    const currentPage = this.#currentBook.getPage(this.#currentPageNum);
    if (!currentPage) {
      console.log('updateLayout() before current page is loaded');
      return;
    }

    // This is the dimensions of the book viewer "window".
    /** @type {Box} */
    const bv = {
      left: 0,
      width: bvElem.offsetWidth,
      top: 0,
      height: window.innerHeight - bvElem.offsetTop,
    };
    assert(bv.width, 'bv.width not set');
    assert(bv.height, 'bv.height not set');

    // This is the center of rotation, always rotating around the center of the book viewer.
    let rotx = bv.left + bv.width / 2;
    let roty = bv.top + bv.height / 2;
    let angle = 90 * this.#rotateTimes;

    /** @type {PageLayoutParams} */
    const layoutParams = {
      fitMode: this.#fitMode,
      rotateTimes: this.#rotateTimes,
      pageAspectRatio: currentPage.getAspectRatio(),
      bv: {...bv},
    };

    /** @type {PageSetting} */
    let pageSetting;
    /** @type {PageSetter} */
    let pageSetter;
    let numPages;
    let startingPageNum;
    switch (this.#numPagesInViewer) {
      case 1:
        numPages = 1;
        startingPageNum = this.#currentPageNum;
        pageSetter = this.#onePageSetter;
        break;
      case 2:
        numPages = 2;
        startingPageNum = this.#currentPageNum;
        pageSetter = this.#twoPageSetter;
        break;
      case 3:
        numPages = this.#currentBook.getNumberOfPages();
        startingPageNum = 0; // Always render all the pages.
        pageSetter = this.#longStripPageSetter;
        pageSetter.setNumPages(numPages);
        break;
      case 4:
        numPages = this.#currentBook.getNumberOfPages();
        startingPageNum = 0; // Always render all the pages.
        pageSetter = this.#wideStripPageSetter;
        pageSetter.setNumPages(numPages);
        break;
    }

    // Before we redo PageSetting, remember the book viewer's scroll point and # of pages.
    const pageBoxes = this.#pageContainers.filter(c => c.isShown()).map(c => c.getBox());
    const prevScrollPos = pageSetter.getScrollPosition(
        document.documentElement.scrollLeft,
        document.documentElement.scrollTop,
        pageBoxes,
        this.#rotateTimes);
    const prevNumPagesInViewer = pageBoxes.length;

    pageSetting = pageSetter.updateLayout(layoutParams);

    // For every visible PageContainer, set its box size and render the page.
    const pageContainers = this.#showPageContainers(numPages);
    for (let i = 0; i < numPages; ++i) {
      pageContainers[i].setFrame(pageSetting.boxes[i]);
      this.#renderPageInContainer(startingPageNum, pageContainers[i]);

      ++startingPageNum;
      // The 2-page page setter will render the first page in its second container at the end.
      if (startingPageNum >= this.#currentBook.getNumberOfPages()) startingPageNum = 0;
    }

    const tx = pageSetting.bv.left;
    const ty = pageSetting.bv.top;
    const topw = pageSetting.bv.width;
    const toph = pageSetting.bv.height;

    // Rotate the book viewer viewport.
    const tr = `translate(${rotx-tx}, ${roty-ty}) rotate(${angle}) translate(${-rotx}, ${-roty})`;
    bvViewport.setAttribute('transform', tr);

    // Now size the top-level SVG element of the BookViewer.
    svgTop.style.display = '';
    svgTop.setAttribute('x', 0);
    svgTop.setAttribute('y', 0);
    svgTop.setAttribute('width', topw);
    svgTop.setAttribute('height', toph);

    // Special handling for long-strip mode.
    if (this.getNumPagesInViewer() === 3 || this.getNumPagesInViewer() === 4) {
      // If the number of pages in the viewer changed (i.e. long-strip mode as the book is loading),
      // and loading pages would move the scroll position (i.e. in 180 or 270-deg rotation), then
      // scroll the viewer to the same position they were at before.
      if (prevNumPagesInViewer !== numPages) {

        const deltaScroll = pageSetter.getScrollPosition(
            document.documentElement.scrollLeft,
            document.documentElement.scrollTop,
            pageContainers.map(c => c.getBox()),
            this.#rotateTimes) - prevScrollPos; 
        if (deltaScroll !== 0) {
          const delta = pageSetter.getScrollDelta(deltaScroll, pageSetting.boxes[0], this.#rotateTimes);
          document.documentElement.scrollBy(delta.x, delta.y);
        }
      }

      // If the user moved pages, and that page is not visible, scroll them to it.
      const oldPageNum = Math.floor(prevScrollPos);
      if (oldPageNum !== this.#currentPageNum) {
        const pxPageHeight = pageSetting.boxes[0].height;
        const pxDeltaToTopOfOldPage = -(prevScrollPos - oldPageNum) * pxPageHeight;
        const pxTotalDelta = pxDeltaToTopOfOldPage + (this.#currentPageNum - oldPageNum) * pxPageHeight;
        let left = 0;
        let top = 0;
        switch (this.#rotateTimes) {
          case 0: top = pxTotalDelta; break;
          case 1: left = -pxTotalDelta; break;
          case 2: top = -pxTotalDelta; break;
          case 3: left = pxTotalDelta; break;
        }
        document.documentElement.scrollBy({ left, top, behavior: 'smooth' });
      }
    }
  }

  /**
   * @param {Book} book
   */
  setCurrentBook(book) {
    if (book && this.#currentBook !== book) {
      this.closeBook();
      this.#killThrobbing();

      this.#currentBook = book;

      book.addEventListener(BookEventType.PROGRESS, this);
      book.addEventListener(BookEventType.PAGE_EXTRACTED, this);
      book.addEventListener(BookEventType.BINDING_COMPLETE, this);

      const getX = (el) => parseFloat(el.getAttribute('x'), 10);
      this.throbbers_.forEach(el => el.style.visibility = 'visible');
      this.throbberTimerId_ = setInterval(() => { 
        this.throbbingTime_ += THROBBER_TIMER_MS;
        if (this.throbbingTime_ > MAX_THROBBING_TIME_MS) {
          this.#killThrobbing();
        }

        // Animate throbbers until first byte loads.
        const T = this.throbbers_.length;
        for (let thr = 0; thr < T; ++thr) {
          // Throbbers travel along the bar until they bump into another throbber or the edge.
          const prev = thr - 1;
          const next = thr + 1;
          const MIN_X = (prev >= 0) ? getX(this.throbbers_[prev]) + THROBBER_WIDTH : MIN_THROBBER_X;
          const MAX_X = (next < T) ? getX(this.throbbers_[next]) : MAX_THROBBER_X;

          // Advance throbber's position.
          let pos = getX(this.throbbers_[thr]) + this.throbberDirections_[thr];// * (1 + thr * 0.25);
          // If it hit something, reverse direction.
          if ((pos + THROBBER_WIDTH) >= MAX_X && this.throbberDirections_[thr] > 0) {
            pos = MAX_X;
            this.throbberDirections_[thr] = -1;
          } else if (pos <= MIN_X && this.throbberDirections_[thr] < 0) {
            pos = MIN_X;
            this.throbberDirections_[thr] = 1;
          }
          // Update position
          this.throbbers_[thr].setAttribute('x', `${pos}%`);
        }
      }, THROBBER_TIMER_MS);

      this.#currentPageNum = 0;
      this.updateProgressMeter();
      this.updateLayout();
    }
  }

  /**
   * Close the current book.
   */
  closeBook() {
    if (this.#currentBook) {
      this.#currentBook = null;
      this.#currentPageNum = -1;
    }

    getElem('loadmeter').setAttribute('width', '0%');
    getElem('zipmeter').setAttribute('width', '0%');
    getElem('layoutmeter').setAttribute('width', '0%');
    getElem('pagemeter').setAttribute('width', '0%');
    getElem('page').innerHTML = '0/0';

    this.updateProgressMeter();
    this.updateLayout();
  }

  /** @returns {boolean} If the next page was shown. */
  showPrevPage() {
    if (!this.#currentBook || this.#currentPageNum == 0) {
      return false;
    }

    this.#currentPageNum--;
    this.updateLayout();
    return true;
  }

  /** @returns {boolean} If the next page was shown. */
  showNextPage() {
    // If there is no current book, or the viewer is showing the last pages of the book, just return.
    if (!this.#currentBook ||
      (this.#currentPageNum >= this.#currentBook.getNumberOfPages() - this.#numPagesInViewer)) {
      return false;
    }

    this.#currentPageNum++;
    this.updateLayout();
    return true;
  }

  /** @param {number} n */
  showPage(n) {
    if (!this.#currentBook ||
      (n < 0 || n >= this.#currentBook.getNumberOfPages() || n === this.#currentPageNum)) {
      return;
    }
    this.#currentPageNum = n;
    this.updateLayout();
  }

  /**
   * Updates the book viewer meters based on the current book's progress.
   * @param {string} label
   */
  updateProgressMeter(label = undefined) {
    if (!this.#currentBook) {
      return;
    }

    // TODO: Test this.
    let loadingPct = this.#currentBook.getLoadingPercentage();
    let unzippingPct = this.#currentBook.getUnarchivingPercentage();
    let layingOutPct = this.#currentBook.getLayoutPercentage();
    let totalPages = this.#currentBook.getNumberOfPages();
    loadingPct = Math.max(0, Math.min(100 * loadingPct, 100));
    unzippingPct = Math.max(0, Math.min(100 * unzippingPct, 100));
    layingOutPct = Math.max(0, Math.min(100 * layingOutPct, 100));

    this.#animateMeterTo(loadingPct, 'loadmeter');
    this.#animateMeterTo(unzippingPct, 'zipmeter');
    this.#animateMeterTo(layingOutPct, 'layoutmeter');

    let bkgndWidth = Math.ceil(Math.log10(totalPages + 1)) * 2 + 1;
    getElem('page_bkgnd').setAttribute('width', `${bkgndWidth * 10}`);
    getElem('page').innerHTML = (this.#currentPageNum + 1) + '/' + totalPages;

    let title = getElem('progress_title');
    while (title.firstChild) title.removeChild(title.firstChild);

    let labelPct;
    let labelText;
    if (loadingPct < 100) {
      labelText = 'Loading';
      labelPct = loadingPct;
    } else if (unzippingPct < 100) {
      labelText = 'Unzipping';
      labelPct = unzippingPct;
    } else if (layingOutPct < 100) {
      labelText = 'Layout';
      labelPct = layingOutPct;
    } else {
      labelText = 'Complete'
      labelPct = 100;
    }
    if (label) {
      labelText = label;
    }
    title.appendChild(document.createTextNode(`${labelText} ${labelPct.toFixed(2)}% `));

    const progressBkgndWidth = (labelText.length + 4) * 10;
    getElem('progress_bkgnd').setAttribute('width', `${progressBkgndWidth}`);
    this.#updateProgressBackgroundPosition();

    // Update some a11y attributes of the progress meter.
    if (this.#currentBook) {
      const totalPct = (loadingPct + unzippingPct + layingOutPct) / 3;
      const totalPctStr = totalPct.toFixed(2) + '%';
      const bvElem = getElem(BOOK_VIEWER_ELEM_ID);
      const progressElem = getElem('progress');
      progressElem.setAttribute('aria-label', totalPctStr);
      if (totalPctStr !== '100.00%') {
        bvElem.setAttribute('aria-busy', 'true');
        bvElem.setAttribute('aria-describedby', 'progress');
        progressElem.setAttribute('aria-valuenow', totalPct);
        progressElem.setAttribute('aria-valuemin', '0');
        progressElem.setAttribute('aria-valuemax', '100');
      } else {
        bvElem.setAttribute('aria-busy', 'false');
        bvElem.removeAttribute('aria-describedBy');
        progressElem.removeAttribute('aria-valuenow');
        progressElem.removeAttribute('aria-valuemin');
        progressElem.removeAttribute('aria-valuemax');
      }
    }
    this.#updatePageMeter();
  }

  /**
   * @param {number} pct
   * @param {string} meterId
   */
   #animateMeterTo(pct, meterId) {
    getElem(meterId).setAttribute('width', pct + '%');
  }

  /** Wipes out the contents of all book viewer elements. */
  #clearPageContents() {
    for (const container of this.#pageContainers) {
      container.clear();
    }
  }

  /**
   * Gets the page container from the BookViewer viewport. If the ith container does not exist,
   * this method creates enough until there are i PageContainers in the viewport.
   * @param {number} i 
   * @returns {PageContainer}
   */
  #getPageContainer(i) {
    while (this.#pageContainers.length <= i) {
      const container = new PageContainer();
      this.#pageContainers.push(container);
      bvViewport.appendChild(container.getElement());
    }
    return this.#pageContainers[i];
  }

  /**
   * @returns {number} A floating point number indicating the page position that is at the top-left
   * of the book viewer. Used to maintain scroll position in long-strip mode as the book loads in.
   */
   #getScrollPosition() {
    const allVisibleContainers = this.#pageContainers.filter(c => c.isShown());
    if (allVisibleContainers.length === 0) {
      return 0;
    }

    const onePageHeight = allVisibleContainers[0].getHeight();
    const fullHeight = allVisibleContainers.reduce((prev, cur) => prev + cur.getHeight(), 0);
    let scrollPosPx;
    switch (this.#rotateTimes) {
      case 0: scrollPosPx = document.documentElement.scrollTop; break;
      case 1: scrollPosPx = fullHeight - document.documentElement.scrollLeft - onePageHeight; break;
      case 2: scrollPosPx = fullHeight - document.documentElement.scrollTop - onePageHeight; break;
      case 3: scrollPosPx = document.documentElement.scrollLeft; break;
    }

    return scrollPosPx / onePageHeight;
  }

  #initProgressMeter() {
    const pdiv = getElem('progress');
    const svg = getElem('svgprogress');
    svg.addEventListener('click', (evt) => {
      let l = 0;
      const docEl = document.documentElement;
      for (let el = pdiv; el != docEl; el = el.parentNode) {
        l += el.offsetLeft;
      }
      const totalPages = this.#currentBook.getNumberOfPages();
      const page = Math.max(1, Math.ceil(((evt.clientX - l) / pdiv.offsetWidth) * totalPages)) - 1;
      this.#currentPageNum = page;
      this.updateLayout();
    });
  }

  #killThrobbing() {
    if (this.throbberTimerId_) {
      clearInterval(this.throbberTimerId_);
      this.throbberTimerId_ = null;
      this.throbbers_.forEach(el => el.style.visibility = 'hidden');
      this.throbbingTime_ = 0;
    }
  }

  /**
   * Renders contents of page number pageNum in the page viewer element.
   * @param {Number} pageNum The page number to render into the div.
   * @param {PageContainer} pageContainer The page container.
   */
  #renderPageInContainer(pageNum, pageContainer) {
    assert(this.#currentBook, 'Current book not defined in #showPageInContainer()');
    assert(this.#currentBook.getNumberOfPages() > pageNum,
      `Book does not have enough pages in #showPageInContainer(), can't show page #${pageNum}`);

    const thePage = this.#currentBook.getPage(pageNum);
    // It's possible we are in a 2-page viewer, but the page is not in the book yet.
    if (!thePage) {
      return;
    }

    thePage.renderIntoContainer(pageContainer, pageNum);
  }

  /**
   * Shows n page containers and hides the rest. This may create page containers if needed.
   * @param {number} n
   * @returns {PageContainer[]} Returns the n visible page containers.
   */
  #showPageContainers(n) {
    assert(n > 0);
    const N = Math.max(this.#pageContainers.length, n);
    for (let i = 0; i < N; ++i) {
      this.#getPageContainer(i).show(i < n);
    }
    return this.#pageContainers.slice(0, n);
  }

  /** @private */
  #updatePageMeter() {
    const pageNum = this.#currentPageNum;
    const numPages = this.#currentBook.getNumberOfPages();
    getElem('page').innerHTML = (pageNum + 1) + '/' + numPages;
    getElem('pagemeter').setAttribute('width',
      100 * (numPages == 0 ? 0 : ((pageNum + this.#numPagesInViewer) / numPages)) + '%');
  }

  /** @private */
  #updateProgressBackgroundPosition() {
    const totalWidth = getElem('border').width.baseVal.value;
    const progressBkgnd = getElem('progress_bkgnd');
    const progressBkgndWidth = progressBkgnd.width.baseVal.value;
    progressBkgnd.setAttribute('x', totalWidth - progressBkgndWidth);
  }
}
