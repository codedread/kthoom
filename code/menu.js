/**
 * menu.js
 *
 * Licensed under the MIT License
 *
 * Copyright(c) 2019 Google Inc.
 */

import { assert, getElem, Key, Params } from './common/helpers.js';

const MENU_OPEN_STYLE = 'position:absolute;opacity:0.875;text-align:left;'
const MENU_CLOSED_STYLE = 'display:none;' + MENU_OPEN_STYLE;
const MENU_OVERLAY_OPEN_STYLE = 'position:absolute;bottom:0;left:0;right:0;top:0;';
const MENU_OVERLAY_CLOSED_STYLE = 'display:none;' + MENU_OVERLAY_OPEN_STYLE;
const MENU_CONTAINER = 'allMenus';

/**
 * Problems we are trying to solve:
 * - basically menu is not encapsulated and re-useable... plus:
 * - lots of markup for menus in the main html (120 lines for 4 menus with 18 menu items)
 * - lots of duplicated markup for each menu item
 * - lots of code to manage menus in calling code (kthoom.js, initMenus_())
 * - non-portable component with non-portable styling
 *
 * New idea:
 * - use custom elements to define app-menu-item and app-menu
 * - the custom elements use shadow dom to hide their DOM contents, and include the style (remove from kthoom.js)
 * - the custom elements have attributes that are observed: action-type
 * - the app-menu-item uses a template with slots to fill in menu item text and shortcut key
 * - the calling code instantiates an app-menu element, then creates app-menu-item objects to add to it (this can be a factory method)
 * - the calling code establishes the relationships between menus/sub-menus.
 * - the calling code establishes what happens when each menu item is selected/clicked
 *
 *  - menu items can have different properties:
 *    - id: optional
 *    - type: separate, toggle, file, sub-menu
 *    - an item of type toggle gets a separate property of whether it should be checked or not (default not)
 *    - an item of type file gets a separate property of whether the file picker should allow multiple files (default not)
 *    - an item of type gets a reference to the AppMenu representing its sub-menu
 *
 *  <app-menu id="temp-openMenu" aria-label="OpenMenu">
 *    <app-menu-item id="open-local-files" action-type="file-multiple" shorcut-key="O"></app-menu-item>
 *    <app-menu-item id="open-url" shortcut-key="U"></app-menu-item>
 *    <app-menu-item id="open-google-drive" shortcut-key="G" show="false"></app-menu-item>
 *    <app-menu-item id="open-ipfs-hash" shortcut-key="I" show="false"></app-menu-item>
 *  </app-menu>
 *
 * Calling code:
 *
 * this.openMenu_ = new AppMenu({id: 'open-menu'});
 * this.openMenu_.appendChild(createMenuItem({
 *   label: 'Open local file',
 *   shortcutKey: Key.O,
 *   type: AppMenuItemType.FILE,
 *   mode: FileMode.MULTIPLE,
 * }, () => this.openLocalFiles_()));
 *
 * this.viewMenu_ = new AppMenu({id: 'view-menu'});
 * this.onePageMenuItem_ = createMenuItem({
 *   label: '1-page viewer',
 *   shorcutKey: Key.NUM_1,
 *   type: AppMenuItemType.TOGGLE,
 *   selected: true,
 * }, () => this.setPageMode_(1));
 * this.viewMenu_.appendChild(this.onePageMenuItem_);
 *
 * this.mainMenu_ = new AppMenu();
 * this.mainMenu.appendChild(createMenuItem({ menu: this.openMenu_ }));
 * this.mainMenu.appendChild(createMenuItem({ menu: this.viewMenu_ }));
 */
/**
 * @type {Set<Menu>}
 */
const openMenus = new Set();

function createOverlay() {
  const menuContainer = document.createElement('div');
  menuContainer.id = MENU_CONTAINER;
  document.body.appendChild(menuContainer);

  const overlayEl = document.createElement('div');
  overlayEl.style = MENU_OVERLAY_CLOSED_STYLE;
  overlayEl.addEventListener('click', evt => {
    // Close all open menus.
    for (const menu of openMenus.values()) {
      menu.close();
    }
  });
  menuContainer.appendChild(overlayEl);
  return overlayEl;
}

/**
 * This div is used to cover the app's DOM.  Any clicks on it will close all open menus.
 */
const overlay = createOverlay();


/** @type {Object<String, String>} */
export const MenuEventType = {
  UNKNOWN: 'menu-unknown-event',
  CLOSE: 'menu-close',
  ITEM_SELECTED: 'menu-item-select',
  OPEN: 'menu-open',
};

export class MenuEvent extends Event {
  constructor(menu, type = MenuEventType.UNKNOWN, item = undefined) {
    super(type);
    /** @type {Menu} */
    this.menu = menu;
    /** @type {Node?} */
    this.item = item;
  }
}

