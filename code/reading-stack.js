/**
 * reading-stack.js
 *
 * Licensed under the MIT License
 *
 * Copyright(c) 2018 Google Inc.
 */
import { getElem, Params } from './common/helpers.js';
import { Book, BookContainer } from './book.js';
import { BookEventType } from './book-events.js';

// TODO: Have the ReadingStack display progress bars in the pane as books load and unarchive.

/**
 * The ReadingStack is responsible for displaying information about the current
 * set of books the user has in their stack as well as the book they are
 * currently reading.  It also provides methods to add, remove and get a book.
 */
export class ReadingStack {
  constructor() {
    /** @type {Array<Book>} */
    this.books_ = [];

    /** @type {number} */
    this.currentBookNum_ = -1;

    /**
     * A list of callbacks that are called when the book is changed to in the stack.
     * @type {Array<Function>}
     * @private
     */
    this.currentBookChangedCallbacks_ = [];

    /**
     * A list of callbacks that are called when the book has loaded after being changed in the stack.
     * @type {Array<Function>}
     * @private
     */
    this.currentBookLoadedCallbacks_ = [];

    /**
     * Holds whether this folder is collapsed or not.
     * @type {Map<BookContainer, boolean>}
     * @private
     */
    this.folderCollapsedMap_ = new Map();

    getElem('readingStackButton').addEventListener('click', () => this.toggleOpen());
    getElem('readingStackOverlay').addEventListener('click', () => this.toggleOpen());
  }

  /** @returns {number} The number of books in the stack. */
  getNumberOfBooks() { return this.books_.length; }

  /** @returns {number} The current book number, zero-based. */
  getCurrentBook() {
    return this.currentBookNum_ != -1 ? this.books_[this.currentBookNum_] : null;
  }

  /**
   * @param {number} i The book to get, zero-based.
   * @returns {Book} The Book, or null, if i was invalid.
   */
  getBook(i) {
    if (i < 0 || i >= this.books_.length) return null;
    return this.books_[i];
  }

  /**
   * Always changes to the newly added book.
   * @param {Book} book
   * @param {boolean} switchToThisBook Whether to switch to this book.
   */
  addBook(book, switchToThisBook = false) {
    this.books_.push(book);
    book.addEventListener(BookEventType.LOADING_STARTED, this);
    if (switchToThisBook) {
      this.changeToBook_(this.books_.length - 1);
    } else {
      // changeToBook_() will call renderStack_() if it has not been rendered yet.
      this.renderStack_();
    }
  }

  /**
   * @param {Array<Book>} books
   * @param {Number} bookNumber The book within the books array to load.
   */
  addBooks(books, bookNumber = 0) {
    if (books.length > 0) {
      const newCurrentBook = this.books_.length;
      for (const book of books) {
        this.books_.push(book);
        book.addEventListener(BookEventType.LOADING_STARTED, this);
      }
      if (bookNumber < 0 || bookNumber >= this.books_.length) {
        bookNumber = 0;
      }
      this.changeToBook_(newCurrentBook + bookNumber);
      this.renderStack_();
    }
  }

  /**
   * @param {BookContainer} folder
   * @param {boolean} recursing Whether this is a recursive call.
   */
  addFolder(folder, recursing = false) {
    let sortedEntries = folder.entries.slice(0);
    sortedEntries.sort((a, b) => {
      return a.getName() < b.getName() ? -1 : 1;
    });
    for (const entry of sortedEntries) {
      if (entry instanceof BookContainer) {
        this.addFolder(entry, true);
      } else {
        if (this.books_.length === 0) {
          this.addBook(entry, true);
        } else {
          this.books_.push(entry);
          entry.addEventListener(BookEventType.LOADING_STARTED, this);
        }
      }
    }
    if (!recursing) {
      this.renderStack_();
    }
  }

  /**
   * Removes all books, resets the internal state, and re-renders.
   * Does not remove the current book change callback.
   */
  removeAll() {
    for (const book of this.books_) {
      book.removeEventListener(BookEventType.LOADING_STARTED, this);
    }
    this.books_ = [];
    this.folderCollapsedMap_.clear();
    this.currentBookNum_ = -1;
    this.renderStack_();
  }

  /** @param {number} i */
  removeBook(i) {
    // If removing the last book, signal that kthoom should close and reset state.
    if (this.books_.length === 1) {
      this.changeToBook_(-1);
      return;
    }

    if (i < this.books_.length) {
      this.books_[i].removeEventListener(BookEventType.LOADING_STARTED, this);
      this.books_.splice(i, 1);

      // If we are removing the book we are on, pick a new current book.
      if (i === this.currentBookNum_) {
        // Default to going to the next book unless we were on the last book
        // (in which case you go to the previous book).
        if (i >= this.books_.length) {
          i = this.books_.length - 1;
        }

        this.currentBookNum_ = -1;
        this.changeToBook_(i);
        this.renderStack_();
      } else {
        // Might have to update the current book number if the book removed
        // was above the current one.
        if (i < this.currentBookNum_) {
          this.currentBookNum_--;
        }
        this.renderStack_();
      }
    }
  }

