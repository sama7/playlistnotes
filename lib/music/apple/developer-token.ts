import { createSign } from "node:crypto";

/**
 * Apple Music developer tokens.
 *
 * A developer token is an ES256-signed JWT proving the *application* is
 * enrolled. It is the Apple analogue of Spotify's Client Credentials: it
 * authorises us, not a user, so nobody has to sign into Apple Music and the
 * no-user-OAuth property holds.
 *
 * A Music *User* Token — the thing that would read someone's personal library —
 * is deliberately never requested.
 *
 * Everything Apple except playlists works without this: the public iTunes API
 * covers tracks, singles, EPs and albums unauthenticated.
 */

/** Apple caps developer tokens at six months. Ours is far shorter: a leaked
 *  token cannot be revoked individually, only by revoking the whole key. */
const TOKEN_TTL_SECONDS = 60 * 60 * 12;

/** Renew comfortably before expiry rather than racing it. */
const RENEW_BEFORE_SECONDS = 60 * 30;

export function appleMusicConfigured(): boolean {
  return Boolean(
    process.env.APPLE_TEAM_ID &&
      process.env.APPLE_MUSIC_KEY_ID &&
      process.env.APPLE_MUSIC_PRIVATE_KEY,
  );
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * Apple issues the key as a PEM `.p8`. Environment variables cannot hold real
 * newlines, so the value is stored with `\n` escapes and restored here — the
 * single most common reason a correctly-generated key is rejected.
 */
function normalizePrivateKey(raw: string): string {
  const key = raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
  return key.trim().concat("\n");
}

/**
 * ES256 signatures come out of Node in ASN.1 DER; JWS requires the raw
 * r‖s concatenation. Signing without this conversion produces a token Apple
 * rejects with a 401 that looks exactly like a wrong key.
 */
function derToJose(der: Buffer): Buffer {
  let offset = 2;
  // Skip an optional long-form length byte on the SEQUENCE.
  if (der[1] === undefined) throw new Error("Malformed ECDSA signature.");
  if (der[1]! & 0x80) offset += der[1]! & 0x7f;

  const readInt = (): Buffer => {
    if (der[offset] !== 0x02) throw new Error("Malformed ECDSA signature.");
    const length = der[offset + 1]!;
    let start = offset + 2;
    let size = length;
    // Strip the leading zero DER adds to keep the integer positive.
    while (size > 32 && der[start] === 0x00) {
      start++;
      size--;
    }
    const value = der.subarray(start, start + size);
    offset = offset + 2 + length;
    return Buffer.concat([Buffer.alloc(32 - value.length, 0), value]);
  };

  return Buffer.concat([readInt(), readInt()]);
}

let cached: { token: string; expiresAt: number } | null = null;

export function __clearAppleTokenCache() {
  cached = null;
}

export function appleDeveloperToken(now: number = Date.now()): string {
  if (cached && cached.expiresAt > now / 1000 + RENEW_BEFORE_SECONDS) return cached.token;

  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_MUSIC_KEY_ID;
  const privateKey = process.env.APPLE_MUSIC_PRIVATE_KEY;
  if (!teamId || !keyId || !privateKey) {
    throw new Error("Apple Music is not configured.");
  }

  const issuedAt = Math.floor(now / 1000);
  const expiresAt = issuedAt + TOKEN_TTL_SECONDS;

  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iss: teamId, iat: issuedAt, exp: expiresAt }));
  const signingInput = `${header}.${payload}`;

  const signer = createSign("SHA256");
  signer.update(signingInput);
  signer.end();
  const der = signer.sign({ key: normalizePrivateKey(privateKey), dsaEncoding: "der" });

  const token = `${signingInput}.${base64url(derToJose(der))}`;
  cached = { token, expiresAt };
  return token;
}
