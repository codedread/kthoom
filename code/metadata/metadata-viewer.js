import { Book } from '../book.js';
import { Key, getElem } from '../common/helpers.js';

/**
 * A UI component that lets the user view the metadata of a book.
 */
export class MetadataViewer {
  constructor() {
    /**
     * @private
     * @type {Book}
     */
    this.book_ = null;

    /**
     * @private
     * @type {HTMLDivElement}
     */
    this.contentDiv_ = getElem('metadataTrayContents');

    /**
     * @private
     * @type {HTMLTemplateElement}
     */
    this.tableTemplate_ = getElem('metadataTable');

    /**
     * @private
     * @type {MetadataEditor}
     */
    this.editor_ = null;

    getElem('metadataViewerButton').addEventListener('click', () => this.toggleOpen());
    getElem('metadataViewerOverlay').addEventListener('click', () => this.toggleOpen());
    getElem('closeMetadataButton').addEventListener('click', () => this.doClose());

    // Only show the toolbar if editMetadata flag is true and the browser supports the
    // File System Access API (for now).
    if (window['showSaveFilePicker']) {
      const toolbarDiv = getElem('metadataToolbar');
      toolbarDiv.style.display = '';
      getElem('editMetadataButton').addEventListener('click', () => this.doEdit());
    }
  }

  /**
   * If the editor is open, close that and release the editor. Otherwise, close the MetadataViewer
   * tray.
   */
  doClose() {
    if (!this.isOpen()) {
      return;
    }

    if (this.editor_) {
      // doClose() returning true means the editor should be released.
      if (this.editor_.doClose()) {
        this.editor_ = null;
        const editButton = getElem('editMetadataButton');
        editButton.style.display = '';
        this.rerender_();
      }
    } else {
      this.toggleOpen();
    }
  }

  /** Load the code for MetadataEditor and show it. */
  doEdit() {
    if (this.editor_) {
      return;
    }

    import('./metadata-editor.js').then(module => {
      getElem('editMetadataButton').style.display = 'none';
      this.editor_ = new module.MetadataEditor(this.book_);
      this.editor_.doOpen();
    });
  }

  /**
   * @param {KeyboardEvent} evt
   * @return {boolean} True if the event was handled.
   */
  handleKeyEvent(evt) {
    if (!this.isOpen()) {
      return false;
    }

    if (this.editor_) {
      return this.editor_.handleKeyEvent(evt);
    }

    switch (evt.keyCode) {
      case Key.T: this.doClose(); break;
      case Key.E: this.doEdit(); break;
    }

    return true;
  }

  /** @returns {boolean} */
  isOpen() {
    return getElem('metadataViewer').classList.contains('opened');
  }

  reset() {
    this.book_ = null;
    this.rerender_();
  }

  /**
   * Called to set the state of the metadata viewer and render it.
   * @param {Book} book
   */
  setBook(book) {
    this.book_ = book;
    this.rerender_();
  }

  /**
   * Opens or closes the metadata viewer pane. Only works if the MetadataViewer has a book and only
   * if the Editor is not open.
   */
  toggleOpen() {
    if (!this.book_) {
      return;
    }
    // TODO: Let the user know they need to close the metadata editor first via a toast or callout.
    if (this.editor_) {
      return;
    }
    getElem('metadataViewer').classList.toggle('opened');
    getElem('metadataViewerOverlay').classList.toggle('hidden');
  }

  /** @private */
  rerender_() {
    if (this.book_) {
      const metadata = this.book_.getMetadata();
      const metadataContents = document.importNode(this.tableTemplate_.content, true);
      const tableElem = metadataContents.querySelector('table.metadataTable');
      const rowTemplate = getElem('metadataTableRow');
      for (const [key, value] of metadata.propertyEntries()) {
        if (key && value) {
          const rowElem = document.importNode(rowTemplate.content, true);
          rowElem.querySelector('td.metadataPropName').textContent = key;
          rowElem.querySelector('td.metadataPropValue').textContent = value;
          tableElem.appendChild(rowElem);
        }
      }

      this.contentDiv_.innerHTML = '';
      this.contentDiv_.appendChild(tableElem);

      const hasMetadata = Array.from(metadata.propertyEntries()).length > 0;
      getElem('metadataIsPresent').style.display = hasMetadata ? '' : 'none';
    } else {
      this.contentDiv_.innerHTML = 'No book loaded';
    }
  }
}
