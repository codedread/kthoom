/**
 * book-binder.js
 *
 * Licensed under the MIT License
 *
 * Copyright(c) 2019 Google Inc.
 */

import { Unarchiver, UnarchiveEventType, getUnarchiver } from './bitjs/archive/decompress.js';
import { BookProgressEvent } from './book-events.js';
import { config } from './config.js';
import { Params } from './common/helpers.js';

/** @enum */
export const BookType = {
  UNKNOWN: 0,
  COMIC: 1,
  EPUB: 2,
}

/** @enum */
export const UnarchiveState = {
  UNARCHIVING_NOT_YET_STARTED: 0,
  UNARCHIVING: 1,
  UNARCHIVED: 2,
  UNARCHIVING_ERROR: 3,
};

let EventTarget = Object;
try { EventTarget = window.EventTarget } catch(e) {}

/**
 * The abstract class for a BookBinder.  Never instantiate one of these yourself.
 * Use createBookBinderAsync() to create an instance of an implementing subclass.
 *
 * A BookBinder manages unarchiving the relevant files from the incoming bytes and
 * emitting useful BookEvents (like progress, page extraction) to subscribers.
 */
export class BookBinder extends EventTarget {
  /** @type {number} */
  #bytesLoaded;

  /** @type {number} */
  #totalExpectedSize;

  /** @type {number} */
  #startTime;

  /** @type {UnarchiveState} */
  #unarchiveState = UnarchiveState.UNARCHIVING_NOT_YET_STARTED;

  /** 
   * A number between 0 and 1 indicating the progress of the Unarchiver.
   * @type {number}
   */
  #unarchivingPercentage = 0;

  /** @type {Unarchiver} */
  unarchiver;

  /**
   * A number between 0 and 1 indicating the progress of the page layout process.
   * @type {number}
   */
  layoutPercentage = 0;

  /**
   * @param {string} fileNameOrUri
   * @param {ArrayBuffer} ab The ArrayBuffer to initialize the BookBinder.
   * @param {number} totalExpectedSize The total number of bytes expected.
   */
  constructor(fileNameOrUri, ab, totalExpectedSize) {
    super();

    // totalExpectedSize can be -1 in the case of an XHR where we do not know the size yet.
    if (!totalExpectedSize || totalExpectedSize < -1) {
      throw 'Must initialize a BookBinder with a valid totalExpectedSize';
    }
    // We do not check (ab instanceof ArrayBuffer) because sometimes the ArrayBuffer is created from
    // the JS context's ArrayBuffer prototype (like when it is sent from another Window).
    if (!ab || (!ab.byteLength)) {
      throw 'Must initialize a BookBinder with an ArrayBuffer';
    }
    if (totalExpectedSize > 0 && ab.byteLength > totalExpectedSize) {
      throw 'Must initialize a BookBinder with a ab.byteLength <= totalExpectedSize';
    }

    /** @protected {string} */
    this.name_ = fileNameOrUri;

    this.#bytesLoaded = ab.byteLength;
    this.#totalExpectedSize = totalExpectedSize > 0 ? totalExpectedSize : this.#bytesLoaded;

    const unarchiverOptions = {
      'pathToBitJS': config.get('PATH_TO_BITJS'),
      'debug': (Params.debug === 'true'),
    };

    this.unarchiver = getUnarchiver(ab, unarchiverOptions);
    if (!this.unarchiver) {
      throw 'Could not determine the unarchiver to use';
    }
  }

  /**
   * Appends more bytes to the binder for processing.
   * @param {ArrayBuffer} ab
   */
  appendBytes(ab) {
    if (!ab) {
      throw 'Must pass a valid ArrayBuffer to appendBytes()';
    }
    if (!this.unarchiver) {
      throw 'Called appendBytes() without a valid Unarchiver set';
    }

    // Fetch doesn't give us the full byte size, so we update upon each append.
    if (this.#bytesLoaded + ab.byteLength > this.#totalExpectedSize) {
      this.#totalExpectedSize = this.#bytesLoaded + ab.byteLength;
    }

    this.unarchiver.update(ab);
    this.#bytesLoaded += ab.byteLength;
  }

