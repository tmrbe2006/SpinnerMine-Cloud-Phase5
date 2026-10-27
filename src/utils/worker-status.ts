/**
 * SpinnerMine Cloud - Phase 2B Worker Real-Time Status & Diagnostics
 *
 * Implements:
 * 1. 3-Minute Offline Threshold: A worker is Online if lastSeen <= 180 seconds, Offline otherwise.
 * 2. Independent Statuses: registered, online, offline, mining, error.
 * 3. Online does NOT imply Mining.
 * 4. Human-readable bilingual localized lastSeen format (Arabic & English).
 */

import { MiningWorker, WorkerStatus } from '../types';

export const HEARTBEAT_INTERVAL_MS = 60 * 1000; // 60 seconds
export const OFFLINE_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes (180 seconds)

export type ComputedStatus = 'registered' | 'online' | 'offline' | 'mining' | 'error' | 'pending_sync' | 'archived';

/**
 * Computes the real-time status of a mining worker.
 * Evaluates the 3-minute heartbeat threshold authoritatively.
 */
export function computeWorkerStatus(worker: MiningWorker, nowMs: number = Date.now()): ComputedStatus {
  if (worker.isArchived || worker.status === 'archived' || Boolean(worker.mergedInto)) {
    return 'archived';
  }

  if (worker.isPendingSync || worker.status === 'pending_sync') {
    return 'pending_sync';
  }

  if (worker.status === 'error' || Boolean(worker.lastError && worker.status !== 'mining')) {
    return 'error';
  }

  if (!worker.lastSeen) {
    return 'registered';
  }

  const lastSeenMs = new Date(worker.lastSeen).getTime();
  if (isNaN(lastSeenMs)) {
    return 'registered';
  }

  const diffMs = nowMs - lastSeenMs;

  // If no heartbeat within 3 minutes (180s), device is strictly Offline
  if (diffMs > OFFLINE_THRESHOLD_MS) {
    return 'offline';
  }

  // Heartbeat is fresh (< 3 minutes)
  // Online is independent of mining!
  if (worker.status === 'mining') {
    return 'mining';
  }

  return 'online';
}

/**
 * Formats the last seen timestamp into human-readable relative time.
 */
export function formatLastSeen(
  lastSeen: string | undefined | null,
  language: 'ar' | 'en' = 'en',
  nowMs: number = Date.now()
): string {
  if (!lastSeen) {
    return language === 'ar' ? 'لم يتصل بعد' : 'Never connected';
  }

  const dateMs = new Date(lastSeen).getTime();
  if (isNaN(dateMs)) {
    return language === 'ar' ? 'غير معروف' : 'Unknown';
  }

  const diffSeconds = Math.max(0, Math.floor((nowMs - dateMs) / 1000));
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (language === 'ar') {
    if (diffSeconds < 60) {
      return 'متصل الآن';
    }
    if (diffMinutes === 1) {
      return 'منذ دقيقة';
    }
    if (diffMinutes === 2) {
      return 'منذ دقيقتين';
    }
    if (diffMinutes >= 3 && diffMinutes <= 10) {
      return `منذ ${diffMinutes} دقائق`;
    }
    if (diffMinutes < 60) {
      return `منذ ${diffMinutes} دقيقة`;
    }
    if (diffHours === 1) {
      return 'منذ ساعة';
    }
    if (diffHours === 2) {
      return 'منذ ساعتين';
    }
    if (diffHours >= 3 && diffHours <= 10) {
      return `منذ ${diffHours} ساعات`;
    }
    if (diffHours < 24) {
      return `منذ ${diffHours} ساعة`;
    }
    if (diffDays === 1) {
      return 'منذ يوم';
    }
    if (diffDays === 2) {
      return 'منذ يومين';
    }
    return `منذ ${diffDays} يوم`;
  }

  // English
  if (diffSeconds < 60) {
    return 'Online now';
  }
  if (diffMinutes === 1) {
    return '1 minute ago';
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} minutes ago`;
  }
  if (diffHours === 1) {
    return '1 hour ago';
  }
  if (diffHours < 24) {
    return `${diffHours} hours ago`;
  }
  if (diffDays === 1) {
    return 'Yesterday';
  }
  return `${diffDays} days ago`;
}

/**
 * Returns badge label and visual styling based on computed status.
 */
export function getStatusBadgeConfig(
  status: ComputedStatus,
  language: 'ar' | 'en' = 'en'
): { label: string; badgeClass: string; dotClass: string } {
  switch (status) {
    case 'mining':
      return {
        label: language === 'ar' ? 'التعدين نشط' : 'Mining Active',
        badgeClass: 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/40',
        dotClass: 'bg-emerald-400 animate-pulse'
      };
    case 'online':
      return {
        label: language === 'ar' ? 'متصل (جاهز)' : 'Online (Ready)',
        badgeClass: 'bg-sky-950/60 text-sky-400 border border-sky-500/40',
        dotClass: 'bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.6)]'
      };
    case 'offline':
      return {
        label: language === 'ar' ? 'غير متصل' : 'Offline',
        badgeClass: 'bg-slate-900 text-slate-400 border border-slate-700/80',
        dotClass: 'bg-slate-500'
      };
    case 'registered':
      return {
        label: language === 'ar' ? 'مسجل (بانتظار النبض)' : 'Registered (Standby)',
        badgeClass: 'bg-indigo-950/60 text-indigo-300 border border-indigo-500/30',
        dotClass: 'bg-indigo-400'
      };
    case 'error':
      return {
        label: language === 'ar' ? 'خطأ في الجهاز' : 'Error',
        badgeClass: 'bg-rose-950/60 text-rose-300 border border-rose-500/40',
        dotClass: 'bg-rose-500 animate-ping'
      };
    case 'archived':
      return {
        label: language === 'ar' ? 'مؤرشف (مكرر)' : 'Archived (Duplicate)',
        badgeClass: 'bg-zinc-900/80 text-zinc-400 border border-zinc-700/80',
        dotClass: 'bg-zinc-600'
      };
    case 'pending_sync':
    default:
      return {
        label: language === 'ar' ? 'مسودة محلية (قيد المزامنة)' : 'Pending Sync',
        badgeClass: 'bg-amber-950/60 text-amber-300 border border-amber-500/40',
        dotClass: 'bg-amber-400 animate-pulse'
      };
  }
}
