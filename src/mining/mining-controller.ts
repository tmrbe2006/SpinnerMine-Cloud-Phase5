/**
 * SpinnerMine Cloud - Mining Engine Controller (Phase 2C - Step B, C, E)
 * 
 * Central authoritative state machine and safety gatekeeper for mining operations.
 * Enforces:
 * 1. Strict state machine transitions (STOPPED, STARTING, RUNNING, PAUSED, STOPPING, ERROR).
 * 2. Rapid button-click protection (concurrency mutex lock).
 * 3. Worker ownership validation (matching userId and workerId).
 * 4. Automatic cleanup on application exit, Firebase logout, and network failure.
 * 5. Complete isolation from financial ledgers and zero auto-start on boot or recovery.
 * 6. Detailed in-memory audit log ring-buffer for all issued commands.
 */

import {
  IMiningEngine,
  MiningEngineState,
  MiningEngineType,
  MiningEngineCommand,
  MiningEngineConfig,
  MiningEngineTelemetry,
  EngineOperationResult,
  EngineAuditLogEntry
} from './engine-types';
import { MockMiningEngine } from './mock-engine';
import { RealMiningEngine } from './real-engine';

export interface MiningControllerOptions {
  engine?: IMiningEngine;
  defaultEngineType?: MiningEngineType;
  maxAuditLogEntries?: number;
  authorizedUserId?: string;
  onAuditLogAdded?: (entry: EngineAuditLogEntry) => void;
  onStateChange?: (state: MiningEngineState, previous: MiningEngineState) => void;
  onTelemetry?: (telemetry: MiningEngineTelemetry) => void;
  onError?: (error: Error) => void;
}

export class MiningEngineController {
  private engine: IMiningEngine;
  private isTransitioning: boolean = false;
  private auditLog: EngineAuditLogEntry[] = [];
  private maxAuditLogEntries: number;
  private activeConfig: MiningEngineConfig | null = null;
  private authorizedUserId: string | undefined;

  // Listeners
  private stateChangeSubscribers: Set<(state: MiningEngineState, previous: MiningEngineState) => void> = new Set();
  private telemetrySubscribers: Set<(telemetry: MiningEngineTelemetry) => void> = new Set();
  private auditLogSubscribers: Set<(entry: EngineAuditLogEntry) => void> = new Set();

  private unsubscribeEngineState?: () => void;
  private unsubscribeEngineTelemetry?: () => void;
  private unsubscribeEngineError?: () => void;

  constructor(options?: MiningControllerOptions) {
    this.maxAuditLogEntries = options?.maxAuditLogEntries || 100;
    this.authorizedUserId = options?.authorizedUserId;

    // Phase 2C default: strictly use MockMiningEngine
    this.engine = options?.engine || new MockMiningEngine();

    if (options?.onStateChange) this.stateChangeSubscribers.add(options.onStateChange);
    if (options?.onTelemetry) this.telemetrySubscribers.add(options.onTelemetry);
    if (options?.onAuditLogAdded) this.auditLogSubscribers.add(options.onAuditLogAdded);

    this.bindEngineListeners();
  }

  private bindEngineListeners() {
    this.cleanupEngineListeners();

    this.unsubscribeEngineState = this.engine.onStateChange((state, previous) => {
      this.stateChangeSubscribers.forEach((sub) => {
        try { sub(state, previous); } catch {}
      });
    });

    this.unsubscribeEngineTelemetry = this.engine.onTelemetry((telemetry) => {
      this.telemetrySubscribers.forEach((sub) => {
        try { sub(telemetry); } catch {}
      });
    });

    this.unsubscribeEngineError = this.engine.onError((err) => {
      this.recordAuditEntry({
        command: 'STOP',
        previousState: this.engine.getState(),
        nextState: 'ERROR',
        success: false,
        message: `Engine emitted error: ${err.message}`,
        durationMs: 0
      });
    });
  }

  private cleanupEngineListeners() {
    if (this.unsubscribeEngineState) {
      this.unsubscribeEngineState();
      this.unsubscribeEngineState = undefined;
    }
    if (this.unsubscribeEngineTelemetry) {
      this.unsubscribeEngineTelemetry();
      this.unsubscribeEngineTelemetry = undefined;
    }
    if (this.unsubscribeEngineError) {
      this.unsubscribeEngineError();
      this.unsubscribeEngineError = undefined;
    }
  }

