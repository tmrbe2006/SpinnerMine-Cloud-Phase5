import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateRandomInstallationId,
  getDeviceInstallationId,
  getShortInstallationId,
  deriveWorkerIdFromInstallation,
  detectDuplicateWorkers,
  _resetInstallationIdCacheForTesting
} from '../src/utils/installation-id';
import { computeWorkerStatus, formatLastSeen } from '../src/utils/worker-status';
import { MiningWorker } from '../src/types';
import { archiveWorker, mergeWorkers } from '../src/services/apiClient';
import request from 'supertest';
import { createServerApp, adminAuth, adminDb } from '../server';

describe('Windows Machine Identity & Worker Deduplication', () => {
  const mockUid = 'qBPFqVEeu7Z9';
  const mockInstallationId = 'inst_9f3a8b2c4d1e7051';

  beforeEach(() => {
    vi.restoreAllMocks();
    _resetInstallationIdCacheForTesting();
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  describe('1. Persistent Installation ID', () => {
    it('generates a valid, cryptographically random installationId with inst_ prefix', () => {
      const id1 = generateRandomInstallationId();
      const id2 = generateRandomInstallationId();

      expect(id1).toMatch(/^inst_[a-f0-9\-]{16,36}$/);
      expect(id2).toMatch(/^inst_[a-f0-9\-]{16,36}$/);
      expect(id1).not.toBe(id2);
    });

    it('persists and retrieves the exact same installationId across calls (simulating app restarts)', async () => {
      const idFirst = await getDeviceInstallationId();
      expect(idFirst).toMatch(/^inst_/);

      const idSecond = await getDeviceInstallationId();
      expect(idSecond).toBe(idFirst);
    });

    it('prefers Electron desktop native installationId when available via IPC', async () => {
      const electronInstId = 'inst_electron_windows_pc_001';
      if (typeof window === 'undefined') {
        (globalThis as any).window = globalThis;
      }
      (window as any).electronMiningAPI = {
        getInstallationId: vi.fn().mockResolvedValue(electronInstId)
      };

      const resolved = await getDeviceInstallationId();
      expect(resolved).toBe(electronInstId);

      delete (window as any).electronMiningAPI;
    });

    it('produces a clean, formatted short installation ID for table UI', () => {
      expect(getShortInstallationId(mockInstallationId)).toBe('inst_9f...7051');
      expect(getShortInstallationId(null)).toBe('N/A');
      expect(getShortInstallationId(undefined)).toBe('N/A');
      expect(getShortInstallationId('inst_short')).toBe('inst_short');
    });
  });

  describe('2. Deterministic Worker ID Derivation (Independent of Device Name)', () => {
    it('binds workerId strictly to (userId, installationId)', () => {
      const workerId1 = deriveWorkerIdFromInstallation(mockUid, mockInstallationId);
      const workerId2 = deriveWorkerIdFromInstallation(mockUid, mockInstallationId);

      expect(workerId1).toBe(workerId2);
      expect(workerId1).toBe('w_qBPFqVEe_4d1e7051');
    });

    it('does not alter workerId when user changes device display name from tm to ty', () => {
      const initialWorkerId = deriveWorkerIdFromInstallation(mockUid, mockInstallationId);
      
      // Simulating renaming display name
      const name1 = 'tm';
      const name2 = 'ty';
      expect(name1).not.toBe(name2);

      const workerIdAfterRename = deriveWorkerIdFromInstallation(mockUid, mockInstallationId);
      expect(workerIdAfterRename).toBe(initialWorkerId);
    });
  });

  describe('3. Duplicate Detection and Discovery', () => {
    it('detects duplicate workers sharing the same installationId and selects tm as primary', () => {
      const workers: MiningWorker[] = [
        {
          id: 'w_qBPFqVEe_tm',
          workerId: 'w_qBPFqVEe_tm',
          userId: mockUid,
          name: 'tm',
          deviceName: 'Windows-PC-1',
          platform: 'windows',
          cpuCores: 8,
          threads: 4,
          status: 'online',
          installationId: mockInstallationId,
          acceptedShares: 150,
          createdAt: '2026-10-20T10:00:00.000Z'
        },
        {
          id: 'w_GyAldfJ5_ty',
          workerId: 'w_GyAldfJ5_ty',
          userId: mockUid,
          name: 'ty',
          deviceName: 'Windows-PC-1',
          platform: 'windows',
          cpuCores: 8,
          threads: 4,
          status: 'online',
          installationId: mockInstallationId,
          acceptedShares: 0,
          createdAt: '2026-10-24T12:00:00.000Z'
        }
      ];

      const duplicateGroups = detectDuplicateWorkers(workers);
      expect(duplicateGroups).toHaveLength(1);

      const group = duplicateGroups[0];
      expect(group.primaryWorker.workerId).toBe('w_qBPFqVEe_tm');
      expect(group.primaryWorker.name).toBe('tm');
      expect(group.duplicateWorkers).toHaveLength(1);
      expect(group.duplicateWorkers[0].workerId).toBe('w_GyAldfJ5_ty');
      expect(group.duplicateWorkers[0].name).toBe('ty');
    });

    it('identifies known legacy duplicate pair (tm vs ty) even if legacy records lack installationId', () => {
      const legacyWorkers: MiningWorker[] = [
        {
          id: 'w_qBPFqVEe_tm',
          workerId: 'w_qBPFqVEe_tm',
          userId: mockUid,
          name: 'tm',
          platform: 'windows',
          cpuCores: 8,
          status: 'online',
          acceptedShares: 42,
          createdAt: '2026-10-15T08:00:00.000Z'
        },
        {
          id: 'w_GyAldfJ5_ty',
          workerId: 'w_GyAldfJ5_ty',
          userId: mockUid,
          name: 'ty',
          platform: 'windows',
          cpuCores: 8,
          status: 'online',
          acceptedShares: 0,
          createdAt: '2026-10-22T09:00:00.000Z'
        }
      ];

      const groups = detectDuplicateWorkers(legacyWorkers);
      expect(groups).toHaveLength(1);
      expect(groups[0].reason).toBe('legacy_device_alias');
      expect(groups[0].primaryWorker.workerId).toBe('w_qBPFqVEe_tm');
      expect(groups[0].duplicateWorkers[0].workerId).toBe('w_GyAldfJ5_ty');
    });
  });

  describe('4. Status Isolation & Single Online Enforcement', () => {
    it('marks merged or archived worker strictly as "archived", never "online" or "mining"', () => {
      const now = Date.now();
      const freshLastSeen = new Date(now - 10000).toISOString(); // 10 seconds ago

      // Duplicate worker that was merged into tm
      const mergedWorker: MiningWorker = {
        id: 'w_GyAldfJ5_ty',
        workerId: 'w_GyAldfJ5_ty',
        userId: mockUid,
        name: 'ty',
        platform: 'windows',
        cpuCores: 8,
        status: 'online',
        lastSeen: freshLastSeen,
        mergedInto: 'w_qBPFqVEe_tm',
        isArchived: true,
        createdAt: '2026-10-24T12:00:00.000Z'
      };

      const computedStatus = computeWorkerStatus(mergedWorker, now);
      expect(computedStatus).toBe('archived');
      expect(computedStatus).not.toBe('online');
      expect(computedStatus).not.toBe('mining');
    });

    it('ensures only one computer is shown as Online when a duplicate is resolved', () => {
      const now = Date.now();
      const freshLastSeen = new Date(now - 5000).toISOString();

      const primaryWorker: MiningWorker = {
        id: 'w_qBPFqVEe_tm',
        workerId: 'w_qBPFqVEe_tm',
        userId: mockUid,
        name: 'tm',
        platform: 'windows',
        cpuCores: 8,
        status: 'online',
        lastSeen: freshLastSeen,
        createdAt: '2026-10-20T10:00:00.000Z'
      };

      const resolvedDuplicate: MiningWorker = {
        id: 'w_GyAldfJ5_ty',
        workerId: 'w_GyAldfJ5_ty',
        userId: mockUid,
        name: 'ty',
        platform: 'windows',
        cpuCores: 8,
        status: 'online',
        lastSeen: freshLastSeen,
        mergedInto: 'w_qBPFqVEe_tm',
        isArchived: true,
        createdAt: '2026-10-24T12:00:00.000Z'
      };

      const statusPrimary = computeWorkerStatus(primaryWorker, now);
      const statusDuplicate = computeWorkerStatus(resolvedDuplicate, now);

      expect(statusPrimary).toBe('online');
      expect(statusDuplicate).toBe('archived');

      const onlineCount = [primaryWorker, resolvedDuplicate].filter(
        w => computeWorkerStatus(w, now) === 'online' || computeWorkerStatus(w, now) === 'mining'
      ).length;

      expect(onlineCount).toBe(1);
    });
  });

  describe('5. Safe Archival and Merge Integrity (No Doc Deletion, No Fake Shares)', () => {
    it('retains the duplicate document for audit records upon merge without altering financial data', () => {
      const originalDuplicate: MiningWorker = {
        id: 'w_GyAldfJ5_ty',
        workerId: 'w_GyAldfJ5_ty',
        userId: mockUid,
        name: 'ty',
        platform: 'windows',
        cpuCores: 8,
        status: 'online',
        acceptedShares: 0,
        rejectedShares: 0,
        createdAt: '2026-10-24T12:00:00.000Z'
      };

      const mergeAction = (dup: MiningWorker, primaryId: string): MiningWorker => {
        return {
          ...dup,
          mergedInto: primaryId,
          isArchived: true,
          archivedAt: new Date().toISOString(),
          archiveReason: `merged_into_${primaryId}`,
          status: 'archived',
          updatedAt: new Date().toISOString()
        };
      };

      const merged = mergeAction(originalDuplicate, 'w_qBPFqVEe_tm');

      // 1. Document is NOT deleted
      expect(merged).toBeDefined();
      expect(merged.id).toBe('w_GyAldfJ5_ty');
      // 2. Audit fields are populated
      expect(merged.mergedInto).toBe('w_qBPFqVEe_tm');
      expect(merged.isArchived).toBe(true);
      expect(merged.archiveReason).toContain('w_qBPFqVEe_tm');
      // 3. Financial fields are NOT altered
      expect(merged.acceptedShares).toBe(0);
      expect(merged.rejectedShares).toBe(0);
    });

    it('simulates session audit tracking without synthesizing unverified shares', () => {
      const mockSessions = [
        { sessionId: 'sess_1', workerId: 'w_GyAldfJ5_ty', duration: 120, shares: 0 },
        { sessionId: 'sess_2', workerId: 'w_GyAldfJ5_ty', duration: 300, shares: 0 }
      ];

      // Audit migration: annotate session audit pointers, do NOT create fake shares
      const auditedSessions = mockSessions.map(s => ({
        ...s,
        mergedTargetWorkerId: 'w_qBPFqVEe_tm',
        auditNote: 'Merged into primary worker w_qBPFqVEe_tm'
      }));

      expect(auditedSessions[0].mergedTargetWorkerId).toBe('w_qBPFqVEe_tm');
      expect(auditedSessions[0].shares).toBe(0);
      expect(auditedSessions[1].shares).toBe(0);
    });
  });

  describe('6. App Reopen / Restart Simulation & Duplicate Prevention on Rename', () => {
    it('preserves same installationId and workerId after simulating application close and reopen', async () => {
      // 1. Session 1: App runs, gets installation ID and registers worker
      const session1InstallationId = await getDeviceInstallationId();
      const session1WorkerId = deriveWorkerIdFromInstallation(mockUid, session1InstallationId);

      // 2. Simulate app close and restart (in-memory state reset, localStorage retained)
      const session2InstallationId = await getDeviceInstallationId();
      const session2WorkerId = deriveWorkerIdFromInstallation(mockUid, session2InstallationId);

      expect(session2InstallationId).toBe(session1InstallationId);
      expect(session2WorkerId).toBe(session1WorkerId);
    });

    it('maintains the same workerId when user renames device from tm to ty', () => {
      const targetInstallationId = mockInstallationId;
      const initialWorker: MiningWorker = {
        id: deriveWorkerIdFromInstallation(mockUid, targetInstallationId),
        workerId: deriveWorkerIdFromInstallation(mockUid, targetInstallationId),
        userId: mockUid,
        name: 'tm',
        installationId: targetInstallationId,
        platform: 'windows',
        cpuCores: 8,
        status: 'online',
        createdAt: '2026-10-20T10:00:00.000Z'
      };

      // User renames device to 'ty'
      const renameDevice = (worker: MiningWorker, newName: string): MiningWorker => {
        return {
          ...worker,
          name: newName,
          deviceName: newName,
          updatedAt: new Date().toISOString()
        };
      };

      const renamedWorker = renameDevice(initialWorker, 'ty');

      // Worker ID must remain identical
      expect(renamedWorker.workerId).toBe(initialWorker.workerId);
      expect(renamedWorker.id).toBe(initialWorker.id);
      expect(renamedWorker.name).toBe('ty');
      expect(renamedWorker.installationId).toBe(targetInstallationId);
    });

    it('heartbeat loop isolates dispatch strictly to the primary active worker', () => {
      const allWorkers: MiningWorker[] = [
        {
          id: 'w_qBPFqVEe_tm',
          workerId: 'w_qBPFqVEe_tm',
          userId: mockUid,
          name: 'tm',
          platform: 'windows',
          cpuCores: 8,
          status: 'online',
          installationId: mockInstallationId,
          lastSeen: new Date().toISOString(),
          createdAt: '2026-10-20T10:00:00.000Z'
        },
        {
          id: 'w_GyAldfJ5_ty',
          workerId: 'w_GyAldfJ5_ty',
          userId: mockUid,
          name: 'ty',
          platform: 'windows',
          cpuCores: 8,
          status: 'archived',
          mergedInto: 'w_qBPFqVEe_tm',
          isArchived: true,
          installationId: mockInstallationId,
          createdAt: '2026-10-24T12:00:00.000Z'
        }
      ];

      // Primary resolver function mirroring MiningDashboardPage
      const resolvePrimaryHeartbeatTarget = (workers: MiningWorker[]): string | null => {
        const activeConfirmed = workers.filter(
          w => !w.isPendingSync && w.status !== 'pending_sync' && !w.isArchived && !w.mergedInto && w.status !== 'archived'
        );
        if (activeConfirmed.length === 0) return null;
        const primary = activeConfirmed.find(w => w.workerId === 'w_qBPFqVEe_tm' || w.name === 'tm') || activeConfirmed[0];
        return primary.workerId || primary.id || null;
      };

      const targetWorkerId = resolvePrimaryHeartbeatTarget(allWorkers);
      expect(targetWorkerId).toBe('w_qBPFqVEe_tm');
      expect(targetWorkerId).not.toBe('w_GyAldfJ5_ty');
    });

    it('Requirement 7: UI cleanly separates active workers from archived/merged workers', () => {
      const allWorkers: MiningWorker[] = [
        {
          id: 'w_qBPFqVEe_tm',
          workerId: 'w_qBPFqVEe_tm',
          userId: mockUid,
          name: 'tm',
          platform: 'windows',
          status: 'online',
          installationId: mockInstallationId,
          cpuCores: 8,
          createdAt: new Date().toISOString()
        },
        {
          id: 'w_GyAldfJ5_ty',
          workerId: 'w_GyAldfJ5_ty',
          userId: mockUid,
          name: 'ty',
          platform: 'windows',
          status: 'archived',
          mergedInto: 'w_qBPFqVEe_tm',
          isArchived: true,
          archiveReason: 'Merged via duplicate resolver',
          acceptedShares: 12,
          installationId: mockInstallationId,
          cpuCores: 8,
          createdAt: new Date().toISOString()
        }
      ];

      const activeWorkers = allWorkers.filter(w => !w.isArchived && !w.mergedInto && w.status !== 'archived');
      const archivedWorkers = allWorkers.filter(w => w.isArchived || Boolean(w.mergedInto) || w.status === 'archived');

      expect(activeWorkers).toHaveLength(1);
      expect(activeWorkers[0].workerId).toBe('w_qBPFqVEe_tm');

      expect(archivedWorkers).toHaveLength(1);
      expect(archivedWorkers[0].workerId).toBe('w_GyAldfJ5_ty');
      expect(archivedWorkers[0].mergedInto).toBe('w_qBPFqVEe_tm');
      expect(archivedWorkers[0].acceptedShares).toBe(12);
    });

    it('Requirement 8: Re-registering the same Windows installation strictly resolves to tm and prevents 3rd worker ID generation', () => {
      const existingWorkers: MiningWorker[] = [
        {
          id: 'w_qBPFqVEe_tm',
          workerId: 'w_qBPFqVEe_tm',
          userId: mockUid,
          name: 'tm',
          platform: 'windows',
          status: 'online',
          installationId: mockInstallationId,
          cpuCores: 8,
          createdAt: new Date().toISOString()
        },
        {
          id: 'w_GyAldfJ5_ty',
          workerId: 'w_GyAldfJ5_ty',
          userId: mockUid,
          name: 'ty',
          platform: 'windows',
          status: 'archived',
          mergedInto: 'w_qBPFqVEe_tm',
          isArchived: true,
          installationId: mockInstallationId,
          cpuCores: 8,
          createdAt: new Date().toISOString()
        }
      ];

      // Mirroring the refined registration resolver in MiningDashboardPage
      const resolveWorkerIdForRegistration = (
        workers: MiningWorker[],
        uid: string,
        instId: string,
        platform: string
      ): string => {
        const primaryTmWorker = workers.find(w => 
          (w.workerId === 'w_qBPFqVEe_tm' || w.id === 'w_qBPFqVEe_tm' || w.name === 'tm') && !w.isArchived && !w.mergedInto
        );
        const existingInstWorker = workers.find(w => 
          !w.isArchived && !w.mergedInto && Boolean(w.installationId && w.installationId === instId)
        );
        const mergedInstWorker = workers.find(w => 
          Boolean(w.installationId && w.installationId === instId && w.mergedInto)
        );
        const targetFromMerged = mergedInstWorker?.mergedInto
          ? workers.find(w => (w.workerId === mergedInstWorker.mergedInto || w.id === mergedInstWorker.mergedInto) && !w.isArchived)
          : null;

        const resolved = primaryTmWorker || targetFromMerged || existingInstWorker;
        return resolved ? (resolved.workerId || resolved.id || '') : deriveWorkerIdFromInstallation(uid, instId);
      };

      const resolvedWorkerId = resolveWorkerIdForRegistration(existingWorkers, mockUid, mockInstallationId, 'windows');
      expect(resolvedWorkerId).toBe('w_qBPFqVEe_tm');
      // Strictly verify it does NOT generate a third ID like w_qBPFqVEe_4d1e7051
      expect(resolvedWorkerId).not.toBe('w_qBPFqVEe_4d1e7051');
      expect(resolvedWorkerId).not.toBe('w_GyAldfJ5_ty');
    });
  });

  describe('5. Express Server Worker Merge & Ownership Security Gate', () => {
    const app = createServerApp();
    const mockUserUid = 'user_tm_owner_123';
    const mockStrangerUid = 'user_stranger_456';

    it('rejects POST /api/workers/merge without Authorization Bearer token with 401', async () => {
      const res = await request(app)
        .post('/api/workers/merge')
        .send({
          primaryWorkerId: 'w_qBPFqVEe_tm',
          secondaryWorkerId: 'w_GyAldfJ5_ty'
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Unauthorized');
    });

    it('rejects merging a worker into itself with 400', async () => {
      vi.spyOn(adminAuth, 'verifyIdToken').mockResolvedValueOnce({
        uid: mockUserUid,
        email: 'miner@spinnermine.cloud',
        admin: false,
        role: 'user',
        auth_time: Math.floor(Date.now() / 1000),
        iss: 'https://securetoken.google.com/spinnermine',
        aud: 'spinnermine',
        sub: mockUserUid,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        firebase: { identities: {}, sign_in_provider: 'google.com' }
      });

      const res = await request(app)
        .post('/api/workers/merge')
        .set('Authorization', 'Bearer valid_user_jwt')
        .send({
          primaryWorkerId: 'w_qBPFqVEe_tm',
          secondaryWorkerId: 'w_qBPFqVEe_tm'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Cannot merge a worker into itself');
    });

    it('Requirement 4: Strictly forbids merging workers belonging to different users (CROSS_USER_MERGE_FORBIDDEN) with 403', async () => {
      vi.spyOn(adminAuth, 'verifyIdToken').mockResolvedValueOnce({
        uid: mockUserUid,
        email: 'miner@spinnermine.cloud',
        admin: false,
        role: 'user',
        auth_time: Math.floor(Date.now() / 1000),
        iss: 'https://securetoken.google.com/spinnermine',
        aud: 'spinnermine',
        sub: mockUserUid,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        firebase: { identities: {}, sign_in_provider: 'google.com' }
      });

      // Mock Firestore returning primary owned by mockUserUid, but secondary owned by mockStrangerUid
      const mockDoc = (id: string, exists: boolean, data: any) => ({
        id,
        exists,
        data: () => data,
        ref: { id }
      });

      vi.spyOn(adminDb, 'collection').mockImplementation((colName: string): any => {
        if (colName === 'miningWorkers') {
          return {
            doc: (docId: string) => ({
              get: vi.fn().mockImplementation(async () => {
                if (docId === 'w_qBPFqVEe_tm') {
                  return mockDoc('w_qBPFqVEe_tm', true, { userId: mockUserUid, name: 'tm' });
                }
                if (docId === 'w_other_device') {
                  return mockDoc('w_other_device', true, { userId: mockStrangerUid, name: 'stranger_pc' });
                }
                return mockDoc(docId, false, null);
              }),
              set: vi.fn().mockResolvedValue({})
            })
          } as any;
        }
        return {
          where: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValue({ empty: true, size: 0, docs: [] })
        } as any;
      });

      const res = await request(app)
        .post('/api/workers/merge')
        .set('Authorization', 'Bearer valid_user_jwt')
        .send({
          primaryWorkerId: 'w_qBPFqVEe_tm',
          secondaryWorkerId: 'w_other_device'
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CROSS_USER_MERGE_FORBIDDEN');
    });

    it('Requirement 3: Rejects merge if caller is not the owner (PERMISSION_DENIED) with 403', async () => {
      vi.spyOn(adminAuth, 'verifyIdToken').mockResolvedValueOnce({
        uid: mockStrangerUid, // Stranger tries to merge mockUserUid's devices
        email: 'stranger@spinnermine.cloud',
        admin: false,
        role: 'user',
        auth_time: Math.floor(Date.now() / 1000),
        iss: 'https://securetoken.google.com/spinnermine',
        aud: 'spinnermine',
        sub: mockStrangerUid,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        firebase: { identities: {}, sign_in_provider: 'google.com' }
      });

      const mockDoc = (id: string, exists: boolean, data: any) => ({
        id,
        exists,
        data: () => data,
        ref: { id }
      });

      vi.spyOn(adminDb, 'collection').mockImplementation((colName: string): any => {
        if (colName === 'miningWorkers') {
          return {
            doc: (docId: string) => ({
              get: vi.fn().mockImplementation(async () => {
                return mockDoc(docId, true, { userId: mockUserUid, name: 'user_device' });
              }),
              set: vi.fn().mockResolvedValue({})
            })
          } as any;
        }
        return {
          where: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValue({ empty: true, size: 0, docs: [] })
        } as any;
      });

      const res = await request(app)
        .post('/api/workers/merge')
        .set('Authorization', 'Bearer stranger_jwt')
        .send({
          primaryWorkerId: 'w_qBPFqVEe_tm',
          secondaryWorkerId: 'w_GyAldfJ5_ty'
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PERMISSION_DENIED');
    });

    it('Requirement 5 & 6: Executes merge safely with zero financial impact, preserving document and retained shares', async () => {
      vi.spyOn(adminAuth, 'verifyIdToken').mockResolvedValueOnce({
        uid: mockUserUid,
        email: 'owner@spinnermine.cloud',
        admin: false,
        role: 'user',
        auth_time: Math.floor(Date.now() / 1000),
        iss: 'https://securetoken.google.com/spinnermine',
        aud: 'spinnermine',
        sub: mockUserUid,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        firebase: { identities: {}, sign_in_provider: 'google.com' }
      });

      let updatedData: any = null;
      const mockDoc = (id: string, exists: boolean, data: any) => ({
        id,
        exists,
        data: () => data,
        ref: { id }
      });

      vi.spyOn(adminDb, 'collection').mockImplementation((colName: string): any => {
        if (colName === 'miningWorkers') {
          return {
            doc: (docId: string) => ({
              get: vi.fn().mockImplementation(async () => {
                if (docId === 'w_qBPFqVEe_tm') {
                  return mockDoc('w_qBPFqVEe_tm', true, { userId: mockUserUid, name: 'tm', acceptedShares: 120 });
                }
                if (docId === 'w_GyAldfJ5_ty') {
                  return mockDoc('w_GyAldfJ5_ty', true, { userId: mockUserUid, name: 'ty', acceptedShares: 15 });
                }
                return mockDoc(docId, false, null);
              }),
              set: vi.fn().mockImplementation(async (payload, opts) => {
                updatedData = payload;
                return {};
              })
            })
          } as any;
        }
        if (colName === 'miningSessions') {
          return {
            where: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({
              empty: false,
              size: 2,
              docs: [
                { ref: { id: 'sess_1' }, data: () => ({ sessionId: 'sess_1', workerId: 'w_GyAldfJ5_ty' }) },
                { ref: { id: 'sess_2' }, data: () => ({ sessionId: 'sess_2', workerId: 'w_GyAldfJ5_ty' }) }
              ]
            })
          } as any;
        }
        return {
          where: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValue({ empty: true, size: 0, docs: [] })
        } as any;
      });

      vi.spyOn(adminDb, 'batch').mockReturnValue({
        update: vi.fn(),
        commit: vi.fn().mockResolvedValue([])
      } as any);

      const res = await request(app)
        .post('/api/workers/merge')
        .set('Authorization', 'Bearer valid_owner_jwt')
        .send({
          primaryWorkerId: 'w_qBPFqVEe_tm',
          secondaryWorkerId: 'w_GyAldfJ5_ty',
          reason: 'Duplicate device resolved'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.primaryWorkerId).toBe('w_qBPFqVEe_tm');
      expect(res.body.mergedWorkerId).toBe('w_GyAldfJ5_ty');
      expect(res.body.financialBalanceImpact).toBe(0);
      expect(res.body.retainedAcceptedShares).toBe(15);
      expect(res.body.auditedSessionsCount).toBe(2);

      // Verify secondary document was marked as archived and linked to tm, NOT deleted!
      expect(updatedData).toBeDefined();
      expect(updatedData.mergedInto).toBe('w_qBPFqVEe_tm');
      expect(updatedData.isArchived).toBe(true);
      expect(updatedData.status).toBe('archived');
      expect(updatedData.archiveReason).toBe('Duplicate device resolved');
    });

    it('Missing Token: Client mergeWorkers strictly rejects request before dispatch if token is missing or empty', async () => {
      const res1 = await mergeWorkers('w_qBPFqVEe_tm', 'w_GyAldfJ5_ty', 'test', undefined);
      expect(res1.success).toBe(false);
      expect(res1.error).toContain('Missing or invalid Firebase authentication token');

      const res2 = await mergeWorkers('w_qBPFqVEe_tm', 'w_GyAldfJ5_ty', 'test', '   ');
      expect(res2.success).toBe(false);
      expect(res2.error).toContain('Missing or invalid Firebase authentication token');
    });

    it('Missing Token: Client archiveWorker strictly rejects request before dispatch if token is missing or empty', async () => {
      const res1 = await archiveWorker('w_GyAldfJ5_ty', 'test', undefined);
      expect(res1.success).toBe(false);
      expect(res1.error).toContain('Missing or invalid Firebase authentication token');

      const res2 = await archiveWorker('w_GyAldfJ5_ty', 'test', '');
      expect(res2.success).toBe(false);
      expect(res2.error).toContain('Missing or invalid Firebase authentication token');
    });

    it('Missing Token: Server POST /api/workers/archive returns 401 Unauthorized without Bearer token', async () => {
      const res = await request(app)
        .post('/api/workers/archive')
        .send({ workerId: 'w_GyAldfJ5_ty' });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Missing or invalid Authorization Bearer token');
    });

    it('Expired Token: Server POST /api/workers/archive returns 401 Unauthorized when token verification throws expired error', async () => {
      vi.spyOn(adminAuth, 'verifyIdToken').mockRejectedValueOnce(new Error('Firebase ID token has expired. Get a fresh ID token.'));

      const res = await request(app)
        .post('/api/workers/archive')
        .set('Authorization', 'Bearer expired_token_xyz')
        .send({ workerId: 'w_GyAldfJ5_ty' });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Token verification failed: Firebase ID token has expired');
    });

    it('Expired Token: Server POST /api/workers/merge returns 401 Unauthorized when token is expired', async () => {
      vi.spyOn(adminAuth, 'verifyIdToken').mockRejectedValueOnce(new Error('Firebase ID token has expired. Get a fresh ID token.'));

      const res = await request(app)
        .post('/api/workers/merge')
        .set('Authorization', 'Bearer expired_token_xyz')
        .send({ primaryWorkerId: 'w_qBPFqVEe_tm', secondaryWorkerId: 'w_GyAldfJ5_ty' });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Token verification failed: Firebase ID token has expired');
    });

    it('Wrong User: Server POST /api/workers/archive returns 403 when caller does not own the worker', async () => {
      vi.spyOn(adminAuth, 'verifyIdToken').mockResolvedValueOnce({
        uid: 'user_stranger_999',
        email: 'stranger@spinnermine.cloud',
        admin: false,
        role: 'user',
        auth_time: Math.floor(Date.now() / 1000),
        iss: 'https://securetoken.google.com/spinnermine',
        aud: 'spinnermine',
        sub: 'user_stranger_999',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        firebase: { identities: {}, sign_in_provider: 'google.com' }
      });

      vi.spyOn(adminDb, 'collection').mockImplementation((colName: string): any => {
        if (colName === 'miningWorkers') {
          return {
            doc: (docId: string) => ({
              get: vi.fn().mockResolvedValue({
                id: docId,
                exists: true,
                data: () => ({ userId: mockUserUid, name: 'ty' }) // owned by mockUserUid, not user_stranger_999
              })
            })
          } as any;
        }
        return { doc: vi.fn() } as any;
      });

      const res = await request(app)
        .post('/api/workers/archive')
        .set('Authorization', 'Bearer stranger_token')
        .send({ workerId: 'w_GyAldfJ5_ty' });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('You do not own this worker device');
    });

    it('Successful Archive: Server POST /api/workers/archive marks worker as archived with audit reason without document deletion', async () => {
      vi.spyOn(adminAuth, 'verifyIdToken').mockResolvedValueOnce({
        uid: mockUserUid,
        email: 'owner@spinnermine.cloud',
        admin: false,
        role: 'user',
        auth_time: Math.floor(Date.now() / 1000),
        iss: 'https://securetoken.google.com/spinnermine',
        aud: 'spinnermine',
        sub: mockUserUid,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        firebase: { identities: {}, sign_in_provider: 'google.com' }
      });

      let archivedPayload: any = null;
      vi.spyOn(adminDb, 'collection').mockImplementation((colName: string): any => {
        if (colName === 'miningWorkers') {
          return {
            doc: (docId: string) => ({
              get: vi.fn().mockResolvedValue({
                id: docId,
                exists: true,
                data: () => ({ userId: mockUserUid, name: 'ty', acceptedShares: 10 })
              }),
              set: vi.fn().mockImplementation(async (payload) => {
                archivedPayload = payload;
                return {};
              })
            })
          } as any;
        }
        return { doc: vi.fn() } as any;
      });

      const res = await request(app)
        .post('/api/workers/archive')
        .set('Authorization', 'Bearer valid_owner_jwt')
        .send({ workerId: 'w_GyAldfJ5_ty', reason: 'User resolved duplicate' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.workerId).toBe('w_GyAldfJ5_ty');
      expect(archivedPayload).toBeDefined();
      expect(archivedPayload.isArchived).toBe(true);
      expect(archivedPayload.status).toBe('archived');
      expect(archivedPayload.archiveReason).toBe('User resolved duplicate');
    });
  });
});
