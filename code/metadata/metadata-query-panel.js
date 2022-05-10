import { assert } from '../common/helpers.js';

/**
 * @readonly
 * @enum {number}
 */
export const QueryPanelState = {
  EMPTY: 0,
  QUERYING: 1,
  DISPLAYING_RESULTS: 2,
  RESULT_CHOSEN: 3,
}

const COMICVINE_URL = 'https://us-central1-api-project-652854531961.cloudfunctions.net/function-proxy-request';

/**
 * @typedef ComicVineResult A single result from ComicVine.
 * @property {string} id The id of the resource.
 */

/**
 * @typedef ComicVinePublisherResultType A single Publisher result from ComicVine.
 * @property {string} name The name of the publisher.
 * @property {string} site_detail_url The URL of the publisher's page on ComicVine.
 * @property {string?} aliases A newline-separated list of aliases for this publisher.
 */

/**
 * @typedef {ComicVineResult & ComicVinePublisherResultType} ComicVinePublisherResult
 */

/**
 * @typedef ComicVineResults A set of Publisher results from ComicVine.
 * @property {number} status_code
 * @property {string} error
 * @property {ComicVineResult[]} results
 * @property {number} number_of_page_results
 * @property {number} number_of_total_results
 */

/**
 * Generates shadow DOM for a query panel.
 * @param {string} label The label for the query input.
 * @param {string} placeholder The placeholder text for the query input.
 * @param {string[]} tableColumnHeadings The column headings for the search results table.
 * @returns {string} The HTML for the shadow DOM.
 */
function generateShadowDOM(label, placeholder, tableColumnHeadings) {
  let shadowDomHtml = `<style>
  .metadataSearchResultsTable span.match {
    font-weight: bold;
    text-decoration: underline;
  }
</style>
<div>
  <div id="search-form" style="display:none">
    <label for="search-input">${label}:</label>
    <input id="search-input" type="search" placeholder="${placeholder}">
    <button id="search-button">Search</button>
    <!--button id="skip-button">Skip</button-->
  </div>
  <table id="search-results-table" class="metadataSearchResultsTable" style="display:none">
    <thead>
      <tr>`;
  for (const heading of tableColumnHeadings) {
    shadowDomHtml += `        <th scope="col">${heading}</th>`;
  }
  shadowDomHtml += `      </tr>
    </thead>
    <tbody />
    <tfoot>
      <tr>
        <td id="footer-row" colspan="${tableColumnHeadings.length}">No Results</td>
      </tr>
    </tfoot>
  </table>
  <div id="chosen-result" style="display:none">
    ${label}:
    <input id="result-checkbox" type="checkbox" checked="true" data-value="">
    <label></label>
  </div>`;

  shadowDomHtml += `</div>`;
  return shadowDomHtml;
}

/** Base class. */
class MetadataQueryPanel extends HTMLElement {
  /** @protected @type {QueryPanelState} */
  state;

  /** @protected @type {string} */
  outputValue;

  /** @protected @type {HTMLDivElement} */
  formEl;
  /** @protected @type {HTMLInputElement} */
  inputEl;
  /** @protected @type {HTMLButtonElement} */
  searchButtonEl;
  /** @protected @type {HTMLTableElement} */
  resultsTableEl;
  /** @protected @type {HTMLTableRowElement} */
  footerRowEl;
  /** @protected @type {HTMLDivElement} */
  chosenResultEl;

  constructor() {
    super();
    this.attachShadowDOM();
    this.formEl = this.shadowRoot.querySelector('#search-form')
    this.inputEl = this.shadowRoot.querySelector('#search-input');
    this.searchButtonEl = this.shadowRoot.querySelector('#search-button');
    this.resultsTableEl = this.shadowRoot.querySelector('#search-results-table');
    this.footerRowEl = this.resultsTableEl.querySelector('tfoot tr');
    this.chosenResultEl = this.shadowRoot.querySelector('#chosen-result');
    this.inputEl.addEventListener('change', async evt => this.onQueryChanged(evt));
    this.resultsTableEl.addEventListener('change', async evt => this.onResultChosen(evt));
    this.setState(QueryPanelState.EMPTY);
  }

  /** @protected */
  attachShadowDOM() {
    throw `Error: MetadataQueryPanel.attachShadowDOM() not overridden`;
  }

  /**
   * @protected
   * @param {ComicVineResult} searchResult
   * @returns {string[]}
   */
  convertSearchResultToTableCellValues(searchResult) {
    throw `Error: Override MetadataQueryPanel.createShadowDOM() not overridden`;
  }

  /**
   * @protected
   * @returns {string}
   */
  createQueryURL() {
    throw `Error: MetadataQueryPanel.createQueryURL() not overridden`;
  }

