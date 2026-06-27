import assert from 'node:assert/strict';
import test from 'node:test';
import { decrypt, encrypt } from '../../lib/crypto.ts';

const TEST_KEY = '11'.repeat(32);

test('encrypts with a random IV and decrypts the original value', () => {
  const previous = process.env.KEY_ENCRYPTION_SECRET;
  process.env.KEY_ENCRYPTION_SECRET = TEST_KEY;
  try {
    const first = encrypt('secret-value');
    const second = encrypt('secret-value');
    assert.notEqual(first, second);
    assert.equal(decrypt(first), 'secret-value');
  } finally {
    if (previous === undefined) delete process.env.KEY_ENCRYPTION_SECRET;
    else process.env.KEY_ENCRYPTION_SECRET = previous;
  }
});

test('rejects tampered ciphertext and malformed authentication tags', () => {
  const previous = process.env.KEY_ENCRYPTION_SECRET;
  process.env.KEY_ENCRYPTION_SECRET = TEST_KEY;
  try {
    const encrypted = encrypt('secret-value');
    const [iv, tag, ciphertext] = encrypted.split(':');
    assert.throws(() => decrypt(`${iv}:${tag}:${ciphertext.slice(0, -2)}00`));
    assert.throws(() => decrypt(`${iv}:00:${ciphertext}`), /Invalid encrypted value format/);
  } finally {
    if (previous === undefined) delete process.env.KEY_ENCRYPTION_SECRET;
    else process.env.KEY_ENCRYPTION_SECRET = previous;
  }
});
