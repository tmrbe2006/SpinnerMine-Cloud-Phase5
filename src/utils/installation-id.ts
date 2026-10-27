/**
 * SpinnerMine Cloud - Installation Identity & Deduplication Utilities
 *
 * Implements:
 * 1. Persistent, tamper-evident Installation ID per Windows/Browser installation.
 * 2. Deterministic Worker ID generation linked to (installationId, userId).
 * 3. Identification of duplicate worker registrations.
 * 4. Safe UI short representations.
 */

import { MiningWorker } from '../types';

const STORAGE_KEY_INSTALLATION_ID = 'spinnermine_installation_id';

let cachedInstallationId: string | null = null;

/**
 * Resets the in-memory cache for deterministic test suites.
 */
export function _resetInstallationIdCacheForTesting(): void {
  cachedInstallationId = null;
}

/**
 * Generates a cryptographically secure UUID installation ID prefixed with inst_
 */
export function generateRandomInstallationId(): string {
  if (typeof crypto !== 'undefined') {
    if (typeof crypto.randomUUID === 'function') {
      return `inst_${crypto.randomUUID()}`;
    }
    if (typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      return `inst_${hex}`;
    }
  }
  const part1 = Math.random().toString(16).slice(2, 10);
  const part2 = Date.now().toString(16).slice(-8);
  return `inst_${part1}${part2}`;
}

/**
 * Checks if a given string is a valid permanent installation identifier.
 */
export function isPermanentInstallationId(id?: string | null): boolean {
  if (!id || typeof id !== 'string') return false;
  const clean = id.trim();
  return clean.startsWith('inst_') && clean.length >= 10;
}

/**
 * Retrieves the stable installation ID for the current running client.
 * In Electron: loads from persistent device-identity.json / settings via native IPC.
 * In Web/Browser fallback: loads from localStorage or initializes a persistent one.
 */
export async function getDeviceInstallationId(): Promise<string> {
  // 1. Electron Native Desktop IPC (Authoritative hardware / local data space)
  if (typeof window !== 'undefined') {
    const api = (window as any).electronMiningAPI || (window as any).electronAPI;
    if (api && typeof api.getInstallationId === 'function') {
      try {
        const id = await api.getInstallationId();
        if (id && typeof id === 'string' && isPermanentInstallationId(id)) {
          cachedInstallationId = id;
          return id;
        }
      } catch (err) {
        console.warn('[InstallationId] Electron IPC failed, falling back to local storage:', err);
      }
    }
  }

  // 2. In-Memory Cache Check
  if (cachedInstallationId && isPermanentInstallationId(cachedInstallationId)) {
    return cachedInstallationId;
  }

  // 2. Browser Storage Fallback
  try {
    if (typeof localStorage !== 'undefined') {
      let stored = localStorage.getItem(STORAGE_KEY_INSTALLATION_ID);
      if (!stored || !isPermanentInstallationId(stored)) {
        stored = generateRandomInstallationId();
        localStorage.setItem(STORAGE_KEY_INSTALLATION_ID, stored);
      }
      cachedInstallationId = stored;
      return stored;
    }
  } catch {
    // Memory fallback
  }

  const fallback = generateRandomInstallationId();
  cachedInstallationId = fallback;
  return fallback;
}

/**
 * Returns a short, readable representation of an Installation ID (e.g. "inst_...b4c2")
 */
export function getShortInstallationId(installationId?: string | null): string {
  if (!installationId || typeof installationId !== 'string') {
    return 'N/A';
  }
  const clean = installationId.trim();
  if (clean.length <= 12) {
    return clean;
  }
  return `${clean.slice(0, 7)}...${clean.slice(-4)}`;
}

/**
 * Computes deterministic worker ID based strictly on (userId, installationId),
 * completely decoupled from user-entered mutable device names.
 */
export function deriveWorkerIdFromInstallation(userId: string, installationId: string): string {
  const safeUser = userId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
  const safeInst = installationId.replace(/[^a-zA-Z0-9]/g, '').slice(-8);
  return `w_${safeUser}_${safeInst}`;
}

export interface DuplicateGroup {
  primaryWorker: MiningWorker;
  duplicateWorkers: MiningWorker[];
  reason: 'same_installation_id' | 'legacy_device_alias' | 'same_name';
}

/**
 * Analyzes a list of workers for the current user and groups duplicates.
 * Preserves 'tm' (w_qBPFqVEe_tm) as primary when paired with 'ty' (w_GyAldfJ5_ty).
 */
export function detectDuplicateWorkers(workers: MiningWorker[]): DuplicateGroup[] {
  const activeWorkers = workers.filter(w => !w.isArchived && !w.mergedInto && w.status !== 'archived');
  const groups: DuplicateGroup[] = [];
  const handledIds = new Set<string>();

  // 1. Group by identical installationId
  const byInstallation = new Map<string, MiningWorker[]>();
  for (const w of activeWorkers) {
    if (w.installationId) {
      const list = byInstallation.get(w.installationId) || [];
      list.push(w);
      byInstallation.set(w.installationId, list);
    }
  }

  for (const [_, list] of byInstallation.entries()) {
    if (list.length > 1) {
      // Pick primary: prefer 'tm' or older createdAt or more acceptedShares
      const sorted = [...list].sort((a, b) => {
        // Explicit primary requirement: 'tm' or w_qBPFqVEe_tm is always primary
        if (a.workerId === 'w_qBPFqVEe_tm' || a.name === 'tm') return -1;
        if (b.workerId === 'w_qBPFqVEe_tm' || b.name === 'tm') return 1;
        const sharesDiff = (b.acceptedShares || 0) - (a.acceptedShares || 0);
        if (sharesDiff !== 0) return sharesDiff;
        return (a.createdAt || '').localeCompare(b.createdAt || '');
      });

      const primary = sorted[0];
      const duplicates = sorted.slice(1);
      groups.push({
        primaryWorker: primary,
        duplicateWorkers: duplicates,
        reason: 'same_installation_id'
      });
      list.forEach(w => handledIds.add(w.workerId || w.id || ''));
    }
  }

  // 2. Detect legacy duplicate pair (tm vs ty) or same platform & hardware without installationId
  const unhandled = activeWorkers.filter(w => !handledIds.has(w.workerId || w.id || ''));
  
  // Specific known legacy pair: tm (w_qBPFqVEe_tm) and ty (w_GyAldfJ5_ty)
  const tmWorker = unhandled.find(w => w.workerId === 'w_qBPFqVEe_tm' || w.name === 'tm');
  const tyWorker = unhandled.find(w => w.workerId === 'w_GyAldfJ5_ty' || w.name === 'ty');

  if (tmWorker && tyWorker && tmWorker.workerId !== tyWorker.workerId) {
    groups.push({
      primaryWorker: tmWorker,
      duplicateWorkers: [tyWorker],
      reason: 'legacy_device_alias'
    });
    handledIds.add(tmWorker.workerId || tmWorker.id || '');
    handledIds.add(tyWorker.workerId || tyWorker.id || '');
  }

  return groups;
}
