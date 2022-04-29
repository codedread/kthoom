/**
 * comic-book-binder.js
 *
 * Licensed under the MIT License
 *
 * Copyright(c) 2019 Google Inc.
 */

import { UnarchiveEventType } from './bitjs/archive/decompress.js';
import { BookBinder, BookType } from './book-binder.js';
import { BookBindingCompleteEvent, BookMetadataXmlExtractedEvent, BookPageExtractedEvent, BookProgressEvent } from './book-events.js';
import { createPageFromFileAsync, guessMimeType } from './page.js';
import { sortPages } from './comic-book-page-sorter.js';
import { Params } from './common/helpers.js';
import { createMetadataFromComicBookXml } from './metadata/book-metadata.js';

const STREAM_OPTIMIZED_NS = 'http://www.codedread.com/sop';

/**
 * The default BookBinder used in kthoom.  It takes each extracted file from the Unarchiver and
 * turns that directly into a Page for the comic book.
 */
export class ComicBookBinder extends BookBinder {
  constructor(filenameOrUri, ab, totalExpectedSize) {
    super(filenameOrUri, ab, totalExpectedSize);

    /** @private {string} */
    this.mimeType_ = null;

    // As each file becomes available from the Unarchiver, we kick off an async operation
    // to construct a Page object.  After all pages are retrieved, we sort and then extract them.
    // (Or, if the book is stream-optimized, we extract them in order immediately)
    /** @private {Promise<Page>} */
    this.pagePromises_ = [];

    /** @private {boolean} */
    this.optimizedForStreaming_ = (Params.alwaysOptimizedForStreaming === 'true') || false;
  }

  /** @override */
  beforeStart_() {
    let prevExtractPromise = Promise.resolve(true);
    this.unarchiver.addEventListener(UnarchiveEventType.EXTRACT, evt => {
      // Convert each unarchived file into a Page.
      // TODO: Error if not present?
      if (evt.unarchivedFile) {
        const filename = evt.unarchivedFile.filename;
        const mimeType = guessMimeType(filename) || '';
        if (mimeType.startsWith('image/')) {
          const pagePromise = createPageFromFileAsync(evt.unarchivedFile);
          // TODO: Error if we have more pages than totalPages_.
          this.pagePromises_.push(pagePromise);

          if (this.optimizedForStreaming_) {
            const numPages = this.pagePromises_.length;
            prevExtractPromise = prevExtractPromise.then(() => {
              return pagePromise.then(page => {
                this.dispatchEvent(new BookPageExtractedEvent(this, page, numPages));
              });
            });
          }
        }
        // Extract metadata, if found.
        else if (filename.toLowerCase() === 'comicinfo.xml') {
          const metadataXml = new TextDecoder().decode(evt.unarchivedFile.fileData);
          if (metadataXml) {
            const bookMetadata = createMetadataFromComicBookXml(metadataXml);
            this.dispatchEvent(new BookMetadataXmlExtractedEvent(this, bookMetadata));

            // If this is the first file extracted and it says the archive is optimized for
            // streaming, then we will emit page extracted events as they are extracted instead
            // of upon all files being extracted to display the first page as fast as possible.
            if (this.pagePromises_.length === 0 && bookMetadata.isOptimizedForStreaming()) {
              this.optimizedForStreaming_ = true;
            }
          }
        }

        // Emit a Progress event for each unarchived file.
        this.dispatchEvent(new BookProgressEvent(this, this.pagePromises_.length));
      }
    });
    this.unarchiver.addEventListener(UnarchiveEventType.FINISH, evt => {
      this.setUnarchiveComplete();

      if (evt.metadata.comment && Params.metadata) {
        alert(evt.metadata.comment);
      }
      let pages = [];
      let foundError = false;
      let pagePromiseChain = Promise.resolve(true);
      for (let pageNum = 0; pageNum < this.pagePromises_.length; ++pageNum) {
        pagePromiseChain = pagePromiseChain.then(() => {
          return this.pagePromises_[pageNum]
            .then(page => pages.push(page))
            .catch(e => {
              console.error(`Error creating page: ${e}`);
              foundError = true;
            })
            .finally(() => true);
        });
      }

      pagePromiseChain.then(() => {
        console.log(`  number of pages = ${pages.length}`);

        if (foundError) {
          // TODO: Better error handling.
          alert('Some pages had errors. See the console for more info.')
        }

        // Sort the book's pages, if this book was not optimized for streaming.
        if (!this.optimizedForStreaming_) {
          pages = pages.slice(0).sort((a, b) => sortPages(a, b));

          // Emit an extract event for each page in its proper order.
          for (let i = 0; i < pages.length; ++i) {
            this.dispatchEvent(new BookPageExtractedEvent(this, pages[i], i + 1));
          }
        }

        // Emit a complete event.
        this.dispatchEvent(new BookBindingCompleteEvent(this));
      });

      this.stop();
    });

    switch (this.unarchiver.getMIMEType()) {
      case 'application/zip':
        this.mimeType_ = 'application/vnd.comicbook+zip';
        break;
      case 'application/x-rar-compressed':
        this.mimeType_ ='application/vnd.comicbook-rar';
        break;
      case 'application/x-tar':
        this.mimeType_ = 'application/x-cbt';
        break;
      default: throw 'Unknown comic book archive type';
    }
  }

  getBookType() { return BookType.COMIC; }

  getMIMEType() {
    return this.mimeType_;
  }

  /** @override */
  getLayoutPercentage() { return this.getUnarchivingPercentage() * this.getUnarchivingPercentage(); }
}
