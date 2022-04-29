/*
 * config.js
 *
 * Licensed under the MIT License
 *
 * Copyright(c) 2020 Google Inc.
 */

let locked = false;
const map = new Map();

class ConfigService {
  constructor() { }

  /**
   * @param {String} key 
   * @returns {*} A copy of the value at that key.
   */
  get(key) {
    if (!locked) throw 'Config was not locked.  Did you forget to call lock()?';
    if (typeof key !== 'string') throw 'key must be a string';

    return map.get(JSON.parse(JSON.stringify(key)));
  }

  /**
   * @param {String} key
   * @param {*} val Any value that can be properly serialized to JSON.  This value is round-tripped
   *     through JSON.parse(JSON.stringify(val)) before stored.  Do not attempt to store code.
   * @returns {ConfigService} Returns this for chaining.
   */
  set(key, val) {
    if (locked) throw 'Config was already locked.  Cannot set more values.';
    if (typeof key !== 'string') throw 'key must be a string';
    try { map.set(key, JSON.parse(JSON.stringify(val))); }
    catch (e) { throw `JSON.parse error: ${e}`; }
    return this;
  }

  lock() {
    if (locked) throw 'Config was already locked.';
    locked = true;
  }
}

export const config = new ConfigService();