/**
 * A menu owns its DOM, is constructed from a list of menu items and manages rendering and
 * interaction.  Clients create menus and add event listeners for when menu items are selected.
 */
export class Menu extends EventTarget {
  /** @type {HTMLDivElement} */
  #dom = undefined;

  /** @type {Map<string, Menu>} */
  #subMenuMap = new Map();

  /** @private {Menu} */
  #openedSubMenu = null;

  /**
   * @param {HTMLTemplateElement} templateEl 
   */
  constructor(templateEl) {
    super();

    this.#createDom(templateEl);
  }

  /**
   * @param {string} menuItemId
   * @param {Menu} subMenu
   */
  addSubMenu(menuItemId, subMenu) {
    assert(!Array.from(this.#subMenuMap.values()).includes(subMenu), 'Submenu already part of this menu.');
    assert(!this.#subMenuMap.has(menuItemId), `Menu already has a submenu mapped for ${menuItemId}`);
    const menuEl = this.#dom.firstElementChild;
    const menuItem = menuEl.querySelectorAll(`[id="${menuItemId}"][role="menuitem"]`);
    assert(!!menuItem, `Menu item "${menuItemId} not found in menu`);

    this.#subMenuMap.set(menuItemId, subMenu);
  }

  /**
   * If the last menu is closed, the menu overlay is also hidden.
   */
  close() {
    assert(openMenus.has(this), 'Menu was already closed!');
    if (this.#openedSubMenu) {
      if (this.#openedSubMenu.isOpen()) {
        this.#openedSubMenu.close();
      }
      this.#openedSubMenu = null;
    }

    this.#dom.style = MENU_CLOSED_STYLE;
    openMenus.delete(this);
    this.dispatchEvent(new MenuEvent(this, MenuEventType.CLOSE));

    if (openMenus.size === 0) {
      overlay.style = MENU_OVERLAY_CLOSED_STYLE;
    }
  }

  /**
   * @param {KeyboardEvent} evt
   * @returns {boolean} True if the event was handled.
   */
  handleKeyEvent(evt) {
    if (!this.isOpen()) {
      return false;
    }

    const code = evt.keyCode;

    const closeKeys = [Key.ESCAPE, Key.TAB, Key.LEFT];
    if (this.#openedSubMenu && !closeKeys.includes(code)) {
      return this.#openedSubMenu.handleKeyEvent(evt);
    }

    if (closeKeys.includes(code)) {
      if (this.#openedSubMenu) {
        if (this.#openedSubMenu.isOpen()) {
          this.#openedSubMenu.close();
        }
        // Find the appropriate menu item and focus is.
        for (const menuItemId of this.#subMenuMap.keys()) {
          const subMenu = this.#subMenuMap.get(menuItemId);
          if (subMenu === this.#openedSubMenu) {
            const menuItem = getElem(menuItemId);
            menuItem.setAttribute('aria-expanded', 'false');
            menuItem.focus();
            break;
          }
        }
        this.#openedSubMenu = null;
      } else {
        this.close();
      }
      return true;
    }

    switch (code) {
      case Key.UP:
        evt.preventDefault();
        evt.stopPropagation();
        this.#focusMenuItem(-1);
        return true;
      case Key.DOWN:
        evt.preventDefault();
        evt.stopPropagation();
        this.#focusMenuItem(1);
        return true;
      case Key.RIGHT:
        const currentlyFocusedMenuItem = document.activeElement;
        const menuItemId = currentlyFocusedMenuItem.id;
        if (this.#subMenuMap.has(menuItemId)) {
          const subMenu = this.#subMenuMap.get(menuItemId);
          subMenu.open(currentlyFocusedMenuItem.offsetWidth, currentlyFocusedMenuItem.offsetTop);
          this.#openedSubMenu = subMenu;
          return true;
        }
        break;
      case Key.ENTER:
        // We need to return true so that the event propagates up to the browser with the menu item
        // still focused so that a 'click' event occurs.  The click handler closes the menu.
        return true;
    }
    // Otherwise, the menu did not process the event and something above us should.
    this.close();
    return false;
  }

  /** @returns {boolean} */
  isOpen() {
    return !(this.#dom.style.display === 'none');
  }

  /**
   * @param {number} left The left px value.
   * @param {number} top The top px value.
   */
  open(left = 0, top = 0) {
    assert(!openMenus.has(this), 'Menu was already open!');
    overlay.style = MENU_OVERLAY_OPEN_STYLE;
    const style = MENU_OPEN_STYLE + `left:${left}px;top:${top}px;`;
    this.#dom.style = style;
    openMenus.add(this);
    this.dispatchEvent(new MenuEvent(this, MenuEventType.OPEN));

    const menuEl = this.#dom.firstElementChild;
    const firstMenuElem = menuEl.querySelector('[role="menuitem"]:not([disabled="true"])');
    firstMenuElem.focus();
  }

  /**
   * Sets the selected state on a menu item.  Assumes the menu item has a span with the
   * menuCheckmark class.
   * @param {string} itemId 
   * @param {boolean} selected True to select, false to de-select.
   */
  setMenuItemSelected(itemId, selected) {
    const menuEl = this.#dom.firstElementChild;
    const menuItemCheckmark = menuEl.querySelector(`[id="${itemId}"][role="menuitem"] .menuCheckmark`);
    assert(!!menuItemCheckmark, `Could not find checkmark span for menu item ${itemId}`);

    menuItemCheckmark.innerHTML = selected ? '✔︎' : '&nbsp;';
  }

  /**
   * Gets the selected state on a menu item.  Assumes the menu item has a span with the
   * menuCheckmark class.
   * @param {string} itemId 
   * @returns {boolean} True if the menu item is selected
   */
  getMenuItemSelected(itemId) {
    const menuEl = this.#dom.firstElementChild;
    const menuItemCheckmark = menuEl.querySelector(`[id="${itemId}"][role="menuitem"] .menuCheckmark`);
    assert(!!menuItemCheckmark, `Could not find checkmark span for menu item ${itemId}`);
    let selected = false;
    if (menuItemCheckmark.innerHTML === '✔︎' ) {
      selected = true;
    } else if(menuItemCheckmark.innerHTML === '&nbsp;') {
      selected = false;
    }    
    return selected;
  }

  /**
   * @param {string} itemId 
   * @param {boolean} show True to show, false to hide.
   */
  showMenuItem(itemId, show) {
    const menuEl = this.#dom.firstElementChild;
    const menuItem = menuEl.querySelector(`[id="${itemId}"][role="menuitem"]`);
    assert(!!menuItem, `Could not find menu item ${itemId}`);
    menuItem.style.display = show ? '' : 'none';
    if (show) {
      menuItem.removeAttribute('disabled');
    } else {
      menuItem.setAttribute('disabled', 'true');
    }
  }

  /**
   * @param {HTMLTemplateElement} templateEl
   */
  #createDom(templateEl) {
    assert(!this.#dom, 'DOM for Menu was already created when #createDom() was called');

    this.#dom = document.createElement('div');
    this.#dom.style = MENU_CLOSED_STYLE;
    this.#dom.appendChild(document.importNode(templateEl.content, true));

    // TODO: Do some validation on the DOM here.
    getElem(MENU_CONTAINER).appendChild(this.#dom);

    // Add all click listeners here.
    const menuEl = this.#dom.firstElementChild;
    for (const menuItem of menuEl.querySelectorAll('[role="menuitem"]')) {
      menuItem.addEventListener('click', evt => {
        const menuItemId = menuItem.id;
        let previouslyOpenedSubMenu = null;
        if (this.#openedSubMenu) {
          if (this.#openedSubMenu.isOpen()) {
            previouslyOpenedSubMenu = this.#openedSubMenu;
            this.#openedSubMenu.close();
          }
          this.#openedSubMenu = null;
        }
        if (this.#subMenuMap.has(menuItemId)) {
          const maybeOpenSubMenu = this.#subMenuMap.get(menuItemId);
          const menuItemEl = evt.target;
          if (maybeOpenSubMenu !== previouslyOpenedSubMenu) {
            menuItemEl.setAttribute('aria-expanded', 'true');
            this.#openedSubMenu = maybeOpenSubMenu;
            this.#openedSubMenu.open(menuItemEl.offsetWidth, menuItemEl.offsetTop);
          } else {
            menuItemEl.setAttribute('aria-expanded', 'false');
            menuItemEl.focus();
            this.dispatchEvent(new MenuEvent(this, MenuEventType.ITEM_SELECTED, menuItem));
          }
        } else {
          this.close();
          this.dispatchEvent(new MenuEvent(this, MenuEventType.ITEM_SELECTED, menuItem));
        }
      });
    }
  }

  /**
   * Assumes the menu is open.  Moves the menu item focus.
   * @param {Number} delta Can be negative (up) or positive (down)
   */
  #focusMenuItem(delta = 1) {
    const menuEl = this.#dom.firstElementChild;
    const menuItems = menuEl.querySelectorAll('[role="menuitem"]:not([disabled="true"])');
    const numMenuItems = menuItems.length;
    const currentlyFocusedMenuItem = document.activeElement;
    let i = 0;
    for (; i < numMenuItems; ++i) {
      const menuItem = menuItems.item(i);
      if (menuItem === currentlyFocusedMenuItem) {
        break;
      }
    }
    // If somehow the currently focused item is not in the menu, then start at the top of the menu.
    if (i === menuItems.length) {
      i = 0;
    }

    i += delta;
    while (i >= numMenuItems) {
      i -= numMenuItems;
    }
    while (i < 0) {
      i += numMenuItems;
    }

    const newlySelectedMenuItem = menuItems.item(i);
    newlySelectedMenuItem.focus();
  }
}
