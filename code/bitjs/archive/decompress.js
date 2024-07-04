/**
 * decompress.js
 *
 * Provides base functionality for unarchiving/decompression.
 *
 * Licensed under the MIT License
 *
 * Copyright(c) 2021 Google Inc.
 */

import { UnarchiveAppendEvent, UnarchiveErrorEvent, UnarchiveEvent, UnarchiveEventType,
         UnarchiveExtractEvent, UnarchiveFinishEvent, UnarchiveInfoEvent,
         UnarchiveProgressEvent, UnarchiveStartEvent } from './events.js';
import { getConnectedPort } from './common.js';
import { findMimeType } from '../file/sniffer.js';

// Exported as a convenience (and also because this module used to contain these).
// TODO(2.0): Remove this export, since they have moved to events.js?
export {
  UnarchiveAppendEvent,
  UnarchiveErrorEvent,
  UnarchiveEvent,
  UnarchiveEventType,
  UnarchiveExtractEvent,
  UnarchiveFinishEvent,
  UnarchiveInfoEvent,
  UnarchiveProgressEvent,
  UnarchiveStartEvent,
} 

/**
 * All extracted files returned by an Unarchiver will implement
 * the following interface:
 * TODO: Move this interface into common.js?
 */

/**
 * @typedef UnarchivedFile
 * @property {string} filename
 * @property {Uint8Array} fileData
 */

/**
 * @typedef UnarchiverOptions
 * @property {boolean=} debug Set to true for verbose unarchiver logging.
 */

/**
 * Base class for all Unarchivers.
 */
export class Unarchiver extends EventTarget {
  /**
   * The client-side port that sends messages to, and receives messages from, the
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
   * @param {ArrayBuffer} arrayBuffer The Array Buffer. Note that this ArrayBuffer must not be
   *     referenced once it is sent to the Unarchiver, since it is marked as Transferable and sent
   *     to the decompress implementation.
   * @param {UnarchiverOptions|string} options An optional object of options, or a string
   *     representing where the BitJS files are located.  The string version of this argument is
   *     deprecated.
   */
  constructor(arrayBuffer, options = {}) {
    super();

    // TODO(2.0): Remove this.
    if (typeof options === 'string') {
      console.warn(`Deprecated: Don't send a raw string to Unarchiver()`);
      console.warn(`            send UnarchiverOptions instead.`);
      options = { };
    }

    /**
     * The ArrayBuffer object.
     * @type {ArrayBuffer}
     * @protected
     */
    this.ab = arrayBuffer;

    /**
     * @orivate
     * @type {boolean}
     */
    this.debugMode_ = !!(options.debug);
  }

  /**
   * Overridden so that the type hints for eventType are specific. Prefer onExtract(), etc.
   * @param {'progress'|'extract'|'finish'} eventType 
   * @param {EventListenerOrEventListenerObject} listener 
   * @override
   */
  addEventListener(eventType, listener) {
    super.addEventListener(eventType, listener);
  }

  /**
   * Type-safe way to subscribe to an UnarchiveStartEvent. This is fired once the decompress
   * implementation has been loaded and the message ports have been connected. It is the first
   * event message that any decompress implementation (unzip.js, unrar.js) should send.
   * @param {function(UnarchiveExtractEvent)} listener 
   * @returns {Unarchiver} for chaining.
   */
  onStart(listener) {
    super.addEventListener(UnarchiveEventType.START, listener);
    return this;
  }

  /**
   * Type-safe way to subscribe to an UnarchiveExtractEvent.
   * @param {function(UnarchiveExtractEvent)} listener 
   * @returns {Unarchiver} for chaining.
   */
  onExtract(listener) {
    super.addEventListener(UnarchiveEventType.EXTRACT, listener);
    return this;
  }

  /**
   * Type-safe way to subscribe to an UnarchiveFinishEvent.
   * @param {function(UnarchiveFinishEvent)} listener 
   * @returns {Unarchiver} for chaining.
   */
  onFinish(listener) {
    super.addEventListener(UnarchiveEventType.FINISH, listener);
    return this;
  }

