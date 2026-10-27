import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { AppPage, MiningWorker, MiningSession } from '../types';
import { PhaseBadge } from '../components/common/PhaseBadge';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import { 
  Cpu, 
  Activity, 
  Wallet, 
  Coins, 
  Gamepad2, 
  Disc, 
  ShieldAlert, 
  ArrowRight, 
  CheckCircle2, 
  AlertTriangle,
  Server,
  Zap,
  TrendingUp,
  Percent
} from 'lucide-react';

interface UserDashboardPageProps {
  setCurrentPage: (page: AppPage) => void;
  onOpenConsentModal: () => void;
}

export const UserDashboardPage: React.FC<UserDashboardPageProps> = ({ setCurrentPage, onOpenConsentModal }) => {
  const { currentUser, userProfile } = useAuth();
  const { t } = useLanguage();

  const [workers, setWorkers] = useState<MiningWorker[]>([]);
  const [activeSessions, setActiveSessions] = useState<MiningSession[]>([]);
  const [loading, setLoading] = useState(true);

  // Load user workers and sessions from Firestore
  useEffect(() => {
    if (!currentUser) return;

    const workersQuery = query(collection(db, 'miningWorkers'), where('userId', '==', currentUser.uid));
    const unsubWorkers = onSnapshot(
      workersQuery,
      (snapshot) => {
        const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MiningWorker));
        setWorkers(list);
        setLoading(false);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'miningWorkers');
        setLoading(false);
      }
    );

    const sessionsQuery = query(collection(db, 'miningSessions'), where('userId', '==', currentUser.uid));
    const unsubSessions = onSnapshot(
      sessionsQuery,
      (snapshot) => {
        const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MiningSession));
        setActiveSessions(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'miningSessions');
      }
    );

    return () => {
      unsubWorkers();
      unsubSessions();
    };
  }, [currentUser]);

  return (
    <div className="space-y-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      
      {/* Top Welcome & Consent Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 sm:p-8 rounded-3xl bg-gradient-to-r from-slate-900 via-slate-900 to-sky-950/40 border border-slate-800 shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white">
              {t.dashboard.welcome} {userProfile?.displayName || 'Miner'}
            </h1>
            <PhaseBadge phase={1} text="Phase 1 Active" />
          </div>
          <p className="text-xs sm:text-sm text-slate-400">
            {t.dashboard.phaseStatusNotice}
          </p>
        </div>

        {/* Consent Status Indicator & Button */}
        <div>
          {userProfile?.miningConsent ? (
            <div className="flex items-center gap-2.5 p-3 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-xs font-semibold">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <div>
                <span className="font-bold">{t.consent.statusGranted}</span>
                <p className="text-[10px] text-emerald-400/80">Policy {userProfile.consentVersion || 'v1.0'}</p>
              </div>
            </div>
          ) : (
            <button
              onClick={onOpenConsentModal}
              className="px-5 py-3 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-extrabold text-xs shadow-lg shadow-amber-500/20 flex items-center gap-2 transition cursor-pointer"
            >
              <ShieldAlert className="w-4 h-4" />
              <span>Review Mining Consent (Required)</span>
            </button>
          )}
        </div>
      </div>

      {/* Primary Metrics Grid (Strict Real Baseline — No Fake Balances) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        
        {/* Hashrate Status */}
        <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800/80 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-slate-400 text-xs font-semibold mb-2">
              <span>{t.dashboard.hashrateCard}</span>
              <Activity className="w-4 h-4 text-sky-400" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-white font-mono-numbers">0.00</span>
              <span className="text-xs text-slate-400 font-bold">H/s</span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-800/80 text-[11px] text-sky-400 font-medium">
            {t.dashboard.hashrateDesc}
          </div>
        </div>

        {/* Workers Status */}
        <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800/80 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-slate-400 text-xs font-semibold mb-2">
              <span>{t.dashboard.workersCard}</span>
              <Server className="w-4 h-4 text-blue-400" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-white font-mono-numbers">{workers.length}</span>
              <span className="text-xs text-slate-400 font-bold">Registered</span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
            <span className="text-slate-400">{t.dashboard.activeWorkers}:</span>
            <span className="font-bold text-amber-400 font-mono-numbers">
              {workers.filter(w => w.status === 'online').length}
            </span>
          </div>
        </div>

        {/* Confirmed Attributable Revenue (20% Split) */}
        <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800/80 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-slate-400 text-xs font-semibold mb-2">
              <span>{t.dashboard.confirmedRevenueCard}</span>
              <Coins className="w-4 h-4 text-amber-400" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-amber-400 font-mono-numbers">0.000000</span>
              <span className="text-xs text-slate-400 font-bold">XMR</span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-800/80 text-[11px] text-amber-400/90 font-medium">
            {t.dashboard.userSplitNotice}
          </div>
        </div>

        {/* Wallet Status */}
        <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800/80 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-slate-400 text-xs font-semibold mb-2">
              <span>{t.dashboard.walletBalanceCard}</span>
              <Wallet className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-white font-mono-numbers">0.000000</span>
              <span className="text-xs text-slate-400 font-bold">XMR</span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-800/80 text-[11px] text-slate-400">
            {t.dashboard.zeroBalanceNotice}
          </div>
        </div>

      </div>

      {/* Quick Navigation Cards */}
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-4">
          {t.dashboard.quickActions}
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          
          {/* Mining Card */}
          <div 
            onClick={() => setCurrentPage('mining')}
            className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 hover:border-sky-500/50 hover:bg-slate-900/80 transition cursor-pointer group flex flex-col justify-between space-y-4"
          >
            <div className="space-y-3">
              <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-400 flex items-center justify-center group-hover:scale-105 transition">
                <Cpu className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white group-hover:text-sky-300 transition">{t.dashboard.launchMining}</h4>
                <p className="text-xs text-slate-400 mt-1">Configure WebAssembly CPU worker threads and hardware throttle cap.</p>
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs font-bold text-sky-400 pt-2 border-t border-slate-800/60">
              <span>Open Rig</span>
              <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180 group-hover:translate-x-1 rtl:group-hover:-translate-x-1 transition" />
            </div>
          </div>

          {/* Spinner Card */}
          <div 
            onClick={() => setCurrentPage('spinner')}
            className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 hover:border-amber-500/50 hover:bg-slate-900/80 transition cursor-pointer group flex flex-col justify-between space-y-4"
          >
            <div className="space-y-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center group-hover:scale-105 transition">
                <Gamepad2 className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-white group-hover:text-amber-300 transition">{t.dashboard.playSpinner}</h4>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-bold">Physics</span>
                </div>
                <p className="text-xs text-slate-400 mt-1">Interactive fidget spinner physics simulation with live RPM calculation.</p>
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs font-bold text-amber-400 pt-2 border-t border-slate-800/60">
              <span>Play Now</span>
              <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180 group-hover:translate-x-1 rtl:group-hover:-translate-x-1 transition" />
            </div>
          </div>

          {/* Wheel Card */}
          <div 
            onClick={() => setCurrentPage('wheel')}
            className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 hover:border-blue-500/50 hover:bg-slate-900/80 transition cursor-pointer group flex flex-col justify-between space-y-4"
          >
            <div className="space-y-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400 flex items-center justify-center group-hover:scale-105 transition">
                <Disc className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-white group-hover:text-blue-300 transition">{t.dashboard.spinWheel}</h4>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-bold">Daily Free</span>
                </div>
                <p className="text-xs text-slate-400 mt-1">Spin the prize wheel daily to win hashrate boosts and points vouchers.</p>
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs font-bold text-blue-400 pt-2 border-t border-slate-800/60">
              <span>Spin Wheel</span>
              <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180 group-hover:translate-x-1 rtl:group-hover:-translate-x-1 transition" />
            </div>
          </div>

          {/* Wallet Card */}
          <div 
            onClick={() => setCurrentPage('wallet')}
            className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 hover:border-emerald-500/50 hover:bg-slate-900/80 transition cursor-pointer group flex flex-col justify-between space-y-4"
          >
            <div className="space-y-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center group-hover:scale-105 transition">
                <Wallet className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white group-hover:text-emerald-300 transition">{t.dashboard.openWallet}</h4>
                <p className="text-xs text-slate-400 mt-1">Inspect immutable transaction ledgers and submit XMR payout requests.</p>
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs font-bold text-emerald-400 pt-2 border-t border-slate-800/60">
              <span>Manage Wallet</span>
              <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180 group-hover:translate-x-1 rtl:group-hover:-translate-x-1 transition" />
            </div>
          </div>

        </div>
      </div>

      {/* Operational Policy & Transparency Card */}
      <div className="p-6 rounded-3xl bg-slate-900/40 border border-slate-800/80 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Percent className="w-5 h-5 text-amber-400" />
            <h4 className="text-sm font-bold text-white">Transparent Mining Operations Summary</h4>
          </div>
          <span className="text-xs font-mono text-slate-400">Split: 20% User / 80% Platform</span>
        </div>
        
        <p className="text-xs text-slate-300 leading-relaxed">
          Browser mining operates via lightweight WebAssembly workers with strict hardware safety limits.
          Confirmed pool block payouts are divided according to verified shares: 20% is credited directly to the miner’s balance, while 80% covers pool operations, electricity offsets, and platform reward reserves.
        </p>
      </div>

    </div>
  );
};
