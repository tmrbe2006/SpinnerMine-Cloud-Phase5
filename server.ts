import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// Check whether we are targeting Firebase Emulator Suite
const isEmulatorActive = Boolean(
  process.env.FIREBASE_AUTH_EMULATOR_HOST || 
  process.env.FIRESTORE_EMULATOR_HOST
);

let projectId: string | undefined = undefined;
let firestoreDatabaseId: string | undefined = undefined;

if (isEmulatorActive) {
  // When running against Firebase Emulator Suite, strictly use emulator project ID and default database
  projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'spinnermine-ci-test';
  firestoreDatabaseId = undefined;
} else {
  // In live production / development mode, load from firebase-applet-config.json
  try {
    const configPath = path.resolve('firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.projectId && config.projectId !== 'remixed-project-id') {
        projectId = config.projectId;
      }
      if (config.firestoreDatabaseId && config.firestoreDatabaseId !== '(default)' && config.firestoreDatabaseId.trim() !== '') {
        firestoreDatabaseId = config.firestoreDatabaseId.trim();
      } else {
        firestoreDatabaseId = undefined;
      }
    }
  } catch {}

  if (!projectId) {
    projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'spinnermine-cloud-production';
  }
}

// Support explicit service account credential if provided via env
let adminCredential: any = undefined;
if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
  try {
    const keyStr = process.env.FIREBASE_SERVICE_ACCOUNT_KEY.trim();
    const serviceAccount = keyStr.startsWith('{') 
      ? JSON.parse(keyStr) 
      : JSON.parse(fs.readFileSync(path.resolve(keyStr), 'utf8'));
    adminCredential = cert(serviceAccount);
  } catch (err: any) {
    console.warn('[Firebase Admin Init] Could not parse FIREBASE_SERVICE_ACCOUNT_KEY:', err.message);
  }
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
  try {
    const sa = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
    adminCredential = cert(sa);
  } catch {}
}

const adminAppOptions: any = { projectId };
if (adminCredential) {
  adminAppOptions.credential = adminCredential;
}

// Startup diagnostic check: logs target Project ID, Database ID, and runtime mode
console.log(`[Firebase Admin Init] Target Project: ${projectId}, Database: ${firestoreDatabaseId || '(default)'}, Mode: ${isEmulatorActive ? 'EMULATOR' : 'PRODUCTION'}`);

export const firebaseApp = getApps().length === 0 ? initializeApp(adminAppOptions) : getApps()[0];
export const adminAuth = getAuth(firebaseApp);
export const adminDb = firestoreDatabaseId ? getFirestore(firebaseApp, firestoreDatabaseId) : getFirestore(firebaseApp);

/**
 * Dedicated Security Error with HTTP status mapping
 */
export class GameSecurityError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'GameSecurityError';
    this.statusCode = statusCode;
  }
}

/**
 * Authoritative Server HMAC Secret for cryptographic outcome signing.
 * Must be loaded strictly from process.env. No hardcoded default secret permitted.
 * Services requiring signing MUST refuse to run if this key is missing or insecure.
 */
export function getGameServerSecret(): string {
  const secret = process.env.GAME_SERVER_SECRET;
  if (!secret || secret.trim().length < 32) {
    throw new GameSecurityError(
      'FATAL: GAME_SERVER_SECRET environment variable is missing or insufficiently secure (minimum 32 characters / 256 bits required). Cryptographic game outcome services cannot run without an authoritative server secret.',
      500
    );
  }
  return secret.trim();
}

// Exported for backward-compatibility; retrieves secret dynamically
export const SERVER_HMAC_SECRET = process.env.GAME_SERVER_SECRET || '';

// In-Memory Fast Filtering & Local Cache
export const rateLimitMap = new Map<string, { lastRequestTime: number; count: number; windowStart: number }>();
export const usedNoncesMap = new Map<string, number>();

// Clean up expired nonces every 5 minutes (TTL: 10 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of usedNoncesMap.entries()) {
    if (now - timestamp > 10 * 60 * 1000) {
      usedNoncesMap.delete(key);
    }
  }
  for (const [key, data] of rateLimitMap.entries()) {
    if (now - data.windowStart > 60 * 1000) {
      rateLimitMap.delete(key);
    }
  }
}, 5 * 60 * 1000);

// Authoritative Wheel Segments
export const WHEEL_SEGMENTS = [
  { id: 0, type: 'points', value: 100, label: '+100 Arcade Points', color: '#1e3a8a' },
  { id: 1, type: 'points', value: 250, label: '+250 Arcade Points', color: '#047857' },
  { id: 2, type: 'try_again', value: 0, label: 'Spin Again', color: '#334155' },
  { id: 3, type: 'points', value: 50, label: '+50 Arcade Points', color: '#b45309' },
  { id: 4, type: 'points', value: 500, label: '+500 Arcade Points', color: '#6d28d9' },
  { id: 5, type: 'points', value: 150, label: '+150 Arcade Points', color: '#0369a1' },
  { id: 6, type: 'try_again', value: 0, label: 'No Luck', color: '#475569' },
  { id: 7, type: 'points', value: 300, label: '+300 Arcade Points', color: '#be185d' },
];

export interface AuthenticatedRequest extends Request {
  user?: {
    uid: string;
    email?: string;
    admin?: boolean;
    role?: string;
  };
}

// Token Verification Middleware: Strictly uses Firebase Admin SDK (no test token bypass)
export async function authenticateFirebaseToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: Missing or invalid Authorization Bearer token' });
    return;
  }

  const idToken = authHeader.split('Bearer ')[1].trim();

  try {
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      admin: Boolean(decodedToken.admin || decodedToken.role === 'admin'),
      role: (decodedToken.role as string) || (decodedToken.admin ? 'admin' : 'user')
    };
    next();
  } catch (err: any) {
    res.status(401).json({ error: `Unauthorized: Token verification failed: ${err.message}` });
  }
}

