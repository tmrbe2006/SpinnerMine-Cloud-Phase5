/**
 * SpinnerMine Cloud - Windows Desktop Mining Client (Electron Main Process)
 *
 * Implements:
 * - Single-instance enforcement
 * - Safe XMRig subprocess execution
 * - System Tray minimize with explicit user consent
 * - Clean shutdown guaranteeing no orphaned background mining processes
 * - Context-isolated IPC handlers
 */

import { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { XMRigAdapter } from '../src/mining/xmrig-adapter';
import { MiningEngineController } from '../src/mining/mining-controller';
import { MiningEngineCommand, MiningEngineConfig } from '../src/mining/engine-types';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let activeAdapter: XMRigAdapter | null = null;
const engineController = new MiningEngineController();
let isQuitting = false;

const isSmokeTest = process.argv.includes('--smoke-test') || process.env.SPINNERMINE_SMOKE_TEST === '1';

// Enforce single instance lock (skip locking rejection during smoke test)
if (!isSmokeTest) {
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
  }
}

import crypto from 'crypto';

interface DeviceIdentityRecord {
  installationId: string;
  createdAt: string;
  platform: string;
  version: string;
}

function getDeviceIdentityFilePath(): string {
  const userDataDir = app.getPath('userData');
  return path.join(userDataDir, 'device-identity.json');
}

function getSettingsFilePath(): string {
  const userDataDir = app.getPath('userData');
  return path.join(userDataDir, 'spinnermine_settings.json');
}

function generateSecureInstallationId(): string {
  // Requirement 2: Cryptographically secure UUID-based permanent installation identifier
  if (typeof crypto.randomUUID === 'function') {
    return `inst_${crypto.randomUUID()}`;
  }
  return `inst_${crypto.randomBytes(16).toString('hex')}`;
}

