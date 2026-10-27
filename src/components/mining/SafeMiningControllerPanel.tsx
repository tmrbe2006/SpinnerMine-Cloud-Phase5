/**
 * SpinnerMine Cloud - Safe Mining Engine Controller Panel (Phase 2D - Stage B, D, F)
 * 
 * Supports:
 * - Engine Selection: Mock Engine (CPU-Safe Simulation) vs Real XMRig Engine (RandomX rx/0)
 * - Real-time state machine: STOPPED, STARTING, RUNNING, PAUSED, STOPPING, ERROR
 * - Authoritative Real Telemetry: Real Hashrate, 10s/60s/15m Averages, CPU usage (os.cpus() deltas),
 *   Engine PID, Pool Status, Jobs Received, Submitted Shares, Accepted Shares, Rejected Shares, Uptime
 * - Commands: Start, Stop, Pause, Resume, Reset Error, and Emergency Stop (instant kill)
 * - Financial Operations: STRICTLY LOCKED (Verified shares recorded for verification only, 0 balance mutations)
 * - Thermal & Electricity Advisory for Real Mining
 * - Expandable Command Audit Log with timestamps, status, duration, and error diagnostics
 */

import React, { useState } from 'react';
import {
  Play,
  Square,
  Pause,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  Cpu,
  Clock,
  Activity,
  History,
  CheckCircle2,
  XCircle,
  Radio,
  Zap,
  Info,
  Flame,
  ShieldAlert,
  Server,
  Lock,
  OctagonAlert
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { MiningWorker } from '../../types';
import { useMiningController } from '../../mining/use-mining-controller';
import { MiningEngineState, MiningEngineCommand, MiningEngineType } from '../../mining/engine-types';

interface SafeMiningControllerPanelProps {
  currentUserId?: string;
  userMiningConsent?: boolean;
  onOpenConsentModal?: () => void;
  activeWorker?: MiningWorker | null;
  deviceOnline: boolean;
  lastHeartbeatFormatted: string;
  detectedCores: number;
  threads: number;
  poolHost?: string;
  poolPort?: number;
  poolTls?: boolean;
  walletAddress?: string;
  xmrigPath?: string;
  onUpdateThreads: (threads: number) => void;
}

export const SafeMiningControllerPanel: React.FC<SafeMiningControllerPanelProps> = ({
  currentUserId,
  userMiningConsent,
  onOpenConsentModal,
  activeWorker,
  deviceOnline,
  lastHeartbeatFormatted,
  detectedCores,
  threads,
  poolHost = 'pool.supportxmr.com',
  poolPort = 3333,
  poolTls = false,
  walletAddress = '',
  xmrigPath = '',
  onUpdateThreads
}) => {
  const { language } = useLanguage();
  const [showAuditLog, setShowAuditLog] = useState(false);

  const {
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
  } = useMiningController(currentUserId);

  const handleCommand = async (command: MiningEngineCommand) => {
    clearError();
    const workerId = activeWorker?.workerId || activeWorker?.id || 'w_default_worker';
    const userId = currentUserId || 'unauthenticated_user';

    await executeCommand(command, {
      workerId,
      userId,
      threads,
      throttle: 50,
      engineType,
      poolHost,
      poolPort,
      poolTls,
      walletAddress,
      executablePath: xmrigPath,
      consentAccepted: Boolean(userMiningConsent)
    });
  };

  const handleSwitchType = (type: MiningEngineType) => {
    if (state !== 'STOPPED') return;
    switchEngineType(type);
  };

  // State styling configuration
  const getStateBadge = (s: MiningEngineState, type: MiningEngineType) => {
    const isReal = type === 'real';
    switch (s) {
      case 'RUNNING':
        return {
          bg: isReal ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300' : 'bg-purple-950/70 border-purple-500/40 text-purple-300',
          dot: isReal ? 'bg-emerald-400 animate-ping' : 'bg-purple-400 animate-pulse',
          label: isReal 
            ? (language === 'ar' ? 'تعدين حقيقي نشط (REAL)' : 'RUNNING (REAL XMRIG)')
            : (language === 'ar' ? 'تشغيل تجريبي (MOCK)' : 'RUNNING (MOCK)')
        };
      case 'STARTING':
        return {
          bg: 'bg-sky-950/70 border-sky-500/40 text-sky-300',
          dot: 'bg-sky-400 animate-spin',
          label: language === 'ar' ? 'جارٍ البدء...' : 'STARTING...'
        };
      case 'PAUSED':
        return {
          bg: 'bg-amber-950/70 border-amber-500/40 text-amber-300',
          dot: 'bg-amber-400',
          label: language === 'ar' ? 'مؤقت (PAUSED)' : 'PAUSED'
        };
      case 'STOPPING':
        return {
          bg: 'bg-rose-950/70 border-rose-500/40 text-rose-300',
          dot: 'bg-rose-400 animate-spin',
          label: language === 'ar' ? 'جارٍ الإيقاف...' : 'STOPPING...'
        };
      case 'ERROR':
        return {
          bg: 'bg-red-950/80 border-red-500/50 text-red-300',
          dot: 'bg-red-500 animate-ping',
          label: language === 'ar' ? 'خطأ بالمحرك (ERROR)' : 'ERROR'
        };
      case 'STOPPED':
      default:
        return {
          bg: 'bg-slate-800/80 border-slate-700 text-slate-300',
          dot: 'bg-slate-500',
          label: language === 'ar' ? 'متوقف (STOPPED)' : 'STOPPED'
        };
    }
  };

  const badge = getStateBadge(state, engineType);

  const formatUptime = (totalSeconds: number): string => {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="rounded-3xl bg-slate-900/90 border border-slate-800 p-6 sm:p-8 shadow-2xl space-y-6">
      
      {/* Top Banner: Engine Mode Selection & Financial Isolation Active */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-slate-800/80">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
              {language === 'ar' ? 'نظام التحكم بمحرك التعدين' : 'Mining Engine Controller'}
            </h2>

            {/* Engine Type Tabs */}
            <div className="inline-flex rounded-xl bg-slate-950 p-1 border border-slate-800">
              <button
                type="button"
                onClick={() => handleSwitchType('mock')}
                disabled={state !== 'STOPPED' || isBusy}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer disabled:opacity-50 ${
                  engineType === 'mock'
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Mock Engine (Simulation)
              </button>
              <button
                type="button"
                onClick={() => handleSwitchType('real')}
                disabled={state !== 'STOPPED' || isBusy}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer disabled:opacity-50 flex items-center gap-1.5 ${
                  engineType === 'real'
                    ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Real XMRig (v6.26.0)</span>
              </button>
            </div>

            {/* Financial Isolation Tag */}
            <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-amber-950/70 text-amber-300 border border-amber-500/40 flex items-center gap-1 font-mono">
              <Lock className="w-3.5 h-3.5" />
              <span>Financial Operations: LOCKED</span>
            </span>
          </div>

          <p className="text-xs sm:text-sm text-slate-400">
            {engineType === 'real'
              ? (language === 'ar'
                ? 'تكامل XMRig 6.26.0 الحقيقي (RandomX rx/0). يتم تسجيل الحصص المقبولة للتحقق التشغيلي فقط، والعمليات المالية مقفلة بالكامل في المرحلة 2D.'
                : 'Real XMRig 6.26.0 RandomX engine. Accepted shares are verified and tracked for operational verification; financial balance writes are strictly locked.')
              : (language === 'ar'
                ? 'محرك تجريبي آمن لا يستهلك قدرة المعالج ولا يتصل بمجمعات تعدين حقيقية ولا يُنشئ أي أرباح قابلة للصرف.'
                : 'Isolated simulation engine with strict state validation, zero hardware burden, and zero financial mutation.')}
          </p>
        </div>

        {/* Engine State Indicator */}
        <div className="flex items-center gap-3">
          <div className={`px-4 py-2 rounded-xl border flex items-center gap-2.5 ${badge.bg} shadow-lg transition-all`}>
            <span className={`w-2.5 h-2.5 rounded-full ${badge.dot}`} />
            <span className="text-xs font-extrabold tracking-wider">{badge.label}</span>
          </div>
        </div>
      </div>

      {/* Advisory Warning for Real Mining Mode */}
      {engineType === 'real' && (
        <div className="p-4 rounded-2xl bg-amber-950/30 border border-amber-500/30 text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
          <div className="flex items-start gap-3">
            <Flame className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-bold text-amber-300">
                {language === 'ar' ? 'تنبيه استهلاك الطاقة والحرارة' : 'Real Hardware CPU Mining Notice'}
              </p>
              <p className="text-amber-200/90 leading-relaxed">
                {language === 'ar'
                  ? 'التعدين الحقيقي يستهلك طاقة المعالج ويرفع حرارة الجهاز. يمكنك إيقاف التعدين فوراً في أي وقت عبر زر الإيقاف العاجل (Emergency Stop).'
                  : 'Real mining utilizes CPU processing threads, consumes electricity, and increases device temperature. You can immediately halt execution using Emergency Stop at any time.'}
              </p>
            </div>
          </div>

          {!userMiningConsent && (
            <button
              type="button"
              onClick={onOpenConsentModal}
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shrink-0 cursor-pointer shadow-md transition"
            >
              {language === 'ar' ? 'منح الموافقة الصريحة' : 'Grant Required Consent'}
            </button>
          )}
        </div>
      )}

      {/* Error Alert Display */}
      {error && (
        <div className="p-4 rounded-2xl bg-red-950/40 border border-red-500/40 text-red-200 flex items-start justify-between gap-3 shadow-lg">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-xs font-bold text-red-300 uppercase tracking-wide">
                {language === 'ar' ? 'تنبيه وحدة التحكم' : 'Controller Alert'}
              </h4>
              <p className="text-xs text-red-200/90 mt-0.5">{error}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={clearError}
            className="p-1 rounded-lg text-red-400 hover:text-white hover:bg-red-500/20 transition cursor-pointer"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Stale Telemetry Warning */}
      {telemetry.isStale && state === 'RUNNING' && (
        <div className="p-3.5 rounded-xl bg-amber-950/50 border border-amber-500/40 text-amber-300 text-xs flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            {language === 'ar'
              ? 'تنبيه: لم ترد بيانات قياسات جديدة منذ أكثر من 15 ثانية (بيانات قديمة أو الاتصال بالمحرك غير مستقر).'
              : 'Warning: Telemetry stream has not updated for > 15s (Data may be stale or local engine connection dropped).'}
          </span>
        </div>
      )}

      {/* Independent Status Grid (Stage D) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* 1. Device Connection */}
        <div className="p-3.5 rounded-2xl bg-slate-800/40 border border-slate-800 space-y-1">
          <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
            {language === 'ar' ? 'اتصال الجهاز' : 'Device Connection'}
          </span>
          <div className="flex items-center gap-1.5 pt-0.5">
            <span className={`w-2 h-2 rounded-full ${deviceOnline ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
            <span className={`text-xs font-extrabold ${deviceOnline ? 'text-emerald-300' : 'text-slate-400'}`}>
              {deviceOnline ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>

        {/* 2. Engine Status */}
        <div className="p-3.5 rounded-2xl bg-slate-800/40 border border-slate-800 space-y-1">
          <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
            {language === 'ar' ? 'حالة المحرك' : 'Engine Status'}
          </span>
          <span className="text-xs font-extrabold text-white block pt-0.5 font-mono">
            {state}
          </span>
        </div>

        {/* 3. Engine Type & PID */}
        <div className="p-3.5 rounded-2xl bg-slate-800/40 border border-slate-800 space-y-1">
          <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
            {engineType === 'real' ? 'Real Engine (PID)' : 'Engine Type'}
          </span>
          <div className="flex items-center gap-1 pt-0.5">
            <ShieldCheck className={`w-3.5 h-3.5 ${engineType === 'real' ? 'text-emerald-400' : 'text-purple-400'}`} />
            <span className={`text-xs font-extrabold font-mono ${engineType === 'real' ? 'text-emerald-300' : 'text-purple-300'}`}>
              {engineType === 'real' ? `PID: ${telemetry.pid ?? 'Standby'}` : 'Mock Engine'}
            </span>
          </div>
        </div>

        {/* 4. CPU Threads & Usage */}
        <div className="p-3.5 rounded-2xl bg-slate-800/40 border border-slate-800 space-y-1">
          <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
            {language === 'ar' ? 'الأنوية / الاستهلاك' : 'Threads / Load'}
          </span>
          <span className="text-xs font-extrabold text-sky-400 block pt-0.5 font-mono">
            {threads}T / {telemetry.cpuUsage !== undefined ? `${telemetry.cpuUsage}%` : (state === 'RUNNING' ? 'Measuring...' : 'Standby')}
          </span>
        </div>

        {/* 5. Last Heartbeat */}
        <div className="p-3.5 rounded-2xl bg-slate-800/40 border border-slate-800 space-y-1">
          <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
            {language === 'ar' ? 'آخر نبض' : 'Last Heartbeat'}
          </span>
          <span className="text-xs font-bold text-slate-300 block pt-0.5 font-mono truncate" title={lastHeartbeatFormatted}>
            {lastHeartbeatFormatted}
          </span>
        </div>

        {/* 6. Mining Uptime */}
        <div className="p-3.5 rounded-2xl bg-slate-800/40 border border-slate-800 space-y-1">
          <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
            {state === 'RUNNING' || state === 'PAUSED'
              ? (language === 'ar' ? 'مدة الجلسة الحالية' : 'Current Uptime')
              : (language === 'ar' ? 'مدة آخر جلسة' : 'Last Duration')}
          </span>
          <div className="flex items-center gap-1.5 pt-0.5">
            <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-xs font-extrabold text-amber-300 font-mono">
              {state === 'RUNNING' || state === 'PAUSED'
                ? formatUptime(telemetry.uptimeSeconds)
                : formatUptime(telemetry.lastSessionDurationSeconds || 0)}
            </span>
          </div>
        </div>
      </div>

      {/* Primary Telemetry Metrics Section */}
      <div className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
        engineType === 'real'
          ? 'bg-emerald-950/20 border-emerald-500/20'
          : 'bg-purple-950/20 border-purple-500/20'
      }`}>
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-xl border shrink-0 ${
            engineType === 'real'
              ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
              : 'bg-purple-500/20 border-purple-500/30 text-purple-400'
          }`}>
            <Zap className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-white">
                {engineType === 'real' ? 'Real XMRig Telemetry (rx/0)' : 'Simulated Hashrate'}
              </span>
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono border ${
                engineType === 'real'
                  ? 'bg-emerald-900/60 text-emerald-300 border-emerald-400/40'
                  : 'bg-purple-900/60 text-purple-300 border-purple-400/40'
              }`}>
                {engineType === 'real' ? '[XMRig 6.26.0 Native]' : '[SIMULATION ONLY]'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {engineType === 'real'
                ? `Pool: ${poolHost}:${poolPort} • TLS: ${poolTls ? 'Enabled' : 'Disabled'} • Jobs: ${telemetry.jobsReceived || 0}`
                : 'Benign telemetry simulation. Strictly non-financial and drops to 0 H/s instantly when stopped or paused.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 sm:gap-5">
          {/* Current Live Hashrate */}
          <div className="text-end">
            <span className="text-[10px] text-slate-400 uppercase font-mono block">
              {language === 'ar' ? 'المعدل اللحظي' : 'Current Hashrate'}
            </span>
            <span className={`text-sm font-extrabold font-mono ${
              state === 'RUNNING' && telemetry.hashrate > 0 
                ? (engineType === 'real' ? 'text-emerald-400 animate-pulse' : 'text-purple-300 animate-pulse') 
                : 'text-slate-400'
            }`}>
              {state === 'RUNNING' ? telemetry.hashrate : 0} H/s
            </span>
            <span className="text-[9px] font-mono text-slate-500 block">
              {state === 'RUNNING' ? '(Live)' : '(0 H/s Standby)'}
            </span>
          </div>

          <div className="h-8 w-px bg-slate-800 hidden sm:block" />

          {/* Average Hashrate */}
          <div className="text-end">
            <span className="text-[10px] text-slate-400 uppercase font-mono block">
              {language === 'ar' ? 'متوسط 60 ثانية' : 'Avg Hashrate (60s)'}
            </span>
            <span className="text-sm font-extrabold text-slate-300 font-mono">
              {state === 'RUNNING' ? (telemetry.hashrate60s || telemetry.hashrate || 0) : 0} H/s
            </span>
            <span className="text-[9px] font-mono text-slate-500 block">
              (Smooth Metric)
            </span>
          </div>

          <div className="h-8 w-px bg-slate-800 hidden sm:block" />

          {/* Accepted / Rejected Shares */}
          <div className="text-end">
            <span className="text-[10px] text-slate-400 uppercase font-mono block">
              {language === 'ar' ? 'الحصص المقبولة / المرفوضة' : 'Accepted / Rejected'}
            </span>
            <span className="text-sm font-extrabold text-emerald-400 font-mono">
              {telemetry.acceptedShares} <span className="text-xs text-rose-400">/ {telemetry.rejectedShares}</span>
            </span>
            <span className="text-[9px] font-mono text-amber-400/90 block">
              (0 XMR Credited • Locked)
            </span>
          </div>
        </div>
      </div>

      {/* Control Actions Bar (Stage B Requirements) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase text-slate-400 tracking-wider">
            {language === 'ar' ? 'أوامر التحكم بالمحرك' : 'Engine Command Controls'}
          </span>
          <span className="text-[11px] text-slate-500 font-mono">
            {isBusy ? (
              <span className="flex items-center gap-1.5 text-sky-400">
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span>Processing command...</span>
              </span>
            ) : (
              <span>Mutex: Unlocked</span>
            )}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* START */}
          <button
            type="button"
            onClick={() => handleCommand('START')}
            disabled={isBusy || state === 'RUNNING' || state === 'STARTING' || state === 'PAUSED' || state === 'ERROR'}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/20 flex items-center gap-2 cursor-pointer transition disabled:opacity-30 disabled:cursor-not-allowed"
            title={`Start ${engineType === 'real' ? 'Real XMRig' : 'Mock'} Engine`}
          >
            <Play className="w-4 h-4 fill-current" />
            <span>{language === 'ar' ? (engineType === 'real' ? 'بدء التعدين الحقيقي' : 'تشغيل (Start)') : (engineType === 'real' ? 'Start Real XMRig' : 'Start Mock')}</span>
          </button>

          {/* PAUSE */}
          <button
            type="button"
            onClick={() => handleCommand('PAUSE')}
            disabled={isBusy || state !== 'RUNNING'}
            className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shadow-lg shadow-amber-600/20 flex items-center gap-2 cursor-pointer transition disabled:opacity-30 disabled:cursor-not-allowed"
            title="Pause Mining Engine"
          >
            <Pause className="w-4 h-4" />
            <span>{language === 'ar' ? 'إيقاف مؤقت (Pause)' : 'Pause'}</span>
          </button>

          {/* RESUME */}
          <button
            type="button"
            onClick={() => handleCommand('RESUME')}
            disabled={isBusy || state !== 'PAUSED'}
            className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold shadow-lg shadow-sky-600/20 flex items-center gap-2 cursor-pointer transition disabled:opacity-30 disabled:cursor-not-allowed"
            title="Resume Mining Engine"
          >
            <PlayCircle className="w-4 h-4" />
            <span>{language === 'ar' ? 'استئناف (Resume)' : 'Resume'}</span>
          </button>

          {/* STOP */}
          <button
            type="button"
            onClick={() => handleCommand('STOP')}
            disabled={isBusy || state === 'STOPPED'}
            className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-600/20 flex items-center gap-2 cursor-pointer transition disabled:opacity-30 disabled:cursor-not-allowed"
            title="Stop Mining Engine"
          >
            <Square className="w-4 h-4 fill-current" />
            <span>{language === 'ar' ? 'إيقاف (Stop)' : 'Stop'}</span>
          </button>

          {/* EMERGENCY STOP (Immediate Kill) */}
          <button
            type="button"
            onClick={() => emergencyStop()}
            disabled={state === 'STOPPED'}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-red-700 to-rose-700 hover:from-red-600 hover:to-rose-600 text-white text-xs font-extrabold shadow-lg shadow-red-700/30 flex items-center gap-2 cursor-pointer transition disabled:opacity-30 disabled:cursor-not-allowed"
            title="Emergency Stop: Forcefully kill mining processes immediately"
          >
            <OctagonAlert className="w-4 h-4" />
            <span>{language === 'ar' ? 'إيقاف عاجل (Emergency Stop)' : 'Emergency Stop'}</span>
          </button>

          {/* RESET ERROR */}
          <button
            type="button"
            onClick={() => handleCommand('RESET_ERROR')}
            disabled={isBusy || state !== 'ERROR'}
            className="px-5 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold shadow-lg shadow-orange-600/20 flex items-center gap-2 cursor-pointer transition disabled:opacity-30 disabled:cursor-not-allowed"
            title="Reset Error State"
          >
            <RefreshCw className="w-4 h-4" />
            <span>{language === 'ar' ? 'تصفير الخطأ (Reset Error)' : 'Reset Error'}</span>
          </button>

          {/* TEST ERROR INJECTION (Simulate Error for Mock Mode) */}
          {engineType === 'mock' && (
            <button
              type="button"
              onClick={() => simulateError('Simulated critical hardware alert for controller test')}
              disabled={isBusy || state === 'STOPPED' || state === 'ERROR'}
              className="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition disabled:opacity-30 disabled:cursor-not-allowed"
              title="Inject simulated error to test controller recovery"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              <span>{language === 'ar' ? 'محاكاة خطأ (Test)' : 'Inject Error (Test)'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Command Audit Log Collapsible (Stage B Requirement 7) */}
      <div className="pt-2 border-t border-slate-800/80">
        <button
          type="button"
          onClick={() => setShowAuditLog(!showAuditLog)}
          className="w-full flex items-center justify-between text-xs font-bold text-slate-400 hover:text-white py-2 cursor-pointer transition"
        >
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-sky-400" />
            <span>{language === 'ar' ? 'سجل أوامر وحدة التحكم (Audit Log)' : 'Engine Controller Audit Log'}</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-800 text-sky-300 font-mono">
              {auditLog.length} entries
            </span>
          </div>
          <span className="text-[11px] text-slate-500">{showAuditLog ? '▲ Collapse' : '▼ Expand'}</span>
        </button>

        {showAuditLog && (
          <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
            {auditLog.length === 0 ? (
              <p className="text-center py-4 text-xs text-slate-500 font-mono">No command entries recorded yet.</p>
            ) : (
              <table className="w-full text-start text-xs font-mono">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-500 text-[10px] uppercase">
                    <th className="pb-2 text-start">Time</th>
                    <th className="pb-2 text-start">Command</th>
                    <th className="pb-2 text-start">Engine</th>
                    <th className="pb-2 text-start">Transition</th>
                    <th className="pb-2 text-start">Result</th>
                    <th className="pb-2 text-start">Duration</th>
                    <th className="pb-2 text-start">Message</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40 text-[11px]">
                  {auditLog.slice(0, 15).map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-800/30">
                      <td className="py-2 text-slate-400">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="py-2 font-bold text-sky-300">{entry.command}</td>
                      <td className="py-2">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase ${entry.engineType === 'real' ? 'bg-emerald-950 text-emerald-300' : 'bg-purple-950 text-purple-300'}`}>
                          {entry.engineType}
                        </span>
                      </td>
                      <td className="py-2 text-slate-300">
                        {entry.previousState} → {entry.nextState}
                      </td>
                      <td className="py-2">
                        {entry.success ? (
                          <span className="text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> OK
                          </span>
                        ) : (
                          <span className="text-rose-400 flex items-center gap-1">
                            <XCircle className="w-3 h-3" /> REJECTED
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-slate-400">{entry.durationMs}ms</td>
                      <td className="py-2 text-slate-300 max-w-xs truncate" title={entry.message}>
                        {entry.message || 'Success'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

    </div>
  );
};
