import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, browserLocalPersistence, setPersistence } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Validate required production configuration
if (!firebaseConfig.projectId || !firebaseConfig.apiKey) {
  console.error('[Firebase Client] FATAL: Missing required Firebase configuration in firebase-applet-config.json');
}

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);

// Target (default) database via getFirestore(app) or use explicit custom ID if specified
const configuredDbId = (firebaseConfig as any).firestoreDatabaseId;
const targetDatabaseId = configuredDbId && configuredDbId !== '(default)' && configuredDbId.trim() !== ''
  ? configuredDbId.trim()
  : undefined;

export const db = targetDatabaseId ? getFirestore(app, targetDatabaseId) : getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

// Safe diagnostic log on startup
console.log(`[Firebase Client Init] Target Project: ${firebaseConfig.projectId}, Database: ${targetDatabaseId || '(default)'}`);

// Enforce local session persistence across reloads and Electron desktop restarts
try {
  setPersistence(auth, browserLocalPersistence).catch(() => {});
} catch {}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Mandatory connection test
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase client is offline or database initializing.');
    }
  }
}
testConnection();
