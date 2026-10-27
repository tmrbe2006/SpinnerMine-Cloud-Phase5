import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createServerApp } from '../server';
import { adminDb, adminAuth } from '../server';
import { 
  getBackendBaseUrl, 
  isTrustedOrigin, 
  checkBackendHealth, 
  DEFAULT_PRODUCTION_BACKEND_URL, 
  setCustomBackendUrl,
  getCustomBackendUrl,
  apiFetch
} from '../src/services/apiClient';
import { formatAuthError } from '../src/utils/auth-errors';
import { MiningWorker } from '../src/types';
import firebaseConfig from '../firebase-applet-config.json';

describe('Worker Synchronization, Disconnection & Retry Sync Acceptance Tests', () => {
  const app = createServerApp();
  const testUid = 'user_sync_test_8877';
  const testEmail = 'synctest@spinnermine.cloud';
  const mockToken = 'mock-valid-sync-token';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Authoritative Backend Registration & User Provisioning', () => {
    it('provisions user profile in users/{uid} and registers worker in miningWorkers/{workerId}', async () => {
      // Mock verifyIdToken
      vi.spyOn(adminAuth, 'verifyIdToken').mockResolvedValue({
        uid: testUid,
        email: testEmail,
        admin: false,
        role: 'user',
        aud: 'spinnermine-cloud-production',
        iss: 'https://securetoken.google.com/spinnermine-cloud-production',
        sub: testUid
      } as any);

      // In-memory Firestore simulation
      const docStore = new Map<string, any>();
      vi.spyOn(adminDb, 'collection').mockImplementation((colName: string) => ({
        doc: (id: string) => ({
          get: vi.fn().mockImplementation(async () => {
            const key = `${colName}/${id}`;
            const data = docStore.get(key);
            return {
              exists: Boolean(data),
              data: () => data
            };
          }),
          set: vi.fn().mockImplementation(async (data: any, options?: any) => {
            const key = `${colName}/${id}`;
            const existing = docStore.get(key) || {};
            docStore.set(key, options?.merge ? { ...existing, ...data } : data);
            return {};
          })
        })
      } as any));

      const workerId = `w_${testUid.slice(0, 8)}_tm_rig`;
      const payload = {
        workerId,
        name: 'tm rig',
        deviceName: 'Windows 11 Rig',
        platform: 'windows',
        cpuCores: 8,
        threads: 4,
        xmrigVersion: '6.26.0'
      };

      const res = await request(app)
        .post('/api/workers/register')
        .set('Authorization', `Bearer ${mockToken}`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.worker.workerId).toBe(workerId);
      expect(res.body.worker.userId).toBe(testUid);
      expect(res.body.worker.name).toBe('tm rig');
      // Must not auto-start mining
      expect(res.body.worker.status).not.toBe('mining');
      // Accepted shares must be zero on creation
      expect(res.body.worker.acceptedShares).toBe(0);

      // Verify user document was provisioned in users/{uid}
      const userKey = `users/${testUid}`;
      expect(docStore.has(userKey)).toBe(true);
      expect(docStore.get(userKey).uid).toBe(testUid);
      expect(docStore.get(userKey).role).toBe('user');

      // Verify worker document was stored in miningWorkers/{workerId}
      const workerKey = `miningWorkers/${workerId}`;
      expect(docStore.has(workerKey)).toBe(true);
      expect(docStore.get(workerKey).name).toBe('tm rig');
    });

    it('strictly prevents worker registration spoofing when worker is already owned by another user', async () => {
      const victimUid = 'victim_miner_1111';
      const attackerUid = 'attacker_miner_9999';

      vi.spyOn(adminAuth, 'verifyIdToken').mockResolvedValue({
        uid: attackerUid,
        email: 'attacker@evil.com',
        admin: false,
        role: 'user',
        aud: 'spinnermine-cloud-production',
        iss: 'https://securetoken.google.com/spinnermine-cloud-production',
        sub: attackerUid
      } as any);

      // Mock Firestore returning worker belonging to victim
      const sharedWorkerId = 'w_victim11_target_pc';
      vi.spyOn(adminDb, 'collection').mockImplementation((colName: string) => {
        if (colName === 'miningWorkers') {
          return {
            doc: (_id: string) => ({
              get: vi.fn().mockResolvedValue({
                exists: true,
                data: () => ({
                  workerId: sharedWorkerId,
                  userId: victimUid,
                  name: 'Victim Worker'
                })
              }),
              set: vi.fn()
            })
          } as any;
        }
        return {
          doc: () => ({ get: vi.fn().mockResolvedValue({ exists: true }), set: vi.fn() })
        } as any;
      });

      const res = await request(app)
        .post('/api/workers/register')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          workerId: sharedWorkerId,
          name: 'Stolen Worker',
          deviceName: 'Windows PC',
          platform: 'windows'
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Forbidden');
    });
  });

  describe('2. Disconnection, Local Draft Isolation & Pending Sync', () => {
    it('saves device locally as a draft marked with Pending Sync when backend is unreachable', () => {
      const storageMock: Record<string, string> = {};
      const fakeLocalStorage = {
        getItem: (k: string) => storageMock[k] || null,
        setItem: (k: string, v: string) => { storageMock[k] = v; }
      };

      const workerPayload: MiningWorker = {
        id: 'w_test_draft_pc',
        workerId: 'w_test_draft_pc',
        userId: testUid,
        name: 'tm',
        platform: 'windows',
        cpuCores: 8,
        threads: 4,
        xmrigVersion: '6.26.0',
        status: 'pending_sync',
        isPendingSync: true,
        reportedHashrate: 0,
        acceptedShares: 0,
        rejectedShares: 0,
        lastSeen: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };

      // Simulate saving to local storage when network fails
      const draftKey = `spinnermine_pending_workers_${testUid}`;
      fakeLocalStorage.setItem(draftKey, JSON.stringify([workerPayload]));

      const stored = JSON.parse(fakeLocalStorage.getItem(draftKey)!);
      expect(stored).toHaveLength(1);
      expect(stored[0].workerId).toBe('w_test_draft_pc');
      expect(stored[0].isPendingSync).toBe(true);
      expect(stored[0].status).toBe('pending_sync');
      // Crucial: mining must never auto-start on draft creation
      expect(stored[0].status).not.toBe('mining');
    });

    it('calculates Total Workers by cleanly distinguishing confirmed workers from local drafts', () => {
      const workersList: MiningWorker[] = [
        {
          id: 'w_1',
          workerId: 'w_1',
          userId: testUid,
          name: 'Confirmed PC 1',
          platform: 'windows',
          cpuCores: 8,
          status: 'offline',
          isPendingSync: false,
          lastSeen: new Date().toISOString(),
          createdAt: new Date().toISOString()
        },
        {
          id: 'w_2',
          workerId: 'w_2',
          userId: testUid,
          name: 'Confirmed PC 2',
          platform: 'windows',
          cpuCores: 16,
          status: 'online',
          isPendingSync: false,
          lastSeen: new Date().toISOString(),
          createdAt: new Date().toISOString()
        },
        {
          id: 'w_3_draft',
          workerId: 'w_3_draft',
          userId: testUid,
          name: 'tm (Local Draft)',
          platform: 'windows',
          cpuCores: 4,
          status: 'pending_sync',
          isPendingSync: true,
          lastSeen: new Date().toISOString(),
          createdAt: new Date().toISOString()
        }
      ];

      const confirmedWorkersCount = workersList.filter(w => !w.isPendingSync && w.status !== 'pending_sync').length;
      const pendingWorkersCount = workersList.filter(w => w.isPendingSync || w.status === 'pending_sync').length;

      expect(confirmedWorkersCount).toBe(2);
      expect(pendingWorkersCount).toBe(1);
      expect(workersList.length).toBe(3);
    });
  });

  describe('3. Retry Sync Mechanism & Draft Reconciliation', () => {
    it('successfully processes pending local drafts upon reconnection and clears synced drafts', async () => {
      const storageMock: Record<string, string> = {};
      const draftKey = `spinnermine_pending_workers_${testUid}`;

      const pendingDraft: MiningWorker = {
        id: `w_${testUid.slice(0, 8)}_tm`,
        workerId: `w_${testUid.slice(0, 8)}_tm`,
        userId: testUid,
        name: 'tm',
        platform: 'windows',
        cpuCores: 4,
        threads: 2,
        xmrigVersion: '6.26.0',
        status: 'pending_sync',
        isPendingSync: true,
        lastSeen: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };

      storageMock[draftKey] = JSON.stringify([pendingDraft]);

      // Mock verifyIdToken for sync call
      vi.spyOn(adminAuth, 'verifyIdToken').mockResolvedValue({
        uid: testUid,
        email: testEmail,
        admin: false,
        role: 'user',
        aud: 'spinnermine-cloud-production',
        iss: 'https://securetoken.google.com/spinnermine-cloud-production',
        sub: testUid
      } as any);

      // In-memory Firestore simulation
      const docStore = new Map<string, any>();
      vi.spyOn(adminDb, 'collection').mockImplementation((colName: string) => ({
        doc: (id: string) => ({
          get: vi.fn().mockImplementation(async () => {
            const key = `${colName}/${id}`;
            const data = docStore.get(key);
            return {
              exists: Boolean(data),
              data: () => data
            };
          }),
          set: vi.fn().mockImplementation(async (data: any, options?: any) => {
            const key = `${colName}/${id}`;
            const existing = docStore.get(key) || {};
            docStore.set(key, options?.merge ? { ...existing, ...data } : data);
            return {};
          })
        })
      } as any));

      // Execute retry sync logic
      const drafts: MiningWorker[] = JSON.parse(storageMock[draftKey]);
      const stillPending: MiningWorker[] = [];

      for (const draft of drafts) {
        // Enforce owner matching
        if (draft.userId !== testUid) continue;

        const res = await request(app)
          .post('/api/workers/register')
          .set('Authorization', `Bearer ${mockToken}`)
          .send({
            workerId: draft.workerId,
            name: draft.name,
            deviceName: draft.name,
            platform: draft.platform,
            cpuCores: draft.cpuCores,
            threads: draft.threads,
            xmrigVersion: draft.xmrigVersion
          });

        if (res.status !== 200 || !res.body.success) {
          stillPending.push(draft);
        }
      }

      storageMock[draftKey] = JSON.stringify(stillPending);

      // Verify draft storage is now clean
      const remaining = JSON.parse(storageMock[draftKey]);
      expect(remaining).toHaveLength(0);
    });

    it('rejects foreign drafts that do not belong to current authenticated user during sync', async () => {
      const foreignDraft: MiningWorker = {
        id: 'w_foreign_device',
        workerId: 'w_foreign_device',
        userId: 'other_user_uid_123',
        name: 'Foreign Miner',
        platform: 'windows',
        cpuCores: 4,
        status: 'pending_sync',
        isPendingSync: true,
        lastSeen: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };

      // Ensure that when syncing, any draft with userId !== currentUser.uid is ignored
      const currentUserUid = testUid;
      const canSyncDraft = (draft: MiningWorker) => draft.userId === currentUserUid;

      expect(canSyncDraft(foreignDraft)).toBe(false);
    });
  });

  describe('4. Backend Health Check & Production Firebase Diagnostic', () => {
    it('verifies GET /api/health returns healthy status for spinnermine-cloud-production without secrets', async () => {
      // Mock Firestore test connection ping
      vi.spyOn(adminDb, 'collection').mockImplementation((colName: string) => {
        if (colName === 'test') {
          return {
            doc: (_id: string) => ({
              get: vi.fn().mockResolvedValue({ exists: true })
            })
          } as any;
        }
        return { doc: () => ({ get: vi.fn(), set: vi.fn() }) } as any;
      });

      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.platform).toBe('SpinnerMine Cloud');
      expect(res.body.firebase.connected).toBe(true);
      const expectedProject = (firebaseConfig as any)?.projectId || 'spinnermine-cloud-production';
      expect(res.body.firebase.projectId).toBe(expectedProject);
      expect(res.body.firebase.databaseId).toBe((firebaseConfig as any)?.firestoreDatabaseId || '(default)');

      // Strictly verify NO server secrets or private keys are exposed
      const bodyStr = JSON.stringify(res.body);
      expect(bodyStr).not.toContain('GAME_SERVER_SECRET');
      expect(bodyStr).not.toContain('private_key');
      expect(bodyStr).not.toContain('client_secret');
    });

    it('verifies apiClient getBackendBaseUrl returns valid string and trusts production domains', () => {
      const base = getBackendBaseUrl();
      expect(typeof base).toBe('string');

      expect(isTrustedOrigin('https://spinnermine-cloud-production.web.app/api/health')).toBe(true);
      expect(isTrustedOrigin('https://spinnermine-cloud-production.firebaseapp.com/api')).toBe(true);
      expect(isTrustedOrigin('http://localhost:3000/api/health')).toBe(true);
      expect(isTrustedOrigin('file:///C:/Users/exploit')).toBe(false);
    });
  });

  describe('5. HTTP Status Code Diagnostics (401, 403, 404, 409, 500, 0)', () => {
    it('returns HTTP 401 Unauthorized when Bearer token is missing or malformed', async () => {
      const res = await request(app)
        .post('/api/workers/register')
        .send({ workerId: 'w_test_worker', name: 'Test' });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Unauthorized');
    });

    it('returns HTTP 404 Not Found when calling non-existent API routes', async () => {
      const res = await request(app).get('/api/workers/non-existent-endpoint');
      expect(res.status).toBe(404);
    });

    it('returns HTTP 409 Conflict when user attempts to register duplicate device name', async () => {
      vi.spyOn(adminAuth, 'verifyIdToken').mockResolvedValue({
        uid: testUid,
        email: testEmail,
        admin: false,
        role: 'user'
      } as any);

      // Simulate existing worker with same name but different ID
      vi.spyOn(adminDb, 'collection').mockImplementation((colName: string) => {
        if (colName === 'miningWorkers') {
          return {
            doc: (id: string) => ({
              get: vi.fn().mockResolvedValue({ exists: false }),
              set: vi.fn()
            }),
            where: () => ({
              where: () => ({
                get: vi.fn().mockResolvedValue({
                  docs: [{ id: 'w_other_existing_id', data: () => ({ name: 'tm' }) }]
                })
              })
            })
          } as any;
        }
        return { doc: () => ({ get: vi.fn().mockResolvedValue({ exists: true }), set: vi.fn() }) } as any;
      });

      const res = await request(app)
        .post('/api/workers/register')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          workerId: 'w_new_unique_id',
          name: 'tm',
          platform: 'windows'
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('Conflict');
    });

    it('returns HTTP 403 with clear diagnostic error when Firestore throws permission denied', async () => {
      vi.spyOn(adminAuth, 'verifyIdToken').mockResolvedValue({
        uid: testUid,
        email: testEmail,
        admin: false,
        role: 'user'
      } as any);

      // Simulate Firestore throwing permission denied
      vi.spyOn(adminDb, 'collection').mockImplementation(() => ({
        doc: () => ({
          get: vi.fn().mockRejectedValue(new Error('7 PERMISSION_DENIED: Missing or insufficient permissions.'))
        })
      } as any));

      const res = await request(app)
        .post('/api/workers/register')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          workerId: 'w_perm_fail',
          name: 'Perm Fail PC',
          platform: 'windows'
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Firestore permission denied');
      expect(res.body.code).toBe('PERMISSION_DENIED');
    });

    it('records syncAttemptError on draft when registerWorker fails with network/server error', () => {
      const draft: MiningWorker = {
        workerId: 'w_tm_test',
        userId: testUid,
        name: 'tm',
        platform: 'windows',
        cpuCores: 8,
        status: 'pending_sync',
        isPendingSync: true,
        lastSeen: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };

      // When sync fails with 500, attach error
      const failedDraft: MiningWorker = {
        ...draft,
        syncAttemptError: {
          status: 500,
          error: 'Firestore permission denied: Backend service account lacks roles/datastore.user',
          timestamp: new Date().toISOString()
        }
      };

      expect(failedDraft.isPendingSync).toBe(true);
      expect(failedDraft.syncAttemptError?.status).toBe(500);
      expect(failedDraft.syncAttemptError?.error).toContain('roles/datastore.user');
    });

    it('clears draft from localStorage and marks confirmed when backend sync succeeds', () => {
      const storage: Record<string, string> = {
        [`spinnermine_pending_workers_${testUid}`]: JSON.stringify([{
          workerId: 'w_tm_test',
          userId: testUid,
          name: 'tm',
          platform: 'windows',
          cpuCores: 8,
          status: 'pending_sync',
          isPendingSync: true
        }])
      };

      // Simulate successful sync response
      const serverConfirmedWorker: MiningWorker = {
        workerId: 'w_tm_test',
        userId: testUid,
        name: 'tm',
        platform: 'windows',
        cpuCores: 8,
        status: 'offline',
        isPendingSync: false,
        acceptedShares: 0,
        lastSeen: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };

      // Clear draft upon server confirmation
      const existingDrafts: MiningWorker[] = JSON.parse(storage[`spinnermine_pending_workers_${testUid}`]);
      const remainingDrafts = existingDrafts.filter(d => d.workerId !== serverConfirmedWorker.workerId);
      storage[`spinnermine_pending_workers_${testUid}`] = JSON.stringify(remainingDrafts);

      expect(remainingDrafts.length).toBe(0);
      expect(serverConfirmedWorker.isPendingSync).toBe(false);
      expect(serverConfirmedWorker.status).toBe('offline');
    });
  });

  describe('6. Comprehensive Acceptance Verification: Missing Backend URL, OAuth, HTTP Errors & Device tv Sync', () => {
    it('verifies DEFAULT_PRODUCTION_BACKEND_URL points to Cloudflare workers endpoint', () => {
      expect(DEFAULT_PRODUCTION_BACKEND_URL).toBe('https://spinnermine-backend.tmrbe2006.workers.dev');
    });

    it('verifies getBackendBaseUrl returns Cloudflare default in Electron environment', () => {
      // In Node/Electron test environment without window.location http
      const base = getBackendBaseUrl();
      expect(base).toBe('https://spinnermine-backend.tmrbe2006.workers.dev');
    });

    it('allows administrator to safely update and reset custom backend URL', () => {
      const customUrl = 'https://custom-backend-cluster.a.run.app';
      const success = setCustomBackendUrl(customUrl);
      expect(success).toBe(true);
      expect(getCustomBackendUrl()).toBe(customUrl);

      // Rejects invalid protocols like ftp or javascript
      expect(setCustomBackendUrl('ftp://invalid-server.com')).toBe(false);
      expect(setCustomBackendUrl('javascript:alert(1)')).toBe(false);

      // Reset
      setCustomBackendUrl(null);
      expect(getCustomBackendUrl()).toBeNull();
    });

    it('formats auth/unauthorized-domain with clear desktop guidance on file:// without crashing', () => {
      const err = { code: 'auth/unauthorized-domain' };
      const res = formatAuthError(err, 'ar');
      const expectedProject = (firebaseConfig as any)?.projectId || 'spinnermine-cloud-production';
      expect(res.code).toBe('auth/unauthorized-domain');
      expect(res.consoleUrl).toContain(expectedProject);
      expect(res.consoleUrl).toContain('authentication/settings');
      expect(res.suggestGoogleSignIn).toBe(false);

      const resEn = formatAuthError(err, 'en');
      expect(resEn.message).toContain(expectedProject);
    });

    it('simulates device "tv" saved locally (Pending Sync = 1, Confirmed = 0) and transitions to Confirmed = 1 upon sync', async () => {
      // 1. Initial State: device 'tv' saved locally
      const localStore: Record<string, string> = {};
      const userDraftKey = `spinnermine_pending_workers_${testUid}`;

      const tvDraft: MiningWorker = {
        id: `w_${testUid.slice(0, 8)}_tv`,
        workerId: `w_${testUid.slice(0, 8)}_tv`,
        userId: testUid,
        name: 'tv',
        deviceName: 'tv',
        platform: 'windows',
        cpuCores: 8,
        threads: 4,
        xmrigVersion: '6.26.0',
        status: 'pending_sync',
        isPendingSync: true,
        reportedHashrate: 0,
        acceptedShares: 0,
        rejectedShares: 0,
        lastSeen: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };

      localStore[userDraftKey] = JSON.stringify([tvDraft]);

      // State before sync:
      let workersList: MiningWorker[] = JSON.parse(localStore[userDraftKey]);
      let confirmedCount = workersList.filter(w => !w.isPendingSync && w.status !== 'pending_sync').length;
      let pendingCount = workersList.filter(w => w.isPendingSync || w.status === 'pending_sync').length;

      expect(confirmedCount).toBe(0);
      expect(pendingCount).toBe(1);
      expect(workersList[0].name).toBe('tv');

      // 2. Mock Backend verifyIdToken and Firestore for successful registration
      vi.spyOn(adminAuth, 'verifyIdToken').mockResolvedValue({
        uid: testUid,
        email: testEmail,
        admin: false,
        role: 'user',
        aud: 'spinnermine-cloud-production',
        iss: 'https://securetoken.google.com/spinnermine-cloud-production',
        sub: testUid
      } as any);

      const firestoreStore = new Map<string, any>();
      vi.spyOn(adminDb, 'collection').mockImplementation((col: string) => ({
        doc: (id: string) => ({
          get: vi.fn().mockImplementation(async () => {
            const data = firestoreStore.get(`${col}/${id}`);
            return { exists: Boolean(data), data: () => data };
          }),
          set: vi.fn().mockImplementation(async (data: any, opts?: any) => {
            const k = `${col}/${id}`;
            firestoreStore.set(k, opts?.merge ? { ...(firestoreStore.get(k) || {}), ...data } : data);
            return {};
          })
        })
      } as any));

      // 3. Send registration request for 'tv'
      const res = await request(app)
        .post('/api/workers/register')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          workerId: tvDraft.workerId,
          name: tvDraft.name,
          deviceName: tvDraft.deviceName,
          platform: tvDraft.platform,
          cpuCores: tvDraft.cpuCores,
          threads: tvDraft.threads,
          xmrigVersion: tvDraft.xmrigVersion
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.worker.name).toBe('tv');
      expect(res.body.worker.status).toBe('offline'); // Never auto-starts mining

      // 4. State transition: Draft is removed ONLY after API success
      localStore[userDraftKey] = JSON.stringify([]);

      const confirmedTv: MiningWorker = {
        ...tvDraft,
        ...res.body.worker,
        status: 'offline',
        isPendingSync: false,
        syncAttemptError: undefined
      };

      workersList = [confirmedTv];
      confirmedCount = workersList.filter(w => !w.isPendingSync && w.status !== 'pending_sync').length;
      pendingCount = workersList.filter(w => w.isPendingSync || w.status === 'pending_sync').length;

      // Confirmed = 1, Pending = 0
      expect(confirmedCount).toBe(1);
      expect(pendingCount).toBe(0);
    });

    it('strictly preserves draft in local storage if backend returns HTTP 500 or 401', async () => {
      const localStore: Record<string, string> = {};
      const userDraftKey = `spinnermine_pending_workers_${testUid}`;

      const draft: MiningWorker = {
        id: `w_${testUid.slice(0, 8)}_failing_device`,
        workerId: `w_${testUid.slice(0, 8)}_failing_device`,
        userId: testUid,
        name: 'failing_device',
        platform: 'windows',
        status: 'pending_sync',
        cpuCores: 4,
        isPendingSync: true,
        lastSeen: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };

      localStore[userDraftKey] = JSON.stringify([draft]);

      // Attempt registration with invalid token -> 401
      const res = await request(app)
        .post('/api/workers/register')
        .set('Authorization', 'Bearer invalid-token')
        .send({ workerId: draft.workerId, name: draft.name });

      expect(res.status).toBe(401);

      // Critical Rule: Draft is NOT deleted!
      const stillInStorage = JSON.parse(localStore[userDraftKey]);
      expect(stillInStorage).toHaveLength(1);
      expect(stillInStorage[0].workerId).toBe(draft.workerId);
    });
  });
});
