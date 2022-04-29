import { Book } from '../book.js';
import { BookMetadata, createComicBookXmlFromMetadata } from './book-metadata.js';
import { Key, Params, assert, getElem } from '../common/helpers.js';
import { Zipper } from '../bitjs/archive/compress.js';
import { config } from '../config.js';

// TODO: Always show all buttons on the metadata toolbar, but have a disabled state?
// TODO: If metadata editor is empty, always add a row?
// TODO: Style the form fields appropriately.

/**
 * @typedef MetadataRow An easy way to get access to row elements in the DOM.
 * @property {HTMLSelectElement} select
 * @property {HTMLInputElement} input
 * @property {HTMLButtonElement} deleteRowButton
 */

const METADATA_STATUS_ID = 'metadataStatus';
const REFRESH_TIMER_MS = 200;
const STATUS_TIMER_MS = 5000;

const COMICVINE_URL = 'https://us-central1-api-project-652854531961.cloudfunctions.net/function-proxy-request';

/**
 * A UI component that manages a table of cells to update metadata.
 */
export class MetadataEditor {
  /**
   * @param {Book} book 
   */
  constructor(book) {
    /**
     * @private
     * @type {Book}
     */
    this.book_ = book;

    /**
     * This is the editor's copy of the metadata.
     * @private
     * @type {BookMetadata}
     */
    this.editorMetadata_ = book.getMetadata().clone();

    /**
     * @private
     * @type {HTMLDivElement}
     */
    this.contentDiv_ = getElem('metadataTrayContents');

    /**
     * @private
     * @type {MetadataRow[]}
     */
    this.rows_ = [];

    getElem('addRowMetadataButton').addEventListener('click', evt => { this.doAddRow_(); })
    getElem('saveMetadataButton').addEventListener('click', evt => { this.doSave_(); });
    getElem('searchMetadataButton').addEventListener('click', evt => { this.doSearch_(); });

    /**
     * @private
     * @type {number}
     */
    this.idleTimer_ = null;

    /**
     * @private
     * @type {MetadataSearch}
     */
    this.searcher_ = null;
  }

  /** @returns {boolean} True if the editor is allowed to close. */
  doClose() {
    if (this.searcher_) {
      this.searcher_.doClose();
      this.searcher_ = null;
      this.rerender_();
      return false;
    }

    // If the metadata is edited, confirm the user wants to abandon changes before allowing closing.
    let allowClose = true;
    if (!this.editorMetadata_.equals(this.book_.getMetadata())) {
      allowClose = confirm(`Abandon metadata changes?`)
    }

    // If we are allowed to close, abandon all metadata changes and remove idle timer.
    if (allowClose) {
      this.editorMetadata_ = this.book_.getMetadata().clone();
      if (this.idleTimer_) {
        clearInterval(this.idleTimer_);
      }
      // Rendering the editor can show certain buttons, and we are closing, so hide them.
      this.hideEditorButtons_();
    }
    return allowClose;
  }

  /**
   * Renders the editor UI and set up an idle timer to watch for changes in metadata values.
   */
  doOpen() {
    if (this.idleTimer_) {
      throw `Metadata Editor had an idle timer set. Did you call doOpen() when it was open?`;
    }

    this.rerender_();

    this.idleTimer_ = setInterval(() => {
      // For each row, if its value does not match the metadata's current value, update the
      // metadata and then update the UI to reflect the state.
      let dirty = false;
      for (const row of this.rows_) {
        const key = row.select.dataset['key'];
        const val = row.input.value;
        if (this.editorMetadata_.getProperty(key) != val) {
          this.editorMetadata_.setProperty(key, val);
          dirty = true;
        }
      }
      if (dirty) {
        this.updateUI_();
      }
    }, REFRESH_TIMER_MS);
  }

