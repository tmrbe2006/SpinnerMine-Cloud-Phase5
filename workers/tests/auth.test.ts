import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import worker from '../src/index';
import { verifyFirebaseIdToken, setCachedPublicKeysForTesting } from '../src/auth';
import { generateTestRsaKeyPair, createMockFirebaseIdToken, createMockEnv, TestKeyPair } from './testHelpers';

describe('Cloudflare Worker - Firebase Authentication', () => {
  let keyPair: TestKeyPair;
  const env = createMockEnv();

  beforeEach(async () => {
    keyPair = await generateTestRsaKeyPair('kid-alpha');
    const keysMap = new Map<string, CryptoKey>();
    keysMap.set(keyPair.kid, keyPair.publicKey);
    setCachedPublicKeysForTesting(keysMap);
  });

  afterEach(() => {
    setCachedPublicKeysForTesting(null);
  });

  it('verifies a valid Firebase ID token with matching RS256 signature and claims', async () => {
    const token = await createMockFirebaseIdToken(keyPair, {
      uid: 'user_xyz_789',
      email: 'pilot@spinnermine.com',
      role: 'user'
    });

    const decoded = await verifyFirebaseIdToken(token, env);
    expect(decoded.uid).toBe('user_xyz_789');
    expect(decoded.email).toBe('pilot@spinnermine.com');
    expect(decoded.admin).toBe(false);
  });

  it('correctly identifies admin custom claims', async () => {
    const token = await createMockFirebaseIdToken(keyPair, {
      uid: 'admin_root_1',
      email: 'admin@spinnermine.com',
      admin: true,
      role: 'admin'
    });

    const decoded = await verifyFirebaseIdToken(token, env);
    expect(decoded.uid).toBe('admin_root_1');
    expect(decoded.admin).toBe(true);
    expect(decoded.role).toBe('admin');
  });

  it('rejects an expired Firebase ID token with 401 error', async () => {
    const pastTime = Math.floor(Date.now() / 1000) - 300;
    const expiredToken = await createMockFirebaseIdToken(keyPair, {
      uid: 'user_expired',
      exp: pastTime
    });

    const req = new Request('https://worker.spinnermine.workers.dev/api/workers', {
      method: 'GET',
      headers: { Authorization: `Bearer ${expiredToken}` }
    });

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
    const body: any = await res.json();
    expect(body.error).toContain('Token has expired');
  });

  it('rejects token with audience mismatch', async () => {
    const invalidAudToken = await createMockFirebaseIdToken(keyPair, {
      aud: 'different-google-project'
    });

    const req = new Request('https://worker.spinnermine.workers.dev/api/workers', {
      method: 'GET',
      headers: { Authorization: `Bearer ${invalidAudToken}` }
    });

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
    const body: any = await res.json();
    expect(body.error).toContain('Token audience mismatch');
  });

  it('rejects token with issuer mismatch', async () => {
    const invalidIssToken = await createMockFirebaseIdToken(keyPair, {
      iss: 'https://securetoken.google.com/malicious-project'
    });

    const req = new Request('https://worker.spinnermine.workers.dev/api/workers', {
      method: 'GET',
      headers: { Authorization: `Bearer ${invalidIssToken}` }
    });

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
    const body: any = await res.json();
    expect(body.error).toContain('Token issuer mismatch');
  });

  it('rejects request with missing or non-Bearer authorization header', async () => {
    const req = new Request('https://worker.spinnermine.workers.dev/api/workers', {
      method: 'GET'
    });

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
    const body: any = await res.json();
    expect(body.error).toContain('Missing or invalid Authorization Bearer token');
  });

  it('rejects token signed with an unknown or forged key (kid not in JWK set)', async () => {
    const rogueKey = await generateTestRsaKeyPair('kid-rogue');
    const forgedToken = await createMockFirebaseIdToken(rogueKey, {
      uid: 'attacker'
    });

    const req = new Request('https://worker.spinnermine.workers.dev/api/workers', {
      method: 'GET',
      headers: { Authorization: `Bearer ${forgedToken}` }
    });

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
    const body: any = await res.json();
    expect(body.error).toContain('not found in Google JWK set');
  });
});
