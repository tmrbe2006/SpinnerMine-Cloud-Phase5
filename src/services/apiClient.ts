/**
 * SpinnerMine Cloud - Centralized Cross-Platform API Client
 *
 * Implements:
 * 1. Web vs Electron runtime environment isolation.
 * 2. In Web: uses relative routes (e.g. /api/mining/pool-config).
 * 3. In Electron: uses secure HTTPS backend endpoint (from VITE_BACKEND_API_URL or production Cloud Run).
 * 4. file:// URL prohibition: strictly prevents relative API calls resolving to file:///...
 * 5. Access token leak prevention: strictly validates that destination origin is a trusted backend
 *    before attaching 'Authorization: Bearer <token>'.
 * 6. Graceful degradation: network failures or backend offline states return structured fallbacks
 *    and clear error notices without throwing unhandled exceptions that blank or crash the UI.
 */

import { MiningWorker } from '../types';

// Trusted backend origins permitted to receive Firebase ID tokens
// In production or Electron runtime:
// Configure your deployed Cloud Run endpoint in spinnermine-cloud-production via:
// 1. localStorage.setItem('spinnermine_backend_api_url', 'https://your-cloudrun-service.run.app')
// 2. Or environment variable VITE_BACKEND_API_URL
export const DEFAULT_PRODUCTION_BACKEND_URL = 'https://spinnermine-backend.tmrbe2006.workers.dev';

const DEFAULT_TRUSTED_ORIGINS = [
  'https://spinnermine-backend.tmrbe2006.workers.dev',
  'https://spinnermine-cloud-production.web.app',
  'https://spinnermine-cloud-production.firebaseapp.com',
  'https://spinnermine-cloud.web.app',
  'https://spinnermine-cloud.firebaseapp.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

/**
 * Resolves the appropriate backend base URL based on runtime environment.
 * 1. Checks custom override in localStorage ('spinnermine_backend_api_url')
 * 2. Checks environment variable VITE_BACKEND_API_URL
 * 3. Web (http/https): returns empty string for relative paths
 * 4. Electron (file://): returns empty string if unconfigured, prompting user in Diagnostics
 */
// In-memory fallback for environments without window.localStorage (e.g. Node.js unit tests)
const memoryStorage: Record<string, string> = {};

export function getCustomBackendUrl(): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('spinnermine_backend_api_url');
    }
    return memoryStorage['spinnermine_backend_api_url'] || null;
  } catch {
    return memoryStorage['spinnermine_backend_api_url'] || null;
  }
}

/**
 * Persists or clears a custom backend API URL override with strict validation.
 */
export function setCustomBackendUrl(url: string | null): boolean {
  try {
    if (!url || !url.trim()) {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('spinnermine_backend_api_url');
      }
      delete memoryStorage['spinnermine_backend_api_url'];
      return true;
    }
    const cleanUrl = url.trim().replace(/\/+$/, '');
    const parsed = new URL(cleanUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    if (host === '169.254.169.254' || host.includes('metadata.google.internal')) {
      return false;
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('spinnermine_backend_api_url', cleanUrl);
    }
    memoryStorage['spinnermine_backend_api_url'] = cleanUrl;
    return true;
  } catch {
    return false;
  }
}

export function getBackendBaseUrl(): string {
  // 1. User or admin custom configured backend URL (highest priority)
  try {
    const customUrl = getCustomBackendUrl();
    if (customUrl && typeof customUrl === 'string' && (customUrl.startsWith('https://') || customUrl.startsWith('http://'))) {
      return customUrl.replace(/\/+$/, '');
    }
  } catch {}

  // 2. Check environment variable VITE_BACKEND_API_URL
  const envUrl = typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_API_URL;
  if (envUrl && typeof envUrl === 'string' && (envUrl.startsWith('https://') || envUrl.startsWith('http://'))) {
    return envUrl.replace(/\/+$/, '');
  }

  // 3. Electron desktop or file:// environment: ALWAYS return production Cloudflare backend
  const isElectronOrFile = typeof window !== 'undefined' && (
    Boolean(window.electronAPI || window.electronMiningAPI) ||
    window.location.protocol === 'file:'
  );
  if (isElectronOrFile) {
    return DEFAULT_PRODUCTION_BACKEND_URL;
  }

  // 4. Web runtime (http/https): relative endpoints are preferred and work directly on same origin
  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
    return '';
  }

  // 5. Default fallback to production backend
  return DEFAULT_PRODUCTION_BACKEND_URL;
}