  /** @param {Event} evt */
  async onQueryChanged(evt) {
    this.setState(QueryPanelState.QUERYING);
    const queryURL = this.createQueryURL();
    const resp = await fetch(queryURL);
    /** @type {ComicVineResults} */
    const comicVineResults = await resp.json();

    if (comicVineResults.error != 'OK') {
      throw `Error with results: ${comicVineResults.error}`;
    }

    const query = this.inputEl.value;
    const tbody = this.resultsTableEl.querySelector('tbody');
    tbody.innerHTML = '';
    if (comicVineResults.results.length > 0) {
      /** @type {ComicVineResult[]} */
      const searchResults = comicVineResults.results;
      for (const searchResult of searchResults) {
        const cellValues = this.convertSearchResultToTableCellValues(searchResult);
        tbody.append(this.#createTableRow(query, cellValues));
      }
    }

    this.footerRowEl.innerHTML = `Displaying ${comicVineResults.number_of_page_results} of ${comicVineResults.number_of_total_results} results`;

    this.setState(QueryPanelState.DISPLAYING_RESULTS);
  }

  /** @param {Event} evt */
  onResultChosen(evt) {
    /** @type {HTMLInputElement} */
    const checkbox = evt.target;
    this.outputValue = checkbox.dataset.value;
    checkbox.checked = false;
    this.setState(QueryPanelState.RESULT_CHOSEN);
  }

  /** @param {Event} evt */
  onUnchoose(evt) {
    this.outputValue = undefined;
    this.setState(QueryPanelState.DISPLAYING_RESULTS);
  }

  /** @param {QueryPanelState} newState */
  setState(newState) {
    if (this.state === newState) {
      return;
    }

    this.state = newState;
    switch (this.state) {
      case QueryPanelState.EMPTY:
        // Hide the table and result, show the input form, enable it, clear it, and focus it.
        this.outputValue = undefined;
        this.inputEl.disabled = false;
        this.inputEl.value = '';
        this.formEl.style.display = '';
        this.resultsTableEl.style.display = 'none';
        this.chosenResultEl.style.display = 'none';
        // TODO: This is not working!
        this.inputEl.focus();
        break;
      case QueryPanelState.QUERYING:
        // Show the table with wait message, disable the input.
        this.outputValue = undefined;
        this.inputEl.disabled = true;
        this.resultsTableEl.style.display = '';
        this.footerRowEl.innerHTML = `Please wait... searching for '${this.inputEl.value}'...`;
        this.chosenResultEl.style.display = 'none';
        break;
      case QueryPanelState.DISPLAYING_RESULTS:
        // Show the table of results, re-enable the input and re-focus it.
        this.outputValue = undefined;
        this.resultsTableEl.style.display = '';
        this.formEl.style.display = '';
        this.inputEl.disabled = false;
        this.inputEl.focus();
        this.chosenResultEl.style.display = 'none';
        break;
      case QueryPanelState.RESULT_CHOSEN:
        // Hide the table and form, show the result.
        this.formEl.style.display = 'none';
        this.resultsTableEl.style.display = 'none';
        this.chosenResultEl.style.display = '';
        this.chosenResultEl.querySelector('label').innerHTML = this.outputValue;
        const cb = this.chosenResultEl.querySelector('input');
        cb.dataset.value = this.outputValue;
        cb.checked = true;
        cb.addEventListener('change', evt => this.onUnchoose(evt));
        break;
    }
  }

  /**
   * @param {string} query 
   * @param {string[]} tableCellValues An array of HTML fragments for the search result. The first
   *     value must be raw text (not markup) and is used as the string that was searched for.
   * @returns {HTMLTableRowElement}
   */
  #createTableRow(query, tableCellValues) {
    assert(tableCellValues.length > 0);

    const rowEl = document.createElement('tr');

    // Find the index in the first cell that matches the query and split with a span.
    const nameLower = tableCellValues[0].toLowerCase();
    const queryLower = query.toLowerCase();
    const matchIndex = nameLower.indexOf(queryLower);
    let cellHtml = tableCellValues[0];
    if (matchIndex !== -1) {
      cellHtml = tableCellValues[0].substring(0, matchIndex);
      const endOfMatchIndex = matchIndex + queryLower.length;
      cellHtml += `<span class="match">${tableCellValues[0].substring(matchIndex, endOfMatchIndex)}</span>`;
      if (endOfMatchIndex < tableCellValues[0].length) {
        cellHtml += tableCellValues[0].substring(endOfMatchIndex, tableCellValues[0].length);
      }
    }
    let rowHtml = `      <tr>
        <td>
          <div>
            <input id="result-checkbox" type="checkbox" data-value="${tableCellValues[0]}">
            <label>${cellHtml}</label>
          </div>
        </td>`;

    for (let c = 1; c < tableCellValues.length; ++c) {
      rowHtml += `        <td>
          <span>${tableCellValues[c]}</span>
        </td>`;
    }
    rowHtml += `      </tr>`;
    rowEl.innerHTML = rowHtml;
    return rowEl;
  }
}

/**
 * A widget that lets the user query comic book metadata for the publisher.
 */
export class PublisherQueryPanel extends MetadataQueryPanel {
  constructor() { super(); }

  /** @override */
  attachShadowDOM() {
    this.attachShadow({mode: 'open'}).innerHTML =
        generateShadowDOM('Publisher', 'Publisher Name', ['Name', 'AKA']);
  }

  /**
   * @override
   * @param {ComicVineResult} searchResult
   * @returns {string[]}
   */
  convertSearchResultToTableCellValues(searchResult) {
    /** @type {ComicVinePublisherResult} */
    const publisherResult = {...searchResult};
    // Return name, link, aliases.
    return [
      publisherResult.name,
      `<a href="${publisherResult.site_detail_url}" title="Open ComicVine page" target="_blank">🔗</a>`,
      publisherResult.aliases?.split('\r\n').join(', ') || '',
    ];
  }

  /** @override */
  createQueryURL() {
    return `${COMICVINE_URL}/publishers?format=json&filter=name:${this.inputEl.value}&limit=20&field_list=id,name,site_detail_url,aliases`;
  }
}

customElements.define('kthoom-publisher-query-panel', PublisherQueryPanel);
