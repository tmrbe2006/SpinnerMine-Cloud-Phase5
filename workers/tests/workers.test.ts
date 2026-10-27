import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../src/index';
import { setCachedPublicKeysForTesting } from '../src/auth';
import { generateTestRsaKeyPair, createMockFirebaseIdToken, createMockEnv, TestKeyPair } from './testHelpers';
import { toFirestoreValue } from '../src/firestore';

describe('Cloudflare Worker - Worker Registration & Telemetry', () => {
  let keyPair: TestKeyPair;
  let userToken: string;
  let otherUserToken: string;
  let adminToken: string;
  const env = createMockEnv();

  // In-memory mock store for Firestore documents in this test suite
  const mockStore = new Map<string, any>();

  beforeEach(async () => {
    mockStore.clear();
    keyPair = await generateTestRsaKeyPair('kid-beta');
    const keysMap = new Map<string, CryptoKey>();
    keysMap.set(keyPair.kid, keyPair.publicKey);
    setCachedPublicKeysForTesting(keysMap);

    userToken = await createMockFirebaseIdToken(keyPair, { uid: 'user_tm_owner', email: 'miner@spinnermine.com' });
    otherUserToken = await createMockFirebaseIdToken(keyPair, { uid: 'user_stranger', email: 'other@spinnermine.com' });
    adminToken = await createMockFirebaseIdToken(keyPair, { uid: 'admin_sys', admin: true, role: 'admin' });

    // Mock global fetch to handle Firestore REST API calls
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString();

      // Handle Firestore REST API requests
      if (urlStr.includes('/databases/(default)/documents')) {
        const method = init?.method || 'GET';

        // 1. Single Document GET: /documents/{collection}/{docId}
        const docMatch = urlStr.match(/\/documents\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_%-]+)(?:\?.*)?$/);
        if (docMatch && method === 'GET') {
          const [, coll, rawId] = docMatch;
          const id = decodeURIComponent(rawId);
          const key = `${coll}/${id}`;
          if (mockStore.has(key)) {
            const data = mockStore.get(key);
            const fields: Record<string, any> = {};
            for (const [k, v] of Object.entries(data)) {
              fields[k] = toFirestoreValue(v);
            }
            return new Response(JSON.stringify({ name: `projects/.../documents/${key}`, fields }), { status: 200 });
          }
          return new Response(JSON.stringify({ error: { message: 'Document not found' } }), { status: 404 });
        }

        // 2. Single Document PATCH: /documents/{collection}/{docId}
        if (docMatch && method === 'PATCH') {
          const [, coll, rawId] = docMatch;
          const id = decodeURIComponent(rawId);
          const key = `${coll}/${id}`;
          const body = JSON.parse((init?.body as string) || '{}');
          const fields = body.fields || {};
          const current = mockStore.get(key) || { id };
          for (const [k, valObj] of Object.entries(fields)) {
            current[k] = (valObj as any).stringValue ?? (valObj as any).integerValue ?? (valObj as any).booleanValue ?? valObj;
          }
          mockStore.set(key, current);
          return new Response(JSON.stringify({ name: `projects/.../documents/${key}`, fields }), { status: 200 });
        }

        // 3. Query: /documents:runQuery
        if (urlStr.includes(':runQuery') && method === 'POST') {
          const body = JSON.parse((init?.body as string) || '{}');
          const fromColl = body.structuredQuery?.from?.[0]?.collectionId;
          const filter = body.structuredQuery?.where?.fieldFilter;
          const results: any[] = [];

          for (const [key, data] of mockStore.entries()) {
            if (key.startsWith(`${fromColl}/`)) {
              if (filter) {
                const targetField = filter.field.fieldPath;
                const expectedVal = filter.value.stringValue || filter.value.integerValue || filter.value.booleanValue;
                if (data[targetField] !== expectedVal) {
                  continue;
                }
              }
              const fields: Record<string, any> = {};
              for (const [k, v] of Object.entries(data)) {
                fields[k] = toFirestoreValue(v);
              }
              results.push({ document: { name: `projects/.../documents/${key}`, fields } });
            }
          }
          return new Response(JSON.stringify(results), { status: 200 });
        }
      }

      return new Response(JSON.stringify({ error: 'Mock fetch unhandled' }), { status: 400 });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setCachedPublicKeysForTesting(null);
  });

  it('registers device "tm" successfully and ensures user document is created', async () => {
    const req = new Request('https://worker.spinnermine.workers.dev/api/workers/register', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        workerId: 'w_user_tm_owner_tm',
        name: 'tm',
        deviceName: 'tm',
        platform: 'windows',
        cpuCores: 8,
        threads: 4,
        xmrigVersion: '6.26.0'
      })
    });

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);

    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.worker.name).toBe('tm');
    expect(body.worker.userId).toBe('user_tm_owner');
    expect(body.worker.status).toBe('offline'); // Never auto-start mining!

    // Verify stored in mock database
    expect(mockStore.has('miningWorkers/w_user_tm_owner_tm')).toBe(true);
    // Verify user profile auto-created
    expect(mockStore.has('users/user_tm_owner')).toBe(true);
  });

  it('rejects registering a worker ID already owned by another user with HTTP 403', async () => {
    // Pre-populate worker owned by user_tm_owner
    mockStore.set('miningWorkers/w_shared_worker_id', {
      workerId: 'w_shared_worker_id',
      userId: 'user_tm_owner',
      name: 'Rig 1'
    });

    // Stranger tries to register the same workerId
    const req = new Request('https://worker.spinnermine.workers.dev/api/workers/register', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${otherUserToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        workerId: 'w_shared_worker_id',
        name: 'Hijacked Rig'
      })
    });

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(403);
    const body: any = await res.json();
    expect(body.error).toContain('Worker ID is already registered to another user account');
  });

  it('rejects registering a duplicate device name under the same user with HTTP 409', async () => {
    // Pre-populate worker named "tm"
    mockStore.set('miningWorkers/w_user_tm_owner_tm', {
      id: 'w_user_tm_owner_tm',
      workerId: 'w_user_tm_owner_tm',
      userId: 'user_tm_owner',
      name: 'tm'
    });

    // Same user tries to register another worker with the same name "tm" but different workerId
    const req = new Request('https://worker.spinnermine.workers.dev/api/workers/register', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        workerId: 'w_user_tm_owner_tm_duplicate',
        name: 'tm'
      })
    });

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(409);
    const body: any = await res.json();
    expect(body.error).toContain('already registered on your account');
  });

  it('rejects invalid or missing workerId with HTTP 400', async () => {
    const req = new Request('https://worker.spinnermine.workers.dev/api/workers/register', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        workerId: 'a', // too short (< 2)
        name: 'Short'
      })
    });

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
  });

  it('returns HTTP 403 with PERMISSION_DENIED and exact operation when Firestore rejects request', async () => {
    // Override global fetch mock for this test to simulate 403 PERMISSION_DENIED on Firestore REST
    vi.stubGlobal('fetch', async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/databases/(default)/documents')) {
        return new Response(JSON.stringify({
          error: {
            code: 403,
            message: 'Missing or insufficient permissions.',
            status: 'PERMISSION_DENIED'
          }
        }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: 'Not handled' }), { status: 404 });
    });

    const req = new Request('https://worker.spinnermine.workers.dev/api/workers/register', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        workerId: 'w_user_tm_owner_tm',
        name: 'tm',
        platform: 'windows'
      })
    });

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(403);
    const body: any = await res.json();
    expect(body.code).toBe('PERMISSION_DENIED');
    expect(body.error).toContain('Firestore permission denied');
    expect(body.operation).toContain('GET miningWorkers/w_user_tm_owner_tm');
  });

  it('guarantees registered worker strictly contains no financial or reward fields', async () => {
    const req = new Request('https://worker.spinnermine.workers.dev/api/workers/register', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        workerId: 'w_user_tm_owner_tm_clean',
        name: 'tm',
        platform: 'windows',
        // Attempt injection of illegal financial properties from client
        balance: 1000,
        earnings: 50,
        revenue: 100,
        acceptedShares: 9999,
        rejectedShares: 0,
        confirmedBalance: 500
      })
    });

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);

    const storedDoc = mockStore.get('miningWorkers/w_user_tm_owner_tm_clean');
    expect(storedDoc).toBeDefined();
    // Verify none of the forbidden fields were stored
    expect(storedDoc.balance).toBeUndefined();
    expect(storedDoc.earnings).toBeUndefined();
    expect(storedDoc.revenue).toBeUndefined();
    expect(storedDoc.acceptedShares).toBeUndefined();
    expect(storedDoc.confirmedBalance).toBeUndefined();
    expect(storedDoc.status).toBe('offline'); // Never auto-start mining
  });

  it('accepts telemetry metrics with strict financialBalanceImpact = 0', async () => {
    mockStore.set('miningWorkers/w_user_tm_owner_tm', {
      id: 'w_user_tm_owner_tm',
      workerId: 'w_user_tm_owner_tm',
      userId: 'user_tm_owner',
      name: 'tm',
      status: 'offline'
    });

    const req = new Request('https://worker.spinnermine.workers.dev/api/workers/telemetry', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        workerId: 'w_user_tm_owner_tm',
        reportedHashrate: 450,
        status: 'mining',
        threads: 4,
        cpuUsage: 45
      })
    });

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);

    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.version).toBe('1.0.3');
    expect(body.financialBalanceImpact).toBe(0);
    expect(body.reportedHashrate).toBe(450);
  });

  it('lists user workers', async () => {
    mockStore.set('miningWorkers/w1', { id: 'w1', workerId: 'w1', userId: 'user_tm_owner', name: 'Device 1' });
    mockStore.set('miningWorkers/w2', { id: 'w2', workerId: 'w2', userId: 'user_stranger', name: 'Device 2' });

    const req = new Request('https://worker.spinnermine.workers.dev/api/workers', {
      method: 'GET',
      headers: { Authorization: `Bearer ${userToken}` }
    });

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.workers.length).toBe(1);
    expect(body.workers[0].name).toBe('Device 1');
  });

  it('returns 404 NOT_FOUND when sending heartbeat for non-existent worker', async () => {
    const req = new Request('https://worker.spinnermine.workers.dev/api/workers/telemetry', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        workerId: 'w_non_existent_device',
        status: 'online',
        cpuUsage: 15
      })
    });

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(404);
    const body: any = await res.json();
    expect(body.code).toBe('NOT_FOUND');
    expect(body.error).toContain('Worker not found');
  });

  it('returns 403 PERMISSION_DENIED when attempting to update worker owned by another user', async () => {
    mockStore.set('miningWorkers/w_user_stranger_device', {
      id: 'w_user_stranger_device',
      workerId: 'w_user_stranger_device',
      userId: 'user_stranger',
      name: 'stranger_pc',
      status: 'offline'
    });

    // user_tm_owner tries to update stranger's device
    const req = new Request('https://worker.spinnermine.workers.dev/api/workers/telemetry', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        workerId: 'w_user_stranger_device',
        status: 'online',
        cpuUsage: 25
      })
    });

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(403);
    const body: any = await res.json();
    expect(body.code).toBe('PERMISSION_DENIED');
    expect(body.error).toContain('Forbidden');
  });

  it('recovers gracefully and updates heartbeat if Firestore rejects cpuUsage due to legacy rules', async () => {
    mockStore.set('miningWorkers/w_user_tm_owner_tv', {
      id: 'w_user_tm_owner_tv',
      workerId: 'w_user_tm_owner_tv',
      userId: 'user_tm_owner',
      name: 'tv',
      status: 'offline'
    });

    // Intercept fetch to simulate legacy Firestore rules rejecting cpuUsage with 403
    const originalFetch = globalThis.fetch;
    let attemptedWithCpuUsage = false;
    let fallbackAttempted = false;

    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('PATCH') || (init?.method === 'PATCH')) {
        if (urlStr.includes('updateMask.fieldPaths=cpuUsage')) {
          attemptedWithCpuUsage = true;
          return new Response(
            JSON.stringify({
              error: {
                code: 403,
                message: 'Missing or insufficient permissions.',
                status: 'PERMISSION_DENIED'
              }
            }),
            { status: 403 }
          );
        } else {
          fallbackAttempted = true;
          // Without cpuUsage, the update succeeds
          const key = 'miningWorkers/w_user_tm_owner_tv';
          const existing = mockStore.get(key);
          mockStore.set(key, { ...existing, status: 'online', lastSeen: new Date().toISOString() });
          return new Response(
            JSON.stringify({
              name: `projects/.../documents/${key}`,
              fields: {
                status: { stringValue: 'online' },
                lastSeen: { stringValue: new Date().toISOString() }
              }
            }),
            { status: 200 }
          );
        }
      }
      return originalFetch(url, init);
    });

    const req = new Request('https://worker.spinnermine.workers.dev/api/workers/telemetry', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        workerId: 'w_user_tm_owner_tv',
        status: 'online',
        threads: 4,
        cpuUsage: 18.5
      })
    });

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.status).toBe('online');
    expect(attemptedWithCpuUsage).toBe(true);
    expect(fallbackAttempted).toBe(true);
    expect(body.notice).toContain('cpuUsage omitted');

    const updated = mockStore.get('miningWorkers/w_user_tm_owner_tv');
    expect(updated.status).toBe('online');
  });

  it('preserves true 403 error if update fails for unauthorized user even without cpuUsage', async () => {
    mockStore.set('miningWorkers/w_user_tm_owner_locked', {
      id: 'w_user_tm_owner_locked',
      workerId: 'w_user_tm_owner_locked',
      userId: 'user_tm_owner',
      name: 'locked_device',
      status: 'offline'
    });

    // Stranger tries to update without cpuUsage
    const req = new Request('https://worker.spinnermine.workers.dev/api/workers/telemetry', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${otherUserToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        workerId: 'w_user_tm_owner_locked',
        status: 'online'
      })
    });

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(403);
    const body: any = await res.json();
    expect(body.code).toBe('PERMISSION_DENIED');
  });

  describe('Worker Merge & Archive Endpoints', () => {
    beforeEach(() => {
      // Seed primary worker "tm"
      mockStore.set('miningWorkers/w_qBPFqVEe_tm', {
        id: 'w_qBPFqVEe_tm',
        workerId: 'w_qBPFqVEe_tm',
        userId: 'user_tm_owner',
        name: 'tm',
        deviceName: 'Windows-PC-1',
        platform: 'windows',
        cpuCores: 8,
        threads: 4,
        status: 'online',
        acceptedShares: 42,
        rejectedShares: 0,
        installationId: 'inst_windows_primary_123',
        createdAt: '2026-10-20T10:00:00.000Z'
      });

      // Seed duplicate worker "ty"
      mockStore.set('miningWorkers/w_GyAldfJ5_ty', {
        id: 'w_GyAldfJ5_ty',
        workerId: 'w_GyAldfJ5_ty',
        userId: 'user_tm_owner',
        name: 'ty',
        deviceName: 'Windows-PC-1',
        platform: 'windows',
        cpuCores: 8,
        threads: 4,
        status: 'online',
        acceptedShares: 5,
        rejectedShares: 0,
        installationId: 'inst_windows_primary_123',
        createdAt: '2026-10-24T12:00:00.000Z'
      });

      // Seed a worker belonging to another user
      mockStore.set('miningWorkers/w_other_user_rig', {
        id: 'w_other_user_rig',
        workerId: 'w_other_user_rig',
        userId: 'user_stranger',
        name: 'stranger_rig',
        status: 'online',
        acceptedShares: 10
      });
    });

    it('successfully merges duplicate ty into primary tm without deleting document or altering financial balances', async () => {
      const req = new Request('https://worker.spinnermine.workers.dev/api/workers/merge', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          primaryWorkerId: 'w_qBPFqVEe_tm',
          secondaryWorkerId: 'w_GyAldfJ5_ty',
          reason: 'Duplicate Windows PC resolution'
        })
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(200);

      const body: any = await res.json();
      expect(body.success).toBe(true);
      expect(body.primaryWorkerId).toBe('w_qBPFqVEe_tm');
      expect(body.mergedWorkerId).toBe('w_GyAldfJ5_ty');
      expect(body.retainedAcceptedShares).toBe(5);
      expect(body.financialBalanceImpact).toBe(0);
      expect(body.auditRecord).toBeDefined();
      expect(body.auditRecord.action).toBe('WORKER_MERGE');
      expect(body.auditRecord.mergedBy).toBe('user_tm_owner');

      // 1. Verify secondary document still exists in Firestore (NEVER deleted!)
      const secondaryDoc = mockStore.get('miningWorkers/w_GyAldfJ5_ty');
      expect(secondaryDoc).toBeDefined();
      expect(secondaryDoc.id).toBe('w_GyAldfJ5_ty');

      // 2. Verify audit and status fields on duplicate
      expect(secondaryDoc.mergedInto).toBe('w_qBPFqVEe_tm');
      expect(secondaryDoc.isArchived).toBe(true);
      expect(secondaryDoc.status).toBe('archived');
      expect(secondaryDoc.archiveReason).toContain('Duplicate Windows PC resolution');

      // 3. Verify financial shares remain intact for audit
      expect(secondaryDoc.acceptedShares).toBe(5);
    });

    it('strictly forbids merging workers belonging to different users with HTTP 403', async () => {
      // user_tm_owner attempts to merge other user's worker into tm
      const req = new Request('https://worker.spinnermine.workers.dev/api/workers/merge', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          primaryWorkerId: 'w_qBPFqVEe_tm',
          secondaryWorkerId: 'w_other_user_rig'
        })
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(403);
      const body: any = await res.json();
      expect(body.code).toBe('CROSS_USER_MERGE_FORBIDDEN');
      expect(body.error).toContain('different user accounts');
    });

    it('rejects merge when caller is not the owner with HTTP 403', async () => {
      // user_stranger attempts to merge user_tm_owner's workers
      const req = new Request('https://worker.spinnermine.workers.dev/api/workers/merge', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${otherUserToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          primaryWorkerId: 'w_qBPFqVEe_tm',
          secondaryWorkerId: 'w_GyAldfJ5_ty'
        })
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(403);
      const body: any = await res.json();
      expect(body.code).toBe('PERMISSION_DENIED');
    });

    it('rejects merging a worker into itself with HTTP 400', async () => {
      const req = new Request('https://worker.spinnermine.workers.dev/api/workers/merge', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          primaryWorkerId: 'w_qBPFqVEe_tm',
          secondaryWorkerId: 'w_qBPFqVEe_tm'
        })
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.error).toContain('Cannot merge a worker into itself');
    });

    it('returns HTTP 404 when merging non-existent worker', async () => {
      const req = new Request('https://worker.spinnermine.workers.dev/api/workers/merge', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          primaryWorkerId: 'w_qBPFqVEe_tm',
          secondaryWorkerId: 'w_ghost_worker'
        })
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body.code).toBe('NOT_FOUND');
    });

    it('returns HTTP 401 when merge request has Missing Token', async () => {
      const req = new Request('https://worker.spinnermine.workers.dev/api/workers/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primaryWorkerId: 'w_qBPFqVEe_tm',
          secondaryWorkerId: 'w_GyAldfJ5_ty'
        })
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(401);
      const body: any = await res.json();
      expect(body.error).toContain('Missing or invalid Authorization Bearer token');
    });

    it('returns HTTP 401 when archive request has Missing Token', async () => {
      const req = new Request('https://worker.spinnermine.workers.dev/api/workers/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workerId: 'w_GyAldfJ5_ty'
        })
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(401);
      const body: any = await res.json();
      expect(body.error).toContain('Missing or invalid Authorization Bearer token');
    });

    it('returns HTTP 401 when merge request provides an Expired Token', async () => {
      const expiredToken = await createMockFirebaseIdToken(keyPair, {
        uid: 'user_tm_owner',
        exp: Math.floor(Date.now() / 1000) - 120
      });

      const req = new Request('https://worker.spinnermine.workers.dev/api/workers/merge', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${expiredToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          primaryWorkerId: 'w_qBPFqVEe_tm',
          secondaryWorkerId: 'w_GyAldfJ5_ty'
        })
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(401);
      const body: any = await res.json();
      expect(body.error).toContain('Token has expired');
    });

    it('returns HTTP 401 when archive request provides an Expired Token', async () => {
      const expiredToken = await createMockFirebaseIdToken(keyPair, {
        uid: 'user_tm_owner',
        exp: Math.floor(Date.now() / 1000) - 120
      });

      const req = new Request('https://worker.spinnermine.workers.dev/api/workers/archive', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${expiredToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          workerId: 'w_GyAldfJ5_ty'
        })
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(401);
      const body: any = await res.json();
      expect(body.error).toContain('Token has expired');
    });

    it('rejects merge when caller is Wrong User with HTTP 403', async () => {
      // otherUserToken caller (user_stranger) attempts to merge tm and ty owned by user_tm_owner
      const req = new Request('https://worker.spinnermine.workers.dev/api/workers/merge', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${otherUserToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          primaryWorkerId: 'w_qBPFqVEe_tm',
          secondaryWorkerId: 'w_GyAldfJ5_ty'
        })
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(403);
      const body: any = await res.json();
      expect(body.code).toBe('PERMISSION_DENIED');
      expect(body.error).toContain('You do not own');
    });

    it('rejects archive when caller is Wrong User with HTTP 403', async () => {
      // user_stranger attempts to archive w_GyAldfJ5_ty owned by user_tm_owner
      const req = new Request('https://worker.spinnermine.workers.dev/api/workers/archive', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${otherUserToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          workerId: 'w_GyAldfJ5_ty'
        })
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(403);
      const body: any = await res.json();
      expect(body.error).toContain('You do not own this worker device');
    });

    it('successfully archives worker safely without deleting document', async () => {
      const req = new Request('https://worker.spinnermine.workers.dev/api/workers/archive', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          workerId: 'w_GyAldfJ5_ty',
          reason: 'Manual user archival'
        })
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(200);

      const doc = mockStore.get('miningWorkers/w_GyAldfJ5_ty');
      expect(doc).toBeDefined();
      expect(doc.isArchived).toBe(true);
      expect(doc.status).toBe('archived');
      expect(doc.archiveReason).toBe('Manual user archival');
    });

    it('Requirement 8: Re-registering the same Windows machine reuses tm and strictly prevents 3rd worker creation', async () => {
      // User attempts to register again with same installationId
      const req = new Request('https://worker.spinnermine.workers.dev/api/workers/register', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: 'Windows Desktop Client',
          deviceName: 'Windows-PC-1',
          platform: 'windows',
          cpuCores: 8,
          threads: 4,
          installationId: 'inst_windows_primary_123'
        })
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(200);

      const body: any = await res.json();
      expect(body.success).toBe(true);
      // Must resolve to primary worker w_qBPFqVEe_tm, NOT creating a 3rd ID
      expect(body.worker.workerId).toBe('w_qBPFqVEe_tm');

      // Verify no 3rd worker exists in mockStore under this user
      const userWorkerKeys = Array.from(mockStore.keys()).filter(k => k.startsWith('miningWorkers/w_'));
      expect(userWorkerKeys.length).toBe(3); // tm, ty, other_user_rig
    });
  });
});
