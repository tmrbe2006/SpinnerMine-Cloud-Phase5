import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createServerApp, adminAuth, adminDb, getGameServerSecret } from '../../server';

/**
 * Game API Real Integration Test Suite with Firebase Emulator
 *
 * Requirements:
 * 1. Calls actual /api/games/spin-wheel endpoint via Supertest
 * 2. Authenticates using Firebase Auth Emulator ID token
 * 3. Records outcome and arcade points in Firestore Emulator
 * 4. Concurrently sends 2 identical nonces: exactly 1 succeeds (200), 1 rejected (409 Replay Attack)
 * 5. Points incremented strictly once in userArcade collection
 * 6. Database failure rejects reward confirmation and never returns verified: true
 */

const isEmulatorActive = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST);

if (process.env.CI && !isEmulatorActive) {
  throw new Error('FATAL: Firebase Emulator is required in CI but not active!');
}

describe.skipIf(!isEmulatorActive)('Game API & Firebase Emulator Integration (/api/games/spin-wheel)', () => {
  const app = createServerApp();
  const testUid = `player_emu_${Date.now()}`;
  let idToken = '';

  beforeAll(async () => {
    // Ensure 256-bit server secret is set for tests
    process.env.GAME_SERVER_SECRET = 'emulator_test_secret_32_characters_long_256_bit_entropy!';

    // 1. Create user in Firebase Auth Emulator if needed
    try {
      await adminAuth.createUser({
        uid: testUid,
        email: `${testUid}@example.com`,
      });
    } catch {
      // User might already exist
    }

    // 2. Mint custom token via Firebase Admin SDK
    const customToken = await adminAuth.createCustomToken(testUid, { role: 'user' });

    // 3. Exchange custom token for valid Firebase ID token via Auth Emulator REST API
    const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
    const exchangeUrl = `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-emulator-api-key`;

    const tokenRes = await fetch(exchangeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: customToken,
        returnSecureToken: true,
      }),
    });

    const tokenData = await tokenRes.json() as any;
    if (!tokenRes.ok) {
      throw new Error(`Token exchange failed: ${JSON.stringify(tokenData)}`);
    }
    idToken = tokenData.idToken;
    expect(idToken).toBeDefined();
    expect(typeof idToken).toBe('string');
  });

  afterAll(async () => {
    // Cleanup created test user in Auth Emulator
    try {
      await adminAuth.deleteUser(testUid);
    } catch {}
  });

  it('1. Rejects request with missing or invalid Firebase Auth token', async () => {
    const res = await request(app)
      .post('/api/games/spin-wheel')
      .send({ nonce: crypto.randomUUID() });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Unauthorized/);
  });

  it('2. Successfully executes /api/games/spin-wheel with Auth & records outcome in Firestore Emulator', async () => {
    const nonce = `test_nonce_${crypto.randomUUID()}`;
    const clientTimestamp = new Date().toISOString();

    const res = await request(app)
      .post('/api/games/spin-wheel')
      .set('Authorization', `Bearer ${idToken}`)
      .send({ nonce, clientTimestamp });

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.uid).toBe(testUid);
    expect(res.body.cryptocurrencyAwarded).toBe(0);
    expect(res.body.serverSignature).toBeDefined();
    expect(res.body.awardedEntertainmentPoints).toBeGreaterThanOrEqual(0);

    // Verify stored in Firestore Emulator
    const userArcadeDoc = await adminDb.collection('userArcade').doc(testUid).get();
    expect(userArcadeDoc.exists).toBe(true);
    expect(userArcadeDoc.data()?.totalArcadePoints).toBe(res.body.awardedEntertainmentPoints);

    // Verify usedNonces in Firestore Emulator
    const operationKey = `${testUid}_wheel_${nonce}`;
    const nonceDoc = await adminDb.collection('usedNonces').doc(operationKey).get();
    expect(nonceDoc.exists).toBe(true);
  });

  it('3. Concurrency Protection: 2 simultaneous requests with same Nonce accepts 1, rejects second with 409 Replay, awards points once', async () => {
    const concurrentUid = `concurrent_player_${Date.now()}`;
    const customToken = await adminAuth.createCustomToken(concurrentUid, { role: 'user' });
    const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
    const exchangeRes = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    });
    const { idToken: concurrentIdToken } = await exchangeRes.json() as any;

    const sharedNonce = `fixed_concurrency_nonce_${Date.now()}`;
    const clientTimestamp = new Date().toISOString();

    // Fire 2 simultaneous requests with identical nonce
    const [res1, res2] = await Promise.all([
      request(app)
        .post('/api/games/spin-wheel')
        .set('Authorization', `Bearer ${concurrentIdToken}`)
        .send({ nonce: sharedNonce, clientTimestamp }),
      request(app)
        .post('/api/games/spin-wheel')
        .set('Authorization', `Bearer ${concurrentIdToken}`)
        .send({ nonce: sharedNonce, clientTimestamp }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    // Exactly one 200 OK and one 409 Conflict
    expect(statuses).toEqual([200, 409]);

    const successfulRes = res1.status === 200 ? res1 : res2;
    const failedRes = res1.status === 409 ? res1 : res2;

    expect(successfulRes.body.verified).toBe(true);
    expect(failedRes.body.error).toMatch(/Replay attack detected/);

    // Verify Firestore points are strictly incremented only once
    const userArcadeDoc = await adminDb.collection('userArcade').doc(concurrentUid).get();
    expect(userArcadeDoc.exists).toBe(true);
    expect(userArcadeDoc.data()?.totalArcadePoints).toBe(successfulRes.body.awardedEntertainmentPoints);

    // Verify only one nonce document exists in usedNonces
    const opKey = `${concurrentUid}_wheel_${sharedNonce}`;
    const nonceDoc = await adminDb.collection('usedNonces').doc(opKey).get();
    expect(nonceDoc.exists).toBe(true);

    // Cleanup
    await adminAuth.deleteUser(concurrentUid).catch(() => {});
  });

  it('4. Financial Integrity: Database failure rejects reward confirmation and never returns verified: true', async () => {
    const errorUid = `error_player_${Date.now()}`;
    const customToken = await adminAuth.createCustomToken(errorUid, { role: 'user' });
    const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
    const exchangeRes = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    });
    const { idToken: errorIdToken } = await exchangeRes.json() as any;

    // Spy on adminDb.runTransaction to simulate Firestore transaction failure
    const originalRunTransaction = adminDb.runTransaction.bind(adminDb);
    const mockTransaction = vi.spyOn(adminDb, 'runTransaction').mockRejectedValueOnce(
      new Error('Firestore cluster connection severed')
    );

    const nonce = `error_nonce_${crypto.randomUUID()}`;
    const res = await request(app)
      .post('/api/games/spin-wheel')
      .set('Authorization', `Bearer ${errorIdToken}`)
      .send({ nonce });

    expect(res.status).toBe(500);
    expect(res.body.verified).toBeUndefined();
    expect(res.body.error).toMatch(/Failed to atomically verify and record game outcome/);

    mockTransaction.mockRestore();
    await adminAuth.deleteUser(errorUid).catch(() => {});
  });

  it('5. Worker Registration: Successfully registers worker with verified Auth token and writes to Firestore Emulator', async () => {
    const workerId = `w_test_${testUid.slice(0, 8)}_pc`;
    const workerRes = await request(app)
      .post('/api/workers/register')
      .set('Authorization', `Bearer ${idToken}`)
      .send({
        workerId,
        name: 'Emulator Windows PC',
        deviceName: 'Emulator Windows PC',
        platform: 'windows',
        cpuCores: 8,
        threads: 4,
        xmrigVersion: '6.26.0'
      });

    expect(workerRes.status).toBe(200);
    expect(workerRes.body.success).toBe(true);
    expect(workerRes.body.worker.userId).toBe(testUid);

    // Verify written in Firestore Emulator
    const workerDoc = await adminDb.collection('miningWorkers').doc(workerId).get();
    expect(workerDoc.exists).toBe(true);
    expect(workerDoc.data()?.userId).toBe(testUid);
    expect(workerDoc.data()?.name).toBe('Emulator Windows PC');
  });
});