// Standalone Rate Limiting & Replay Guard Middleware (exported for backward compatibility)
export async function checkRateLimitAndReplay(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const uid = req.user?.uid || req.ip || 'anonymous';
  const { nonce, clientTimestamp } = req.body;

  if (!nonce || typeof nonce !== 'string' || nonce.trim().length < 8) {
    res.status(400).json({ error: 'Bad Request: A valid cryptographic nonce is required to prevent replay attacks' });
    return;
  }

  if (clientTimestamp) {
    const clientTime = new Date(clientTimestamp).getTime();
    if (isNaN(clientTime) || Math.abs(Date.now() - clientTime) > 5 * 60 * 1000) {
      res.status(400).json({ error: 'Bad Request: Client timestamp exceeds maximum allowed clock skew (5 minutes)' });
      return;
    }
  }

  const operationKey = `${uid}_general_${nonce.trim()}`;
  if (usedNoncesMap.has(operationKey)) {
    res.status(409).json({ error: 'Conflict: Replay attack detected. Nonce has already been consumed.' });
    return;
  }

  const now = Date.now();
  const userRate = rateLimitMap.get(uid);
  if (userRate) {
    if (now - userRate.lastRequestTime < 2000) {
      res.status(429).json({ error: 'Too Many Requests: Rate limit cooldown active. Please wait at least 2 seconds.' });
      return;
    }
    if (now - userRate.windowStart < 60 * 1000) {
      if (userRate.count >= 15) {
        res.status(429).json({ error: 'Too Many Requests: Maximum requests per minute exceeded.' });
        return;
      }
      userRate.count++;
      userRate.lastRequestTime = now;
    } else {
      userRate.windowStart = now;
      userRate.count = 1;
      userRate.lastRequestTime = now;
    }
  } else {
    rateLimitMap.set(uid, {
      lastRequestTime: now,
      count: 1,
      windowStart: now
    });
  }

  usedNoncesMap.set(operationKey, now);
  next();
}

