import { Env, WHEEL_SEGMENTS } from '../types';
import { authenticateRequest } from '../auth';
import { toFirestoreValue, commitWrites } from '../firestore';
import { getServiceAccountAccessToken } from '../serviceAccount';

// Fast in-memory filter to prevent instantaneous burst replays within the same worker isolate
const localNonceCache = new Map<string, number>();
const localRateLimitMap = new Map<string, { lastRequestTime: number; count: number; windowStart: number }>();

// Helper: Calculate HMAC SHA-256 using Web Crypto
export async function computeHmacSha256Hex(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Generate random int [min, max) using Web Crypto
function getSecureRandomInt(min: number, max: number): number {
  const range = max - min;
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return min + (arr[0] % range);
}

function getRandomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function handleSpinWheel(request: Request, env: Env): Promise<Response> {
  const { user } = await authenticateRequest(request, env);
  const body: any = await request.json().catch(() => ({}));
  const { nonce, clientTimestamp } = body;

  // 1. Validate Secret & Request
  const secret = env.GAME_SERVER_SECRET;
  if (!secret || secret.trim().length < 32) {
    return new Response(
      JSON.stringify({
        error: 'FATAL: GAME_SERVER_SECRET environment variable is missing or insufficiently secure (minimum 32 characters / 256 bits required). Cryptographic game outcome services cannot run without an authoritative server secret.'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!nonce || typeof nonce !== 'string' || nonce.trim().length < 8) {
    return new Response(
      JSON.stringify({ error: 'Bad Request: A valid cryptographic nonce (minimum 8 characters) is required to prevent replay attacks.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (clientTimestamp) {
    const clientTime = new Date(String(clientTimestamp)).getTime();
    if (isNaN(clientTime) || Math.abs(Date.now() - clientTime) > 5 * 60 * 1000) {
      return new Response(
        JSON.stringify({ error: 'Bad Request: Client timestamp exceeds maximum allowed clock skew (5 minutes).' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  // 2. Composite Operation Key strictly binds UID, Game Type, and Nonce
  const gameType = 'wheel';
  const operationKey = `${user.uid}_${gameType}_${nonce.trim()}`;

  // In-memory fast replay check
  const now = Date.now();
  if (localNonceCache.has(operationKey)) {
    return new Response(
      JSON.stringify({ error: 'Conflict: Replay attack detected. Nonce has already been consumed.' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } }
    );
  }
  localNonceCache.set(operationKey, now);

  // Rate limit cooldown (min 2s, max 15/min)
  const userRate = localRateLimitMap.get(user.uid);
  if (userRate) {
    if (now - userRate.lastRequestTime < 2000) {
      return new Response(
        JSON.stringify({ error: 'Too Many Requests: Rate limit cooldown active. Please wait at least 2 seconds.' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (now - userRate.windowStart < 60000) {
      if (userRate.count >= 15) {
        return new Response(
          JSON.stringify({ error: 'Too Many Requests: Maximum requests per minute exceeded across cluster.' }),
          { status: 429, headers: { 'Content-Type': 'application/json' } }
        );
      }
      userRate.count++;
      userRate.lastRequestTime = now;
    } else {
      userRate.windowStart = now;
      userRate.count = 1;
      userRate.lastRequestTime = now;
    }
  } else {
    localRateLimitMap.set(user.uid, { lastRequestTime: now, count: 1, windowStart: now });
  }

  // Require service account for authoritative ledger writes
  const serviceToken = await getServiceAccountAccessToken(env);
  if (!serviceToken) {
    localNonceCache.delete(operationKey);
    return new Response(
      JSON.stringify({
        error: 'Game outcome verification is temporarily disabled: Authoritative service account credentials (FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY) are required in Cloudflare Secrets.'
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const targetIndex = getSecureRandomInt(0, WHEEL_SEGMENTS.length);
  const wonSegment = WHEEL_SEGMENTS[targetIndex];
  const awardedEntertainmentPoints = wonSegment.value;
  const timestamp = new Date().toISOString();
  const spinId = `spin_${now}_${getRandomHex(4)}`;

  const signaturePayload = `${user.uid}:wheel:${targetIndex}:${awardedEntertainmentPoints}:${nonce}:${timestamp}`;
  const serverSignature = await computeHmacSha256Hex(secret, signaturePayload);

  const projectId = env.FIREBASE_PROJECT_ID || 'spinnermine-cloud-production';
  const databaseId = env.FIRESTORE_DATABASE_ID || '(default)';
  const docRoot = `projects/${projectId}/databases/${databaseId}/documents`;

  // Atomic batch commit with precondition on usedNonces to ensure single-use
  const writes = [
    {
      update: {
        name: `${docRoot}/usedNonces/${operationKey}`,
        fields: {
          nonce: toFirestoreValue(nonce),
          userId: toFirestoreValue(user.uid),
          gameType: toFirestoreValue(gameType),
          operationKey: toFirestoreValue(operationKey),
          consumedAt: toFirestoreValue(timestamp)
        }
      },
      currentDocument: { exists: false } // Atomic Replay Guard: Fails if already exists!
    },
    {
      update: {
        name: `${docRoot}/wheelSpins/${spinId}`,
        fields: {
          spinId: toFirestoreValue(spinId),
          userId: toFirestoreValue(user.uid),
          segmentLanded: toFirestoreValue(targetIndex),
          rewardType: toFirestoreValue(wonSegment.type),
          rewardValue: toFirestoreValue(String(wonSegment.value)),
          claimed: toFirestoreValue(true),
          timestamp: toFirestoreValue(timestamp),
          entertainmentPoints: toFirestoreValue(awardedEntertainmentPoints),
          serverSignature: toFirestoreValue(serverSignature),
          nonce: toFirestoreValue(nonce),
          serverVerified: toFirestoreValue(true),
          cryptocurrencyAwarded: toFirestoreValue(0),
          createdAt: toFirestoreValue(timestamp)
        }
      }
    },
    {
      transform: {
        document: `${docRoot}/userArcade/${user.uid}`,
        fieldTransforms: [
          {
            fieldPath: 'totalArcadePoints',
            increment: { integerValue: String(awardedEntertainmentPoints) }
          },
          {
            fieldPath: 'lastSpinAt',
            setToServerValue: 'REQUEST_TIME'
          }
        ]
      }
    }
  ];

  try {
    await commitWrites(writes, serviceToken, env);

    return new Response(
      JSON.stringify({
        verified: true,
        spinId,
        uid: user.uid,
        targetIndex,
        segment: wonSegment,
        awardedEntertainmentPoints,
        cryptocurrencyAwarded: 0, // Strict zero cryptocurrency from games
        nonce,
        timestamp,
        serverSignature
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    if (err.status === 409 || err.message?.includes('ALREADY_EXISTS') || err.raw?.includes('ALREADY_EXISTS')) {
      return new Response(
        JSON.stringify({ error: 'Conflict: Replay attack detected. Nonce has already been consumed for this user and game.' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }
    localNonceCache.delete(operationKey);
    console.error('[Wheel Spin] Atomic commit failed:', err);
    return new Response(
      JSON.stringify({ error: 'Internal Server Error: Failed to atomically verify and record game outcome in ledger.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

export async function handleVerifySpinner(request: Request, env: Env): Promise<Response> {
  const { user } = await authenticateRequest(request, env);
  const body: any = await request.json().catch(() => ({}));
  const { gameType: requestedGameType, duration, rpm, nonce, clientTimestamp } = body;

  const secret = env.GAME_SERVER_SECRET;
  if (!secret || secret.trim().length < 32) {
    return new Response(
      JSON.stringify({
        error: 'FATAL: GAME_SERVER_SECRET environment variable is missing or insufficiently secure (minimum 32 characters / 256 bits required). Cryptographic game outcome services cannot run without an authoritative server secret.'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!nonce || typeof nonce !== 'string' || nonce.trim().length < 8) {
    return new Response(
      JSON.stringify({ error: 'Bad Request: A valid cryptographic nonce (minimum 8 characters) is required to prevent replay attacks.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (clientTimestamp) {
    const clientTime = new Date(String(clientTimestamp)).getTime();
    if (isNaN(clientTime) || Math.abs(Date.now() - clientTime) > 5 * 60 * 1000) {
      return new Response(
        JSON.stringify({ error: 'Bad Request: Client timestamp exceeds maximum allowed clock skew (5 minutes).' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  const sessionDuration = Number(duration) || 0;
  if (sessionDuration < 2) {
    return new Response(
      JSON.stringify({ error: 'Bad Request: Minimum session duration for arcade points is 2 seconds.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const gameType = requestedGameType || 'spinner';
  const operationKey = `${user.uid}_${gameType}_${nonce.trim()}`;

  const now = Date.now();
  if (localNonceCache.has(operationKey)) {
    return new Response(
      JSON.stringify({ error: 'Conflict: Replay attack detected. Nonce has already been consumed.' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } }
    );
  }
  localNonceCache.set(operationKey, now);

  const serviceToken = await getServiceAccountAccessToken(env);
  if (!serviceToken) {
    localNonceCache.delete(operationKey);
    return new Response(
      JSON.stringify({
        error: 'Game outcome verification is temporarily disabled: Authoritative service account credentials (FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY) are required in Cloudflare Secrets.'
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const sessionRpm = Number(rpm) || 0;
  const awardedEntertainmentPoints = 25; // Decoupled recreational points
  const timestamp = new Date().toISOString();
  const sessionId = `session_${now}_${getRandomHex(4)}`;

  const signaturePayload = `${user.uid}:${gameType}:${awardedEntertainmentPoints}:${nonce}:${timestamp}`;
  const serverSignature = await computeHmacSha256Hex(secret, signaturePayload);

  const projectId = env.FIREBASE_PROJECT_ID || 'spinnermine-cloud-production';
  const databaseId = env.FIRESTORE_DATABASE_ID || '(default)';
  const docRoot = `projects/${projectId}/databases/${databaseId}/documents`;

  const writes = [
    {
      update: {
        name: `${docRoot}/usedNonces/${operationKey}`,
        fields: {
          nonce: toFirestoreValue(nonce),
          userId: toFirestoreValue(user.uid),
          gameType: toFirestoreValue(gameType),
          operationKey: toFirestoreValue(operationKey),
          consumedAt: toFirestoreValue(timestamp)
        }
      },
      currentDocument: { exists: false }
    },
    {
      update: {
        name: `${docRoot}/spinnerSessions/${sessionId}`,
        fields: {
          sessionId: toFirestoreValue(sessionId),
          userId: toFirestoreValue(user.uid),
          duration: toFirestoreValue(sessionDuration),
          recreationalTelemetryRpm: toFirestoreValue(Math.min(10000, Math.max(0, sessionRpm))),
          entertainmentPoints: toFirestoreValue(awardedEntertainmentPoints),
          timestamp: toFirestoreValue(timestamp),
          verified: toFirestoreValue(true),
          serverSignature: toFirestoreValue(serverSignature),
          nonce: toFirestoreValue(nonce),
          serverVerified: toFirestoreValue(true),
          cryptocurrencyAwarded: toFirestoreValue(0),
          createdAt: toFirestoreValue(timestamp)
        }
      }
    },
    {
      transform: {
        document: `${docRoot}/userArcade/${user.uid}`,
        fieldTransforms: [
          {
            fieldPath: 'totalArcadePoints',
            increment: { integerValue: String(awardedEntertainmentPoints) }
          },
          {
            fieldPath: 'lastSpinnerAt',
            setToServerValue: 'REQUEST_TIME'
          }
        ]
      }
    }
  ];

  try {
    await commitWrites(writes, serviceToken, env);

    return new Response(
      JSON.stringify({
        verified: true,
        sessionId,
        uid: user.uid,
        gameType,
        awardedEntertainmentPoints,
        cryptocurrencyAwarded: 0,
        nonce,
        timestamp,
        serverSignature
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    if (err.status === 409 || err.message?.includes('ALREADY_EXISTS') || err.raw?.includes('ALREADY_EXISTS')) {
      return new Response(
        JSON.stringify({ error: 'Conflict: Replay attack detected. Nonce has already been consumed for this user and game.' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }
    localNonceCache.delete(operationKey);
    console.error('[Spinner Session] Atomic commit failed:', err);
    return new Response(
      JSON.stringify({ error: 'Internal Server Error: Failed to atomically verify and record session outcome in ledger.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
