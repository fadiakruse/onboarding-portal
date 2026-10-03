// AES-256-GCM encryption for SSN and document numbers at rest.
// PII_ENCRYPTION_KEY = base64 of 32 random bytes (generate: openssl rand -base64 32)
const enc = new TextEncoder();
const dec = new TextDecoder();
let keyPromise: Promise<CryptoKey> | null = null;

function b64(buf: Uint8Array) { return btoa(String.fromCharCode(...buf)); }
function unb64(s: string) { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }

function key() {
  if (!keyPromise) {
    const raw = Deno.env.get("PII_ENCRYPTION_KEY");
    if (!raw) throw new Error("PII_ENCRYPTION_KEY is not set");
    const bytes = unb64(raw);
    if (bytes.length !== 32) throw new Error("PII_ENCRYPTION_KEY must be 32 bytes (base64)");
    keyPromise = crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  return keyPromise;
}

export async function seal(obj: Record<string, unknown>): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), enc.encode(JSON.stringify(obj))));
  return `v1.${b64(iv)}.${b64(ct)}`;
}

export async function open(blob: string | null): Promise<Record<string, any>> {
  if (!blob) return {};
  const [, iv, ct] = blob.split(".");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await key(), unb64(ct));
  return JSON.parse(dec.decode(pt));
}

export async function sha256(s: string) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken() {
  return b64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
