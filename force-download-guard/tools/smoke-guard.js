#!/usr/bin/env node
/**
 * smoke-guard.js — guard-isolated.js の「ユーザー操作検知」のテスト
 *
 *   ポイント: スクリプトが作出した click()（isTrusted=false）は
 *              ユーザー操作として数えてはいけない。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

/* ---------------------------------------------------------- DOM スタブ -- */
const docHandlers = {};
const doc = {
  readyState: 'complete',
  body: { innerText: '' },
  documentElement: null,
  addEventListener(type, fn) { (docHandlers[type] = docHandlers[type] || []).push(fn); },
  removeEventListener() {},
  querySelectorAll() { return []; },
  querySelector() { return null; },
  createElement() { return makeEl(); },
};

/* 最小の要素 */
function makeEl() {
  const el = {
    style: { cssText: '' },
    className: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    value: '',
    isConnected: false,
    children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { this.children.push(c); return c; },
    remove() {},
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    focus() {},
    select() {},
  };
  el.attachShadow = () => ({ appendChild() {}, querySelector() { return null; } });
  return el;
}

/* ------------------------------------------------------ chrome スタブ -- */
const sent = [];
const chrome = {
  runtime: {
    sendMessage: (msg) => { sent.push(msg); return Promise.resolve({ ok: true, inScope: true, reason: 'user-site', settings: {} }); },
    onMessage: { addListener() {} },
    getURL: (p) => 'chrome-extension://test/' + p,
  },
  storage: { local: { get: async () => ({}), set: async () => {} } },
};

const ctx = vm.createContext({
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  URL, URLSearchParams, Promise, Date, chrome,
  document: doc,
  location: { href: 'https://forced-site.test/page', hostname: 'forced-site.test', origin: 'https://forced-site.test', pathname: '/page', search: '', hash: '' },
  window: { localStorage: { getItem: () => null, setItem() {} } },
  MutationObserver: class { observe() {} disconnect() {} },
});
ctx.window.document = doc;

vm.runInContext(fs.readFileSync(path.join(ROOT, 'shared.js'), 'utf8'), ctx, { filename: 'shared.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'guard-isolated.js'), 'utf8'), ctx, { filename: 'guard-isolated.js' });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async function run() {
  await wait(300);   // 初期化（fdg:init の応答）を待つ

  const results = [];
  const clickHandlers = docHandlers['click'] || [];
  const pointerHandlers = docHandlers['pointerdown'] || [];
  const keyHandlers = docHandlers['keydown'] || [];

  // 1) スクリプト作出のクリック（isTrusted=false）→ 記録されない
  sent.length = 0;
  clickHandlers.forEach((fn) => fn({ isTrusted: false, target: makeEl() }));
  pointerHandlers.forEach((fn) => fn({ isTrusted: false, target: makeEl() }));
  keyHandlers.forEach((fn) => fn({ isTrusted: false, key: 'Enter', target: makeEl() }));
  await wait(150);
  results.push(['スクリプト作出のクリックは操作として数えない',
    sent.filter((m) => m.type === 'fdg:gesture').length === 0]);

  // 2) 実際のユーザー操作 → 記録される
  sent.length = 0;
  clickHandlers.forEach((fn) => fn({ isTrusted: true, target: makeEl() }));
  await wait(150);
  results.push(['実際のクリックは操作として記録する',
    sent.filter((m) => m.type === 'fdg:gesture').length > 0]);

  // 3) 実際のキー操作（Enter）も記録される
  sent.length = 0;
  keyHandlers.forEach((fn) => fn({ isTrusted: true, key: 'Enter', target: makeEl() }));
  await wait(150);
  results.push(['Enter キーは操作として記録する',
    sent.filter((m) => m.type === 'fdg:gesture').length > 0]);

  let failed = 0;
  console.log('');
  results.forEach(([name, cond]) => {
    if (!cond) failed++;
    console.log((cond ? '  PASS  ' : '  FAIL  ') + name);
  });
  console.log('\n' + (results.length - failed) + '/' + results.length + ' passed');
  process.exit(failed ? 1 : 0);
})();
