import test from 'node:test';
import assert from 'node:assert/strict';
import { stored, keep } from '../storage.js';

test('stored values come back parsed, and blocked or broken storage never throws', () => {
  const box = new Map();
  globalThis.localStorage = { getItem: k => box.has(k) ? box.get(k) : null, setItem: (k, v) => box.set(k, String(v)) };
  keep('obj', { cash: 5 }); keep('n', 2); keep('on', true); keep('car', 'vaz');
  assert.deepEqual(stored('obj'), { cash: 5 });
  assert.equal(stored('n'), 2); assert.equal(stored('on'), true);
  assert.equal(box.get('car'), 'vaz', 'text is kept as it is (older pages read it raw)');
  assert.equal(stored('car'), 'vaz');
  box.set('bad', '{"cash": 5'); assert.equal(stored('bad'), '{"cash": 5', 'a damaged value comes back as text, not an exception');
  assert.equal(stored('missing'), null);
  globalThis.localStorage = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } };
  assert.equal(stored('obj'), null);
  assert.doesNotThrow(() => keep('obj', { cash: 1 }));
  delete globalThis.localStorage;
  assert.equal(stored('obj'), null, 'no storage at all (Node)');
});