  /** @param {boolean} show */
  showButton(show) {
    getElem('readingStackButton').classList.toggle('hidden', !show);
  }

  whenCurrentBookChanged(callback) {
    this.currentBookChangedCallbacks_.push(callback);
  }

  /**
   * Subscribe to the ReadingStack to know when the book has been loaded.
   * @param {function} callback A callback function that will receive the book.
   */
  whenCurrentBookHasLoaded(callback) {
    this.currentBookLoadedCallbacks_.push(callback);
  }

  /** @returns {boolean} */
  isOpen() {
    return getElem('readingStack').classList.contains('opened');
  }

  changeToPrevBook() {
    if (this.currentBookNum_ > 0) {
      this.changeToBook_(this.currentBookNum_ - 1);
    }
  }

  changeToNextBook() {
    if (this.currentBookNum_ < this.books_.length - 1) {
      this.changeToBook_(this.currentBookNum_ + 1);
    }
  }

  /**
   * @param {number} i If -1, then it signals kthoom to close all books and reset state.
   * @private
   */
  changeToBook_(i) {
    if (i === -1) {
      this.currentBookNum_ = i;
      for (const callback of this.currentBookChangedCallbacks_) {
        callback(null);
      }
      return;
    }

    if (i >= 0 && i < this.books_.length && this.currentBookNum_ != i) {
      this.currentBookNum_ = i;
      const book = this.books_[i];
      if (book.needsLoading()) {
        book.load();
      }

      for (const callback of this.currentBookChangedCallbacks_) {
        callback(book);
      }

      if (this.currentBookChangedCallbacks_.length > 0) {
        if (book.isFinishedLoading()) {
          this.currentBookLoadedCallbacks_.forEach(callback => callback(book));
        } else {
          book.addEventListener(BookEventType.LOADING_COMPLETE, this);
        }
      }

      // Instead of completely re-rendering, just update the currently selected book, if we
      // already have a DOM.
      const contents = getElem('readingStackContents');
      const currentlySelectedBookDiv = contents.querySelector('div.readingStackBook.current');
      if (currentlySelectedBookDiv) {
        currentlySelectedBookDiv.classList.remove('current');
        const newCurrentBookDiv = contents.querySelector(`div.readingStackBook[data-index="${i}"]`);
        if (newCurrentBookDiv) {
          newCurrentBookDiv.classList.add('current');
        } else {
          // If we did not have a div for this book, that means it was new and we should
          // completely re-render.
          this.renderStack_();
        }
      } else {
        // Else, re-render everything to update selected highlight.
        this.renderStack_();
      }

      if (this.isOpen()) {
        this.toggleOpen();
      }
    }
  }

  /** @param {BookEvent} evt */
  handleEvent(evt) {
    const book = /** @type {Book} */ evt.source;
    switch (evt.type) {
      case BookEventType.LOADING_STARTED:
        book.removeEventListener(BookEventType.LOADING_STARTED, this);
        this.renderStack_();
        break;
      case BookEventType.LOADING_COMPLETE:
        book.removeEventListener(BookEventType.LOADING_COMPLETE, this);
        this.currentBookLoadedCallbacks_.forEach(callback => callback(book));
        break;
    }
  }

  /** Toggles the reading stack open or closed. */
  toggleOpen() {
    getElem('readingStack').classList.toggle('opened');
    getElem('readingStackOverlay').classList.toggle('hidden');

    if (this.isOpen()) {
      const bookElems = getElem('readingStack').querySelectorAll('.readingStackBook');
      if (bookElems.length > 0) {
        bookElems.item(0).focus();
      }
    }
  }

  /**
   * Toggles an individual folder expanded or collapsed. Updates the collapse
   * map to remember which folders have been collapsed.
   * @param {HTMLDivElement} folderDiv
   * @param {BookContainer} folder
   * @private
   */
  toggleFolderExpandCollapse_(folderDiv, folder) {
    folderDiv.classList.toggle('collapsed');
    this.folderCollapsedMap_.set(folder, folderDiv.classList.contains('collapsed'));
  }