  /**
   * @param {KeyboardEvent} evt
   * @returns {boolean} True if the event was handled.
   */
  handleKeyEvent(evt) {
    if (this.searcher_) {
      return this.searcher_.handleKeyEvent(evt);
    }

    switch (evt.keyCode) {
      case Key.Q: this.doSearch_(); break;
      case Key.R: this.doAddRow_(); break;
      case Key.S: this.doSave_(); break;
      case Key.T: this.doClose(); break;
    }

    return true;
  }

  /** @private */
  doAddRow_() {
    const allowedKeys = this.editorMetadata_.getAllowedPropertyKeys();
    const currentKeys = this.rows_.map(row => row.select.dataset['key']);
    let nextKey;
    for (const key of allowedKeys) {
      if (!currentKeys.includes(key)) {
        nextKey = key;
        break;
      }
    }

    if (nextKey) {
      this.editorMetadata_.setProperty(nextKey, '');
      this.rerender_();
    }
  }

  /**
   * @private
   * @param {number} i The row #.
   */
   doDeleteRow_(i) {
    /** @type {MetadataRow} */
    const deletedRow = this.rows_[i];
    const rowEl = deletedRow.select.parentElement.parentElement;
    assert(rowEl instanceof HTMLTableRowElement, `deleteRow_() did not resolve the <tr> properly`);

    const key = deletedRow.select.dataset['key'];
    assert(!!key, `The select element on the row did not have a data-key property`);

    this.editorMetadata_.removeProperty(key);
    this.rerender_();
  }

  /** @private */
  async doSave_() {
    let fileHandle = this.book_.getFileSystemHandle();
    if (!fileHandle) {
      // Ask the user where to save. Only allow saving as cbz.
      fileHandle = await window['showSaveFilePicker']({
        types: [
          {
            description: 'Comic Book Archive files',
            accept: {
              'application/vnd.comicbook+zip': ['.cbz'],
            },
          },
        ],
      });
    }

    const queryPerms = await fileHandle.queryPermission({ mode: 'readwrite' });
    if (queryPerms === 'prompt') {
      if ((await fileHandle.requestPermission({ mode: 'readwrite' })) !== 'granted') {
        return;
      }
    } else if (queryPerms !== 'granted') {
      return;
    }

    // After this point, the user has given permission to save.
    this.book_.setMetadata(this.editorMetadata_);

    const statusEl = getElem(METADATA_STATUS_ID);
    statusEl.innerHTML = 'Zipping... please wait...';

    const compressorOptions = {
      'pathToBitJS': config.get('PATH_TO_BITJS'),
    };
    const zipper = new Zipper(compressorOptions);
    let fileInfos = [];

    const comicInfoXml = createComicBookXmlFromMetadata(this.editorMetadata_);
    fileInfos.push({
      fileName: 'ComicInfo.xml',
      lastModTime: Date.now(),
      fileData: new TextEncoder().encode(comicInfoXml),
    });

    for (let i = 0, L = this.book_.getNumberOfPages(); i < L; ++i) {
      const page = this.book_.getPage(i);
      fileInfos.push({
        fileName: page.getPageName(),
        lastModTime: page.getLastModTime(),
        fileData: page.getBytes(),
      });
    }

    const startTime = Date.now();
    console.log(`Starting zip...`);
    const zipBytes = await zipper.start(fileInfos, true);
    const zipTime = Date.now();
    console.log(`... zip complete in ${zipTime - startTime}ms`)
    statusEl.innerHTML = 'Saving comic book... please wait...';
    const writableStream = await fileHandle.createWritable();
    await writableStream.write(zipBytes);
    await writableStream.close();
    console.log(`... file saved in ${Date.now() - zipTime}ms`)
    statusEl.innerHTML = 'Comic book saved!';
    setTimeout(() => statusEl.innerHTML = '', STATUS_TIMER_MS);
  }

  async doSearch_() {
    if (!Params['searchMetadata']) {
      return;
    }

    import('./metadata-search.js').then(module => {
      getElem('searchMetadataButton').style.display = 'none';
      this.searcher_ = new module.MetadataSearch(this.book_);
      this.searcher_.doOpen();
      this.hideEditorButtons_();
    });
  }

