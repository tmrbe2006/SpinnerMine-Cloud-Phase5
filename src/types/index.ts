export type Language = 'en' | 'ar';

export type UserRole = 'user' | 'admin';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  role: UserRole;
  language: Language;
  miningConsent: boolean;
  consentTimestamp?: string;
  consentVersion?: string;
  referralCode: string;
  referredBy?: string;
  createdAt: string;
  updatedAt: string;
}

export type WorkerPlatform = 'browser' | 'windows' | 'linux' | 'mac';
export type WorkerStatus = 'registered' | 'online' | 'offline' | 'mining' | 'paused' | 'error' | 'pending_sync' | 'archived';

export interface MiningWorker {
  id?: string;
  workerId: string;
  userId: string;
  name: string;
  deviceName?: string;
  platform: WorkerPlatform;
  xmrigVersion?: string;
  status: WorkerStatus;
  cpuCores: number;
  threads?: number;
  cpuUsage?: number;
  reportedHashrate?: number;
  acceptedShares?: number;
  rejectedShares?: number;
  sessionId?: string;
  lastError?: string;
  lastSeen?: string;
  createdAt: string;
  updatedAt?: string;
  isPendingSync?: boolean;
  syncAttemptError?: {
    status: number;
    error: string;
    timestamp: string;
  };
  installationId?: string;
  installationLinkedAt?: string;
  isArchived?: boolean;
  archivedAt?: string;
  archiveReason?: string;
  mergedInto?: string;
  mergedAt?: string;
}

export interface MiningPoolConfig {
  host: string;
  port: number;
  tls: boolean;
  walletAddress: string;
  workerName: string;
  password?: string;
  algorithm?: string;
}

export interface XMRigTelemetry {
  hashrate: number;
  hashrate10s?: number;
  hashrate60s?: number;
  hashrate15m?: number;
  acceptedShares: number;
  rejectedShares: number;
  submittedShares?: number;
  difficulty?: number;
  uptimeSeconds: number;
  threads: number;
  cpuUsage?: number;
  pid?: number | null;
  connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'error' | 'paused';
  lastPoolError?: string;
  lastPoolResponse?: string;
  jobsReceived?: number;
}

export type MiningSessionStatus = 'active' | 'paused' | 'stopped';
export type WorkerType = 'browser_wasm' | 'windows_xmrig' | 'custom';

/**
 * Untrusted Browser Telemetry:
 * Metrics submitted by the browser (such as local hash counters, hashrate gauges, and client-estimated shares)
 * are classified strictly as UNTRUSTED TELEMETRY for user display only.
 * They are NEVER used to calculate revenue, issue cryptocurrency, or determine payouts.
 */
export interface UntrustedMiningTelemetry {
  sessionId: string;
  userId: string;
  workerName: string;
  workerType: WorkerType;
  reportedHashrate: number;
  reportedHashes: number;
  submittedShares: number;
  threads: number;
  throttle: number;
  timestamp: string;
}

export interface MiningSession {
  id: string;
  userId: string;
  workerName: string;
  workerType: WorkerType;
  status: MiningSessionStatus;
  hashrate: number;
  totalHashes: number;
  acceptedShares: number; // For display purposes only; financial calculation relies strictly on AcceptedShare collection
  rejectedShares: number;
  threads: number;
  throttle: number; // 0 to 100%
  startedAt: string;
  lastHeartbeat: string;
}

/**
 * Authoritative Proof-of-Work Contribution:
 * Generated and stored exclusively by the trusted backend mining daemon/pool.
 * Financial revenue splits are calculated solely from verified AcceptedShare documents.
 */
export interface AcceptedShare {
  id: string;
  userId: string;
  workerId: string;
  difficulty: number;
  blockHeight: number;
  timestamp: string;
  verifiedByPoolDaemon: boolean;
}

export interface MiningRevenue {
  id: string;
  currency: string;
  grossRevenue: number;
  platformShare: number;
  usersShareTotal: number;
  platformSplitRatio: number; // e.g. 0.80
  userSplitRatio: number;     // e.g. 0.20
  blockOrBatchId: string;
  timestamp: string;
}

