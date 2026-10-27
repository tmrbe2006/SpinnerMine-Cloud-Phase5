import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import { initializeTestEnvironment, RulesTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import fs from 'fs';
import path from 'path';

/**
 * SpinnerMine Cloud - Real Firebase Emulator Suite Test Runner
 *
 * This test suite utilizes `@firebase/rules-unit-testing` against the real `firestore.rules` file.
 * It connects directly to the Firestore Emulator (default 127.0.0.1:8080) when running.
 * If the Java-based Firebase Emulator daemon is not active in this container environment,
 * these tests are safely conditionally skipped in local Vitest runs and execute in CI/local machines
 * equipped with the Firebase Emulator Suite.
 */

const isEmulatorActive = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

if (process.env.CI && !isEmulatorActive) {
  throw new Error('FATAL: CI is active but FIRESTORE_EMULATOR_HOST is not defined. Firebase Emulator tests must not be skipped!');
}

describe.skipIf(!isEmulatorActive)('Firebase Emulator Suite: Real firestore.rules Integration', () => {
  let testEnv: RulesTestEnvironment;
  const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'spinnermine-ci-test';

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

  it('1. Emulator: Non-admin user cannot promote themselves to admin on create or update', async () => {
    const aliceContext = testEnv.authenticatedContext('alice', { email: 'alice@example.com' });
    const aliceDb = aliceContext.firestore();

    // Alice attempts to create her user profile with role: 'admin'
    await assertFails(
      aliceDb.collection('users').doc('alice').set({
        uid: 'alice',
        email: 'alice@example.com',
        role: 'admin',
        createdAt: new Date().toISOString(),
      })
    );

    // Legitimate creation with role: 'user' succeeds
    await assertSucceeds(
      aliceDb.collection('users').doc('alice').set({
        uid: 'alice',
        email: 'alice@example.com',
        role: 'user',
        displayName: 'Alice Cooper',
        language: 'en',
        theme: 'dark',
        miningConsent: false,
        referralCode: 'ALICE123',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    );

    // Alice attempts to update her role from 'user' to 'admin'
    await assertFails(
      aliceDb.collection('users').doc('alice').update({
        role: 'admin',
      })
    );
  });

  it('2. Emulator: Client writes to walletLedger and miningRevenue are strictly blocked', async () => {
    const aliceContext = testEnv.authenticatedContext('alice');
    const aliceDb = aliceContext.firestore();

    // Alice attempts direct credit to wallet ledger
    await assertFails(
      aliceDb.collection('walletLedger').doc('fraudulent_entry').set({
        userId: 'alice',
        type: 'credit',
        amount: 100.5,
        currency: 'XMR',
        timestamp: new Date().toISOString(),
      })
    );

    // Alice attempts to write mining revenue
    await assertFails(
      aliceDb.collection('miningRevenue').doc('fraudulent_revenue').set({
        grossRevenue: 5000,
        currency: 'XMR',
        timestamp: new Date().toISOString(),
      })
    );
  });

  it('3. Emulator: Direct browser writes to spinnerSessions, wheelSpins, and userArcade are blocked', async () => {
    const aliceContext = testEnv.authenticatedContext('alice');
    const aliceDb = aliceContext.firestore();

    // Direct write to spinnerSessions
    await assertFails(
      aliceDb.collection('spinnerSessions').doc('fake_session').set({
        userId: 'alice',
        duration: 60,
        entertainmentPoints: 99999,
        verified: true,
      })
    );

    // Direct write to wheelSpins
    await assertFails(
      aliceDb.collection('wheelSpins').doc('fake_spin').set({
        userId: 'alice',
        segmentLanded: 4,
        rewardValue: '500',
        claimed: true,
      })
    );

    // Direct write to userArcade points ledger
    await assertFails(
      aliceDb.collection('userArcade').doc('alice').set({
        userId: 'alice',
        totalArcadePoints: 1000000,
      })
    );
  });

  it('4. Emulator: User data isolation prevents Bob from reading Alice profile or earnings', async () => {
    // Seed Alice profile using admin context
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().collection('users').doc('alice').set({
        uid: 'alice',
        email: 'alice@example.com',
        role: 'user',
        displayName: 'Alice',
      });
      await context.firestore().collection('userEarnings').doc('alice_earning').set({
        userId: 'alice',
        amount: 5,
        currency: 'XMR',
      });
    });

    const bobContext = testEnv.authenticatedContext('bob');
    const bobDb = bobContext.firestore();

    // Bob cannot read Alice profile
    await assertFails(bobDb.collection('users').doc('alice').get());

    // Bob cannot read Alice earnings
    await assertFails(bobDb.collection('userEarnings').doc('alice_earning').get());

    // Alice can read her own profile
    const aliceContext = testEnv.authenticatedContext('alice');
    await assertSucceeds(aliceContext.firestore().collection('users').doc('alice').get());
  });

  it('5. Emulator: Ordinary user cannot read auditLogs or detailed platform miningRevenue', async () => {
    // Seed audit log and platform revenue with admin context
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().collection('auditLogs').doc('log_1').set({
        action: 'system_payout',
        actor: 'admin_server',
        timestamp: new Date().toISOString(),
      });
      await context.firestore().collection('miningRevenue').doc('revenue_1').set({
        grossRevenue: 1000,
        platformShare: 800,
        currency: 'XMR',
      });
    });

    const userContext = testEnv.authenticatedContext('normal_user');
    const userDb = userContext.firestore();

    // Normal user read to auditLogs is blocked
    await assertFails(userDb.collection('auditLogs').doc('log_1').get());

    // Normal user read to detailed platform miningRevenue is blocked
    await assertFails(userDb.collection('miningRevenue').doc('revenue_1').get());

    // Admin context can read auditLogs and miningRevenue
    const adminContext = testEnv.authenticatedContext('admin_user', { admin: true });
    await assertSucceeds(adminContext.firestore().collection('auditLogs').doc('log_1').get());
    await assertSucceeds(adminContext.firestore().collection('miningRevenue').doc('revenue_1').get());
  });

  it('6. Emulator: Client cannot write to acceptedShares (trusted daemon only)', async () => {
    const aliceContext = testEnv.authenticatedContext('alice');
    const aliceDb = aliceContext.firestore();

    await assertFails(
      aliceDb.collection('acceptedShares').doc('share_fake').set({
        userId: 'alice',
        difficulty: 100000,
        timestamp: new Date().toISOString(),
      })
    );
  });

  it('7. Emulator: User can read legacy and archived workers, and link installationId without altering acceptedShares', async () => {
    // Seed legacy worker 'tm' (no installationId) and archived worker 'ty' for alice
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('miningWorkers').doc('w_alice_tm').set({
        workerId: 'w_alice_tm',
        userId: 'alice',
        name: 'tm',
        status: 'online',
        acceptedShares: 48,
        createdAt: new Date().toISOString()
      });
      await db.collection('miningWorkers').doc('w_alice_ty').set({
        workerId: 'w_alice_ty',
        userId: 'alice',
        name: 'ty',
        status: 'archived',
        isArchived: true,
        acceptedShares: 12,
        createdAt: new Date().toISOString()
      });
    });

    const aliceContext = testEnv.authenticatedContext('alice');
    const aliceDb = aliceContext.firestore();

    // Alice can read legacy worker tm
    await assertSucceeds(aliceDb.collection('miningWorkers').doc('w_alice_tm').get());

    // Alice can read archived worker ty
    await assertSucceeds(aliceDb.collection('miningWorkers').doc('w_alice_ty').get());

    // Alice can query all her workers (including legacy & archived)
    const snapshot = await aliceDb.collection('miningWorkers').where('userId', '==', 'alice').get();
    expect(snapshot.docs.length).toBe(2);

    // Alice can link installationId to tm
    await assertSucceeds(
      aliceDb.collection('miningWorkers').doc('w_alice_tm').update({
        installationId: 'inst_12345678-abcd-ef01-2345-6789abcdef01',
        installationLinkedAt: new Date().toISOString()
      })
    );

    // Bob cannot read Alice's workers
    const bobContext = testEnv.authenticatedContext('bob');
    const bobDb = bobContext.firestore();
    await assertFails(bobDb.collection('miningWorkers').doc('w_alice_tm').get());
  });
});