  /**
   * Override this in an implementing subclass to do things before the Unarchiver starts
   * (like subscribe to Unarchiver events).
   * @abstract
   * @protected
   */
  beforeStart_() {
    throw 'Cannot call beforeStart_() in abstract BookBinder';
  }

  /**
   * @abstract
   * @returns {BookType}
   */
  getBookType() {
    throw 'Cannot call getBookType() in abstract BookBinder';
  }

  /**
   * Override this in an implementing subclass.
   * @abstract
   * @returns {string} The MIME type of the book.
   */
  getMIMEType() {
    throw 'Cannot call getMIMEType() in abstract BookBinder';
  }

  /** Returns a number between 0 and 1 indicating how much of the bytes have been loaded. */
  getLoadingPercentage() { return this.#bytesLoaded / this.#totalExpectedSize; }
  /** Returns a number between 0 and 1 indicating how much of the book has been decompressed. */
  getUnarchivingPercentage() { return this.#unarchivingPercentage; }
  /** Returns a number between 0 and 1 indicating how much of the pages have been layed out. */
  getLayoutPercentage() { return this.layoutPercentage; }

  setNewExpectedSize(bytesDownloaded, newExpectedSize) {
    this.#bytesLoaded = bytesDownloaded;
    this.#totalExpectedSize = newExpectedSize;
  }

  /** @protected */
  setUnarchiveComplete() {
    this.#unarchiveState = UnarchiveState.UNARCHIVED;
    this.#unarchivingPercentage = 1.0;
    const diff = ((new Date).getTime() - this.#startTime) / 1000;
    console.log(`Book = '${this.name_}'`);
    console.log(`  using ${this.unarchiver.getScriptFileName()}`);
    console.log(`  unarchiving done in ${diff}s`);
  }

  /**
   * Starts the binding process.
   * @returns {Promise<void>} A Promise that resolves once the unarchiver implementation has been
   *     loaded, initialized, connected and the binding process is truly started.
   */
  start() {
    if (!this.unarchiver) {
      throw 'Called start() without a valid Unarchiver';
    }

    this.#startTime = (new Date).getTime();
    this.#unarchiveState = UnarchiveState.UNARCHIVING;
    this.unarchiver.addEventListener(UnarchiveEventType.PROGRESS, evt => {
      this.#unarchivingPercentage = evt.totalCompressedBytesRead / this.#totalExpectedSize;
      // Total # pages is not always equal to the total # of files, so we do not report that here.
      this.dispatchEvent(new BookProgressEvent(this));
    });

    this.unarchiver.addEventListener(UnarchiveEventType.INFO,
      evt => console.log(evt.msg));

    this.beforeStart_();
    this.unarchiver.start();

    return new Promise((resolve, reject) => {
      this.unarchiver.onStart(() => resolve());
    });
  }

  /**
   * Must be called from the implementing subclass of BookBinder. Do not call this from
   * the client.
   * @protected
   */
  stop() {
    // Stop the Unarchiver (which will kill the worker) and then delete the unarchiver
    // which should free up some memory, including the unarchived array buffer.
    this.unarchiver.stop();
    this.unarchiver = null;
  }
}

/**
 * Creates a book binder based on the type of book.  Determines the type of unarchiver to use by
 * looking at the first bytes.  Guesses the type of book by looking at the file/uri name.
 * @param {string} fileNameOrUri The filename or URI.  Must end in a file extension that can be
 *     used to guess what type of book this is.
 * @param {ArrayBuffer} ab The initial ArrayBuffer to start the unarchiving process.
 * @param {number} totalExpectedSize Thee total expected size of the archived book in bytes.
 * @returns {Promise<BookBinder>} A Promise that will resolve with a BookBinder.
 */
export function createBookBinderAsync(fileNameOrUri, ab, totalExpectedSize) {
  if (fileNameOrUri.toLowerCase().endsWith('.epub')) {
    return import('./epub/epub-book-binder.js').then(module => {
      return new module.EPUBBookBinder(fileNameOrUri, ab, totalExpectedSize);
    });
  }
  return import('./comics/comic-book-binder.js').then(module => {
    return new module.ComicBookBinder(fileNameOrUri, ab, totalExpectedSize);
  });
}
