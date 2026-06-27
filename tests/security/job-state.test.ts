import assert from 'node:assert/strict';
import test from 'node:test';
import { assertJobTransition, canTransitionJob, isTerminalJobStatus } from '../../lib/jobs/types.ts';

test('permits the durable job happy path', () => {
  assert.equal(canTransitionJob('queued', 'running'), true);
  assert.equal(canTransitionJob('running', 'succeeded'), true);
  assert.doesNotThrow(() => assertJobTransition('running', 'retrying'));
  assert.equal(canTransitionJob('retrying', 'running'), true);
});

test('rejects terminal and invalid transitions', () => {
  assert.equal(isTerminalJobStatus('succeeded'), true);
  assert.equal(isTerminalJobStatus('cancelled'), true);
  assert.equal(canTransitionJob('succeeded', 'running'), false);
  assert.throws(() => assertJobTransition('queued', 'succeeded'), /Invalid job transition/);
});
