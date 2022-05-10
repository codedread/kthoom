import { Book } from '../book.js';
import { Key, getElem } from '../common/helpers.js';
import { PublisherQueryPanel, QueryPanelState } from './metadata-query-panel.js';

/**
 * A UI component that manages a set of searches for metadata.
 */
export class MetadataSearch {
  /** @type {Book} */
  #book;

  /** @type {HTMLDivElement} */
  #contentDiv;

  /** @type {PublisherQueryPanel} */
  #publisherQueryPanel;

  /** @param {Book} book */
  constructor(book) {
    this.#book = book;
    this.#contentDiv = getElem('metadataTrayContents');
    this.#publisherQueryPanel = new PublisherQueryPanel();
  
    /**
     * The chosen publisher.
     * @private
     * @type {ComicVinePublisherResult}
     */
    this.publisher_ = null;
  }

  /** @returns {boolean} True if the editor is allowed to close. */
  doClose() {
    return true;
  }

  /**
   * Renders the search UI.
   */
  async doOpen() {
    this.rerender_();
  }

  /**
   * @param {KeyboardEvent} evt
   * @return {boolean} True if the event was handled.
   */
  handleKeyEvent(evt) {
    switch (evt.keyCode) {
      case Key.T: this.doClose(); break;
    }

    return true;
  }

  /** @private */
  rerender_() {
    this.#contentDiv.innerHTML = '';
    this.#contentDiv.append(this.#publisherQueryPanel);
    this.#publisherQueryPanel.setState(QueryPanelState.EMPTY);
  }
}
