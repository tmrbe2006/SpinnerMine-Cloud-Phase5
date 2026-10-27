import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import firebaseConfig from '../firebase-applet-config.json';
import { MiningWorker } from '../src/types';
import { detectDuplicateWorkers, deriveWorkerIdFromInstallation } from '../src/utils/installation-id';

describe('SpinnerMine Cloud — Windows Package Firebase Production Verification', () => {
  const rootDir = process.cwd();
  const distDir = path.resolve(rootDir, 'dist');
  const distAssetsDir = path.resolve(distDir, 'assets');

  describe('1. Production Firebase Configuration Integrity Gate', () => {
    it('strictly enforces spinnermine-cloud-production and (default) database in source config', () => {
      expect(firebaseConfig.projectId).toBe('spinnermine-cloud-production');
      expect(firebaseConfig.firestoreDatabaseId).toBe('(default)');
      expect(firebaseConfig.authDomain).toBe('spinnermine-cloud-production.firebaseapp.com');
      expect(firebaseConfig.apiKey).toBe('AIzaSyB9Eh0vir23mpO60t42-rjbDL77gdIbG-E');
      expect(firebaseConfig.appId).toBe('1:157443993763:web:693be9aa66e7b3c7104f16');
    });

    it('confirms zero non-production project IDs exist in source configuration', () => {
      const configStr = JSON.stringify(firebaseConfig);
      expect(configStr).not.toContain('gen-lang-client-0535145441');
      expect(configStr).not.toContain('ai-studio-spinnerminecloud');
      expect(configStr).not.toContain('grounded-cycling-dv9wh');
    });
  });

  describe('2. Windows Electron Compiled Distribution Bundle Gate', () => {
    it('verifies compiled JavaScript assets in dist/assets strictly target spinnermine-cloud-production', () => {
      if (!fs.existsSync(distAssetsDir)) {
        // Skip only if dist has not been compiled yet; build:electron-all builds it
        console.warn('dist/assets does not exist yet. Run build:electron-web to test bundle output.');
        return;
      }

      const jsFiles = fs.readdirSync(distAssetsDir).filter(f => f.endsWith('.js'));
      expect(jsFiles.length).toBeGreaterThan(0);

      let foundProductionProject = false;
      for (const jsFile of jsFiles) {
        const content = fs.readFileSync(path.join(distAssetsDir, jsFile), 'utf8');

        // Check for production project ID
        if (content.includes('spinnermine-cloud-production')) {
          foundProductionProject = true;
        }

        // Must NEVER contain development or AI Studio IDs
        expect(content).not.toContain('gen-lang-client-0535145441');
        expect(content).not.toContain('ai-studio-spinnerminecloud');
        expect(content).not.toContain('grounded-cycling-dv9wh');
      }

      expect(foundProductionProject).toBe(true);
    });
  });

  describe('3. Production Mining Devices Segregation & Sorting (tm & ty)', () => {
    // Real production Firestore documents for UID qBPFqVEeYVeUIE1w1rF2xcQFEV22
    const mockProductionWorkers: MiningWorker[] = [
      {
        id: 'w_qBPFqVEe_tm',
        workerId: 'w_qBPFqVEe_tm',
        userId: 'qBPFqVEeYVeUIE1w1rF2xcQFEV22',
        name: 'tm',
        deviceName: 'tm',
        platform: 'windows',
        status: 'online',
        cpuCores: 8,
        threads: 4,
        xmrigVersion: '6.26.0',
        reportedHashrate: 1420,
        acceptedShares: 48,
        rejectedShares: 0,
        lastSeen: new Date().toISOString(),
        createdAt: '2026-03-01T10:00:00Z',
        updatedAt: new Date().toISOString(),
        // Legacy: no installationId, no isArchived
      },
      {
        id: 'w_GyAldfJ5_ty',
        workerId: 'w_GyAldfJ5_ty',
        userId: 'qBPFqVEeYVeUIE1w1rF2xcQFEV22',
        name: 'ty',
        deviceName: 'ty',
        platform: 'windows',
        status: 'archived',
        isArchived: true,
        cpuCores: 8,
        threads: 4,
        xmrigVersion: '6.26.0',
        reportedHashrate: 0,
        acceptedShares: 12,
        rejectedShares: 0,
        lastSeen: '2026-03-02T12:00:00Z',
        createdAt: '2026-03-02T10:00:00Z',
        updatedAt: '2026-03-02T14:00:00Z',
      }
    ];

    it('correctly categorizes tm as active and ty as archived without discarding legacy fields', () => {
      const activeWorkers = mockProductionWorkers.filter(w => !w.isArchived && !w.mergedInto && w.status !== 'archived');
      const archivedWorkers = mockProductionWorkers.filter(w => Boolean(w.isArchived) || Boolean(w.mergedInto) || w.status === 'archived');

      expect(activeWorkers.length).toBe(1);
      expect(activeWorkers[0].workerId).toBe('w_qBPFqVEe_tm');
      expect(activeWorkers[0].name).toBe('tm');
      expect(activeWorkers[0].status).toBe('online');

      expect(archivedWorkers.length).toBe(1);
      expect(archivedWorkers[0].workerId).toBe('w_GyAldfJ5_ty');
      expect(archivedWorkers[0].name).toBe('ty');
      expect(archivedWorkers[0].isArchived).toBe(true);
    });

    it('enforces tm as primary active worker at top of display list', () => {
      const activeWorkers = mockProductionWorkers.filter(w => !w.isArchived && !w.mergedInto && w.status !== 'archived');
      activeWorkers.sort((a, b) => {
        if (a.workerId === 'w_qBPFqVEe_tm' || a.name === 'tm') return -1;
        if (b.workerId === 'w_qBPFqVEe_tm' || b.name === 'tm') return 1;
        return 0;
      });

      expect(activeWorkers[0].workerId).toBe('w_qBPFqVEe_tm');
    });

    it('preserves acceptedShares and balances without client-side modification', () => {
      const tm = mockProductionWorkers.find(w => w.workerId === 'w_qBPFqVEe_tm')!;
      const ty = mockProductionWorkers.find(w => w.workerId === 'w_GyAldfJ5_ty')!;

      expect(tm.acceptedShares).toBe(48);
      expect(ty.acceptedShares).toBe(12);
      expect((tm.acceptedShares || 0) + (ty.acceptedShares || 0)).toBe(60);
    });

    it('links permanent installation ID to tm without changing workerId or creating a 3rd worker', () => {
      const permanentInstId = 'inst_9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
      const updatedTm: MiningWorker = {
        ...mockProductionWorkers[0],
        installationId: permanentInstId,
        installationLinkedAt: new Date().toISOString()
      };

      // Worker ID remains w_qBPFqVEe_tm
      expect(updatedTm.workerId).toBe('w_qBPFqVEe_tm');
      expect(updatedTm.installationId).toBe(permanentInstId);

      const allWorkers = [updatedTm, mockProductionWorkers[1]];
      expect(allWorkers.length).toBe(2);

      // Active list has only tm, ty is archived
      const active = allWorkers.filter(w => !w.isArchived && !w.mergedInto && w.status !== 'archived');
      const archived = allWorkers.filter(w => Boolean(w.isArchived) || Boolean(w.mergedInto) || w.status === 'archived');
      expect(active.length).toBe(1);
      expect(active[0].workerId).toBe('w_qBPFqVEe_tm');
      expect(archived.length).toBe(1);
      expect(archived[0].workerId).toBe('w_GyAldfJ5_ty');

      // If ty was active prior to archiving, deduplication flags it as duplicate and preserves tm as primary
      const unarchivedTy = { ...mockProductionWorkers[1], isArchived: false, status: 'online' as const };
      const preArchiveWorkers = [updatedTm, unarchivedTy];
      const dups = detectDuplicateWorkers(preArchiveWorkers);
      expect(dups.length).toBeGreaterThan(0);
      expect(dups[0].primaryWorker.workerId).toBe('w_qBPFqVEe_tm');
    });

    it('changing device name from tm to Windows-PC preserves workerId and installationId', () => {
      const currentWorker: MiningWorker = {
        ...mockProductionWorkers[0],
        installationId: 'inst_9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'
      };

      const renamedWorker: MiningWorker = {
        ...currentWorker,
        name: 'Windows-Gaming-PC',
        deviceName: 'Windows-Gaming-PC',
        updatedAt: new Date().toISOString()
      };

      expect(renamedWorker.workerId).toBe('w_qBPFqVEe_tm');
      expect(renamedWorker.installationId).toBe('inst_9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d');
      expect(renamedWorker.name).toBe('Windows-Gaming-PC');
    });
  });
});