/**
 * Validates whether a target URL belongs to a trusted backend origin
 * before transmitting sensitive authorization headers.
 */
export function isTrustedOrigin(urlStr: string): boolean {
  try {
    // Relative URLs in standard web are on the current origin
    if (urlStr.startsWith('/') && typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
      return true;
    }

    const currentOrigin = typeof window !== 'undefined' && window.location.origin.startsWith('http') 
      ? window.location.origin 
      : 'http://localhost:3000';

    const parsed = new URL(urlStr, currentOrigin);

    // file:// is NEVER trusted for sending authorization headers
    if (parsed.protocol === 'file:') {
      return false;
    }

    // SSRF protection: Never trust cloud metadata or non-local internal IPs
    const host = parsed.hostname.toLowerCase();
    if (host === '169.254.169.254' || host.includes('metadata.google.internal')) {
      return false;
    }

    // Explicitly trusted default origins
    if (DEFAULT_TRUSTED_ORIGINS.includes(parsed.origin)) {
      return true;
    }

    // Trust Cloud Run services, Firebase hosting, local development ports,
    // and verified SpinnerMine Cloudflare Workers endpoints
    if (
      (host.endsWith('.workers.dev') && host.includes('spinnermine')) ||
      host.endsWith('.run.app') ||
      host.endsWith('.web.app') ||
      host.endsWith('.firebaseapp.com') ||
      host === 'localhost' ||
      host === '127.0.0.1'
    ) {
      return true;
    }

    // Check against configured backend or default origins,
    // but strictly verify that the configured host matches safe domain patterns
    // to prevent arbitrary user-supplied URLs from receiving Firebase tokens
    const backendBase = getBackendBaseUrl();
    if (backendBase) {
      try {
        const backendParsed = new URL(backendBase);
        const bHost = backendParsed.hostname.toLowerCase();
        const isSafeConfiguredHost =
          (bHost.endsWith('.workers.dev') && bHost.includes('spinnermine')) ||
          bHost.endsWith('.run.app') ||
          bHost.endsWith('.web.app') ||
          bHost.endsWith('.firebaseapp.com') ||
          bHost === 'localhost' ||
          bHost === '127.0.0.1';

        if (isSafeConfiguredHost && parsed.origin === backendParsed.origin) {
          return true;
        }
      } catch {}
    }

    return false;
  } catch {
    return false;
  }
}

export interface ApiResponse<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

/**
 * Cross-platform fetch wrapper that prevents file:// resolutions,
 * routes Electron to HTTPS backend, and guards auth token transmission.
 */
export async function apiFetch<T = any>(
  endpoint: string,
  options: RequestInit = {},
  authToken?: string
): Promise<ApiResponse<T>> {
  const isElectronOrFile = typeof window !== 'undefined' && (
    Boolean(window.electronAPI || window.electronMiningAPI) ||
    window.location.protocol === 'file:'
  );

  let targetUrl: string;
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    targetUrl = endpoint;
  } else if (isElectronOrFile) {
    const base = getBackendBaseUrl() || DEFAULT_PRODUCTION_BACKEND_URL;
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    targetUrl = `${base}${cleanEndpoint}`;
  } else {
    // Standard web relative call
    targetUrl = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  }

  // Strict check: NEVER allow file:// API calls
  if (targetUrl.startsWith('file:')) {
    console.error(`[API Client] Blocked illegal file:// API call: ${targetUrl}`);
    return {
      ok: false,
      status: 0,
      data: null,
      error: 'Cannot make API requests using file:// protocol. Valid HTTPS backend is required.'
    };
  }

  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  // Security check: Only attach Authorization header if destination is trusted
  if (authToken) {
    if (isTrustedOrigin(targetUrl)) {
      headers.set('Authorization', `Bearer ${authToken}`);
    } else {
      console.warn(`[API Client] Refusing to attach Authorization token to untrusted destination: ${targetUrl}`);
    }
  }

  try {
    const res = await fetch(targetUrl, {
      ...options,
      headers
    });

    if (!res.ok) {
      let errorMsg = `Server returned HTTP ${res.status}`;
      try {
        const errorJson = await res.json();
        if (errorJson.error) errorMsg = errorJson.error;
      } catch {}
      return {
        ok: false,
        status: res.status,
        data: null,
        error: errorMsg
      };
    }

    const data = await res.json();
    return {
      ok: true,
      status: res.status,
      data,
      error: undefined
    };
  } catch (err: any) {
    // Network offline / unreachable - handle gracefully
    console.warn(`[API Client] Network notice for ${targetUrl}: ${err.message || 'offline'}`);
    return {
      ok: false,
      status: 0,
      data: null,
      error: err.message || 'Backend server is unreachable (offline mode)'
    };
  }
}

