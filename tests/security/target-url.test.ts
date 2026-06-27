import assert from 'node:assert/strict';
import test from 'node:test';
import { validateTargetUrl } from '../../lib/security/target-url.ts';

const rejected = [
  'file:///etc/passwd',
  'javascript:alert(1)',
  'http://user:password@example.com',
  'http://localhost:3000',
  'http://127.0.0.1',
  'http://10.0.0.1',
  'http://169.254.169.254/latest/meta-data',
  'http://[::1]',
  'http://[::ffff:127.0.0.1]',
];

for (const url of rejected) {
  test(`rejects unsafe target ${url}`, async () => {
    await assert.rejects(validateTargetUrl(url));
  });
}

test('private targets require an explicit development override', async () => {
  const previous = process.env.ALLOW_PRIVATE_TEST_TARGETS;
  process.env.ALLOW_PRIVATE_TEST_TARGETS = 'true';
  try {
    assert.equal((await validateTargetUrl('http://127.0.0.1:3000')).hostname, '127.0.0.1');
  } finally {
    if (previous === undefined) delete process.env.ALLOW_PRIVATE_TEST_TARGETS;
    else process.env.ALLOW_PRIVATE_TEST_TARGETS = previous;
  }
});