  public setAuthorizedUserId(userId: string | undefined) {
    this.authorizedUserId = userId;
  }

  public getState(): MiningEngineState {
    return this.engine.getState();
  }

  public getEngineType(): MiningEngineType {
    return this.engine.engineType;
  }

  public getTelemetry(): MiningEngineTelemetry {
    return this.engine.getTelemetry();
  }

  public getAuditLog(): ReadonlyArray<EngineAuditLogEntry> {
    return [...this.auditLog];
  }

  public getActiveConfig(): MiningEngineConfig | null {
    return this.activeConfig ? { ...this.activeConfig } : null;
  }

  public isBusy(): boolean {
    return this.isTransitioning;
  }

  /**
   * Switches the underlying mining engine instance (only permitted when current state is STOPPED).
   */
  public switchEngine(newEngine: IMiningEngine): { success: boolean; error?: string } {
    if (this.engine.getState() !== 'STOPPED') {
      return {
        success: false,
        error: `Cannot switch engine while current engine is in ${this.engine.getState()} state. Must be STOPPED.`
      };
    }
    this.cleanupEngineListeners();
    this.engine = newEngine;
    this.bindEngineListeners();
    return { success: true };
  }

  /**
   * Switches engine between 'mock' and 'real'
   */
  public setEngineType(type: MiningEngineType): { success: boolean; error?: string } {
    if (this.engine.getState() !== 'STOPPED') {
      return {
        success: false,
        error: `Cannot switch engine type while running (${this.engine.getState()}). Please stop first.`
      };
    }
    if (type === 'real') {
      return this.switchEngine(new RealMiningEngine());
    } else {
      return this.switchEngine(new MockMiningEngine());
    }
  }

  /**
   * Emergency Stop shortcut: instantly kills active process and halts all transitions
   */
  public async emergencyStop(): Promise<EngineOperationResult> {
    return this.executeCommand('EMERGENCY_STOP');
  }

  /**
   * Validates device ownership: ensures target user matches authorized user
   */
  private validateOwnership(config?: MiningEngineConfig): { allowed: boolean; reason?: string } {
    if (!config) return { allowed: true };

    const uid = config.userId ? config.userId.trim() : '';
    if (!uid || uid === 'unauthenticated_user' || uid === 'anonymous') {
      return { allowed: false, reason: 'Command rejected: Unauthenticated user. Valid authentication is required to control mining engine.' };
    }

    if (!config.workerId || !config.workerId.trim()) {
      return { allowed: false, reason: 'Command rejected: Missing worker identification.' };
    }

    if (this.authorizedUserId && uid !== this.authorizedUserId) {
      return {
        allowed: false,
        reason: `Command rejected: Worker ownership mismatch. Authenticated user ${this.authorizedUserId} cannot control worker assigned to ${uid}.`
      };
    }

    return { allowed: true };
  }

