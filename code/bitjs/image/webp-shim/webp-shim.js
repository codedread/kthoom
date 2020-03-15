/**
 * 
 */

const url = import.meta.url;
if (!url.endsWith('/webp-shim.js')) {
  throw 'webp-shim must be loaded as webp-shim.js';
}
const thisModulePath = url.substring(0, url.indexOf('/webp-shim.js'));

let loadingPromise = undefined;
let api = undefined;

/**
 * @return {Promise<Object>} Returns the API object.
 */
function loadWebPShimApi() {
  if (api) { return Promise.resolve(api); }
  else if (loadingPromise) { return loadingPromise; }
  return loadingPromise = new Promise((resolve, reject) => {
    const scriptEl = document.createElement('script');
    scriptEl.onload = () => {
      Module.print = str => console.log(str);
      Module.printErr = str => console.error(str);
      Module.onRuntimeInitialized = () => {
        api = {
          createWASMBuffer: Module.cwrap('create_buffer', 'number', ['number', 'number']),
          destroyWASMBuffer: Module.cwrap('destroy_buffer', '', ['number']),
          getJPGHandle: Module.cwrap('get_jpg_handle_from_webp', 'number', ['number', 'number']),
          getPNGHandle: Module.cwrap('get_png_handle_from_webp', 'number', ['number', 'number']),
          getImageBytesFromHandle: Module.cwrap('get_image_bytes_from_handle', 'number', ['number']),
          getNumBytesFromHandle: Module.cwrap('get_num_bytes_from_handle', 'number', ['number']),
          module: Module,
          releaseImageHandle: Module.cwrap('release_image_handle', '', ['number']),
        };  
        resolve(api);
      };
    };
    scriptEl.onerror = err => reject(err);
    scriptEl.src = `${thisModulePath}/webp-shim-module.js`;
    document.body.appendChild(scriptEl);
  });
}

/**
 * @param {ArrayBuffer|TypedArray} webpBuffer The byte array containing the WebP image bytes.
 * @returns {Promise<ArrayBuffer>} A Promise resolving to a byte array containing the PNG bytes.
 */
export function convertWebPtoPNG(webpBuffer) {
  return loadWebPShimApi().then((api) => {
    // Create a buffer of the WebP bytes that we can send into WASM-land.
    const webpArray = new Uint8Array(webpBuffer);
    const size = webpArray.byteLength;
    const webpWASMBuffer = api.createWASMBuffer(size);
    api.module.HEAPU8.set(webpArray, webpWASMBuffer);
  
    // Convert to PNG.
    const pngHandle = api.getPNGHandle(webpWASMBuffer, size);
    const numBytes = api.getNumBytesFromHandle(pngHandle);
    const pngBufPtr = api.getImageBytesFromHandle(pngHandle);
    let pngBuffer = api.module.HEAPU8.slice(pngBufPtr, pngBufPtr + numBytes - 1);

    // Cleanup.
    api.releaseImageHandle(pngHandle);
    api.destroyWASMBuffer(webpWASMBuffer);
    return pngBuffer;
  });
}

/**
 * @param {ArrayBuffer|TypedArray} webpBuffer The byte array containing the WebP image bytes.
 * @returns {Promise<ArrayBuffer>} A Promise resolving to a byte array containing the JPG bytes.
 */
export function convertWebPtoJPG(webpBuffer) {
  return loadWebPShimApi().then((api) => {
    // Create a buffer of the WebP bytes that we can send into WASM-land.
    const size = webpBuffer.byteLength;
    const webpWASMBuffer = api.createWASMBuffer(size);
    api.heap.set(webpBuffer, webpWASMBuffer);

    // Convert to JPG.
    const jpgHandle = api.getJPGHandle(webpWASMBuffer, size);
    const numJPGBytes = api.getNumBytesFromHandle(jpgHandle);
    const jpgBufPtr = api.getImageBytesFromHandle(jpgHandle);
    const jpgBuffer = api.heap.slice(jpgBufPtr, jpgBufPtr + numJPGBytes - 1);

    // Cleanup.
    api.releaseImageHandle(jpgHandle);
    api.destroyWASMBuffer(webpWASMBuffer);
    return jpgBuffer;
  });
}