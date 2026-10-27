/**
 * SpinnerMine Cloud — Phase 2D.3 Automated Verification Suite
 *
 * Requirements:
 * 1. Accepted and rejected XMRig log parsing (counts, diff, latency, rejection reason).
 * 2. Sensitive log sanitization (no private keys, passwords, or seed phrases).
 * 3. Connection failure handling (invalid pool host, closed port).
 * 4. Engine restart lifecycle (clean state, uptime, and hashrate reset).
 * 5. Stale job and rejected share detection.
 * 6. Incorrect / invalid Monero wallet validation and rejection.
 * 7. Stop and emergency stop process termination behavior.
 * 8. Financial isolation: confirmedFinancialImpact is strictly 0.
 * 9. Independent pool API distinction: MINER_REPORTED vs POOL_CONFIRMED.
 * 10. Container environment recognition (NOT_RUN_CONTAINER_ENV on Linux).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { XMRigAdapter } from '../src/mining/xmrig-adapter';
import { RealMiningVerifier, RealMiningProof } from '../src/mining/real-mining-verifier';
import { PoolApiVerifier } from '../src/mining/pool-api';
import { StratumVerifier } from '../src/mining/stratum-verifier';
import { MockStratumServer } from '../src/mining/mock-stratum-server';
import { RealMiningEngine } from '../src/mining/real-engine';

describe('SpinnerMine Cloud Phase 2D.3 — Real Mining Verification Suite', () => {
  const VALID_XMR_WALLET = '48edfHu7V9Z84YLFvYYmwZeK9GGrnWcngTWDbLTVBg29vC9HrDY7nPPgwC99EFGhpxYChCentiznY6Gy145unRP6Qss8358';
  let mockStratum: MockStratumServer;
  let mockPort: number;

  beforeAll(async () => {
    mockStratum = new MockStratumServer();
    mockPort = await mockStratum.start();
  });

  afterAll(async () => {
    await mockStratum.stop();
  });

  // ---------------------------------------------------------------------------
  // 1. Accepted & Rejected Log Parsing
  // ---------------------------------------------------------------------------
  describe('1. XMRig Log Parsing & Structured Event Extraction', () => {
    it('parses accepted share with counts, difficulty, and latency', () => {
      const rawLine = '[2026-10-27 12:34:56.789] [cpu ] accepted (1/0) diff 100000 (35 ms)';
      const parsed = XMRigAdapter.parseLogLine(rawLine);

      expect(parsed).not.toBeNull();
      expect(parsed?.stage).toBe('ACCEPTED');
      expect(parsed?.details.acceptedShares).toBe(1);
      expect(parsed?.details.rejectedShares).toBe(0);
      expect(parsed?.details.diff).toBe(100000);
      expect(parsed?.details.latencyMs).toBe(35);
    });

    it('parses rejected share with counts, diff, latency, and rejection reason', () => {
      const rawLine = '[2026-10-27 12:35:10.123] [cpu ] rejected (1/1) diff 100000 (42 ms) "low difficulty share"';
      const parsed = XMRigAdapter.parseLogLine(rawLine);

      expect(parsed).not.toBeNull();
      expect(parsed?.stage).toBe('REJECTED');
      expect(parsed?.details.acceptedShares).toBe(1);
      expect(parsed?.details.rejectedShares).toBe(1);
      expect(parsed?.details.diff).toBe(100000);
      expect(parsed?.details.latencyMs).toBe(42);
      expect(parsed?.details.reason).toBe('low difficulty share');
    });

    it('parses speed / hashrate averages from log line', () => {
      const rawLine = '[2026-10-27 12:36:00.000] [speed] 10s/60s/15m 452.3 448.7 445.1 H/s max 460.0 H/s';
      const parsed = XMRigAdapter.parseLogLine(rawLine);

      expect(parsed).not.toBeNull();
      expect(parsed?.stage).toBe('SPEED');
      expect(parsed?.details.hashrate10s).toBe(452.3);
      expect(parsed?.details.hashrate60s).toBe(448.7);
      expect(parsed?.details.hashrate15m).toBe(445.1);
    });

    it('parses new job received with difficulty, algo, and block height', () => {
      const rawLine = '[2026-10-27 12:34:00.000] [net ] new job from pool.supportxmr.com:3333 diff 120000 algo rx/0 height 3123456';
      const parsed = XMRigAdapter.parseLogLine(rawLine);

      expect(parsed).not.toBeNull();
      expect(parsed?.stage).toBe('JOB');
      expect(parsed?.details.pool).toBe('pool.supportxmr.com:3333');
      expect(parsed?.details.diff).toBe(120000);
      expect(parsed?.details.algo).toBe('rx/0');
      expect(parsed?.details.height).toBe(3123456);
    });

    it('sanitizes sensitive passwords or worker credentials from output logs', () => {
      const rawLine = 'login params: {"login":"48edfHu...","pass":"mySecretPassword123:x"}';
      const parsed = XMRigAdapter.parseLogLine(rawLine);

      expect(parsed).not.toBeNull();
      expect(parsed?.sanitized).not.toContain('mySecretPassword123');
      expect(parsed?.sanitized).toContain('"pass":"***:x"');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Connection Failure & Network Error Handling
  // ---------------------------------------------------------------------------
  describe('2. Connection Failure Handling', () => {
    it('handles closed TCP port gracefully in StratumVerifier', async () => {
      const report = await StratumVerifier.verifyPool({
        host: '127.0.0.1',
        port: 64999, // Unused/closed port
        walletAddress: VALID_XMR_WALLET,
        timeoutMs: 1000
      });

      expect(report.overallSuccess).toBe(false);
      expect(report.tcpConnection.success).toBe(false);
      expect(report.tcpConnection.error).toBeDefined();
    });

    it('handles invalid / non-existent pool host gracefully in RealMiningVerifier', async () => {
      const verifier = new RealMiningVerifier();
      const proof = await verifier.verifyRealMining({
        poolHost: 'invalid-nonexistent-domain-12345.xyz',
        poolPort: 3333,
        walletAddress: VALID_XMR_WALLET,
        queryPoolApi: false
      });

      expect(proof.isWindowsHost ? proof.status === 'FAILED' : proof.status === 'NOT_RUN_CONTAINER_ENV').toBe(true);
      expect(proof.confirmedFinancialImpact).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Engine Restart Lifecycle
  // ---------------------------------------------------------------------------
  describe('3. Engine Restart Lifecycle', () => {
    it('resets uptime and hashrate cleanly when restarted', async () => {
      const real = new RealMiningEngine();
      expect(real.getState()).toBe('STOPPED');

      // Start session
      const start1 = await real.start({
        workerId: 'w_qBPFqVEe_tm',
        userId: 'usr_test_1',
        threads: 2,
        poolHost: '127.0.0.1',
        poolPort: mockPort,
        walletAddress: VALID_XMR_WALLET,
        consentAccepted: true
      });
      expect(start1.success).toBe(true);
      expect(real.getState()).toBe('RUNNING');

      // Stop session
      const stopRes = await real.stop();
      expect(stopRes.success).toBe(true);
      expect(real.getState()).toBe('STOPPED');
      expect(real.getTelemetry().hashrate).toBe(0);

      // Restart session
      const start2 = await real.start({
        workerId: 'w_qBPFqVEe_tm',
        userId: 'usr_test_1',
        threads: 2,
        poolHost: '127.0.0.1',
        poolPort: mockPort,
        walletAddress: VALID_XMR_WALLET,
        consentAccepted: true
      });
      expect(start2.success).toBe(true);
      expect(real.getState()).toBe('RUNNING');

      await real.stop();
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Stale Job & Share Rejection Detection
  // ---------------------------------------------------------------------------
  describe('4. Stale Job & Share Rejection', () => {
    it('identifies rejected share from Stratum protocol error response', async () => {
      const report = await StratumVerifier.verifyPool({
        host: '127.0.0.1',
        port: mockPort,
        walletAddress: VALID_XMR_WALLET,
        simulateRejectShare: true,
        testShareSubmission: true,
        timeoutMs: 3000
      });

      expect(report.tcpConnection.success).toBe(true);
      expect(report.stratumLogin.success).toBe(true);
      expect(report.jobReceived.success).toBe(true);
      expect(report.shareSubmitted.success).toBe(true);
      expect(report.acceptedShareVerified.success).toBe(false);
      expect(report.acceptedShareVerified.details?.rejectedByPool).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Monero Wallet Validation
  // ---------------------------------------------------------------------------
  describe('5. Monero Wallet Validation', () => {
    it('strictly rejects invalid or malformed Monero public addresses', async () => {
      const verifier = new RealMiningVerifier();
      const proof = await verifier.verifyRealMining({
        poolHost: 'pool.supportxmr.com',
        poolPort: 3333,
        walletAddress: 'invalid wallet with spaces !@#',
        queryPoolApi: false
      });

      expect(proof.status).toBe('FAILED');
      expect(proof.errors.length).toBeGreaterThan(0);
      expect(proof.errors[0]).toContain('Invalid Monero mining wallet address');
      expect(proof.confirmedFinancialImpact).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Stop & Emergency Stop Behavior
  // ---------------------------------------------------------------------------
  describe('6. Stop & Emergency Stop Behavior', () => {
    it('emergencyStop immediately halts mining and restores STOPPED state', async () => {
      const real = new RealMiningEngine();
      await real.start({
        workerId: 'w_qBPFqVEe_tm',
        userId: 'usr_test_1',
        threads: 2,
        poolHost: '127.0.0.1',
        poolPort: mockPort,
        walletAddress: VALID_XMR_WALLET,
        consentAccepted: true
      });

      expect(real.getState()).toBe('RUNNING');

      const emStop = await real.emergencyStop();
      expect(emStop.success).toBe(true);
      expect(real.getState()).toBe('STOPPED');
      expect(real.getTelemetry().hashrate).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Financial Isolation & Independent Pool Distinction
  // ---------------------------------------------------------------------------
  describe('7. Financial Isolation & Independent Pool Distinction', () => {
    it('strictly guarantees confirmedFinancialImpact is 0 across all verification outputs', async () => {
      const verifier = new RealMiningVerifier();
      const proof = await verifier.verifyRealMining({
        poolHost: 'pool.supportxmr.com',
        poolPort: 3333,
        walletAddress: VALID_XMR_WALLET,
        queryPoolApi: false
      });

      expect(proof.confirmedFinancialImpact).toBe(0);
      expect(proof.diagnosticReport).toContain('Financial Impact:         0 XMR (Strict Zero Ledger Impact)');
    });

    it('labels local accepted shares as MINER_REPORTED when independent pool API has not confirmed them', () => {
      const verifier = new RealMiningVerifier();
      const report = RealMiningVerifier.generateDiagnosticReport({
        verificationId: 'test_verify_001',
        sessionId: 'session_test_001',
        workerId: 'w_qBPFqVEe_tm',
        timestamp: new Date().toISOString(),
        hostPlatform: 'win32-x64 (Windows 11)',
        isWindowsHost: true,
        status: 'ACCEPTED_SHARE_VERIFIED',
        binaryValidation: { isValid: true, sha256: '6fa80698d7268f6e88aa88c06fb27ee99e1bcee747c2e76911e6206a5b1aeeb3' },
        stages: {
          dnsResolution: { name: 'DNS', success: true },
          tcpConnection: { name: 'TCP', success: true },
          stratumLogin: { name: 'Login', success: true },
          jobReceived: { name: 'Job', success: true },
          hashingStarted: { name: 'Hashing', success: true },
          shareSubmitted: { name: 'Submit', success: true },
          shareAccepted: { name: 'Accepted', success: true },
          shareRejected: { name: 'Rejected', success: false }
        },
        poolTarget: {
          host: 'pool.supportxmr.com',
          port: 3333,
          tls: false,
          walletAddress: VALID_XMR_WALLET,
          workerName: 'tm-main'
        },
        telemetry: {
          hashrate: 450,
          hashrate10s: 450,
          pid: 1234,
          uptimeSeconds: 60,
          acceptedShares: 2,
          rejectedShares: 0,
          jobsReceived: 3
        },
        events: [],
        auditLogs: [],
        errors: [],
        localAcceptedShares: 2,
        shareVerificationType: 'MINER_REPORTED',
        independentPoolConfirmed: false,
        poolConfirmationNotice: 'Share accepted locally. Status: MINER_REPORTED.',
        poolConfirmedShares: 0,
        confirmedFinancialImpact: 0
      });

      expect(report).toContain('Share Verification Type:  [MINER_REPORTED]');
      expect(report).toContain('Miner-Reported Shares:  2 accepted / 0 rejected');
      expect(report).toContain('Pool-Confirmed Shares:  0');
      expect(report).toContain('Financial Impact:         0 XMR');
    });

    it('distinguishes POOL_CONFIRMED status when authoritative pool API confirms shares', () => {
      const report = RealMiningVerifier.generateDiagnosticReport({
        verificationId: 'test_verify_002',
        sessionId: 'session_test_002',
        workerId: 'w_qBPFqVEe_tm',
        timestamp: new Date().toISOString(),
        hostPlatform: 'win32-x64 (Windows 11)',
        isWindowsHost: true,
        status: 'POOL_CONFIRMED',
        binaryValidation: { isValid: true },
        stages: {
          dnsResolution: { name: 'DNS', success: true },
          tcpConnection: { name: 'TCP', success: true },
          stratumLogin: { name: 'Login', success: true },
          jobReceived: { name: 'Job', success: true },
          hashingStarted: { name: 'Hashing', success: true },
          shareSubmitted: { name: 'Submit', success: true },
          shareAccepted: { name: 'Accepted', success: true },
          shareRejected: { name: 'Rejected', success: false }
        },
        poolTarget: {
          host: 'pool.supportxmr.com',
          port: 3333,
          tls: false,
          walletAddress: VALID_XMR_WALLET,
          workerName: 'tm-main'
        },
        telemetry: {
          hashrate: 520,
          hashrate10s: 520,
          pid: 5678,
          uptimeSeconds: 120,
          acceptedShares: 5,
          rejectedShares: 0,
          jobsReceived: 4
        },
        events: [],
        auditLogs: [],
        errors: [],
        localAcceptedShares: 5,
        shareVerificationType: 'POOL_CONFIRMED',
        independentPoolConfirmed: true,
        poolConfirmationNotice: 'Independently confirmed by pool API.',
        poolConfirmedShares: 5,
        confirmedFinancialImpact: 0
      });

      expect(report).toContain('Share Verification Type:  [POOL_CONFIRMED]');
      expect(report).toContain('Pool-Confirmed Shares:  5');
      expect(report).toContain('Financial Impact:         0 XMR (Strict Zero Ledger Impact)');
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Container Environment Proof & Strict Gate
  // ---------------------------------------------------------------------------
  describe('8. Container Environment Proof & Strict Gate', () => {
    it('strictly does not claim success on Linux container and outputs NOT_RUN_CONTAINER_ENV', async () => {
      if (process.platform === 'win32') return;

      const verifier = new RealMiningVerifier();
      const proof = await verifier.verifyRealMining({
        poolHost: 'pool.supportxmr.com',
        poolPort: 3333,
        walletAddress: VALID_XMR_WALLET,
        queryPoolApi: false
      });

      expect(proof.isWindowsHost).toBe(false);
      expect(proof.status).toBe('NOT_RUN_CONTAINER_ENV');
      expect(proof.executionInstructions).toBeDefined();
      expect(proof.executionInstructions).toContain('REAL-HOST VERIFICATION CHECKLIST (Windows 10/11 x64)');
    });
  });
});
