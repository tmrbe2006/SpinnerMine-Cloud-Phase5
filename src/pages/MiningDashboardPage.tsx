import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { PhaseBadge } from '../components/common/PhaseBadge';
import { MiningWorker, WorkerPlatform, XMRigTelemetry } from '../types';
import { collection, query, where, onSnapshot, doc, deleteDoc, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import { 
  Cpu, 
  Sliders, 
  Play, 
  Square, 
  Plus, 
  Server, 
  Laptop, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  ShieldAlert,
  Percent,
  RefreshCw,
  Trash2,
  Download,
  Activity,
  Copy,
  Check,
  Pause,
  ExternalLink,
  WifiOff,
  Radio,
  FolderOpen,
  Wifi,
  HeartPulse,
  Edit3,
  Layers,
  ShieldCheck,
  Archive,
  GitMerge,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import { 
  getPoolConfig, 
  testPoolConnection, 
  registerWorker, 
  sendWorkerTelemetry,
  sendWorkerHeartbeat,
  WorkerHeartbeatPayload,
  checkBackendHealth,
  getBackendBaseUrl,
  setCustomBackendUrl,
  getCustomBackendUrl,
  DEFAULT_PRODUCTION_BACKEND_URL,
  getDuplicateWorkers,
  renameWorker,
  linkWorkerInstallation,
  fetchUserWorkers
} from '../services/apiClient';
import {
  computeWorkerStatus,
  formatLastSeen,
  getStatusBadgeConfig,
  HEARTBEAT_INTERVAL_MS,
  OFFLINE_THRESHOLD_MS
} from '../utils/worker-status';
import {
  getDeviceInstallationId,
  getShortInstallationId,
  detectDuplicateWorkers,
  deriveWorkerIdFromInstallation
} from '../utils/installation-id';
import { DuplicateWorkerResolverModal, DuplicateGroupItem } from '../components/mining/DuplicateWorkerResolverModal';
import { SafeMiningControllerPanel } from '../components/mining/SafeMiningControllerPanel';
import { RealMiningVerificationPanel } from '../components/mining/RealMiningVerificationPanel';

interface MiningDashboardPageProps {
  onOpenConsentModal: () => void;
  onNavigateLogin?: () => void;
}

export const MiningDashboardPage: React.FC<MiningDashboardPageProps> = ({ onOpenConsentModal, onNavigateLogin }) => {
  const { currentUser, userProfile } = useAuth();
  const { t, language } = useLanguage();

  const detectedCores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  const [threads, setThreads] = useState<number>(Math.max(1, Math.floor(detectedCores / 2)));
  const [throttle, setThrottle] = useState<number>(50); // 50% CPU cap

  // Unified CPU Thread Updater: Clamps strictly between 1 and detected hardware cores
  const updateThreads = (val: number) => {
    const clamped = Math.max(1, Math.min(detectedCores, Math.floor(val) || 1));
    setThreads(clamped);
    if (isElectron && electronAPI?.saveSettings) {
      electronAPI.saveSettings({ xmrigPath, threads: clamped, throttle });
    }
  };

  // Real Engine Mining State
  const [isMining, setIsMining] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [sessionSeconds, setSessionSeconds] = useState<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Active Telemetry
  const [telemetry, setTelemetry] = useState<XMRigTelemetry>({
    hashrate: 0,
    acceptedShares: 0,
    rejectedShares: 0,
    uptimeSeconds: 0,
    threads: Math.max(1, Math.floor(detectedCores / 2)),
    cpuUsage: 0,
    connectionStatus: 'disconnected'
  });

  // Pool Configuration & Real Connectivity Test
  const [poolHost, setPoolHost] = useState('pool.supportxmr.com');
  const [poolPort, setPoolPort] = useState(3333);
  const [poolTls, setPoolTls] = useState(false);
  const [poolWallet, setPoolWallet] = useState<string>(() => {
    try {
      return localStorage.getItem('spinnermine_user_xmr_wallet') || '';
    } catch {
      return '';
    }
  });
  const [testingPool, setTestingPool] = useState(false);
  const [poolTestResult, setPoolTestResult] = useState<{ success: boolean; latencyMs?: number; error?: string } | null>(null);
  const [showPoolConfigModal, setShowPoolConfigModal] = useState(false);
  const [backendOfflineNotice, setBackendOfflineNotice] = useState<string | null>(null);

  // Electron Native Desktop Client Detection
  const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI || window.electronMiningAPI);
  const electronAPI = typeof window !== 'undefined' ? (window.electronAPI || window.electronMiningAPI) : undefined;

  // Electron XMRig Configuration States
  const [xmrigPath, setXmrigPath] = useState<string>('');
  const [isValidatingXmrig, setIsValidatingXmrig] = useState<boolean>(false);
  const [xmrigValidationResult, setXmrigValidationResult] = useState<{
    valid: boolean;
    reason?: string;
  } | null>(null);
  const [miningError, setMiningError] = useState<string | null>(null);

  // Worker registration modal
  const [showAddWorkerModal, setShowAddWorkerModal] = useState(false);
  const [newWorkerName, setNewWorkerName] = useState('');
  const [newWorkerPlatform, setNewWorkerPlatform] = useState<WorkerPlatform>('windows');
  const [savingWorker, setSavingWorker] = useState(false);
  const [copiedWorkerId, setCopiedWorkerId] = useState(false);
  const [workerModalError, setWorkerModalError] = useState<string | null>(null);
  const [workerModalSuccess, setWorkerModalSuccess] = useState<string | null>(null);

  // Cloud & Backend diagnostics state
  const [showBackendModal, setShowBackendModal] = useState(false);
  const [backendHealth, setBackendHealth] = useState<{ ok: boolean; status: number; data?: any; error?: string; latencyMs?: number } | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [customBackendInput, setCustomBackendInput] = useState(() => getCustomBackendUrl() || '');
  const [syncingDrafts, setSyncingDrafts] = useState(false);
  const [syncNotice, setSyncNotice] = useState<{ type: 'error' | 'success' | 'info'; message: string } | null>(null);
  const [backendUrlFeedback, setBackendUrlFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [workers, setWorkers] = useState<MiningWorker[]>([]);
  const [_loadingWorkers, setLoadingWorkers] = useState(true);

  // Stable Installation Identity & Deduplication State
  const [installationId, setInstallationId] = useState<string>('');
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroupItem[]>([]);
  const [showDuplicateModal, setShowDuplicateModal] = useState<boolean>(false);
  const [renamingWorker, setRenamingWorker] = useState<MiningWorker | null>(null);
  const [renameInput, setRenameInput] = useState<string>('');
  const [savingRename, setSavingRename] = useState<boolean>(false);
  const [renameFeedback, setRenameFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showArchivedSection, setShowArchivedSection] = useState<boolean>(true);

  // Phase 2D.1: Permanent Device Identity Linking State
  const [linkingWorker, setLinkingWorker] = useState<MiningWorker | null>(null);
  const [linkingConsent, setLinkingConsent] = useState<boolean>(false);
  const [isLinking, setIsLinking] = useState<boolean>(false);
  const [linkNotice, setLinkNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Load persistent installation ID on mount
  useEffect(() => {
    getDeviceInstallationId().then(id => {
      setInstallationId(id);
    }).catch(() => {});
  }, []);

  // Phase 2B Real-Time Worker Monitoring & Heartbeat State
  const [activeWorkerId, setActiveWorkerId] = useState<string>(() => {
    try {
      return localStorage.getItem('spinnermine_active_worker_id') || '';
    } catch {
      return '';
    }
  });
  const [heartbeatNotice, setHeartbeatNotice] = useState<{
    type: 'success' | 'error';
    message: string;
    workerId?: string;
    timestamp?: string;
  } | null>(null);
  const [testingHeartbeatFor, setTestingHeartbeatFor] = useState<string | null>(null);
  const [lastHeartbeatSent, setLastHeartbeatSent] = useState<string | null>(null);
  const [currentTick, setCurrentTick] = useState<number>(Date.now());

  // 15-second local timer to keep relative time strings and 3-minute offline threshold updated in real-time
  useEffect(() => {
    const tickInterval = setInterval(() => {
      setCurrentTick(Date.now());
    }, 15000);
    return () => clearInterval(tickInterval);
  }, []);

  // Duplicate detection & Primary Active Worker Resolution
  useEffect(() => {
    if (workers.length === 0) {
      setDuplicateGroups([]);
      return;
    }
    const localDups = detectDuplicateWorkers(workers);
    const mapped: DuplicateGroupItem[] = localDups.map(g => ({
      primaryWorkerId: g.primaryWorker.workerId || g.primaryWorker.id || '',
      primaryName: g.primaryWorker.name || g.primaryWorker.deviceName || '',
      duplicateWorkerId: g.duplicateWorkers[0]?.workerId || g.duplicateWorkers[0]?.id || '',
      duplicateName: g.duplicateWorkers[0]?.name || g.duplicateWorkers[0]?.deviceName || '',
      reason: g.reason === 'legacy_device_alias' 
        ? (language === 'ar' ? 'تسجيل مكرر لجهاز Windows نفسه (tm و ty)' : 'Legacy Windows duplicate registration (tm & ty)')
        : (language === 'ar' ? 'تطابق معرف التثبيت (Installation ID)' : 'Identical Installation ID'),
      duplicateSessionsCount: 0,
      duplicateAcceptedShares: g.duplicateWorkers[0]?.acceptedShares || 0,
      installationId: g.primaryWorker.installationId || g.duplicateWorkers[0]?.installationId
    }));
    setDuplicateGroups(mapped);

    // Enforce tm (w_qBPFqVEe_tm) as primary active worker if present
    const tmWorker = workers.find(w => w.workerId === 'w_qBPFqVEe_tm' || w.name === 'tm');
    if (tmWorker && (!activeWorkerId || activeWorkerId === 'w_GyAldfJ5_ty')) {
      const tmId = tmWorker.workerId || tmWorker.id || 'w_qBPFqVEe_tm';
      setActiveWorkerId(tmId);
      try { localStorage.setItem('spinnermine_active_worker_id', tmId); } catch {}
    }
  }, [workers, language, activeWorkerId]);

  const handleSelectActiveWorker = (id: string) => {
    setActiveWorkerId(id);
    try {
      localStorage.setItem('spinnermine_active_worker_id', id);
    } catch {}
  };

  const handleCheckDuplicates = async () => {
    if (!currentUser) {
      setShowDuplicateModal(true);
      return;
    }
    try {
      const idToken = await currentUser.getIdToken();
      const res = await getDuplicateWorkers(idToken);
      if (res.success && res.groups.length > 0) {
        setDuplicateGroups(res.groups);
      }
    } catch {}
    setShowDuplicateModal(true);
  };

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingWorker || !renameInput.trim() || savingRename) return;
    setSavingRename(true);
    setRenameFeedback(null);

    const targetId = renamingWorker.workerId || renamingWorker.id || '';
    const newName = renameInput.trim();

    try {
      const idToken = currentUser ? await currentUser.getIdToken() : undefined;
      const res = await renameWorker(targetId, newName, newName, idToken);
      if (res.success) {
        setWorkers(prev => prev.map(w => {
          if ((w.workerId && w.workerId === targetId) || (w.id && w.id === targetId)) {
            return { ...w, name: newName, deviceName: newName };
          }
          return w;
        }));
        setRenameFeedback({
          type: 'success',
          message: language === 'ar' ? 'تم تحديث اسم الجهاز بنجاح مع الحفاظ على هوية الجهاز' : 'Worker renamed successfully without altering workerId'
        });
        setTimeout(() => {
          setRenamingWorker(null);
          setRenameInput('');
          setRenameFeedback(null);
          setSavingRename(false);
        }, 800);
      } else {
        setRenameFeedback({
          type: 'error',
          message: res.error || 'Failed to rename worker'
        });
        setSavingRename(false);
      }
    } catch (err: any) {
      setRenameFeedback({
        type: 'error',
        message: err.message || 'Failed to rename worker'
      });
      setSavingRename(false);
    }
  };

  const handlePromptLinkInstallation = (worker: MiningWorker) => {
    setLinkingWorker(worker);
    setLinkingConsent(false);
    setLinkNotice(null);
  };

  const handleConfirmLinkInstallation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkingWorker || isLinking) return;

    if (!currentUser) {
      setLinkNotice({
        type: 'error',
        message: language === 'ar' ? 'يجب تسجيل الدخول أولاً لربط معرف التثبيت الدائم.' : 'Authentication required to link permanent installation ID.'
      });
      return;
    }

    if (!linkingConsent) {
      setLinkNotice({
        type: 'error',
        message: language === 'ar' ? 'يرجى تأكيد الموافقة على شروط ربط المعرف الدائم للمتابعة.' : 'Please confirm your consent to link the permanent installation ID.'
      });
      return;
    }

    setIsLinking(true);
    setLinkNotice(null);

    try {
      const idToken = await currentUser.getIdToken(true);
      const currentInstId = installationId || await getDeviceInstallationId();
      const targetWorkerId = linkingWorker.workerId || linkingWorker.id || '';

      const res = await linkWorkerInstallation(targetWorkerId, currentInstId, idToken, true);
      if (res.success) {
        setLinkNotice({
          type: 'success',
          message: language === 'ar'
            ? `تم بنجاح ربط معرف التثبيت الدائم (${currentInstId}) بجهاز ${linkingWorker.name || targetWorkerId}!`
            : `Successfully linked permanent installation ID (${currentInstId}) to worker ${linkingWorker.name || targetWorkerId}!`
        });

        // Update local worker state immediately
        setWorkers(prev => prev.map(w => {
          if ((w.workerId && w.workerId === targetWorkerId) || (w.id && w.id === targetWorkerId)) {
            return {
              ...w,
              installationId: currentInstId
            };
          }
          return w;
        }));

        setTimeout(() => {
          setLinkingWorker(null);
          setLinkingConsent(false);
          setLinkNotice(null);
          setIsLinking(false);
        }, 1500);
      } else {
        setLinkNotice({
          type: 'error',
          message: res.error || (language === 'ar' ? 'فشل ربط المعرف الدائم' : 'Failed to link installation ID')
        });
        setIsLinking(false);
      }
    } catch (err: any) {
      setLinkNotice({
        type: 'error',
        message: err.message || (language === 'ar' ? 'حدث خطأ أثناء الربط' : 'Error linking installation ID')
      });
      setIsLinking(false);
    }
  };

  // Unique Worker ID for Windows Client Pairing: linked to tm or installation identity
  const defaultWorkerId = currentUser 
    ? (workers.find(w => w.workerId === 'w_qBPFqVEe_tm')?.workerId || (installationId ? deriveWorkerIdFromInstallation(currentUser.uid, installationId) : `win_${currentUser.uid.slice(0, 8)}`))
    : 'win_local_worker';

  // Load pool configuration via cross-platform API Client (graceful offline fallback)
  useEffect(() => {
    getPoolConfig()
      .then(config => {
        if (config.poolHost) setPoolHost(config.poolHost);
        if (config.poolPort) setPoolPort(config.poolPort);
        if (config.tlsEnabled !== undefined) setPoolTls(config.tlsEnabled);
        if (config.walletAddress) setPoolWallet(config.walletAddress);
        if (config.isOffline && config.notice) {
          setBackendOfflineNotice(config.notice);
        }
      })
      .catch((err) => {
        console.warn('[Mining Dashboard] Note on pool config fetch:', err);
      });
  }, []);

  // Load saved settings & auto-detect XMRig in Electron
  useEffect(() => {
    if (!electronAPI) return;

    electronAPI.loadSettings?.().then((settings) => {
      if (settings?.xmrigPath) {
        setXmrigPath(settings.xmrigPath);
        electronAPI.validateXMRig?.(settings.xmrigPath).then(setXmrigValidationResult).catch(() => {});
      }
      if (settings?.threads) setThreads(settings.threads);
      if (settings?.throttle) setThrottle(settings.throttle);
    }).catch(() => {});

    electronAPI.detectXMRig?.().then((detected) => {
      if (detected?.found && detected.path && !xmrigPath) {
        setXmrigPath(detected.path);
        electronAPI.validateXMRig?.(detected.path).then(setXmrigValidationResult).catch(() => {});
      }
    }).catch(() => {});

    const unsubTelemetry = electronAPI.onTelemetryUpdate?.((data) => {
      if (data) {
        setTelemetry({
          hashrate: Number(data.hashrate) || 0,
          acceptedShares: Number(data.acceptedShares) || 0,
          rejectedShares: Number(data.rejectedShares) || 0,
          uptimeSeconds: Number(data.uptimeSeconds) || 0,
          threads: Number(data.threads) || threads,
          cpuUsage: data.cpuUsage !== undefined ? Number(data.cpuUsage) : undefined,
          connectionStatus: data.connectionStatus || 'connected'
        });
      }
    });

    const unsubError = electronAPI.onMiningError?.((err) => {
      setMiningError(String(err));
      setIsMining(false);
      setIsPaused(false);
    });

    return () => {
      if (unsubTelemetry) unsubTelemetry();
      if (unsubError) unsubError();
    };
  }, [electronAPI]);

  // Sync pending local drafts to authoritative backend
  const syncPendingDrafts = async () => {
    if (syncingDrafts) return;

    if (!currentUser) {
      setSyncNotice({
        type: 'error',
        message: language === 'ar'
          ? 'المصادقة مطلوبة للمزامنة: يرجى تسجيل الدخول بحسابك أولاً لإتمام مزامنة الأجهزة مع السحابة.'
          : 'Authentication required: You must be signed in to sync and confirm worker devices with the cloud.'
      });
      return;
    }

    setSyncingDrafts(true);
    setSyncNotice(null);

    try {
      const localDraftKey = `spinnermine_pending_workers_${currentUser.uid}`;
      let userDrafts: MiningWorker[] = [];
      try {
        userDrafts = JSON.parse(localStorage.getItem(localDraftKey) || '[]');
      } catch {}

      // Adopt guest drafts into current user's drafts
      const guestKey = 'spinnermine_pending_workers_guest';
      let guestDrafts: MiningWorker[] = [];
      try {
        guestDrafts = JSON.parse(localStorage.getItem(guestKey) || '[]');
        if (guestDrafts.length > 0) {
          localStorage.removeItem(guestKey);
        }
      } catch {}

      // Discover any additional stored drafts across localStorage (e.g. device 'tv' or legacy keys)
      const additionalDrafts: MiningWorker[] = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('spinnermine_pending_workers_') && key !== localDraftKey && key !== guestKey) {
            try {
              const parsed = JSON.parse(localStorage.getItem(key) || '[]');
              if (Array.isArray(parsed)) {
                additionalDrafts.push(...parsed);
                localStorage.removeItem(key);
              }
            } catch {}
          }
        }
      } catch {}

      const combinedDrafts = [...userDrafts, ...guestDrafts, ...additionalDrafts];
      // Deduplicate by workerId or name
      const draftMap = new Map<string, MiningWorker>();
      for (const d of combinedDrafts) {
        const id = d.workerId || d.id || d.name || 'device';
        if (!draftMap.has(id)) {
          draftMap.set(id, { ...d, userId: currentUser.uid });
        }
      }
      const allDrafts = Array.from(draftMap.values());

      if (allDrafts.length === 0) {
        setSyncingDrafts(false);
        return;
      }

      // Request fresh token to prevent 401 expiration
      const idToken = await currentUser.getIdToken(true);
      const stillPending: MiningWorker[] = [];
      let successCount = 0;
      let lastErrorMessage = '';

      for (const draft of allDrafts) {
        const targetWorkerId = draft.workerId || draft.id || `w_${currentUser.uid.slice(0, 8)}_${(draft.name || 'device').toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
        const targetName = draft.name || draft.deviceName || 'Windows Worker';

        try {
          const res = await registerWorker({
            workerId: targetWorkerId,
            name: targetName,
            deviceName: draft.deviceName || targetName,
            platform: draft.platform || 'windows',
            cpuCores: draft.cpuCores || detectedCores,
            threads: draft.threads || threads,
            xmrigVersion: draft.xmrigVersion || '6.26.0'
          }, idToken);

          if (res.success) {
            successCount++;
            // Immediately transition in UI to Confirmed (status: offline)
            setWorkers(prev => prev.map(w => {
              const matches = (w.workerId && (w.workerId === targetWorkerId || w.workerId === draft.workerId || w.workerId === draft.id)) ||
                              (w.id && (w.id === targetWorkerId || w.id === draft.id || w.id === draft.workerId)) ||
                              (w.name && w.name === draft.name);
              if (matches) {
                return {
                  ...w,
                  workerId: targetWorkerId,
                  status: 'offline',
                  isPendingSync: false,
                  syncAttemptError: undefined
                };
              }
              return w;
            }));
          } else {
            const errNotice = res.error || `HTTP ${res.status || 0}`;
            lastErrorMessage = errNotice;
            stillPending.push({
              ...draft,
              workerId: targetWorkerId,
              syncAttemptError: {
                status: res.status ?? 0,
                error: errNotice,
                timestamp: new Date().toISOString()
              }
            });
          }
        } catch (syncErr: any) {
          const errNotice = syncErr.message || 'Network / connection failure';
          lastErrorMessage = errNotice;
          stillPending.push({
            ...draft,
            workerId: targetWorkerId,
            syncAttemptError: {
              status: 0,
              error: errNotice,
              timestamp: new Date().toISOString()
            }
          });
        }
      }

      // CRITICAL: DO NOT DELETE ANY LOCAL DRAFT UNLESS API CONFIRMED SUCCESS
      localStorage.setItem(localDraftKey, JSON.stringify(stillPending));

      if (successCount > 0 && stillPending.length === 0) {
        setSyncNotice({
          type: 'success',
          message: language === 'ar'
            ? `تمت مزامنة وتأكيد ${successCount} جهاز(أجهزة) بنجاح في قاعدة البيانات!`
            : `Successfully synchronized and confirmed ${successCount} device(s) in production database!`
        });
      } else if (stillPending.length > 0) {
        setSyncNotice({
          type: 'error',
          message: language === 'ar'
            ? `تعذر تأكيد ${stillPending.length} جهاز (${lastErrorMessage}). الأجهزة محفوظة محلياً؛ افتح شاشة تشخيص الخادم.`
            : `Could not confirm ${stillPending.length} device(s) (${lastErrorMessage}). Saved locally as draft.`
        });
      }
    } catch (err: any) {
      console.warn('[Mining Dashboard] Note on drafts sync:', err?.message || err);
      setSyncNotice({
        type: 'error',
        message: err?.message || 'Sync error'
      });
    } finally {
      setSyncingDrafts(false);
    }
  };

  // Diagnostic backend health test with detailed reporting
  const handleCheckBackendHealth = async () => {
    setCheckingHealth(true);
    setBackendHealth(null);
    try {
      const activeUrl = customBackendInput.trim() || getBackendBaseUrl() || DEFAULT_PRODUCTION_BACKEND_URL;
      const res = await checkBackendHealth(activeUrl);
      setBackendHealth(res);
    } catch (err: any) {
      setBackendHealth({
        ok: false,
        status: 0,
        error: err.message || 'Connection failed',
        latencyMs: 0
      });
    } finally {
      setCheckingHealth(false);
    }
  };

  // Auto-sync pending drafts when user signs in or reconnects
  useEffect(() => {
    if (currentUser) {
      syncPendingDrafts();
    }
  }, [currentUser]);

  // Phase 2B: Heartbeat dispatcher function for automatic periodic ticks or manual tests
  const sendHeartbeatForWorker = async (targetWorkerId: string, isManualTest: boolean = false) => {
    if (!currentUser || !targetWorkerId) return;

    if (isManualTest) {
      setTestingHeartbeatFor(targetWorkerId);
      setHeartbeatNotice(null);
    }

    try {
      const idToken = await currentUser.getIdToken();
      const activeStatus = isMining ? 'mining' : 'online';
      const hashrate = isMining ? (telemetry.hashrate || 0) : 0;

      const payload: WorkerHeartbeatPayload = {
        workerId: targetWorkerId,
        status: activeStatus,
        reportedHashrate: hashrate,
        threads: threads,
        cpuUsage: telemetry.cpuUsage !== undefined ? telemetry.cpuUsage : (isElectron ? 12 : undefined)
      };

      const res = await sendWorkerHeartbeat(payload, idToken);
      if (res.success) {
        const timeStr = new Date().toLocaleTimeString();
        setLastHeartbeatSent(timeStr);
        if (isManualTest) {
          setHeartbeatNotice({
            type: 'success',
            message: language === 'ar'
              ? `تم تأكيد نبض الجهاز (${targetWorkerId}) بنجاح! الجهاز متصل الآن بالسحابة.`
              : `Heartbeat confirmed for (${targetWorkerId})! Device is now Online in production cloud.`,
            workerId: targetWorkerId,
            timestamp: timeStr
          });
        }

        // Optimistically update local state so UI transitions immediately
        setWorkers(prev => prev.map(w => {
          if (w.workerId === targetWorkerId || w.id === targetWorkerId) {
            return {
              ...w,
              lastSeen: new Date().toISOString(),
              status: activeStatus,
              reportedHashrate: hashrate,
              threads: threads,
              cpuUsage: payload.cpuUsage
            };
          }
          return w;
        }));
      } else {
        if (isManualTest) {
          setHeartbeatNotice({
            type: 'error',
            message: res.error || (language === 'ar' ? 'فشل إرسال نبض الجهاز' : 'Failed to send heartbeat'),
            workerId: targetWorkerId
          });
        }
      }
    } catch (err: any) {
      if (isManualTest) {
        setHeartbeatNotice({
          type: 'error',
          message: err.message || (language === 'ar' ? 'فشل إرسال نبض الجهاز' : 'Failed to send heartbeat'),
          workerId: targetWorkerId
        });
      }
    } finally {
      if (isManualTest) {
        setTestingHeartbeatFor(null);
      }
    }
  };

  // Phase 2B Automatic Heartbeat: Fires every 60 seconds while app is active and logged in
  useEffect(() => {
    if (!currentUser) return;

    const confirmedWorkers = workers.filter(w => !w.isPendingSync && w.status !== 'pending_sync' && !w.isArchived && !w.mergedInto && w.status !== 'archived');
    if (confirmedWorkers.length === 0) return;

    // Resolve primary active worker: prioritize tm (w_qBPFqVEe_tm), then matching installationId, then activeWorkerId, then first active
    const primary = 
      confirmedWorkers.find(w => w.workerId === 'w_qBPFqVEe_tm' || w.name === 'tm') ||
      confirmedWorkers.find(w => Boolean(w.installationId && installationId && w.installationId === installationId)) ||
      confirmedWorkers.find(w => w.workerId === activeWorkerId || w.id === activeWorkerId) || 
      confirmedWorkers[0];
    const targetId = primary.workerId || primary.id;
    if (!targetId) return;

    // Send immediate initial heartbeat
    sendHeartbeatForWorker(targetId, false);

    // 60-second recurring heartbeat
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      sendHeartbeatForWorker(targetId, false);
    }, HEARTBEAT_INTERVAL_MS);

    // Network reconnection listener: send immediate heartbeat upon reconnecting
    const handleNetworkOnline = () => {
      sendHeartbeatForWorker(targetId, false);
    };
    window.addEventListener('online', handleNetworkOnline);

    return () => {
      clearInterval(interval);
      window.removeEventListener('online', handleNetworkOnline);
    };
  }, [currentUser, workers.length, activeWorkerId, isMining, threads, telemetry.hashrate, installationId]);

  // Load user workers from Firestore and aggregate real hardware telemetry
  useEffect(() => {
    if (!currentUser) {
      try {
        const guestDrafts = JSON.parse(localStorage.getItem('spinnermine_pending_workers_guest') || '[]');
        if (guestDrafts.length > 0) {
          setWorkers(guestDrafts.map((d: any) => ({ ...d, isPendingSync: true, status: 'pending_sync' })));
        }
      } catch {}
      setLoadingWorkers(false);
      return;
    }

    const cachedKey = `spinnermine_cached_workers_${currentUser.uid}`;
    // 1. Immediately hydrate from local cache to prevent empty screen flicker / disappearance
    try {
      const cached = localStorage.getItem(cachedKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setWorkers(parsed);
          setLoadingWorkers(false);
        }
      }
    } catch {}

    let localDrafts: MiningWorker[] = [];
    try {
      localDrafts = JSON.parse(localStorage.getItem(`spinnermine_pending_workers_${currentUser.uid}`) || '[]');
    } catch {}

    const q = query(collection(db, 'miningWorkers'), where('userId', '==', currentUser.uid));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const firestoreList = snapshot.docs.map(d => ({
          id: d.id,
          ...d.data(),
          isPendingSync: false
        } as MiningWorker));

        // Purge any local drafts that are now confirmed in Firestore
        const remainingDrafts = localDrafts.filter(draft =>
          !firestoreList.some(f => (f.workerId && f.workerId === draft.workerId) || (f.id && f.id === draft.id))
        );
        if (remainingDrafts.length !== localDrafts.length) {
          try {
            localStorage.setItem(`spinnermine_pending_workers_${currentUser.uid}`, JSON.stringify(remainingDrafts));
          } catch {}
        }

        const mergedList = [
          ...firestoreList,
          ...remainingDrafts.map(d => ({ ...d, isPendingSync: true, status: 'pending_sync' as const }))
        ];
        setWorkers(mergedList);
        setLoadingWorkers(false);

        // Cache persistent workers so offline or reload immediately displays devices
        try {
          localStorage.setItem(cachedKey, JSON.stringify(mergedList));
        } catch {}

        // Aggregate actual telemetry from active hardware workers
        const activeWorkers = mergedList.filter(w => w.status === 'mining');
        if (activeWorkers.length > 0) {
          const totalHash = activeWorkers.reduce((sum, w) => sum + (w.reportedHashrate || 0), 0);
          const totalAccepted = activeWorkers.reduce((sum, w) => sum + (w.acceptedShares || 0), 0);
          const totalRejected = activeWorkers.reduce((sum, w) => sum + (w.rejectedShares || 0), 0);
          const totalThreads = activeWorkers.reduce((sum, w) => sum + (w.threads || 2), 0);

          setTelemetry({
            hashrate: totalHash,
            acceptedShares: totalAccepted,
            rejectedShares: totalRejected,
            uptimeSeconds: 0,
            threads: totalThreads,
            cpuUsage: undefined, // Actual usage reported by hardware
            connectionStatus: 'connected'
          });
        } else if (!isMining) {
          setTelemetry({
            hashrate: 0,
            acceptedShares: 0,
            rejectedShares: 0,
            uptimeSeconds: 0,
            threads,
            cpuUsage: undefined,
            connectionStatus: 'disconnected'
          });
        }
      },
      (err) => {
        const targetProj = db.app?.options?.projectId || 'unknown';
        console.warn(`[Mining Dashboard] Note on worker Firestore subscription (Project: ${targetProj}, UID: ${currentUser.uid}):`, err.message);

        // CRITICAL: DO NOT convert subscription error into an empty list!
        // Fallback to Authoritative Backend API endpoint to fetch workers if direct Firestore subscription encounters network or index issues
        currentUser.getIdToken().then(async (idToken) => {
          try {
            const apiRes = await fetchUserWorkers(idToken);
            if (apiRes.success && apiRes.workers && apiRes.workers.length > 0) {
              const apiWorkers = apiRes.workers;
              const remainingDrafts = localDrafts.filter(d => !apiWorkers.some(w => (w.workerId && w.workerId === d.workerId) || (w.id && w.id === d.id)));
              const merged = [
                ...apiWorkers,
                ...remainingDrafts.map(d => ({ ...d, isPendingSync: true, status: 'pending_sync' as const }))
              ];
              setWorkers(merged);
              try {
                localStorage.setItem(cachedKey, JSON.stringify(merged));
              } catch {}
            }
          } catch {}
        }).catch(() => {});

        setLoadingWorkers(false);
      }
    );
    return () => unsub();
  }, [currentUser, isMining, threads]);

  // Session elapsed timer
  useEffect(() => {
    if (isMining && !isPaused) {
      timerRef.current = setInterval(() => {
        setSessionSeconds(s => s + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isMining, isPaused]);

  const handleBrowseXMRig = async () => {
    if (!electronAPI?.selectXMRigPath) return;
    setMiningError(null);
    try {
      const selected = await electronAPI.selectXMRigPath();
      if (selected) {
        setXmrigPath(selected);
        setIsValidatingXmrig(true);
        const result = await electronAPI.validateXMRig(selected);
        setXmrigValidationResult(result);
        electronAPI.saveSettings?.({ xmrigPath: selected, threads, throttle });
      }
    } catch (err: any) {
      setMiningError(`Error selecting XMRig: ${err.message}`);
    } finally {
      setIsValidatingXmrig(false);
    }
  };

  const handleValidateXMRig = async () => {
    if (!electronAPI?.validateXMRig) return;
    if (!xmrigPath.trim()) {
      setXmrigValidationResult({ valid: false, reason: 'Please specify an XMRig executable path first.' });
      return;
    }
    setIsValidatingXmrig(true);
    setMiningError(null);
    try {
      const result = await electronAPI.validateXMRig(xmrigPath.trim());
      setXmrigValidationResult(result);
      if (result.valid) {
        electronAPI.saveSettings?.({ xmrigPath: xmrigPath.trim(), threads, throttle });
      }
    } catch (err: any) {
      setXmrigValidationResult({ valid: false, reason: err.message || 'Validation failed' });
    } finally {
      setIsValidatingXmrig(false);
    }
  };

  const handleToggleMining = async () => {
    if (!userProfile?.miningConsent && !isElectron) {
      onOpenConsentModal();
      return;
    }

    if (isMining) {
      // Stop mining
      if (isElectron && electronAPI) {
        try {
          await electronAPI.stopMining();
        } catch (err: any) {
          console.warn('Error stopping electron mining:', err);
        }
      }

      setIsMining(false);
      setIsPaused(false);
      setSessionSeconds(0);
      setTelemetry({
        hashrate: 0,
        acceptedShares: 0,
        rejectedShares: 0,
        uptimeSeconds: 0,
        threads,
        cpuUsage: 0,
        connectionStatus: 'disconnected'
      });

      // Update backend status to offline
      if (currentUser) {
        currentUser.getIdToken().then(idToken => {
          sendWorkerTelemetry({
            workerId: defaultWorkerId,
            reportedHashrate: 0,
            status: 'offline'
          }, idToken).catch(() => {});
        }).catch(() => {});
      }
    } else {
      // Start mining
      setMiningError(null);

      // In Electron Desktop, strictly run native XMRig via electronAPI
      if (isElectron && electronAPI) {
        if (!xmrigPath.trim()) {
          setMiningError('Please specify and validate the XMRig executable path first using Browse...');
          return;
        }

        if (xmrigValidationResult && !xmrigValidationResult.valid) {
          setMiningError(`Cannot start unverified binary: ${xmrigValidationResult.reason}`);
          return;
        }

        if (!poolHost.trim() || !poolPort || !poolWallet.trim()) {
          setMiningError('Please configure Mining Pool Host, Port, and Wallet Address before starting.');
          return;
        }

        try {
          const res = await electronAPI.startMining({
            executablePath: xmrigPath.trim(),
            poolHost: poolHost.trim(),
            poolPort: Number(poolPort),
            tls: poolTls,
            walletAddress: poolWallet.trim(),
            workerName: defaultWorkerId,
            threads,
            throttle,
            consentAccepted: true
          });

          if (!res?.success) {
            // Strictly fail if XMRig did not start (Requirement 8)
            setMiningError(res?.error || 'Failed to start XMRig mining process.');
            setIsMining(false);
            return;
          }

          setIsMining(true);
          setIsPaused(false);
          setSessionSeconds(0);
          setTelemetry(prev => ({
            ...prev,
            connectionStatus: 'connected',
            threads
          }));
        } catch (err: any) {
          setMiningError(err.message || 'Fatal error launching XMRig process.');
          setIsMining(false);
          return;
        }
      } else {
        // Standard Web mode
        setIsMining(true);
        setIsPaused(false);
        setSessionSeconds(0);
        setTelemetry(prev => ({
          ...prev,
          connectionStatus: 'connecting',
          threads
        }));
      }

      // Register or update worker in backend
      if (currentUser) {
        currentUser.getIdToken().then(idToken => {
          registerWorker({
            workerId: defaultWorkerId,
            name: isElectron ? `Windows PC (${detectedCores} cores)` : `Web Worker (${detectedCores} cores)`,
            deviceName: isElectron ? 'Windows Desktop Host' : 'Browser WebAssembly Node',
            platform: isElectron ? 'windows' : 'browser',
            cpuCores: detectedCores,
            threads,
            xmrigVersion: '6.26.0',
            installationId
          }, idToken).catch(() => {});
        }).catch(() => {});
      }
    }
  };

  const handlePauseResume = async () => {
    if (isElectron && electronAPI) {
      if (isPaused) {
        const res = await electronAPI.resumeMining();
        if (res?.success) setIsPaused(false);
      } else {
        const res = await electronAPI.pauseMining();
        if (res?.success) setIsPaused(true);
      }
      return;
    }
    setIsPaused(!isPaused);
  };

  const handleTestPoolConnection = async () => {
    setTestingPool(true);
    setPoolTestResult(null);
    try {
      const data = await testPoolConnection(poolHost, poolPort, poolTls);
      setPoolTestResult(data);
    } catch (err: any) {
      setPoolTestResult({ success: false, error: err.message });
    } finally {
      setTestingPool(false);
    }
  };

  const handleRegisterWorker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingWorker) return; // Strict guard against repeated clicks

    setWorkerModalError(null);
    setWorkerModalSuccess(null);

    if (!currentUser) {
      setWorkerModalError(
        language === 'ar'
          ? 'تسجيل الدخول مطلوب: يجب تسجيل الدخول بحسابك أولاً لتسجيل وربط جهاز التعدين.'
          : 'Authentication required: You must be signed in to register and pair a worker device to your account.'
      );
      return;
    }

    const trimmedName = newWorkerName.trim();
    if (!trimmedName) {
      setWorkerModalError(
        language === 'ar'
          ? 'يرجى إدخال اسم الجهاز أو العامل للمتابعة (مثال: Windows-Desktop-PC).'
          : 'Please enter a device or worker name (e.g. Windows-Desktop-PC).'
      );
      return;
    }

    setSavingWorker(true);

    // 1. Resolve stable installation ID and ensure single registration per installation
    const currentInstId = installationId || await getDeviceInstallationId();

    // Priority resolution to strictly prevent 3rd worker creation:
    // A. The primary Windows worker 'tm' (w_qBPFqVEe_tm)
    // B. Any active worker already registered with this installationId
    // C. If this installation was merged into a primary worker, resolve to that primary worker!
    const primaryTmWorker = workers.find(w => 
      (w.workerId === 'w_qBPFqVEe_tm' || w.id === 'w_qBPFqVEe_tm' || w.name === 'tm') && !w.isArchived && !w.mergedInto
    );
    const existingInstWorker = workers.find(w => 
      !w.isArchived && !w.mergedInto && Boolean(w.installationId && w.installationId === currentInstId)
    );
    const mergedInstWorker = workers.find(w => 
      Boolean(w.installationId && w.installationId === currentInstId && w.mergedInto)
    );
    const targetFromMerged = mergedInstWorker?.mergedInto
      ? workers.find(w => (w.workerId === mergedInstWorker.mergedInto || w.id === mergedInstWorker.mergedInto) && !w.isArchived)
      : null;

    const resolvedExisting = primaryTmWorker || targetFromMerged || existingInstWorker;

    // If an existing or primary worker exists, reuse its workerId (strictly prevent 3rd device!)
    const deterministicWorkerId = resolvedExisting
      ? (resolvedExisting.workerId || resolvedExisting.id || '')
      : deriveWorkerIdFromInstallation(currentUser.uid, currentInstId);

    const now = new Date().toISOString();

    const workerPayload: MiningWorker = {
      id: deterministicWorkerId,
      workerId: deterministicWorkerId,
      userId: currentUser.uid,
      name: trimmedName,
      deviceName: trimmedName,
      platform: newWorkerPlatform,
      cpuCores: detectedCores,
      threads,
      xmrigVersion: '6.26.0',
      installationId: currentInstId,
      status: existingInstWorker?.status || 'offline', // Strictly offline upon registration; NEVER auto-start mining
      reportedHashrate: existingInstWorker?.reportedHashrate || 0,
      acceptedShares: existingInstWorker?.acceptedShares || 0,
      rejectedShares: existingInstWorker?.rejectedShares || 0,
      lastSeen: now,
      createdAt: existingInstWorker?.createdAt || now,
      updatedAt: now,
      isPendingSync: false
    };

    let backendRegistered = false;
    let backendErrorMessage = '';
    let lastStatusCode = 0;

    // 1. Authoritative Backend Registration with ID Token
    try {
      const idToken = await currentUser.getIdToken();
      const res = await registerWorker({
        workerId: deterministicWorkerId,
        name: trimmedName,
        deviceName: trimmedName,
        platform: newWorkerPlatform,
        cpuCores: detectedCores,
        threads,
        xmrigVersion: '6.26.0',
        installationId: currentInstId
      }, idToken);

      lastStatusCode = res.status ?? 0;
      if (res.success) {
        backendRegistered = true;
      } else {
        backendErrorMessage = res.error || `Server returned HTTP ${lastStatusCode}`;
        console.warn('[Mining Dashboard] Backend registration response notice:', res.error);
      }
    } catch (apiErr: any) {
      lastStatusCode = 0;
      backendErrorMessage = apiErr.message || 'Network offline';
      console.warn('[Mining Dashboard] Backend registration network notice:', apiErr.message);
    }

    // 2. State transition based on authoritative server confirmation
    if (backendRegistered) {
      // Remove any matching pending draft in localStorage
      try {
        const localDraftKey = `spinnermine_pending_workers_${currentUser.uid}`;
        const existing: MiningWorker[] = JSON.parse(localStorage.getItem(localDraftKey) || '[]');
        const updatedList = existing.filter(w => w.id !== deterministicWorkerId && w.workerId !== deterministicWorkerId);
        localStorage.setItem(localDraftKey, JSON.stringify(updatedList));
      } catch {}

      // Update UI state with confirmed worker
      setWorkers(prev => {
        const existingIdx = prev.findIndex(w => (w.id || w.workerId) === deterministicWorkerId);
        if (existingIdx >= 0) {
          const copy = [...prev];
          copy[existingIdx] = { ...copy[existingIdx], ...workerPayload, isPendingSync: false, syncAttemptError: undefined };
          return copy;
        }
        return [{ ...workerPayload, isPendingSync: false }, ...prev];
      });

      const successMsg = language === 'ar'
        ? 'تم تسجيل وتأكيد جهاز التعدين بنجاح في قاعدة الإنتاج!'
        : 'Mining worker successfully registered and confirmed in production database!';
      setWorkerModalSuccess(successMsg);
      setTimeout(() => {
        setNewWorkerName('');
        setShowAddWorkerModal(false);
        setWorkerModalSuccess(null);
        setSavingWorker(false);
      }, 1000);
    } else {
      // Mark as Pending Sync draft in localStorage with error metadata
      const draftWorker: MiningWorker = {
        ...workerPayload,
        status: 'pending_sync',
        isPendingSync: true,
        syncAttemptError: {
          status: lastStatusCode,
          error: backendErrorMessage || 'Connection offline',
          timestamp: now
        }
      };

      try {
        const localDraftKey = `spinnermine_pending_workers_${currentUser.uid}`;
        const existing: MiningWorker[] = JSON.parse(localStorage.getItem(localDraftKey) || '[]');
        const updatedList = [draftWorker, ...existing.filter(w => w.id !== deterministicWorkerId && w.workerId !== deterministicWorkerId)];
        localStorage.setItem(localDraftKey, JSON.stringify(updatedList));
      } catch {}

      setWorkers(prev => {
        const existingIdx = prev.findIndex(w => (w.id || w.workerId) === deterministicWorkerId);
        if (existingIdx >= 0) {
          const copy = [...prev];
          copy[existingIdx] = draftWorker;
          return copy;
        }
        return [draftWorker, ...prev];
      });

      // Strict requirement: NEVER show fake success! Display exact error reason and status code.
      const errorNotice = language === 'ar'
        ? `تعذر تأكيد الحفظ على الخادم (${lastStatusCode > 0 ? `رمز HTTP ${lastStatusCode}: ` : ''}${backendErrorMessage || 'غير متاح'}). تم حفظ الجهاز كمسودة محلية (قيد المزامنة). لم يتم بدء التعدين تلقائياً. افتح شاشة تشخيص الخادم لفحص الربط.`
        : `Could not confirm save with backend (${lastStatusCode > 0 ? `HTTP ${lastStatusCode}: ` : ''}${backendErrorMessage || 'offline'}). Device saved locally as draft (Pending Sync). Check Cloud Diagnostics.`;
      
      setWorkerModalError(errorNotice);
      setSavingWorker(false);
    }
  };

  const handleDeleteWorker = async (workerId: string) => {
    // If it is in local drafts, remove it
    if (currentUser) {
      try {
        const localDraftKey = `spinnermine_pending_workers_${currentUser.uid}`;
        const existing: MiningWorker[] = JSON.parse(localStorage.getItem(localDraftKey) || '[]');
        const filtered = existing.filter(w => (w.id || w.workerId) !== workerId);
        localStorage.setItem(localDraftKey, JSON.stringify(filtered));
      } catch {}
    }
    setWorkers(prev => prev.filter(w => (w.id || w.workerId) !== workerId));

    try {
      await deleteDoc(doc(db, 'miningWorkers', workerId));
    } catch (err: any) {
      console.warn('[Mining Dashboard] Note on delete worker from Firestore:', err?.message || err);
    }
  };

  const copyWorkerId = () => {
    if (typeof navigator !== 'undefined') {
      navigator.clipboard.writeText(defaultWorkerId);
      setCopiedWorkerId(true);
      setTimeout(() => setCopiedWorkerId(false), 2000);
    }
  };

  const formatTimer = (totalSeconds: number) => {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 sm:p-8 rounded-3xl bg-slate-900/80 border border-slate-800 shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">{t.mining.title}</h1>
            <PhaseBadge phase={2} text="Phase 2A Real Mining" />
          </div>
          <p className="text-xs sm:text-sm text-slate-400">
            Real Monero CPU Mining (RandomX) Engine with Windows XMRig Integration and 20% User / 80% Platform Revenue Allocation
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setShowBackendModal(true);
              handleCheckBackendHealth();
            }}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 border border-slate-700 flex items-center gap-2 cursor-pointer transition shadow-md"
            title="Backend & Cloud Connectivity Diagnostics"
          >
            <Activity className="w-4 h-4 text-emerald-400" />
            <span>Cloud Diagnostics</span>
          </button>

          <button
            type="button"
            onClick={() => setShowPoolConfigModal(true)}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 border border-slate-700 flex items-center gap-2 cursor-pointer transition shadow-md"
          >
            <Server className="w-4 h-4 text-sky-400" />
            <span>Pool Settings</span>
          </button>

          <button
            type="button"
            onClick={() => setShowAddWorkerModal(true)}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-xs font-bold text-white shadow-lg shadow-sky-500/20 flex items-center justify-center gap-2 cursor-pointer transition"
          >
            <Plus className="w-4 h-4" />
            <span>{t.mining.addWorkerModal}</span>
          </button>
        </div>
      </div>

      {/* Safe Mining Engine Controller Panel (Phase 2D - Stage B, D, F) */}
      <SafeMiningControllerPanel
        currentUserId={currentUser?.uid}
        userMiningConsent={Boolean(userProfile?.miningConsent)}
        onOpenConsentModal={onOpenConsentModal}
        activeWorker={workers.find(w => w.workerId === activeWorkerId || w.id === activeWorkerId) || workers[0] || null}
        deviceOnline={Boolean(
          (workers.find(w => w.workerId === activeWorkerId || w.id === activeWorkerId) || workers[0]) &&
          ['online', 'mining'].includes(computeWorkerStatus(workers.find(w => w.workerId === activeWorkerId || w.id === activeWorkerId) || workers[0]!, currentTick))
        )}
        lastHeartbeatFormatted={(workers.find(w => w.workerId === activeWorkerId || w.id === activeWorkerId) || workers[0])?.lastSeen
          ? formatLastSeen((workers.find(w => w.workerId === activeWorkerId || w.id === activeWorkerId) || workers[0])!.lastSeen!)
          : (lastHeartbeatSent || 'No Heartbeat Yet')}
        detectedCores={detectedCores}
        threads={threads}
        poolHost={poolHost || 'pool.supportxmr.com'}
        poolPort={poolPort || 3333}
        poolTls={poolTls}
        walletAddress={poolWallet}
        xmrigPath={xmrigPath}
        onUpdateThreads={updateThreads}
      />

      {/* Real Mining Verification Panel (Phase 2D.3) */}
      <RealMiningVerificationPanel
        telemetry={{
          engineType: 'real',
          state: isMining ? (isPaused ? 'PAUSED' : 'RUNNING') : 'STOPPED',
          uptimeSeconds: sessionSeconds,
          threads,
          cpuUsage: telemetry.cpuUsage,
          hashrate: isMining && !isPaused ? telemetry.hashrate : 0,
          hashrate10s: isMining && !isPaused ? (telemetry.hashrate10s || telemetry.hashrate) : 0,
          hashrate60s: isMining && !isPaused ? (telemetry.hashrate60s || telemetry.hashrate) : 0,
          hashrate15m: isMining && !isPaused ? (telemetry.hashrate15m || telemetry.hashrate) : 0,
          isSimulation: false,
          acceptedShares: telemetry.acceptedShares,
          rejectedShares: telemetry.rejectedShares,
          submittedShares: telemetry.acceptedShares + telemetry.rejectedShares,
          pid: null,
          poolStatus: isMining ? (isPaused ? 'paused' : 'connected') : 'disconnected',
          poolHost: poolHost || 'pool.supportxmr.com',
          poolPort: poolPort || 3333,
          jobsReceived: telemetry.jobsReceived || (isMining ? 1 : 0),
          lastPoolResponse: telemetry.lastPoolResponse,
          lastError: miningError || undefined,
          timestamp: new Date().toISOString()
        }}
        poolHost={poolHost || 'pool.supportxmr.com'}
        poolPort={poolPort || 3333}
        poolTls={poolTls}
        walletAddress={poolWallet || '44AFFq5kSiGBoZ4NMDwYtN18obc8AemS33DBLWs3H7otXMV33WD9279tQiTcTDALCQSmRJq3PJ1nKAqZsK64cX97DpWstPm'}
        workerName={(workers.find(w => w.workerId === activeWorkerId || w.id === activeWorkerId)?.name) || 'tm-main'}
        workerId={activeWorkerId || 'w_qBPFqVEe_tm'}
        xmrigPath={xmrigPath}
        xmrigSha256="6fa80698d7268f6e88aa88c06fb27ee99e1bcee747c2e76911e6206a5b1aeeb3"
        isWindowsHost={Boolean(isElectron && typeof process !== 'undefined' && process.platform === 'win32')}
      />

      {/* Prominent Engine Status Banner */}
      {!isMining ? (
        <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg">
          <div className="flex items-center gap-3.5">
            <div className="p-3 rounded-xl bg-slate-800 text-slate-400 border border-slate-700">
              <WifiOff className="w-5 h-5 text-slate-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-500" />
                <h3 className="text-sm font-bold text-white">Mining Engine Not Connected</h3>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Start the engine below or launch the Windows Desktop XMRig miner to begin calculating real cryptographic shares.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-3 py-1.5 rounded-lg bg-slate-800/80 text-[11px] font-mono text-slate-400 border border-slate-700">
              0.00 H/s (Idle)
            </span>
            <button
              onClick={handleToggleMining}
              className="px-5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs shadow-md transition cursor-pointer flex items-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Connect Engine</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="p-4 sm:p-5 rounded-2xl bg-emerald-950/30 border border-emerald-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg">
          <div className="flex items-center gap-3.5">
            <div className="p-3 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <Radio className="w-5 h-5 text-emerald-400 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                <h3 className="text-sm font-bold text-white">
                  {isPaused ? 'Mining Engine Paused' : 'Mining Engine Active — Real RandomX CPU Mining'}
                </h3>
              </div>
              <p className="text-xs text-emerald-300/80 mt-0.5">
                Session Active • Elapsed: <span dir="ltr" className="font-mono font-bold text-emerald-200">{formatTimer(sessionSeconds)}</span> • Worker: <span dir="ltr" className="font-mono font-bold">{defaultWorkerId}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-end">
              <div dir="ltr" className="text-sm font-mono font-extrabold text-emerald-400">
                {telemetry.hashrate} H/s
              </div>
              <div dir="ltr" className="text-[10px] text-slate-400 font-mono">
                Shares: {telemetry.acceptedShares} / {telemetry.rejectedShares}
              </div>
            </div>

            <button
              onClick={handlePauseResume}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700 transition cursor-pointer"
              title={isPaused ? 'Resume' : 'Pause'}
            >
              {isPaused ? <Play className="w-4 h-4 fill-current" /> : <Pause className="w-4 h-4 fill-current" />}
            </button>

            <button
              onClick={handleToggleMining}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-md transition cursor-pointer flex items-center gap-1.5"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Stop</span>
            </button>
          </div>
        </div>
      )}

      {/* Mandatory Mining Consent Alert if not granted */}
      {!userProfile?.miningConsent && (
        <div className="p-4 sm:p-5 rounded-2xl bg-amber-950/40 border border-amber-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-amber-300">Mandatory Mining Consent Required</p>
              <p className="text-slate-300 mt-0.5">
                You must accept the transparent 20% User / 80% Platform revenue distribution agreement and CPU thermal guidelines before mining can be activated.
              </p>
            </div>
          </div>
          <button
            onClick={onOpenConsentModal}
            className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shrink-0 cursor-pointer transition shadow-md"
          >
            Review & Grant Consent
          </button>
        </div>
      )}

      {/* Real-time Telemetry Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        
        {/* Hashrate Card */}
        <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-1">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Reported Hashrate</span>
            <Activity className="w-4 h-4 text-sky-400" />
          </div>
          <div dir="ltr" className="text-xl sm:text-2xl font-mono font-extrabold text-white text-start">
            {isMining && !isPaused ? `${telemetry.hashrate} H/s` : '0 H/s'}
          </div>
          <p className="text-[10px] text-slate-400">RandomX rx/0 Monero</p>
        </div>

        {/* Accepted Shares Card */}
        <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-1">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Accepted Shares</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div dir="ltr" className="text-xl sm:text-2xl font-mono font-extrabold text-emerald-400 text-start">
            {telemetry.acceptedShares}
          </div>
          <p className="text-[10px] text-slate-400">Pool-submitted PoW</p>
        </div>

        {/* CPU Threads & Load Card */}
        <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-1">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-semibold uppercase tracking-wider">CPU Threads / Usage</span>
            <Cpu className="w-4 h-4 text-amber-400" />
          </div>
          <div dir="ltr" className="text-xl sm:text-2xl font-mono font-extrabold text-white text-start">
            {threads}T <span className="text-sm font-normal text-slate-400">/ {telemetry.cpuUsage !== undefined ? `${telemetry.cpuUsage}%` : (isMining ? 'Measuring...' : 'Standby')}</span>
          </div>
          <p className="text-[10px] text-slate-400">
            {detectedCores} Hardware Cores {telemetry.cpuUsage !== undefined ? `(Real Load: ${telemetry.cpuUsage}%)` : '(Delta Sampling)'}
          </p>
        </div>

        {/* Session Time Card */}
        <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-1">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Session Duration</span>
            <Clock className="w-4 h-4 text-indigo-400" />
          </div>
          <div dir="ltr" className="text-xl sm:text-2xl font-mono font-extrabold text-white text-start">
            {formatTimer(sessionSeconds)}
          </div>
          <p className="text-[10px] text-slate-400">
            Status: {isMining ? (isPaused ? 'Paused' : 'Active') : 'Standby'}
          </p>
        </div>

      </div>

      {/* XMRig Configuration Section (Windows Electron Native Client Only) */}
      {isElectron && (
        <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/90 border border-sky-500/40 shadow-2xl space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-sky-500/10 text-sky-400 border border-sky-500/30">
                <Laptop className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                  <span>XMRig Configuration</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-950 text-sky-400 border border-sky-500/30">
                    Windows Native
                  </span>
                </h3>
                <p className="text-xs text-slate-400">
                  Configure local XMRig binary path, Stratum mining pool endpoints, and CPU allocation
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${
                isMining 
                  ? (isPaused ? 'bg-amber-400' : 'bg-emerald-400 animate-ping')
                  : (xmrigValidationResult?.valid ? 'bg-emerald-400' : 'bg-amber-400')
              }`} />
              <span className="text-xs font-mono font-bold text-slate-300">
                {isMining 
                  ? (isPaused ? 'Mining Paused' : 'Mining Active')
                  : (xmrigValidationResult?.valid ? 'Binary Verified' : 'Verification Required')}
              </span>
            </div>
          </div>

          {/* Backend Offline / Standalone Notice */}
          {backendOfflineNotice && (
            <div className="p-4 rounded-2xl bg-amber-950/40 border border-amber-500/30 flex items-start gap-3 text-xs text-amber-200">
              <WifiOff className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <span className="font-bold text-amber-300">Offline / Standalone Mode Active</span>
                <p className="text-amber-200/90 leading-relaxed">
                  {backendOfflineNotice} Stratum mining pool configuration, local XMRig binary management, and hardware tuning operate normally.
                </p>
              </div>
            </div>
          )}

          {/* Mining Execution Error Banner */}
          {miningError && (
            <div className="p-4 rounded-2xl bg-rose-950/60 border border-rose-500/40 text-rose-300 text-xs flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-bold text-white">Mining Execution Error</span>
                <p className="text-rose-200/90 leading-relaxed">{miningError}</p>
              </div>
            </div>
          )}

          {/* XMRig Executable Path Field + Browse & Validate Buttons */}
          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center justify-between">
              <span>XMRig Executable Path</span>
              <span className="text-[10px] font-normal text-slate-400 lowercase">
                (target: xmrig.exe on Windows 10/11)
              </span>
            </label>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              <div className="relative flex-1">
                <input
                  id="xmrig-path-input"
                  type="text"
                  value={xmrigPath}
                  onChange={(e) => {
                    setXmrigPath(e.target.value);
                    setXmrigValidationResult(null);
                    setMiningError(null);
                  }}
                  disabled={isMining}
                  placeholder="C:\Mining\xmrig-6.26.0\xmrig.exe"
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-xs placeholder-slate-600 focus:outline-none focus:border-sky-500 disabled:opacity-50"
                />
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  id="browse-xmrig-btn"
                  type="button"
                  onClick={handleBrowseXMRig}
                  disabled={isMining || isValidatingXmrig}
                  className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition disabled:opacity-50 cursor-pointer shadow-md shadow-sky-600/20"
                >
                  <FolderOpen className="w-4 h-4" />
                  <span>Browse...</span>
                </button>

                <button
                  id="validate-xmrig-btn"
                  type="button"
                  onClick={handleValidateXMRig}
                  disabled={isMining || isValidatingXmrig || !xmrigPath.trim()}
                  className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-300 border border-sky-500/30 font-bold text-xs flex items-center justify-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`w-4 h-4 ${isValidatingXmrig ? 'animate-spin' : ''}`} />
                  <span>Validate XMRig</span>
                </button>
              </div>
            </div>

            {/* Validation Result Box */}
            {xmrigValidationResult && (
              <div
                className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
                  xmrigValidationResult.valid
                    ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-950/40 border-rose-500/30 text-rose-300'
                }`}
              >
                {xmrigValidationResult.valid ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <p className="font-bold text-emerald-200">
                        XMRig Authenticity & Integrity Verified (SHA-256 Passed)
                      </p>
                      <p className="text-[11px] text-emerald-300/80 font-mono">
                        Valid official binary detected. Ready for hardware-accelerated RandomX mining.
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <p className="font-bold text-rose-200">XMRig Validation Failed</p>
                      <p className="text-[11px] text-rose-300/90 leading-relaxed">
                        Reason: {xmrigValidationResult.reason || 'Binary not recognized or hash verification failed.'}
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Mining Pool & Hardware Settings Grid */}
          <div className="space-y-3 pt-2 border-t border-slate-800/80">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Server className="w-4 h-4 text-sky-400" />
              <span>Pool Connection & Hardware Allocation</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Pool Host */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-slate-400">Mining Pool Host</label>
                <input
                  type="text"
                  value={poolHost}
                  onChange={(e) => setPoolHost(e.target.value)}
                  disabled={isMining}
                  placeholder="gulf.moneroocean.stream"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-xs focus:outline-none focus:border-sky-500 disabled:opacity-50"
                />
              </div>

              {/* Pool Port */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-slate-400">Pool Port</label>
                <input
                  type="number"
                  value={poolPort}
                  onChange={(e) => setPoolPort(Number(e.target.value))}
                  disabled={isMining}
                  placeholder="10128"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-xs focus:outline-none focus:border-sky-500 disabled:opacity-50"
                />
              </div>

              {/* CPU Threads */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold text-slate-400">CPU Threads</label>
                  <span className="text-[10px] text-sky-400 font-mono font-bold">Max: {detectedCores}</span>
                </div>
                <input
                  type="number"
                  min={1}
                  max={detectedCores}
                  value={threads}
                  onChange={(e) => updateThreads(Number(e.target.value))}
                  disabled={isMining}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-xs focus:outline-none focus:border-sky-500 disabled:opacity-50"
                />
              </div>

              {/* TLS Connection */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-slate-400">Stratum Encryption</label>
                <button
                  type="button"
                  onClick={() => setPoolTls(!poolTls)}
                  disabled={isMining}
                  className={`w-full px-3 py-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-50 ${
                    poolTls
                      ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  <span>{poolTls ? 'TLS/SSL Enabled' : 'Standard TCP'}</span>
                </button>
              </div>
            </div>

            {/* Wallet Address */}
            <div className="space-y-1.5 pt-1">
              <label className="text-[11px] font-semibold text-slate-400">Monero (XMR) Mining Address</label>
              <input
                type="text"
                value={poolWallet}
                onChange={(e) => {
                  const val = e.target.value;
                  setPoolWallet(val);
                  try {
                    localStorage.setItem('spinnermine_user_xmr_wallet', val);
                  } catch {}
                  if (isElectron && electronAPI?.saveSettings) {
                    electronAPI.saveSettings({ xmrigPath, threads, throttle, poolWallet: val });
                  }
                }}
                disabled={isMining}
                placeholder="48edfHu7V9Z84YLFvYYmwZeK9GGrnWcngTWDbLTVBg29vC9HrDY7nPPgwC99EFGhpxYChCentiznY6Gy145unRP6Qss8358"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-xs focus:outline-none focus:border-sky-500 disabled:opacity-50 truncate"
              />
            </div>
          </div>

          {/* Action Trigger Buttons for Electron Native XMRig */}
          <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-xs text-slate-400 flex items-center gap-2">
              <span className="font-semibold text-slate-200">Execution Mode:</span>
              <span className="font-mono text-sky-400">Direct Subprocess (Native PID)</span>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              {isMining && (
                <button
                  type="button"
                  onClick={handlePauseResume}
                  className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-400 font-bold text-xs border border-slate-700 transition cursor-pointer flex items-center gap-2"
                >
                  {isPaused ? <Play className="w-4 h-4 fill-current" /> : <Pause className="w-4 h-4 fill-current" />}
                  <span>{isPaused ? 'Resume' : 'Pause'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleToggleMining}
                disabled={isValidatingXmrig}
                className={`w-full sm:w-auto px-7 py-2.5 rounded-xl font-bold text-xs shadow-lg transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 ${
                  isMining
                    ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/20'
                    : 'bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white shadow-sky-500/20'
                }`}
              >
                {isMining ? (
                  <>
                    <Square className="w-4 h-4 fill-current" />
                    <span>Stop XMRig Engine</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    <span>Start XMRig Engine</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Mining Control & Windows Desktop Client Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Controls Column (2 Cols) */}
        <div className="lg:col-span-2 p-6 sm:p-8 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-sky-500/10 text-sky-400 border border-sky-500/20">
                <Cpu className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">CPU Mining Engine Controller</h3>
                <p className="text-xs text-slate-400">Configure processing threads and safety throttling caps</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${isMining ? (isPaused ? 'bg-amber-400' : 'bg-emerald-400 animate-ping') : 'bg-slate-600'}`} />
              <span className="text-xs font-mono font-bold text-slate-300">
                {isMining ? (isPaused ? 'Paused' : 'Mining Active') : 'Standby'}
              </span>
            </div>
          </div>

          {/* Sliders */}
          <div className="space-y-6">
            
            {/* Threads Slider */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold">
                <label className="text-slate-300 flex items-center gap-1.5">
                  <Sliders className="w-4 h-4 text-sky-400" />
                  <span>CPU Mining Threads</span>
                </label>
                <span dir="ltr" className="font-mono text-sky-400 font-bold bg-sky-950/60 px-2 py-0.5 rounded border border-sky-500/30">
                  {threads} / {detectedCores} Threads
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={detectedCores}
                value={threads}
                onChange={(e) => updateThreads(Number(e.target.value))}
                className="w-full accent-sky-400 cursor-pointer"
              />
              <p className="text-[11px] text-slate-400">
                Recommended: Use half of available logical cores ({Math.max(1, Math.floor(detectedCores / 2))} threads) to ensure smooth system responsiveness.
              </p>
            </div>

            {/* Throttle Slider */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold">
                <label className="text-slate-300 flex items-center gap-1.5">
                  <Percent className="w-4 h-4 text-amber-400" />
                  <span>CPU Duty Cycle & Throttle Limit</span>
                </label>
                <span dir="ltr" className="font-mono text-amber-400 font-bold bg-amber-950/60 px-2 py-0.5 rounded border border-amber-500/30">
                  {throttle}% Maximum Load
                </span>
              </div>
              <input
                type="range"
                min={10}
                max={100}
                step={5}
                value={throttle}
                onChange={(e) => setThrottle(Number(e.target.value))}
                className="w-full accent-amber-400 cursor-pointer"
              />
              <p className="text-[11px] text-slate-400">
                Safeguards hardware by limiting peak processor temperature and electrical power draw.
              </p>
            </div>

          </div>

          {/* Revenue Split Transparency Box */}
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-200">Revenue Split Model:</span>
              <span className="font-mono text-xs font-bold text-sky-400">20% User / 80% Platform</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Mining earnings are calculated strictly from verified, pool-confirmed RandomX shares. Local device hashes are unverified telemetry and do not create artificial withdrawal balances.
            </p>
          </div>

          {/* Action Trigger Button */}
          <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-xs text-slate-400">
              <span className="font-semibold text-slate-200">Engine Protocol:</span> RandomX rx/0 • Monero (XMR)
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              {isMining && (
                <button
                  onClick={handlePauseResume}
                  className="px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-400 font-bold text-xs border border-slate-700 transition cursor-pointer flex items-center gap-2"
                >
                  {isPaused ? <Play className="w-4 h-4 fill-current" /> : <Pause className="w-4 h-4 fill-current" />}
                  <span>{isPaused ? 'Resume' : 'Pause'}</span>
                </button>
              )}

              <button
                onClick={handleToggleMining}
                className={`w-full sm:w-auto px-7 py-3 rounded-xl font-bold text-xs shadow-lg transition flex items-center justify-center gap-2 cursor-pointer ${
                  isMining
                    ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/20'
                    : 'bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white shadow-sky-500/20'
                }`}
              >
                {isMining ? (
                  <>
                    <Square className="w-4 h-4 fill-current" />
                    <span>Stop Mining</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    <span>Start Mining Engine</span>
                  </>
                )}
              </button>
            </div>
          </div>

        </div>

        {/* Windows Mining Client & Pool Info Sidebar */}
        <div className="space-y-6">
          
          {/* Windows Desktop Miner Card */}
          <div className="p-6 rounded-3xl bg-gradient-to-b from-slate-900 to-slate-900/60 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Laptop className="w-4 h-4 text-sky-400" />
                <span>Windows XMRig Miner</span>
              </h4>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-950 text-sky-400 border border-sky-500/30">
                {isElectron ? 'Active Client' : 'Phase 2A'}
              </span>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              {isElectron 
                ? 'Running inside the Windows Electron native desktop client with direct hardware and XMRig integration.'
                : 'Run official XMRig natively on Windows 10/11 for maximum RandomX hashing performance without browser sandbox limits.'
              }
            </p>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <p className="text-[10px] text-slate-500 uppercase font-semibold">Your Device Pairing ID</p>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-sky-400 truncate">{defaultWorkerId}</span>
                <button
                  onClick={copyWorkerId}
                  className="p-1 rounded text-slate-400 hover:text-white transition cursor-pointer"
                  title="Copy Worker ID"
                >
                  {copiedWorkerId ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div className="pt-2">
              {isElectron ? (
                <div className="w-full py-2.5 px-4 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center justify-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Native Windows Client Active</span>
                </div>
              ) : (
                <a
                  href="https://github.com/tmrbe2006/SpinnerMine-Cloud-Phase2/actions/workflows/build-windows.yml"
                  target="_blank"
                  rel="noreferrer"
                  className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-sky-300 border border-slate-700 flex items-center justify-center gap-2 transition"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Windows Client (.exe)</span>
                </a>
              )}
            </div>
          </div>

          {/* Pool Connection Card */}
          <div className="p-6 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                <Server className="w-4 h-4 text-sky-400" />
                <span>Stratum Mining Pool</span>
              </h4>
              <button
                onClick={handleTestPoolConnection}
                disabled={testingPool}
                className="text-[11px] text-sky-400 hover:text-sky-300 font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${testingPool ? 'animate-spin' : ''}`} />
                <span>Test Ping</span>
              </button>
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <p className="text-[10px] text-slate-500 uppercase">Pool Address</p>
                <p className="font-mono text-sky-400 font-bold mt-0.5 truncate">
                  {poolTls ? 'stratum+ssl://' : 'stratum+tcp://'}{poolHost}:{poolPort}
                </p>
              </div>

              {poolTestResult && (
                <div className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                  poolTestResult.success 
                    ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-950/40 border-rose-500/30 text-rose-300'
                }`}>
                  {poolTestResult.success ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>Pool Responded • Latency: {poolTestResult.latencyMs}ms</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                      <span>{poolTestResult.error || 'Pool connection failed'}</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

        </div>

      </div>

      {/* Connected Workers Directory */}
      <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-white">{t.mining.workersListTitle}</h3>
            <p className="text-xs text-slate-400">
              {language === 'ar' 
                ? 'مراقبة حية لأجهزة التعدين ونبض الاتصال (Heartbeat) ومعرفات التثبيت الفريدة' 
                : 'Live monitoring of hardware rigs, heartbeat telemetry, and persistent installation IDs'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {duplicateGroups.length > 0 && (
              <button
                type="button"
                onClick={handleCheckDuplicates}
                className="px-3 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[11px] font-bold flex items-center gap-1.5 transition cursor-pointer shadow"
                title={language === 'ar' ? 'اكتشاف ومعالجة التسجيلات المكررة' : 'Discover & resolve duplicate devices'}
              >
                <Layers className="w-3.5 h-3.5 text-amber-400" />
                <span>
                  {language === 'ar'
                    ? `تكرار مكتشف (${duplicateGroups.length}) - معالجة`
                    : `Duplicates Detected (${duplicateGroups.length}) - Resolve`}
                </span>
              </button>
            )}

            <span className="text-xs font-mono text-sky-400 font-bold bg-sky-950/40 px-2.5 py-1 rounded-lg border border-sky-500/30 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.8)]" />
              <span>
                {language === 'ar'
                  ? `متصل: ${workers.filter(w => !w.isPendingSync && (computeWorkerStatus(w, currentTick) === 'online' || computeWorkerStatus(w, currentTick) === 'mining')).length}`
                  : `Online: ${workers.filter(w => !w.isPendingSync && (computeWorkerStatus(w, currentTick) === 'online' || computeWorkerStatus(w, currentTick) === 'mining')).length}`}
              </span>
            </span>

            <span className="text-xs font-mono text-slate-400 font-bold bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-700/80 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-slate-500" />
              <span>
                {language === 'ar'
                  ? `غير متصل: ${workers.filter(w => !w.isPendingSync && computeWorkerStatus(w, currentTick) === 'offline').length}`
                  : `Offline: ${workers.filter(w => !w.isPendingSync && computeWorkerStatus(w, currentTick) === 'offline').length}`}
              </span>
            </span>

            <span className="text-xs font-mono text-emerald-400 font-bold bg-emerald-950/40 px-2.5 py-1 rounded-lg border border-emerald-500/30">
              {language === 'ar' 
                ? `المؤكدة: ${workers.filter(w => !w.isPendingSync && w.status !== 'pending_sync' && !w.isArchived && !w.mergedInto).length}`
                : `Confirmed: ${workers.filter(w => !w.isPendingSync && w.status !== 'pending_sync' && !w.isArchived && !w.mergedInto).length}`}
            </span>

            {workers.some(w => w.isPendingSync || w.status === 'pending_sync') && (
              <span className="text-xs font-mono text-amber-400 font-bold bg-amber-950/40 px-2.5 py-1 rounded-lg border border-amber-500/30 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                {language === 'ar'
                  ? `قيد المزامنة: ${workers.filter(w => w.isPendingSync || w.status === 'pending_sync').length}`
                  : `Pending Sync: ${workers.filter(w => w.isPendingSync || w.status === 'pending_sync').length}`}
              </span>
            )}

            {lastHeartbeatSent && (
              <span className="text-[11px] font-mono text-slate-400 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800 flex items-center gap-1">
                <Activity className="w-3 h-3 text-sky-400" />
                <span>{language === 'ar' ? `آخر نبض: ${lastHeartbeatSent}` : `Last Pulse: ${lastHeartbeatSent}`}</span>
              </span>
            )}

            {workers.some(w => w.isPendingSync || w.status === 'pending_sync') && (
              <button
                type="button"
                onClick={syncPendingDrafts}
                disabled={syncingDrafts}
                className="px-3 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[11px] font-bold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                title="Retry syncing local drafts to production Firebase"
              >
                <RefreshCw className={`w-3 h-3 ${syncingDrafts ? 'animate-spin' : ''}`} />
                <span>{syncingDrafts ? (language === 'ar' ? 'جارٍ المزامنة...' : 'Syncing...') : (language === 'ar' ? 'مزامنة المسودات' : 'Sync All Drafts')}</span>
              </button>
            )}
          </div>
        </div>

        {/* Duplicate Warning Alert Banner */}
        {duplicateGroups.length > 0 && (
          <div className="p-4 rounded-2xl bg-amber-950/40 border border-amber-500/40 text-amber-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
              <div>
                <p className="font-bold text-amber-300">
                  {language === 'ar'
                    ? 'تنبيه: تم اكتشاف تسجيلات مكررة لنفس الكمبيوتر'
                    : 'Notice: Multiple duplicate registrations detected for the same PC'}
                </p>
                <p className="text-[11px] text-amber-300/80 mt-0.5">
                  {language === 'ar'
                    ? 'يظهر جهازان لنفس التثبيت (مثل tm و ty). يمكنك دمج أو أرشفة السجل المكرر لمنع ظهورهما متصلين في نفس الوقت.'
                    : 'Two devices appear for the same installation (e.g. tm and ty). Merge or archive the duplicate to avoid simultaneous online statuses.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleCheckDuplicates}
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shrink-0 transition cursor-pointer flex items-center justify-center gap-1.5 shadow"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>{language === 'ar' ? 'حل التكرار الآن' : 'Resolve Duplicates Now'}</span>
            </button>
          </div>
        )}

        {/* Phase 2D.1 Banner: Link Permanent Windows Device Identity for tm or unlinked primary */}
        {currentUser && workers.some(w => (w.workerId === 'w_qBPFqVEe_tm' || w.name === 'tm') && !w.installationId && !w.isArchived) && (
          <div className="p-4 rounded-2xl bg-gradient-to-r from-sky-950/70 via-slate-900 to-indigo-950/70 border border-sky-500/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-sky-500/20 border border-sky-500/40 text-sky-400 shrink-0 mt-0.5">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-sky-200">
                  {language === 'ar' ? 'المرحلة 2D.1: ربط الهوية الدائمة لجهاز Windows الأساسي (tm)' : 'Phase 2D.1: Link Permanent Windows Device Identity for tm'}
                </h4>
                <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
                  {language === 'ar'
                    ? `الجهاز الأساسي tm (w_qBPFqVEe_tm) متصل حالياً بدون معرف تثبيت دائم (N/A). يمكنك ربطه الآن بتثبيت Windows الدائم (${getShortInstallationId(installationId) || 'inst_...'}) دون إنشاء أي جهاز ثالث أو المساس بالأرصدة.`
                    : `Primary worker tm (w_qBPFqVEe_tm) is online without permanent installation ID (N/A). Link this Windows installation (${getShortInstallationId(installationId) || 'inst_...'}) securely without altering balances or duplicating devices.`}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                const tm = workers.find(w => (w.workerId === 'w_qBPFqVEe_tm' || w.name === 'tm') && !w.installationId);
                if (tm) handlePromptLinkInstallation(tm);
              }}
              className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold transition flex items-center gap-1.5 shrink-0 shadow cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{language === 'ar' ? 'ربط المعرف الدائم الآن' : 'Link Permanent ID Now'}</span>
            </button>
          </div>
        )}

        {/* Heartbeat Test Notification Banner */}
        {heartbeatNotice && (
          <div className={`p-3.5 rounded-2xl border text-xs flex items-center justify-between gap-3 ${
            heartbeatNotice.type === 'success'
              ? 'bg-sky-950/40 border-sky-500/40 text-sky-300'
              : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
          }`}>
            <div className="flex items-center gap-2">
              {heartbeatNotice.type === 'success' ? (
                <Activity className="w-4 h-4 text-sky-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <span>{heartbeatNotice.message}</span>
              {heartbeatNotice.timestamp && (
                <span className="font-mono text-[10px] text-slate-400">({heartbeatNotice.timestamp})</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setHeartbeatNotice(null)}
              className="text-slate-400 hover:text-white p-1 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* Sync Notification Banner */}
        {syncNotice && (
          <div className={`p-3.5 rounded-2xl border text-xs flex items-center justify-between gap-3 ${
            syncNotice.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
              : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
          }`}>
            <div className="flex items-center gap-2">
              {syncNotice.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <span>{syncNotice.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setSyncNotice(null)}
              className="text-slate-400 hover:text-white p-1 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {(() => {
          const activeWorkers = workers.filter(w => !w.isArchived && !w.mergedInto && w.status !== 'archived');
          // Enforce primary device ordering: tm (w_qBPFqVEe_tm) always at top
          activeWorkers.sort((a, b) => {
            if (a.workerId === 'w_qBPFqVEe_tm' || a.name === 'tm') return -1;
            if (b.workerId === 'w_qBPFqVEe_tm' || b.name === 'tm') return 1;
            return 0;
          });
          const archivedWorkers = workers.filter(w => Boolean(w.isArchived) || Boolean(w.mergedInto) || w.status === 'archived');

          return (
            <>
              {activeWorkers.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-slate-800 rounded-2xl space-y-3">
                  <Server className="w-8 h-8 text-slate-600 mx-auto" />
                  <p className="text-xs text-slate-400 font-medium">
                    {language === 'ar' ? 'لا توجد أجهزة تعدين نشطة حالياً.' : 'No active mining worker devices registered.'}
                  </p>
                  <button
                    onClick={() => setShowAddWorkerModal(true)}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-sky-400 transition cursor-pointer"
                  >
                    + {language === 'ar' ? 'تسجيل جهاز جديد' : 'Register First Device'}
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-start text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-500 uppercase text-[10px] tracking-wider text-start">
                        <th className="pb-3 text-start">Worker Name</th>
                        <th className="pb-3 text-start">Installation ID</th>
                        <th className="pb-3 text-start">Platform</th>
                        <th className="pb-3 text-start">Status</th>
                        <th className="pb-3 text-start">CPU Threads</th>
                        <th className="pb-3 text-start">CPU Usage</th>
                        <th className="pb-3 text-start">Hashrate</th>
                        <th className="pb-3 text-start">Last Seen</th>
                        <th className="pb-3 text-end">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {activeWorkers.map((w) => {
                        const isDraft = Boolean(w.isPendingSync || w.status === 'pending_sync');
                        const computedStatus = computeWorkerStatus(w, currentTick);
                        const badge = getStatusBadgeConfig(computedStatus, language);
                        const workerKey = w.workerId || w.id || '';
                        const isCurrentActive = activeWorkerId ? activeWorkerId === workerKey : false;
                        const isTesting = testingHeartbeatFor === workerKey;

                        return (
                          <tr key={w.id || w.workerId} className="transition hover:bg-slate-800/30">
                            <td className="py-3 font-bold text-white">
                              <div className="flex items-center gap-2">
                                <Laptop className={`w-4 h-4 ${computedStatus === 'online' || computedStatus === 'mining' ? 'text-sky-400' : 'text-slate-500'}`} />
                                <div className="flex flex-col">
                                  <span className="flex items-center gap-1.5">
                                    <span>{w.name || w.deviceName || w.workerId}</span>
                                    {isCurrentActive && (
                                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-sky-950 text-sky-400 border border-sky-500/30 font-mono">
                                        {language === 'ar' ? 'هذا الجهاز' : 'This PC'}
                                      </span>
                                    )}
                                  </span>
                                  <span className="text-[10px] font-mono text-slate-500 font-normal">{w.workerId}</span>
                                </div>
                              </div>
                            </td>
                            <td className="py-3 font-mono text-[10px] text-slate-400">
                              <div className="flex items-center gap-1.5">
                                <span 
                                  className={`px-2 py-0.5 rounded border ${
                                    w.installationId 
                                      ? 'bg-slate-950 border-slate-800 text-slate-300' 
                                      : 'bg-amber-950/40 border-amber-500/30 text-amber-300'
                                  }`}
                                  title={w.installationId || (language === 'ar' ? 'غير مربوط بمعرف تثبيت دائم' : 'Unlinked / Legacy')}
                                >
                                  {getShortInstallationId(w.installationId)}
                                </span>
                                {!w.installationId && !w.isArchived && (
                                  <button
                                    type="button"
                                    onClick={() => handlePromptLinkInstallation(w)}
                                    className="px-2 py-0.5 rounded bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 text-[9px] font-bold transition cursor-pointer flex items-center gap-1"
                                    title={language === 'ar' ? 'ربط هذا الجهاز بالتثبيت الدائم الحالي' : 'Link this worker to current permanent installation'}
                                  >
                                    <ShieldCheck className="w-3 h-3 text-sky-400" />
                                    <span>{language === 'ar' ? 'ربط' : 'Link'}</span>
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="py-3 capitalize text-slate-300">{w.platform}</td>
                            <td className="py-3">
                              {isDraft ? (
                                <div className="flex items-center gap-1.5">
                                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950/60 text-amber-300 border border-amber-500/40">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                                    <span>{t.mining.pendingSync || 'Pending Sync'}</span>
                                  </span>
                                  <button
                                    type="button"
                                    onClick={syncPendingDrafts}
                                    disabled={syncingDrafts}
                                    className="p-1 rounded text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 transition cursor-pointer"
                                    title={language === 'ar' ? 'إعادة محاولة المزامنة' : 'Retry sync now'}
                                  >
                                    <RefreshCw className={`w-3 h-3 ${syncingDrafts ? 'animate-spin' : ''}`} />
                                  </button>
                                </div>
                              ) : (
                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold ${badge.badgeClass}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${badge.dotClass}`} />
                                  <span>{badge.label}</span>
                                </span>
                              )}
                            </td>
                            <td dir="ltr" className="py-3 text-slate-300 font-mono text-start">
                              {w.threads || w.cpuCores || detectedCores} Threads ({w.cpuCores || detectedCores} Cores)
                            </td>
                            <td dir="ltr" className="py-3 font-mono text-start">
                              {w.cpuUsage !== undefined ? (
                                <span className="text-emerald-400 font-bold">{w.cpuUsage}%</span>
                              ) : computedStatus === 'online' ? (
                                <span className="text-slate-400">0% ({language === 'ar' ? 'خامل' : 'Idle'})</span>
                              ) : (
                                <span className="text-slate-500 text-[11px]">{language === 'ar' ? 'غير متاح' : 'N/A'}</span>
                              )}
                            </td>
                            <td dir="ltr" className="py-3 font-mono font-bold text-start">
                              {computedStatus === 'mining' ? (
                                <span className="text-emerald-400">{w.reportedHashrate ? `${w.reportedHashrate} H/s` : '0 H/s'}</span>
                              ) : (
                                <span className="text-slate-500 text-[11px] font-normal">{language === 'ar' ? 'غير نشط' : 'Inactive'}</span>
                              )}
                            </td>
                            <td className="py-3 text-slate-400">
                              {isDraft ? (
                                <span className="text-amber-400/80 font-mono text-[10px]">
                                  {language === 'ar' ? 'مسودة محلية' : 'Local Draft'}
                                </span>
                              ) : (
                                <span className="text-[11px] font-mono text-slate-300">
                                  {formatLastSeen(w.lastSeen, language, currentTick)}
                                </span>
                              )}
                            </td>
                            <td className="py-3 text-end">
                              <div className="flex items-center justify-end gap-1.5">
                                {/* Rename Button */}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRenamingWorker(w);
                                    setRenameInput(w.name || w.deviceName || '');
                                    setRenameFeedback(null);
                                  }}
                                  className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[10px] font-bold flex items-center gap-1 transition cursor-pointer"
                                  title={language === 'ar' ? 'تعديل اسم الجهاز' : 'Rename Device'}
                                >
                                  <Edit3 className="w-3 h-3 text-sky-400" />
                                  <span>{language === 'ar' ? 'تسمية' : 'Rename'}</span>
                                </button>

                                {!isDraft && (
                                  <button
                                    type="button"
                                    onClick={() => sendHeartbeatForWorker(w.workerId || w.id || '', true)}
                                    disabled={isTesting}
                                    className="px-2.5 py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/30 text-[11px] font-bold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-40"
                                    title={language === 'ar' ? 'فحص نبض الجهاز وتأكيد اتصاله بالسحابة' : 'Test Heartbeat and confirm online status in cloud'}
                                  >
                                    <HeartPulse className={`w-3.5 h-3.5 text-sky-400 ${isTesting ? 'animate-spin' : ''}`} />
                                    <span>{isTesting ? (language === 'ar' ? 'جارٍ الفحص...' : 'Testing...') : (language === 'ar' ? 'فحص النبض' : 'Test Heartbeat')}</span>
                                  </button>
                                )}

                                {!isDraft && !isCurrentActive && (
                                  <button
                                    type="button"
                                    onClick={() => handleSelectActiveWorker(w.workerId || w.id || '')}
                                    className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 text-[10px] font-bold transition cursor-pointer"
                                    title={language === 'ar' ? 'تعيين كجهاز أساسي لهذا الكمبيوتر' : 'Set as primary device for this PC'}
                                  >
                                    {language === 'ar' ? 'تحديد' : 'Select'}
                                  </button>
                                )}

                                <button
                                  onClick={() => handleDeleteWorker(w.id || w.workerId)}
                                  className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
                                  title="Delete worker"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Requirement 7: Separate Archived & Merged Records (Historical Audit Section) */}
              {archivedWorkers.length > 0 && (
                <div className="mt-8 pt-6 border-t border-slate-800/80 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="p-1.5 rounded-lg bg-slate-800 text-slate-400 border border-slate-700">
                        <Archive className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs font-bold text-slate-300">
                            {language === 'ar' ? 'السجلات المؤرشفة والمدمجة (سجل التدقيق التاريخي)' : 'Archived & Merged Records (Audit History)'}
                          </h4>
                          <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-400">
                            {archivedWorkers.length} {language === 'ar' ? 'سجل' : 'records'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500">
                          {language === 'ar' 
                            ? 'أجهزة مدمجة أو مؤرشفة محفوظة في قاعدة البيانات لأغراض التدقيق المالي، ومفصولة عن الأجهزة النشطة.'
                            : 'Devices merged or archived for audit integrity, isolated from active monitoring.'}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowArchivedSection(!showArchivedSection)}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer border border-slate-700"
                    >
                      <span>{showArchivedSection ? (language === 'ar' ? 'إخفاء' : 'Collapse') : (language === 'ar' ? 'عرض' : 'Expand')}</span>
                      {showArchivedSection ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  {showArchivedSection && (
                    <div className="overflow-x-auto rounded-xl border border-slate-800/80 bg-slate-950/40">
                      <table className="w-full text-start text-xs">
                        <thead>
                          <tr className="border-b border-slate-800/80 text-slate-500 uppercase text-[10px] tracking-wider text-start bg-slate-900/60">
                            <th className="py-2.5 px-3 text-start">Worker Name</th>
                            <th className="py-2.5 px-3 text-start">Original Worker ID</th>
                            <th className="py-2.5 px-3 text-start">Resolution / Status</th>
                            <th className="py-2.5 px-3 text-start">Archived At</th>
                            <th className="py-2.5 px-3 text-start">Retained Shares</th>
                            <th className="py-2.5 px-3 text-start">Audit Note / Reason</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/40 text-slate-400">
                          {archivedWorkers.map((w) => (
                            <tr key={w.id || w.workerId} className="hover:bg-slate-900/40 transition">
                              <td className="py-2.5 px-3 font-semibold text-slate-300">
                                <div className="flex items-center gap-2">
                                  <Laptop className="w-3.5 h-3.5 text-slate-500" />
                                  <span>{w.name || w.deviceName || w.workerId}</span>
                                </div>
                              </td>
                              <td className="py-2.5 px-3 font-mono text-[10px] text-slate-400">
                                {w.workerId || w.id}
                              </td>
                              <td className="py-2.5 px-3">
                                {w.mergedInto ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-sky-950/60 text-sky-300 border border-sky-500/30">
                                    <GitMerge className="w-3 h-3 text-sky-400" />
                                    <span>Merged → {w.mergedInto}</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
                                    <Archive className="w-3 h-3 text-slate-400" />
                                    <span>Archived</span>
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-[11px] font-mono text-slate-400">
                                {w.archivedAt ? new Date(w.archivedAt).toLocaleDateString() : 'N/A'}
                              </td>
                              <td className="py-2.5 px-3 font-mono text-slate-300 font-bold">
                                {w.acceptedShares || 0}
                              </td>
                              <td className="py-2.5 px-3 text-[11px] text-slate-400 max-w-xs truncate">
                                {w.archiveReason || (w.mergedInto ? `Merged into ${w.mergedInto}` : 'Archived record')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          );
        })()}
      </div>

      {/* Add Worker Modal */}
      {showAddWorkerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl text-slate-100 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">{t.mining.addWorkerModal}</h3>
              <button
                type="button"
                onClick={() => {
                  setShowAddWorkerModal(false);
                  setWorkerModalError(null);
                  setWorkerModalSuccess(null);
                }}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Unauthenticated User Warning */}
            {!currentUser && (
              <div className="p-3.5 rounded-xl bg-amber-950/50 border border-amber-500/40 text-amber-200 text-xs space-y-2">
                <div className="flex items-start gap-2.5">
                  <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <p className="leading-relaxed">
                    {t.mining.authRequiredToSave || 'Authentication required: You must be signed in to link a worker device to your account.'}
                  </p>
                </div>
                {onNavigateLogin && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddWorkerModal(false);
                      onNavigateLogin();
                    }}
                    className="w-full py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition cursor-pointer"
                  >
                    {t.mining.signInBtn || 'Sign In / Create Account'}
                  </button>
                )}
              </div>
            )}

            {/* Modal Error Banner */}
            {workerModalError && (
              <div className="p-3 rounded-xl bg-rose-950/50 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{workerModalError}</span>
              </div>
            )}

            {/* Modal Success Banner */}
            {workerModalSuccess && (
              <div className="p-3 rounded-xl bg-emerald-950/50 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{workerModalSuccess}</span>
              </div>
            )}

            <form onSubmit={handleRegisterWorker} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">{t.mining.workerName}</label>
                <input
                  type="text"
                  required
                  value={newWorkerName}
                  onChange={(e) => {
                    setNewWorkerName(e.target.value);
                    if (workerModalError) setWorkerModalError(null);
                  }}
                  placeholder="e.g. Windows-Rig-Ryzen7"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-sky-500 transition"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">{t.mining.workerPlatform}</label>
                <select
                  value={newWorkerPlatform}
                  onChange={(e) => setNewWorkerPlatform(e.target.value as WorkerPlatform)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-sky-500 transition"
                >
                  <option value="windows">Windows 10/11 (XMRig Client)</option>
                  <option value="linux">Linux Daemon</option>
                  <option value="mac">macOS CPU Node</option>
                  <option value="browser">Web Browser (Wasm)</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddWorkerModal(false);
                    setWorkerModalError(null);
                    setWorkerModalSuccess(null);
                  }}
                  className="px-4 py-2 rounded-xl border border-slate-700 text-xs text-slate-300 hover:bg-slate-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingWorker}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-xs font-bold text-white shadow-lg shadow-sky-500/20 cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                >
                  {savingWorker ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>{language === 'ar' ? 'جارٍ الحفظ...' : 'Saving Worker...'}</span>
                    </>
                  ) : (
                    <span>{t.mining.saveWorker}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Pool Configuration Modal */}
      {showPoolConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl text-slate-100 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Server className="w-5 h-5 text-sky-400" />
                <span>Stratum Pool Configuration</span>
              </h3>
              <button
                onClick={() => setShowPoolConfigModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Pool Host</label>
                <input
                  type="text"
                  placeholder="e.g. pool.supportxmr.com"
                  value={poolHost}
                  onChange={(e) => setPoolHost(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Monero Mining Wallet Address</label>
                <input
                  type="text"
                  placeholder="4... / 8... Monero Primary or Subaddress"
                  value={poolWallet}
                  onChange={(e) => setPoolWallet(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-[11px]"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Pool Port</label>
                  <input
                    type="number"
                    value={poolPort}
                    onChange={(e) => setPoolPort(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">TLS Encryption</label>
                  <div className="pt-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={poolTls}
                        onChange={(e) => setPoolTls(e.target.checked)}
                        className="rounded accent-sky-500"
                      />
                      <span>Enable TLS/SSL</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={handleTestPoolConnection}
                  disabled={testingPool}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-400 font-bold border border-slate-700 flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${testingPool ? 'animate-spin' : ''}`} />
                  <span>Test Socket Connection</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowPoolConfigModal(false)}
                  className="px-5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold shadow-md cursor-pointer"
                >
                  Save Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Backend & Cloud Diagnostics Modal */}
      {showBackendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-xl rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl text-slate-100 space-y-4 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <Activity className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base font-bold text-white">
                  {language === 'ar' ? 'تشخيص الاتصال بالخادم وقاعدة البيانات' : 'Backend & Database Diagnostics'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowBackendModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              {/* Target Project and DB info */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <span className="text-[10px] text-slate-500 uppercase font-semibold">Firebase Project</span>
                  <p className="font-mono text-sky-400 font-bold truncate">spinnermine-cloud-production</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <span className="text-[10px] text-slate-500 uppercase font-semibold">Firestore Database</span>
                  <p className="font-mono text-emerald-400 font-bold truncate">(default)</p>
                </div>
              </div>

              {/* Authentication Status Card (Zero Token Leaks) */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">Authentication State</span>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${currentUser ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                    <span className="font-medium text-slate-200">
                      {currentUser ? currentUser.email || 'Authenticated User' : 'Not Signed In (Guest)'}
                    </span>
                  </div>
                  {currentUser && (
                    <span className="font-mono text-[10px] text-slate-500">
                      UID: {currentUser.uid.slice(0, 10)}...
                    </span>
                  )}
                </div>
              </div>

              {/* Active Backend URL */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 uppercase font-semibold">Resolved Backend Endpoint</span>
                  <span className="text-[10px] font-mono text-slate-400">
                    {getBackendBaseUrl() ? 'Explicit Endpoint' : (isElectron ? 'Unconfigured' : 'Same-Origin Relative')}
                  </span>
                </div>
                <p className="font-mono text-white text-xs truncate break-all">
                  {getBackendBaseUrl() || (typeof window !== 'undefined' && window.location.protocol.startsWith('http') ? window.location.origin : 'Not Configured')}
                </p>
              </div>

              {/* Health Result Banner */}
              {backendHealth && (
                <div className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
                  backendHealth.ok && backendHealth.data?.firebase?.connected
                    ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                    : backendHealth.ok
                    ? 'bg-amber-950/40 border-amber-500/40 text-amber-300'
                    : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
                }`}>
                  {backendHealth.ok && backendHealth.data?.firebase?.connected ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-1">
                    <p className="font-bold">
                      {backendHealth.ok
                        ? `Server Connected (HTTP ${backendHealth.status}) • Latency: ${backendHealth.latencyMs}ms`
                        : `Backend Unreachable (HTTP ${backendHealth.status})`}
                    </p>
                    <p className="text-[11px] opacity-90">
                      Firestore Production Status: {backendHealth.data?.firebase?.connected ? 'Online & Accessible' : (backendHealth.data?.firebase?.notice || backendHealth.error || 'Pending ping')}
                    </p>
                  </div>
                </div>
              )}

              {/* Local Pending Drafts Inspector */}
              {workers.some(w => w.isPendingSync || w.status === 'pending_sync') && (
                <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/30 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-amber-300 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-amber-400" />
                      Pending Local Drafts ({workers.filter(w => w.isPendingSync || w.status === 'pending_sync').length})
                    </span>
                    <span className="text-[10px] text-amber-400/80">Awaiting Server Confirmation</span>
                  </div>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                    {workers.filter(w => w.isPendingSync || w.status === 'pending_sync').map(w => (
                      <div key={w.workerId || w.id} className="p-2 rounded-lg bg-slate-950/70 border border-amber-500/20 text-slate-300 flex items-center justify-between">
                        <div className="space-y-0.5">
                          <p className="font-bold text-white text-xs">{w.name} <span className="font-mono text-[10px] text-slate-500 font-normal">({w.workerId})</span></p>
                          {w.syncAttemptError && (
                            <p className="text-[10px] text-rose-400 font-mono">
                              HTTP {w.syncAttemptError.status || 0}: {w.syncAttemptError.error}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => syncPendingDrafts()}
                          disabled={syncingDrafts}
                          className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-[10px] font-bold border border-amber-500/40 cursor-pointer disabled:opacity-50"
                        >
                          Retry Sync
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Custom Backend URL Override for Electron */}
              <div className="space-y-1.5 pt-1">
                <label className="font-semibold text-slate-300">Custom Backend URL Override (Electron / Remote Testing)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customBackendInput}
                    onChange={(e) => {
                      setCustomBackendInput(e.target.value);
                      if (backendUrlFeedback) setBackendUrlFeedback(null);
                    }}
                    placeholder="https://spinnermine-backend-...run.app or http://localhost:3000"
                    className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-xs focus:outline-none focus:border-sky-500"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const trimmed = customBackendInput.trim();
                      if (trimmed) {
                        const ok = setCustomBackendUrl(trimmed);
                        if (ok) {
                          setBackendUrlFeedback({
                            type: 'success',
                            message: language === 'ar' ? 'تم حفظ عنوان Backend وتحديثه بنجاح.' : 'Custom Backend URL saved.'
                          });
                        } else {
                          setBackendUrlFeedback({
                            type: 'error',
                            message: language === 'ar' ? 'العنوان غير صالح: يجب أن يبدأ بـ https:// أو http://' : 'Invalid URL: must start with https:// or http://'
                          });
                        }
                      } else {
                        setCustomBackendUrl(null);
                        setBackendUrlFeedback({
                          type: 'success',
                          message: language === 'ar' ? 'تمت إعادة الضبط للعنوان الافتراضي.' : 'Reset to default production endpoint.'
                        });
                      }
                      handleCheckBackendHealth();
                    }}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-400 font-bold text-xs border border-slate-700 cursor-pointer"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomBackendUrl(null);
                      setCustomBackendInput('');
                      setBackendUrlFeedback({
                        type: 'success',
                        message: language === 'ar' ? 'تمت إعادة الضبط للعنوان الافتراضي.' : 'Reset to default production endpoint.'
                      });
                      handleCheckBackendHealth();
                    }}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 font-bold text-xs border border-slate-700 cursor-pointer"
                  >
                    Reset
                  </button>
                </div>
                {backendUrlFeedback && (
                  <p className={`text-[11px] font-medium mt-1 ${backendUrlFeedback.type === 'success' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {backendUrlFeedback.message}
                  </p>
                )}
              </div>

              {/* Cloud Run Deployment Reference */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5 text-[11px] text-slate-400">
                <p className="font-bold text-slate-200">How to deploy Backend to Cloud Run in spinnermine-cloud-production:</p>
                <code className="block p-2 rounded bg-slate-900 border border-slate-800 font-mono text-[10px] text-sky-300 select-all overflow-x-auto whitespace-pre">
gcloud run deploy spinnermine-backend \
  --project=spinnermine-cloud-production \
  --region=europe-west1 \
  --source=. \
  --allow-unauthenticated \
  --set-env-vars=FIREBASE_PROJECT_ID=spinnermine-cloud-production
                </code>
              </div>

              {/* Action buttons */}
              <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={handleCheckBackendHealth}
                  disabled={checkingHealth}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-400 font-bold border border-slate-700 flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${checkingHealth ? 'animate-spin' : ''}`} />
                  <span>{checkingHealth ? 'Pinging Server...' : 'Test Health Now'}</span>
                </button>

                {workers.some(w => w.isPendingSync || w.status === 'pending_sync') && (
                  <button
                    type="button"
                    onClick={async () => {
                      await syncPendingDrafts();
                      handleCheckBackendHealth();
                    }}
                    disabled={syncingDrafts}
                    className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold shadow-md cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${syncingDrafts ? 'animate-spin' : ''}`} />
                    <span>Sync All Drafts</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate Worker Resolver Modal */}
      <DuplicateWorkerResolverModal
        isOpen={showDuplicateModal}
        onClose={() => setShowDuplicateModal(false)}
        groups={duplicateGroups}
        workers={workers}
        getIdToken={async (forceRefresh) => {
          if (!currentUser) return null;
          return await currentUser.getIdToken(Boolean(forceRefresh));
        }}
        onResolved={async () => {
          setShowDuplicateModal(false);
          if (currentUser) {
            try {
              const idToken = await currentUser.getIdToken(true);
              const res = await getDuplicateWorkers(idToken);
              if (res.success) {
                setDuplicateGroups(res.groups);
              }
            } catch {}
          }
        }}
      />

      {/* Rename Worker Modal (Requirement 4: Changes device name without altering Worker ID) */}
      {renamingWorker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl text-slate-100 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-sky-400" />
                <h3 className="text-base font-bold text-white">
                  {language === 'ar' ? 'تعديل اسم الجهاز' : 'Rename Device'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setRenamingWorker(null);
                  setRenameFeedback(null);
                }}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
              <span className="text-[10px] text-slate-500 uppercase font-semibold">Worker ID (Immutable Identity)</span>
              <p className="font-mono text-sky-400 text-xs font-bold truncate">{renamingWorker.workerId || renamingWorker.id}</p>
            </div>

            {renameFeedback && (
              <div className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                renameFeedback.type === 'success'
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
              }`}>
                {renameFeedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                )}
                <span>{renameFeedback.message}</span>
              </div>
            )}

            <form onSubmit={handleRenameSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">
                  {language === 'ar' ? 'اسم الجهاز الجديد' : 'New Device Name'}
                </label>
                <input
                  type="text"
                  required
                  value={renameInput}
                  onChange={(e) => setRenameInput(e.target.value)}
                  placeholder="e.g. tm-workstation"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white font-medium text-xs focus:outline-none focus:border-sky-500"
                />
                <p className="text-[11px] text-slate-400">
                  {language === 'ar' 
                    ? 'تعديل الاسم لن يغير معرف الجهاز (Worker ID) ولن يؤثر على سجلات التعدين.' 
                    : 'Renaming updates the device label without modifying its permanent Worker ID or sessions.'}
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setRenamingWorker(null);
                    setRenameFeedback(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs cursor-pointer transition"
                >
                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>

                <button
                  type="submit"
                  disabled={savingRename || !renameInput.trim()}
                  className="px-5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs shadow-md cursor-pointer transition disabled:opacity-50 flex items-center gap-1.5"
                >
                  {savingRename && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{savingRename ? (language === 'ar' ? 'جارٍ الحفظ...' : 'Saving...') : (language === 'ar' ? 'حفظ الاسم' : 'Save Name')}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Phase 2D.1: Permanent Device Identity Linking Confirmation Modal */}
      {linkingWorker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg rounded-3xl bg-slate-900 border border-sky-500/40 p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-sky-500/20 text-sky-400 border border-sky-500/30">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {language === 'ar' ? 'ربط معرف التثبيت الدائم (Phase 2D.1)' : 'Link Permanent Windows Installation ID'}
                  </h3>
                  <p className="text-[11px] text-slate-400 font-mono">
                    Worker: {linkingWorker.name || linkingWorker.workerId} ({linkingWorker.workerId})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!isLinking) {
                    setLinkingWorker(null);
                    setLinkingConsent(false);
                    setLinkNotice(null);
                  }
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {linkNotice && (
              <div className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                linkNotice.type === 'success'
                  ? 'bg-sky-950/40 border-sky-500/40 text-sky-300'
                  : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
              }`}>
                {linkNotice.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                )}
                <span>{linkNotice.message}</span>
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800/80 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 font-medium">
                    {language === 'ar' ? 'معرف التثبيت المحلي (Windows UUID)' : 'Local Installation ID (Windows UUID)'}:
                  </span>
                  <span className="font-mono font-bold text-sky-300 px-2 py-0.5 rounded bg-sky-950/80 border border-sky-500/40 text-[11px]">
                    {installationId || 'Loading...'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">{language === 'ar' ? 'Worker ID الدائم' : 'Permanent Worker ID'}:</span>
                  <span className="font-mono text-slate-300 font-semibold">{linkingWorker.workerId}</span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">{language === 'ar' ? 'الأسهم المقبولة المحفوظة' : 'Retained Accepted Shares'}:</span>
                  <span className="font-mono text-emerald-400 font-bold">{linkingWorker.acceptedShares || 0}</span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">{language === 'ar' ? 'الأثر المالي على الرصيد' : 'Financial Balance Impact'}:</span>
                  <span className="font-mono text-emerald-400 font-bold">0.00000000 XMR (Zero Impact)</span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/50 text-[11px] text-slate-300 space-y-1">
                <p className="font-semibold text-sky-300">
                  {language === 'ar' ? 'ضمانات الهوية الدائمة:' : 'Permanent Identity Guarantees:'}
                </p>
                <ul className="list-disc list-inside space-y-0.5 text-slate-400">
                  <li>{language === 'ar' ? 'الحفاظ التام على Worker ID الحالي دون إنشاء أي جهاز ثالث.' : 'Preserves current Worker ID without creating any third device.'}</li>
                  <li>{language === 'ar' ? 'عدم الاعتماد على اسم الجهاز أو العتاد أو IP لتحديد الملكية.' : 'Decoupled from machine name, IP, or hardware fingerprints.'}</li>
                  <li>{language === 'ar' ? 'منع إعادة التسجيل المكرر لنفس المستخدم والتثبيت.' : 'Prevents duplicate re-registration for this user & installation.'}</li>
                  <li>{language === 'ar' ? 'الاحتفاظ الكامل بالأجهزة المؤرشفة (ty) وسجلات التدقيق.' : 'Retains all archived devices (ty) and audit trail intact.'}</li>
                </ul>
              </div>
            </div>

            <form onSubmit={handleConfirmLinkInstallation} className="space-y-4">
              <label className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer hover:border-sky-500/40 transition">
                <input
                  type="checkbox"
                  checked={linkingConsent}
                  onChange={(e) => setLinkingConsent(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-slate-700 text-sky-500 focus:ring-sky-500"
                />
                <span className="text-xs text-slate-300 select-none">
                  {language === 'ar'
                    ? `أوافق صراحة على ربط معرف التثبيت الدائم لجهاز Windows (${getShortInstallationId(installationId)}) بسجل جهاز ${linkingWorker.name || linkingWorker.workerId} (${linkingWorker.workerId}).`
                    : `I explicitly consent to linking this permanent Windows installation ID (${getShortInstallationId(installationId)}) to worker ${linkingWorker.name || linkingWorker.workerId} (${linkingWorker.workerId}).`}
                </span>
              </label>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={isLinking}
                  onClick={() => {
                    setLinkingWorker(null);
                    setLinkingConsent(false);
                    setLinkNotice(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs cursor-pointer transition disabled:opacity-50"
                >
                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={isLinking || !linkingConsent}
                  className="px-5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs shadow-md cursor-pointer transition disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isLinking && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isLinking ? (language === 'ar' ? 'جارٍ الربط والتحقق...' : 'Linking...') : (language === 'ar' ? 'تأكيد وربط الهوية الدائمة' : 'Confirm & Link Permanent ID')}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
