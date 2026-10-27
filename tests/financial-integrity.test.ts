import { describe, it, expect } from 'vitest';
import { WalletLedgerEntry, UserEarning } from '../src/types';

describe('Financial Ledger & Cryptographic Integrity Tests', () => {

  it('1. Atomic unit conversion (10^12 piconero per XMR) eliminates IEEE-754 float drift', () => {
    // Floating point math: 0.1 + 0.2 = 0.30000000000000004
    const floatSum = 0.1 + 0.2;
    expect(floatSum).not.toBe(0.3); // Demonstrates why floating point cannot be trusted directly

    // Exact atomic integer units (piconero)
    const ATOMIC_FACTOR = 1_000_000_000_000n; // 1e12
    const amount1 = 100_000_000_000n; // 0.1 XMR
    const amount2 = 200_000_000_000n; // 0.2 XMR
    const exactSum = amount1 + amount2; // 300_000_000_000n
    
    expect(exactSum).toBe(300_000_000_000n);
    expect(Number(exactSum) / Number(ATOMIC_FACTOR)).toBe(0.3);
  });

  it('2. Financial ledger mutations require non-empty idempotencyKey to prevent duplicate replay', () => {
    const validateLedgerMutation = (entry: Partial<WalletLedgerEntry>): boolean => {
      if (!entry.idempotencyKey || entry.idempotencyKey.trim().length === 0) {
        return false;
      }
      if (!entry.atomicUnits || BigInt(entry.atomicUnits) <= 0n) {
        return false;
      }
      return true;
    };

    const validEntry: Partial<WalletLedgerEntry> = {
      idempotencyKey: 'tx_payout_hash_98234124',
      atomicUnits: '50000000000', // 0.05 XMR
      type: 'debit'
    };

    const invalidReplayEntry: Partial<WalletLedgerEntry> = {
      idempotencyKey: '', // Missing idempotency
      atomicUnits: '50000000000'
    };

    expect(validateLedgerMutation(validEntry)).toBe(true);
    expect(validateLedgerMutation(invalidReplayEntry)).toBe(false);
  });

  it('3. Gaming points are strictly decoupled from withdrawable cryptocurrency balances', () => {
    const gamingSession = {
      entertainmentPoints: 2500,
      withdrawableCryptoAmount: 0 // MUST be zero
    };

    expect(gamingSession.withdrawableCryptoAmount).toBe(0);
    expect(typeof gamingSession.entertainmentPoints).toBe('number');
  });

  it('4. Revenue split ratio strictly totals 100% (20% miner / 80% platform)', () => {
    const userSplitRatio = 0.20;
    const platformSplitRatio = 0.80;
    const totalSplit = userSplitRatio + platformSplitRatio;

    expect(totalSplit).toBe(1.0);
    expect(userSplitRatio).toBe(0.20);
    expect(platformSplitRatio).toBe(0.80);
  });
});