export function loadPermanentDeviceIdentity(): DeviceIdentityRecord {
  const identityPath = getDeviceIdentityFilePath();
  try {
    if (fs.existsSync(identityPath)) {
      const raw = fs.readFileSync(identityPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.installationId === 'string' && parsed.installationId.startsWith('inst_')) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('[desktop:main] Error reading device-identity.json:', err);
  }

  // Fallback / migration check from legacy settings file
  let candidateId: string | null = null;
  try {
    const settingsPath = getSettingsFilePath();
    if (fs.existsSync(settingsPath)) {
      const settingsRaw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (settingsRaw && typeof settingsRaw.installationId === 'string' && settingsRaw.installationId.startsWith('inst_')) {
        candidateId = settingsRaw.installationId;
      }
    }
  } catch {}

  const finalId = candidateId || generateSecureInstallationId();
  const identityRecord: DeviceIdentityRecord = {
    installationId: finalId,
    createdAt: new Date().toISOString(),
    platform: process.platform,
    version: '1.0.0'
  };

  try {
    const dir = path.dirname(identityPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(identityPath, JSON.stringify(identityRecord, null, 2), 'utf8');
  } catch (err) {
    console.error('[desktop:main] Failed to persist permanent device-identity.json:', err);
  }

  return identityRecord;
}

function getPermanentInstallationId(): string {
  const identity = loadPermanentDeviceIdentity();
  return identity.installationId;
}

function loadSavedSettings(): Record<string, any> {
  const permanentId = getPermanentInstallationId();
  try {
    const filePath = getSettingsFilePath();
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (data.installationId !== permanentId) {
        data.installationId = permanentId;
        saveUserSettings(data);
      }
      return data;
    }
  } catch {}
  const initial = {
    installationId: permanentId,
    threads: Math.max(1, Math.floor(os.cpus().length / 2)),
    throttle: 50,
    minimizeToTray: false,
    runInBackgroundOnClose: false,
    xmrigPath: ''
  };
  saveUserSettings(initial);
  return initial;
}

function saveUserSettings(settings: Record<string, any>): boolean {
  try {
    const filePath = getSettingsFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Guarantee installationId matches permanent device identity
    settings.installationId = getPermanentInstallationId();
    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

function getPreloadPath(): string {
  const candidates = [
    path.join(__dirname, 'preload.cjs'),
    path.join(__dirname, 'preload.js'),
    path.join(app.getAppPath(), 'dist-electron/preload.cjs'),
    path.join(app.getAppPath(), 'dist-electron/preload.js')
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return path.join(__dirname, 'preload.cjs');
}

function createWindow() {
  const preloadPath = getPreloadPath();

  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    show: !isSmokeTest,
    title: 'SpinnerMine Cloud - Windows Desktop Miner',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  // Sanitize User-Agent to permit standard Google OAuth & Firebase Authentication popup flows without disallowed_useragent rejection
  try {
    const rawUA = mainWindow.webContents.getUserAgent();
    const cleanUA = rawUA.replace(/Electron\/[0-9\.]+\s?/g, '');
    mainWindow.webContents.setUserAgent(cleanUA);
  } catch {}

  // Phase 2C: Forward engineController events to renderer
  engineController.subscribeStateChange((state, previous) => {
    mainWindow?.webContents.send('engine-state-changed', { state, previous });
  });
  engineController.subscribeTelemetry((telemetry) => {
    mainWindow?.webContents.send('engine-telemetry', telemetry);
  });

  // Handle OAuth and authentication popup windows securely
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (
      url.startsWith('https://accounts.google.com') ||
      url.startsWith('https://spinnermine-cloud-production.firebaseapp.com') ||
      url.startsWith('https://spinnermine-cloud.firebaseapp.com') ||
      url.includes('.firebaseapp.com/__/auth/')
    ) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 640,
          autoHideMenuBar: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
          }
        }
      };
    }

    // Direct other external links to external OS default browser
    try {
      shell.openExternal(url);
    } catch {}
    return { action: 'deny' };
  });

  // Strip Electron identifier from child OAuth windows
  mainWindow.webContents.on('did-create-window', (childWindow) => {
    try {
      const childUA = childWindow.webContents.getUserAgent().replace(/Electron\/[0-9\.]+\s?/g, '');
      childWindow.webContents.setUserAgent(childUA);
    } catch {}
  });

  if (isSmokeTest) {
    console.log('[SMOKE-TEST] Starting automated Electron runtime smoke test verification...');
    console.log('[SMOKE-TEST] Electron version:', process.versions.electron);
    console.log('[SMOKE-TEST] Node version:', process.versions.node);
    console.log('[SMOKE-TEST] Platform:', process.platform, process.arch);
    console.log('[SMOKE-TEST] Preload resolved at:', preloadPath);
    console.log('[SMOKE-TEST] App path:', app.getAppPath());

    const smokeTimeout = setTimeout(() => {
      console.error('[SMOKE-TEST] FAIL: Smoke test timed out after 25 seconds!');
      app.exit(1);
    }, 25000);

    // Verify module imports and XMRigAdapter availability
    try {
      const detectResult = XMRigAdapter.detectXMRigInstallation();
      console.log('[SMOKE-TEST] XMRigAdapter import & execution check: PASS (detection result:', detectResult, ')');
    } catch (err: any) {
      console.error('[SMOKE-TEST] FAIL: Error running XMRigAdapter:', err);
      clearTimeout(smokeTimeout);
      app.exit(1);
    }

    // Verify activeAdapter is strictly null and engineController is strictly STOPPED (no mining autostarted)
    if (activeAdapter !== null || engineController.getState() !== 'STOPPED') {
      console.error('[SMOKE-TEST] FAIL: Active mining adapter or engine is running on startup without explicit user action!');
      clearTimeout(smokeTimeout);
      app.exit(1);
    }
    console.log('[SMOKE-TEST] Mining isolation check: PASS (active processes: 0, engineController STOPPED confirmed).');

    // 1. Strict Gate: Fail immediately on did-fail-load
    mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
      console.error(`[SMOKE-TEST] FAIL: did-fail-load triggered (${errorCode}: ${errorDescription}) on URL: ${validatedURL}`);
      clearTimeout(smokeTimeout);
      app.exit(1);
    });

    // 2. Strict Gate: Fail immediately on render process crash
    mainWindow.webContents.on('render-process-gone', (_e, details) => {
      console.error('[SMOKE-TEST] FAIL: Render process crashed or terminated:', details);
      clearTimeout(smokeTimeout);
      app.exit(1);
    });

    // 3. Strict Gate: Fail immediately on unhandled renderer exceptions
    mainWindow.webContents.on('page-error', (_e, error) => {
      console.error('[SMOKE-TEST] FAIL: Unhandled renderer page exception:', error);
      clearTimeout(smokeTimeout);
      app.exit(1);
    });

    // 4. Strict Gate: Intercept static bundle and file:// resource load errors
    mainWindow.webContents.session.webRequest.onErrorOccurred((details) => {
      const isStaticOrFileResource = 
        details.url.startsWith('file:') ||
        details.url.endsWith('.js') ||
        details.url.endsWith('.css') ||
        details.url.endsWith('.wasm') ||
        details.url.endsWith('.html') ||
        details.url.endsWith('.svg') ||
        details.url.endsWith('.png') ||
        details.url.endsWith('.ico') ||
        details.url.includes('/assets/');

      if (isStaticOrFileResource) {
        console.error(`[SMOKE-TEST] FAIL: Missing critical resource: ${details.url} (${details.error})`);
        clearTimeout(smokeTimeout);
        app.exit(1);
      } else {
        // Remote HTTP/HTTPS API call (network offline or unreachable in CI)
        console.log(`[SMOKE-TEST] Remote API endpoint unreachable (handled cleanly by UI): ${details.url} (${details.error})`);
      }
    });

    // 5. Strict Gate: Intercept fatal renderer console errors
    mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      if (message.includes('ERR_FILE_NOT_FOUND') || message.includes('SyntaxError') || message.includes('Uncaught ReferenceError')) {
        console.error(`[SMOKE-TEST] FAIL: Fatal console error detected [Level ${level}]: ${message} (${sourceId}:${line})`);
        clearTimeout(smokeTimeout);
        app.exit(1);
      }
    });

    // 6. Strict Gate: Execute in-page validation verifying React DOM mounting and data-app-ready="true"
    mainWindow.webContents.on('did-finish-load', async () => {
      console.log('[SMOKE-TEST] Window webContents loaded. Validating DOM mount and React UI...');

      let verified = false;
      let lastReason = '';
      const startCheck = Date.now();

      while (Date.now() - startCheck < 10000) {
        try {
          const evalResult = await mainWindow!.webContents.executeJavaScript(`
            (() => {
              const root = document.getElementById('root');
              if (!root) {
                return { ready: false, reason: 'Root element #root not found in DOM' };
              }
              const hasReady = document.querySelector('[data-app-ready="true"]') !== null ||
                               root.getAttribute('data-app-ready') === 'true' ||
                               document.body.getAttribute('data-app-ready') === 'true';
              const childCount = root.children.length;
              const innerText = (root.innerText || '').trim();

              if (childCount === 0 && !innerText) {
                return { ready: false, reason: 'Root #root has 0 children and empty text (React did not mount, white screen)' };
              }

              // Verify no invalid root-relative file links (e.g. file:///assets/...)
              const badLinks = Array.from(document.querySelectorAll('link[href^="/"], script[src^="/"]')).map(el => el.src || el.href);
              if (badLinks.length > 0) {
                return { ready: false, reason: 'Found forbidden root-relative link(s): ' + badLinks.join(', ') };
              }

              const buttons = Array.from(document.querySelectorAll('button'));
              const hasBrowse = buttons.some(b => (b.textContent || '').includes('Browse'));
              const hasValidate = buttons.some(b => (b.textContent || '').includes('Validate XMRig'));

              return {
                ready: hasReady || (childCount > 0 && innerText.length > 0),
                hasReady,
                hasBrowse,
                hasValidate,
                childCount,
                textLength: innerText.length,
                title: document.title
              };
            })()
          `);

          if (evalResult && evalResult.ready) {
            console.log('[SMOKE-TEST] React UI verification SUCCESS:', JSON.stringify(evalResult));
            if (evalResult.hasBrowse && evalResult.hasValidate) {
              console.log('[SMOKE-TEST] XMRig Configuration, Browse... button, and Validate XMRig button successfully detected in UI: PASS');
              verified = true;
              break;
            } else if (evalResult.hasBrowse) {
              console.log('[SMOKE-TEST] Browse... button detected in UI: PASS');
              verified = true;
              break;
            } else {
              lastReason = 'XMRig Configuration Browse... button not yet detected in Mining Dashboard UI';
            }
          } else {
            lastReason = evalResult?.reason || 'Waiting for React mount';
          }
        } catch (err: any) {
          lastReason = `eval error: ${err.message}`;
        }
        await new Promise(r => setTimeout(r, 400));
      }

      clearTimeout(smokeTimeout);

      if (!verified) {
        console.error(`[SMOKE-TEST] FAIL: React UI did not mount properly! Reason: ${lastReason}`);
        app.exit(1);
        return;
      }

      console.log('[SMOKE-TEST] Title:', mainWindow?.getTitle());
      console.log('[SMOKE-TEST] ALL SMOKE TEST CHECKS PASSED SUCCESSFULLY.');
      setTimeout(() => {
        mainWindow?.destroy();
        mainWindow = null;
        if (tray) {
          tray.destroy();
          tray = null;
        }
        app.exit(0);
      }, 500);
    });
  }

  // Load either local dev server or compiled production file with #mining hash for direct dashboard access
  const loadOptions = { hash: 'mining' };
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}#mining`);
  } else {
    const packagedIndexPath = path.join(app.getAppPath(), 'dist/index.html');
    const relativeIndexPath = path.join(__dirname, '../dist/index.html');
    const localDistIndexPath = path.join(process.cwd(), 'dist/index.html');
    if (fs.existsSync(packagedIndexPath)) {
      mainWindow.loadFile(packagedIndexPath, loadOptions);
    } else if (fs.existsSync(relativeIndexPath)) {
      mainWindow.loadFile(relativeIndexPath, loadOptions);
    } else if (fs.existsSync(localDistIndexPath)) {
      mainWindow.loadFile(localDistIndexPath, loadOptions);
    } else {
      mainWindow.loadURL('http://localhost:3000/#mining');
    }
  }

  mainWindow.on('close', async (event: any) => {
    const settings = loadSavedSettings();
    if (!isQuitting && settings.minimizeToTray && settings.runInBackgroundOnClose) {
      event.preventDefault();
      mainWindow?.hide();
    } else {
      // Normal close: Immediately stop mining to prevent unconsented background execution
      if (activeAdapter) {
        await activeAdapter.stop();
        activeAdapter = null;
      }
      await engineController.handleAppExit();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  createSystemTray();
}

function createSystemTray() {
  if (tray || isSmokeTest) return;

  try {
    // 16x16 transparent dot icon fallback
    const icon = nativeImage.createEmpty();
    tray = new Tray(icon);
    tray.setToolTip('SpinnerMine Cloud Miner');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open Dashboard',
        click: () => {
          mainWindow?.show();
          mainWindow?.focus();
        }
      },
      {
        label: 'Stop Mining',
        click: async () => {
          if (activeAdapter) {
            await activeAdapter.stop();
            activeAdapter = null;
            mainWindow?.webContents.send('mining-stopped');
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Quit SpinnerMine',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ]);

    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => {
      mainWindow?.show();
      mainWindow?.focus();
    });
  } catch (err) {
    console.warn('[desktop:main] System tray initialization skipped or unsupported:', err);
  }
}

// -----------------------------------------------------------------------------
// IPC Handlers
// -----------------------------------------------------------------------------

ipcMain.handle('mining:get-system-info', async () => {
  const settings = loadSavedSettings();
  return {
    cpuCores: os.cpus().length,
    platform: process.platform,
    arch: process.arch,
    totalMemoryGb: Math.round(os.totalmem() / (1024 * 1024 * 1024)),
    installationId: settings.installationId
  };
});

ipcMain.handle('mining:get-installation-id', async () => {
  return getPermanentInstallationId();
});

ipcMain.handle('app:get-device-identity', async () => {
  return loadPermanentDeviceIdentity();
});

ipcMain.handle('mining:detect-xmrig', async () => {
  const foundPath = XMRigAdapter.detectXMRigInstallation();
  return {
    found: Boolean(foundPath),
    path: foundPath
  };
});

ipcMain.handle('mining:select-xmrig-path', async () => {
  if (isSmokeTest) {
    console.log('[SMOKE-TEST] IPC mining:select-xmrig-path tested successfully (test path returned in non-interactive mode).');
    return 'C:\\Mining\\xmrig-6.26.0\\xmrig.exe';
  }
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Official XMRig Executable (xmrig.exe)',
    properties: ['openFile'],
    filters: [
      { name: 'XMRig Executable', extensions: ['exe'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('mining:test-pool', async (_event: any, payload: any) => {
  const host = String(payload?.host || '').trim();
  const port = Number(payload?.port);
  const useTls = Boolean(payload?.tls);

  if (!host || isNaN(port) || port < 1 || port > 65535) {
    return { success: false, error: 'Invalid host or port for connection test' };
  }

  const startTime = Date.now();
  try {
    const net = await import('net');
    const tls = await import('tls');

    return await new Promise<{ success: boolean; latencyMs: number; error?: string }>((resolve) => {
      let timer: NodeJS.Timeout;
      let socket: any;

      const finish = (success: boolean, error?: string) => {
        clearTimeout(timer);
        if (socket && !socket.destroyed) {
          try { socket.destroy(); } catch {}
        }
        resolve({
          success,
          latencyMs: Date.now() - startTime,
          ...(error ? { error } : {})
        });
      };

      timer = setTimeout(() => {
        finish(false, 'Stratum connection timed out (3500ms)');
      }, 3500);

      try {
        if (useTls) {
          socket = tls.connect({ host, port, servername: host, timeout: 3000 }, () => {
            finish(true);
          });
        } else {
          socket = net.createConnection({ host, port, timeout: 3000 }, () => {
            finish(true);
          });
        }
        socket.once('error', (err: any) => finish(false, err.message));
      } catch (err: any) {
        finish(false, err.message);
      }
    });
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('mining:validate-xmrig', async (_event: any, exePath: string) => {
  return XMRigAdapter.validateExecutable(exePath);
});

ipcMain.handle('mining:start', async (_event: any, payload: any) => {
  // Explicit Consent Check: Must have user consent flag
  if (!payload.consentAccepted) {
    return {
      success: false,
      error: 'User consent is required before starting real mining. Please accept the 20% user / 80% platform terms.'
    };
  }

  if (activeAdapter && activeAdapter.isProcessActive()) {
    return {
      success: false,
      error: 'Mining process is already running. Please stop current session first.'
    };
  }

  if (!payload.poolHost || !payload.poolPort || !payload.walletAddress) {
    return {
      success: false,
      error: 'Mining pool host, port, and user wallet address must be explicitly configured before starting mining.'
    };
  }

  try {
    activeAdapter = new XMRigAdapter({
      executablePath: payload.executablePath,
      expectedSha256: payload.expectedSha256,
      configOptions: {
        poolHost: payload.poolHost.trim(),
        poolPort: Number(payload.poolPort),
        tls: Boolean(payload.tls),
        walletAddress: payload.walletAddress.trim(),
        workerName: payload.workerName?.trim() || `win_${os.hostname()}`,
        threads: payload.threads || 2,
        maxThreadsHint: payload.throttle || 50,
        donateLevel: 1
      },
      simulatedMode: payload.simulatedMode === true && (process.env.NODE_ENV === 'test'),
      onTelemetry: (telemetry) => {
        mainWindow?.webContents.send('telemetry-update', telemetry);
      },
      onError: (err) => {
        mainWindow?.webContents.send('mining-error', err.message);
      },
      onExit: (_code, _signal) => {
        mainWindow?.webContents.send('mining-exit');
      }
    });

    await activeAdapter.start();
    return { success: true };
  } catch (err: any) {
    activeAdapter = null;
    return { success: false, error: err.message };
  }
});

ipcMain.handle('mining:stop', async () => {
  if (activeAdapter) {
    await activeAdapter.stop();
    activeAdapter = null;
  }
  return { success: true };
});

ipcMain.handle('mining:pause', async () => {
  if (activeAdapter) {
    const success = await activeAdapter.pause();
    return { success };
  }
  return { success: false, error: 'No active mining process to pause' };
});

ipcMain.handle('mining:resume', async () => {
  if (activeAdapter) {
    const success = await activeAdapter.resume();
    return { success };
  }
  return { success: false, error: 'No active mining process to resume' };
});

ipcMain.handle('mining:get-telemetry', async () => {
  if (!activeAdapter) {
    return {
      hashrate: 0,
      acceptedShares: 0,
      rejectedShares: 0,
      uptimeSeconds: 0,
      threads: 0,
      connectionStatus: 'disconnected'
    };
  }
  return activeAdapter.getTelemetry();
});

ipcMain.handle('app:save-settings', async (_event: any, settings: any) => {
  const success = saveUserSettings(settings);
  return { success };
});

ipcMain.handle('app:load-settings', async () => {
  return loadSavedSettings();
});

ipcMain.handle('app:minimize-to-tray', async () => {
  mainWindow?.hide();
});

// -----------------------------------------------------------------------------
// Phase 2C: Mining Engine Controller IPC Handlers
// -----------------------------------------------------------------------------

ipcMain.handle('engine:get-state', async () => {
  return engineController.getState();
});

ipcMain.handle('engine:execute-command', async (_event: any, command: MiningEngineCommand, config?: MiningEngineConfig) => {
  return engineController.executeCommand(command, config);
});

ipcMain.handle('engine:get-telemetry', async () => {
  return engineController.getTelemetry();
});

ipcMain.handle('engine:get-audit-log', async () => {
  return engineController.getAuditLog();
});

ipcMain.handle('engine:emergency-stop', async () => {
  return engineController.emergencyStop();
});

ipcMain.handle('engine:switch-type', async (_event: any, type: 'mock' | 'real') => {
  return engineController.setEngineType(type);
});

ipcMain.handle('engine:get-type', async () => {
  return engineController.getEngineType();
});

ipcMain.handle('mining:verify-stratum', async (_event: any, payload: any) => {
  const { StratumVerifier } = await import('../src/mining/stratum-verifier');
  return StratumVerifier.verifyPool(payload);
});

ipcMain.handle('mining:verify-real', async (_event: any, payload: any) => {
  const { RealMiningVerifier } = await import('../src/mining/real-mining-verifier');
  const verifier = new RealMiningVerifier();
  return verifier.verifyRealMining(payload);
});

ipcMain.handle('mining:query-pool-api', async (_event: any, payload: any) => {
  const { PoolApiVerifier } = await import('../src/mining/pool-api');
  return PoolApiVerifier.queryMinerStats(payload);
});

// App Lifecycle Cleanup
app.on('before-quit', async () => {
  isQuitting = true;
  if (activeAdapter) {
    await activeAdapter.stop();
    activeAdapter = null;
  }
  await engineController.handleAppExit();
});

app.on('will-quit', () => {
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
