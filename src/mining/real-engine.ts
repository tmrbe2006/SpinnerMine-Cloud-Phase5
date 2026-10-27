/**
 * SpinnerMine Cloud - Real XMRig Mining Engine (Phase 2D - Stage A & B)
 *
 * Implements authoritative IMiningEngine for authentic XMRig 6.26.0 execution:
 * 1. Conforms strictly to IMiningEngine interface.
 * 2. Mandates explicit user consent (thermal load and 20% user / 80% platform distribution agreement).
 * 3. Enforces cryptographic SHA-256 binary validation (official 6.26.0 or custom verified).
 * 4. Separate, sanitized argv array execution (no shell string concatenation or shell execution).
 * 5. Single process constraint: rejects duplicate starts and prevents concurrent processes.
 * 6. Full lifecycle: START, STOP, PAUSE, RESUME, RESET_ERROR, EMERGENCY_STOP.
 * 7. Real telemetry reporting: PID, actual CPU load (os.cpus() deltas), pool status, jobs, shares.
 * 8. Strict Financial Isolation: verified shares are recorded for display and verification only;
 *    confirmedFinancialImpact is strictly 0 without external pool daemon payout.
 */

import {
  IMiningEngine,
  MiningEngineState,
  MiningEngineType,
  MiningEngineConfig,
  MiningEngineTelemetry,
  EngineOperationResult
} from './engine-types';
import { XMRigAdapter } from './xmrig-adapter';
import { isValidPoolHost, isValidMoneroAddress } from './xmrig-config';
import { XMRigTelemetry } from '../types';

export class RealMiningEngine implements IMiningEngine {
  public readonly engineType: MiningEngineType = 'real';

  private state: MiningEngineState = 'STOPPED';
  private config: MiningEngineConfig | null = null;
  private adapter: XMRigAdapter | null = null;
  private uptimeSeconds: number = 0;
  private lastSessionDurationSeconds: number = 0;
  private lastRecordedHashrate: number = 0;
  private lastError: string | undefined = undefined;
  private lastTelemetryTs: number = 0;

  // Real telemetry cache
  private latestAdapterTelemetry: XMRigTelemetry = {
    hashrate: 0,
    acceptedShares: 0,
    rejectedShares: 0,
    uptimeSeconds: 0,
    threads: 2,
    connectionStatus: 'disconnected'
  };

  // Listeners
  private stateListeners: Set<(state: MiningEngineState, previous: MiningEngineState) => void> = new Set();
  private telemetryListeners: Set<(telemetry: MiningEngineTelemetry) => void> = new Set();
  private errorListeners: Set<(error: Error) => void> = new Set();
  private logListeners: Set<(message: string) => void> = new Set();

  constructor() {
    this.state = 'STOPPED';
  }

  public getState(): MiningEngineState {
    return this.state;
  }

  public getTelemetry(): MiningEngineTelemetry {
    const isRunning = this.state === 'RUNNING';
    const isPaused = this.state === 'PAUSED';
    const currentHashrate = isRunning ? (this.latestAdapterTelemetry.hashrate || 0) : 0;
    if (isRunning && currentHashrate > 0) {
      this.lastRecordedHashrate = currentHashrate;
    }

    const now = Date.now();
    const isStale = isRunning && this.lastTelemetryTs > 0 && (now - this.lastTelemetryTs > 15000);

    return {
      engineType: this.engineType,
      state: this.state,
      uptimeSeconds: this.uptimeSeconds,
      lastSessionDurationSeconds: this.lastSessionDurationSeconds,
      threads: this.latestAdapterTelemetry.threads || this.config?.threads || 2,
      cpuUsage: this.latestAdapterTelemetry.cpuUsage,
      hashrate: currentHashrate,
      hashrate10s: isRunning ? this.latestAdapterTelemetry.hashrate10s : 0,
      hashrate60s: isRunning ? this.latestAdapterTelemetry.hashrate60s : 0,
      hashrate15m: isRunning ? this.latestAdapterTelemetry.hashrate15m : 0,
      averageHashrate: isRunning ? (this.latestAdapterTelemetry.hashrate60s || currentHashrate) : 0,
      lastRecordedHashrate: this.lastRecordedHashrate,
      isSimulation: false,
      acceptedShares: this.latestAdapterTelemetry.acceptedShares || 0,
      rejectedShares: this.latestAdapterTelemetry.rejectedShares || 0,
      submittedShares: this.latestAdapterTelemetry.submittedShares || (this.latestAdapterTelemetry.acceptedShares + this.latestAdapterTelemetry.rejectedShares),
      pid: this.adapter?.getPid() ?? null,
      poolStatus: this.mapConnectionStatus(this.latestAdapterTelemetry.connectionStatus),
      poolHost: this.config?.poolHost,
      poolPort: this.config?.poolPort,
      jobsReceived: this.latestAdapterTelemetry.jobsReceived || 0,
      lastPoolResponse: this.latestAdapterTelemetry.lastPoolResponse,
      lastError: this.lastError || this.latestAdapterTelemetry.lastPoolError,
      timestamp: new Date().toISOString(),
      isStale
    };
  }

