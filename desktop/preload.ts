/**
 * SpinnerMine Cloud - Electron Desktop Miner Preload Script (Phase 2C Updated)
 * Exposes a strictly isolated, secure IPC API to the renderer process.
 */

import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronMiningAPI {
  // Legacy / Direct APIs
  getSystemInfo: () => Promise<{
    cpuCores: number;
    platform: string;
    arch: string;
    totalMemoryGb: number;
    installationId?: string;
  }>;
  getInstallationId?: () => Promise<string>;
  getDeviceIdentity?: () => Promise<{
    installationId: string;
    createdAt: string;
    platform: string;
    version: string;
  }>;
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

  // Phase 2C & 2D Safe Mining Engine Controller APIs
  engineGetState: () => Promise<string>;
  engineExecuteCommand: (command: string, config?: any) => Promise<{
    success: boolean;
    previousState: string;
    currentState: string;
    error?: string;
    durationMs?: number;
  }>;
  engineEmergencyStop: () => Promise<any>;
  engineSwitchType: (type: string) => Promise<any>;
  engineGetType: () => Promise<string>;
  engineGetTelemetry: () => Promise<any>;
  engineGetAuditLog: () => Promise<any[]>;
  onEngineStateChange: (callback: (state: string, previous: string) => void) => () => void;
  onEngineTelemetry: (callback: (telemetry: any) => void) => () => void;
  verifyStratumPool?: (payload: any) => Promise<any>;
}

const miningAPI: ElectronMiningAPI = {
  isElectron: true,
  getSystemInfo: () => ipcRenderer.invoke('mining:get-system-info'),
  getInstallationId: () => ipcRenderer.invoke('mining:get-installation-id'),
  getDeviceIdentity: () => ipcRenderer.invoke('app:get-device-identity'),
  detectXMRig: () => ipcRenderer.invoke('mining:detect-xmrig'),
  selectXMRigPath: () => ipcRenderer.invoke('mining:select-xmrig-path'),
  validateXMRig: (path: string) => ipcRenderer.invoke('mining:validate-xmrig', path),
  startMining: (config: any) => ipcRenderer.invoke('mining:start', config),
  stopMining: () => ipcRenderer.invoke('mining:stop'),
  pauseMining: () => ipcRenderer.invoke('mining:pause'),
  resumeMining: () => ipcRenderer.invoke('mining:resume'),
  getTelemetry: () => ipcRenderer.invoke('mining:get-telemetry'),
  onTelemetryUpdate: (callback: (telemetry: any) => void) => {
    const handler = (_event: any, telemetry: any) => callback(telemetry);
    ipcRenderer.on('telemetry-update', handler);
    return () => ipcRenderer.removeListener('telemetry-update', handler);
  },
  onMiningError: (callback: (error: string) => void) => {
    const handler = (_event: any, error: string) => callback(error);
    ipcRenderer.on('mining-error', handler);
    return () => ipcRenderer.removeListener('mining-error', handler);
  },
  saveSettings: (settings: any) => ipcRenderer.invoke('app:save-settings', settings),
  loadSettings: () => ipcRenderer.invoke('app:load-settings'),
  minimizeToTray: () => ipcRenderer.invoke('app:minimize-to-tray'),
  testPool: (config) => ipcRenderer.invoke('mining:test-pool', config),

  // Phase 2C & 2D Engine Controller methods
  engineGetState: () => ipcRenderer.invoke('engine:get-state'),
  engineExecuteCommand: (command: string, config?: any) => ipcRenderer.invoke('engine:execute-command', command, config),
  engineEmergencyStop: () => ipcRenderer.invoke('engine:emergency-stop'),
  engineSwitchType: (type: string) => ipcRenderer.invoke('engine:switch-type', type),
  engineGetType: () => ipcRenderer.invoke('engine:get-type'),
  engineGetTelemetry: () => ipcRenderer.invoke('engine:get-telemetry'),
  engineGetAuditLog: () => ipcRenderer.invoke('engine:get-audit-log'),
  verifyStratumPool: (payload: any) => ipcRenderer.invoke('mining:verify-stratum', payload),
  verifyRealMining: (payload: any) => ipcRenderer.invoke('mining:verify-real', payload),
  queryPoolApi: (payload: any) => ipcRenderer.invoke('mining:query-pool-api', payload),
  onEngineStateChange: (callback: (state: string, previous: string) => void) => {
    const handler = (_event: any, data: { state: string; previous: string }) => callback(data.state, data.previous);
    ipcRenderer.on('engine-state-changed', handler);
    return () => ipcRenderer.removeListener('engine-state-changed', handler);
  },
  onEngineTelemetry: (callback: (telemetry: any) => void) => {
    const handler = (_event: any, telemetry: any) => callback(telemetry);
    ipcRenderer.on('engine-telemetry', handler);
    return () => ipcRenderer.removeListener('engine-telemetry', handler);
  }
};

contextBridge.exposeInMainWorld('electronMiningAPI', miningAPI);
contextBridge.exposeInMainWorld('electronAPI', miningAPI);
