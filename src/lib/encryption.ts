import crypto from 'crypto';

// App-layer encryption for sensitive fields (currently just SSN) before
// they're written to Supabase. The key never touches Supabase — it's a
// Vercel-only environment variable. Encryption happens AFTER any PDF has
// already been generated with the plaintext value (managers still need to
// see the SSN on the generated PDF); this only protects the copy that lands
// in the `employee_forms.answers` JSONB column.
//
// Setup: in Vercel, add an environment variable named SSN_ENCRYPTION_KEY
// containing 32 random bytes, base64-encoded. Generate one with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// Set it for Production (and Preview/Development if used) and redeploy.

const ALGORITHM = 'aes-256-gcm';
const ENC_PREFIX = 'enc:v1:';

function getKey(): Buffer {
  const raw = process.env.SSN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('SSN_ENCRYPTION_KEY is not set. Add it in Vercel project settings and redeploy.');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('SSN_ENCRYPTION_KEY must decode to exactly 32 bytes (base64-encoded AES-256 key).');
  }
  return key;
}

// Encrypts a plaintext string, returning a single string safe to store in a
// JSONB column: "enc:v1:<iv>:<authTag>:<ciphertext>", each part base64.
export function encryptField(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12); // 96-bit nonce, standard for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [ENC_PREFIX.slice(0, -1), iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
}

// Decrypts a string produced by encryptField. Not currently called anywhere
// in the app (nothing reads employee_forms.answers back for display), but
// provided so a future admin tool can recover the value if ever needed.
export function decryptField(stored: string): string {
  const parts = stored.split(':');
  if (parts.length !== 4 || `${parts[0]}:` !== ENC_PREFIX) {
    throw new Error('Value is not in the expected encrypted format.');
  }
  const [, ivB64, authTagB64, ciphertextB64] = parts;
  const key = getKey();
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

export function isEncryptedField(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}
