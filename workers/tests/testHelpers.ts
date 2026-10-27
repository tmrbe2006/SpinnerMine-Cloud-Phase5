import { Env, DecodedUser } from '../src/types';
import { uint8ArrayToBase64Url } from '../src/auth';

export interface TestKeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  kid: string;
  jwk: JsonWebKey;
}

export async function generateTestRsaKeyPair(kid = 'test-kid-1'): Promise<TestKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256'
    },
    true,
    ['sign', 'verify']
  );

  const jwk = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as JsonWebKey & { kid?: string };
  jwk.kid = kid;
  jwk.alg = 'RS256';
  jwk.use = 'sig';

  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    kid,
    jwk
  };
}

export async function createMockFirebaseIdToken(
  keyPair: TestKeyPair,
  claims: {
    uid?: string;
    email?: string;
    admin?: boolean;
    role?: string;
    exp?: number;
    iss?: string;
    aud?: string;
    [key: string]: any;
  },
  projectId = 'spinnermine-cloud-production'
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'RS256',
    kid: keyPair.kid,
    typ: 'JWT'
  };

  const payload = {
    iss: claims.iss ?? `https://securetoken.google.com/${projectId}`,
    aud: claims.aud ?? projectId,
    sub: claims.uid ?? 'test-uid-123',
    user_id: claims.uid ?? 'test-uid-123',
    auth_time: now - 60,
    exp: claims.exp ?? now + 3600,
    email: claims.email ?? 'miner@spinnermine.com',
    admin: claims.admin,
    role: claims.role,
    ...claims
  };

  const stringToBase64Url = (str: string) =>
    uint8ArrayToBase64Url(new TextEncoder().encode(str));

  const headerB64 = stringToBase64Url(JSON.stringify(header));
  const payloadB64 = stringToBase64Url(JSON.stringify(payload));
  const unsigned = `${headerB64}.${payloadB64}`;

  const sigBytes = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    keyPair.privateKey,
    new TextEncoder().encode(unsigned)
  );

  const sigB64 = uint8ArrayToBase64Url(new Uint8Array(sigBytes));
  return `${unsigned}.${sigB64}`;
}

export function createMockEnv(overrides: Partial<Env> = {}): Env {
  return {
    FIREBASE_PROJECT_ID: 'spinnermine-cloud-production',
    FIRESTORE_DATABASE_ID: '(default)',
    ENVIRONMENT: 'production',
    ALLOW_LOCALHOST_ORIGIN: 'true',
    GAME_SERVER_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    ...overrides
  };
}
