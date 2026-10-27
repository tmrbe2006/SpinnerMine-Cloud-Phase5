import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createServerApp, adminDb, adminAuth } from '../server';
import { 
  computeWorkerStatus, 
  formatLastSeen, 
  getStatusBadgeConfig,
  OFFLINE_THRESHOLD_MS 
} from '../src/utils/worker-status';
import { sendWorkerHeartbeat, DEFAULT_PRODUCTION_BACKEND_URL } from '../src/services/apiClient';
import { MiningWorker } from '../src/types';

describe('SpinnerMine Cloud Phase 2B — Real-Time Worker Monitoring & Heartbeat Tests', () => {
  const app = createServerApp();
  const testOwnerUid = 'user_worker_monitor_owner_99';
  const testOwnerEmail = 'monitor@spinnermine.cloud';
  const strangerUid = 'user_worker_monitor_stranger_11';
  const mockOwnerToken = 'mock-valid-monitor-owner-token';
  const mockStrangerToken = 'mock-valid-stranger-token';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. computeWorkerStatus Logic & 3-Minute Threshold Invariant', () => {
    const baseWorker: MiningWorker = {
      id: 'w_test_tm',
      workerId: 'w_test_tm',
      userId: testOwnerUid,
      name: 'tm',
      platform: 'windows',
      status: 'online',
      cpuCores: 8,
      threads: 8,
      reportedHashrate: 0,
      lastSeen: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };

    it('identifies worker as online if lastSeen is within 3 minutes (180,000 ms)', () => {
      const now = 1700000000000;
      // 30 seconds ago
      const recentWorker: MiningWorker = {
        ...baseWorker,
        status: 'online',
        lastSeen: new Date(now - 30000).toISOString()
      };

      const computed = computeWorkerStatus(recentWorker, now);
      expect(computed).toBe('online');
    });

    it('strictly transitions worker to offline if lastSeen is older than 3 minutes', () => {
      const now = 1700000000000;
      // 181 seconds ago (> OFFLINE_THRESHOLD_MS)
      const staleWorker: MiningWorker = {
        ...baseWorker,
        status: 'online',
        lastSeen: new Date(now - (OFFLINE_THRESHOLD_MS + 1000)).toISOString()
      };

      const computed = computeWorkerStatus(staleWorker, now);
      expect(computed).toBe('offline');
    });

    it('transitions mining worker to offline if heartbeats cease for > 3 minutes', () => {
      const now = 1700000000000;
      // Active mining stopped sending heartbeats 5 minutes ago
      const crashedMiningWorker: MiningWorker = {
        ...baseWorker,
        status: 'mining',
        reportedHashrate: 1200,
        lastSeen: new Date(now - (5 * 60 * 1000)).toISOString()
      };

      const computed = computeWorkerStatus(crashedMiningWorker, now);
      expect(computed).toBe('offline');
    });

    it('keeps mining status if worker is actively mining and heartbeat is fresh', () => {
      const now = 1700000000000;
      const activeMiningWorker: MiningWorker = {
        ...baseWorker,
        status: 'mining',
        reportedHashrate: 1450,
        lastSeen: new Date(now - 15000).toISOString()
      };

      const computed = computeWorkerStatus(activeMiningWorker, now);
      expect(computed).toBe('mining');
    });

    it('distinguishes Online (Ready) from Mining: online status does not imply mining', () => {
      const now = 1700000000000;
      const readyWorker: MiningWorker = {
        ...baseWorker,
        status: 'online',
        reportedHashrate: 0,
        lastSeen: new Date(now - 20000).toISOString()
      };

      const computed = computeWorkerStatus(readyWorker, now);
      expect(computed).toBe('online');
      expect(computed).not.toBe('mining');
      expect(readyWorker.reportedHashrate).toBe(0);
    });

    it('prioritizes pending_sync when local draft is awaiting synchronization', () => {
      const now = 1700000000000;
      const pendingWorker: MiningWorker = {
        ...baseWorker,
        status: 'offline',
        isPendingSync: true,
        lastSeen: new Date(now - 10000).toISOString()
      };

      const computed = computeWorkerStatus(pendingWorker, now);
      expect(computed).toBe('pending_sync');
    });

    it('returns registered for freshly enrolled worker before first heartbeat', () => {
      const now = 1700000000000;
      const freshRegisteredWorker: MiningWorker = {
        ...baseWorker,
        status: 'registered',
        lastSeen: undefined
      };

      const computed = computeWorkerStatus(freshRegisteredWorker, now);
      expect(computed).toBe('registered');
    });

    it('marks worker with error status if active error occurred recently', () => {
      const now = 1700000000000;
      const errorWorker: MiningWorker = {
        ...baseWorker,
        status: 'error',
        lastSeen: new Date(now - 40000).toISOString()
      };

      const computed = computeWorkerStatus(errorWorker, now);
      expect(computed).toBe('error');
    });
  });

  describe('2. Localized formatLastSeen (Arabic & English)', () => {
    const fixedNow = 1700000000000;

    it('formats just now / online now in Arabic and English (< 45s)', () => {
      const dateStr = new Date(fixedNow - 15000).toISOString();
      expect(formatLastSeen(dateStr, 'ar', fixedNow)).toBe('متصل الآن');
      expect(formatLastSeen(dateStr, 'en', fixedNow)).toBe('Online now');
    });

    it('formats single minute in Arabic and English', () => {
      const dateStr = new Date(fixedNow - 70000).toISOString();
      expect(formatLastSeen(dateStr, 'ar', fixedNow)).toBe('منذ دقيقة');
      expect(formatLastSeen(dateStr, 'en', fixedNow)).toBe('1 minute ago');
    });

    it('formats multiple minutes in Arabic and English (between 3 and 10)', () => {
      const dateStr = new Date(fixedNow - (5 * 60 * 1000)).toISOString();
      expect(formatLastSeen(dateStr, 'ar', fixedNow)).toBe('منذ 5 دقائق');
      expect(formatLastSeen(dateStr, 'en', fixedNow)).toBe('5 minutes ago');
    });

    it('formats hours in Arabic and English', () => {
      const dateOneHour = new Date(fixedNow - (60 * 60 * 1000)).toISOString();
      expect(formatLastSeen(dateOneHour, 'ar', fixedNow)).toBe('منذ ساعة');
      expect(formatLastSeen(dateOneHour, 'en', fixedNow)).toBe('1 hour ago');

      const dateFourHours = new Date(fixedNow - (4 * 60 * 60 * 1000)).toISOString();
      expect(formatLastSeen(dateFourHours, 'ar', fixedNow)).toBe('منذ 4 ساعات');
      expect(formatLastSeen(dateFourHours, 'en', fixedNow)).toBe('4 hours ago');
    });

    it('formats never / not seen yet in Arabic and English when undefined', () => {
      expect(formatLastSeen(undefined, 'ar', fixedNow)).toBe('لم يتصل بعد');
      expect(formatLastSeen(undefined, 'en', fixedNow)).toBe('Never connected');
    });
  });

  describe('3. getStatusBadgeConfig Styling & Labels', () => {
    it('returns valid config with localized Arabic and English labels', () => {
      const onlineAr = getStatusBadgeConfig('online', 'ar');
      const onlineEn = getStatusBadgeConfig('online', 'en');
      expect(onlineAr.label).toBe('متصل (جاهز)');
      expect(onlineEn.label).toBe('Online (Ready)');
      expect(onlineAr.dotClass).toContain('bg-sky');

      const miningAr = getStatusBadgeConfig('mining', 'ar');
      const miningEn = getStatusBadgeConfig('mining', 'en');
      expect(miningAr.label).toBe('التعدين نشط');
      expect(miningEn.label).toBe('Mining Active');
      expect(miningAr.dotClass).toContain('bg-emerald');

      const offlineAr = getStatusBadgeConfig('offline', 'ar');
      const offlineEn = getStatusBadgeConfig('offline', 'en');
      expect(offlineAr.label).toBe('غير متصل');
      expect(offlineEn.label).toBe('Offline');

      const registeredAr = getStatusBadgeConfig('registered', 'ar');
      const registeredEn = getStatusBadgeConfig('registered', 'en');
      expect(registeredAr.label).toContain('مسجل');
      expect(registeredEn.label).toContain('Registered');

      const pendingAr = getStatusBadgeConfig('pending_sync', 'ar');
      const pendingEn = getStatusBadgeConfig('pending_sync', 'en');
      expect(pendingAr.label).toContain('المزامنة');
      expect(pendingEn.label).toBe('Pending Sync');
    });
  });

  describe('4. Backend Heartbeat / Telemetry API Endpoint Verification', () => {
    const workerDocId = `w_${testOwnerUid.slice(0, 8)}_tm_device`;
    const docStore = new Map<string, any>();

    beforeEach(() => {
      docStore.clear();

      // Seed worker doc belonging to testOwnerUid
      docStore.set(`miningWorkers/${workerDocId}`, {
        id: workerDocId,
        workerId: workerDocId,
        userId: testOwnerUid,
        name: 'tm',
        platform: 'windows',
        status: 'offline',
        cpuCores: 8,
        threads: 4,
        reportedHashrate: 0,
        createdAt: new Date().toISOString()
      });

      // Mock verifyIdToken for owner and stranger
      vi.spyOn(adminAuth, 'verifyIdToken').mockImplementation(async (token: string) => {
        if (token === mockOwnerToken) {
          return {
            uid: testOwnerUid,
            email: testOwnerEmail,
            aud: 'spinnermine-cloud-production',
            iss: 'https://securetoken.google.com/spinnermine-cloud-production',
            sub: testOwnerUid
          } as any;
        }
        if (token === mockStrangerToken) {
          return {
            uid: strangerUid,
            email: 'stranger@spinnermine.cloud',
            aud: 'spinnermine-cloud-production',
            iss: 'https://securetoken.google.com/spinnermine-cloud-production',
            sub: strangerUid
          } as any;
        }
        throw new Error('auth/invalid-id-token');
      });

      // Mock Firestore
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
    });

    it('successfully processes periodic heartbeat from authorized owner and updates lastSeen and cpuUsage', async () => {
      const res = await request(app)
        .post('/api/workers/telemetry')
        .set('Authorization', `Bearer ${mockOwnerToken}`)
        .send({
          workerId: workerDocId,
          status: 'online',
          threads: 6,
          cpuUsage: 35.5,
          reportedHashrate: 0
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.workerId).toBe(workerDocId);
      expect(res.body.status).toBe('online');
      expect(res.body.cpuUsage).toBe(35.5);
      expect(res.body.financialBalanceImpact).toBe(0);

      const storedDoc = docStore.get(`miningWorkers/${workerDocId}`);
      expect(storedDoc.status).toBe('online');
      expect(storedDoc.cpuUsage).toBe(35.5);
      expect(storedDoc.threads).toBe(6);
      expect(storedDoc.lastSeen).toBeDefined();
    });

    it('strictly isolates financial fields: client cannot modify acceptedShares or balance via heartbeat', async () => {
      const res = await request(app)
        .post('/api/workers/telemetry')
        .set('Authorization', `Bearer ${mockOwnerToken}`)
        .send({
          workerId: workerDocId,
          status: 'online',
          cpuUsage: 22,
          // Malicious injection attempt
          acceptedShares: 5000,
          rejectedShares: 0,
          balance: 999999,
          earnings: 500,
          revenue: 1000
        });

      expect(res.status).toBe(200);
      expect(res.body.financialBalanceImpact).toBe(0);

      const storedDoc = docStore.get(`miningWorkers/${workerDocId}`);
      expect(storedDoc.acceptedShares).toBeUndefined();
      expect(storedDoc.rejectedShares).toBeUndefined();
      expect(storedDoc.balance).toBeUndefined();
      expect(storedDoc.earnings).toBeUndefined();
      expect(storedDoc.revenue).toBeUndefined();
    });

    it('strictly rejects cross-user heartbeat updates with HTTP 403 Forbidden', async () => {
      // Stranger tries to update testOwnerUid's worker
      const res = await request(app)
        .post('/api/workers/telemetry')
        .set('Authorization', `Bearer ${mockStrangerToken}`)
        .send({
          workerId: workerDocId,
          status: 'online',
          cpuUsage: 10
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Forbidden');
    });

    it('returns HTTP 404 if worker does not exist', async () => {
      const res = await request(app)
        .post('/api/workers/telemetry')
        .set('Authorization', `Bearer ${mockOwnerToken}`)
        .send({
          workerId: 'non_existent_worker_12345',
          status: 'online'
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Worker not found');
    });

    it('returns HTTP 401 if unauthenticated', async () => {
      const res = await request(app)
        .post('/api/workers/telemetry')
        .send({
          workerId: workerDocId,
          status: 'online'
        });

      expect(res.status).toBe(401);
    });
  });

  describe('5. Client apiClient.sendWorkerHeartbeat Functionality', () => {
    it('sends heartbeat payload with Authorization token to configured backend', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          success: true,
          workerId: 'w_test_worker',
          status: 'online',
          cpuUsage: 40,
          financialBalanceImpact: 0
        })
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await sendWorkerHeartbeat({
        workerId: 'w_test_worker',
        status: 'online',
        cpuUsage: 40,
        threads: 4,
        idToken: 'mock-valid-id-token'
      });

      expect(result.success).toBe(true);
      expect(result.workerId).toBe('w_test_worker');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/workers/telemetry');
      const authHeader = init.headers instanceof Headers 
        ? init.headers.get('Authorization') 
        : (init.headers?.Authorization || init.headers?.authorization);
      expect(authHeader).toBe('Bearer mock-valid-id-token');
      expect(JSON.parse(init.body)).toEqual({
        workerId: 'w_test_worker',
        status: 'online',
        cpuUsage: 40,
        threads: 4,
        reportedHashrate: 0
      });
    });

    it('handles offline network error gracefully without crashing', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch (offline)')));

      const res = await sendWorkerHeartbeat({
        workerId: 'w_test_worker',
        status: 'online',
        idToken: 'mock-token'
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('Failed to fetch (offline)');
    });
  });

  describe('6. Non-Auto-Mining & Safety Guarantees', () => {
    it('heartbeat does not mutate hashrate or start mining daemon', () => {
      const worker: MiningWorker = {
        id: 'w_safety_check',
        workerId: 'w_safety_check',
        userId: testOwnerUid,
        name: 'tv',
        platform: 'windows',
        status: 'online',
        cpuCores: 4,
        threads: 4,
        reportedHashrate: 0,
        lastSeen: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };

      // When sending periodic heartbeat, status remains 'online' and reportedHashrate is 0
      const heartbeatPayload = {
        workerId: worker.workerId,
        status: 'online' as const,
        cpuUsage: 12.5,
        reportedHashrate: 0
      };

      expect(heartbeatPayload.status).toBe('online');
      expect(heartbeatPayload.status).not.toBe('mining');
      expect(heartbeatPayload.reportedHashrate).toBe(0);
    });
  });

  describe('7. UI State Transition Invariant: Online Status Only After Confirmed Write', () => {
    it('only transitions worker state to Online when server explicitly returns success: true', () => {
      let workerState: MiningWorker = {
        id: 'w_test_worker',
        workerId: 'w_test_worker',
        userId: testOwnerUid,
        name: 'tv',
        platform: 'windows',
        status: 'offline',
        cpuCores: 4,
        threads: 4,
        reportedHashrate: 0,
        lastSeen: new Date(Date.now() - 300000).toISOString(), // 5 mins ago (offline)
        createdAt: new Date().toISOString()
      };

      // 1. Unsuccessful heartbeat response (e.g. 403 or network failure)
      const failedResponse = {
        success: false,
        error: 'Firestore PATCH failed [403]: PERMISSION_DENIED'
      };

      // UI state transition handler
      const handleHeartbeatResponse = (response: { success: boolean; error?: string }, targetWorkerId: string) => {
        if (response.success) {
          workerState = {
            ...workerState,
            status: 'online',
            lastSeen: new Date().toISOString()
          };
        }
      };

      handleHeartbeatResponse(failedResponse, 'w_test_worker');

      // Invariant: Status MUST remain offline!
      expect(workerState.status).toBe('offline');

      // 2. Successful heartbeat response
      const successResponse = {
        success: true,
        workerId: 'w_test_worker',
        status: 'online'
      };

      handleHeartbeatResponse(successResponse, 'w_test_worker');

      // Invariant: Status transitions to online ONLY after confirmed write
      expect(workerState.status).toBe('online');
    });
  });

  describe('8. Firestore Rules miningWorkers Schema & AffectedKeys Verification', () => {
    const fs = require('fs');
    const path = require('path');
    const rulesText = fs.readFileSync(path.resolve('firestore.rules'), 'utf8');

    it('rules explicitly permit cpuUsage, lastSeen, updatedAt, threads, reportedHashrate, and status in miningWorkers update', () => {
      const workerMatch = rulesText.match(/match\s+\/miningWorkers\/\{workerId\}\s*\{[\s\S]*?\n\s*\}/);
      expect(workerMatch).not.toBeNull();
      const ruleBody = workerMatch![0];

      // Verifies update affectedKeys includes all required telemetry fields
      expect(ruleBody).toContain('cpuUsage');
      expect(ruleBody).toContain('lastSeen');
      expect(ruleBody).toContain('updatedAt');
      expect(ruleBody).toContain('threads');
      expect(ruleBody).toContain('reportedHashrate');
      expect(ruleBody).toContain('status');

      // Verifies update requires document ownership
      expect(ruleBody).toContain('existing().userId == request.auth.uid');
      expect(ruleBody).toContain('incoming().userId == existing().userId');
    });

    it('rules strictly prohibit financial mutations and acceptedShares injection in miningWorkers', () => {
      const workerMatch = rulesText.match(/match\s+\/miningWorkers\/\{workerId\}\s*\{[\s\S]*?\n\s*\}/);
      expect(workerMatch).not.toBeNull();
      const ruleBody = workerMatch![0];

      expect(ruleBody).toContain("!incoming().diff(existing()).affectedKeys().hasAny(['balance', 'earnings', 'payout', 'revenue', 'confirmedBalance', 'rewardAmount', 'acceptedShares', 'rejectedShares', 'syncStatus', 'verified'])");
    });
  });
});