export interface PoolConfigResult {
  configured: boolean;
  poolHost: string;
  poolPort: number;
  tlsEnabled: boolean;
  walletAddress: string;
  algorithm: string;
  coin: string;
  userSplitRatio: number;
  platformSplitRatio: number;
  notice?: string;
  isOffline?: boolean;
}

/**
 * Retrieves Stratum mining pool configuration with automatic offline fallback.
 */
export async function getPoolConfig(): Promise<PoolConfigResult> {
  const result = await apiFetch<any>('/api/mining/pool-config', { method: 'GET' });
  if (result.ok && result.data) {
    return {
      configured: Boolean(result.data.configured),
      poolHost: result.data.poolHost || 'pool.supportxmr.com',
      poolPort: Number(result.data.poolPort) || 3333,
      tlsEnabled: Boolean(result.data.tlsEnabled),
      walletAddress: result.data.walletAddress || '',
      algorithm: result.data.algorithm || 'rx/0',
      coin: result.data.coin || 'monero',
      userSplitRatio: result.data.userSplitRatio ?? 0.20,
      platformSplitRatio: result.data.platformSplitRatio ?? 0.80,
      notice: result.data.notice,
      isOffline: false
    };
  }

  // Graceful fallback for offline / backend unavailable mode
  return {
    configured: false,
    poolHost: 'pool.supportxmr.com',
    poolPort: 3333,
    tlsEnabled: false,
    walletAddress: '',
    algorithm: 'rx/0',
    coin: 'monero',
    userSplitRatio: 0.20,
    platformSplitRatio: 0.80,
    notice: 'Backend unreachable. Using local standalone configuration (offline mode).',
    isOffline: true
  };
}

/**
 * Tests Stratum pool TCP/TLS reachability via local Electron IPC (if available) or Backend proxy.
 */
