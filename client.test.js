const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const script = fs.readFileSync('public/client.js', 'utf8');
function browser({ publicPage = true, hidden = false, admin = false } = {}) {
  const timers = new Map(), listeners = {};
  let nextId = 0, reloads = 0;
  const elements = {};
  const document = {
    hidden,
    querySelector: () => publicPage ? { content: '120' } : null,
    getElementById: id => elements[id] || null,
    querySelectorAll: () => [],
    addEventListener: (name, fn) => { listeners[name] = fn; },
  };
  vm.runInNewContext(script, { document, window: { location: { reload: () => reloads++ } },
    setTimeout: (fn, delay) => { const id = ++nextId; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  return { document, timers, listeners, elements, reloads: () => reloads };
}
test('scores refresh after two minutes and pause while a tab is hidden', () => {
  const page = browser();
  assert.equal(page.timers.size, 1);
  assert.equal([...page.timers.values()][0].delay, 120000);
  page.document.hidden = true;
  page.listeners.visibilitychange();
  assert.equal(page.timers.size, 0);
  page.document.hidden = false;
  page.listeners.visibilitychange();
  [...page.timers.values()][0].fn();
  assert.equal(page.reloads(), 1);
  assert.equal(browser({ hidden: true }).timers.size, 0);
});
test('admin pages never auto-refresh', () => {
  const page = browser({ publicPage: false, admin: true });
  assert.equal(page.timers.size, 0);
  assert.equal(page.listeners.visibilitychange, undefined);

});
