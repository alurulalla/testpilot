import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveExistingFileWithin } from '../../lib/security/safe-path.ts';

test('resolves regular files inside the allowed root', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'testpilot-safe-path-'));
  try {
    const testsDir = path.join(root, 'tests');
    mkdirSync(testsDir);
    const spec = path.join(testsDir, 'example.spec.ts');
    writeFileSync(spec, 'test');
    assert.equal(resolveExistingFileWithin(testsDir, 'example.spec.ts'), realpathSync(spec));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects traversal, absolute outside paths, directories, and escaping symlinks', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'testpilot-safe-path-'));
  try {
    const testsDir = path.join(root, 'tests');
    mkdirSync(testsDir);
    const outside = path.join(root, 'outside.spec.ts');
    writeFileSync(outside, 'test');
    symlinkSync(outside, path.join(testsDir, 'link.spec.ts'));

    assert.equal(resolveExistingFileWithin(testsDir, '../outside.spec.ts'), null);
    assert.equal(resolveExistingFileWithin(testsDir, outside), null);
    assert.equal(resolveExistingFileWithin(testsDir, '.'), null);
    assert.equal(resolveExistingFileWithin(testsDir, 'link.spec.ts'), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
