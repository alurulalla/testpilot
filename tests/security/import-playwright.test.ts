import assert from 'node:assert/strict';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { importPlaywrightProject } from '../../lib/import-playwright.ts';

function zipWith(files: Array<[string, Buffer | string]>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of files) {
    zip.addFile(name, Buffer.isBuffer(content) ? content : Buffer.from(content));
  }
  return zip.toBuffer();
}

test('accepts a bounded Playwright project', () => {
  const result = importPlaywrightProject(zipWith([
    ['playwright.config.ts', "export default { use: { baseURL: 'https://example.com' } }"],
    ['tests/home.spec.ts', "import { test } from '@playwright/test'; test('home', async () => {});"],
  ]));
  assert.equal(result.valid, true);
  if (result.valid) assert.equal(result.specFilesCount, 1);
});

test('rejects specs that collapse to the same output filename', () => {
  const result = importPlaywrightProject(zipWith([
    ['a/home.spec.ts', "test('a', () => {});"],
    ['b/HOME.spec.ts', "test('b', () => {});"],
  ]));
  assert.equal(result.valid, false);
  if (!result.valid) assert.match(result.reason, /overwrite/i);
});

test('rejects oversized expanded entries', () => {
  const result = importPlaywrightProject(zipWith([
    ['tests/large.spec.ts', Buffer.alloc(5 * 1024 * 1024 + 1)],
  ]));
  assert.equal(result.valid, false);
  if (!result.valid) assert.match(result.reason, /too large/i);
});
