import {
  decryptSecret,
  encryptSecret,
  isEncrypted,
  resetKeyCache,
  secretsMatch,
} from "@/lib/crypto/secret-box";

// A fixed 32-byte key, so failures are reproducible.
const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 9).toString("base64");

function withKey(value: string | undefined) {
  if (value === undefined) {
    delete process.env.SIGWALD_SECRET_KEY;
  } else {
    process.env.SIGWALD_SECRET_KEY = value;
  }
  resetKeyCache();
}

describe("secret-box", () => {
  beforeEach(() => withKey(KEY));
  afterEach(() => withKey(undefined));

  it("round-trips a credential", () => {
    const token = "1234~aBcDeF.gHiJkL-mNoPqR";
    expect(decryptSecret(encryptSecret(token))).toBe(token);
  });

  it("round-trips non-ASCII, since CalDAV passwords are arbitrary", () => {
    const password = "pässwörd・パスワード🔐";
    expect(decryptSecret(encryptSecret(password))).toBe(password);
  });

  it("produces a different ciphertext each time for the same input", () => {
    // A fresh IV per write, so equal credentials are not detectable as equal.
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("marks its output as encrypted and leaves plaintext unmarked", () => {
    expect(isEncrypted(encryptSecret("tok"))).toBe(true);
    expect(isEncrypted("tok")).toBe(false);
    // A value that merely starts with the prefix is not a valid envelope.
    expect(isEncrypted("sigwald_v1.only-two-parts")).toBe(false);
  });

  it("is idempotent on encrypt, so a re-run cannot double-encrypt", () => {
    const once = encryptSecret("tok");
    expect(encryptSecret(once)).toBe(once);
  });

  it("passes plaintext through on decrypt, so pre-migration rows still read", () => {
    expect(decryptSecret("legacy-plaintext-token")).toBe(
      "legacy-plaintext-token"
    );
  });

  it("leaves the empty string alone rather than encrypting nothing", () => {
    expect(encryptSecret("")).toBe("");
  });

  it("refuses a tampered ciphertext instead of returning garbage", () => {
    const sealed = encryptSecret("tok");
    const parts = sealed.split(".");
    // Flip the last character of the ciphertext.
    const last = parts[3];
    parts[3] = last.slice(0, -1) + (last.endsWith("A") ? "B" : "A");
    expect(() => decryptSecret(parts.join("."))).toThrow(/failed to decrypt/);
  });

  it("refuses to decrypt with the wrong key", () => {
    const sealed = encryptSecret("tok");
    withKey(OTHER_KEY);
    expect(() => decryptSecret(sealed)).toThrow(/failed to decrypt/);
  });

  it("explains itself when the key is missing", () => {
    withKey(undefined);
    expect(() => encryptSecret("tok")).toThrow(/SIGWALD_SECRET_KEY is not set/);
  });

  it("rejects a key that is not 32 bytes", () => {
    withKey(Buffer.alloc(16, 1).toString("base64"));
    expect(() => encryptSecret("tok")).toThrow(/must decode to 32 bytes/);
  });

  it("compares secrets without leaking length via early exit", () => {
    expect(secretsMatch("abc", "abc")).toBe(true);
    expect(secretsMatch("abc", "abd")).toBe(false);
    expect(secretsMatch("abc", "abcd")).toBe(false);
  });
});