  /** @private */
  hideEditorButtons_() {
    getElem('addRowMetadataButton').style.display = 'none';
    getElem('saveMetadataButton').style.display = 'none';
    getElem('searchMetadataButton').style.display = 'none';
  }

  /** @private */
  rerender_() {
    this.rows_ = [];
    const tableTemplate = getElem('metadataTable');
    const metadataContents = document.importNode(tableTemplate.content, true);
    const tableElem = metadataContents.querySelector('table.metadataTable');
    for (const [key, value] of this.editorMetadata_.propertyEntries()) {
      if (key) {
        let rowContent = `<td>
          <select id="property-select" data-key="${key}">
            <option value="${key}">${key}</option>`;
        for (const otherKey of this.editorMetadata_.getAllowedPropertyKeys()) {
          if (key === otherKey) continue;
          rowContent += `<option value="${otherKey}">${otherKey}</option>`;
        }
        rowContent += `</select>
          </td>
          <td>
            <input id="property-value" type="text" data-key="${key}" value="${value}">
          </td>
          <td>
            <button id="deleteRowButton">x</button>
          </td>`;

        const rowElem = document.createElement('tr');
        rowElem.innerHTML = rowContent;

        this.rows_.push({
          select: rowElem.querySelector('select'),
          input: rowElem.querySelector('input'),
          deleteRowButton: rowElem.querySelector('#deleteRowButton'),
        });
        tableElem.append(rowElem);
      }
    }
    const tableContainerDiv = document.createElement('div');
    tableContainerDiv.className = 'metadataTableContainer';
    tableContainerDiv.append(tableElem);

    for (let i = 0, L = this.rows_.length; i < L; ++i) {
      const row = this.rows_[i];
      row.input.addEventListener('change', evt => {
        this.editorMetadata_.setProperty(evt.target.dataset['key'], evt.target.value);
        this.updateUI_();
      });
      row.input.addEventListener('keydown', evt => {
        evt.stopPropagation();
        this.editorMetadata_.setProperty(row.select.dataset['key'], row.input.value);
      });
      row.select.addEventListener('change', evt => {
        const select = evt.target;
        const oldKey = select.dataset['key'];
        const newKey = select.value;
        if (newKey !== oldKey) {
          this.editorMetadata_.removeProperty(oldKey);
          this.editorMetadata_.setProperty(newKey, row.input.value);
          select.dataset['key'] = newKey;
        }
        this.updateUI_();
      });
      row.deleteRowButton.addEventListener('click', evt => { this.doDeleteRow_(i); });
    }

    // Positioned at the bottom above the toolbar.
    const statusBarEl = document.createElement('div');
    statusBarEl.id = METADATA_STATUS_ID;
    statusBarEl.setAttribute('style',
        'background-color: #444; color: #yellow; position: absolute; bottom: 2em;' +
        'width: 85%; height: 1.5em; margin-bottom: 7px; border: solid 1px yellow;');
    this.updateUI_();

    this.contentDiv_.innerHTML = '';
    this.contentDiv_.append(tableContainerDiv, statusBarEl);
  }

  /**
   * Update editor UI after some event. For example, after a row key is changed, this function
   * disables key options in rows and may show the Save button.
   * @private
   */
  updateUI_() {
    const selectedValues = this.rows_.map(row => row.select.value);
    for (const row of this.rows_) {
      for (const optionEl of row.select.querySelectorAll('option')) {
        const optVal = optionEl.value;
        optionEl.disabled = selectedValues.includes(optVal) && optVal !== row.select.value;
      }
    }
    getElem('saveMetadataButton').style.display =
        this.editorMetadata_.equals(this.book_.getMetadata()) ? 'none' : '';
    const allowedKeys = this.editorMetadata_.getAllowedPropertyKeys();
    const currentKeys = this.rows_.map(row => row.select.dataset['key']);
    getElem('addRowMetadataButton').style.display =
        allowedKeys.length > currentKeys.length ? '' : 'none';
    getElem('searchMetadataButton').style.display = Params['searchMetadata'] ? '' : 'none';
  }
}
