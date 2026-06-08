/**
 * AES-256-GCM encryption helpers for org API keys stored at rest.
 *
 * Uses Node's built-in `crypto` module — no extra dependencies.
 * Each encryption generates a fresh random IV so the same plaintext produces
 * a different ciphertext every time (prevents pattern analysis).
 *
 * Storage format: "<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;   // 96-bit IV — recommended for GCM
const TAG_LENGTH = 16;  // 128-bit auth tag

function getEncryptionKey(): Buffer {
  const secret = process.env.KEY_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error(
      'KEY_ENCRYPTION_SECRET is not set. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  const key = Buffer.from(secret, 'hex');
  if (key.length !== 32) {
    throw new Error(
      `KEY_ENCRYPTION_SECRET must be a 64-character hex string (32 bytes). Got ${key.length} bytes.`,
    );
  }
  return key;
}

/**
 * Encrypt a plaintext string.
 * Returns a storable string: "<iv>:<authTag>:<ciphertext>" (all hex).
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a value previously produced by `encrypt()`.
 * Throws if the ciphertext has been tampered with (GCM auth tag mismatch).
 */
export function decrypt(stored: string): string {
  const key = getEncryptionKey();
  const parts = stored.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted value format');

  const [ivHex, tagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * Produce a masked display value safe to show in the UI.
 * e.g. "sk-ant-api03-aBcDe...x1y2z"
 * Shows the first 12 chars and last 4 chars, masks the middle.
 */
export function maskApiKey(value: string): string {
  if (value.length <= 16) return '••••••••';
  const start = value.slice(0, 12);
  const end = value.slice(-4);
  return `${start}...${end}`;
}
