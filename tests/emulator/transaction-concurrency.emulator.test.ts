import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { adminDb } from '../../server';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Transaction Concurrency Emulator Integration Test
 *
 * Runs concurrent transactions directly against the Firestore Emulator to verify
 * that atomic write locks and optimistic concurrency prevent duplicate replay execution.
 */

const isEmulatorActive = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

if (process.env.CI && !isEmulatorActive) {
  throw new Error('FATAL: CI is active but FIRESTORE_EMULATOR_HOST is not defined. Firebase Emulator tests must not be skipped!');
}

describe.skipIf(!isEmulatorActive)('Firebase Emulator Suite: Transaction Concurrency & Replay Protection', () => {
  let testEnv: RulesTestEnvironment;
  const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'spinnermine-ci-test';

  beforeAll(async () => {
    const rulesContent = fs.readFileSync(path.resolve('firestore.rules'), 'utf8');
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: rulesContent,
        host: process.env.FIRESTORE_EMULATOR_HOST?.split(':')[0] || '127.0.0.1',
        port: Number(process.env.FIRESTORE_EMULATOR_HOST?.split(':')[1] || 8080),
      },
    });
  });

  afterAll(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  beforeEach(async () => {
    if (testEnv) {
      await testEnv.clearFirestore();
    }
  });

  it('1. Emulator Concurrency: Atomic transaction with identical nonce accepts exactly 1 and rejects duplicate', async () => {
    const uniqueSuffix = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const userId = `player_emu_concurrency_${uniqueSuffix}`;
    const nonce = `emu_nonce_fixed_${uniqueSuffix}`;
    const operationKey = `${userId}_wheel_${nonce}`;

    let successfulTransactions = 0;
    let rejectedTransactions = 0;

    const executeAtomicSpin = async () => {
      try {
        await adminDb.runTransaction(async (transaction) => {
          const nonceRef = adminDb.collection('usedNonces').doc(operationKey);
          const userArcadeRef = adminDb.collection('userArcade').doc(userId);

          const nonceDoc = await transaction.get(nonceRef);
          if (nonceDoc.exists) {
            throw new Error('REPLAY_DETECTED: Nonce already consumed');
          }

          // Read current arcade doc
          const arcadeDoc = await transaction.get(userArcadeRef);
          const currentPoints = arcadeDoc.exists ? arcadeDoc.data()?.totalArcadePoints || 0 : 0;

          // Commit atomic writes with create (enforcing unique creation)
          transaction.create(nonceRef, {
            nonce,
            userId,
            consumedAt: new Date().toISOString(),
          });

          transaction.set(userArcadeRef, {
            userId,
            totalArcadePoints: currentPoints + 100,
            updatedAt: new Date().toISOString(),
          }, { merge: true });
        });
        successfulTransactions++;
      } catch (err: any) {
        if (
          err.message?.includes('REPLAY_DETECTED') || 
          err.code === 6 || 
          err.message?.includes('ALREADY_EXISTS') || 
          err.message?.includes('already exists')
        ) {
          rejectedTransactions++;
        } else {
          throw err;
        }
      }
    };

    // Execute 2 concurrent transactions simultaneously
    await Promise.all([executeAtomicSpin(), executeAtomicSpin()]);

    expect(successfulTransactions).toBe(1);
    expect(rejectedTransactions).toBe(1);

    // Verify final stored points is strictly 100 (never doubled to 200)
    const finalArcadeDoc = await adminDb.collection('userArcade').doc(userId).get();
    expect(finalArcadeDoc.data()?.totalArcadePoints).toBe(100);

    // Verify exactly one nonce document exists
    const nonceDocSnapshot = await adminDb.collection('usedNonces').doc(operationKey).get();
    expect(nonceDocSnapshot.exists).toBe(true);
  });

  it('2. Emulator Concurrency: Transaction retry on contention preserves final consistency', async () => {
    const uniqueSuffix = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const userId = `player_emu_retry_${uniqueSuffix}`;
    const userArcadeRef = adminDb.collection('userArcade').doc(userId);

    // Initial state
    await userArcadeRef.set({ userId, totalArcadePoints: 0 });

    // Run multiple independent transactions (different nonces) concurrently
    // Firestore transactions automatically retry upon optimistic lock contention
    const nonces = [`nonce_1_${uniqueSuffix}`, `nonce_2_${uniqueSuffix}`, `nonce_3_${uniqueSuffix}`];

    await Promise.all(
      nonces.map(async (nonce) => {
        await adminDb.runTransaction(async (transaction) => {
          const nonceRef = adminDb.collection('usedNonces').doc(`${userId}_wheel_${nonce}`);
          const nonceDoc = await transaction.get(nonceRef);
          if (nonceDoc.exists) throw new Error('Duplicate');

          const arcadeDoc = await transaction.get(userArcadeRef);
          const currentPoints = arcadeDoc.exists ? arcadeDoc.data()?.totalArcadePoints || 0 : 0;

          transaction.create(nonceRef, { nonce, userId });
          transaction.set(userArcadeRef, { totalArcadePoints: currentPoints + 50 }, { merge: true });
        });
      })
    );

    // Verify all 3 independent transactions succeeded with retry contention handling
    const finalArcadeDoc = await userArcadeRef.get();
    expect(finalArcadeDoc.data()?.totalArcadePoints).toBe(150);
  });
});
