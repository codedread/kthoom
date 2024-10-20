/*
 * kthoom.js
 *
 * Licensed under the MIT License
 *
 * Copyright(c) 2011 Google Inc.
 * Copyright(c) 2011 antimatter15
 */

import { Book, BookContainer } from './book.js';
import { BookEventType } from './book-events.js';
import { BookViewer } from './book-viewer.js';
import { MessageTypes as KthoomMessageTypes } from './kthoom-messages.js';
import { FitMode } from './book-viewer-types.js';
import { Menu, MenuEventType } from './menu.js';
import { ReadingStack } from './reading-stack.js';
import { Key, Params, assert, getElem, serializeParamsToBrowser } from './common/helpers.js';
import { ImagePage, WebPShimImagePage } from './page.js';
import { convertWebPtoJPG, convertWebPtoPNG } from './bitjs/image/webp-shim/webp-shim.js';
import { MetadataViewer } from './metadata/metadata-viewer.js';

if (window.kthoom == undefined) {
  window.kthoom = {};
}

const LOCAL_STORAGE_KEY = 'kthoom_settings';
const BOOK_VIEWER_ELEM_ID = 'bookViewer';
const READING_STACK_ELEM_ID = 'readingStack';
const HIDE_PANEL_BUTTONS_MENU_ITEM = 'menu-view-hide-panel-buttons';

const PNG = 'image/png';
const JPG = 'image/jpeg';
const WEBP = 'image/webp';

/** @enum */
const MENU = {
  MAIN: 'mainMenu',
  OPEN: 'openMenu',
  VIEW: 'viewMenu',
  VIEWER_CONTEXT: 'viewerContextMenu',
};

const GOOGLE_MENU_ITEM_ID = 'menu-open-google-drive';

// Non-Chrome browsers and non-secure contexts will not have this picker.
const enableOpenDirectory = !!window.showDirectoryPicker;

/**
 * The main class for the kthoom reader. This class should be considered the official API of the
 * kthoom app, with its public methods being the way you control kthoom "from the outside" (i.e.
 * if you are hosting kthoom inside a larger web app).
 */
export class KthoomApp {
  /** @type {Menu} */
  #viewerContextMenu = null;