  /**
   * Execute control command with atomic transition lock, state machine rules, and audit logging
   */
  public async executeCommand(
    command: MiningEngineCommand,
    config?: MiningEngineConfig
  ): Promise<EngineOperationResult> {
    const startTs = Date.now();
    const currentState = this.engine.getState();

    // Emergency Stop Priority Gate: bypasses normal mutex lock to guarantee instant kill
    if (command === 'EMERGENCY_STOP') {
      this.isTransitioning = false;
      let result: EngineOperationResult;
      try {
        if (this.engine.emergencyStop) {
          result = await this.engine.emergencyStop();
        } else {
          result = await this.engine.stop();
        }
      } catch (err: any) {
        result = {
          success: false,
          previousState: currentState,
          currentState: this.engine.getState(),
          error: err.message
        };
      }
      this.recordAuditEntry({
        command: 'EMERGENCY_STOP',
        previousState: currentState,
        nextState: result.currentState,
        success: result.success,
        message: 'Emergency Stop executed: all processes killed immediately',
        durationMs: Date.now() - startTs,
        configOverride: config || this.activeConfig || undefined
      });
      return result;
    }

    // 1. Rapid Click Protection & Concurrency Gate
    if (this.isTransitioning) {
      const err = 'A command is already being processed. Please wait.';
      this.recordAuditEntry({
        command,
        previousState: currentState,
        nextState: currentState,
        success: false,
        message: err,
        durationMs: Date.now() - startTs,
        configOverride: config
      });
      return {
        success: false,
        previousState: currentState,
        currentState,
        error: err,
        durationMs: Date.now() - startTs
      };
    }

    // 2. Ownership & Authorization Check
    const effectiveConfig = config || this.activeConfig;
    if (config || (command === 'START' && effectiveConfig)) {
      const authCheck = this.validateOwnership(config || effectiveConfig || undefined);
      if (!authCheck.allowed) {
        this.recordAuditEntry({
          command,
          previousState: currentState,
          nextState: currentState,
          success: false,
          message: authCheck.reason,
          durationMs: Date.now() - startTs,
          configOverride: config || effectiveConfig || undefined
        });
        return {
          success: false,
          previousState: currentState,
          currentState,
          error: authCheck.reason,
          durationMs: Date.now() - startTs
        };
      }
    }

    // 3. State Machine Guard Rules
    switch (command) {
      case 'START':
        if (currentState === 'RUNNING' || currentState === 'STARTING') {
          const err = `Cannot start engine: already in ${currentState} state. Duplicate start prevented.`;
          this.recordAuditEntry({
            command,
            previousState: currentState,
            nextState: currentState,
            success: false,
            message: err,
            durationMs: Date.now() - startTs,
            configOverride: config
          });
          return { success: false, previousState: currentState, currentState, error: err, durationMs: Date.now() - startTs };
        }
        if (currentState === 'PAUSED') {
          const err = 'Engine is PAUSED. Use Resume instead of Start.';
          this.recordAuditEntry({
            command,
            previousState: currentState,
            nextState: currentState,
            success: false,
            message: err,
            durationMs: Date.now() - startTs,
            configOverride: config
          });
          return { success: false, previousState: currentState, currentState, error: err, durationMs: Date.now() - startTs };
        }
        if (currentState === 'ERROR') {
          const err = 'Engine is in ERROR state. You must execute Reset Error before starting.';
          this.recordAuditEntry({
            command,
            previousState: currentState,
            nextState: currentState,
            success: false,
            message: err,
            durationMs: Date.now() - startTs,
            configOverride: config
          });
          return { success: false, previousState: currentState, currentState, error: err, durationMs: Date.now() - startTs };
        }

        // Real Engine Consent Verification
        if (this.engine.engineType === 'real' && !effectiveConfig?.consentAccepted) {
          const err = 'Explicit user consent required: Real CPU mining increases device temperature and power consumption. You must accept the terms before starting.';
          this.recordAuditEntry({
            command,
            previousState: currentState,
            nextState: currentState,
            success: false,
            message: err,
            durationMs: Date.now() - startTs,
            configOverride: config
          });
          return { success: false, previousState: currentState, currentState, error: err, durationMs: Date.now() - startTs };
        }
        break;

      case 'RESUME':
        if (currentState === 'STOPPED') {
          const err = 'Cannot resume engine: engine is currently STOPPED. Use Start instead.';
          this.recordAuditEntry({
            command,
            previousState: currentState,
            nextState: currentState,
            success: false,
            message: err,
            durationMs: Date.now() - startTs
          });
          return { success: false, previousState: currentState, currentState, error: err, durationMs: Date.now() - startTs };
        }
        if (currentState !== 'PAUSED') {
          const err = `Cannot resume engine: current state is ${currentState}. Must be PAUSED.`;
          this.recordAuditEntry({
            command,
            previousState: currentState,
            nextState: currentState,
            success: false,
            message: err,
            durationMs: Date.now() - startTs
          });
          return { success: false, previousState: currentState, currentState, error: err, durationMs: Date.now() - startTs };
        }
        break;

      case 'PAUSE':
        if (currentState !== 'RUNNING') {
          const err = `Cannot pause engine: current state is ${currentState}. Must be RUNNING.`;
          this.recordAuditEntry({
            command,
            previousState: currentState,
            nextState: currentState,
            success: false,
            message: err,
            durationMs: Date.now() - startTs
          });
          return { success: false, previousState: currentState, currentState, error: err, durationMs: Date.now() - startTs };
        }
        break;

      case 'STOP':
        if (currentState === 'STOPPED') {
          return { success: true, previousState: currentState, currentState: 'STOPPED', durationMs: Date.now() - startTs };
        }
        break;

      case 'RESET_ERROR':
        if (currentState !== 'ERROR') {
          const err = `Cannot reset error: current state is ${currentState}. Only applicable when in ERROR state.`;
          this.recordAuditEntry({
            command,
            previousState: currentState,
            nextState: currentState,
            success: false,
            message: err,
            durationMs: Date.now() - startTs
          });
          return { success: false, previousState: currentState, currentState, error: err, durationMs: Date.now() - startTs };
        }
        break;
    }

    // 4. Lock transition
    this.isTransitioning = true;

    try {
      let result: EngineOperationResult;
      switch (command) {
        case 'START':
          this.activeConfig = config!;
          result = await this.engine.start(config!);
          break;
        case 'STOP':
          result = await this.engine.stop();
          break;
        case 'PAUSE':
          result = await this.engine.pause();
          break;
        case 'RESUME':
          result = await this.engine.resume();
          break;
        case 'RESET_ERROR':
          result = await this.engine.resetError();
          break;
      }

      this.recordAuditEntry({
        command,
        previousState: currentState,
        nextState: result.currentState,
        success: result.success,
        message: result.error || 'Command executed successfully',
        durationMs: Date.now() - startTs,
        configOverride: effectiveConfig || undefined
      });

      return result;
    } catch (err: any) {
      const errorMsg = err.message || 'Unexpected engine exception';
      this.recordAuditEntry({
        command,
        previousState: currentState,
        nextState: this.engine.getState(),
        success: false,
        message: errorMsg,
        durationMs: Date.now() - startTs,
        configOverride: effectiveConfig || undefined
      });

      return {
        success: false,
        previousState: currentState,
        currentState: this.engine.getState(),
        error: errorMsg,
        durationMs: Date.now() - startTs
      };
    } finally {
      this.isTransitioning = false;
    }
  }

