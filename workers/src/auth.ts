import { DecodedUser, Env } from './types';

interface CachedKeys {
  keys: Map<string, CryptoKey>;
  expiresAt: number;
}

let cachedPublicKeys: CachedKeys | null = null;

// Helper: Base64URL to Uint8Array
export function base64UrlToUint8Array(str: string): Uint8Array {
  // Convert Base64URL to standard Base64
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Helper: Uint8Array to Base64URL
export function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Helper: Parse JSON from Base64URL string
export function parseJwtSegment(segment: string): any {
  let base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const jsonStr = decodeURIComponent(
    atob(base64)
      .split('')
      .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
      .join('')
  );
  return JSON.parse(jsonStr);
}

const GOOGLE_JWK_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

/**
 * Fetches and caches Google's public JWK keys with Cache-Control TTL adherence.
 */
export async function getGooglePublicKeys(): Promise<Map<string, CryptoKey>> {
  const now = Date.now();
  if (cachedPublicKeys && cachedPublicKeys.expiresAt > now) {
    return cachedPublicKeys.keys;
  }

  const response = await fetch(GOOGLE_JWK_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch Google public keys: HTTP ${response.status}`);
  }

  // Parse max-age from Cache-Control header, default to 6 hours (21600s)
  let maxAgeSeconds = 21600;
  const cacheControl = response.headers.get('cache-control');
  if (cacheControl) {
    const match = cacheControl.match(/max-age=(\d+)/i);
    if (match && match[1]) {
      maxAgeSeconds = parseInt(match[1], 10);
    }
  }

  const data: { keys: Array<{ kid: string; kty: string; alg: string; use: string; n: string; e: string }> } = await response.json();
  const keysMap = new Map<string, CryptoKey>();

  for (const jwk of data.keys) {
    if (jwk.kty === 'RSA') {
      try {
        const cryptoKey = await crypto.subtle.importKey(
          'jwk',
          jwk,
          { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
          false,
          ['verify']
        );
        keysMap.set(jwk.kid, cryptoKey);
      } catch (err) {
        console.warn(`[Auth] Failed to import key kid=${jwk.kid}:`, err);
      }
    }
  }

  cachedPublicKeys = {
    keys: keysMap,
    expiresAt: now + maxAgeSeconds * 1000
  };

  return keysMap;
}

/**
 * Allows test suites to inject mock public keys.
 */
export function setCachedPublicKeysForTesting(keys: Map<string, CryptoKey> | null) {
  if (keys === null) {
    cachedPublicKeys = null;
  } else {
    cachedPublicKeys = {
      keys,
      expiresAt: Date.now() + 3600 * 1000
    };
  }
}

/**
 * Validates a Firebase ID token using Google Public Keys & Web Crypto RS256.
 *
 * Verifies:
 * 1. Token structure (Header, Payload, Signature)
 * 2. Signature against Google's public key matching `kid`
 * 3. Issuer (`iss === https://securetoken.google.com/<projectId>`)
 * 4. Audience (`aud === <projectId>`)
 * 5. Expiration (`exp > now`)
 * 6. Non-empty `sub` (UID)
 */
export async function verifyFirebaseIdToken(
  token: string,
  env: Env
): Promise<DecodedUser> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed token: Expected 3 JWT segments');
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string; kid?: string; typ?: string };
  let payload: {
    iss?: string;
    aud?: string;
    sub?: string;
    exp?: number;
    auth_time?: number;
    email?: string;
    name?: string;
    admin?: boolean;
    role?: string;
    [key: string]: any;
  };

  try {
    header = parseJwtSegment(headerB64);
    payload = parseJwtSegment(payloadB64);
  } catch {
    throw new Error('Malformed token: Invalid JSON in header or payload');
  }

  if (header.alg !== 'RS256') {
    throw new Error(`Unsupported algorithm: Expected RS256, got ${header.alg}`);
  }

  if (!header.kid) {
    throw new Error('Malformed token: Missing kid in header');
  }

  const expectedProjectId = env.FIREBASE_PROJECT_ID || 'spinnermine-cloud-production';

  // 1. Verify Audience
  if (payload.aud !== expectedProjectId) {
    throw new Error(`Token audience mismatch: Expected ${expectedProjectId}, got ${payload.aud}`);
  }

  // 2. Verify Issuer
  const expectedIssuer = `https://securetoken.google.com/${expectedProjectId}`;
  if (payload.iss !== expectedIssuer) {
    throw new Error(`Token issuer mismatch: Expected ${expectedIssuer}, got ${payload.iss}`);
  }

  // 3. Verify Subject (UID)
  if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.trim().length === 0) {
    throw new Error('Token subject (sub/uid) is missing or invalid');
  }

  // 4. Verify Expiration
  const nowInSeconds = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < nowInSeconds) {
    throw new Error('Token has expired');
  }

  // 5. Verify Cryptographic Signature
  const publicKeys = await getGooglePublicKeys();
  const publicKey = publicKeys.get(header.kid);
  if (!publicKey) {
    throw new Error(`Public key with kid "${header.kid}" not found in Google JWK set`);
  }

  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signatureBytes = base64UrlToUint8Array(signatureB64);

  const isValid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    signatureBytes as BufferSource,
    signedData as BufferSource
  );

  if (!isValid) {
    throw new Error('Invalid token signature');
  }

  return {
    uid: payload.sub,
    email: payload.email,
    admin: Boolean(payload.admin || payload.role === 'admin'),
    role: (payload.role as string) || (payload.admin ? 'admin' : 'user'),
    name: payload.name
  };
}

/**
 * Extracts and verifies Bearer token from Request Authorization header.
 * Throws 401 response error if missing or invalid.
 */
export async function authenticateRequest(
  request: Request,
  env: Env
): Promise<{ user: DecodedUser; rawToken: string }> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthError('Unauthorized: Missing or invalid Authorization Bearer token', 401);
  }

  const rawToken = authHeader.substring(7).trim();
  if (!rawToken) {
    throw new AuthError('Unauthorized: Empty Bearer token', 401);
  }

  try {
    const user = await verifyFirebaseIdToken(rawToken, env);
    return { user, rawToken };
  } catch (err: any) {
    throw new AuthError(`Unauthorized: Token verification failed: ${err.message}`, 401);
  }
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}
