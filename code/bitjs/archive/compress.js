/**
 * compress.js
 *
 * Provides base functionality for compressing.
 *
 * Licensed under the MIT License
 *
 * Copyright(c) 2023 Google Inc.
 */

import { ZipCompressionMethod, getConnectedPort } from './common.js';

// TODO(2.0): Remove this comment.
// NOTE: THIS IS A WORK-IN-PROGRESS! THE API IS NOT FROZEN! USE AT YOUR OWN RISK!

/**
 * @typedef FileInfo An object that is sent to the implementation to represent a file to zip.
 * @property {string} fileName The name of the file. TODO: Includes the path?
 * @property {number} lastModTime The number of ms since the Unix epoch (1970-01-01 at midnight).
 * @property {Uint8Array} fileData The bytes of the file.
 */

/** The number of milliseconds to periodically send any pending files to the Worker. */
const FLUSH_TIMER_MS = 50;

/**
 * Data elements are packed into bytes in order of increasing bit number within the byte,
 * i.e., starting with the least-significant bit of the byte.
 * Data elements other than Huffman codes are packed starting with the least-significant bit of the
 * data element.
 * Huffman codes are packed starting with the most-significant bit of the code.
 */

/**
 * @typedef CompressorOptions
 * @property {ZipCompressionMethod} zipCompressionMethod
 */

/**
 * @readonly
 * @enum {string}
 */
export const CompressStatus = {
  NOT_STARTED: 'not_started',
  READY: 'ready',
  WORKING: 'working',
  COMPLETE: 'complete',
  ERROR: 'error',
};

// TODO: Extend EventTarget and introduce subscribe methods (onProgress, onInsert, onFinish, etc).

/**
 * A thing that zips files.
 * NOTE: THIS IS A WORK-IN-PROGRESS! THE API IS NOT FROZEN! USE AT YOUR OWN RISK!
 * TODO(2.0): Add semantic onXXX methods for an event-driven API. 
 */
export class Zipper {
  /**
   * @type {Uint8Array}
   * @private
   */
  byteArray = new Uint8Array(0);

  /**
   * The overall state of the Zipper.
   * @type {CompressStatus}
   * @private
   */
  compressStatus_ = CompressStatus.NOT_STARTED;
  // Naming of this property preserved for compatibility with 1.2.4-.
  get compressState() { return this.compressStatus_; }

  /**
   * The client-side port that sends messages to, and receives messages from the
   * decompressor implementation.
   * @type {MessagePort}
   * @private
   */
  port_;

  /**
   * A function to call to disconnect the implementation from the host.
   * @type {Function}
   * @private
   */
  disconnectFn_;

  /**
   * A timer that periodically flushes pending files to the Worker. Set upon start() and stopped
   * upon the last file being compressed by the Worker.
   * @type {Number}
   * @private
   */
  flushTimer_ = 0;

  /**
   * Whether the last files have been added by the client.
   * @type {boolean}
   * @private
   */
  lastFilesReceived_ = false;

  /**
   * The pending files to be sent to the Worker.
   * @type {FileInfo[]}
   * @private
   */
  pendingFilesToSend_ = [];

  /**
   * @param {CompressorOptions} options
   */
  constructor(options) {
    /**
     * @type {CompressorOptions}
     * @private
     */
    this.zipOptions = options;
    this.zipCompressionMethod = options.zipCompressionMethod || ZipCompressionMethod.STORE;
    if (!Object.values(ZipCompressionMethod).includes(this.zipCompressionMethod)) {
      throw `Compression method ${this.zipCompressionMethod} not supported`;
    }

    if (this.zipCompressionMethod === ZipCompressionMethod.DEFLATE) {
      // As per https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream, NodeJS only
      // supports deflate-raw from 21.2.0+ (Nov 2023). https://nodejs.org/en/blog/release/v21.2.0.
      try {
        new CompressionStream('deflate-raw');
      } catch (err) {
        throw `CompressionStream with deflate-raw not supported by JS runtime: ${err}`;
      }
    }
  }

  /**
   * Must only be called on a Zipper that has been started. See start().
   * @param {FileInfo[]} files 
   * @param {boolean} isLastFile 
   */
  appendFiles(files, isLastFile = false) {
    if (this.compressStatus_ === CompressStatus.NOT_STARTED) {
      throw `appendFiles() called, but Zipper not started.`;
    }
    if (this.lastFilesReceived_) throw `appendFiles() called, but last file already received.`;

    this.lastFilesReceived_ = isLastFile;
    this.pendingFilesToSend_.push(...files);
  }