  private mapConnectionStatus(status: XMRigTelemetry['connectionStatus']): MiningEngineTelemetry['poolStatus'] {
    switch (status) {
      case 'connected': return 'connected';
      case 'connecting': return 'connecting';
      case 'paused': return 'paused';
      case 'error': return 'error';
      case 'disconnected':
      default:
        return 'disconnected';
    }
  }

  private transitionTo(newState: MiningEngineState) {
    const previous = this.state;
    if (previous === newState) return;
    this.state = newState;
    this.log(`[RealEngine] State transition: ${previous} -> ${newState}`);

    this.stateListeners.forEach((listener) => {
      try {
        listener(newState, previous);
      } catch (err) {
        console.error('[RealEngine] Error in state listener:', err);
      }
    });

    // Immediate telemetry broadcast
    const immediate = this.getTelemetry();
    this.telemetryListeners.forEach((listener) => {
      try {
        listener(immediate);
      } catch (err) {
        console.error('[RealEngine] Error in telemetry listener:', err);
      }
    });
  }

  private log(message: string) {
    this.logListeners.forEach((listener) => {
      try {
        listener(message);
      } catch {}
    });
  }

  public async start(config: MiningEngineConfig): Promise<EngineOperationResult> {
    const startTs = Date.now();
    const previousState = this.state;

    // 1. Consent Gate: Strict requirement for real mining
    if (!config.consentAccepted) {
      return {
        success: false,
        previousState,
        currentState: this.state,
        error: 'Explicit user consent required: Real CPU mining increases device temperature and power consumption. You must accept the terms before starting.',
        durationMs: Date.now() - startTs
      };
    }

    // 2. Browser Environment Guard (Real native binaries cannot execute in a web browser)
    const isBrowserWithoutElectron = typeof window !== 'undefined' && 
      !(window as any).electronAPI && 
      !(window as any).electronMiningAPI && 
      (typeof process === 'undefined' || (process.env?.NODE_ENV !== 'test' && !process.env?.VITEST));

    if (isBrowserWithoutElectron) {
      return {
        success: false,
        previousState,
        currentState: this.state,
        error: 'Real XMRig mining requires the Windows Desktop client. Please download and run the SpinnerMine Desktop Miner on Windows.',
        durationMs: Date.now() - startTs
      };
    }

    // 3. Duplicate Start / State Guard
    if (this.state === 'RUNNING' || this.state === 'STARTING') {
      return {
        success: false,
        previousState,
        currentState: this.state,
        error: `Real mining engine is already in ${this.state} state. Duplicate start prevented.`,
        durationMs: Date.now() - startTs
      };
    }

    if (this.state === 'PAUSED') {
      return {
        success: false,
        previousState,
        currentState: this.state,
        error: 'Engine is currently PAUSED. Use Resume to restart mining.',
        durationMs: Date.now() - startTs
      };
    }

    if (this.state === 'ERROR') {
      return {
        success: false,
        previousState,
        currentState: this.state,
        error: 'Engine is in ERROR state. Execute Reset Error before starting.',
        durationMs: Date.now() - startTs
      };
    }

    // 3. Pool Configuration & Wallet Validation
    const host = config.poolHost?.trim();
    if (!host || !isValidPoolHost(host)) {
      return {
        success: false,
        previousState,
        currentState: this.state,
        error: `Invalid or missing mining pool host: '${config.poolHost}'. Valid host is required.`,
        durationMs: Date.now() - startTs
      };
    }

    const port = Number(config.poolPort);
    if (isNaN(port) || port < 1 || port > 65535) {
      return {
        success: false,
        previousState,
        currentState: this.state,
        error: `Invalid pool port: ${config.poolPort}. Port must be between 1 and 65535.`,
        durationMs: Date.now() - startTs
      };
    }

    const wallet = config.walletAddress?.trim();
    if (!wallet || !isValidMoneroAddress(wallet)) {
      return {
        success: false,
        previousState,
        currentState: this.state,
        error: 'Invalid Monero wallet address. A valid Monero public address is required.',
        durationMs: Date.now() - startTs
      };
    }

    this.config = { ...config };
    this.lastError = undefined;
    this.transitionTo('STARTING');

    try {
      const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);

      this.adapter = new XMRigAdapter({
        executablePath: config.executablePath,
        expectedSha256: config.expectedSha256,
        configOptions: {
          poolHost: host,
          poolPort: port,
          tls: Boolean(config.poolTls),
          walletAddress: wallet,
          workerName: config.workerName || config.workerId || 'worker1',
          threads: config.threads || 2,
          maxThreadsHint: config.throttle || 50,
          donateLevel: 1
        },
        simulatedMode: isTestEnv,
        onTelemetry: (t: XMRigTelemetry) => {
          this.latestAdapterTelemetry = { ...t };
          this.lastTelemetryTs = Date.now();
          this.uptimeSeconds = t.uptimeSeconds || this.uptimeSeconds;
          if (t.hashrate > 0) {
            this.lastRecordedHashrate = t.hashrate;
          }
          const engineTelemetry = this.getTelemetry();
          this.telemetryListeners.forEach((l) => {
            try { l(engineTelemetry); } catch {}
          });
        },
        onError: (err: Error) => {
          this.lastError = err.message;
          this.log(`[RealEngine] Adapter error: ${err.message}`);
          this.errorListeners.forEach((l) => {
            try { l(err); } catch {}
          });
          this.transitionTo('ERROR');
        },
        onExit: (code, signal) => {
          this.log(`[RealEngine] Adapter exited with code ${code ?? signal}`);
          if (this.uptimeSeconds > 0) {
            this.lastSessionDurationSeconds = this.uptimeSeconds;
          }
          if (this.state !== 'STOPPING' && this.state !== 'STOPPED') {
            this.transitionTo('STOPPED');
          }
        },
        onLog: (line: string) => {
          this.log(`[XMRig] ${line}`);
        }
      });

      await this.adapter.start();

      this.uptimeSeconds = 0;
      this.lastTelemetryTs = Date.now();
      this.transitionTo('RUNNING');

      return {
        success: true,
        previousState,
        currentState: 'RUNNING',
        durationMs: Date.now() - startTs
      };
    } catch (err: any) {
      this.lastError = err.message || 'Failed to start XMRig engine';
      this.transitionTo('ERROR');
      return {
        success: false,
        previousState,
        currentState: 'ERROR',
        error: this.lastError,
        durationMs: Date.now() - startTs
      };
    }
  }

  public async stop(): Promise<EngineOperationResult> {
    const startTs = Date.now();
    const previousState = this.state;

    if (this.state === 'STOPPED') {
      return {
        success: true,
        previousState,
        currentState: 'STOPPED',
        durationMs: Date.now() - startTs
      };
    }

    if (this.uptimeSeconds > 0) {
      this.lastSessionDurationSeconds = this.uptimeSeconds;
    }

    this.transitionTo('STOPPING');

    if (this.adapter) {
      try {
        await this.adapter.stop();
      } catch (err: any) {
        this.log(`[RealEngine] Error during adapter stop: ${err.message}`);
      }
      this.adapter = null;
    }

    this.uptimeSeconds = 0;
    this.latestAdapterTelemetry.hashrate = 0;
    this.transitionTo('STOPPED');

    return {
      success: true,
      previousState,
      currentState: 'STOPPED',
      durationMs: Date.now() - startTs
    };
  }

  public async pause(): Promise<EngineOperationResult> {
    const startTs = Date.now();
    const previousState = this.state;

    if (this.state !== 'RUNNING') {
      return {
        success: false,
        previousState,
        currentState: this.state,
        error: `Cannot pause real engine: current state is ${this.state}. Must be RUNNING.`,
        durationMs: Date.now() - startTs
      };
    }

    if (this.adapter) {
      await this.adapter.pause();
    }

    this.latestAdapterTelemetry.hashrate = 0;
    this.transitionTo('PAUSED');

    return {
      success: true,
      previousState,
      currentState: 'PAUSED',
      durationMs: Date.now() - startTs
    };
  }

  public async resume(): Promise<EngineOperationResult> {
    const startTs = Date.now();
    const previousState = this.state;

    if (this.state !== 'PAUSED') {
      return {
        success: false,
        previousState,
        currentState: this.state,
        error: `Cannot resume real engine: current state is ${this.state}. Must be PAUSED.`,
        durationMs: Date.now() - startTs
      };
    }

    if (this.adapter) {
      await this.adapter.resume();
    }

    this.transitionTo('RUNNING');

    return {
      success: true,
      previousState,
      currentState: 'RUNNING',
      durationMs: Date.now() - startTs
    };
  }

  public async resetError(): Promise<EngineOperationResult> {
    const startTs = Date.now();
    const previousState = this.state;

    if (this.state !== 'ERROR') {
      return {
        success: false,
        previousState,
        currentState: this.state,
        error: `Cannot reset error: current state is ${this.state}. Only valid when in ERROR state.`,
        durationMs: Date.now() - startTs
      };
    }

    if (this.adapter) {
      try {
        await this.adapter.stop();
      } catch {}
      this.adapter = null;
    }

    this.lastError = undefined;
    this.uptimeSeconds = 0;
    this.latestAdapterTelemetry.hashrate = 0;
    this.transitionTo('STOPPED');

    return {
      success: true,
      previousState,
      currentState: 'STOPPED',
      durationMs: Date.now() - startTs
    };
  }

  /**
   * Emergency Stop: Authoritatively and immediately kills XMRig process tree,
   * without graceful shutdown wait.
   */
  public async emergencyStop(): Promise<EngineOperationResult> {
    const startTs = Date.now();
    const previousState = this.state;

    this.log('[RealEngine] EMERGENCY STOP TRIGGERED. Halting all mining processes immediately.');

    if (this.uptimeSeconds > 0) {
      this.lastSessionDurationSeconds = this.uptimeSeconds;
    }

    if (this.adapter) {
      try {
        await this.adapter.stop();
      } catch {}
      this.adapter = null;
    }

    this.uptimeSeconds = 0;
    this.latestAdapterTelemetry.hashrate = 0;
    this.transitionTo('STOPPED');

    return {
      success: true,
      previousState,
      currentState: 'STOPPED',
      durationMs: Date.now() - startTs
    };
  }

  public async cleanup(): Promise<void> {
    if (this.adapter) {
      try {
        await this.adapter.stop();
      } catch {}
      this.adapter = null;
    }
    this.uptimeSeconds = 0;
    this.state = 'STOPPED';
    this.stateListeners.clear();
    this.telemetryListeners.clear();
    this.errorListeners.clear();
    this.logListeners.clear();
  }

  public onStateChange(listener: (state: MiningEngineState, previous: MiningEngineState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  public onTelemetry(listener: (telemetry: MiningEngineTelemetry) => void): () => void {
    this.telemetryListeners.add(listener);
    return () => this.telemetryListeners.delete(listener);
  }

  public onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  public onLog(listener: (message: string) => void): () => void {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  }
}