  // TODO: Do this better so that each change of state doesn't require a complete re-render?
  /** @private */
  renderStack_() {
    const renderedContainerMap = new Map();
    const libDiv = getElem('readingStackContents');
    // Clear out the current reading stack HTML divs.
    libDiv.innerHTML = '';
    const topDiv = document.createElement('div');
    // TODO: Do this out of the rendering thread and send ~200 books at a time into the DOM.
    if (this.books_.length > 0) {
      for (let i = 0; i < this.books_.length; ++i) {
        let curDiv = topDiv;
        let indentLevel = 0;
        const book = this.books_[i];

        // If this book's containers have not been rendered yet, go up the ancestry and render
        // all its unrendered containers in order.
        if (book.getContainer()) {
          let ancestors = [];

          // Find all ancestors and the indent-level of the book.
          let cur = book.getContainer();
          while (cur) {
            ancestors.push(cur);
            cur = cur.getContainer();
          }
          indentLevel = ancestors.length;

          // Now, in reverse order, render the ancestors.
          for (let i = ancestors.length - 1; i >= 0; --i) {
            const ancestor = ancestors[i];
            // Only render containers that haven't already been rendered.
            if (!renderedContainerMap.has(ancestor)) {
              const folderDiv = document.createElement('div');
              folderDiv.classList.add('readingStackFolder');
              folderDiv.innerHTML = `<span class="folderLabel">
                  <span class="indenter">${'&nbsp;&nbsp;&nbsp;'.repeat(ancestors.length - 1 - i)}</span>
                  <span class="zippyButton"></span>`;
              const folderNameSpan = document.createElement('span');
              folderNameSpan.className = 'folderName';
              folderNameSpan.textContent = ancestor.getName();
              folderDiv.appendChild(folderNameSpan);
              const zippyButtonEl = folderDiv.querySelector('span.zippyButton');
              zippyButtonEl.addEventListener('click', (evt) => this.toggleFolderExpandCollapse_(folderDiv, ancestor));
              if (this.folderCollapsedMap_.get(ancestor) === true) {
                this.toggleFolderExpandCollapse_(folderDiv, ancestor);
              }
              curDiv.appendChild(folderDiv);
              renderedContainerMap.set(ancestor, folderDiv);
            }
            curDiv = renderedContainerMap.get(ancestor);
          }

          curDiv = renderedContainerMap.get(book.getContainer());
        }

        const bookDiv = document.createElement('div');
        bookDiv.classList.add('readingStackBook');
        if (!book.needsLoading()) {
          bookDiv.classList.add('loaded');
        }
        if (this.currentBookNum_ == i) {
          bookDiv.classList.add('current');
        }
        bookDiv.dataset.index = i;
        bookDiv.innerHTML =
          '<div class="readingStackBookInner" title="' + book.getName() + '">' +
          '&nbsp;&nbsp;&nbsp;'.repeat(indentLevel) +
          book.getName() +
          '</div>' +
          '<div class="readingStackBookCloseButton" title="Remove book from stack">x</div>';

        // Handle drag-drop of books.
        // TODO: Fix this or disable it for books in containers.
        bookDiv.setAttribute('draggable', 'true');
        bookDiv.addEventListener('dragstart', evt => {
          evt.stopPropagation();
          const thisBookDiv = evt.target;
          thisBookDiv.classList.add('dragging');
          evt.dataTransfer.effectAllowed = 'move';
          evt.dataTransfer.setData('text/plain', thisBookDiv.dataset.index);
        });
        bookDiv.addEventListener('dragend', evt => {
          evt.stopPropagation();
          evt.target.classList.remove('dragging');
        });
        bookDiv.addEventListener('dragenter', evt => {
          evt.stopPropagation();
          evt.target.classList.add('dropTarget');
        });
        bookDiv.addEventListener('dragleave', evt => {
          evt.stopPropagation();
          evt.target.classList.remove('dropTarget');
        });
        bookDiv.addEventListener('dragover', evt => {
          evt.stopPropagation();
          evt.preventDefault();
        });
        bookDiv.addEventListener('drop', evt => {
          evt.stopPropagation();

          const dropBookDiv = evt.target;
          const fromIndex = parseInt(evt.dataTransfer.getData('text/plain'), 10);
          const toIndex = parseInt(dropBookDiv.dataset.index, 10);

          if (fromIndex !== toIndex) {
            const draggedBook = this.books_[fromIndex];
            const currentBook = this.books_[this.currentBookNum_];
            this.books_.splice(fromIndex, 1);
            this.books_.splice(toIndex, 0, draggedBook);
            this.currentBookNum_ = this.books_.indexOf(currentBook);
            this.renderStack_();
          }
        });

        bookDiv.addEventListener('click', (evt) => {
          const i = parseInt(evt.currentTarget.dataset.index, 10);
          if (evt.target.classList.contains('readingStackBookCloseButton')) {
            this.removeBook(i);
          } else {
            this.changeToBook_(i);
          }
        });
        curDiv.appendChild(bookDiv);
      }
      libDiv.appendChild(topDiv);
    } else {
      libDiv.innerHTML = 'No books loaded';
      // TODO: Display a label indicating no books loaded again.
    }
  }
}
