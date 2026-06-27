import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDiscoverPayload } from '../../lib/jobs/discover-payload.ts';

test('applies bounded discover defaults', () => {
  assert.deepEqual(parseDiscoverPayload({}), { depth: 2, maxPages: 10 });
  assert.deepEqual(parseDiscoverPayload({ depth: 3, maxPages: 50 }), { depth: 3, maxPages: 50 });
});

test('rejects unsafe discover bounds', () => {
  assert.throws(() => parseDiscoverPayload({ depth: -1 }), /depth/);
  assert.throws(() => parseDiscoverPayload({ depth: 6 }), /depth/);
  assert.throws(() => parseDiscoverPayload({ maxPages: 0 }), /maxPages/);
  assert.throws(() => parseDiscoverPayload({ maxPages: 501 }), /maxPages/);
});
