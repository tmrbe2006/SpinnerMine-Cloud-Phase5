/**
 * SpinnerMine Cloud - Mining Engine Controller Types & Interfaces (Phase 2C)
 * 
 * Defines standard interfaces for mining engines (Mock and Real),
 * strict state machines, command audit logs, and security isolation.
 */

export type MiningEngineState = 
  | 'STOPPED'
  | 'STARTING'
  | 'RUNNING'
  | 'PAUSED'
  | 'STOPPING'
  | 'ERROR';

export type MiningEngineType = 'mock' | 'real';

export type MiningEngineCommand = 
  | 'START'
  | 'STOP'
  | 'PAUSE'
  | 'RESUME'
  | 'RESET_ERROR'
  | 'EMERGENCY_STOP';

export interface MiningEngineConfig {
  workerId: string;
  userId: string;
  threads: number;
  throttle?: number; // CPU cap percentage (10-100)
  poolHost?: string;
  poolPort?: number;
  poolTls?: boolean;
  walletAddress?: string;
  workerName?: string;
  engineType?: MiningEngineType;
  executablePath?: string;
  expectedSha256?: string;
  consentAccepted?: boolean;
}

export type ShareVerificationType = 'NONE' | 'MINER_REPORTED' | 'POOL_CONFIRMED';

export interface MiningEngineTelemetry {
  engineType: MiningEngineType;
  state: MiningEngineState;
  uptimeSeconds: number;
  lastSessionDurationSeconds?: number;
  threads: number;
  cpuUsage?: number;
  /**
   * For Mock Engine, hashrate is strictly marked as simulated
   * and must be strictly 0 when not in RUNNING state (STOPPED, PAUSED, ERROR, etc.)
   */
  hashrate: number;
  hashrate10s?: number;
  hashrate60s?: number;
  hashrate15m?: number;
  averageHashrate?: number;
  /**
   * Holds the last recorded sample hashrate from the previous active session,
   * kept clearly separated from the current live hashrate.
   */
  lastRecordedHashrate?: number;
  isSimulation: boolean;
  /**
   * Strictly 0 for Mock Engine; real shares for Real Engine
   */
  acceptedShares: number;
  rejectedShares: number;
  submittedShares?: number;
  shareVerificationType?: ShareVerificationType;
  poolConfirmedShares?: number;
  poolApiStatus?: 'UNCHECKED' | 'CHECKING' | 'CONFIRMED' | 'NOT_AVAILABLE' | 'WALLET_NOT_FOUND' | 'ERROR';
  poolApiNotice?: string;
  pid?: number | null;
  poolStatus?: 'connected' | 'connecting' | 'paused' | 'disconnected' | 'error';
  poolHost?: string;
  poolPort?: number;
  jobsReceived?: number;
  activeJobId?: string;
  lastPoolResponse?: string;
  lastPoolLatencyMs?: number;
  lastError?: string;
  timestamp: string;
  isStale?: boolean;
}

export interface EngineOperationResult {
  success: boolean;
  previousState: MiningEngineState;
  currentState: MiningEngineState;
  error?: string;
  durationMs?: number;
}

export interface EngineAuditLogEntry {
  id: string;
  timestamp: string;
  command: MiningEngineCommand;
  previousState: MiningEngineState;
  nextState: MiningEngineState;
  success: boolean;
  workerId: string;
  userId: string;
  engineType: MiningEngineType;
  message?: string;
  durationMs: number;
}

export interface IMiningEngine {
  readonly engineType: MiningEngineType;
  getState(): MiningEngineState;
  getTelemetry(): MiningEngineTelemetry;
  start(config: MiningEngineConfig): Promise<EngineOperationResult>;
  stop(): Promise<EngineOperationResult>;
  pause(): Promise<EngineOperationResult>;
  resume(): Promise<EngineOperationResult>;
  resetError(): Promise<EngineOperationResult>;
  emergencyStop?(): Promise<EngineOperationResult>;
  cleanup(): Promise<void>;
  
  onStateChange(listener: (state: MiningEngineState, previous: MiningEngineState) => void): () => void;
  onTelemetry(listener: (telemetry: MiningEngineTelemetry) => void): () => void;
  onError(listener: (error: Error) => void): () => void;
  onLog(listener: (message: string) => void): () => void;
}