  /**
   * Type-safe way to subscribe to an UnarchiveProgressEvent.
   * @param {function(UnarchiveProgressEvent)} listener 
   * @returns {Unarchiver} for chaining.
   */
  onProgress(listener) {
    super.addEventListener(UnarchiveEventType.PROGRESS, listener);
    return this;
  }

  /**
   * This method must be overridden by the subclass to return the script filename.
   * @returns {string} The MIME type of the archive.
   * @protected.
   */
  getMIMEType() {
    throw 'Subclasses of Unarchiver must overload getMIMEType()';
  }

  /**
   * This method must be overridden by the subclass to return the script filename.
   * @returns {string} The script filename.
   * @protected.
   */
  getScriptFileName() {
    throw 'Subclasses of Unarchiver must overload getScriptFileName()';
  }

  /**
   * Create an UnarchiveEvent out of the object sent back from the implementation.
   * @param {Object} obj
   * @returns {UnarchiveEvent}
   * @private
   */
  createUnarchiveEvent_(obj) {
    switch (obj.type) {
      case UnarchiveEventType.START:
        return new UnarchiveStartEvent();
      case UnarchiveEventType.PROGRESS:
        return new UnarchiveProgressEvent(
          obj.currentFilename,
          obj.currentFileNumber,
          obj.currentBytesUnarchivedInFile,
          obj.currentBytesUnarchived,
          obj.totalUncompressedBytesInArchive,
          obj.totalFilesInArchive,
          obj.totalCompressedBytesRead);
      case UnarchiveEventType.EXTRACT:
        return new UnarchiveExtractEvent(obj.unarchivedFile);
      case UnarchiveEventType.FINISH:
        return new UnarchiveFinishEvent(obj.metadata);
      case UnarchiveEventType.INFO:
        return new UnarchiveInfoEvent(obj.msg);
      case UnarchiveEventType.ERROR:
        return new UnarchiveErrorEvent(obj.msg);
    }
  }

  /**
   * Receive an event and pass it to the listener functions.
   * @param {Object} obj
   * @returns {boolean} Returns true if the decompression is finished. 
   * @private
   */
  handlePortEvent_(obj) {
    const type = obj.type;
    if (type && Object.values(UnarchiveEventType).includes(type)) {
      const evt = this.createUnarchiveEvent_(obj);
      this.dispatchEvent(evt);
      if (evt.type == UnarchiveEventType.FINISH) {
        this.stop();
        return true;
      }
    } else {
      console.log(`Unknown object received from port: ${obj}`);
    }
    return false;
  }

  /**
   * Starts the unarchive by connecting the ports and sending the first ArrayBuffer.
   * @returns {Promise<void>} A Promise that resolves when the decompression is complete. While the
   *     decompression is proceeding, you can send more bytes of the archive to the decompressor
   *     using the update() method. If you want to know when the decompress implementation has been
   *     loaded and ports connected, use onStart().
   */
  async start() {
    const impl = await getConnectedPort(this.getScriptFileName());
    this.port_ = impl.hostPort;
    this.disconnectFn_ = impl.disconnectFn;
    return new Promise((resolve, reject) => {
      this.port_.onerror = (evt) => {
        console.log('Impl error: message = ' + evt.message);
        reject(evt);
      };
  
      this.port_.onmessage = (evt) => {
        if (typeof evt.data == 'string') {
          // Just log any strings the implementation pumps our way.
          console.log(evt.data);
        } else {
          if (this.handlePortEvent_(evt.data)) {
            resolve();
          }
        }
      };
  
      const ab = this.ab;
      this.port_.postMessage({
        file: ab,
        logToConsole: this.debugMode_,
      }, [ab]);
      this.ab = null;
    });
  }

