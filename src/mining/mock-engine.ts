/**
 * SpinnerMine Cloud - Safe Mock Mining Engine (Phase 2C - Step A)
 * 
 * Provides a completely safe, non-mining mock engine implementation that:
 * 1. Simulates all lifecycle states (STOPPED, STARTING, RUNNING, PAUSED, STOPPING, ERROR).
 * 2. Never spawns xmrig.exe, never connects to a real Stratum mining pool.
 * 3. Never produces real or redeemable accepted shares.
 * 4. Yields telemetry clearly tagged with `isSimulation: true`.
 * 5. Safely cleans up all interval timers and listeners upon stop or termination.
 */

import {
  IMiningEngine,
  MiningEngineState,
  MiningEngineType,
  MiningEngineConfig,
  MiningEngineTelemetry,
  EngineOperationResult
} from './engine-types';

export class MockMiningEngine implements IMiningEngine {
  public readonly engineType: MiningEngineType = 'mock';

  private state: MiningEngineState = 'STOPPED';
  private config: MiningEngineConfig | null = null;
  private uptimeTimer: NodeJS.Timeout | null = null;
  private telemetryTimer: NodeJS.Timeout | null = null;
  private uptimeSeconds: number = 0;
  private lastSessionDurationSeconds: number = 0;
  private lastRecordedHashrate: number = 0;
  private lastError: string | undefined = undefined;

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
    const threads = this.config?.threads || 2;
    // Benign simulation calculation: ~250 H/s per thread strictly only when RUNNING
    let simulatedHashrate = 0;
    if (this.state === 'RUNNING') {
      const jitter = (Math.random() * 20) - 10;
      simulatedHashrate = Math.max(0, Math.round((threads * 250) + jitter));
      this.lastRecordedHashrate = simulatedHashrate;
    } else {
      // STRICT REQUIREMENT 1: Current simulated hashrate is ONLY non-zero when state is strictly RUNNING.
      // When STOPPED, PAUSED, ERROR, STARTING, or STOPPING, currentHashrate is STRICTLY 0.
      simulatedHashrate = 0;
    }

