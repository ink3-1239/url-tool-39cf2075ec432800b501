#!/usr/bin/env node
/**
 * smoke-sites.js — sites.html / sites.js の最小 DOM スタブによる起動テスト
 *   拡張機能として読み込まれていない（standalone）状況を想定する。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function makeEl(id) {
  const el = {
    id,
    _children: [],
    textContent: '',
    value: '',
    hidden: false,
    disabled: false,
    className: '',
    type: 'text',
    style: {},
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; this._children = []; },
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, on) { if (on === undefined) { this._set.has(c) ? this._set.delete(c) : this._set.add(c); } else if (on) { this._set.add(c); } else { this._set.delete(c); } },
      contains(c) { return this._set.has(c); },
    },
    _handlers: {},
    addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn); },
    fire(type, ev) {
      (this._handlers[type] || []).forEach((fn) => fn(Object.assign({ preventDefault() {} }, ev || {})));
    },
    appendChild(c) { this._children.push(c); return c; },
    removeChild(c) { this._children = this._children.filter((x) => x !== c); },
    focus() {},
    select() {},
    get children() { return this._children; },
  };
  return el;
}

const els = new Map();
function getEl(id) {
  if (!els.has(id)) els.set(id, makeEl(id));
  return els.get(id);
}

const store = new Map();
const ctx = vm.createContext({
  console,
  setTimeout,
  clearTimeout,
  URL,
  URLSearchParams,
  Promise,
  Date,
  document: {
    readyState: 'complete',
    body: makeEl('body'),
    getElementById: (id) => getEl(id),
    createElement: () => makeEl('created'),
    _handlers: {},
    addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn); },
    fire(type, ev) {
      (this._handlers[type] || []).forEach((fn) => fn(Object.assign({ preventDefault() {} }, ev || {})));
    },
  },
  location: {
    search: '?add=https://evil.example.com/path',
    pathname: '/sites.html',
    hash: '',
    origin: 'http://localhost:8000',
  },
  history: { replaceState() {} },
  navigator: { clipboard: { writeText: async () => {} } },
  window: {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
    },
  },
  // chrome は未定義（standalone を再現）
});
ctx.window.localStorage = ctx.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, v),
};

vm.runInContext(fs.readFileSync(path.join(ROOT, 'shared.js'), 'utf8'), ctx, { filename: 'shared.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'sites.js'), 'utf8'), ctx, { filename: 'sites.js' });

setTimeout(() => {
  const status = getEl('status');
  const count = getEl('site-count');
  const list = getEl('site-list');
  const ok = [];
  ok.push(['deep link で自動登録される', list.children.length === 1]);
  ok.push(['件数が更新される', count.textContent === '1']);
  ok.push(['ステータスが表示される', status.textContent.includes('evil.example.com')]);
  ok.push(['入力欄がクリアされる', getEl('site-input').value === '']);
  ok.push(['即登録URLが表示される', getEl('deeplink').value.includes('chrome-extension://pdndkdcaipoifeljbgbkekdeojbdkagh/sites.html?add=')]);
  ok.push(['ブックマークレットが生成される', getEl('bookmarklet').value.startsWith('javascript:')]);

  // 決定ボタン（フォーム送信）で 2 件目を登録できること
  getEl('site-input').value = 'https://safe-work.example.com/app';
  getEl('site-form').fire('submit');
  setTimeout(() => {
    ok.push(['決定ボタンで追加できる', list.children.length === 2]);
    ok.push(['2 件目が表示される', count.textContent === '2']);
    ok.push(['保存されている', JSON.parse(store.get('fdg.protectedSites') || '[]').length === 2]);

    let failed2 = 0;
    console.log('');
    ok.forEach(([name, cond]) => {
      if (!cond) failed2++;
      console.log((cond ? '  PASS  ' : '  FAIL  ') + name);
    });
    console.log('\n' + (ok.length - failed2) + '/' + ok.length + ' passed');
    process.exit(failed2 ? 1 : 0);
  }, 150);

}, 200);
