/**
 * book.js
 *
 * Licensed under the MIT License
 *
 * Copyright(c) 2018 Google Inc.
 */
import { BookBinder, createBookBinderAsync } from './book-binder.js';
import { BookEventType, BookLoadingStartedEvent, BookLoadingCompleteEvent,
         BookProgressEvent, 
         BookPageExtractedEvent,
         BookBindingCompleteEvent} from './book-events.js';
import { BookMetadata, createEmptyMetadata } from './metadata/book-metadata.js';
import { BookPumpEventType } from './book-pump.js';
import { Params } from './common/helpers.js';

/**
 * @typedef BookOrBookContainer A shared type that both Book and BookContainer implement.
 * @property {function} getContainer
 * @property {function} getName
 */

/**
 * A BookContainer represents a folder containing books on the native file system.
 * @implements {BookOrBookContainer}
 */
export class BookContainer {
  /**
   * @param {string} name 
   * @param {FileSystemDirectoryHandle} handle
   * @param {BookContainer} parent An optional parent.
   */
  constructor(name, handle, parent) {
    /** @type {string} */
    this.name = name;

    /** @type {FileSystemDirectoryHandle} */
    this.handle = handle;

    /** @type {BookContainer} */
    this.parent = parent;

    /** @type {Array<Book|BookContainer>} */
    this.entries = [];
  }
  getContainer() { return this.parent; }
  getName() { return this.name; }
}

/**
 * A Book has a name, a set of pages, and a BookBinder which handles the process of loading,
 * unarchiving, and page setting. A Book will either have a URI, a Request, a File object, or a
 * FileSystemFileHandle object from which to load the data. Books may also have a container that
 * contains it.
 * @implements {BookOrBookContainer}
 */
export class Book extends EventTarget {
  /**
   * The name of the book (shown in the Reading Stack).
   * @type {String}
   */
  #name;

  /**
   * The optional Request for fetching the book (not set for a book loaded from the file system).
   * @type {Request}
   */
  #request;

  /**
   * The optional URI of the book (not set for a book loaded from the file system).
   * @type {String}
   */
  #uri;

  /**
   * The File object of the book.
   * @type {File}
   */
  #file;

  /**
   * The optional FileSystemFileHandle of the book (not set for book loaded from a URI).
   * @type {FileSystemFileHandle}
   */
  #fileHandle;

  /**
   * A reference to the ArrayBuffer is kept to let the user easily download a copy.
   * This array buffer is only valid once the book has fully loaded.
   * @type {ArrayBuffer}
   */
  #arrayBuffer = null;

  /**
   * @type {BookBinder}
   */
  #bookBinder = null;

  /**
   * @type {BookContainer}
   */
  #bookContainer;

  /** @type {BookMetadata} */
  #bookMetadata = null;

  /** @type {number} */
  #expectedSize = undefined;

  /** @type {boolean} */
  #finishedBinding = false;

  /** @type {boolean} */
  #finishedLoading = false;

  /**
   * True if this book has not started loading. False otherwise.
   * @type {boolean}
   */
  #needsLoading = true;

  /** @type {Array<Page>} */
  #pages = [];

  /** @type {boolean} */
  #startedBinding = false;

  /**
   * The total known number of pages.
   * @type {number}
   */
  #totalPages = 0;

