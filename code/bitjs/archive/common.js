/**
 * common.js
 *
 * Provides common definitions or functionality needed by multiple modules.
 *
 * Licensed under the MIT License
 *
 * Copyright(c) 2023 Google Inc.
 */

/**
 * @typedef FileInfo An object that is sent to the implementation representing a file to compress.
 * @property {string} fileName The name of the file. TODO: Includes the path?
 * @property {number} lastModTime The number of ms since the Unix epoch (1970-01-01 at midnight).
 * @property {Uint8Array} fileData The bytes of the file.
 */

/**
 * @typedef Implementation
 * @property {MessagePort} hostPort The port the host uses to communicate with the implementation.
 * @property {Function} disconnectFn A function to call when the port has been disconnected.
 */

/**
 * Connects a host to a compress/decompress implementation via MessagePorts. The implementation must
 * have an exported connect() function that accepts a MessagePort. If the runtime support Workers
 * (e.g. web browsers, deno), imports the implementation inside a Web Worker. Otherwise, it
 * dynamically imports the implementation inside the current JS context (node, bun).
 * @param {string} implFilename The compressor/decompressor implementation filename relative to this
 *     path (e.g. './unzip.js').
 * @param {Function} disconnectFn A function to run when the port is disconnected.
 * @returns {Promise<Implementation>} The Promise resolves to the Implementation, which includes the
 *     MessagePort connected to the implementation that the host should use.
 */
export async function getConnectedPort(implFilename) {
  const messageChannel = new MessageChannel();
  const hostPort = messageChannel.port1;
  const implPort = messageChannel.port2;

  if (typeof Worker === 'undefined') {
    const implModule = await import(`${implFilename}`);
    await implModule.connect(implPort);
    return {
      hostPort,
      disconnectFn: () => implModule.disconnect(),
    };
  }
  
  return new Promise((resolve, reject) => {
    const workerScriptPath = new URL(`./webworker-wrapper.js`, import.meta.url).href;
    const worker = new Worker(workerScriptPath, { type: 'module' });
    worker.onmessage = () => {
      resolve({
        hostPort,
        disconnectFn: () => worker.postMessage({ disconnect: true }),
      });
    };
    worker.postMessage({ implSrc: implFilename }, [implPort]);
  });
}

// Zip-specific things.

export const LOCAL_FILE_HEADER_SIG = 0x04034b50;
export const CENTRAL_FILE_HEADER_SIG = 0x02014b50;
export const END_OF_CENTRAL_DIR_SIG = 0x06054b50;
export const CRC32_MAGIC_NUMBER = 0xedb88320;
export const ARCHIVE_EXTRA_DATA_SIG = 0x08064b50;
export const DIGITAL_SIGNATURE_SIG = 0x05054b50;
export const END_OF_CENTRAL_DIR_LOCATOR_SIG = 0x07064b50;
export const DATA_DESCRIPTOR_SIG = 0x08074b50;

/**
 * @readonly
 * @enum {number}
 */
export const ZipCompressionMethod = {
  STORE: 0,   // Default.
  DEFLATE: 8, // As per http://tools.ietf.org/html/rfc1951.
};