export function createServerApp() {
  const app = express();

  // Cross-Origin Resource Sharing (CORS) Middleware
  // Supports Electron desktop client (Origin: null / file://), Cloud Run, and Firebase Hosting
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    // Allow any origin or reflect origin; null origin allowed for file:// Electron windows
    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json());

  // Health & Firebase Connectivity Diagnostic Endpoint (Safe: No secrets exposed)
  app.get('/api/health', async (_req, res) => {
    let firestoreConnected = false;
    let firestoreError: string | undefined = undefined;

    try {
      // Ping Firestore (default) database with 2500ms timeout
      const pingDoc = adminDb.collection('test').doc('connection');
      const timerPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore connection timeout')), 2500));
      await Promise.race([pingDoc.get(), timerPromise]);
      firestoreConnected = true;
    } catch (err: any) {
      firestoreConnected = false;
      firestoreError = err.message ? err.message.slice(0, 100) : 'Firestore ping failed';
    }

    res.json({
      status: firestoreConnected ? 'healthy' : 'degraded',
      platform: 'SpinnerMine Cloud',
      version: '1.0.0',
      phase: 2,
      security: 'Zero-Trust RBAC & Financial Lockdown Active',
      timestamp: new Date().toISOString(),
      firebase: {
        connected: firestoreConnected,
        projectId: projectId || 'spinnermine-cloud-production',
        databaseId: firestoreDatabaseId || '(default)',
        mode: isEmulatorActive ? 'EMULATOR' : 'PRODUCTION',
        ...(firestoreError ? { notice: firestoreError } : {})
      }
    });
  });

  // Server-Authoritative Wheel Spin Endpoint: Atomic Transaction Replay Guard, Distributed Rate Limit & Ledger Consistency
  app.post('/api/games/spin-wheel', authenticateFirebaseToken, async (req: AuthenticatedRequest, res: Response) => {
    const trustedUid = req.user!.uid;
    const { nonce, clientTimestamp } = req.body;

    // 1. Validate Required Cryptographic Secret & Request Parameters
    let serverSecret: string;
    try {
      serverSecret = getGameServerSecret();
      if (!nonce || typeof nonce !== 'string' || nonce.trim().length < 8) {
        throw new GameSecurityError('Bad Request: A valid cryptographic nonce (minimum 8 characters) is required to prevent replay attacks.', 400);
      }
      if (clientTimestamp) {
        const clientTime = new Date(String(clientTimestamp)).getTime();
        if (isNaN(clientTime) || Math.abs(Date.now() - clientTime) > 5 * 60 * 1000) {
          throw new GameSecurityError('Bad Request: Client timestamp exceeds maximum allowed clock skew (5 minutes).', 400);
        }
      }
    } catch (err: any) {
      const status = err.statusCode || (err.message.includes('GAME_SERVER_SECRET') ? 500 : 400);
      res.status(status).json({ error: err.message });
      return;
    }

    // 2. Composite Operation Key: Strictly binds UID, Game Type, and Nonce
    const gameType = 'wheel';
    const operationKey = `${trustedUid}_${gameType}_${nonce.trim()}`;

    // Fast in-memory check to reject instantaneous concurrent replays
    if (usedNoncesMap.has(operationKey)) {
      res.status(409).json({ error: 'Conflict: Replay attack detected. Nonce has already been consumed.' });
      return;
    }
    // Optimistic in-memory reservation lease to immediately block parallel identical requests in event loop
    usedNoncesMap.set(operationKey, Date.now());

    const targetIndex = crypto.randomInt(0, WHEEL_SEGMENTS.length);
    const wonSegment = WHEEL_SEGMENTS[targetIndex];
    const awardedEntertainmentPoints = wonSegment.value;
    const timestamp = new Date().toISOString();
    const spinId = `spin_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    const signaturePayload = `${trustedUid}:wheel:${targetIndex}:${awardedEntertainmentPoints}:${nonce}:${timestamp}`;
    const serverSignature = crypto
      .createHmac('sha256', serverSecret)
      .update(signaturePayload)
      .digest('hex');

    // 3. Guaranteed Atomic Transaction: Replay Check + Rate Limit + Result Recording + Arcade Increment
    try {
      const outcome = await adminDb.runTransaction(async (transaction) => {
        const nonceDocRef = adminDb.collection('usedNonces').doc(operationKey);
        const rateLimitDocRef = adminDb.collection('rateLimits').doc(trustedUid);
        const userArcadeDocRef = adminDb.collection('userArcade').doc(trustedUid);
        const spinDocRef = adminDb.collection('wheelSpins').doc(spinId);

        // A. Atomic Replay Check - First Read in Transaction
        const nonceDoc = await transaction.get(nonceDocRef);
        if (nonceDoc.exists) {
          throw new GameSecurityError('Conflict: Replay attack detected. Nonce has already been consumed for this user and game.', 409);
        }

        // B. Atomic Multi-Server Distributed Rate Limiting
        const rateLimitDoc = await transaction.get(rateLimitDocRef);
        const now = Date.now();
        let rateData = rateLimitDoc.exists ? (rateLimitDoc.data() as any) : null;

        if (rateData) {
          if (now - (rateData.lastRequestTime || 0) < 2000) {
            throw new GameSecurityError('Too Many Requests: Rate limit cooldown active. Please wait at least 2 seconds.', 429);
          }
          if (now - (rateData.windowStart || 0) < 60000) {
            if ((rateData.count || 0) >= 15) {
              throw new GameSecurityError('Too Many Requests: Maximum requests per minute exceeded across cluster.', 429);
            }
            rateData.count = (rateData.count || 0) + 1;
            rateData.lastRequestTime = now;
          } else {
            rateData.windowStart = now;
            rateData.count = 1;
            rateData.lastRequestTime = now;
          }
        } else {
          rateData = {
            userId: trustedUid,
            lastRequestTime: now,
            count: 1,
            windowStart: now
          };
        }

        // C. Read User Arcade doc inside transaction to place optimistic concurrency lock on user balance
        const userArcadeDoc = await transaction.get(userArcadeDocRef);
        const currentPoints = userArcadeDoc.exists ? (userArcadeDoc.data()?.totalArcadePoints || 0) : 0;
        const newTotalPoints = currentPoints + awardedEntertainmentPoints;

        // D. Atomic Writes within single transaction - transaction.create enforces unique document insertion
        transaction.create(nonceDocRef, {
          nonce,
          userId: trustedUid,
          gameType,
          operationKey,
          consumedAt: FieldValue.serverTimestamp(),
          expiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString()
        });

        transaction.set(rateLimitDocRef, {
          ...rateData,
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });

        transaction.set(spinDocRef, {
          spinId,
          userId: trustedUid,
          segmentLanded: targetIndex,
          rewardType: wonSegment.type,
          rewardValue: String(wonSegment.value),
          claimed: true,
          timestamp,
          entertainmentPoints: awardedEntertainmentPoints,
          serverSignature,
          nonce,
          serverVerified: true,
          cryptocurrencyAwarded: 0,
          createdAt: FieldValue.serverTimestamp()
        });

        transaction.set(userArcadeDocRef, {
          userId: trustedUid,
          totalArcadePoints: newTotalPoints,
          lastSpinAt: timestamp,
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });

        return {
          verified: true,
          spinId,
          uid: trustedUid,
          targetIndex,
          segment: wonSegment,
          awardedEntertainmentPoints,
          cryptocurrencyAwarded: 0, // Strict zero cryptocurrency from games
          nonce,
          timestamp,
          serverSignature
        };
      });

      // Update in-memory cache upon successful transaction commit
      usedNoncesMap.set(operationKey, Date.now());
      rateLimitMap.set(trustedUid, {
        lastRequestTime: Date.now(),
        count: 1,
        windowStart: Date.now()
      });

      res.json(outcome);
    } catch (err: any) {
      if (err instanceof GameSecurityError || err?.statusCode) {
        res.status(err.statusCode || 400).json({ error: err.message });
        return;
      }
      if (err?.code === 6 || err?.message?.includes('ALREADY_EXISTS') || err?.message?.includes('already exists')) {
        res.status(409).json({ error: 'Conflict: Replay attack detected. Nonce has already been consumed for this user and game.' });
        return;
      }
      // Clean up in-memory reservation on non-replay unexpected failure so user is not locked out
      usedNoncesMap.delete(operationKey);
      // Zero points awarded on database failure. Never return verified: true!
      console.error('[Wheel Spin] Atomic transaction failed:', err?.message || err);
      res.status(500).json({
        error: 'Internal Server Error: Failed to atomically verify and record game outcome in ledger.'
      });
    }
  });

  // Server-Authoritative Spinner Game Verification: Atomic Transaction & Safe Fixed Reward
  app.post('/api/games/verify', authenticateFirebaseToken, async (req: AuthenticatedRequest, res: Response) => {
    const trustedUid = req.user!.uid;
    const { gameType: requestedGameType, duration, rpm, nonce, clientTimestamp } = req.body;

    // 1. Validate Secret & Telemetry
    let serverSecret: string;
    try {
      serverSecret = getGameServerSecret();
      if (!nonce || typeof nonce !== 'string' || nonce.trim().length < 8) {
        throw new GameSecurityError('Bad Request: A valid cryptographic nonce (minimum 8 characters) is required to prevent replay attacks.', 400);
      }
      if (clientTimestamp) {
        const clientTime = new Date(String(clientTimestamp)).getTime();
        if (isNaN(clientTime) || Math.abs(Date.now() - clientTime) > 5 * 60 * 1000) {
          throw new GameSecurityError('Bad Request: Client timestamp exceeds maximum allowed clock skew (5 minutes).', 400);
        }
      }
      const sessionDuration = Number(duration) || 0;
      if (sessionDuration < 2) {
        throw new GameSecurityError('Bad Request: Minimum session duration for arcade points is 2 seconds.', 400);
      }
    } catch (err: any) {
      const status = err.statusCode || (err.message.includes('GAME_SERVER_SECRET') ? 500 : 400);
      res.status(status).json({ error: err.message });
      return;
    }

    const gameType = requestedGameType || 'spinner';
    const operationKey = `${trustedUid}_${gameType}_${nonce.trim()}`;

    // Fast in-memory check to reject instantaneous concurrent replays
    if (usedNoncesMap.has(operationKey)) {
      res.status(409).json({ error: 'Conflict: Replay attack detected. Nonce has already been consumed.' });
      return;
    }
    // Optimistic in-memory reservation lease to immediately block parallel identical requests in event loop
    usedNoncesMap.set(operationKey, Date.now());

    const sessionDuration = Number(duration) || 0;
    const sessionRpm = Number(rpm) || 0;
    const awardedEntertainmentPoints = 25; // Decoupled fixed recreational reward
    const timestamp = new Date().toISOString();
    const sessionId = `session_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    const signaturePayload = `${trustedUid}:${gameType}:${awardedEntertainmentPoints}:${nonce}:${timestamp}`;
    const serverSignature = crypto
      .createHmac('sha256', serverSecret)
      .update(signaturePayload)
      .digest('hex');

    // 2. Atomic Transaction: Replay Check + Rate Limit + Result Recording + Arcade Increment
    try {
      const outcome = await adminDb.runTransaction(async (transaction) => {
        const nonceDocRef = adminDb.collection('usedNonces').doc(operationKey);
        const rateLimitDocRef = adminDb.collection('rateLimits').doc(trustedUid);
        const userArcadeDocRef = adminDb.collection('userArcade').doc(trustedUid);
        const sessionDocRef = adminDb.collection('spinnerSessions').doc(sessionId);

        // A. Atomic Replay Check - First Read in Transaction
        const nonceDoc = await transaction.get(nonceDocRef);
        if (nonceDoc.exists) {
          throw new GameSecurityError('Conflict: Replay attack detected. Nonce has already been consumed for this user and game.', 409);
        }

        // B. Atomic Multi-Server Distributed Rate Limiting
        const rateLimitDoc = await transaction.get(rateLimitDocRef);
        const now = Date.now();
        let rateData = rateLimitDoc.exists ? (rateLimitDoc.data() as any) : null;

        if (rateData) {
          if (now - (rateData.lastRequestTime || 0) < 2000) {
            throw new GameSecurityError('Too Many Requests: Rate limit cooldown active. Please wait at least 2 seconds.', 429);
          }
          if (now - (rateData.windowStart || 0) < 60000) {
            if ((rateData.count || 0) >= 15) {
              throw new GameSecurityError('Too Many Requests: Maximum requests per minute exceeded across cluster.', 429);
            }
            rateData.count = (rateData.count || 0) + 1;
            rateData.lastRequestTime = now;
          } else {
            rateData.windowStart = now;
            rateData.count = 1;
            rateData.lastRequestTime = now;
          }
        } else {
          rateData = {
            userId: trustedUid,
            lastRequestTime: now,
            count: 1,
            windowStart: now
          };
        }

        // C. Read User Arcade doc inside transaction to place optimistic concurrency lock on user balance
        const userArcadeDoc = await transaction.get(userArcadeDocRef);
        const currentPoints = userArcadeDoc.exists ? (userArcadeDoc.data()?.totalArcadePoints || 0) : 0;
        const newTotalPoints = currentPoints + awardedEntertainmentPoints;

        // D. Atomic Writes within single transaction - transaction.create enforces unique document insertion
        transaction.create(nonceDocRef, {
          nonce,
          userId: trustedUid,
          gameType,
          operationKey,
          consumedAt: FieldValue.serverTimestamp(),
          expiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString()
        });

        transaction.set(rateLimitDocRef, {
          ...rateData,
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });

        transaction.set(sessionDocRef, {
          sessionId,
          userId: trustedUid,
          duration: sessionDuration,
          recreationalTelemetryRpm: Math.min(10000, Math.max(0, sessionRpm)),
          entertainmentPoints: awardedEntertainmentPoints,
          timestamp,
          verified: true,
          serverSignature,
          nonce,
          serverVerified: true,
          cryptocurrencyAwarded: 0,
          createdAt: FieldValue.serverTimestamp()
        });

        transaction.set(userArcadeDocRef, {
          userId: trustedUid,
          totalArcadePoints: newTotalPoints,
          lastSpinnerAt: timestamp,
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });

        return {
          verified: true,
          sessionId,
          uid: trustedUid,
          gameType,
          awardedEntertainmentPoints,
          cryptocurrencyAwarded: 0, // Strict zero crypto
          nonce,
          timestamp,
          serverSignature
        };
      });

      // Update in-memory cache upon successful transaction commit
      usedNoncesMap.set(operationKey, Date.now());
      rateLimitMap.set(trustedUid, {
        lastRequestTime: Date.now(),
        count: 1,
        windowStart: Date.now()
      });

      res.json(outcome);
    } catch (err: any) {
      if (err instanceof GameSecurityError || err?.statusCode) {
        res.status(err.statusCode || 400).json({ error: err.message });
        return;
      }
      if (err?.code === 6 || err?.message?.includes('ALREADY_EXISTS') || err?.message?.includes('already exists')) {
        res.status(409).json({ error: 'Conflict: Replay attack detected. Nonce has already been consumed for this user and game.' });
        return;
      }
      // Clean up in-memory reservation on non-replay unexpected failure so user is not locked out
      usedNoncesMap.delete(operationKey);
      // Zero points awarded on database failure. Never return verified: true!
      console.error('[Spinner Session] Atomic transaction failed:', err?.message || err);
      res.status(500).json({
        error: 'Internal Server Error: Failed to atomically verify and record session outcome in ledger.'
      });
    }
  });

  // Protected Admin Claims Verification
  app.get('/api/admin/verify-claims', authenticateFirebaseToken, (req: AuthenticatedRequest, res: Response) => {
    if (!req.user?.admin) {
      res.status(403).json({ error: 'Forbidden: Operation requires verified administrator custom claims.' });
      return;
    }

    res.json({
      success: true,
      uid: req.user.uid,
      email: req.user.email,
      role: 'admin',
      verifiedAt: new Date().toISOString()
    });
  });

  // Helper: SSRF Guard to prevent internal network scanning and cloud metadata access
  const isForbiddenTargetHost = (host: string): boolean => {
    const lower = host.toLowerCase().trim();
    if (lower === '169.254.169.254' || lower.includes('metadata.google.internal')) {
      return true; // Cloud metadata attack
    }
    // Allow localhost/127.0.0.1 strictly in test environment for mock Stratum unit testing
    const isTest = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
    if (!isTest) {
      if (['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(lower)) {
        return true;
      }
      if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(lower) ||
          /^192\.168\.\d{1,3}\.\d{1,3}$/.test(lower) ||
          /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(lower) ||
          /^169\.254\.\d{1,3}\.\d{1,3}$/.test(lower)) {
        return true;
      }
    }
    return false;
  };

  // Mining Pool Status Endpoint
  app.get('/api/mining/pool-status', (_req, res) => {
    const hasConfig = Boolean(process.env.MINING_POOL_HOST);
    res.json({
      pool: hasConfig ? `${process.env.MINING_POOL_HOST}:${process.env.MINING_POOL_PORT || 3333}` : 'Custom Operator Pool Required',
      configured: hasConfig,
      algorithm: 'RandomX (rx/0, Monero)',
      status: hasConfig ? 'Phase 2A Real Mining Engine Active' : 'Pool Configuration Pending',
      userSplitRatio: 0.20,
      platformSplitRatio: 0.80,
      notice: 'Revenue split strictly calculated on confirmed pool shares after threshold'
    });
  });

  // Mining Pool Configuration Endpoint: Returns explicitly configured operator settings (NO dummy values)
  app.get('/api/mining/pool-config', (_req, res) => {
    const isConfigured = Boolean(process.env.MINING_POOL_HOST && process.env.MINING_WALLET_ADDRESS);
    res.json({
      configured: isConfigured,
      poolHost: process.env.MINING_POOL_HOST || null,
      poolPort: process.env.MINING_POOL_PORT ? Number(process.env.MINING_POOL_PORT) : null,
      tlsEnabled: process.env.MINING_POOL_TLS === 'true',
      walletAddress: process.env.MINING_WALLET_ADDRESS || null,
      algorithm: 'rx/0',
      coin: 'monero',
      userSplitRatio: 0.20,
      platformSplitRatio: 0.80,
      notice: isConfigured 
        ? 'Real Monero Mining Pool Configured'
        : 'Operator has not configured a production pool host yet. Custom pool configuration required before mining.'
    });
  });

  // Safe TCP/TLS Stratum Pool Connectivity Test Endpoint with SSRF Guard
  app.post('/api/mining/test-pool', async (req: Request, res: Response) => {
    const { host, port, tls: useTls } = req.body;
    if (!host || !port) {
      res.status(400).json({ success: false, error: 'Host and port are required for connection test' });
      return;
    }

    const hostStr = String(host).trim();

    // Enforce SSRF protection
    if (isForbiddenTargetHost(hostStr)) {
      res.status(403).json({ 
        success: false, 
        error: 'Forbidden: Access to internal network, loopback, or cloud metadata services is strictly prohibited.' 
      });
      return;
    }

    const portNum = Number(port);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      res.status(400).json({ success: false, error: 'Invalid port number (must be between 1 and 65535)' });
      return;
    }
    const startTime = Date.now();
    const timeoutMs = 4000;

    try {
      const net = await import('net');
      const tls = await import('tls');

      const result = await new Promise<{ success: boolean; latencyMs: number; error?: string }>((resolve) => {
        let timer: NodeJS.Timeout;
        let socket: any;

        const cleanupAndResolve = (success: boolean, error?: string) => {
          clearTimeout(timer);
          if (socket && !socket.destroyed) {
            socket.destroy();
          }
          resolve({
            success,
            latencyMs: Date.now() - startTime,
            ...(error ? { error } : {})
          });
        };

        timer = setTimeout(() => {
          cleanupAndResolve(false, 'Connection timed out after 4 seconds');
        }, timeoutMs);

        try {
          if (useTls) {
            socket = tls.connect({ host: hostStr, port: portNum, rejectUnauthorized: false }, () => {
              cleanupAndResolve(true);
            });
          } else {
            socket = net.createConnection({ host: hostStr, port: portNum }, () => {
              cleanupAndResolve(true);
            });
          }

          socket.on('error', (err: any) => {
            cleanupAndResolve(false, err?.message || 'Socket error occurred');
          });
        } catch (connErr: any) {
          cleanupAndResolve(false, connErr?.message || 'Failed to initiate socket connection');
        }
      });

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Worker Registration Endpoint: Authenticated with Firebase ID Token
  app.post('/api/workers/register', authenticateFirebaseToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const trustedUid = req.user!.uid;
      const { workerId, name, deviceName, platform, cpuCores, threads, xmrigVersion, installationId } = req.body;

      const safeInstallationId = installationId && typeof installationId === 'string'
        ? installationId.trim().replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 64)
        : null;

      // 1. Deduplication by installationId: Check if a worker for this installation already exists for this user
      let existingByInstDoc: FirebaseFirestore.DocumentSnapshot | null = null;
      if (safeInstallationId) {
        try {
          const instQuery = await adminDb.collection('miningWorkers')
            .where('userId', '==', trustedUid)
            .where('installationId', '==', safeInstallationId)
            .get();
          if (!instQuery.empty) {
            // Pick non-archived or primary
            const activeDocs = instQuery.docs.filter(d => !d.data()?.isArchived && !d.data()?.mergedInto);
            existingByInstDoc = activeDocs.length > 0 ? activeDocs[0] : instQuery.docs[0];
          }
        } catch (queryErr: any) {
          console.warn('[Worker Register] installationId query notice:', queryErr.message);
        }
      }

      // Determine target worker ID: prefer existing installation doc, else requested workerId
      let safeWorkerId = existingByInstDoc ? existingByInstDoc.id : '';
      if (!safeWorkerId) {
        if (!workerId || typeof workerId !== 'string' || workerId.trim().length < 3) {
          res.status(400).json({ error: 'Valid workerId is required (minimum 3 characters)' });
          return;
        }
        safeWorkerId = workerId.trim().replace(/[^a-zA-Z0-9_\-]/g, '');
      }

      const workerDocRef = adminDb.collection('miningWorkers').doc(safeWorkerId);
      const existingDoc = existingByInstDoc || await workerDocRef.get();
      if (existingDoc.exists && existingDoc.data()?.userId !== trustedUid && !req.user?.admin) {
        res.status(403).json({ error: 'Forbidden: Worker ID is already registered to another user account' });
        return;
      }

      const existingData = existingDoc.exists ? existingDoc.data() : null;
      const now = new Date().toISOString();
      const resolvedName = String(name || deviceName || existingData?.name || safeWorkerId).slice(0, 64);
      const resolvedDevice = String(deviceName || name || existingData?.deviceName || 'Windows PC').slice(0, 64);

      // Check for duplicate device name under this user account (prevent confusing duplicate devices)
      try {
        const nameQuery = await adminDb.collection('miningWorkers')
          .where('userId', '==', trustedUid)
          .where('name', '==', resolvedName)
          .get();

        const conflictingDoc = nameQuery.docs.find(d => {
          if (d.id === safeWorkerId) return false;
          // If the conflicting document is marked archived or merged, don't block
          const data = d.data();
          if (data?.isArchived || data?.mergedInto) return false;
          // If it matches the same installation, it's the same computer
          if (safeInstallationId && data?.installationId === safeInstallationId) return false;
          return true;
        });

        if (conflictingDoc) {
          res.status(409).json({
            error: `Conflict: A worker named "${resolvedName}" is already registered on your account with ID: ${conflictingDoc.id}. Please use a unique device name.`
          });
          return;
        }
      } catch (queryErr: any) {
        if (queryErr.code === 7 || queryErr.message?.includes('PERMISSION_DENIED')) {
          throw queryErr;
        }
      }

      // 1. Ensure user profile document exists in users/{trustedUid} (Auto-provision if first time)
      const userDocRef = adminDb.collection('users').doc(trustedUid);
      const userDoc = await userDocRef.get();
      if (!userDoc.exists) {
        const defaultProfile = {
          uid: trustedUid,
          email: req.user?.email || '',
          displayName: req.user?.email?.split('@')[0] || resolvedName || 'Miner',
          photoURL: '',
          role: 'user', // Least privilege default: never elevated from client
          language: 'ar',
          theme: 'dark',
          miningConsent: false,
          referralCode: Math.random().toString(36).substring(2, 8).toUpperCase(),
          createdAt: now,
          updatedAt: now
        };
        await userDocRef.set(defaultProfile, { merge: true });
      }

      // 2. Authoritative Worker Document in miningWorkers/{safeWorkerId}
      // Note: acceptedShares and financial fields are locked from client manipulation
      const workerData: Record<string, any> = {
        workerId: safeWorkerId,
        userId: trustedUid,
        name: resolvedName,
        deviceName: resolvedDevice,
        platform: ['windows', 'linux', 'mac', 'browser'].includes(platform) ? platform : 'windows',
        cpuCores: Math.max(1, Math.min(128, Number(cpuCores) || 4)),
        threads: Math.max(1, Math.min(64, Number(threads) || 2)),
        xmrigVersion: String(xmrigVersion || '6.26.0').slice(0, 32),
        status: existingData?.status || 'offline',
        reportedHashrate: existingData?.reportedHashrate ?? 0,
        acceptedShares: existingData?.acceptedShares ?? 0,
        rejectedShares: existingData?.rejectedShares ?? 0,
        lastSeen: now,
        createdAt: existingData?.createdAt || now,
        updatedAt: now
      };

      if (safeInstallationId) {
        workerData.installationId = safeInstallationId;
      } else if (existingData?.installationId) {
        workerData.installationId = existingData.installationId;
      }

      // If updating an archived worker, reactivate only if explicitly unarchived
      if (existingData?.isArchived !== undefined) {
        workerData.isArchived = existingData.isArchived;
      }
      if (existingData?.mergedInto !== undefined) {
        workerData.mergedInto = existingData.mergedInto;
      }

      await workerDocRef.set(workerData, { merge: true });
      res.json({
        success: true,
        worker: workerData,
        message: existingDoc.exists ? 'Mining worker updated successfully' : 'Mining worker successfully paired to account'
      });
    } catch (err: any) {
      console.error('[Worker Registration] Database error:', err?.message || err);
      let userFriendlyMsg = err.message || 'Unknown database error';
      const isPermissionDenied = err.code === 7 || err.code === 'PERMISSION_DENIED' || err.message?.includes('PERMISSION_DENIED') || err.message?.includes('Missing or insufficient permissions');
      if (isPermissionDenied) {
        userFriendlyMsg = 'Firestore permission denied: Service account or user lacks permissions for project spinnermine-cloud-production.';
        res.status(403).json({ 
          error: `Failed to register mining worker: ${userFriendlyMsg}`,
          code: 'PERMISSION_DENIED',
          status: 403
        });
        return;
      }
      res.status(500).json({ 
        error: `Failed to register mining worker: ${userFriendlyMsg}`,
        code: err.code || 'DATABASE_ERROR',
        status: 500
      });
    }
  });

  // Worker Rename Endpoint: Changes device name without mutating workerId
  app.post('/api/workers/rename', authenticateFirebaseToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const trustedUid = req.user!.uid;
      const { workerId, name, deviceName } = req.body;

      if (!workerId || typeof workerId !== 'string') {
        res.status(400).json({ error: 'Valid workerId is required' });
        return;
      }

      const safeWorkerId = workerId.trim().replace(/[^a-zA-Z0-9_\-]/g, '');
      const newName = String(name || deviceName || '').trim().slice(0, 64);
      if (!newName) {
        res.status(400).json({ error: 'A valid non-empty name is required' });
        return;
      }

      const workerDocRef = adminDb.collection('miningWorkers').doc(safeWorkerId);
      const docSnap = await workerDocRef.get();
      if (!docSnap.exists) {
        res.status(404).json({ error: 'Worker not found' });
        return;
      }

      if (docSnap.data()?.userId !== trustedUid && !req.user?.admin) {
        res.status(403).json({ error: 'Forbidden: You do not own this worker device' });
        return;
      }

      const now = new Date().toISOString();
      await workerDocRef.set({
        name: newName,
        deviceName: String(deviceName || newName).trim().slice(0, 64),
        updatedAt: now
      }, { merge: true });

      res.json({
        success: true,
        workerId: safeWorkerId,
        name: newName,
        message: 'Worker renamed successfully without altering device identity'
      });
    } catch (err: any) {
      res.status(500).json({ error: `Failed to rename worker: ${err.message}` });
    }
  });

  // Permanent Device Identity Linking Endpoint: Authenticated with Firebase ID Token & User Consent
  app.post('/api/workers/link-installation', authenticateFirebaseToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const trustedUid = req.user!.uid;
      const { workerId, installationId, consentConfirmed } = req.body;

      if (!workerId || typeof workerId !== 'string') {
        res.status(400).json({ error: 'Valid workerId is required' });
        return;
      }

      if (!installationId || typeof installationId !== 'string' || !installationId.startsWith('inst_')) {
        res.status(400).json({ error: 'Valid installationId starting with inst_ is required' });
        return;
      }

      // Requirement 5: Explicit user consent verification
      if (!consentConfirmed) {
        res.status(400).json({ error: 'Explicit user consent is required to link permanent installation identity' });
        return;
      }

      const safeWorkerId = workerId.trim().replace(/[^a-zA-Z0-9_\-]/g, '');
      const safeInstallationId = installationId.trim().replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 64);

      const workerDocRef = adminDb.collection('miningWorkers').doc(safeWorkerId);
      const docSnap = await workerDocRef.get();
      if (!docSnap.exists) {
        res.status(404).json({ error: 'Worker not found' });
        return;
      }

      // Requirement 3 & 6: Verify Firebase UID and worker ownership
      if (docSnap.data()?.userId !== trustedUid && !req.user?.admin) {
        res.status(403).json({ error: 'Forbidden: You do not own this worker device', code: 'PERMISSION_DENIED' });
        return;
      }

      // Check if another active worker already has this installationId under this account
      const instQuery = await adminDb.collection('miningWorkers')
        .where('userId', '==', trustedUid)
        .where('installationId', '==', safeInstallationId)
        .get();

      const conflictingDoc = instQuery.docs.find(d => {
        if (d.id === safeWorkerId) return false;
        const data = d.data();
        return !data?.isArchived && !data?.mergedInto;
      });

      if (conflictingDoc) {
        res.status(409).json({
          error: `Conflict: Installation ID is already assigned to active worker ${conflictingDoc.id}. Please resolve duplicate devices first.`,
          code: 'ALREADY_EXISTS'
        });
        return;
      }

      const now = new Date().toISOString();
      const existingData = docSnap.data() || {};
      const retainedAcceptedShares = Number(existingData.acceptedShares) || 0;

      // Requirement 4, 9, 10: Preserve workerId, acceptedShares, retain all fields, zero financial impact
      await workerDocRef.set({
        installationId: safeInstallationId,
        installationLinkedAt: now,
        updatedAt: now
      }, { merge: true });

      res.json({
        success: true,
        workerId: safeWorkerId,
        installationId: safeInstallationId,
        name: existingData.name,
        retainedAcceptedShares,
        financialBalanceImpact: 0,
        message: `Permanent installation ID successfully linked to worker ${safeWorkerId}.`
      });
    } catch (err: any) {
      res.status(500).json({ error: `Failed to link installation ID: ${err.message}` });
    }
  });

  // Duplicate Discovery & Audit Endpoint: Audits workers and linked sessions
  app.get('/api/workers/duplicates', authenticateFirebaseToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const trustedUid = req.user!.uid;
      const snapshot = await adminDb.collection('miningWorkers')
        .where('userId', '==', trustedUid)
        .get();

      const allWorkers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
      const activeWorkers = allWorkers.filter(w => !w.isArchived && !w.mergedInto && w.status !== 'archived');

      // 1. Group by installationId
      const groups: Array<{
        primaryWorkerId: string;
        primaryName: string;
        duplicateWorkerId: string;
        duplicateName: string;
        reason: string;
        duplicateSessionsCount: number;
        duplicateAcceptedShares: number;
      }> = [];

      const byInst = new Map<string, any[]>();
      for (const w of activeWorkers) {
        if (w.installationId) {
          const list = byInst.get(w.installationId) || [];
          list.push(w);
          byInst.set(w.installationId, list);
        }
      }

      for (const [_, list] of byInst.entries()) {
        if (list.length > 1) {
          // Sort so tm or w_qBPFqVEe_tm or oldest is primary
          const sorted = [...list].sort((a, b) => {
            if (a.id === 'w_qBPFqVEe_tm' || a.name === 'tm') return -1;
            if (b.id === 'w_qBPFqVEe_tm' || b.name === 'tm') return 1;
            return (a.createdAt || '').localeCompare(b.createdAt || '');
          });
          const primary = sorted[0];
          for (let i = 1; i < sorted.length; i++) {
            const dup = sorted[i];
            groups.push({
              primaryWorkerId: primary.id,
              primaryName: primary.name || primary.deviceName || primary.id,
              duplicateWorkerId: dup.id,
              duplicateName: dup.name || dup.deviceName || dup.id,
              reason: 'Identical Installation ID',
              duplicateSessionsCount: 0,
              duplicateAcceptedShares: dup.acceptedShares || 0
            });
          }
        }
      }

      // 2. Legacy known pair check: tm (w_qBPFqVEe_tm) and ty (w_GyAldfJ5_ty)
      const tmDoc = activeWorkers.find(w => w.id === 'w_qBPFqVEe_tm' || w.name === 'tm');
      const tyDoc = activeWorkers.find(w => w.id === 'w_GyAldfJ5_ty' || w.name === 'ty');
      if (tmDoc && tyDoc && tmDoc.id !== tyDoc.id) {
        const alreadyIncluded = groups.some(g => g.primaryWorkerId === tmDoc.id && g.duplicateWorkerId === tyDoc.id);
        if (!alreadyIncluded) {
          groups.push({
            primaryWorkerId: tmDoc.id,
            primaryName: tmDoc.name || 'tm',
            duplicateWorkerId: tyDoc.id,
            duplicateName: tyDoc.name || 'ty',
            reason: 'Legacy Windows PC Duplicate Registration',
            duplicateSessionsCount: 0,
            duplicateAcceptedShares: tyDoc.acceptedShares || 0
          });
        }
      }

      // Inspect miningSessions for each duplicate candidate
      for (const group of groups) {
        try {
          const sessQuery = await adminDb.collection('miningSessions')
            .where('userId', '==', trustedUid)
            .where('workerId', '==', group.duplicateWorkerId)
            .get();
          group.duplicateSessionsCount = sessQuery.size;
        } catch {}
      }

      res.json({
        success: true,
        duplicatesFound: groups.length > 0,
        groups
      });
    } catch (err: any) {
      res.status(500).json({ error: `Failed to inspect duplicate workers: ${err.message}` });
    }
  });

  // Worker Archive Endpoint: Safe archival without deleting document or mutating financials
  app.post('/api/workers/archive', authenticateFirebaseToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const trustedUid = req.user!.uid;
      const { workerId, reason } = req.body;

      if (!workerId || typeof workerId !== 'string') {
        res.status(400).json({ error: 'Valid workerId is required' });
        return;
      }

      const safeWorkerId = workerId.trim().replace(/[^a-zA-Z0-9_\-]/g, '');
      const docRef = adminDb.collection('miningWorkers').doc(safeWorkerId);
      const docSnap = await docRef.get();
      if (!docSnap.exists) {
        res.status(404).json({ error: 'Worker not found' });
        return;
      }

      if (docSnap.data()?.userId !== trustedUid && !req.user?.admin) {
        res.status(403).json({ error: 'Forbidden: You do not own this worker device' });
        return;
      }

      const now = new Date().toISOString();
      await docRef.set({
        isArchived: true,
        archivedAt: now,
        archiveReason: String(reason || 'user_archived').slice(0, 128),
        status: 'archived',
        updatedAt: now
      }, { merge: true });

      res.json({
        success: true,
        workerId: safeWorkerId,
        message: 'Worker safely archived without document deletion or financial modification'
      });
    } catch (err: any) {
      res.status(500).json({ error: `Failed to archive worker: ${err.message}` });
    }
  });

  // Worker Merge Endpoint: Links duplicate record into primary record safely
  app.post('/api/workers/merge', authenticateFirebaseToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const trustedUid = req.user!.uid;
      const { primaryWorkerId, secondaryWorkerId, reason } = req.body;

      if (!primaryWorkerId || !secondaryWorkerId) {
        res.status(400).json({ error: 'Both primaryWorkerId and secondaryWorkerId are required' });
        return;
      }

      const safePrimary = String(primaryWorkerId).trim().replace(/[^a-zA-Z0-9_\-]/g, '');
      const safeSecondary = String(secondaryWorkerId).trim().replace(/[^a-zA-Z0-9_\-]/g, '');

      if (safePrimary === safeSecondary) {
        res.status(400).json({ error: 'Cannot merge a worker into itself' });
        return;
      }

      const primaryRef = adminDb.collection('miningWorkers').doc(safePrimary);
      const secondaryRef = adminDb.collection('miningWorkers').doc(safeSecondary);

      const [primarySnap, secondarySnap] = await Promise.all([primaryRef.get(), secondaryRef.get()]);

      if (!primarySnap.exists || !secondarySnap.exists) {
        res.status(404).json({ error: 'One or both worker documents not found', code: 'NOT_FOUND' });
        return;
      }

      // Requirement 4: Strictly prevent merging workers belonging to different user accounts
      if (primarySnap.data()?.userId !== secondarySnap.data()?.userId) {
        res.status(403).json({ error: 'Forbidden: Cannot merge workers belonging to different user accounts', code: 'CROSS_USER_MERGE_FORBIDDEN' });
        return;
      }

      if ((primarySnap.data()?.userId !== trustedUid || secondarySnap.data()?.userId !== trustedUid) && !req.user?.admin) {
        res.status(403).json({ error: 'Forbidden: Ownership verification failed', code: 'PERMISSION_DENIED' });
        return;
      }

      const now = new Date().toISOString();
      const mergeReason = String(reason || `merged_into_${safePrimary}`).slice(0, 128);
      const secondaryData = secondarySnap.data() || {};
      const retainedAcceptedShares = Number(secondaryData.acceptedShares) || 0;
      const retainedRejectedShares = Number(secondaryData.rejectedShares) || 0;

      // Mark secondary worker as merged and archived. NEVER delete from Firestore!
      await secondaryRef.set({
        mergedInto: safePrimary,
        mergedAt: now,
        isArchived: true,
        archivedAt: now,
        archiveReason: mergeReason,
        status: 'archived',
        updatedAt: now
      }, { merge: true });

      // Audit linked mining sessions referencing secondary worker
      let secondarySessionsCount = 0;
      try {
        const sessQuery = await adminDb.collection('miningSessions')
          .where('userId', '==', trustedUid)
          .where('workerId', '==', safeSecondary)
          .get();

        secondarySessionsCount = sessQuery.size;
        const batch = adminDb.batch();
        sessQuery.docs.forEach(doc => {
          batch.update(doc.ref, {
            mergedTargetWorkerId: safePrimary,
            auditNote: `Session audited and merged into primary worker ${safePrimary} at ${now}`
          });
        });
        if (!sessQuery.empty) {
          await batch.commit();
        }
      } catch (sessErr: any) {
        console.warn('[Worker Merge] Session audit warning:', sessErr.message);
      }

      res.json({
        success: true,
        primaryWorkerId: safePrimary,
        mergedWorkerId: safeSecondary,
        primaryName: primarySnap.data()?.name || safePrimary,
        duplicateName: secondaryData.name || safeSecondary,
        retainedAcceptedShares,
        retainedRejectedShares,
        auditedSessionsCount: secondarySessionsCount,
        financialBalanceImpact: 0,
        auditRecord: {
          action: 'WORKER_MERGE',
          mergedBy: trustedUid,
          primaryWorkerId: safePrimary,
          duplicateWorkerId: safeSecondary,
          timestamp: now,
          reason: mergeReason,
          retainedAcceptedShares,
          auditedSessionsCount: secondarySessionsCount
        },
        message: `Worker ${safeSecondary} safely merged into primary worker ${safePrimary}. Document retained for audit.`
      });
    } catch (err: any) {
      res.status(500).json({ error: `Failed to merge workers: ${err.message}` });
    }
  });

  // Worker Telemetry Ingestion Endpoint: Authenticated with Firebase ID Token
  // STRICT DATA ISOLATION: Telemetry is unverified client performance metrics.
  // It NEVER credits wallet balances or creates withdrawal balances.
  app.post('/api/workers/telemetry', authenticateFirebaseToken, async (req: AuthenticatedRequest, res: Response) => {
    const trustedUid = req.user!.uid;
    const { 
      workerId, 
      reportedHashrate, 
      acceptedShares, 
      rejectedShares, 
      status, 
      sessionId, 
      lastError, 
      cpuUsage, 
      threads 
    } = req.body;

    if (!workerId || typeof workerId !== 'string') {
      res.status(400).json({ error: 'Valid workerId is required' });
      return;
    }

    const safeWorkerId = workerId.trim().replace(/[^a-zA-Z0-9_\-]/g, '');
    const workerDocRef = adminDb.collection('miningWorkers').doc(safeWorkerId);

    try {
      const existingDoc = await workerDocRef.get();
      if (!existingDoc.exists) {
        res.status(404).json({ error: 'Worker not found. Please register this device first before transmitting telemetry.' });
        return;
      }

      if (existingDoc.data()?.userId !== trustedUid && !req.user?.admin) {
        res.status(403).json({ error: 'Forbidden: You do not own this worker device registration' });
        return;
      }

      const now = new Date().toISOString();
      const telemetryUpdate: Record<string, any> = {
        workerId: safeWorkerId,
        userId: trustedUid,
        lastSeen: now,
        updatedAt: now,
        status: ['registered', 'online', 'offline', 'mining', 'paused', 'error'].includes(status) ? status : 'online',
        reportedHashrate: Math.max(0, Number(reportedHashrate) || 0)
      };

      // STRICT FINANCIAL ISOLATION: Telemetry cannot mutate acceptedShares, earnings, or balances
      if (sessionId) telemetryUpdate.sessionId = String(sessionId).slice(0, 128);
      if (lastError !== undefined) telemetryUpdate.lastError = String(lastError).slice(0, 500);
      if (threads !== undefined) telemetryUpdate.threads = Math.max(1, Number(threads) || 1);
      if (cpuUsage !== undefined) telemetryUpdate.cpuUsage = Math.min(100, Math.max(0, Number(cpuUsage) || 0));

      await workerDocRef.set(telemetryUpdate, { merge: true });

      res.json({
        success: true,
        telemetryRecorded: true,
        workerId: safeWorkerId,
        reportedHashrate: telemetryUpdate.reportedHashrate,
        cpuUsage: telemetryUpdate.cpuUsage,
        status: telemetryUpdate.status,
        financialBalanceImpact: 0, // Strict zero balance change: verified pool daemon required for revenue
        timestamp: now
      });
    } catch (err: any) {
      console.error('[Worker Telemetry] Database error:', err?.message || err);
      const isPermissionDenied = err.code === 7 || err.code === 'PERMISSION_DENIED' || err.message?.includes('PERMISSION_DENIED') || err.message?.includes('Missing or insufficient permissions');
      if (isPermissionDenied) {
        res.status(403).json({
          error: 'Firestore permission denied: Backend lacks permissions for project spinnermine-cloud-production.',
          code: 'PERMISSION_DENIED',
          status: 403
        });
        return;
      }
      res.status(500).json({ error: `Failed to record worker telemetry: ${err.message}` });
    }
  });

  // Worker List Endpoint: Authenticated with Firebase ID Token
  app.get('/api/workers', authenticateFirebaseToken, async (req: AuthenticatedRequest, res: Response) => {
    const trustedUid = req.user!.uid;
    try {
      let query: FirebaseFirestore.Query = adminDb.collection('miningWorkers');
      if (!req.user?.admin) {
        query = query.where('userId', '==', trustedUid);
      }
      const snapshot = await query.get();
      const workers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json({ success: true, workers });
    } catch (err: any) {
      res.status(500).json({ error: `Failed to fetch workers: ${err.message}` });
    }
  });

  return app;
}

async function startServer() {
  // Validate that GAME_SERVER_SECRET is configured before launching the server
  try {
    getGameServerSecret();
  } catch (err: any) {
    console.error('================================================================');
    console.error('FATAL SERVER CONFIGURATION ERROR:');
    console.error(err.message);
    console.error('Set GAME_SERVER_SECRET in your environment or .env file.');
    console.error('================================================================');
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }

  const app = createServerApp();
  let PORT = Number(process.env.PORT) || 3000;
  const portArgIndex = process.argv.indexOf('--port');
  if (portArgIndex !== -1 && process.argv[portArgIndex + 1]) {
    const parsed = Number(process.argv[portArgIndex + 1]);
    if (!isNaN(parsed) && parsed > 0) {
      PORT = parsed;
    }
  }

  // Mount Vite development middlewares
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Serve static assets in production
    app.use(express.static(path.resolve('dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve('dist/index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SpinnerMine Cloud Server listening on http://0.0.0.0:${PORT}`);
  });
}

// Only start when executed directly (not when imported in tests or vitest)
if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  startServer();
}
