import assert from 'node:assert/strict';
import test from 'node:test';
import {
  failureSignature,
  parsePipelineCheckpoint,
  parsePipelinePayload,
} from '../../lib/jobs/pipeline-state.ts';

test('validates pipeline bounds and restart checkpoints', () => {
  assert.deepEqual(parsePipelinePayload({}), { maxIterations: 3 });
  assert.deepEqual(parsePipelineCheckpoint({ stage: 'healed', iteration: 2 }), {
    stage: 'healed', iteration: 2,
  });
  assert.throws(() => parsePipelinePayload({ maxIterations: 0 }));
  assert.throws(() => parsePipelinePayload({ maxIterations: 11 }));
});

test('creates a stable sorted failure signature', () => {
  assert.equal(failureSignature({ z: 'failed', a: 'failed', p: 'passed' }), 'a|z');
});
