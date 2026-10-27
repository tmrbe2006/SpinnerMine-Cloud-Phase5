/**
 * Administrator Setup Utility for SpinnerMine Cloud
 * 
 * SECURITY DIRECTIVE:
 * - This script MUST only be executed in a trusted server environment by an authorized platform operator.
 * - Never embed service account credentials or private keys in the repository.
 * - This script uses Google Cloud Application Default Credentials (ADC) or GOOGLE_APPLICATION_CREDENTIALS.
 * - Sets cryptographic Firebase Custom Claims ({ admin: true, role: 'admin' }) on the target user.
 */

import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';

// Load project ID from config or environment
let projectId = process.env.FIREBASE_PROJECT_ID;
try {
  const configPath = path.resolve('firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    projectId = projectId || config.projectId;
  }
} catch {}

const app = getApps().length === 0 ? initializeApp({ projectId }) : getApps()[0];
const adminAuth = getAuth(app);
const adminDb = getFirestore(app);

export async function grantAdminClaims(targetIdentifier: string) {
  if (!targetIdentifier || targetIdentifier.trim().length === 0) {
    throw new Error('Target user identifier (UID or Email) is required.');
  }

  let userRecord;
  if (targetIdentifier.includes('@')) {
    userRecord = await adminAuth.getUserByEmail(targetIdentifier.trim());
  } else {
    userRecord = await adminAuth.getUser(targetIdentifier.trim());
  }

  const uid = userRecord.uid;
  const claims = {
    admin: true,
    role: 'admin',
    assignedAt: new Date().toISOString()
  };

  await adminAuth.setCustomUserClaims(uid, claims);

  try {
    await adminDb.collection('admins').doc(uid).set({
      uid,
      email: userRecord.email || '',
      role: 'admin',
      status: 'active',
      grantedAt: FieldValue.serverTimestamp(),
      claims
    }, { merge: true });

    await adminDb.collection('auditLogs').add({
      action: 'ADMIN_PRIVILEGE_GRANTED',
      actor: 'SERVER_OPERATOR_CLI',
      targetUid: uid,
      targetEmail: userRecord.email || '',
      timestamp: FieldValue.serverTimestamp()
    });
  } catch (err: any) {
    console.warn(`[Admin Setup] Firestore sync note: ${err.message}`);
  }

  return {
    success: true,
    uid,
    email: userRecord.email,
    claims
  };
}

async function runCli() {
  const targetIdentifier = process.argv[2] || process.env.TARGET_ADMIN_UID || process.env.TARGET_ADMIN_EMAIL;

  if (!targetIdentifier) {
    console.error('================================================================');
    console.error('ERROR: Missing target user identifier!');
    console.error('Usage:');
    console.error('  npx tsx scripts/set-admin.ts <UID_OR_EMAIL>');
    console.error('Or set environment variables:');
    console.error('  TARGET_ADMIN_UID="<uid>" npx tsx scripts/set-admin.ts');
    console.error('================================================================');
    process.exit(1);
  }

  console.log(`[SpinnerMine Admin Setup] Setting admin claim for: ${targetIdentifier}...`);
  try {
    const result = await grantAdminClaims(targetIdentifier);
    console.log('================================================================');
    console.log(`SUCCESS: Administrator claims granted to ${result.email || result.uid}.`);
    console.log('Target UID:', result.uid);
    console.log('Custom Claims:', JSON.stringify(result.claims));
    console.log('User must refresh session token to activate elevated privileges.');
    console.log('================================================================');
  } catch (err: any) {
    console.error(`[SpinnerMine Admin Setup] Operation failed: ${err.message}`);
    process.exit(1);
  }
}

// Run CLI if invoked directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runCli();
}
