/**
 * SpinnerMine Cloud - React Hook for Safe Mining Engine Controller (Phase 2C)
 * 
 * Provides unified state management across Web and Electron Desktop environments:
 * - Real-time state machine subscription
 * - Safe command execution with rapid-click debounce & mutex
 * - Live simulated telemetry stream with zero financial side-effects
 * - Full command audit log tracking
 * - Automatic session logout & network offline lifecycle management
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MiningEngineState,
  MiningEngineType,
  MiningEngineCommand,
  MiningEngineConfig,
  MiningEngineTelemetry,
  EngineOperationResult,
  EngineAuditLogEntry
} from './engine-types';
import { MiningEngineController } from './mining-controller';
import { MockMiningEngine } from './mock-engine';

export interface UseMiningControllerReturn {
  state: MiningEngineState;
  engineType: MiningEngineType;
  telemetry: MiningEngineTelemetry;
  auditLog: EngineAuditLogEntry[];
  isBusy: boolean;
  error: string | null;
  executeCommand: (command: MiningEngineCommand, config?: MiningEngineConfig) => Promise<EngineOperationResult>;
  emergencyStop: () => Promise<EngineOperationResult>;
  switchEngineType: (type: MiningEngineType) => { success: boolean; error?: string };
  simulateError: (message?: string) => void;
  clearError: () => void;
  isElectron: boolean;
}

export function useMiningController(currentUserId?: string): UseMiningControllerReturn {
  const isElectron = typeof window !== 'undefined' && Boolean((window as any).electronAPI || (window as any).electronMiningAPI);
  const electronAPI = typeof window !== 'undefined' ? ((window as any).electronAPI || (window as any).electronMiningAPI) : undefined;

  // Local controller instance for browser execution or fallback
  const mockEngineRef = useRef<MockMiningEngine | null>(null);
  const localControllerRef = useRef<MiningEngineController | null>(null);

  if (!localControllerRef.current) {
    mockEngineRef.current = new MockMiningEngine();
    localControllerRef.current = new MiningEngineController({
      engine: mockEngineRef.current,
      authorizedUserId: currentUserId
    });
  }

  // Synchronize authorized user ID
  useEffect(() => {
    localControllerRef.current?.setAuthorizedUserId(currentUserId);
  }, [currentUserId]);

  const [state, setState] = useState<MiningEngineState>(() => {
    return localControllerRef.current?.getState() || 'STOPPED';
  });

  const [telemetry, setTelemetry] = useState<MiningEngineTelemetry>(() => {
    return localControllerRef.current?.getTelemetry() || {
      engineType: 'mock',
      state: 'STOPPED',
      uptimeSeconds: 0,
      lastSessionDurationSeconds: 0,
      threads: 2,
      cpuUsage: 0,
      hashrate: 0,
      lastRecordedHashrate: 0,
      isSimulation: true,
      acceptedShares: 0,
      rejectedShares: 0,
      timestamp: new Date().toISOString()
    };
  });

  const [auditLog, setAuditLog] = useState<EngineAuditLogEntry[]>([]);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Sync state & telemetry subscriptions
  useEffect(() => {
    if (isElectron && electronAPI?.onEngineStateChange) {
      // Electron IPC Mode
      const unsubState = electronAPI.onEngineStateChange((newState: string) => {
        setState(newState as MiningEngineState);
      });
      const unsubTelem = electronAPI.onEngineTelemetry?.((newTelem: any) => {
        setTelemetry(newTelem);
      });

      // Initial fetch
      electronAPI.engineGetState?.().then((st: string) => setState(st as MiningEngineState)).catch(() => {});
      electronAPI.engineGetTelemetry?.().then((tm: any) => setTelemetry(tm)).catch(() => {});
      electronAPI.engineGetAuditLog?.().then((log: any[]) => setAuditLog(log || [])).catch(() => {});

      return () => {
        unsubState?.();
        unsubTelem?.();
      };
    } else {
      // Local In-Memory Controller Mode
      const controller = localControllerRef.current;
      if (!controller) return;

      const unsubState = controller.subscribeStateChange((newState) => {
        setState(newState);
      });

      const unsubTelem = controller.subscribeTelemetry((newTelem) => {
        setTelemetry(newTelem);
      });

      const unsubAudit = controller.subscribeAuditLog(() => {
        setAuditLog([...controller.getAuditLog()]);
      });

      setAuditLog([...controller.getAuditLog()]);

      return () => {
        unsubState();
        unsubTelem();
        unsubAudit();
      };
    }
  }, [isElectron, electronAPI]);

  // Handle Firebase User Logout
  useEffect(() => {
    if (!currentUserId) {
      localControllerRef.current?.handleUserLogout();
    }
  }, [currentUserId]);

  // Handle Network Offline Event
  useEffect(() => {
    const handleOffline = () => {
      localControllerRef.current?.handleNetworkOffline();
    };

    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Safe Command Execution
  const executeCommand = useCallback(
    async (command: MiningEngineCommand, config?: MiningEngineConfig): Promise<EngineOperationResult> => {
      setIsBusy(true);
      setError(null);

      try {
        if (isElectron && electronAPI?.engineExecuteCommand) {
          const res = await electronAPI.engineExecuteCommand(command, config);
          if (!res.success && res.error) {
            setError(res.error);
          }
          if (electronAPI.engineGetState) {
            const updatedState = await electronAPI.engineGetState();
            setState(updatedState as MiningEngineState);
          }
          if (electronAPI.engineGetTelemetry) {
            const updatedTelem = await electronAPI.engineGetTelemetry();
            setTelemetry(updatedTelem);
          }
          if (electronAPI.engineGetAuditLog) {
            const updatedLog = await electronAPI.engineGetAuditLog();
            setAuditLog(updatedLog || []);
          }
          return res;
        } else {
          const controller = localControllerRef.current;
          if (!controller) {
            const err = 'Engine controller is not initialized';
            setError(err);
            return {
              success: false,
              previousState: state,
              currentState: state,
              error: err
            };
          }

          const res = await controller.executeCommand(command, config);
          if (!res.success && res.error) {
            setError(res.error);
          }
          setState(controller.getState());
          setTelemetry(controller.getTelemetry());
          setAuditLog([...controller.getAuditLog()]);
          return res;
        }
      } catch (err: any) {
        const errorMsg = err.message || 'Failed to execute command';
        setError(errorMsg);
        return {
          success: false,
          previousState: state,
          currentState: state,
          error: errorMsg
        };
      } finally {
        setIsBusy(false);
      }
    },
    [isElectron, electronAPI, state]
  );

  const [engineType, setEngineTypeState] = useState<MiningEngineType>(() => {
    return localControllerRef.current?.getEngineType() || 'mock';
  });

  const emergencyStop = useCallback(async (): Promise<EngineOperationResult> => {
    return executeCommand('EMERGENCY_STOP');
  }, [executeCommand]);

  const switchEngineType = useCallback((newType: MiningEngineType) => {
    setError(null);
    if (isElectron && electronAPI?.engineSwitchType) {
      electronAPI.engineSwitchType(newType).then((res: any) => {
        if (res?.success) {
          setEngineTypeState(newType);
        } else if (res?.error) {
          setError(res.error);
        }
      }).catch((err: any) => setError(err.message));
      return { success: true };
    } else {
      const res = localControllerRef.current?.setEngineType(newType);
      if (res?.success) {
        setEngineTypeState(newType);
        setState(localControllerRef.current!.getState());
        setTelemetry(localControllerRef.current!.getTelemetry());
        return { success: true };
      } else {
        const errMsg = res?.error || 'Failed to switch engine type';
        setError(errMsg);
        return { success: false, error: errMsg };
      }
    }
  }, [isElectron, electronAPI]);

  const simulateError = useCallback((message?: string) => {
    if (mockEngineRef.current) {
      mockEngineRef.current.simulateCriticalError(message || 'Simulated critical thermal/connection failure');
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    state,
    engineType,
    telemetry,
    auditLog,
    isBusy,
    error,
    executeCommand,
    emergencyStop,
    switchEngineType,
    simulateError,
    clearError,
    isElectron
  };
}
