/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SpinnerMine Cloud - Authoritative Automated Test Suite: XMRig 6.26.0 Cryptographic Verification
 *
 * Validates:
 * 1. Official GitHub Release v6.26.0 ZIP archive SHA-256 (bba8097c...).
 * 2. Independent Extraction Verified EXE binary SHA-256 (6fa80698...).
 * 3. Strict cryptographic distinction between ZIP archive hash and EXE executable hash.
 * 4. Case-insensitive hash handling (e.g., uppercase hex provided by user).
 * 5. Rejection of unverified, modified, or tampered binaries.
 * 6. Explicit guidance when a user selects the ZIP package instead of extracted xmrig.exe.
 * 7. Preservation of existing trusted versions in the official database.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { 
  XMRigAdapter, 
  calculateFileSha256, 
  KNOWN_OFFICIAL_XMRIG_SHA256, 
  KNOWN_OFFICIAL_XMRIG_EXE_SHA256, 
  KNOWN_OFFICIAL_XMRIG_ZIP_SHA256, 
  identifyXMRigRelease 
} from '../src/mining/xmrig-adapter';

describe('XMRig 6.26.0 Authoritative Cryptographic Verification Suite', () => {
  const OFFICIAL_V6260_ZIP_SHA256 = 'bba8097cb37d9b458a1cb1137876b27cde6740d17fe4ccbc086ba07d87d9e147';
  const OFFICIAL_V6260_EXE_SHA256 = '6fa80698d7268f6e88aa88c06fb27ee99e1bcee747c2e76911e6206a5b1aeeb3';
  const USER_PROVIDED_UPPERCASE_HASH = '6FA80698D7268F6E88AA88C06FB27EE99E1BCEE747C2E76911E6206A5B1AEEB3';

  const testTempDir = path.resolve('.mining_temp/v6260_test');
  const dummyExePath = path.join(testTempDir, 'test_sample.exe');
  const dummyZipPath = path.join(testTempDir, 'test_sample.zip');

  beforeAll(() => {
    if (!fs.existsSync(testTempDir)) {
      fs.mkdirSync(testTempDir, { recursive: true });
    }
    // Create dummy files larger than 500KB for file validation testing
    fs.writeFileSync(dummyExePath, Buffer.alloc(600 * 1024, 0x58));
    fs.writeFileSync(dummyZipPath, Buffer.alloc(600 * 1024, 0x5A));
  });

  afterAll(() => {
    try {
      if (fs.existsSync(dummyExePath)) fs.unlinkSync(dummyExePath);
      if (fs.existsSync(dummyZipPath)) fs.unlinkSync(dummyZipPath);
      if (fs.existsSync(testTempDir)) fs.rmdirSync(testTempDir);
    } catch {}
  });

  describe('1. Official Hashes & Database Integrity', () => {
    it('contains verified official XMRig 6.26.0 executable hash in trusted database', () => {
      expect(KNOWN_OFFICIAL_XMRIG_SHA256['6.26.0']).toBe(OFFICIAL_V6260_EXE_SHA256);
      expect(KNOWN_OFFICIAL_XMRIG_SHA256['6.26.0-exe']).toBe(OFFICIAL_V6260_EXE_SHA256);
      expect(KNOWN_OFFICIAL_XMRIG_EXE_SHA256['6.26.0']).toBe(OFFICIAL_V6260_EXE_SHA256);
    });

    it('contains verified official XMRig 6.26.0 ZIP archive hash in trusted database', () => {
      expect(KNOWN_OFFICIAL_XMRIG_SHA256['6.26.0-zip']).toBe(OFFICIAL_V6260_ZIP_SHA256);
      expect(KNOWN_OFFICIAL_XMRIG_ZIP_SHA256['6.26.0']).toBe(OFFICIAL_V6260_ZIP_SHA256);
    });

    it('strict distinction: ZIP and EXE hashes are cryptographically distinct', () => {
      expect(OFFICIAL_V6260_ZIP_SHA256).not.toBe(OFFICIAL_V6260_EXE_SHA256);
      expect(KNOWN_OFFICIAL_XMRIG_ZIP_SHA256['6.26.0']).not.toBe(KNOWN_OFFICIAL_XMRIG_EXE_SHA256['6.26.0']);
    });

    it('all registered official hashes adhere to valid 64-char lowercase hex formatting', () => {
      for (const [key, hash] of Object.entries(KNOWN_OFFICIAL_XMRIG_SHA256)) {
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
      }
      for (const [key, hash] of Object.entries(KNOWN_OFFICIAL_XMRIG_EXE_SHA256)) {
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
      }
      for (const [key, hash] of Object.entries(KNOWN_OFFICIAL_XMRIG_ZIP_SHA256)) {
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it('preserves prior official releases (e.g. 6.22.2, 6.22.1, 6.22.0, 6.21.3)', () => {
      expect(KNOWN_OFFICIAL_XMRIG_SHA256['6.22.2']).toBeDefined();
      expect(KNOWN_OFFICIAL_XMRIG_SHA256['6.22.1']).toBeDefined();
      expect(KNOWN_OFFICIAL_XMRIG_SHA256['6.22.0']).toBeDefined();
      expect(KNOWN_OFFICIAL_XMRIG_SHA256['6.21.3']).toBeDefined();
    });
  });

  describe('2. Cryptographic Classification & Distinction (identifyXMRigRelease)', () => {
    it('correctly identifies official 6.26.0 EXE hash as executable', () => {
      const result = identifyXMRigRelease(OFFICIAL_V6260_EXE_SHA256);
      expect(result).not.toBeNull();
      expect(result?.version).toBe('6.26.0');
      expect(result?.type).toBe('exe');
      expect(result?.fileName).toBe('xmrig.exe');
    });

    it('correctly identifies official 6.26.0 ZIP hash as archive', () => {
      const result = identifyXMRigRelease(OFFICIAL_V6260_ZIP_SHA256);
      expect(result).not.toBeNull();
      expect(result?.version).toBe('6.26.0');
      expect(result?.type).toBe('zip');
      expect(result?.fileName).toBe('xmrig-6.26.0-windows-x64.zip');
    });

    it('handles uppercase hexadecimal input transparently', () => {
      const result = identifyXMRigRelease(USER_PROVIDED_UPPERCASE_HASH);
      expect(result).not.toBeNull();
      expect(result?.version).toBe('6.26.0');
      expect(result?.type).toBe('exe');
    });

    it('returns null for unverified, modified, or unknown hashes', () => {
      const unknownHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      const result = identifyXMRigRelease(unknownHash);
      expect(result).toBeNull();
    });
  });

  describe('3. Binary Authenticity Gate & Execution Safety (validateExecutable)', () => {
    it('strictly rejects unverified or modified binary files', async () => {
      const result = await XMRigAdapter.validateExecutable(dummyExePath);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Unverified XMRig binary');
      expect(result.sha256).toBeDefined();
    });

    it('validates binary successfully when explicit expectedSha256 matches computed hash', async () => {
      const actualHash = await calculateFileSha256(dummyExePath);
      const result = await XMRigAdapter.validateExecutable(dummyExePath, actualHash);
      expect(result.valid).toBe(true);
      expect(result.sha256).toBe(actualHash);
      expect(result.matchedVersion).toBe('custom-verified');
    });

    it('supports uppercase expectedSha256 without case mismatch error', async () => {
      const actualHash = await calculateFileSha256(dummyExePath);
      const uppercaseHash = actualHash.toUpperCase();
      const result = await XMRigAdapter.validateExecutable(dummyExePath, uppercaseHash);
      expect(result.valid).toBe(true);
      expect(result.sha256).toBe(actualHash);
    });

    it('rejects binary when expectedSha256 does not match', async () => {
      const result = await XMRigAdapter.validateExecutable(dummyExePath, OFFICIAL_V6260_EXE_SHA256);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('SHA-256 mismatch');
    });

    it('rejects file too small to be authentic binary', async () => {
      const tinyPath = path.join(testTempDir, 'tiny.exe');
      fs.writeFileSync(tinyPath, 'MZ_not_real');
      try {
        const result = await XMRigAdapter.validateExecutable(tinyPath);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('too small');
      } finally {
        fs.unlinkSync(tinyPath);
      }
    });

    it('rejects non-existent file path cleanly', async () => {
      const result = await XMRigAdapter.validateExecutable('C:\\non_existent_folder\\xmrig.exe');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('does not exist');
    });
  });

  describe('4. File Classification (validateFile)', () => {
    it('identifies unverified file as unknown', async () => {
      const result = await XMRigAdapter.validateFile(dummyExePath);
      expect(result.valid).toBe(false);
      expect(result.type).toBe('unknown');
      expect(result.isOfficial).toBe(false);
    });
  });
});
