import { generateKeyPairSync, createVerify } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __clearAppleTokenCache,
  appleDeveloperToken,
  appleMusicConfigured,
} from "./developer-token";

/**
 * A real P-256 key, generated here. Apple's own key never enters the tests —
 * these prove the token is well-formed and correctly signed, which is what
 * would otherwise only surface as an opaque 401 from Apple.
 */
const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const saved = { ...process.env };

beforeEach(() => {
  __clearAppleTokenCache();
  process.env.APPLE_TEAM_ID = "ABCDE12345";
  process.env.APPLE_MUSIC_KEY_ID = "KEY1234567";
  process.env.APPLE_MUSIC_PRIVATE_KEY = privateKey;
});

afterEach(() => {
  process.env = { ...saved };
  __clearAppleTokenCache();
});

function decode(part: string) {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

describe("appleDeveloperToken", () => {
  it("builds the header Apple requires", () => {
    const [header] = appleDeveloperToken().split(".");
    expect(decode(header!)).toEqual({ alg: "ES256", kid: "KEY1234567", typ: "JWT" });
  });

  it("issues the team as the issuer, with a bounded lifetime", () => {
    const now = Date.UTC(2026, 7, 10, 12, 0, 0);
    const [, payload] = appleDeveloperToken(now).split(".");
    const claims = decode(payload!);

    expect(claims.iss).toBe("ABCDE12345");
    expect(claims.exp - claims.iat).toBe(60 * 60 * 12);
    // Apple's ceiling is six months; staying far under it limits the damage
    // from a leak, since a single token cannot be revoked on its own.
    expect(claims.exp - claims.iat).toBeLessThan(60 * 60 * 24 * 180);
  });

  /**
   * The failure this test exists to prevent: Node emits ECDSA signatures in
   * ASN.1 DER, while JWS requires the raw r‖s pair. Skipping that conversion
   * yields a token Apple rejects with a 401 indistinguishable from a wrong key.
   */
  it("signs in JOSE format, not DER, and the signature verifies", () => {
    const token = appleDeveloperToken();
    const [header, payload, signature] = token.split(".");

    const raw = Buffer.from(signature!, "base64url");
    expect(raw).toHaveLength(64); // 32-byte r + 32-byte s, never DER

    const verifier = createVerify("SHA256");
    verifier.update(`${header}.${payload}`);
    verifier.end();
    expect(verifier.verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, raw)).toBe(true);
  });

  /** Apple's .p8 is PEM; env vars cannot hold real newlines, and the escaped
   *  form is the most common reason a valid key is rejected. */
  it("accepts a key stored with escaped newlines", () => {
    process.env.APPLE_MUSIC_PRIVATE_KEY = privateKey.replace(/\n/g, "\\n");
    __clearAppleTokenCache();
    expect(() => appleDeveloperToken()).not.toThrow();
  });

  it("reuses a cached token and renews before it expires", () => {
    const now = Date.UTC(2026, 7, 10, 12, 0, 0);
    const first = appleDeveloperToken(now);

    expect(appleDeveloperToken(now + 60_000)).toBe(first);
    // Past the renewal window, a fresh token is issued.
    expect(appleDeveloperToken(now + 12 * 60 * 60 * 1000)).not.toBe(first);
  });

  it("reports configuration honestly", () => {
    expect(appleMusicConfigured()).toBe(true);
    delete process.env.APPLE_MUSIC_PRIVATE_KEY;
    expect(appleMusicConfigured()).toBe(false);
    expect(() => appleDeveloperToken()).toThrow(/not configured/i);
  });
});
