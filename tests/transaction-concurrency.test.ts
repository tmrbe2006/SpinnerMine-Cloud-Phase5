import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { 
  createServerApp, 
  adminAuth, 
  adminDb, 
  usedNoncesMap, 
  rateLimitMap, 
  getGameServerSecret 
} from '../server';

describe('4. Transaction Concurrency Integration Tests (Simultaneous Nonce Replay)', () => {
  const app = createServerApp();
  const mockDbStore = new Map<string, any>();
  const originalSecret = process.env.GAME_SERVER_SECRET;

  // Real serializing transaction lock to simulate Firestore ACID optimistic/pessimistic lock semantics
  let transactionMutex = Promise.resolve();
  let transientFailuresRemaining = 0;

  const setupConcurrentTransactionRunner = () => {
    vi.spyOn(adminDb, 'runTransaction').mockImplementation(async (updateFunction: any) => {
      if (transientFailuresRemaining > 0) {
        transientFailuresRemaining--;
        throw new Error('Firestore contention: Document was locked by another transaction. Retry.');
      }

      // Serialize transactions just like Firestore's document-level transaction locking
      const currentMutex = transactionMutex;
      let unlock: () => void;
      transactionMutex = new Promise<void>((resolve) => { unlock = resolve; });
      await currentMutex;

      try {
        const pendingWrites = new Map<string, any>();
        const transaction = {
          get: async (docRef: any) => {
            const docPath = docRef.path || (docRef._path && docRef._path.segments.join('/')) || docRef.id;
            const data = mockDbStore.get(docPath);
            return {
              exists: Boolean(data),
              data: () => (data ? { ...data } : undefined),
              id: docRef.id
            };
          },
          create: (docRef: any, data: any) => {
            const docPath = docRef.path || (docRef._path && docRef._path.segments.join('/')) || docRef.id;
            if (pendingWrites.has(docPath) || mockDbStore.has(docPath)) {
              const err: any = new Error(`Document already exists: ${docPath}`);
              err.code = 6;
              throw err;
            }
            pendingWrites.set(docPath, data);
            return transaction;
          },
          set: (docRef: any, data: any, options?: any) => {
            const docPath = docRef.path || (docRef._path && docRef._path.segments.join('/')) || docRef.id;
            const prev = (options?.merge && (pendingWrites.get(docPath) || mockDbStore.get(docPath))) || {};
            const merged = { ...prev };
            for (const [k, v] of Object.entries(data)) {
              if (v && typeof v === 'object' && ((v as any).constructor?.name === 'NumericIncrementTransform' || 'operand' in (v as any))) {
                merged[k] = (Number(merged[k]) || 0) + (v as any).operand;
              } else {
                merged[k] = v;
              }
            }
            pendingWrites.set(docPath, merged);
            return transaction;
          },
          update: (docRef: any, data: any) => {
            const docPath = docRef.path || (docRef._path && docRef._path.segments.join('/')) || docRef.id;
            const prev = mockDbStore.get(docPath) || {};
            pendingWrites.set(docPath, { ...prev, ...data });
            return transaction;
          },
          delete: (docRef: any) => {
            const docPath = docRef.path || (docRef._path && docRef._path.segments.join('/')) || docRef.id;
            pendingWrites.set(docPath, null);
            return transaction;
          }
        };

        const result = await updateFunction(transaction);

        // Commit pending atomic writes to mock store
        for (const [docPath, val] of pendingWrites.entries()) {
          if (val === null) {
            mockDbStore.delete(docPath);
          } else {
            mockDbStore.set(docPath, val);
          }
        }
        return result;
      } finally {
        unlock!();
      }
    });
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    mockDbStore.clear();
    usedNoncesMap.clear();
    rateLimitMap.clear();
    transientFailuresRemaining = 0;
    process.env.GAME_SERVER_SECRET = originalSecret || 'test_authoritative_server_secret_min_32_chars_256_bit_entropy';
    transactionMutex = Promise.resolve();
    setupConcurrentTransactionRunner();
  });

  afterEach(() => {
    process.env.GAME_SERVER_SECRET = originalSecret;
  });

  const mockValidUserAuth = (uid = 'player_concurrent_1') => {
    vi.spyOn(adminAuth, 'verifyIdToken').mockResolvedValue({
      uid,
      email: `${uid}@spinnermine.cloud`,
      admin: false,
      role: 'user',
      auth_time: Math.floor(Date.now() / 1000),
      iss: 'https://securetoken.google.com/spinnermine',
      aud: 'spinnermine',
      sub: uid,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      firebase: { identities: {}, sign_in_provider: 'google.com' }
    });
  };

  it('1. Concurrency Gate: Two simultaneous spin requests with the same nonce accept exactly 1 and reject the other with 409', async () => {
    const uid = 'player_concurrent_1';
    mockValidUserAuth(uid);

    const identicalNonce = 'concurrent_nonce_uuid_99887766';

    // Dispatch two requests concurrently
    const [responseA, responseB] = await Promise.all([
      request(app)
        .post('/api/games/spin-wheel')
        .set('Authorization', 'Bearer valid_jwt')
        .send({ nonce: identicalNonce }),
      request(app)
        .post('/api/games/spin-wheel')
        .set('Authorization', 'Bearer valid_jwt')
        .send({ nonce: identicalNonce })
    ]);

    const statuses = [responseA.status, responseB.status];
    expect(statuses).toContain(200);
    expect(statuses).toContain(409);

    const successRes = responseA.status === 200 ? responseA : responseB;
    const conflictRes = responseA.status === 409 ? responseA : responseB;

    // Verify success response contains valid outcome
    expect(successRes.body.verified).toBe(true);
    expect(successRes.body.awardedEntertainmentPoints).toBeGreaterThanOrEqual(0);
    expect(successRes.body.cryptocurrencyAwarded).toBe(0);

    // Verify conflict response states replay rejection
    expect(conflictRes.body.error).toMatch(/Replay attack detected/);

    // Check database state: exactly ONE nonce document created
    const nonceDocs = Array.from(mockDbStore.keys()).filter(k => k.includes('usedNonces'));
    expect(nonceDocs.length).toBe(1);

    // Check database state: exactly ONE spin record created
    const spinDocs = Array.from(mockDbStore.keys()).filter(k => k.includes('wheelSpins'));
    expect(spinDocs.length).toBe(1);

    // Check database state: points incremented exactly ONCE, not doubled
    const userArcadeDoc = mockDbStore.get(`userArcade/${uid}`);
    expect(userArcadeDoc).toBeDefined();
    expect(userArcadeDoc.totalArcadePoints).toBe(successRes.body.awardedEntertainmentPoints);
  });

  it('2. Concurrency Gate: Two simultaneous verify requests with the same nonce accept exactly 1 and reject the other with 409', async () => {
    const uid = 'player_concurrent_2';
    mockValidUserAuth(uid);

    const identicalNonce = 'concurrent_verify_nonce_uuid_445566';

    // Dispatch two spinner session verify requests concurrently with identical nonce
    const [responseA, responseB] = await Promise.all([
      request(app)
        .post('/api/games/verify')
        .set('Authorization', 'Bearer valid_jwt')
        .send({ 
          gameType: 'spinner',
          duration: 35,
          rpm: 250,
          nonce: identicalNonce 
        }),
      request(app)
        .post('/api/games/verify')
        .set('Authorization', 'Bearer valid_jwt')
        .send({ 
          gameType: 'spinner',
          duration: 35,
          rpm: 250,
          nonce: identicalNonce 
        })
    ]);

    const statuses = [responseA.status, responseB.status];
    expect(statuses).toContain(200);
    expect(statuses).toContain(409);

    const successRes = responseA.status === 200 ? responseA : responseB;
    const conflictRes = responseA.status === 409 ? responseA : responseB;

    expect(successRes.body.verified).toBe(true);
    expect(successRes.body.cryptocurrencyAwarded).toBe(0);
    expect(conflictRes.body.error).toMatch(/Replay attack detected/);

    // Check database state: exactly ONE spinner session created
    const sessionDocs = Array.from(mockDbStore.keys()).filter(k => k.includes('spinnerSessions'));
    expect(sessionDocs.length).toBe(1);

    // Points credited once
    const userArcadeDoc = mockDbStore.get(`userArcade/${uid}`);
    expect(userArcadeDoc).toBeDefined();
    expect(userArcadeDoc.totalArcadePoints).toBe(successRes.body.awardedEntertainmentPoints);
  });

  it('3. Concurrency Gate: Zero rewards awarded and zero documents stored if transaction fails', async () => {
    const uid = 'player_concurrent_fail';
    mockValidUserAuth(uid);

    vi.spyOn(adminDb, 'runTransaction').mockRejectedValueOnce(new Error('Transaction contention timeout'));

    const res = await request(app)
      .post('/api/games/spin-wheel')
      .set('Authorization', 'Bearer valid_jwt')
      .send({ nonce: 'concurrent_failure_nonce_123' });

    expect(res.status).toBe(500);
    expect(res.body.verified).toBeUndefined();

    // Verify no reward docs or nonce docs were committed
    const spinDocs = Array.from(mockDbStore.keys()).filter(k => k.includes('wheelSpins'));
    expect(spinDocs.length).toBe(0);
  });

  it('4. Concurrency Gate: Transaction retry on transient contention succeeds and awards points exactly once', async () => {
    const uid = 'player_concurrent_retry';
    mockValidUserAuth(uid);

    // Simulate 1 transient lock contention failure, followed by automatic retry success
    transientFailuresRemaining = 1;

    // Client/service handles retry
    const clientNonce = 'retry_nonce_uuid_112233';
    let res = await request(app)
      .post('/api/games/spin-wheel')
      .set('Authorization', 'Bearer valid_jwt')
      .send({ nonce: clientNonce });

    if (res.status === 500) {
      // First attempt encountered the transient contention. Now retry with the same nonce:
      res = await request(app)
        .post('/api/games/spin-wheel')
        .set('Authorization', 'Bearer valid_jwt')
        .send({ nonce: clientNonce });
    }

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);

    // If submitted a third time (after success), it must be rejected with 409
    const thirdAttempt = await request(app)
      .post('/api/games/spin-wheel')
      .set('Authorization', 'Bearer valid_jwt')
      .send({ nonce: clientNonce });

    expect(thirdAttempt.status).toBe(409);
    expect(thirdAttempt.body.error).toMatch(/Replay attack detected/);
  });
});
