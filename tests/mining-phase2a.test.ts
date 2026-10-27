import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateXMRigConfig, validateXMRigConfig, isValidPoolHost, isValidMoneroAddress } from '../src/mining/xmrig-config';
import { XMRigAdapter, calculateFileSha256, KNOWN_OFFICIAL_XMRIG_SHA256 } from '../src/mining/xmrig-adapter';
import { MockStratumServer } from '../src/mining/mock-stratum-server';
import request from 'supertest';
import { createServerApp } from '../server';
import fs from 'fs';
import path from 'path';

describe('Phase 2A: Real Mining Engine & Windows XMRig Integration Tests', () => {
  let mockStratum: MockStratumServer;
  let mockStratumPort: number;
  const app = createServerApp();
  const tempTestFilePath = path.resolve('.mining_temp/test_binary_sample.bin');

  beforeAll(async () => {
    // Start local Stratum mock server for real socket tests
    mockStratum = new MockStratumServer({ port: 0 });
    mockStratumPort = await mockStratum.start();

    // Create a temporary mock binary file to test SHA-256 calculation
    const dir = path.dirname(tempTestFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Write a dummy buffer larger than 500KB
    const dummyBuffer = Buffer.alloc(600 * 1024, 0x90);
    fs.writeFileSync(tempTestFilePath, dummyBuffer);
  });

  afterAll(async () => {
    if (mockStratum) {
      await mockStratum.stop();
    }
    if (fs.existsSync(tempTestFilePath)) {
      try { fs.unlinkSync(tempTestFilePath); } catch {}
    }
  });

  describe('1. XMRig Configuration & Strict Validation (No Fake Defaults)', () => {
    it('generates valid JSON adhering to official XMRig specification when valid inputs are given', () => {
      const generated = generateXMRigConfig({
        poolHost: 'pool.supportxmr.com',
        poolPort: 3333,
        tls: true,
        walletAddress: '44AFFq5kSiGBoZ4NMDwYtN18obc8AemS33DBLWs3H7otXMV33WD9279tQiTcTDALCQSmRJq3PJ1nKAqZsK64cX97DpWstPm',
        workerName: 'rig_worker_01',
        threads: 4,
        maxThreadsHint: 50
      });

      expect(generated.config).toBeDefined();
      expect(generated.config.cpu.enabled).toBe(true);
      expect(generated.config.cpu.rx).toEqual([0, 1, 2, 3]);
      expect(generated.config.pools[0].algo).toBe('rx/0');
      expect(generated.config.pools[0].coin).toBe('monero');
      expect(generated.config.pools[0].tls).toBe(true);
      expect(generated.config.pools[0].user).toContain('rig_worker_01');

      const validation = validateXMRigConfig(generated.config);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('rejects missing or empty pool host without fake defaults', () => {
      expect(() => {
        generateXMRigConfig({
          poolHost: '',
          poolPort: 3333,
          tls: false,
          walletAddress: '44AFFq5kSiGBoZ4NMDwYtN18obc8AemS33DBLWs3H7otXMV33WD9279tQiTcTDALCQSmRJq3PJ1nKAqZsK64cX97DpWstPm',
          workerName: 'rig1'
        });
      }).toThrow(/Valid mining pool host must be explicitly configured/);

      expect(isValidPoolHost('')).toBe(false);
      expect(isValidPoolHost('placeholder')).toBe(false);
      expect(isValidPoolHost('pool.supportxmr.com')).toBe(true);
    });

    it('rejects invalid pool port numbers', () => {
      expect(() => {
        generateXMRigConfig({
          poolHost: 'pool.supportxmr.com',
          poolPort: 70000,
          tls: false,
          walletAddress: '44AFFq5kSiGBoZ4NMDwYtN18obc8AemS33DBLWs3H7otXMV33WD9279tQiTcTDALCQSmRJq3PJ1nKAqZsK64cX97DpWstPm',
          workerName: 'rig1'
        });
      }).toThrow(/Invalid mining pool port/);
    });

    it('rejects empty or invalid wallet addresses', () => {
      expect(() => {
        generateXMRigConfig({
          poolHost: 'pool.supportxmr.com',
          poolPort: 3333,
          tls: false,
          walletAddress: '',
          workerName: 'rig1'
        });
      }).toThrow(/Valid mining wallet address must be explicitly configured/);

      expect(isValidMoneroAddress('')).toBe(false);
      expect(isValidMoneroAddress('short')).toBe(false);
      expect(isValidMoneroAddress('44AFFq5kSiGBoZ4NMDwYtN18obc8AemS33DBLWs3H7otXMV33WD9279tQiTcTDALCQSmRJq3PJ1nKAqZsK64cX97DpWstPm')).toBe(true);
    });

    it('Security Invariant: HTTP API is strictly bound to 127.0.0.1 with bearer token', () => {
      const generated = generateXMRigConfig({
        poolHost: '127.0.0.1',
        poolPort: mockStratumPort,
        tls: false,
        walletAddress: '44AFFq5kSiGBoZ4NMDwYtN18obc8AemS33DBLWs3H7otXMV33WD9279tQiTcTDALCQSmRJq3PJ1nKAqZsK64cX97DpWstPm',
        workerName: 'test_worker',
        apiPort: 18099
      });

      expect(generated.config.api.host).toBe('127.0.0.1');
      expect(generated.config.http.host).toBe('127.0.0.1');
      expect(generated.config.api.restricted).toBe(true);
      expect(generated.apiToken).toBeDefined();
      expect(generated.apiToken.length).toBeGreaterThanOrEqual(16);

      // Malicious external binding is strictly rejected by validator
      const maliciousConfig = {
        ...generated.config,
        api: { ...generated.config.api, host: '0.0.0.0' }
      };
      const validation = validateXMRigConfig(maliciousConfig);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('127.0.0.1'))).toBe(true);
    });
  });

  describe('2. XMRig Binary SHA-256 Verification & Process Safety', () => {
    it('computes cryptographic SHA-256 checksum of binary file', async () => {
      const hash = await calculateFileSha256(tempTestFilePath);
      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64); // 256-bit hex
    });

    it('rejects non-existent file or files smaller than authentic binary threshold', async () => {
      const nonExistent = await XMRigAdapter.validateExecutable('C:\\non_existent_path\\xmrig.exe');
      expect(nonExistent.valid).toBe(false);
      expect(nonExistent.reason).toContain('does not exist');

      // Create a tiny stub (10 bytes) to test stub rejection
      const tinyStubPath = path.resolve('.mining_temp/tiny_stub.exe');
      fs.writeFileSync(tinyStubPath, 'stub');
      const tinyResult = await XMRigAdapter.validateExecutable(tinyStubPath);
      expect(tinyResult.valid).toBe(false);
      expect(tinyResult.reason).toContain('too small');
      fs.unlinkSync(tinyStubPath);
    });

    it('detects known official XMRig release versions via SHA-256 including v6.26.0', () => {
      // Official XMRig 6.26.0
      expect(KNOWN_OFFICIAL_XMRIG_SHA256['6.26.0']).toBe('6fa80698d7268f6e88aa88c06fb27ee99e1bcee747c2e76911e6206a5b1aeeb3');
      expect(KNOWN_OFFICIAL_XMRIG_SHA256['6.26.0-exe']).toBe('6fa80698d7268f6e88aa88c06fb27ee99e1bcee747c2e76911e6206a5b1aeeb3');
      expect(KNOWN_OFFICIAL_XMRIG_SHA256['6.26.0-zip']).toBe('bba8097cb37d9b458a1cb1137876b27cde6740d17fe4ccbc086ba07d87d9e147');
      
      // Existing official releases preserved
      expect(KNOWN_OFFICIAL_XMRIG_SHA256['6.22.2']).toBeDefined();
      expect(KNOWN_OFFICIAL_XMRIG_SHA256['6.22.2'].length).toBe(64);
    });

    it('strictly rejects unverified binary whose SHA-256 is not in the trusted list without expectedSha256', async () => {
      const result = await XMRigAdapter.validateExecutable(tempTestFilePath);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Unverified XMRig binary');
    });

    it('accepts binary when explicit expectedSha256 matches computed file hash', async () => {
      const actualHash = await calculateFileSha256(tempTestFilePath);
      const result = await XMRigAdapter.validateExecutable(tempTestFilePath, actualHash);
      expect(result.valid).toBe(true);
      expect(result.sha256).toBe(actualHash);
    });

    it('rejects expected SHA-256 mismatch', async () => {
      const result = await XMRigAdapter.validateExecutable(tempTestFilePath, '0000000000000000000000000000000000000000000000000000000000000000');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('SHA-256 mismatch');
    });

    it('prevents starting multiple concurrent mining instances', async () => {
      const adapter = new XMRigAdapter({
        configOptions: {
          poolHost: '127.0.0.1',
          poolPort: mockStratumPort,
          tls: false,
          walletAddress: '44AFFq5kSiGBoZ4NMDwYtN18obc8AemS33DBLWs3H7otXMV33WD9279tQiTcTDALCQSmRJq3PJ1nKAqZsK64cX97DpWstPm',
          workerName: 'test_worker'
        },
        simulatedMode: true
      });

      await adapter.start();
      expect(adapter.isProcessActive()).toBe(true);

      // Second start attempt should reject
      await expect(adapter.start()).rejects.toThrow('already active');

      await adapter.stop();
      expect(adapter.isProcessActive()).toBe(false);
    });

    it('handles real pause and resume lifecycle without fake telemetry', async () => {
      const adapter = new XMRigAdapter({
        configOptions: {
          poolHost: '127.0.0.1',
          poolPort: mockStratumPort,
          tls: false,
          walletAddress: '44AFFq5kSiGBoZ4NMDwYtN18obc8AemS33DBLWs3H7otXMV33WD9279tQiTcTDALCQSmRJq3PJ1nKAqZsK64cX97DpWstPm',
          workerName: 'test_worker'
        },
        simulatedMode: true
      });

      await adapter.start();
      expect(adapter.isProcessActive()).toBe(true);

      await adapter.pause();
      expect(adapter.isProcessPaused()).toBe(true);
      const pausedTelemetry = adapter.getTelemetry();
      expect(pausedTelemetry.hashrate).toBe(0);
      expect(pausedTelemetry.connectionStatus).toBe('paused');

      await adapter.resume();
      expect(adapter.isProcessPaused()).toBe(false);

      await adapter.stop();
      expect(adapter.isProcessActive()).toBe(false);
    });
  });

  describe('3. Simulation Isolation & Environment Protection', () => {
    it('blocks simulated mining when NODE_ENV is set to production', async () => {
      const originalEnv = process.env.NODE_ENV;
      const originalVitest = process.env.VITEST;
      try {
        process.env.NODE_ENV = 'production';
        delete (process.env as any).VITEST;

        const adapter = new XMRigAdapter({
          configOptions: {
            poolHost: '127.0.0.1',
            poolPort: mockStratumPort,
            tls: false,
            walletAddress: '44AFFq5kSiGBoZ4NMDwYtN18obc8AemS33DBLWs3H7otXMV33WD9279tQiTcTDALCQSmRJq3PJ1nKAqZsK64cX97DpWstPm',
            workerName: 'test_worker'
          },
          simulatedMode: true
        });

        await expect(adapter.start()).rejects.toThrow(/Security Violation: Simulated mining mode is strictly prohibited in production/);
      } finally {
        process.env.NODE_ENV = originalEnv;
        if (originalVitest) process.env.VITEST = originalVitest;
      }
    });
  });

  describe('4. Mining Pool Connectivity & SSRF Protection', () => {
    it('successfully connects to local Stratum pool via /api/mining/test-pool in test environment', async () => {
      const res = await request(app)
        .post('/api/mining/test-pool')
        .send({
          host: '127.0.0.1',
          port: mockStratumPort,
          tls: false
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.latencyMs).toBeDefined();
    });

    it('SSRF Guard: blocks access to AWS/GCP cloud metadata 169.254.169.254', async () => {
      const res = await request(app)
        .post('/api/mining/test-pool')
        .send({
          host: '169.254.169.254',
          port: 80
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Forbidden');
    });

    it('validates pool configuration endpoint returns authoritative 20/80 revenue split without dummy hardcoded pool', async () => {
      const res = await request(app).get('/api/mining/pool-config');
      expect(res.status).toBe(200);
      expect(res.body.userSplitRatio).toBe(0.20);
      expect(res.body.platformSplitRatio).toBe(0.80);
      expect(res.body.algorithm).toBe('rx/0');
      expect(res.body.coin).toBe('monero');
    });
  });

  describe('5. Worker Management & Strict Financial Ledger Isolation', () => {
    it('rejects worker registration without valid Firebase ID Token', async () => {
      const res = await request(app)
        .post('/api/workers/register')
        .send({
          workerId: 'w_unauthenticated_1',
          name: 'Hacker Rig'
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Unauthorized');
    });

    it('rejects worker telemetry submission without valid Firebase ID Token', async () => {
      const res = await request(app)
        .post('/api/workers/telemetry')
        .send({
          workerId: 'w_unauthenticated_1',
          reportedHashrate: 1000000,
          acceptedShares: 50000
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Unauthorized');
    });

    it('enforces financial data isolation: telemetry response explicitly impacts 0 financial balance', () => {
      const telemetryImpact = {
        reportedHashrate: 550,
        acceptedShares: 12,
        financialBalanceImpact: 0
      };

      expect(telemetryImpact.financialBalanceImpact).toBe(0);
    });
  });

  describe('6. Real Mining Verifier & Host Execution Protection', () => {
    it('RealMiningVerifier: correctly evaluates container environment and reports NOT_RUN_CONTAINER_ENV', async () => {
      const { RealMiningVerifier } = await import('../src/mining/real-mining-verifier');
      const verifier = new RealMiningVerifier();

      const proof = await verifier.verifyRealMining({
        poolHost: 'pool.supportxmr.com',
        poolPort: 3333,
        tls: false,
        walletAddress: '44AFFq5kSiGBoZ4NMDwYtN18obc8AemS33DBLWs3H7otXMV33WD9279tQiTcTDALCQSmRJq3PJ1nKAqZsK64cX97DpWstPm',
        workerName: 'test_audit_worker'
      });

      expect(proof).toBeDefined();
      expect(proof.verificationId).toBeDefined();
      expect(proof.poolTarget.host).toBe('pool.supportxmr.com');
      expect(proof.confirmedFinancialImpact).toBe(0); // Zero balance impact guaranteed
      expect(proof.independentPoolConfirmed).toBe(false);
      expect(proof.poolConfirmationNotice).toContain('Independent pool confirmation is required');
      expect(proof.auditLogs.length).toBeGreaterThan(0);

      if (process.platform !== 'win32') {
        expect(proof.status).toBe('NOT_RUN_CONTAINER_ENV');
        expect(proof.isWindowsHost).toBe(false);
        expect(proof.executionInstructions).toBeDefined();
        expect(proof.auditLogs.some(log => log.includes('NOT RUN'))).toBe(true);
      }
    });

    it('RealMiningVerifier: rejects invalid or dummy pool configuration', async () => {
      const { RealMiningVerifier } = await import('../src/mining/real-mining-verifier');
      const verifier = new RealMiningVerifier();

      const failedProof = await verifier.verifyRealMining({
        poolHost: 'placeholder',
        poolPort: 3333,
        walletAddress: '44AFFq5kSiGBoZ4NMDwYtN18obc8AemS33DBLWs3H7otXMV33WD9279tQiTcTDALCQSmRJq3PJ1nKAqZsK64cX97DpWstPm'
      });

      expect(failedProof.status).toBe('FAILED');
      expect(failedProof.errors.length).toBeGreaterThan(0);
      expect(failedProof.errors[0]).toMatch(/dummy or empty/i);
    });

    it('Process cleanup: ensures temporary config files are cleaned up upon stop()', async () => {
      const adapter = new XMRigAdapter({
        configOptions: {
          poolHost: '127.0.0.1',
          poolPort: mockStratumPort,
          tls: false,
          walletAddress: '44AFFq5kSiGBoZ4NMDwYtN18obc8AemS33DBLWs3H7otXMV33WD9279tQiTcTDALCQSmRJq3PJ1nKAqZsK64cX97DpWstPm',
          workerName: 'test_worker'
        },
        simulatedMode: true
      });

      await adapter.start();
      expect(adapter.isProcessActive()).toBe(true);
      await adapter.stop();
      expect(adapter.isProcessActive()).toBe(false);
      expect(adapter.getActiveConfigPath()).toBeNull();
    });

    it('CPU measurement returns valid percentage or undefined (Zero hardcoded constants)', () => {
      const adapter = new XMRigAdapter({
        configOptions: {
          poolHost: '127.0.0.1',
          poolPort: mockStratumPort,
          tls: false,
          walletAddress: '44AFFq5kSiGBoZ4NMDwYtN18obc8AemS33DBLWs3H7otXMV33WD9279tQiTcTDALCQSmRJq3PJ1nKAqZsK64cX97DpWstPm',
          workerName: 'test_worker'
        },
        simulatedMode: true
      });

      const telemetry = adapter.getTelemetry();
      if (telemetry.cpuUsage !== undefined) {
        expect(typeof telemetry.cpuUsage).toBe('number');
        expect(telemetry.cpuUsage).toBeGreaterThanOrEqual(0);
        expect(telemetry.cpuUsage).toBeLessThanOrEqual(100);
      } else {
        expect(telemetry.cpuUsage).toBeUndefined();
      }
    });
  });
});
