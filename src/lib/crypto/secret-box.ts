import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "crypto";

/**
 * Authenticated encryption for the credentials Sigwald stores — OAuth tokens,
 * the Canvas access token, the CalDAV password, third-party API keys.
 *
 * AES-256-GCM from Node's built-in `crypto`; no dependency is added for this.
 * GCM rather than CBC because it authenticates as well as encrypts: a value
 * tampered with in the database fails to decrypt instead of decrypting into
 * something we then send to Google.
 *
 * What this protects against: a copy of the database. A `pg_dump`, a Time
 * Machine snapshot, a stray backup — the realistic way these values escape a
 * laptop. What it does not protect against: anything running as you on this
 * machine, which can read the key out of the environment just as easily. That
 * is a real limit, not an oversight; closing it means moving the key into the
 * macOS Keychain, which is a separate change.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12; // 96 bits, the size GCM is defined for
// No dot in the prefix: `.` is the envelope separator, and base64url never
// produces one, so the parts stay unambiguous.
const ENVELOPE_PREFIX = "sigwald_v1";

/**
 * `sigwald_v1.<iv>.<authTag>.<ciphertext>`, all base64url.
 *
 * The version is in the string rather than tracked elsewhere so a future
 * algorithm or key-derivation change can be told apart from this one by
 * looking at a single value, and so a half-migrated table is unambiguous.
 */
function envelope(iv: Buffer, tag: Buffer, ciphertext: Buffer): string {
  return [
    ENVELOPE_PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * True if this value has already been encrypted by us.
 *
 * Every read and write path is idempotent on this check, which is what makes
 * the rollout safe: plaintext left over from before the migration keeps
 * working, and re-running the backfill cannot double-encrypt.
 */
export function isEncrypted(value: string): boolean {
  const [prefix, ...parts] = value.split(".");
  if (prefix !== ENVELOPE_PREFIX) {
    return false;
  }
  return parts.length === 3;
}

let cachedKey: Buffer | null = null;

/**
 * Resolved on first use rather than at import, so merely importing the Prisma
 * client does not require the key — a build step or a script that never
 * touches a credential should not have to hold one.
 */
function key(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.SIGWALD_SECRET_KEY;
  if (!raw) {
    throw new Error(
      "SIGWALD_SECRET_KEY is not set, so stored credentials cannot be read or " +
        "written. Generate one with `openssl rand -base64 32` and add it to .env."
    );
  }

  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== KEY_BYTES) {
    throw new Error(
      `SIGWALD_SECRET_KEY must decode to ${KEY_BYTES} bytes, got ${decoded.length}. ` +
        "Generate one with `openssl rand -base64 32`."
    );
  }

  cachedKey = decoded;
  return cachedKey;
}

/** Test seam: forget the cached key so a changed env var is picked up. */
export function resetKeyCache(): void {
  cachedKey = null;
}

/**
 * Encrypt a credential. Already-encrypted input is returned untouched, so
 * callers never have to know whether a value has been migrated yet.
 */
export function encryptSecret(plaintext: string): string {
  if (plaintext === "") return plaintext;
  if (isEncrypted(plaintext)) return plaintext;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return envelope(iv, cipher.getAuthTag(), ciphertext);
}

/**
 * Decrypt a credential. Plaintext input is returned untouched — that is what
 * lets the application run normally between deploying this and running the
 * backfill, and what keeps a value written by an older build readable.
 */
export function decryptSecret(value: string): string {
  if (!isEncrypted(value)) return value;

  const [, ivPart, tagPart, ciphertextPart] = value.split(".");
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const ciphertext = Buffer.from(ciphertextPart, "base64url");

  const decipher = createDecipheriv(ALGORITHM, key(), iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // `final()` throws when the auth tag does not match: either the row was
    // tampered with or the key has changed. Both are worth failing on rather
    // than handing back a broken credential and blaming the remote service.
    throw new Error(
      "A stored credential failed to decrypt. Either SIGWALD_SECRET_KEY is not " +
        "the key this value was written with, or the row has been altered."
    );
  }
}

/**
 * Constant-time comparison, for the rare case of checking a secret against a
 * candidate value rather than sending it somewhere.
 */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
