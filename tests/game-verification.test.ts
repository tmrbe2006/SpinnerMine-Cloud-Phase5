import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { 
  createServerApp, 
  adminAuth, 
  adminDb,
  WHEEL_SEGMENTS, 
  getGameServerSecret,
  usedNoncesMap, 
  rateLimitMap 
} from '../server';

describe('3. Game API Security & Real Integration Tests', () => {
  const app = createServerApp();
  const mockFirestoreDatabase = new Map<string, any>();
  const originalSecret = process.env.GAME_SERVER_SECRET;

  const setupMockTransaction = () => {
    vi.spyOn(adminDb, 'runTransaction').mockImplementation(async (updateFunction: any) => {
      const transaction = {
        get: async (docRef: any) => {
          const path = docRef.path || (docRef._path && docRef._path.segments.join('/')) || docRef.id;
          const data = mockFirestoreDatabase.get(path);
          return {
            exists: Boolean(data),
            data: () => data,
            id: docRef.id
          };
        },
        create: (docRef: any, data: any) => {
          const path = docRef.path || (docRef._path && docRef._path.segments.join('/')) || docRef.id;
          if (mockFirestoreDatabase.has(path)) {
            const err: any = new Error(`Document already exists: ${path}`);
            err.code = 6;
            throw err;
          }
          mockFirestoreDatabase.set(path, data);
          return transaction;
        },
        set: (docRef: any, data: any, options?: any) => {
          const path = docRef.path || (docRef._path && docRef._path.segments.join('/')) || docRef.id;
          if (options?.merge && mockFirestoreDatabase.has(path)) {
            const existing = mockFirestoreDatabase.get(path);
            mockFirestoreDatabase.set(path, { ...existing, ...data });
          } else {
            mockFirestoreDatabase.set(path, data);
          }
          return transaction;
        },
        update: (docRef: any, data: any) => {
          const path = docRef.path || (docRef._path && docRef._path.segments.join('/')) || docRef.id;
          const existing = mockFirestoreDatabase.get(path) || {};
          mockFirestoreDatabase.set(path, { ...existing, ...data });
          return transaction;
        },
        delete: (docRef: any) => {
          const path = docRef.path || (docRef._path && docRef._path.segments.join('/')) || docRef.id;
          mockFirestoreDatabase.delete(path);
          return transaction;
        }
      };
      return await updateFunction(transaction);
    });
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    mockFirestoreDatabase.clear();
    usedNoncesMap.clear();
    rateLimitMap.clear();
    process.env.GAME_SERVER_SECRET = originalSecret || 'test_authoritative_server_secret_min_32_chars_256_bit_entropy';
    setupMockTransaction();
  });

  afterEach(() => {
    process.env.GAME_SERVER_SECRET = originalSecret;
  });

  const mockValidUserAuth = (uid = 'player_omega_99') => {
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

  it('1. POST /api/games/spin-wheel rejects unauthenticated requests with 401', async () => {
    const res = await request(app)
      .post('/api/games/spin-wheel')
      .send({ nonce: 'nonce_12345678' });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Unauthorized');
  });

  it('2. POST /api/games/spin-wheel rejects fake test_token_* bypass with 401', async () => {
    const res = await request(app)
      .post('/api/games/spin-wheel')
      .set('Authorization', 'Bearer test_token_player_1')
      .send({ nonce: 'nonce_12345678' });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Unauthorized');
  });

  it('3. POST /api/games/spin-wheel rejects requests with missing or short nonce (< 8 chars)', async () => {
    mockValidUserAuth();

    const res = await request(app)
      .post('/api/games/spin-wheel')
      .set('Authorization', 'Bearer valid_jwt')
      .send({ nonce: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('cryptographic nonce');
  });

  it('4. POST /api/games/spin-wheel rejects client timestamps with clock skew > 5 minutes', async () => {
    mockValidUserAuth();

    const staleTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const res = await request(app)
      .post('/api/games/spin-wheel')
      .set('Authorization', 'Bearer valid_jwt')
      .send({ nonce: 'nonce_skew_check_123', clientTimestamp: staleTime });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('clock skew');
  });

  it('5. Secret Protection: getGameServerSecret throws and API rejects requests when GAME_SERVER_SECRET is missing', async () => {
    mockValidUserAuth();
    delete process.env.GAME_SERVER_SECRET;

    expect(() => getGameServerSecret()).toThrow('GAME_SERVER_SECRET');

    const res = await request(app)
      .post('/api/games/spin-wheel')
      .set('Authorization', 'Bearer valid_jwt')
      .send({ nonce: 'nonce_secret_check_12345' });

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('GAME_SERVER_SECRET');
  });

  it('6. Secret Protection: getGameServerSecret rejects secrets shorter than 32 characters (256 bits)', () => {
    process.env.GAME_SERVER_SECRET = 'short_secret_20_chars';
    expect(() => getGameServerSecret()).toThrow('insufficiently secure');
  });

  it('7. POST /api/games/spin-wheel grants authentic outcome with valid HMAC signature & 0 crypto', async () => {
    const uid = 'player_omega_99';
    mockValidUserAuth(uid);

    const nonce = 'nonce_spin_valid_12345';
    const res = await request(app)
      .post('/api/games/spin-wheel')
      .set('Authorization', 'Bearer valid_jwt')
      .send({ nonce });

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.uid).toBe(uid);
    expect(res.body.cryptocurrencyAwarded).toBe(0); // Explicit zero cryptocurrency
    expect(typeof res.body.targetIndex).toBe('number');
    expect(res.body.targetIndex).toBeGreaterThanOrEqual(0);
    expect(res.body.targetIndex).toBeLessThan(WHEEL_SEGMENTS.length);
    expect(res.body.serverSignature).toBeDefined();

    // Verify cryptographic HMAC-SHA256 signature generated by server
    const expectedPayload = `${uid}:wheel:${res.body.targetIndex}:${res.body.awardedEntertainmentPoints}:${nonce}:${res.body.timestamp}`;
    const calculatedSignature = crypto
      .createHmac('sha256', getGameServerSecret())
      .update(expectedPayload)
      .digest('hex');

    expect(res.body.serverSignature).toBe(calculatedSignature);
  });

  it('8. Atomic Replay Protection: Replaying the same nonce returns 409 Conflict', async () => {
    mockValidUserAuth('player_omega_99');

    const nonce = 'replay_test_nonce_88888';

    // First request: succeeds
    const res1 = await request(app)
      .post('/api/games/spin-wheel')
      .set('Authorization', 'Bearer valid_jwt')
      .send({ nonce });
    expect(res1.status).toBe(200);

    // Second request with EXACT SAME nonce: Replay detected and rejected with 409
    const res2 = await request(app)
      .post('/api/games/spin-wheel')
      .set('Authorization', 'Bearer valid_jwt')
      .send({ nonce });
    expect(res2.status).toBe(409);
    expect(res2.body.error).toContain('Replay attack detected');
  });

  it('9. Double Reward Protection: Prevents duplicate point increments from replayed requests', async () => {
    mockValidUserAuth('player_prevent_double');

    const nonce = 'nonce_double_point_check';

    const res1 = await request(app)
      .post('/api/games/spin-wheel')
      .set('Authorization', 'Bearer valid_jwt')
      .send({ nonce });
    expect(res1.status).toBe(200);
    expect(res1.body.verified).toBe(true);

    // Replay attempt fails immediately, preventing double reward addition
    const res2 = await request(app)
      .post('/api/games/spin-wheel')
      .set('Authorization', 'Bearer valid_jwt')
      .send({ nonce });
    expect(res2.status).toBe(409);
    expect(res2.body.verified).toBeUndefined();
  });

  it('10. Financial & Ledger Consistency: Database failure rejects reward confirmation and never returns verified: true', async () => {
    mockValidUserAuth('player_db_failure');

    // Simulate database / transaction failure
    vi.spyOn(adminDb, 'runTransaction').mockRejectedValueOnce(new Error('Firestore cluster connection timeout'));

    const res = await request(app)
      .post('/api/games/spin-wheel')
      .set('Authorization', 'Bearer valid_jwt')
      .send({ nonce: 'nonce_db_failure_12345' });

    expect(res.status).toBe(500);
    expect(res.body.verified).toBeUndefined(); // Crucial: verified is never true on DB error
    expect(res.body.error).toContain('Failed to atomically verify and record game outcome in ledger');
  });

  it('11. Distributed Rate Limiter: Enforces minimum 2.0s cooldown between consecutive spins', async () => {
    mockValidUserAuth('player_rate_limited');

    const res1 = await request(app)
      .post('/api/games/spin-wheel')
      .set('Authorization', 'Bearer valid_jwt')
      .send({ nonce: 'rate_limit_nonce_1111' });
    expect(res1.status).toBe(200);

    // Immediate second request with a new nonce
    const res2 = await request(app)
      .post('/api/games/spin-wheel')
      .set('Authorization', 'Bearer valid_jwt')
      .send({ nonce: 'rate_limit_nonce_2222' });
    expect(res2.status).toBe(429);
    expect(res2.body.error).toContain('Rate limit cooldown active');
  });

  it('12. POST /api/games/verify rejects session duration < 2 seconds', async () => {
    mockValidUserAuth('player_spinner_fast');

    const res = await request(app)
      .post('/api/games/verify')
      .set('Authorization', 'Bearer valid_jwt')
      .send({
        gameType: 'spinner',
        duration: 1, // Below minimum threshold
        rpm: 500,
        nonce: 'nonce_spinner_duration_1'
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Minimum session duration');
  });

  it('13. POST /api/games/verify decouples points from client RPM, awarding safe fixed points and 0 crypto', async () => {
    mockValidUserAuth('player_spinner_safe');

    const res = await request(app)
      .post('/api/games/verify')
      .set('Authorization', 'Bearer valid_jwt')
      .send({
        gameType: 'spinner',
        duration: 10,
        rpm: 99999, // Artificially inflated client RPM
        nonce: 'nonce_spinner_safe_points'
      });

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.awardedEntertainmentPoints).toBe(25); // Server-enforced fixed points, unaffected by 99999 RPM
    expect(res.body.cryptocurrencyAwarded).toBe(0); // Zero crypto
    expect(res.body.serverSignature).toBeDefined();
  });
});