export async function testPoolConnection(
  host: string,
  port: number,
  tls: boolean
): Promise<{ success: boolean; latencyMs?: number; error?: string }> {
  // If Electron native testPool IPC is available, test directly via Node net/tls
  if (typeof window !== 'undefined' && window.electronAPI?.testPool) {
    try {
      return await window.electronAPI.testPool({ host, port, tls });
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  const result = await apiFetch<{ success: boolean; latencyMs?: number; error?: string }>(
    '/api/mining/test-pool',
    {
      method: 'POST',
      body: JSON.stringify({ host, port, tls })
    }
  );

  if (result.ok && result.data) {
    return result.data;
  }
  return {
    success: false,
    error: result.error || 'Pool connection test service is currently unreachable'
  };
}

/**
 * Registers or updates worker registration with the backend.
 */
export async function registerWorker(
  payload: any,
  idToken?: string
): Promise<{ success: boolean; worker?: any; error?: string; status: number; message?: string }> {
  const result = await apiFetch<{ success: boolean; worker?: any; error?: string; message?: string }>(
    '/api/workers/register',
    {
      method: 'POST',
      body: JSON.stringify(payload)
    },
    idToken
  );

  if (result.ok && result.data) {
    return {
      success: true,
      worker: result.data.worker,
      message: result.data.message,
      status: result.status
    };
  }
  return {
    success: false,
    status: result.status,
    error: result.error || 'Worker registration offline'
  };
}

export interface WorkerHeartbeatPayload {
  workerId: string;
  status?: 'registered' | 'online' | 'offline' | 'mining' | 'paused' | 'error';
  cpuUsage?: number;
  threads?: number;
  reportedHashrate?: number;
  idToken?: string;
}

/**
 * Transmits worker telemetry metrics to the backend.
 */
export async function sendWorkerTelemetry(
  payload: any,
  idToken?: string
): Promise<{ success: boolean; workerId?: string; error?: string; status?: string; timestamp?: string; financialBalanceImpact?: number }> {
  const result = await apiFetch<{ success: boolean; workerId?: string; error?: string; status?: string; timestamp?: string; financialBalanceImpact?: number }>(
    '/api/workers/telemetry',
    {
      method: 'POST',
      body: JSON.stringify(payload)
    },
    idToken
  );

  if (result.ok && result.data) {
    return result.data;
  }
  return {
    success: false,
    error: result.error || 'Telemetry reporting offline'
  };
}

/**
 * Transmits real-time worker heartbeat (every 60s while running or manually via Test Heartbeat)
 */
export async function sendWorkerHeartbeat(
  payload: WorkerHeartbeatPayload,
  idToken?: string
): Promise<{ success: boolean; workerId?: string; error?: string; status?: string; timestamp?: string; financialBalanceImpact?: number }> {
  const effectiveToken = idToken || payload.idToken;
  return sendWorkerTelemetry({
    workerId: payload.workerId,
    status: payload.status || 'online',
    cpuUsage: payload.cpuUsage,
    threads: payload.threads,
    reportedHashrate: payload.reportedHashrate || 0
  }, effectiveToken);
}

/**
 * Checks backend health and Firebase connectivity status.
 */
export async function checkBackendHealth(targetUrl?: string): Promise<{
  ok: boolean;
  status: number;
  data?: any;
  error?: string;
  latencyMs: number;
}> {
  const start = Date.now();
  const endpoint = targetUrl ? `${targetUrl.replace(/\/+$/, '')}/api/health` : '/api/health';
  const res = await apiFetch<any>(endpoint, { method: 'GET' });
  const latencyMs = Date.now() - start;
  return {
    ok: res.ok,
    status: res.status,
    data: res.data,
    error: res.error,
    latencyMs
  };
}

/**
 * Fetches detected duplicate worker candidates and session audit details.
 */
export async function getDuplicateWorkers(idToken?: string): Promise<{
  success: boolean;
  duplicatesFound: boolean;
  groups: Array<{
    primaryWorkerId: string;
    primaryName: string;
    duplicateWorkerId: string;
    duplicateName: string;
    reason: string;
    duplicateSessionsCount: number;
    duplicateAcceptedShares: number;
  }>;
  error?: string;
}> {
  const res = await apiFetch<any>('/api/workers/duplicates', { method: 'GET' }, idToken);
  if (res.ok && res.data) {
    return res.data;
  }
  return {
    success: false,
    duplicatesFound: false,
    groups: [],
    error: res.error || 'Failed to inspect duplicate workers'
  };
}

/**
 * Safely archives a duplicate or inactive worker without deleting documents or mutating financials.
 */
export async function archiveWorker(
  workerId: string,
  reason?: string,
  idToken?: string
): Promise<{ success: boolean; workerId?: string; message?: string; error?: string }> {
  // Requirement 4: Strictly disallow dispatch if missing or invalid token
  if (!idToken || typeof idToken !== 'string' || !idToken.trim()) {
    return {
      success: false,
      error: 'Missing or invalid Firebase authentication token. Please sign in.'
    };
  }

  const res = await apiFetch<any>(
    '/api/workers/archive',
    {
      method: 'POST',
      body: JSON.stringify({ workerId, reason })
    },
    idToken.trim()
  );
  if (res.ok && res.data) {
    return res.data;
  }
  return {
    success: false,
    error: res.error || 'Failed to archive worker'
  };
}

/**
 * Safely merges a duplicate worker into a primary worker with audit tracking.
 */
export async function mergeWorkers(
  primaryWorkerId: string,
  secondaryWorkerId: string,
  reason?: string,
  idToken?: string
): Promise<{ 
  success: boolean; 
  primaryWorkerId?: string; 
  mergedWorkerId?: string; 
  message?: string; 
  error?: string;
  retainedAcceptedShares?: number;
  auditedSessionsCount?: number;
}> {
  // Requirement 4: Strictly disallow dispatch if missing or invalid token
  if (!idToken || typeof idToken !== 'string' || !idToken.trim()) {
    return {
      success: false,
      error: 'Missing or invalid Firebase authentication token. Please sign in.'
    };
  }

  const res = await apiFetch<any>(
    '/api/workers/merge',
    {
      method: 'POST',
      body: JSON.stringify({ primaryWorkerId, secondaryWorkerId, reason })
    },
    idToken.trim()
  );
  if (res.ok && res.data) {
    return res.data;
  }
  return {
    success: false,
    error: res.error || 'Failed to merge workers'
  };
}

/**
 * Renames a worker without modifying the persistent workerId.
 */
export async function renameWorker(
  workerId: string,
  name: string,
  deviceName?: string,
  idToken?: string
): Promise<{ success: boolean; workerId?: string; name?: string; message?: string; error?: string }> {
  const res = await apiFetch<any>(
    '/api/workers/rename',
    {
      method: 'POST',
      body: JSON.stringify({ workerId, name, deviceName })
    },
    idToken
  );
  if (res.ok && res.data) {
    return res.data;
  }
  return {
    success: false,
    error: res.error || 'Failed to rename worker'
  };
}

/**
 * Links a permanent installation ID to an existing worker with user consent and authentication.
 */
export async function linkWorkerInstallation(
  workerId: string,
  installationId: string,
  idToken?: string,
  consentConfirmed: boolean = true
): Promise<{
  success: boolean;
  workerId?: string;
  installationId?: string;
  name?: string;
  retainedAcceptedShares?: number;
  financialBalanceImpact?: number;
  message?: string;
  error?: string;
}> {
  if (!idToken || typeof idToken !== 'string' || !idToken.trim()) {
    return {
      success: false,
      error: 'Missing or invalid Firebase authentication token. Please sign in.'
    };
  }

  const res = await apiFetch<any>(
    '/api/workers/link-installation',
    {
      method: 'POST',
      body: JSON.stringify({ workerId, installationId, consentConfirmed })
    },
    idToken.trim()
  );
  if (res.ok && res.data) {
    return res.data;
  }
  return {
    success: false,
    error: res.error || 'Failed to link installation ID'
  };
}

/**
 * Fetches all registered workers for the authenticated user via backend API.
 * Serves as an authoritative fallback if direct Firestore subscriptions encounter index or permission issues.
 */
export async function fetchUserWorkers(idToken?: string): Promise<{
  success: boolean;
  workers?: MiningWorker[];
  error?: string;
}> {
  if (!idToken || !idToken.trim()) {
    return { success: false, error: 'Firebase authentication token is required' };
  }
  const res = await apiFetch<{ success: boolean; workers: MiningWorker[] }>(
    '/api/workers',
    { method: 'GET' },
    idToken.trim()
  );
  if (res.ok && res.data) {
    return { success: true, workers: res.data.workers || [] };
  }
  return {
    success: false,
    error: res.error || 'Failed to fetch workers from backend API'
  };
}

export const apiClient = {
  getBackendBaseUrl,
  setCustomBackendUrl,
  getCustomBackendUrl,
  checkBackendHealth,
  isTrustedOrigin,
  fetch: apiFetch,
  getPoolConfig,
  testPoolConnection,
  registerWorker,
  sendWorkerTelemetry,
  sendWorkerHeartbeat,
  getDuplicateWorkers,
  archiveWorker,
  mergeWorkers,
  renameWorker,
  linkWorkerInstallation,
  fetchUserWorkers
};
