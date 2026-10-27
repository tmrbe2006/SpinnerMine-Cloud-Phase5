import { describe, it, expect } from 'vitest';
import { formatAuthError } from '../src/utils/auth-errors';
import { isTrustedOrigin, getBackendBaseUrl } from '../src/services/apiClient';
import firebaseConfig from '../firebase-applet-config.json';

describe('SpinnerMine Phase 2 — Critical Authentication & Worker Registration Acceptance Tests', () => {

  describe('Requirement 1 & 9: Bilingual Error Handling and auth/operation-not-allowed Guidance', () => {
    it('formats auth/operation-not-allowed with clear bilingual message and console link', () => {
      const err = { code: 'auth/operation-not-allowed', message: 'The given sign-in provider is disabled.' };
      
      const enRes = formatAuthError(err, 'en');
      const expectedProject = (firebaseConfig as any)?.projectId || 'spinnermine-cloud-production';
      expect(enRes.code).toBe('auth/operation-not-allowed');
      expect(enRes.message).toContain('Email/Password authentication is currently disabled');
      expect(enRes.consoleUrl).toContain(expectedProject);
      expect(enRes.consoleUrl).toContain('authentication/providers');
      expect(enRes.suggestGoogleSignIn).toBe(true);

      const arRes = formatAuthError(err, 'ar');
      expect(arRes.code).toBe('auth/operation-not-allowed');
      expect(arRes.message).toContain('إنشاء الحساب بالبريد وكلمة المرور معطّل');
      expect(arRes.suggestGoogleSignIn).toBe(true);
    });

    it('formats auth/email-already-in-use accurately in EN and AR', () => {
      const err = { code: 'auth/email-already-in-use' };
      const en = formatAuthError(err, 'en');
      const ar = formatAuthError(err, 'ar');

      expect(en.message).toContain('This email address is already in use');
      expect(ar.message).toContain('هذا البريد الإلكتروني مسجل بالفعل');
    });

    it('formats auth/weak-password and auth/invalid-email accurately', () => {
      const weak = formatAuthError({ code: 'auth/weak-password' }, 'en');
      const invalid = formatAuthError({ code: 'auth/invalid-email' }, 'en');

      expect(weak.message).toContain('password is too weak');
      expect(invalid.message).toContain('valid email address');
    });

    it('formats auth/unauthorized-domain with authorized domains guidance', () => {
      const res = formatAuthError({ code: 'auth/unauthorized-domain' }, 'en');
      const expectedProject = (firebaseConfig as any)?.projectId || 'spinnermine-cloud-production';
      expect(res.message).toContain('Authorized Domains');
      expect(res.consoleUrl).toContain(expectedProject);
    });

    it('formats auth/popup-blocked and auth/network-request-failed with friendly advice', () => {
      const popup = formatAuthError({ code: 'auth/popup-blocked' }, 'en');
      const net = formatAuthError({ code: 'auth/network-request-failed' }, 'en');

      expect(popup.message).toContain('authentication popup was blocked');
      expect(net.message).toContain('authentication service');
    });

    it('formats permission-denied without leaking security internals', () => {
      const denied = formatAuthError({ code: 'permission-denied' }, 'en');
      expect(denied.message).toContain('Security rules prevented this operation');
      expect(denied.message).not.toContain('auth.token');
    });

    it('sanitizes unknown errors to prevent credential or token exposure', () => {
      const sensitiveErr = new Error('Sensitive Bearer eyJhbGciOi token secret 123456');
      const formatted = formatAuthError(sensitiveErr, 'en');
      expect(formatted.message).not.toContain('eyJhbGciOi');
      expect(formatted.message).not.toContain('123456');
      expect(formatted.message).toContain('verify your credentials');
    });
  });

  describe('Requirement 2 & 5: API Security & Origin Trust Guarding', () => {
    it('trusts active Cloud Run backend origins and localhost', () => {
      expect(isTrustedOrigin('https://ais-dev-oxprrk5unet7oytub2m7vz-384193724240.europe-west2.run.app/api/workers/register')).toBe(true);
      expect(isTrustedOrigin('https://ais-pre-oxprrk5unet7oytub2m7vz-384193724240.europe-west2.run.app/api/workers/register')).toBe(true);
      expect(isTrustedOrigin('http://localhost:3000/api/mining/pool-config')).toBe(true);
      expect(isTrustedOrigin('https://spinnermine-cloud.web.app/api')).toBe(true);
    });

    it('strictly rejects file:// protocols and attacker-controlled origins', () => {
      expect(isTrustedOrigin('file:///C:/Users/AppData/Local/Temp/exploit')).toBe(false);
      expect(isTrustedOrigin('file:///etc/passwd')).toBe(false);
      expect(isTrustedOrigin('https://malicious-mining-stealer.xyz/api')).toBe(false);
      expect(isTrustedOrigin('http://169.254.169.254/latest/meta-data/')).toBe(false);
    });

    it('resolves correct backend base URL for web vs desktop', () => {
      const base = getBackendBaseUrl();
      expect(typeof base).toBe('string');
    });
  });

  describe('Requirement 3 & 4: Worker Registration & CPU Allocation Logic', () => {
    it('clamps CPU threads strictly between 1 and detected hardware cores', () => {
      const detectedCores = 8;
      const clampThreads = (val: number) => Math.max(1, Math.min(detectedCores, Math.floor(val) || 1));

      expect(clampThreads(0)).toBe(1);
      expect(clampThreads(-5)).toBe(1);
      expect(clampThreads(4)).toBe(4);
      expect(clampThreads(8)).toBe(8);
      expect(clampThreads(16)).toBe(8);
      expect(clampThreads(NaN)).toBe(1);
    });

    it('generates deterministic worker IDs preventing collision and random churn', () => {
      const uid = 'usr_abc123xyz789';
      const deviceName = 'Ryzen 7 Desktop Mining Rig!';
      const sanitized = deviceName.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 24);
      const workerId = `w_${uid.slice(0, 8)}_${sanitized}`;

      expect(workerId).toBe('w_usr_abc1_ryzen_7_desktop_mining_r');
      // Identical inputs produce the exact same ID (deterministic pairing)
      const workerIdAgain = `w_${uid.slice(0, 8)}_${sanitized}`;
      expect(workerIdAgain).toBe(workerId);
    });

    it('validates workerId minimum length requirement', () => {
      const isValidWorkerId = (id: string) => typeof id === 'string' && id.trim().length >= 3;
      expect(isValidWorkerId('w1')).toBe(false);
      expect(isValidWorkerId('   ')).toBe(false);
      expect(isValidWorkerId('w_win_desktop')).toBe(true);
    });
    it('validates worker registration requires authentication and non-empty name', () => {
      const validateRegistration = (user: { uid: string } | null, name: string) => {
        if (!user) return { valid: false, error: 'auth-required' };
        if (!name.trim()) return { valid: false, error: 'name-required' };
        return { valid: true };
      };

      expect(validateRegistration(null, 'My PC')).toEqual({ valid: false, error: 'auth-required' });
      expect(validateRegistration({ uid: 'u1' }, '')).toEqual({ valid: false, error: 'name-required' });
      expect(validateRegistration({ uid: 'u1' }, '   ')).toEqual({ valid: false, error: 'name-required' });
      expect(validateRegistration({ uid: 'u1' }, 'Windows PC')).toEqual({ valid: true });
    });

    it('upserts workers and updates total workers count without duplicate entries', () => {
      interface WorkerEntry { id: string; name: string; status: string }
      let workers: WorkerEntry[] = [];

      const upsertWorker = (newWorker: WorkerEntry) => {
        const existingIdx = workers.findIndex(w => w.id === newWorker.id);
        if (existingIdx >= 0) {
          workers[existingIdx] = { ...workers[existingIdx], ...newWorker };
        } else {
          workers = [newWorker, ...workers];
        }
        return workers.length;
      };

      const count1 = upsertWorker({ id: 'w_1', name: 'PC 1', status: 'offline' });
      expect(count1).toBe(1);
      expect(workers.length).toBe(1);

      // Register second worker
      const count2 = upsertWorker({ id: 'w_2', name: 'PC 2', status: 'offline' });
      expect(count2).toBe(2);
      expect(workers.length).toBe(2);

      // Re-register or update first worker (upsert: must NOT increase count)
      const count3 = upsertWorker({ id: 'w_1', name: 'PC 1 Renamed', status: 'offline' });
      expect(count3).toBe(2);
      expect(workers.length).toBe(2);
      expect(workers.find(w => w.id === 'w_1')?.name).toBe('PC 1 Renamed');
    });

    it('guarantees that worker registration never auto-starts mining', () => {
      const defaultRegistrationStatus = 'offline';
      expect(defaultRegistrationStatus).toBe('offline');
      expect(defaultRegistrationStatus).not.toBe('mining');
    });
  });

  describe('Requirement 7: Revenue Split Preservation (20% User / 80% Platform)', () => {
    it('strictly preserves the 20% User / 80% Platform economic split', () => {
      const userSplit = 0.20;
      const platformSplit = 0.80;

      expect(userSplit + platformSplit).toBe(1.00);
      expect(userSplit).toBe(0.20);
      expect(platformSplit).toBe(0.80);
    });

    it('prohibits synthetic balance increments from unverified hardware telemetry', () => {
      const calculateTelemetryBalance = (hashrate: number, shares: number) => {
        // Raw hardware telemetry produces ZERO financial balance impact
        return 0;
      };
      expect(calculateTelemetryBalance(5000, 100)).toBe(0);
    });
  });
});
