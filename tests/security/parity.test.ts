import assert from 'node:assert/strict';
import test from 'node:test';
import { comparePipelineParity, type ParitySnapshot } from '../../lib/jobs/parity.ts';

function snapshot(overrides: Partial<ParitySnapshot> = {}): ParitySnapshot {
  return {
    pages: ['/a', '/b'], files: ['a.spec.ts', 'b.spec.ts'], features: ['A', 'B'],
    testResult: null, triageResult: null, figmaResult: null, status: 'complete', ...overrides,
  };
}

test('passes materially equivalent pipeline output', () => {
  const result = comparePipelineParity(snapshot(), snapshot({ pages: ['/b', '/a'] }));
  assert.equal(result.passed, true);
});

test('fails when core crawl and suite coverage regress', () => {
  const result = comparePipelineParity(snapshot(), snapshot({ pages: ['/a'], files: [] }));
  assert.equal(result.passed, false);
  assert.equal(result.metrics.find(metric => metric.name === 'sitemap')?.passed, false);
});
