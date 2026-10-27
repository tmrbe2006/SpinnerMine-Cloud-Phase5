import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import firebaseConfig from '../firebase-applet-config.json';
import { formatAuthError } from '../src/utils/auth-errors';
import { KNOWN_OFFICIAL_XMRIG_SHA256 } from '../src/mining/xmrig-adapter';

describe('SpinnerMine Cloud Phase 2 — Firebase Production Migration Verification', () => {

  describe('1. Production Firebase Configuration Integrity', () => {
    it('verifies exact production project credentials and (default) database in firebase-applet-config.json', () => {
      expect(firebaseConfig.projectId).toBe('spinnermine-cloud-production');
      expect(firebaseConfig.authDomain).toBe('spinnermine-cloud-production.firebaseapp.com');
      expect(firebaseConfig.apiKey).toBe('AIzaSyB9Eh0vir23mpO60t42-rjbDL77gdIbG-E');
      expect(firebaseConfig.storageBucket).toBe('spinnermine-cloud-production.firebasestorage.app');
      expect(firebaseConfig.messagingSenderId).toBe('157443993763');
      expect(firebaseConfig.appId).toBe('1:157443993763:web:693be9aa66e7b3c7104f16');
      expect(firebaseConfig.measurementId).toBe('G-W49MT8XT2T');
      expect(firebaseConfig.firestoreDatabaseId).toBe('(default)');
    });

    it('ensures zero service account secrets or private keys are exposed in client configuration', () => {
      const configStr = JSON.stringify(firebaseConfig);
      expect(configStr).not.toContain('private_key');
      expect(configStr).not.toContain('client_secret');
      expect(configStr).not.toContain('BEGIN PRIVATE KEY');
    });

    it('confirms complete eradication of all legacy project identifiers in configuration', () => {
      const configStr = JSON.stringify(firebaseConfig);
      expect(configStr).not.toContain('grounded-cycling-dv9wh');
      expect(configStr).not.toContain('gen-lang-client-0535145441');
      expect(configStr).not.toContain('ai-studio-spinnerminecloud');
    });
  });

  describe('2. Client & Backend Database Targeting Consistency', () => {
    it('verifies src/firebase/config.ts targets (default) database and logs safe startup diagnostics', () => {
      const configSource = fs.readFileSync(path.resolve('src/firebase/config.ts'), 'utf8');
      expect(configSource).toContain('[Firebase Client Init]');
      expect(configSource).toContain("configuredDbId !== '(default)'");
      expect(configSource).not.toContain('grounded-cycling-dv9wh');
    });

    it('verifies server.ts targets spinnermine-cloud-production and (default) database in production mode', () => {
      const serverSource = fs.readFileSync(path.resolve('server.ts'), 'utf8');
      expect(serverSource).toContain('[Firebase Admin Init]');
      expect(serverSource).toContain("'spinnermine-cloud-production'");
      expect(serverSource).not.toContain('grounded-cycling-dv9wh');
    });

    it('verifies desktop/main.ts whitelists spinnermine-cloud-production.firebaseapp.com for OAuth', () => {
      const mainSource = fs.readFileSync(path.resolve('desktop/main.ts'), 'utf8');
      expect(mainSource).toContain('https://spinnermine-cloud-production.firebaseapp.com');
      expect(mainSource).not.toContain('grounded-cycling-dv9wh');
    });
  });

  describe('3. Bilingual Auth & Console Deep-links in Production', () => {
    it('formats operation-not-allowed pointing to spinnermine-cloud-production console URL', () => {
      const err = { code: 'auth/operation-not-allowed', message: 'Sign-in provider disabled.' };
      const formatted = formatAuthError(err, 'en');

      const expectedProject = (firebaseConfig as any)?.projectId || 'spinnermine-cloud-production';
      expect(formatted.consoleUrl).toContain(expectedProject);
      expect(formatted.consoleUrl).toContain('authentication/providers');
      expect(formatted.message).toContain(expectedProject);
    });

    it('formats unauthorized-domain pointing to spinnermine-cloud-production settings URL', () => {
      const err = { code: 'auth/unauthorized-domain' };
      const formatted = formatAuthError(err, 'ar');

      const expectedProject = (firebaseConfig as any)?.projectId || 'spinnermine-cloud-production';
      expect(formatted.consoleUrl).toContain(expectedProject);
      expect(formatted.consoleUrl).toContain('authentication/settings');
      expect(formatted.message).toContain(expectedProject);
    });
  });

  describe('4. Preserved Critical Invariants (XMRig 6.26.0, 20/80 Revenue, Security Rules)', () => {
    it('preserves official XMRig 6.26.0 cryptographic SHA-256 hash', () => {
      expect(KNOWN_OFFICIAL_XMRIG_SHA256['6.26.0']).toBe(
        '6fa80698d7268f6e88aa88c06fb27ee99e1bcee747c2e76911e6206a5b1aeeb3'
      );
      expect(KNOWN_OFFICIAL_XMRIG_SHA256['6.26.0-zip']).toBe(
        'bba8097cb37d9b458a1cb1137876b27cde6740d17fe4ccbc086ba07d87d9e147'
      );
    });

    it('verifies firestore.rules enforces least-privilege role=user and locks administrative collections', () => {
      const rules = fs.readFileSync(path.resolve('firestore.rules'), 'utf8');
      expect(rules).toContain("incoming().role == 'user'");
      expect(rules).toContain('match /admins/{adminId}');
      expect(rules).toContain('allow write: if false;');
      expect(rules).toContain('match /usedNonces/{nonce}');
    });
  });
});
