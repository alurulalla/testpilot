import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGeneratePayload } from '../../lib/jobs/generate-payload.ts';

test('applies bounded generate defaults', () => {
  assert.deepEqual(parseGeneratePayload({}), { depth: 2, maxPages: 10 });
  assert.deepEqual(parseGeneratePayload({ depth: 5, maxPages: 100 }), { depth: 5, maxPages: 100 });
});

test('rejects unsafe generate bounds', () => {
  for (const payload of [{ depth: 0 }, { depth: 6 }, { maxPages: 0 }, { maxPages: 101 }, { maxPages: 1.5 }]) {
    assert.throws(() => parseGeneratePayload(payload));
  }
});
