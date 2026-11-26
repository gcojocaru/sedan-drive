import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const PAGES = ['Drive Real Map.html', 'Drive.html', 'Sedan.html'];
const read = f => readFileSync(new URL('../' + f, import.meta.url));
const importMap = page => JSON.parse(String(read(page)).match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]);
const sri = file => 'sha384-' + createHash('sha384').update(read(file)).digest('base64');

test('the three pages carry the same import map', () => {
  const [first, ...rest] = PAGES.map(importMap);
  for (const [i, m] of rest.entries()) assert.deepEqual(m, first, PAGES[i + 1] + ' differs from ' + PAGES[0]);
});

test('every import map entry is vendored and its integrity hash matches the file', () => {
  const { imports, integrity } = importMap(PAGES[0]);
  for (const url of Object.values(imports)) assert.ok(integrity[url], url + ' has no integrity hash');
  for (const [url, hash] of Object.entries(integrity)) {
    assert.ok(url.startsWith('./vendor/') && existsSync(new URL('../' + url, import.meta.url)), url + ' is not a vendored file');
    assert.equal(sri(url), hash, url);
  }
});

test('integrity attributes on classic scripts and stylesheets match their files', () => {
  for (const page of PAGES) for (const [, url, hash] of String(read(page)).matchAll(/(?:src|href)="(\.\/vendor\/[^"]+)" integrity="([^"]+)"/g)) assert.equal(sri(url), hash, page + ': ' + url);
});
