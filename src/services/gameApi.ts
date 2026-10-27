/**
 * Server-Authoritative Game API Client
 * 
 * SECURITY DIRECTIVE:
 * - Outcome calculation and cryptographic signing occur on the server.
 * - Client passes Firebase ID Token; server extracts trusted UID.
 * - Rate limiting and Replay protection are enforced via cryptographic nonces.
 * - Zero fallback points: Failed server connection prevents points distribution.
 * - Strictly zero withdrawable cryptocurrency awarded from client games.
 */

import { auth } from '../firebase/config';
import { apiFetch } from './apiClient';

export interface AuthoritativeWheelResponse {
  verified: boolean;
  spinId?: string;
  uid: string;
  targetIndex: number;
  segment: {
    id: number;
    type: string;
    value: number;
    label: string;
    color: string;
  };
  awardedEntertainmentPoints: number;
  cryptocurrencyAwarded: number; // Always 0
  nonce: string;
  timestamp: string;
  serverSignature: string;
}

export interface AuthoritativeSpinnerResponse {
  verified: boolean;
  sessionId?: string;
  uid: string;
  gameType: string;
  awardedEntertainmentPoints: number;
  cryptocurrencyAwarded: number; // Always 0
  nonce: string;
  timestamp: string;
  serverSignature: string;
}

function generateCryptographicNonce(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof window !== 'undefined' && window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  // Standard RFC 4122 v4 UUID generator using crypto.getRandomValues
  const getRandomValues = (typeof crypto !== 'undefined' && crypto.getRandomValues)
    ? crypto.getRandomValues.bind(crypto)
    : (typeof window !== 'undefined' && window.crypto?.getRandomValues)
      ? window.crypto.getRandomValues.bind(window.crypto)
      : null;
  if (getRandomValues) {
    const bytes = new Uint8Array(16);
    getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new Error('Secure random source unavailable for cryptographic nonce generation');
}

/**
 * Requests a server-authoritative Wheel of Fortune spin.
 * Throws an error on authentication failure, rate limit, replay, or server rejection.
 */
export async function requestAuthoritativeWheelSpin(): Promise<AuthoritativeWheelResponse> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Authentication required: Please sign in to spin the wheel.');
  }

  const idToken = await currentUser.getIdToken();
  const nonce = generateCryptographicNonce();
  const clientTimestamp = new Date().toISOString();

  const result = await apiFetch<AuthoritativeWheelResponse>(
    '/api/games/spin-wheel',
    {
      method: 'POST',
      body: JSON.stringify({
        nonce,
        clientTimestamp
      })
    },
    idToken
  );

  if (!result.ok || !result.data) {
    throw new Error(result.error || `Spin verification failed with status ${result.status}`);
  }

  const data = result.data;
  if (!data.verified || !data.serverSignature) {
    throw new Error('Cryptographic server verification failed. Invalid outcome signature.');
  }

  return data;
}

/**
 * Submits spinner session telemetry for server-authoritative verification and points calculation.
 */
export async function verifySpinnerWithServer(params: {
  duration: number;
  rpm: number;
  maxRpm: number;
}): Promise<AuthoritativeSpinnerResponse> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Authentication required: Please sign in to verify spinner session.');
  }

  const idToken = await currentUser.getIdToken();
  const nonce = generateCryptographicNonce();
  const clientTimestamp = new Date().toISOString();

  const result = await apiFetch<AuthoritativeSpinnerResponse>(
    '/api/games/verify',
    {
      method: 'POST',
      body: JSON.stringify({
        gameType: 'spinner',
        duration: params.duration,
        rpm: params.rpm,
        maxRpm: params.maxRpm,
        nonce,
        clientTimestamp
      })
    },
    idToken
  );

  if (!result.ok || !result.data) {
    throw new Error(result.error || `Session verification failed with status ${result.status}`);
  }

  const data = result.data;
  if (!data.verified || !data.serverSignature) {
    throw new Error('Cryptographic signature verification failed.');
  }

  return data;
}