  constructor() {
    /** @private {BookViewer} */
    this.bookViewer_ = new BookViewer();
    /** @private {ReadingStack} */
    this.readingStack_ = new ReadingStack();
    /** @private {MetadataViewer} */
    this.metadataViewer_ = new MetadataViewer();

    this.keysHeld_ = {};

    /** @private {Book} */
    this.currentBook_ = null;

    /** @private {Menu}  */
    this.mainMenu_ = null;

    /** @private {Menu} */
    this.openMenu_ = null;

    /** @private {Menu} */
    this.viewMenu_ = null;

    /** @private {boolean} */
    this.hasHelpOverlay_ = getElem('helpOverlay');

    // TODO: Remove this once all browsers support the File System Access API.
    /** @private {HTMLInputElement} */
    this.fileInputElem_ = null;

    // This Promise resolves when kthoom is ready.
    this.initializedPromise_ = new Promise((resolve, reject) => {
      // If some other window opened Kthoom, then listen for messages.
      if (window.opener) {
        window.addEventListener('message', (evt) => this.#handleHostMessage(evt));
      }

      // This Promise resolves when the DOM is ready.
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => resolve(), false);
      } else {
        resolve();
      }
    }).then(() => {
      this.init_();
    });
  }

  /**
   * @param {string} id is one of 'main', 'open', 'view'
   * @returns {Menu}
  */
  getMenu(id) {
    switch (id) {
      case 'main':
        return this.mainMenu_;
      case 'open':
        return this.openMenu_;
      case 'main':
        return this.viewMenu_;
    }
  }

  /** @private */
  init_() {
    this.readingStack_.whenCurrentBookChanged(book => this.handleCurrentBookChanged_(book));
    // When the book has loaded (not unarchived), show the download menu option.
    this.readingStack_.whenCurrentBookHasLoaded(() => {
      this.mainMenu_.showMenuItem('menu-download', true);
    });

    this.initMenus_();
    this.initNav_();
    this.initDragDrop_();
    this.initClickHandlers_();
    this.initOverlays_();
    this.initResizeHandler_();
    this.initWheelScroll_();
    this.initUnloadHandler_();

    if (enableOpenDirectory) {
      const enableDirectoryElems = document.querySelectorAll('.hideEnableDirectoryElem');
      for (let i = 0; i < enableDirectoryElems.length; ++i) {
        enableDirectoryElems.item(i).classList.remove('hideEnableDirectoryElem');
      }
    }

    document.addEventListener('keydown', (e) => this.keyHandler_(e), false);
    document.addEventListener('keyup', (e) => this.keysHeld_[e.keyCode] = 0);

    this.loadSettings_();
    this.parseParams_();

    getElem('main-menu-button').focus();

    console.log('kthoom initialized');
  }

  /** @private */
  initMenus_() {
    this.mainMenu_ = new Menu(getElem(MENU.MAIN));
    this.openMenu_ = new Menu(getElem(MENU.OPEN));
    this.viewMenu_ = new Menu(getElem(MENU.VIEW));
    this.#viewerContextMenu = new Menu(getElem(MENU.VIEWER_CONTEXT));

    this.mainMenu_.addSubMenu('menu-open', this.openMenu_);
    this.mainMenu_.addSubMenu('menu-view', this.viewMenu_);
    const closeMainMenu = () => {
      if (this.mainMenu_.isOpen()) {
        this.mainMenu_.close();
      }
    };

    this.openMenu_.addEventListener(MenuEventType.ITEM_SELECTED, evt => {
      switch (evt.item.id) {
        case 'menu-open-local-files': this.openLocalFiles_(); closeMainMenu(); break;
        case 'menu-open-directory': this.openLocalDirectory_(); closeMainMenu(); break;
        case 'menu-open-url': this.openFileViaUrl_(); closeMainMenu(); break;
        case GOOGLE_MENU_ITEM_ID: this.openFileViaGoogleDrive_(); closeMainMenu(); break;
        case 'menu-open-ipfs-hash': this.openFileViaIPFS_(); closeMainMenu(); break;
      }
    });

    // Show the Open menu unless the preventUserOpeningBooks parameter is set.
    if (Params['preventUserOpeningBooks'] === 'true') {
      const openMenuButtonEl = getElem('menu-open');
      openMenuButtonEl.style.display = 'none';
      openMenuButtonEl.setAttribute('disabled', 'true');
    }

    this.viewMenu_.addEventListener(MenuEventType.ITEM_SELECTED, evt => {
      const id = evt.item.id;
      switch (id) {
        case 'menu-view-rotate-left': {
            this.bookViewer_.rotateCounterClockwise();
            this.saveSettings_();
            closeMainMenu();
          }
          break;
        case 'menu-view-rotate-right': {
            this.bookViewer_.rotateClockwise();
            this.saveSettings_();
            closeMainMenu();
          }
          break;
        case 'menu-view-one-page': {
            this.bookViewer_.setNumPagesInViewer(1);
            this.viewMenu_.setMenuItemSelected('menu-view-one-page', true);
            this.viewMenu_.setMenuItemSelected('menu-view-two-page', false);
            this.viewMenu_.setMenuItemSelected('menu-view-long-strip', false);
            this.viewMenu_.setMenuItemSelected('menu-view-wide-strip', false);
            this.saveSettings_();
            closeMainMenu();
          }
          break;
        case 'menu-view-two-page': {
            this.bookViewer_.setNumPagesInViewer(2);
            this.viewMenu_.setMenuItemSelected('menu-view-one-page', false);
            this.viewMenu_.setMenuItemSelected('menu-view-two-page', true);
            this.viewMenu_.setMenuItemSelected('menu-view-long-strip', false);
            this.viewMenu_.setMenuItemSelected('menu-view-wide-strip', false);
            this.saveSettings_();
            closeMainMenu();
          }
          break;
        case 'menu-view-long-strip': {
            this.bookViewer_.setNumPagesInViewer(3);
            this.viewMenu_.setMenuItemSelected('menu-view-one-page', false);
            this.viewMenu_.setMenuItemSelected('menu-view-two-page', false);
            this.viewMenu_.setMenuItemSelected('menu-view-long-strip', true);
            this.viewMenu_.setMenuItemSelected('menu-view-wide-strip', false);
            this.saveSettings_();
            closeMainMenu();
          }
          break;
        case 'menu-view-wide-strip': {
            this.bookViewer_.setNumPagesInViewer(4);
            this.viewMenu_.setMenuItemSelected('menu-view-one-page', false);
            this.viewMenu_.setMenuItemSelected('menu-view-two-page', false);
            this.viewMenu_.setMenuItemSelected('menu-view-long-strip', false);
            this.viewMenu_.setMenuItemSelected('menu-view-wide-strip', true);
            this.saveSettings_();
            closeMainMenu();
          }
          break;
        case HIDE_PANEL_BUTTONS_MENU_ITEM: {
            this.#togglePanelButtons();
            closeMainMenu();
          }
          break;
        case 'menu-view-fit-best':
        case 'menu-view-fit-height':
        case 'menu-view-fit-width': {
            const fitMode = (id === 'menu-view-fit-best' ? FitMode.Best :
              id === 'menu-view-fit-height' ? FitMode.Height :
                id === 'menu-view-fit-width' ? FitMode.Width : undefined);
            this.bookViewer_.setFitMode(fitMode);
            this.viewMenu_.setMenuItemSelected('menu-view-fit-best', fitMode === FitMode.Best);
            this.viewMenu_.setMenuItemSelected('menu-view-fit-height', fitMode === FitMode.Height);
            this.viewMenu_.setMenuItemSelected('menu-view-fit-width', fitMode === FitMode.Width);
            this.saveSettings_();
            closeMainMenu();
          }
          break;
      }
    });

    this.mainMenu_.addEventListener(MenuEventType.CLOSE, evt => getElem('main-menu-button').focus());
    this.mainMenu_.addEventListener(MenuEventType.ITEM_SELECTED, evt => {
      switch (evt.item.id) {
        case 'menu-download': this.downloadBook_(); break;
        case 'menu-close-all': this.closeAll_(); break;
        case 'menu-help': this.#toggleHelpOpen(); break;
      }
    });

    // If the browser does not support the File System Access API or this is not a secure context,
    // then use the File input to trigger.
    if (!window.showOpenFilePicker) {
      this.fileInputElem_ = getElem('menu-open-local-files-input');      
      this.fileInputElem_.addEventListener('change', (e) => this.loadLocalFiles_(e));
    }

    getElem('main-menu-button').addEventListener('click', (e) => this.#toggleMenuOpen());

    this.#viewerContextMenu.addEventListener(MenuEventType.ITEM_SELECTED, evt => {
      const pageNum = evt.item.dataset.pagenum;
      switch (evt.item.id) {
        case 'save-page-as-png': this.savePageAs_(pageNum, PNG); break;
        case 'save-page-as-jpg': this.savePageAs_(pageNum, JPG); break;
        case 'save-page-as-webp': this.savePageAs_(pageNum, WEBP); break;
      }
    });

    // TODO: Does this mean the book viewer images have to be focusable for keyboard accessibility?
    const observer = new MutationObserver((mutationRecords) => {
      for (const record of mutationRecords) {
        const newNodes = record.addedNodes;
        for (const newNode of newNodes) {
          newNode.addEventListener('contextmenu', evt => this.onContextMenu_(evt));
        }
      }
    });
    observer.observe(getElem('bvViewport'), { childList: true });
  }

  /** @private */
  initDragDrop_() {
    const swallowEvent = (e) => { e.preventDefault(); e.stopPropagation(); };
    document.addEventListener('dragenter', swallowEvent);
    document.addEventListener('dragexit', swallowEvent);
    document.addEventListener('dragover', swallowEvent);
    document.addEventListener('drop', (e) => {
      swallowEvent(e);
      this.loadLocalFiles_({ target: e.dataTransfer });
    });
  }

  /** @private */
  initClickHandlers_() {
    // TODO: Move this click handler into BookViewer?
    const bookViewerElem = getElem(BOOK_VIEWER_ELEM_ID);
    bookViewerElem.addEventListener('click', (evt) => {
      if (this.readingStack_.isOpen()) {
        this.#toggleReadingStackOpen();
        return;
      }
      if (this.#viewerContextMenu.isOpen()) {
        this.#viewerContextMenu.close();
        return;
      }

      const numPageMode = this.bookViewer_.getNumPagesInViewer();
      // Clicks do nothing in long-strip mode.
      if (numPageMode === 3) {
        return;
      }

      const bvViewport = getElem('bvViewport');
      const firstPageElem = bvViewport.firstElementChild;

      // Two-page viewer mode is simple to figure out what the click means.
      if (this.bookViewer_.getNumPagesInViewer() === 2) {
        if (evt.target.parentElement === firstPageElem) {
          this.showPrevPage();
        } else if (evt.target.parentElement === firstPageElem.nextElementSibling) {
          this.showNextPage();
        }
        return;
      }

      // One-page viewer mode.

      // Calculate where the user clicked in the image.
      const mainContentBbox = firstPageElem.getBoundingClientRect();
      const bookWidth = mainContentBbox.width;
      const bookHeight = mainContentBbox.height;
      const clickX = evt.clientX - mainContentBbox.left;
      const clickY = evt.clientY - mainContentBbox.top;

      // Determine if the user clicked/tapped the left side or the
      // right side of the page.
      let clickedPrev = false;
      switch (this.bookViewer_.getRotateTimes()) {
        case 0: clickedPrev = clickX < (bookWidth / 2); break;
        case 1: clickedPrev = clickY < (bookHeight / 2); break;
        case 2: clickedPrev = clickX > (bookWidth / 2); break;
        case 3: clickedPrev = clickY > (bookHeight / 2); break;
      }
      if (clickedPrev) {
        this.showPrevPage();
      } else {
        this.showNextPage();
      }
    });
    getElem('helpOverlay').addEventListener('click', () => this.#toggleHelpOpen());
  }

  /** @private */
  initOverlays_() {
    if (this.hasHelpOverlay_) {
      if (Params['preventUserOpeningBooks'] === 'true') {
        getElem('help-load-section').style.display = 'none';
      }
    }
  }

  /** @private */
  initNav_() {
    getElem('prevBook').addEventListener('click', () => this.readingStack_.changeToPrevBook());
    getElem('prev').addEventListener('click', () => this.showPrevPage());
    getElem('next').addEventListener('click', () => this.showNextPage());
    getElem('nextBook').addEventListener('click', () => this.readingStack_.changeToNextBook());

    if (document.fullscreenEnabled) {
      const fsButton = getElem('fullScreen');
      fsButton.style.display = '';
      fsButton.addEventListener('click', () => this.#toggleFullscreen());
      document.addEventListener('fullscreenchange', () => this.bookViewer_.updateLayout());
    }
  }

  /** @private */
  initResizeHandler_() {
    window.addEventListener('resize', () => this.bookViewer_.updateLayout());
  }

  /** @private */
  initUnloadHandler_() {
    if (Params['doNotPromptOnClose'] === 'true') {
      return;
    }

    window.addEventListener('beforeunload', (event) => {
      if (this.readingStack_.getNumberOfBooks() > 0) {
        // Cancel the event as stated by the standard.
        event.preventDefault();
        // Chrome requires returnValue to be set.
        event.returnValue = '';
      }
    });
  }

  /** @private */
  initWheelScroll_() {
    window.addEventListener('wheel', (evt) => {
      let target = evt.target;
      while (target && target != window) {
        if (target.id === BOOK_VIEWER_ELEM_ID) {
          // Deliver the wheel event to the Book Viewer to deal with swipes.
          this.bookViewer_.handleSwipeEvent(evt);
          return;
        } else if (target.id === READING_STACK_ELEM_ID) {
          // Do nothing, let the scroll happen on the ReadingStack.
          return;
        }
        target = target.parentElement;
      }
    }, true);
  }

  /**
   * @returns {boolean}
   * @private
   */
  isHelpOpened_() {
    return this.hasHelpOverlay_ && getElem('helpOverlay').classList.contains('opened');
  }

  /** @private */
  async parseParams_() {
    const bookUri = Params['bookUri'];
    const readingListUri = Params['readingListUri'];
    if (readingListUri) {
      try {
        const readingList = await this.tryLoadAndParseReadingListFromUrl_(readingListUri);
        const bookNum = readingList.findIndex(entry => entry.uri === bookUri);
        this.loadBooksFromReadingList_(readingList, bookNum);
        return;
      } catch (err) {
        console.error(err);
      }
    } else if (bookUri) {
      // See https://gist.github.com/lgierth/4b2969583b3c86081a907ef5bd682137 for the
      // eventual migration steps for IPFS addressing.  We will support two versions
      // for now, ipfs://$hash and dweb:/ipfs/$hash.
      if (bookUri.indexOf('ipfs://') === 0) {
        kthoom.ipfs.loadHash(bookUri.substr(7));
      } else if (bookUri.indexOf('dweb:/ipfs/') === 0) {
        kthoom.ipfs.loadHash(bookUri.substr(11));
      } else {
        // Else, we assume it is a URL and use the Fetch API.
        // TODO: Support loading a reading list file here.
        this.loadSingleBookFromFetch(bookUri /** name */, bookUri /** uri */);
      }
    } else {
      // TODO: Eventually get rid of this and just rely on the query params.
      const hashcontent = window.location.hash.substr(1);
      if (hashcontent.lastIndexOf('ipfs', 0) === 0) {
        alert('Do not use the ipfs hash anymore, use the bookUri query parameter!')
        const ipfshash = hashcontent.substr(4);
        kthoom.ipfs.loadHash(ipfshash);
      }
    }
  }

  /** @private */
  loadSettings_() {
    try {
      if (localStorage[LOCAL_STORAGE_KEY].length < 10) return;
      const s = JSON.parse(localStorage[LOCAL_STORAGE_KEY]);
      this.bookViewer_.setRotateTimes(s['rotateTimes']);
      // Obsolete settings:  hflip. vflip.

      const fitMode = s['fitMode'];
      if (fitMode) {
        this.viewMenu_.setMenuItemSelected('menu-view-fit-best', fitMode === FitMode.Best);
        this.viewMenu_.setMenuItemSelected('menu-view-fit-height', fitMode === FitMode.Height);
        this.viewMenu_.setMenuItemSelected('menu-view-fit-width', fitMode === FitMode.Width);

        // We used to store the key code for the mode... check for stale settings.
        switch (fitMode) {
          case Key.B: s['fitMode'] = FitMode.Best; break;
          case Key.H: s['fitMode'] = FitMode.Height; break;
          case Key.W: s['fitMode'] = FitMode.Width; break;
        }
        this.bookViewer_.setFitMode(s['fitMode']);
      }

      const numPagesInViewer = s['numPagesInViewer'];
      if (numPagesInViewer) {
        this.bookViewer_.setNumPagesInViewer(s['numPagesInViewer']);
        const numPagesInViewer = s['numPagesInViewer'];
        if (numPagesInViewer === 1) {
          this.viewMenu_.setMenuItemSelected('menu-view-one-page', true);
          this.viewMenu_.setMenuItemSelected('menu-view-two-page', false);
          this.viewMenu_.setMenuItemSelected('menu-view-long-strip', false);
          this.viewMenu_.setMenuItemSelected('menu-view-wide-strip', false);
        } else if (numPagesInViewer === 2) {
          this.viewMenu_.setMenuItemSelected('menu-view-one-page', false);
          this.viewMenu_.setMenuItemSelected('menu-view-two-page', true);
          this.viewMenu_.setMenuItemSelected('menu-view-long-strip', false);
          this.viewMenu_.setMenuItemSelected('menu-view-wide-strip', false);
        } else if (numPagesInViewer === 3) {
          this.viewMenu_.setMenuItemSelected('menu-view-one-page', false);
          this.viewMenu_.setMenuItemSelected('menu-view-two-page', false);
          this.viewMenu_.setMenuItemSelected('menu-view-long-strip', true);
          this.viewMenu_.setMenuItemSelected('menu-view-wide-strip', false);
        } else if (numPagesInViewer === 4) {
          this.viewMenu_.setMenuItemSelected('menu-view-one-page', false);
          this.viewMenu_.setMenuItemSelected('menu-view-two-page', false);
          this.viewMenu_.setMenuItemSelected('menu-view-long-strip', false);
          this.viewMenu_.setMenuItemSelected('menu-view-wide-strip', true);
        }
      }

      const hidePanelButtons = s['hidePanelButtons'];
      if (hidePanelButtons !== undefined) {
        this.#togglePanelButtons(hidePanelButtons);
      }
    } catch (err) { }
  }

  /**
   * @param {KeyboardEvent} evt
   * @private
   */
  keyHandler_(evt) {
    const code = evt.keyCode;
    if (!this.keysHeld_[code]) this.keysHeld_[code] = 0;
    this.keysHeld_[code]++;

    // If the overlay is shown, the only keystroke we handle is closing it.
    if (this.isHelpOpened_()) {
      this.#toggleHelpOpen();
      return;
    }

    let isMenuOpen = this.mainMenu_.isOpen();
    let isMetadataViewerOpen = this.metadataViewer_.isOpen();
    let isReadingStackOpen = this.readingStack_.isOpen();

    if (isMenuOpen) {
      // If the menu handled the key, then we are done.
      if (this.mainMenu_.handleKeyEvent(evt)) {
        return;
      }
    }

    // If the metadata tray is open, forward all key events to it.
    if (isMetadataViewerOpen) {
      if (this.metadataViewer_.handleKeyEvent(evt)) {
        return;
      }
    }

    // Handle keystrokes that do not depend on whether a book is loaded.
    switch (code) {
      case Key.O: this.openLocalFiles_(); break;
      case Key.D: this.openLocalDirectory_(); break;
      case Key.U: this.openFileViaUrl_(); break;
      case Key.F: this.#toggleFullscreen(); break;
      case Key.G:
        const menuItem = getElem(GOOGLE_MENU_ITEM_ID);
        if (menuItem && menuItem.getAttribute('disabled') !== 'true') {
          this.openFileViaGoogleDrive_();
        }
        break;
      case Key.I: this.openFileViaIPFS_(); break;
      case Key.QUESTION_MARK:
        if (this.hasHelpOverlay_) {
          this.#toggleHelpOpen();
        }
        break;
      case Key.M:
        if (!isMenuOpen) {
          this.mainMenu_.open();
        }
        break;
      case Key.ESCAPE:
        if (isReadingStackOpen) {
          this.#toggleReadingStackOpen();
          isReadingStackOpen = false;
        }
        break;
      case Key.UP:
        if (isReadingStackOpen) {
          this.readingStack_.changeToPrevBook();
          return;
        }
        break;
      case Key.DOWN:
        if (isReadingStackOpen) {
          this.readingStack_.changeToNextBook();
          return;
        }
        break;
      case Key.S:
        // Only open the reading stack if the menu or metadata viewer are not open.
        if (!isMenuOpen && !isMetadataViewerOpen) {
          this.#toggleReadingStackOpen();
          return;
        }
        break;
      case Key.T:
        // Only open the metadata if the menu or reading stack are not open.
        if (this.currentBook_ && !isMenuOpen && !isReadingStackOpen) {
          this.#toggleMetadataViewerOpen();
          return;
        }
        break;
      case Key.P:
        this.#togglePanelButtons();
        break;
    }

    // All other key strokes below this are only valid if the menu and trays are closed.
    if (isReadingStackOpen) {
      this.#toggleReadingStackOpen();
      return;
    }

    if (isMetadataViewerOpen) {
      this.#toggleMetadataViewerOpen();
      return;
    }

    if (evt.ctrlKey || evt.metaKey) return;

    if (getComputedStyle(getElem('progress')).display == 'none') return;

    switch (code) {
      case Key.LEFT:
        evt.preventDefault();
        evt.stopPropagation();
        if (evt.shiftKey) {
          this.bookViewer_.showPage(0);
        } else {
          this.showPrevPage();
        }
        break;
      case Key.RIGHT:
        evt.preventDefault();
        evt.stopPropagation();
        if (evt.shiftKey) {
          this.bookViewer_.showPage(this.currentBook_.getNumberOfPages() - 1);
        } else {
          this.showNextPage();
        }
        break;
      case Key.LEFT_SQUARE_BRACKET:
        this.readingStack_.changeToPrevBook();
        break;
      case Key.RIGHT_SQUARE_BRACKET:
        this.readingStack_.changeToNextBook();
        break;
      case Key.L:
        this.bookViewer_.rotateCounterClockwise();
        this.saveSettings_();
        break;
      case Key.R:
        this.bookViewer_.rotateClockwise();
        this.saveSettings_();
        break;
      case Key.W: case Key.H: case Key.B:
        const fitMode =
          code === Key.W ? FitMode.Width :
            code === Key.H ? FitMode.Height :
              code === Key.B ? FitMode.Best : undefined;
        this.bookViewer_.setFitMode(fitMode);
        this.viewMenu_.setMenuItemSelected('menu-view-fit-best', fitMode === FitMode.Best);
        this.viewMenu_.setMenuItemSelected('menu-view-fit-height', fitMode === FitMode.Height);
        this.viewMenu_.setMenuItemSelected('menu-view-fit-width', fitMode === FitMode.Width);
        this.saveSettings_();
        break;
      case Key.NUM_1: case Key.NUM_2: case Key.NUM_3: case Key.NUM_4:
        const numPages = code - Key.NUM_1 + 1;
        this.bookViewer_.setNumPagesInViewer(numPages);
        if (numPages === 1) {
          this.viewMenu_.setMenuItemSelected('menu-view-one-page', true);
          this.viewMenu_.setMenuItemSelected('menu-view-two-page', false);
          this.viewMenu_.setMenuItemSelected('menu-view-long-strip', false);
          this.viewMenu_.setMenuItemSelected('menu-view-wide-strip', false);
        } else if (numPages === 2) {
          this.viewMenu_.setMenuItemSelected('menu-view-one-page', false);
          this.viewMenu_.setMenuItemSelected('menu-view-two-page', true);
          this.viewMenu_.setMenuItemSelected('menu-view-long-strip', false);
          this.viewMenu_.setMenuItemSelected('menu-view-wide-strip', false);
        } else if (numPages === 3) {
          this.viewMenu_.setMenuItemSelected('menu-view-one-page', false);
          this.viewMenu_.setMenuItemSelected('menu-view-two-page', false);
          this.viewMenu_.setMenuItemSelected('menu-view-long-strip', true);
          this.viewMenu_.setMenuItemSelected('menu-view-wide-strip', false);
        } else {
          this.viewMenu_.setMenuItemSelected('menu-view-one-page', false);
          this.viewMenu_.setMenuItemSelected('menu-view-two-page', false);
          this.viewMenu_.setMenuItemSelected('menu-view-long-strip', false);
          this.viewMenu_.setMenuItemSelected('menu-view-wide-strip', true);
        }
        this.saveSettings_();
        break;
      default:
        break;
    }
  }

  /**
   * TODO: How can this menu be accessible on mobile?
   * @param {Event} evt
   * @private
   */
  onContextMenu_(evt) {
    if (!this.currentBook_) { return; }

    evt.preventDefault();

    const pageNum = parseInt(evt.target.parentElement.dataset.pagenum, 10);
    const thisPage = this.currentBook_.getPage(pageNum);
    const mimeType = thisPage.getMimeType();
    const menu = this.#viewerContextMenu;
    menu.showMenuItem('save-page-as-png', [PNG, WEBP].includes(mimeType));
    menu.showMenuItem('save-page-as-jpg', [JPG, WEBP].includes(mimeType));
    menu.showMenuItem('save-page-as-webp', [WEBP].includes(mimeType));
    getElem('save-page-as-png').dataset.pagenum = pageNum;
    getElem('save-page-as-jpg').dataset.pagenum = pageNum;
    getElem('save-page-as-webp').dataset.pagenum = pageNum;
    menu.open(evt.offsetX, evt.offsetY);
  }

  /**
   * @param {number} pageNum
   * @param {string} saveMimeType
   */
  savePageAs_(pageNum, saveMimeType) {
    assert(!!this.currentBook_, `Current book not set in savePageAs_()`);
    const page = this.currentBook_.getPage(pageNum);
    assert(page instanceof ImagePage || page instanceof WebPShimImagePage, `Page not an image`);
    const pageName = page.getPageName();

    const saveFile = (defaultFilename, uri) => {
      const filename = prompt('Filename?', defaultFilename);
      if (!filename) { return; }
      const aEl = document.createElement('a');
      aEl.setAttribute('download', filename);
      aEl.setAttribute('href', uri);
      document.body.appendChild(aEl);
      aEl.click();
      document.body.removeChild(aEl);
    };

    const curMimeType = page.getMimeType();
    if (curMimeType === saveMimeType) {
      saveFile(pageName, page.getURI());
    } else if (curMimeType === WEBP) {
      if (saveMimeType === PNG) {
        fetch(page.getURI())
          .then(blob => blob.arrayBuffer())
          .then(ab => convertWebPtoPNG(ab))
          .then(pngBuffer => new Blob([pngBuffer], { type: PNG }))
          .then(pngBlob => saveFile(pageName, URL.createObjectURL(pngBlob)));
      } else if (saveMimeType === JPG) {
        fetch(page.getURI())
          .then(blob => blob.arrayBuffer())
          .then(ab => convertWebPtoJPG(ab))
          .then(jpgBuffer => new Blob([jpgBuffer], { type: JPG }))
          .then(jpgBlob => saveFile(pageName, URL.createObjectURL(jpgBlob)));
      }
    }
  }

  /** @private */
  saveSettings_() {
    localStorage[LOCAL_STORAGE_KEY] = JSON.stringify({
      'rotateTimes': this.bookViewer_.getRotateTimes(),
      'fitMode': this.bookViewer_.getFitMode(),
      'numPagesInViewer': this.bookViewer_.getNumPagesInViewer(),
      'hidePanelButtons': this.viewMenu_.getMenuItemSelected(HIDE_PANEL_BUTTONS_MENU_ITEM),
    });
  }

  updateProgressMeter(label) {
    this.bookViewer_.updateProgressMeter(label);
  }

  /**
   * Attempts to load a ReadingList from a given URL.
   * TODO: Move this to a separate module for processing JSON Reading Lists?
   * @param {string} url The URL of the file.
   * @returns {Promise<Array<Object>} A Promise that returns with the list of books or rejects
   *     with an error string.
   */
  tryLoadAndParseReadingListFromUrl_(url) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'blob';
      xhr.onload = (evt) => {
        resolve(this.loadAndParseReadingList_(evt.target.response, url));
      };
      xhr.onerror = (err) => {
        console.error(err);
        reject(err);
      }
      xhr.send(null);
    });
  }

  showPrevPage() {
    const turnedPage = this.bookViewer_.showPrevPage();
    // TODO(long-strip): Move this into BookViewer.updateLayout() ?
    // Only place at top if the viewer is not in long-strip mode.
    if (this.bookViewer_.getFitMode() === FitMode.Width &&
        this.bookViewer_.getNumPagesInViewer() < 3) {
      window.scrollTo(0, 0);
    }
    if (!turnedPage) {
      if (this.readingStack_.getNumberOfBooks() == 1) {
        this.bookViewer_.showPage(this.currentBook_.getNumberOfPages() - 1);
      } else {
        if (this.keysHeld_[Key.LEFT] <= 1) {
          this.readingStack_.changeToPrevBook();
        }
      }
    }
  }

  showNextPage() {
    const turnedPage = this.bookViewer_.showNextPage();
    // TODO(long-strip): Move this into BookViewer.updateLayout() ?
    // Only place at top if the viewer is not in long-strip mode.
    if (this.bookViewer_.getFitMode() === FitMode.Width &&
        this.bookViewer_.getNumPagesInViewer() < 3) {
      window.scrollTo(0, 0);
    }
    if (!turnedPage) {
      if (this.readingStack_.getNumberOfBooks() == 1) {
        this.bookViewer_.showPage(0);
      } else {
        if (this.keysHeld_[Key.RIGHT] <= 1) {
          this.readingStack_.changeToNextBook();
        }
      }
    }
  }

  /**
   * Finds a more readable display name for a book from a JSON Reading List.
   * TODO: Move this to a separate module for processing JSON Reading Lists?
   * @param {Object} item An item object from the JSON Reading List format.
   * @returns {string}
   */
  getNameForBook_(item) {
    return item.name || item.uri.split('/').pop() || item.uri;
  }

  /**
   * Loads books into the reading stack, in serial.
   * @param {Array<Promise<Book>} bookPromises A list of promises, each of which will resolve to a
   *     book or error.
   */
  async loadBooksFromPromises_(bookPromises) {
    const books = [];
    let foundError = false;
    for (const bookPromise of bookPromises) {
      try {
        const book = await bookPromise;
        books.push(book);
      } catch (err) {
        foundError = true;
      }
    }

    if (foundError) {
      alert('Could not open all books. See the console for more info.');
    }
  }

  /**
   * Opens a file picker and then loads the file(s).
   * @private
   */
  async openLocalFiles_() {
    if (Params['preventUserOpeningBooks'] === 'true') {
      return;
    }

    // Non-Chrome browsers and non-secure contexts will not have this picker.
    if (!window.showOpenFilePicker) {
      // The 'change' event handler was set up in initMenus_().
      this.fileInputElem_.click();
    } else {
      const evt = { handles: [], target: { files: [] }};
      try {
        const handles = await window.showOpenFilePicker({
          multiple: true,
          types: [
            {
              description: 'kthoom book files',
              accept: {
                'application/vnd.comicbook+zip': ['.cbz'],
                'application/vnd.comicbook-rar': ['.cbr'],
                'application/x-cbt': ['.cbt'],
                'application/x-json.reading.lists': ['.jrl'],
                'application/epub+zip': ['.epub'],
              }
            },
          ],
        });
        for (const handle of handles) {
          evt.handles.push(handle);
          evt.target.files.push(await handle.getFile());
        }
        this.loadLocalFiles_(evt);
      } catch (err) {
        // Ignore DOM Exception for user aborting.
      }
    }
  }

  /**
   * Attempts to load the files that the user has chosen.
   * @param {Event} evt An event whose 'target' object has a files property pointing to an array
   *     of File objects. If the File System Access API is supported, the event will also have a
   *     'handles' property pointing at an array of FileSystemHandle objects.
   * @private
   */
  async loadLocalFiles_(evt) {
    const filelist = evt.target.files;
    if (filelist.length <= 0) {
      return;
    }

    if (evt.handles) {
      assert(evt.handles.length === filelist.length,
          `Handles array not the same length as Files array.`);
    }

    for (let fileNum = 0; fileNum < filelist.length; ++fileNum) {
      const theFile = filelist[fileNum];
      // First, try to load the file as a JSON Reading List.
      if (theFile.name.toLowerCase().endsWith('.jrl')) {
        try {
          const readingList = await this.loadAndParseReadingList_(theFile);
          this.loadBooksFromReadingList_(readingList);
          continue;
        } catch { }
      }

      // Else, assume the file is a single book and try to load the first one.
      const handleOrFile = evt.handles ? evt.handles[fileNum] : theFile;
      const singleBook = new Book(theFile.name, handleOrFile);
      // If we have no books open, then always switch to the first one.
      if (this.readingStack_.getNumberOfBooks() === 0) {
        this.loadBooksFromPromises_([singleBook.load()]);
        this.readingStack_.addBook(singleBook, true);
      } else {
        // If it was only one book, then switch to it, even if the reading stack is populated.
        this.readingStack_.addBook(singleBook, filelist.length === 1);
      }
    }
  }

  /** Attempts to open all the files recursively? */
  async openLocalDirectory_() {
    if (Params['preventUserOpeningBooks'] === 'true') {
      return;
    }
    if (!enableOpenDirectory) {
      return;
    }

    const dirHandle = await window.showDirectoryPicker();
    const topContainer = new BookContainer(dirHandle.name, dirHandle);
    await this.scanDir_(topContainer);

    // Now topContainer has the entire file system: all comic books and all their
    // containing folders...
    this.readingStack_.addFolder(topContainer);
  }

  /**
   * @param {BookContainer} container The current container.
   * @private
   */
  async scanDir_(container) {
    for await (let [name, handle] of container.handle.entries()) {
      if (handle.kind === 'file' &&
         (name.endsWith('.cbz') || name.endsWith('.cbr') || name.endsWith('.cbt'))) {
        const singleBook = new Book(name, handle, container);
        container.entries.push(singleBook);
      } else if (handle.kind === 'directory') {
        const dirContainer = new BookContainer(name, handle, container);
        container.entries.push(dirContainer);
        await this.scanDir_(dirContainer);
      }
    }
  }

  /**
   * Asks the user for a URL to load and then loads it.
   */
  async openFileViaUrl_() {
    if (Params['preventUserOpeningBooks'] === 'true') {
      return;
    }

    const bookUrl = window.prompt('Enter the URL of the book to load');
    if (bookUrl) {
      if (bookUrl.toLowerCase().endsWith('.jrl')) {
        try {
          const readingList = await this.tryLoadAndParseReadingListFromUrl_(bookUrl);
          this.loadBooksFromReadingList_(readingList);
          return;
        } catch (err) {
          console.error(err);
        }
      }

      this.loadSingleBookFromFetch(bookUrl /** name */, bookUrl /** uri */);
    }
  }

  /** @private */
  openFileViaGoogleDrive_() {
    if (Params['preventUserOpeningBooks'] === 'true') {
      return;
    }

    kthoom.google.doDrive();
  }

  /** @private */
  openFileViaIPFS_() {
    if (Params['preventUserOpeningBooks'] === 'true') {
      return;
    }

    kthoom.ipfs.ipfsHashWindow();
  }

  /**
   * Closes all open files.
   */
  closeAll_() {
    if (this.readingStack_.getNumberOfBooks() > 0) {
      this.readingStack_.removeAll();
      this.metadataViewer_.reset();

      this.bookViewer_.closeBook();
      this.currentBook_ = null;
      const bkgndEl = getElem('background');
      if (bkgndEl) {
        bkgndEl.setAttribute('style', 'background-image: url("images/logo.svg")');
      }
      for (const button of ['prevBook', 'prev', 'next', 'nextBook'].map(getElem)) {
        button.setAttribute('disabled', 'true');
      }

      // Disable menu items that are not relevant when no book is opened.
      this.mainMenu_.showMenuItem('menu-download', false);
      this.mainMenu_.showMenuItem('menu-close-all', false);
    }
  }

  /** @private */
  downloadBook_() {
    const ab = this.currentBook_.getArrayBuffer();
    if (!ab) {
      alert('Could not download a copy of the book. Sorry!');
      return;
    }

    const blob = new Blob([ab], {type: this.currentBook_.getMIMEType()});
    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    const fileName = this.currentBook_.getFilename();
    link.download = fileName;
    link.click();
  }

  /**
   * Fetches a book over the network using a XMLHttpRequest GET request.
   * Use loadSingleBookFromFetch() instead.
   * @param {string} name The book name.
   * @param {string} uri The URI to fetch.
   * @param {number} expectedSize Size of book file in bytes. If -1, then the data from the XHR
   *     progress events is used.
   * @param {Object<string, string>} headerMap A map of request header keys and values.
   * @param {boolean=} preventSwitchingToBook Set to true to avoid switching the viewer to the
   *     new book. Default behavior is that the reading stack and viewer will switch to the book
   *     once it is loaded.
   * @returns {Promise<Book>}
   * @deprecated Use loadSingleBookFromFetch() instead.
   */
  loadSingleBookFromXHR(name, uri, expectedSize, headerMap = {}, preventSwitchingToBook = false) {
    const book = new Book(name, uri, undefined /** bookContainer */, expectedSize);
    const bookPromise = book.loadFromXhr(headerMap);
    this.readingStack_.addBook(book, !preventSwitchingToBook);
    return bookPromise;
  }

  /**
   * Fetches a book over the network using the Fetch API.
   * @param {string} name The book name.
   * @param {string} uri The resource to fetch.
   * @param {Object} init An object to initialize the Fetch API. See options at
   *     https://developer.mozilla.org/en-US/docs/Web/API/Request/Request.
   * @param {number} expectedSize Size of book file in bytes. If -1, then this affects the kthoom
   *     progress bar.
   * @param {boolean=} preventSwitchingToBook Set to true to avoid switching the viewer to the
   *     new book. Default behavior is that the reading stack and viewer will switch to the book
   *     once it is loaded.
   * @returns {Promise<Book>}
   */
  loadSingleBookFromFetch(name, uri, init = {}, expectedSize = -1, preventSwitchingToBook = false) {
    if (!window['fetch'] || !window['Response'] || !window['ReadableStream']) {
      throw 'No browser support for fetch/ReadableStream';
    }

    const request = new Request(uri, init);
    const book = new Book(name, request, undefined /** bookContainer */, expectedSize);
    const bookPromise = book.loadFromFetch();
    this.readingStack_.addBook(book, !preventSwitchingToBook);
    return bookPromise;
  }

  /**
   * Loads a book from an ArrayBuffer.
   * @param {string} name
   * @param {string} bookUri
   * @param {ArrayBuffer} ab
   * @param {boolean=} preventSwitchingToBook Set to true to avoid switching the viewer to the
   *     new book. Default behavior is that the reading stack and viewer will switch to the book
   *     once it is loaded.
   * @returns {Promise<Book>}
   */
  loadSingleBookFromArrayBuffer(name, bookUri, ab, preventSwitchingToBook = false) {
    const book = new Book(name);
    const bookPromise = book.loadFromArrayBuffer(bookUri, ab);
    this.readingStack_.addBook(book, !preventSwitchingToBook);
    return bookPromise;
  }

  /**
   * Loads a book from a BookPump.
   * @param {string} name
   * @param {string} bookUri
   * @param {BookPump} bookPump
   * @param {boolean=} preventSwitchingToBook Set to true to avoid switching the viewer to the
   *     new book. Default behavior is that the reading stack and viewer will switch to the book
   *     once it is loaded.
   * @returns {Promise<Book>}
   */
  loadSingleBookFromBookPump(name, bookUri, bookPump, preventSwitchingToBook = false) {
    const book = new Book(name);
    const bookPromise = book.loadFromBookPump(bookUri, bookPump);
    this.readingStack_.addBook(book, !preventSwitchingToBook);
    return bookPromise;
  }

  // TODO(kthoom): Add loadSingleBookFromReadableStream()?

  /**
   * Loads the Reading List from the JSON blob.  The blob must contain a JSON Reading List that
   * matches this minimum format:
   * {
   *   "items": [
   *     {"type": "book", "uri": "http://foo/bar"},
   *     ...
   *   ]
   * }
   * There may be a "baseURI" property, which will be used to resolve URI references.
   * Each item may also contain an optional name field.  See jrl-schema.json for the full schema.
   * TODO: Move this to a separate module for processing JSON Reading Lists?
   * @param {Blob|File} jsonBlob The JSON blob/file.
   * @param {string=} readingListUri Optional URI of the reading list file.
   * @returns {Promise<Array<Object>>} Returns a Promise that will resolve with an array of item
   *     objects (see format above), or rejects with an error string.
   * @private
   */
  loadAndParseReadingList_(jsonBlob, readingListUri) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        try {
          const jsonContents = JSON.parse(fr.result);
          if (!jsonContents.items || !Array.isArray(jsonContents.items) ||
            jsonContents.items.length === 0) {
            reject(null);
          } else {
            // Set baseURI to the JRL file's baseURI if it exists, otherwise use the reading list's
            // base URI if it exists, otherwise fallback to kthoom's base URL (which is not
            // standardized behavior).
            let baseURI;
            if (jsonContents.baseURI) {
              baseURI = new URI(jsonContents.baseURI).origin;
            } else if (readingListUri) {
              try {
                const rlURL = new URL(readingListUri);
                baseURI = rlURL.origin;
              } catch (e) {
                baseURI = document.location.origin;
              }
            } else {
              // Fallback to using kthoom's base URL.
              baseURI = document.location.origin;
            }

            for (const item of jsonContents.items) {
              // Each item object must at least have a uri string field and be type=book.
              if (!(item instanceof Object) ||
                !item.uri || !(typeof item.uri === 'string') ||
                !item.type || item.type !== 'book') {
                console.error('Invalid item: ');
                console.dir(item);
                reject('Invalid item inside JSON Reading List file');
              }

              // Now resolve each item URI.  First try to parse it as an absolute URI.  If that
              // fails, try it as a URI reference with the base URI.  If that fails, reject.
              let itemURL;
              try {
                itemURL = new URL(item.uri);
              } catch (e) {
                try {
                  itemURL = new URL(item.uri, baseURI);
                } catch (e) { reject(e); }
              }

              // Rewrite each item's URL as an absolute URL.
              item.uri = itemURL.toString();
            }
            resolve(jsonContents.items);
          }
        } catch (err) {
          reject('Invalid JSON Reading List file: ' + err);
        }
      };
      fr.onerror = () => reject(null);
      fr.readAsText(jsonBlob);
    });
  }

  /**
   * Adds all books in reading list to the stack and loads in each book in serial.
   * @param {Array<Object>} readingList An array of reading list items.
   * @param {Number} bookNumber The book number to load.  If bookNumber is invalid or not
   *     specified, this defaults to the first book.
   * @private
   */
  async loadBooksFromReadingList_(readingList, bookNumber = 0) {
    if (readingList && readingList.length > 0) {
      const books = readingList.map(item => new Book(this.getNameForBook_(item), item.uri));
      if (bookNumber < 0 || bookNumber > books.length - 1) {
        bookNumber = 0;
      }

      // Add all books to the stack immediately.
      this.readingStack_.addBooks(books, bookNumber);

      // The remaining books will be loaded from the ReadingStack when the user chooses a different book.
    }
  }

  /**
   * @param {Book[]} books
   * @private
   */
  loadMultipleBooks_(books) {
    this.readingStack_.addBooks(books, 0);
  }

  // Handles all events subscribed to.
  handleEvent(evt) {
    switch (evt.type) {
      case BookEventType.BINDING_COMPLETE:
        /** @type {Book} */
        const book = evt.source;
        this.metadataViewer_.setBook(book);
        break;
    }
  }

  /**
   * If we get a message from the host window, act on it.
   * @param {Event} evt 
   */
  #handleHostMessage(evt) {
    const message = evt.data;

    // Skips invalid BookFetchSpec objects.
    if (message.type === KthoomMessageTypes.LOAD_BOOKS) {
      const books = message.bookFetchSpecs
          .filter(bfs => {
            if (!bfs.url) console.error(`BookFetchSpec.url missing`);
            if (!bfs.method) console.error(`BookFetchSpec.method missing`);
            const validSpec = !!bfs.url && !!bfs.method;
            if (!validSpec) {
              console.error(JSON.stringify(bfs));
            }
            return validSpec;
          })
          .map(bfs => new Book(bfs.name, new Request(bfs.url, {
            body: bfs.body || undefined,
            method: bfs.method,
          })));
      this.loadMultipleBooks_(books);
    }
  }

  /**
   * @param {Book} book If null, kthoom closes all books and resets state.
   * @private
   */
  handleCurrentBookChanged_(book) {
    if (!book) {
      this.closeAll_();
      return;
    }

    if (book !== this.currentBook_) {
      this.bookViewer_.closeBook();
      // Download menu option is not available until the book is fully downloaded.
      this.mainMenu_.showMenuItem('menu-download', false);

      // hide logo
      const bkgndEl = getElem('background');
      if (bkgndEl) {
        bkgndEl.setAttribute('style', 'display:none');
      }

      this.currentBook_ = book;

      this.bookViewer_.setCurrentBook(book);
      if (!book.isFinishedBinding()) {
        book.addEventListener(BookEventType.BINDING_COMPLETE, this);
      } else {
        this.metadataViewer_.setBook(book);
      }

      document.title = book.getName();
      const bookUri = book.getUri();
      if (bookUri && Params.bookUri !== bookUri) {
        Params.bookUri = bookUri;
      }
      serializeParamsToBrowser();
      for (const button of ['prevBook', 'prev', 'next', 'nextBook'].map(getElem)) {
        button.removeAttribute('disabled');
      }
    }

    // Enable menu items that are relevant when a book is switched to.
    this.mainMenu_.showMenuItem('menu-close-all', true);
  }

  #toggleFullscreen() {
    if (document.fullscreenEnabled) {
      const fsPromise = document.fullscreenElement ?
        document.exitFullscreen() :
        document.documentElement.requestFullscreen();
      fsPromise
          .then(() => this.bookViewer_.updateLayout())
          .catch(err => {
            debugger;
          })

    }
  }

  #toggleHelpOpen() {
    if (this.hasHelpOverlay_) {
      getElem('helpOverlay').classList.toggle('opened');
    }
  }

  #toggleMenuOpen() {
    if (!this.mainMenu_.isOpen()) {
      getElem('main-menu-button').setAttribute('aria-expanded', 'true');
      this.mainMenu_.open();
    } else {
      getElem('main-menu-button').setAttribute('aria-expanded', 'false');
      this.mainMenu_.close();
    }
  }

  #toggleMetadataViewerOpen() {
    this.metadataViewer_.toggleOpen();
  }

  /**
   * Toggles whether panel buttons are visible and updates settings.
   * @param {boolean=} force Use this to force panel buttons and UI into a state. This is used when
   *     loading in settings from storage.
   */
   #togglePanelButtons(force) {
    let hide = !this.viewMenu_.getMenuItemSelected(HIDE_PANEL_BUTTONS_MENU_ITEM);
    if (force !== undefined) {
      hide = force;
    }
    this.readingStack_.showButton(!hide);
    this.metadataViewer_.showButton(!hide);
    this.viewMenu_.setMenuItemSelected(HIDE_PANEL_BUTTONS_MENU_ITEM, hide);
    this.saveSettings_();
  }

  #toggleReadingStackOpen() {
    this.readingStack_.toggleOpen();
  }
}
