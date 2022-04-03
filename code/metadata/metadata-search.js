import { Key, getElem } from '../common/helpers.js';

const COMICVINE_URL = 'https://us-central1-api-project-652854531961.cloudfunctions.net/function-proxy-request';
const PUBLISHER_SEARCH = 'publisher-search';
const PUBLISHER_SEARCH_BUTTON = 'publisher-search-button';
const PUBLISHER_SEARCH_RESULTS = 'publisher-search-results';
const PUBLISHER_SKIP_BUTTON = 'publisher-skip-button';

// TODO: Add in the concept of search "stages", which you can sometimes skip (like Publisher)?
// TODO: Trigger when a checkbox is clicked, remove the table and just have the single checked publisher value.
// TODO: If the chosen publisher is unchecked, go back to Publisher stage, re-render table, etc.

/**
 * @typedef ComicVinePublisherResult A single Publisher result from ComicVine.
 * @property {string} id The id of the publisher.
 * @property {string} name The name of the publisher.
 * @property {string} site_detail_url The URL of the publisher's page on ComicVine.
 * @property {string?} aliases A newline-separated list of aliases for this publisher.
 */

/**
 * @typedef ComicVinePublisherResults A set of Publisher results from ComicVine.
 * @property {string} error
 * @property {ComicVinePublisherResult[]} results
 */

/**
 * A UI component that manages a set of searches for metadata.
 */
export class MetadataSearch {
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
     * @private
     * @type {HTMLDivElement}
     */
    this.contentDiv_ = getElem('metadataTrayContents');
  
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

    // const numPages = this.book_.getNumberOfPages();
    // if (numPages > 0) {
    //   // TODO: Let user search for a volume first.
    //   const volumeName = 'Showcase';
    //   const queryUrl = `${COMICVINE_URL}/search?format=json&query=${volumeName}&resources=volume,issue`;
    //   const resp = await fetch(queryUrl);
    //   const json = await resp.json();
    //   debugger;
    // }
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

  /**
   * @param {string} id
   * @param {string[]} headings
   * @returns {string} HTML for the table
   * @private
   */
  createTable_(id, headings) {
    let tableHtml = `<table id="${id}" class="metadataSearchResultsTable" style="display:none"><tr>`;
    for (const heading of headings) {
      tableHtml += `<th scope="col">${heading}</th>`;
    }
    tableHtml += `</tr><tfoot><tr><td colspan="${headings.length}">No Results</td></tr></tfoot></table>`;
    return tableHtml;
  }

  /** @private */
  rerender_() {
    const metadata = this.book_.getMetadata();
    const publisher = metadata.getProperty() || '';
    let searchHtml =
        `<div>
           <label for="${PUBLISHER_SEARCH}">Publisher:</label>
         </div>
         <input id="${PUBLISHER_SEARCH}" type="search"
                placeholder="Publisher Name"
                value="${publisher}">
         <button id="${PUBLISHER_SEARCH_BUTTON}">Search</button>
         <button id="${PUBLISHER_SKIP_BUTTON}">Skip</button>`;
    // TODO: Add Search and Skip buttons.

    searchHtml += this.createTable_(PUBLISHER_SEARCH_RESULTS, ['Name', 'AKA']);

    this.contentDiv_.innerHTML = searchHtml;

    const publisherSearch = getElem(PUBLISHER_SEARCH);
    publisherSearch.focus();
    publisherSearch.addEventListener('change', async evt => {
      const queryUrl = `${COMICVINE_URL}/publishers?format=json&filter=name:${publisherSearch.value}&limit=20&field_list=id,name,site_detail_url,aliases`;
      try {
        /** @type {HTMLTableElement} */
        const publisherResultsTable = getElem(PUBLISHER_SEARCH_RESULTS);
        publisherResultsTable.style.display = '';
        const footer = publisherResultsTable.querySelector('tfoot tr td');
        footer.innerHTML = 'Please wait... searching...';

        const resp = await fetch(queryUrl);
        /** @type {ComicVinePublisherResults} */
        const publisherResults = await resp.json();

        if (publisherResults.error != 'OK') {
          throw `Error with results: ${publisherResults.error}`;
        }
        if (publisherResults.results.length > 0) {
          const bodyEl = publisherResultsTable.querySelector('tbody');
          for (const result of publisherResults.results) {
            const aliases = result.aliases?.split('\r\n').join(', ') || '';
            const rowEl = document.createElement('tr');
            // Find the index in result.name that matches the query and split with a span.
            const nameLower = result.name.toLowerCase();
            const queryLower = publisherSearch.value.toLowerCase();
            const matchIndex = nameLower.indexOf(queryLower);
            let nameHtml = result.name;
            if (matchIndex !== -1) {
              nameHtml = result.name.substring(0, matchIndex);
              const endOfMatchIndex = matchIndex + queryLower.length;
              nameHtml += `<span class="match">${result.name.substring(matchIndex, endOfMatchIndex)}</span>`;
              if (endOfMatchIndex < result.name.length) {
                nameHtml += result.name.substring(endOfMatchIndex, result.name.length);
              }
            }
            rowEl.innerHTML = `<tr>
                <td>
                  <div id="publisher">
                    <input type="checkbox" name="publisher" id="${result.id}">
                    <label>${nameHtml} <a href="${result.site_detail_url}" title="Open ComicVine page" target="_blank">🔗</a></label>
                  </div>
                </td>
                <td><span title="${aliases}">${aliases}</span></td>
              </tr>`;
            const checkboxEl = rowEl.querySelector('input');
            checkboxEl.addEventListener('change', evt => {
              if (checkboxEl.checked) {
                this.publisher_ = result;
                // Wipe out table and preserve result.
                const parent = publisherResultsTable.parentElement;
                const resultDiv = checkboxEl.parentElement;
                parent.appendChild(resultDiv);
                parent.removeChild(publisherResultsTable);
              } else {
                // TODO: Deal with unchecks.
              }
            });
            bodyEl.appendChild(rowEl);
          }
          footer.innerHTML = `&nbsp;↑ Pick a publisher`;
        }
      } catch (err) {
        console.error(err);
        footer.innerHTML = 'Error searching. Please try again.';
      }
    });

  }
}