  /**
   * Send in a set of files to be compressed. Set isLastFile to true if no more files are to be
   * added in the future. The return Promise will not resolve until isLastFile is set to true either
   * in this method or in an appendFiles() call.
   * @param {FileInfo[]} files
   * @param {boolean} isLastFile
   * @returns {Promise<Uint8Array>} A Promise that will resolve once the final file has been sent.
   *     The Promise resolves to an array of bytes of the entire zipped archive.
   */
  async start(files = [], isLastFile = false) {
    if (this.compressStatus_ !== CompressStatus.NOT_STARTED) {
      throw `start() called, but Zipper already started.`;
    }

    // We optimize for the case where isLastFile=true in a start() call by posting to the Worker
    // immediately upon async resolving below. Otherwise, we push these files into the pending set
    // and rely on the flush timer to send them into the Worker.
    if (!isLastFile) {
      this.pendingFilesToSend_.push(...files);
      this.flushTimer_ = setInterval(() => this.flushAnyPendingFiles_(), FLUSH_TIMER_MS);
    }
    this.compressStatus_ = CompressStatus.READY;
    this.lastFilesReceived_ = isLastFile;

    // After this point, the function goes async, so appendFiles() may run before anything else in
    // this function.
    const impl = await getConnectedPort('./zip.js');
    this.port_ = impl.hostPort;
    this.disconnectFn_ = impl.disconnectFn;
    return new Promise((resolve, reject) => {
      this.port_.onerror = (evt) => {
        console.log('Impl error: message = ' + evt.message);
        reject(evt.message);
      };

      this.port_.onmessage = (evt) => {
        if (typeof evt.data == 'string') {
          // Just log any strings the implementation pumps our way.
          console.log(evt.data);
        } else {
          switch (evt.data.type) {
            // Message sent back upon the first message the Worker receives, which may or may not
            // have sent any files for compression, e.g. start([]).
            case 'start':
              this.compressStatus_ = CompressStatus.WORKING;
              break;
            // Message sent back when the last file has been compressed by the Worker.
            case 'finish':
              if (this.flushTimer_) {
                clearInterval(this.flushTimer_);
                this.flushTimer_ = 0;
              }
              this.compressStatus_ = CompressStatus.COMPLETE;
              this.port_.close();
              this.disconnectFn_();
              this.port_ = null;
              this.disconnectFn_ = null;
              resolve(this.byteArray);
              break;
            // Message sent back when the Worker has written some bytes to the zip file.
            case 'compress':
              this.addBytes_(evt.data.bytes);
              break;
          }
        }
      };

      // See note above about optimizing for the start(files, true) case.
      if (isLastFile) {
        this.port_.postMessage({ files, isLastFile, compressionMethod: this.zipCompressionMethod });
      }
    });
  }

  /**
   * Updates the internal byte array with new bytes (by allocating a new array and copying).
   * @param {Uint8Array} newBytes
   * @private
   */
  addBytes_(newBytes) {
    const oldArray = this.byteArray;
    this.byteArray = new Uint8Array(oldArray.byteLength + newBytes.byteLength);
    this.byteArray.set(oldArray);
    this.byteArray.set(newBytes, oldArray.byteLength);
  }

  /**
   * Called internally by the async machinery to send any pending files to the Worker. This method
   * sends at most one message to the Worker.
   * @private
   */
  flushAnyPendingFiles_() {
    if (this.compressStatus_ === CompressStatus.NOT_STARTED) {
      throw `flushAppendFiles_() called but Zipper not started.`;
    }
    // If the port is not initialized or we have no pending files, just return immediately and
    // try again on the next flush.
    if (!this.port_ || this.pendingFilesToSend_.length === 0) return;

    // Send all files to the worker. If we have received the last file, then let the Worker know.
    this.port_.postMessage({
      files: this.pendingFilesToSend_,
      isLastFile: this.lastFilesReceived_,
      compressionMethod: this.zipCompressionMethod,
    });
    // Release the memory from the browser's main thread.
    this.pendingFilesToSend_ = [];
  }
}