  /**
   * Construct a book (but do not load it yet).
   * @param {string} name The human-readable name of the book (appears in the Reading Stack).
   * @param {string|File|FileSystemFileHandle|Request} uriRequestOrFileHandle For files loaded via
   *    URI, this param contains the URI. For files loaded via a Request, it contains the Request.
   *    For files loaded via a file input element, this contains the File object, for files loaded
   *    via the native file system, it contains the FileSystemFileHandle.
   * @param {BookContainer} bookContainer An optional BookContainer that contains this Book.
   * @param {number} expectedSize The size of the book file, in bytes. Can be -1 if unknown.
   */
  constructor(name, uriRequestOrFileHandle = undefined, bookContainer = undefined,
              expectedSize = -1) {
    super();

    if (!name) {
      throw `Book name was invalid in constructor.`;
    }

    this.#name = name;
    this.#uri = typeof(uriRequestOrFileHandle) === 'string' ? uriRequestOrFileHandle : undefined;
    this.#request = (uriRequestOrFileHandle instanceof Request) ? uriRequestOrFileHandle
        : undefined;
    this.#file = (uriRequestOrFileHandle instanceof File) ? uriRequestOrFileHandle : undefined;
    this.#fileHandle = (!this.#uri && !this.#request && !this.#file) ? uriRequestOrFileHandle
        : undefined;

    this.#bookContainer = bookContainer;
    this.#expectedSize = expectedSize;

    // Throw some error if none of #uri, #request, #file, #fileHandle are set?
  }

