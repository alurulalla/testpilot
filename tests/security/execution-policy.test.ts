import assert from 'node:assert/strict';
import test from 'node:test';
import { importedExecutionBlocked } from '../../lib/security/execution-policy.ts';

const importedProject = {
  fileName: 'project.zip',
  useCases: [],
  specFilesCount: 1,
  importedAt: Date.now(),
};

test('blocks imported execution by default', () => {
  const previous = process.env.ALLOW_UNSANDBOXED_IMPORTED_TESTS;
  delete process.env.ALLOW_UNSANDBOXED_IMPORTED_TESTS;
  try {
    assert.equal(importedExecutionBlocked(importedProject), true);
    assert.equal(importedExecutionBlocked(null), false);
  } finally {
    if (previous !== undefined) process.env.ALLOW_UNSANDBOXED_IMPORTED_TESTS = previous;
  }
});

test('requires an explicit unsafe override', () => {
  const previous = process.env.ALLOW_UNSANDBOXED_IMPORTED_TESTS;
  process.env.ALLOW_UNSANDBOXED_IMPORTED_TESTS = 'true';
  try {
    assert.equal(importedExecutionBlocked(importedProject), false);
  } finally {
    if (previous === undefined) delete process.env.ALLOW_UNSANDBOXED_IMPORTED_TESTS;
    else process.env.ALLOW_UNSANDBOXED_IMPORTED_TESTS = previous;
  }
});