  /**
   * Lifecycle Handler: Application Exit or Window Close
   * Guarantees all timers and mock engine operations are cleanly stopped.
   */
  public async handleAppExit(): Promise<void> {
    this.isTransitioning = false;
    await this.engine.stop();
    await this.engine.cleanup();
  }

  /**
   * Lifecycle Handler: Firebase User Logout
   * Immediately stops engine and invalidates active worker config.
   */
  public async handleUserLogout(): Promise<void> {
    if (this.engine.getState() !== 'STOPPED') {
      await this.executeCommand('STOP');
    }
    this.activeConfig = null;
    this.authorizedUserId = undefined;
  }

  /**
   * Lifecycle Handler: Network Failure
   * If network connection is lost, safely pauses or alerts without crashing.
   */
  public async handleNetworkOffline(): Promise<void> {
    if (this.engine.getState() === 'RUNNING') {
      const res = await this.executeCommand('PAUSE');
      if (res.success && this.auditLog.length > 0) {
        this.auditLog[0].message = 'Network offline detected: engine paused safely to protect connection state';
      }
    }
  }

  private recordAuditEntry(params: {
    command: MiningEngineCommand;
    previousState: MiningEngineState;
    nextState: MiningEngineState;
    success: boolean;
    message?: string;
    durationMs: number;
    configOverride?: MiningEngineConfig;
  }) {
    const config = params.configOverride || this.activeConfig;
    const entry: EngineAuditLogEntry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      command: params.command,
      previousState: params.previousState,
      nextState: params.nextState,
      success: params.success,
      workerId: config?.workerId || 'unassigned',
      userId: config?.userId || this.authorizedUserId || 'anonymous',
      engineType: this.engine.engineType,
      message: params.message,
      durationMs: params.durationMs
    };

    this.auditLog.unshift(entry);
    if (this.auditLog.length > this.maxAuditLogEntries) {
      this.auditLog = this.auditLog.slice(0, this.maxAuditLogEntries);
    }

    this.auditLogSubscribers.forEach((sub) => {
      try { sub(entry); } catch {}
    });
  }

  public subscribeStateChange(listener: (state: MiningEngineState, previous: MiningEngineState) => void): () => void {
    this.stateChangeSubscribers.add(listener);
    return () => this.stateChangeSubscribers.delete(listener);
  }

  public subscribeTelemetry(listener: (telemetry: MiningEngineTelemetry) => void): () => void {
    this.telemetrySubscribers.add(listener);
    return () => this.telemetrySubscribers.delete(listener);
  }

  public subscribeAuditLog(listener: (entry: EngineAuditLogEntry) => void): () => void {
    this.auditLogSubscribers.add(listener);
    return () => this.auditLogSubscribers.delete(listener);
  }
}