  // TODO(bitjs): Test whether ArrayBuffers must be transferred...
  /**
   * Adds more bytes to the unarchiver.
   * @param {ArrayBuffer} ab The ArrayBuffer with more bytes in it. If opt_transferable is
   *     set to true, this ArrayBuffer must not be referenced after calling update(), since it
   *     is marked as Transferable and sent to the implementation.
   * @param {boolean=} opt_transferable Optional boolean whether to mark this ArrayBuffer
   *     as a Tranferable object, which means it can no longer be referenced outside of
   *     the implementation context.
   */
  update(ab, opt_transferable = false) {
    const numBytes = ab.byteLength;
    if (this.port_) {
      // Send the ArrayBuffer over, and mark it as a Transferable object if necessary.
      if (opt_transferable) {
        this.port_.postMessage({ bytes: ab }, [ab]);
      } else {
        this.port_.postMessage({ bytes: ab });
      }
    }

    this.dispatchEvent(new UnarchiveAppendEvent(numBytes));
  }

  /**
   * Closes the port to the decompressor implementation and terminates it.
   */
  stop() {
    if (this.port_) {
      this.port_.close();
      this.disconnectFn_();
      this.port_ = null;
      this.disconnectFn_ = null;
    }
  }
}

// Thin wrappers of decompressors for clients who want to construct a specific
// unarchiver themselves rather than use getUnarchiver().
export class Unzipper extends Unarchiver {
  /**
   * @param {ArrayBuffer} ab 
   * @param {UnarchiverOptions} options 
   */
  constructor(ab, options = {}) {
    super(ab, options);
  }

  getMIMEType() { return 'application/zip'; }
  getScriptFileName() { return './unzip.js'; }
}

export class Unrarrer extends Unarchiver {
  /**
   * @param {ArrayBuffer} ab 
   * @param {UnarchiverOptions} options 
   */
  constructor(ab, options = {}) {
    super(ab, options);
  }

  getMIMEType() { return 'application/x-rar-compressed'; }
  getScriptFileName() { return './unrar.js'; }
}

export class Untarrer extends Unarchiver {
  /**
   * @param {ArrayBuffer} ab 
   * @param {UnarchiverOptions} options 
   */
  constructor(ab, options = {}) {
    super(ab, options);
  }

  getMIMEType() { return 'application/x-tar'; }
  getScriptFileName() { return './untar.js'; };
}

// TODO(2.0): When up-revving to a major new version, remove the string type for options.

/**
 * Factory method that creates an unarchiver based on the byte signature found
 * in the ArrayBuffer.
 * @param {ArrayBuffer} ab The ArrayBuffer to unarchive. Note that this ArrayBuffer
 *     must not be referenced after calling this method, as the ArrayBuffer may be
 *     transferred to a different JS context once start() is called.
 * @param {UnarchiverOptions|string} options An optional object of options, or a
 *     string representing where the path to the unarchiver script files. The latter
 *     is now deprecated (use UnarchiverOptions).
 * @returns {Unarchiver}
 */
export function getUnarchiver(ab, options = {}) {
  if (ab.byteLength < 10) {
    return null;
  }

  let unarchiver = null;
  const mimeType = findMimeType(ab);

  if (mimeType === 'application/x-rar-compressed') { // Rar!
    unarchiver = new Unrarrer(ab, options);
  } else if (mimeType === 'application/zip') { // PK (Zip)
    unarchiver = new Unzipper(ab, options);
  } else { // Try with tar
    unarchiver = new Untarrer(ab, options);
  }
  return unarchiver;
}

// import * as fs from 'node:fs';
// async function main() {
//   const nodeBuf = fs.readFileSync(`./action-1.cbz`);
//   const ab = nodeBuf.buffer.slice(nodeBuf.byteOffset, nodeBuf.byteOffset + nodeBuf.length);
//   const then = Date.now();
//   const zipper = new Unzipper(ab, {debug: true});
//   zipper.addEventListener('extract', evt => {
//     const f = evt.unarchivedFile;
//     fs.writeFileSync(f.filename, Buffer.from(f.fileData));
//   });
//   zipper.addEventListener('finish', evt => {
//     console.dir(evt);
//     console.log(`Took ${(Date.now() - then)}ms`);
//   });
//   await zipper.start();
// }

// main();