  /**
   * Called when bytes have been appended. This creates a new ArrayBuffer.
   * @param {ArrayBuffer} appendBuffer
   */
  appendBytes(appendBuffer) {
    let newBuffer = new Uint8Array(this.#arrayBuffer.byteLength + appendBuffer.byteLength);
    newBuffer.set(new Uint8Array(this.#arrayBuffer), 0);
    newBuffer.set(new Uint8Array(appendBuffer), this.#arrayBuffer.byteLength);
    this.#arrayBuffer = newBuffer.buffer;
  }

  /** @returns {Promise<ArrayBuffer>} */
  getArrayBuffer() {
    return this.#arrayBuffer;
  }

  /** @returns {BookContainer} */
  getContainer() { return this.#bookContainer; }

  /**
   * Returns a filename based on the source of the book (request, file, url).
   * @returns {string}
   */
  getFilename() {
    if (this.#uri || this.#request) {
      let url = this.#uri ?? this.#request.url;
      return url.substring(url.lastIndexOf('/') + 1);
    } else if (this.#file || this.#fileHandle) {
      return (this.#file || this.#fileHandle).name;
    }
    throw 'Unknown type of book source';
  }

  /** @returns {FileSystemFileHandle} */
  getFileSystemHandle() { return this.#fileHandle; }

  /** @returns {BookMetadata} */
  getMetadata() { return this.#bookMetadata; }

  /** @returns {string} */
  getMIMEType() {
    if (!this.#bookBinder) {
      throw 'Cannot call getMIMEType() without a BookBinder';
    }
    return this.#bookBinder.getMIMEType();
  }

  getName() { return this.#name; }
  getLoadingPercentage() {
    if (!this.#bookBinder) return 0;
    return this.#bookBinder.getLoadingPercentage();
  }
  getUnarchivingPercentage() {
    if (!this.#bookBinder) return 0;
    return this.#bookBinder.getUnarchivingPercentage();
  }
  getLayoutPercentage() {
    if (!this.#bookBinder) return 0;
    return this.#bookBinder.getLayoutPercentage();
  }
  getNumberOfPages() { return this.#totalPages; }
  getNumberOfPagesReady() { return this.#pages.length; }

  /**
   * @param {number} i A number from 0 to (num_pages - 1).
   * @returns {Page}
   */
  getPage(i) {
    // TODO: This is a bug in the unarchivers.  The only time #totalPages is set is
    // upon getting a UnarchiveEventType.PROGRESS which has the total number of files.
    // In some books, we get an EXTRACT event before we get the first PROGRESS event.
    const numPages = this.#totalPages || this.#pages.length;
    if (i < 0 || i >= numPages) {
      return null;
    }
    return this.#pages[i];
  }

  /** @returns {string} */
  getUri() {
    if (this.#request) {
      return this.#request.url;
    }
    return this.#uri;
  }

  /**
   * Whether the book has finished binding. Binding means the book is fully loaded, has been
   * unarchived, paginated, its metadata inflated, etc.
   * @returns {boolean}
   */
  isFinishedBinding() {
    return this.#finishedBinding;
  }

  /**
   * Whether the book has finished loading (from disk, network, etc).
   * @returns {boolean}
   */
  isFinishedLoading() {
    return this.#finishedLoading;
  }

  /**
   * Loads the file from its source (either Fetch or File).
   * @returns {Promise<Book>}
   */
  async load() {
    if (this.#request) {
      return this.loadFromFetch();
    } else if (this.#uri) {
      return this.loadFromXhr();
    } else if (this.#file || this.#fileHandle) {
      return this.loadFromFile();
    }
    throw 'Could not load Book: no URI or File or FileHandle';
  }

  /**
   * Starts an XHR and progressively loads in the book. Use loadFromFetch() instead.
   * @param {Number} expectedSize If -1, the total field from the XHR Progress event is used.
   * @param {Object<string, string>} headerMap A map of request header keys and values.
   * @returns {Promise<Book>} A Promise that returns this book when all bytes have been fed to it.
   * @deprecated
   */
  loadFromXhr(expectedSize = -1, headerMap = {}) {
    if (!this.#needsLoading) {
      throw 'Cannot try to load via XHR when the Book is already loading or loaded';
    }
    if (!this.#uri) {
      throw 'URI for book was not set from loadFromXhr()';
    }

    this.#needsLoading = false;
    this.dispatchEvent(new BookLoadingStartedEvent(this));

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', this.#uri, true);
      for (const headerKey in headerMap) {
        xhr.setRequestHeader(headerKey, headerMap[headerKey]);
      }

      xhr.responseType = 'arraybuffer';
      xhr.onprogress = (evt) => {
        if (this.#bookBinder) {
          if (this.#expectedSize == -1 && evt.total) {
            this.#expectedSize = evt.total;
            this.#bookBinder.setNewExpectedSize(evt.loaded, evt.total);
          }
          this.dispatchEvent(new BookProgressEvent(this, this.#pages.length));
        }
      };
      xhr.onload = (evt) => {
        const ab = evt.target.response;
        this.#startBookBinding(this.#uri, ab, this.#expectedSize);
        this.#finishedLoading = true;
        this.dispatchEvent(new BookLoadingCompleteEvent(this));
        resolve(this);
      };
      xhr.onerror = (err) => {
        reject(err);
      };
      xhr.send(null);
    });
  }

  /**
   * Starts a fetch and progressively loads in the book.
   * @returns {Promise<Book>} A Promise that returns this book when all bytes have been fed to it.
   */
  async loadFromFetch() {
    if (!this.#needsLoading) {
      throw 'Cannot try to load via Fetch when the Book is already loading or loaded';
    }
    if (!this.#request) {
      throw 'Request for book was not set in loadFromFetch()';
    }

    let bytesTotal = 0;
    this.#needsLoading = false;
    this.dispatchEvent(new BookLoadingStartedEvent(this));

    /** @type {Response} */
    let response;
    try {
      response = await fetch(this.#request);
    } catch (e) {
      console.error(`Error from fetch: ${e}`);
      throw e;
    }

    if (Params['fetchMode'] === 'chunkByChunk') {
      // =============================================================================================
      // Option 1: Readable code, fetching chunk by chunk using await.
      const reader = response.body.getReader();
      let numChunks = 0;

      /**
       * Reads one chunk at a time.
       * @returns {Promise<ArrayBuffer | null>}
       */
      const getOneChunk = async () => {
        const { done, value } = await reader.read();
        if (!done) {
          numChunks++;
          console.log(`debugFetch: Received chunk #${numChunks} of ${value.byteLength} bytes`);
          return value.buffer;
        }
        return null;
      };

      const firstChunk = await getOneChunk();
      if (!firstChunk) {
        throw `Could not get one chunk from fetch()`;
      }
      bytesTotal = firstChunk.byteLength;

      // Asynchronously wait for the BookBinder and its implementation to be connected.
      await this.#startBookBinding(this.#name, firstChunk, this.#expectedSize);
      console.log(`debugFetch: Instantiated the BookBinder`);

      // Read out all subsequent chunks.
      /** @type {ArrayBuffer | null} */
      let nextChunk;
      while (nextChunk = await getOneChunk()) {
        bytesTotal += nextChunk.byteLength;
        this.appendBytes(nextChunk);
        this.#bookBinder.appendBytes(nextChunk);
      }
    } else {
      // =============================================================================================
      // Option 2: The XHR way (grab all bytes and only then start book binding).
      const ab = await response.arrayBuffer();
      bytesTotal = ab.byteLength;
      await this.#startBookBinding(this.#name, ab, this.#expectedSize);
    }
  
    // Send out BookLoadingComplete event and return this book.
    this.#finishedLoading = true;
    this.dispatchEvent(new BookLoadingCompleteEvent(this));
    if (Params['fetchMode']) {
      console.log(`debugFetch: ArrayBuffers were total length ${bytesTotal}`);
    }

    return this;
  }

  /**
   * @returns {Promise<Book>} A Promise that returns this book when all bytes have been fed to it.
   */
  async loadFromFile() {
    if (!this.#needsLoading) {
      throw 'Cannot try to load via File when the Book is already loading or loaded';
    }
    if (this.#uri) {
      throw 'URI for book was set in loadFromFile()';
    }
    if (!this.#file && !this.#fileHandle) {
      throw 'Neither file nor fileHandle was set inside Book constructor.';
    }

    // Set this immediately (before awaiting the file handle) so the ReadingStack does not try
    // to also load it.
    this.#needsLoading = false;
    const file = this.#file || await this.#fileHandle.getFile();
    this.dispatchEvent(new BookLoadingStartedEvent(this));

    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const ab = fr.result;
        try {
          this.#startBookBinding(file.name, ab, ab.byteLength);
          this.#finishedLoading = true;
          this.dispatchEvent(new BookLoadingCompleteEvent(this));
        } catch (err) {
          const errMessage = err + ': ' + file.name;
          console.error(errMessage);
          reject(errMessage);
        }
        resolve(this);
      };
      fr.readAsArrayBuffer(file);
    });
  }

  /**
   * @param {string} fileName
   * @param {ArrayBuffer} ab
   * @returns {Promise<Book>} A Promise that returns this book when all bytes have been fed to it.
   */
  loadFromArrayBuffer(fileName, ab) {
    if (!this.#needsLoading) {
      throw 'Cannot try to load via File when the Book is already loading or loaded';
    }
    if (this.#uri) {
      throw 'URI for book was set in loadFromArrayBuffer()';
    }

    this.#needsLoading = false;
    this.dispatchEvent(new BookLoadingStartedEvent(this));
    this.#startBookBinding(fileName, ab, ab.byteLength);
    this.#finishedLoading = true;
    this.dispatchEvent(new BookLoadingCompleteEvent(this));
    return Promise.resolve(this);
  }

  /**
   * @param {string} bookUri
   * @param {BookPump} bookPump
   * @returns {Promise<Book>} A Promise that returns this book when all bytes have been fed to it.
   */
  loadFromBookPump(bookUri, bookPump) {
    if (!this.#needsLoading) {
      throw 'Cannot try to load via BookPump when the Book is already loading or loaded';
    }
    if (this.#uri) {
      throw 'URI for book was set in loadFromBookPump()';
    }

    this.#needsLoading = false;
    let bookBinderPromise = null;
    return new Promise((resolve, reject) => {
      // If we get any error, reject the promise to create a book.
      bookPump.addEventListener(BookPumpEventType.BOOKPUMP_ERROR, evt => reject(evt.err));

      const handleBookPumpEvents = (evt) => {
        // If we do not have a book binder yet, create it and start the process.
        if (!bookBinderPromise) {
          try {
            bookBinderPromise = this.#startBookBinding(bookUri, evt.ab, evt.totalExpectedSize);
          } catch (err) {
            const errMessage = `${err}: ${file.name}`;
            console.error(errMessage);
            reject(errMessage);
          }
        } else {
          // Else, we wait on the book binder being finished before processing the event.
          bookBinderPromise.then(() => {
            switch (evt.type) {
              case BookPumpEventType.BOOKPUMP_DATA_RECEIVED:
                this.#bookBinder.appendBytes(evt.ab);
                this.appendBytes(evt.ab);
                break;
              case BookPumpEventType.BOOKPUMP_END:
                this.#finishedLoading = true;
                this.dispatchEvent(new BookLoadingCompleteEvent(this));
                bookPump.removeEventListener(BookPumpEventType.BOOKPUMP_DATA_RECEIVED, handleBookPumpEvents);
                bookPump.removeEventListener(BookPumpEventType.BOOKPUMP_END, handleBookPumpEvents);          
                resolve(this);
                break;
            }
          });
        }
      };
      
      bookPump.addEventListener(BookPumpEventType.BOOKPUMP_DATA_RECEIVED, handleBookPumpEvents);
      bookPump.addEventListener(BookPumpEventType.BOOKPUMP_END, handleBookPumpEvents);
    });
  }

  /** @returns {boolean} True if this book has not started loading, false otherwise. */
  needsLoading() {
    return this.#needsLoading;
  }

  /** @param {BookMetata} metadata */
  setMetadata(metadata) {
    this.#bookMetadata = metadata.clone();
  }

  /**
   * Creates and sets the BookBinder, subscribes to its events, and starts the book binding process.
   * This function is called by all loadFromXXX methods. It consumes the ArrayBuffer (which might be
   * only its first chunk of bytes).
   * @param {string} fileNameOrUri
   * @param {ArrayBuffer} ab Starting buffer of bytes. May be complete or may be partial depending
   *                         on which loadFrom... method was called.
   * @param {number} totalExpectedSize
   * @returns {Promise<BookBinder>}
   */
  async #startBookBinding(fileNameOrUri, ab, totalExpectedSize) {
    if (this.#startedBinding) {
      throw `Called startBookBinding() when we already started binding!`;
    }
    this.#startedBinding = true;

    // We have to take a copy, because the original ArrayBuffer may be transferred into a Worker.
    const copiedArr = new Uint8Array(new ArrayBuffer(ab.byteLength));
    copiedArr.set(new Uint8Array(ab));
    this.#arrayBuffer = copiedArr.buffer;

    const bookBinder = await createBookBinderAsync(fileNameOrUri, ab, totalExpectedSize);
  
    this.#bookMetadata = createEmptyMetadata(bookBinder.getBookType());

    // Extracts state from some BookBinder events and update the Book. Re-source some of those
    // events, and dispatch them out to the subscribers of this Book. Only some events are
    // propagated from the BookBinder events (those that affect the UI, essentially).

    bookBinder.addEventListener(BookEventType.BINDING_COMPLETE, evt => {
      this.#finishedBinding = true;
      this.dispatchEvent(new BookBindingCompleteEvent(this));
    });

    bookBinder.addEventListener(BookEventType.METADATA_XML_EXTRACTED, evt => {
      this.#bookMetadata = evt.bookMetadata;
    });

    bookBinder.addEventListener(BookEventType.PAGE_EXTRACTED, evt => {
      if (Params['fetchMode']) {
        console.log(`debugFetch: Page #${this.#pages.length+1} extracted`);
      }
      this.#pages.push(evt.page);
      this.dispatchEvent(new BookPageExtractedEvent(this, evt.page, evt.pageNum));
    });

    bookBinder.addEventListener(BookEventType.PROGRESS, evt => {
      if (evt.totalPages) {
        this.#totalPages = evt.totalPages;
      }
      this.dispatchEvent(new BookProgressEvent(this, evt.totalPages, evt.message));
    });

    if (Params['fetchMode']) {
      console.log(`debugFetch: Calling BookBinder.start()`);
    }
    // Wait for its decompressing implementation to be loaded and ports connected.
    await bookBinder.start();
    this.#bookBinder = bookBinder;
    return bookBinder;
  }
}