    return {
      engineType: this.engineType,
      state: this.state,
      uptimeSeconds: this.uptimeSeconds,
      lastSessionDurationSeconds: this.lastSessionDurationSeconds,
      threads,
      cpuUsage: this.state === 'RUNNING' ? Math.min(100, Math.round((threads * 12.5) + (Math.random() * 5))) : 0,
      hashrate: simulatedHashrate,
      lastRecordedHashrate: this.lastRecordedHashrate,
      isSimulation: true,
      acceptedShares: 0, // STRICT FINANCIAL ISOLATION: Always 0
      rejectedShares: 0,
      lastError: this.lastError,
      timestamp: new Date().toISOString()
    };
  }

  private transitionTo(newState: MiningEngineState) {
    const previous = this.state;
    if (previous === newState) return;
    this.state = newState;
    this.log(`[MockEngine] State changed: ${previous} -> ${newState}`);
    this.stateListeners.forEach((listener) => {
      try {
        listener(newState, previous);
      } catch (err) {
        console.error('[MockEngine] Error in state listener:', err);
      }
    });

    // CRITICAL: Immediately broadcast fresh telemetry to all listeners on every state change.
    // Guarantees that the instant state becomes STOPPED, PAUSED, or ERROR, hashrate = 0 is broadcasted.
    const immediateTelemetry = this.getTelemetry();
    this.telemetryListeners.forEach((listener) => {
      try {
        listener(immediateTelemetry);
      } catch (err) {
        console.error('[MockEngine] Error in telemetry listener:', err);
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

    // Validate state
    if (this.state === 'RUNNING' || this.state === 'STARTING') {
      return {
        success: false,
        previousState,
        currentState: this.state,
        error: `Engine is already in ${this.state} state`,
        durationMs: Date.now() - startTs
      };
    }

    if (this.state === 'STOPPING') {
      return {
        success: false,
        previousState,
        currentState: this.state,
        error: 'Engine is currently stopping. Please wait for STOPPED state before starting.',
        durationMs: Date.now() - startTs
      };
    }

    this.config = { ...config };
    this.lastError = undefined;
    this.transitionTo('STARTING');

    // Simulate startup handshake delay (non-blocking)
    await new Promise((resolve) => setTimeout(resolve, 50));

    // If canceled while starting
    if ((this.state as MiningEngineState) !== 'STARTING') {
      return {
        success: false,
        previousState,
        currentState: this.state,
        error: `Startup interrupted; current state is ${this.state}`,
        durationMs: Date.now() - startTs
      };
    }

    this.uptimeSeconds = 0;
    this.startTimers();
    this.transitionTo('RUNNING');

    return {
      success: true,
      previousState,
      currentState: this.state,
      durationMs: Date.now() - startTs
    };
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
    this.stopTimers();

    // Fast simulated graceful teardown
    await new Promise((resolve) => setTimeout(resolve, 30));

    this.uptimeSeconds = 0;
    this.transitionTo('STOPPED');

    return {
      success: true,
      previousState,
      currentState: 'STOPPED',
      durationMs: Date.now() - startTs
    };
  }

  public async emergencyStop(): Promise<EngineOperationResult> {
    this.stopTimers();
    this.uptimeSeconds = 0;
    this.transitionTo('STOPPED');
    return {
      success: true,
      previousState: this.state,
      currentState: 'STOPPED',
      durationMs: 0
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
        error: `Cannot pause engine from state ${this.state}. Must be RUNNING.`,
        durationMs: Date.now() - startTs
      };
    }

    this.stopTimers();
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
        error: `Cannot resume engine from state ${this.state}. Must be PAUSED.`,
        durationMs: Date.now() - startTs
      };
    }

    this.startTimers();
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
        error: `Engine is in ${this.state} state; resetError is only valid for ERROR state.`,
        durationMs: Date.now() - startTs
      };
    }

    this.stopTimers();
    this.lastError = undefined;
    this.transitionTo('STOPPED');

    return {
      success: true,
      previousState,
      currentState: 'STOPPED',
      durationMs: Date.now() - startTs
    };
  }

  public async cleanup(): Promise<void> {
    this.stopTimers();
    this.uptimeSeconds = 0;
    this.state = 'STOPPED';
    this.stateListeners.clear();
    this.telemetryListeners.clear();
    this.errorListeners.clear();
    this.logListeners.clear();
  }

  /**
   * Test Hook: Simulates a critical error to test controller recovery and error states
   */
  public simulateCriticalError(message: string = 'Simulated critical thermal/connection failure') {
    if (this.uptimeSeconds > 0) {
      this.lastSessionDurationSeconds = this.uptimeSeconds;
    }
    this.stopTimers();
    this.lastError = message;
    this.transitionTo('ERROR');
    const err = new Error(message);
    this.errorListeners.forEach((listener) => {
      try {
        listener(err);
      } catch {}
    });
  }

  private startTimers() {
    this.stopTimers();

    // 1-second uptime accumulator
    this.uptimeTimer = setInterval(() => {
      if (this.state === 'RUNNING') {
        this.uptimeSeconds += 1;
      }
    }, 1000);

    // Periodic telemetry emitter
    this.telemetryTimer = setInterval(() => {
      const telemetry = this.getTelemetry();
      this.telemetryListeners.forEach((listener) => {
        try {
          listener(telemetry);
        } catch {}
      });
    }, 1000);
  }

  private stopTimers() {
    if (this.uptimeTimer) {
      clearInterval(this.uptimeTimer);
      this.uptimeTimer = null;
    }
    if (this.telemetryTimer) {
      clearInterval(this.telemetryTimer);
      this.telemetryTimer = null;
    }
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