export interface UserEarning {
  id: string;
  userId: string;
  source: 'mining_share' | 'spinner_bonus' | 'wheel_bonus' | 'referral_bonus';
  currency: string;
  amount: number;
  atomicAmount: string; // Atomic units (1 XMR = 1e12 piconero) for zero floating-point error
  revenueBatchId?: string;
  timestamp: string;
}

export interface WalletLedgerEntry {
  id: string;
  userId: string;
  type: 'credit' | 'debit';
  category: 'mining' | 'reward' | 'game' | 'withdrawal' | 'adjustment';
  currency: string;
  amount: number;
  atomicUnits: string; // 1 XMR = 10^12 atomic units (piconero)
  balanceAfter: number;
  atomicBalanceAfter: string;
  idempotencyKey: string; // Prevents duplicate ledger mutations
  referenceId?: string;
  timestamp: string;
}

export type WithdrawalStatus = 'pending' | 'processing' | 'completed' | 'rejected';

export interface WithdrawalRecord {
  id: string;
  userId: string;
  currency: string;
  amount: number;
  atomicAmount: string;
  fee: number;
  destinationAddress: string;
  status: WithdrawalStatus;
  txHash?: string;
  idempotencyKey?: string;
  requestedAt: string;
  processedAt?: string;
  rejectionReason?: string;
}

export interface SpinnerSessionRecord {
  id: string;
  userId: string;
  spinsCount: number;
  topRpm: number;
  entertainmentPoints: number;
  spinnerModel: string;
  createdAt: string;
}

export interface WheelSpinRecord {
  id: string;
  userId: string;
  segmentLanded: number;
  rewardType: 'bonus_points' | 'hashrate_boost' | 'try_again';
  rewardValue: string;
  claimed: boolean;
  timestamp: string;
}

export interface RewardRecord {
  id: string;
  userId: string;
  rewardName: string;
  rewardCategory: 'daily_streak' | 'first_mine' | 'spinner_master' | 'referral_starter';
  status: 'available' | 'claimed';
  value: string;
  claimedAt?: string;
}

export interface ReferralRecord {
  id: string;
  referrerId: string;
  referredUserId: string;
  referralCode: string;
  bonusEarned: number;
  createdAt: string;
}

export interface SystemSetting {
  id: string;
  key: string;
  value: string;
  category: 'mining' | 'financial' | 'general' | 'security';
  updatedBy?: string;
  updatedAt?: string;
}

export interface AuditLogRecord {
  id: string;
  actorId: string;
  actorEmail?: string;
  action: string;
  resource: string;
  details: string;
  ipAddress?: string;
  timestamp: string;
}

export type AppPage =
  | 'landing'
  | 'login'
  | 'register'
  | 'forgot-password'
  | 'dashboard'
  | 'mining'
  | 'spinner'
  | 'wheel'
  | 'wallet'
  | 'withdrawals'
  | 'referrals'
  | 'settings'
  | 'admin';

export interface ElectronMiningAPI {
  getSystemInfo: () => Promise<{
    cpuCores: number;
    platform: string;
    arch: string;
    totalMemoryGb: number;
    installationId?: string;
  }>;
  getInstallationId?: () => Promise<string>;
  detectXMRig: () => Promise<{ found: boolean; path: string | null }>;
  selectXMRigPath: () => Promise<string | null>;
  validateXMRig: (path: string) => Promise<{ valid: boolean; reason?: string }>;
  startMining: (config: any) => Promise<{ success: boolean; error?: string }>;
  stopMining: () => Promise<{ success: boolean }>;
  pauseMining: () => Promise<{ success: boolean }>;
  resumeMining: () => Promise<{ success: boolean }>;
  getTelemetry: () => Promise<any>;
  onTelemetryUpdate: (callback: (telemetry: any) => void) => () => void;
  onMiningError: (callback: (error: string) => void) => () => void;
  saveSettings: (settings: any) => Promise<{ success: boolean }>;
  loadSettings: () => Promise<any>;
  minimizeToTray: () => Promise<void>;
  testPool?: (config: { host: string; port: number; tls?: boolean }) => Promise<{ success: boolean; latencyMs?: number; error?: string }>;
  isElectron?: boolean;
}

declare global {
  interface Window {
    electronMiningAPI?: ElectronMiningAPI;
    electronAPI?: ElectronMiningAPI;
  }
}
