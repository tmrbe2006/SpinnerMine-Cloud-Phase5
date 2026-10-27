import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { PhaseBadge } from '../components/common/PhaseBadge';
import { 
  UserProfile, 
  MiningWorker, 
  WithdrawalRecord, 
  AuditLogRecord, 
  SystemSetting 
} from '../types';
import { 
  collection, 
  onSnapshot 
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { 
  ShieldAlert, 
  Users, 
  Cpu, 
  Coins, 
  History, 
  Sliders, 
  FileText, 
  CheckCircle2, 
  XCircle, 
  Search, 
  AlertTriangle,
  Lock,
  ArrowRight,
  Server,
  Key
} from 'lucide-react';

export const AdminDashboardPage: React.FC = () => {
  const { currentUser, isAdmin, refreshAdminClaims } = useAuth();
  const { t } = useLanguage();

  const [activeTab, setActiveTab] = useState<'overview' | 'revenue' | 'withdrawals' | 'workers' | 'settings' | 'audit'>('overview');

  // Admin Data states
  const [workersList, setWorkersList] = useState<MiningWorker[]>([]);
  const [withdrawalsList, setWithdrawalsList] = useState<WithdrawalRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);

  // System settings state (read-only client view of server config)
  const [stratumHost] = useState('pool.spinnermine.cloud');
  const [stratumPort] = useState('3333');
  const [userSplitRatio] = useState('0.20');
  const [platformSplitRatio] = useState('0.80');
  const [maintenanceMode] = useState(false);

  // Fetch admin collections cleanly
  useEffect(() => {
    if (!isAdmin) return;

    // Load Withdrawals
    const unsubWithdrawals = onSnapshot(collection(db, 'withdrawals'), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as WithdrawalRecord));
      setWithdrawalsList(list);
    }, (err) => {
      console.warn('Withdrawals list error:', err);
    });

    // Load Workers
    const unsubWorkers = onSnapshot(collection(db, 'miningWorkers'), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as MiningWorker));
      setWorkersList(list);
    }, (err) => {
      console.warn('Workers list error:', err);
    });

    // Load Audit Logs (Read-only)
    const unsubAudit = onSnapshot(collection(db, 'auditLogs'), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as AuditLogRecord));
      list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setAuditLogs(list);
    }, (err) => {
      console.warn('Audit logs read error:', err);
    });

    return () => {
      unsubWithdrawals();
      unsubWorkers();
      unsubAudit();
    };
  }, [isAdmin]);

  // Strict unauthorized guard
  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center space-y-4">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center justify-center">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-white">{t.admin.accessDenied}</h2>
        <p className="text-xs text-slate-400 leading-relaxed max-w-md mx-auto">
          {t.admin.accessDeniedSub} Administrator privileges are authenticated via Firebase Custom Claims minted by the server.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 sm:p-8 rounded-3xl bg-slate-900/90 border border-amber-500/40 shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">{t.admin.title}</h1>
            <span className="px-2.5 py-0.5 rounded text-[10px] font-black uppercase bg-amber-500/20 text-amber-400 border border-amber-500/40 flex items-center gap-1">
              <Key className="w-3 h-3" />
              Custom Claim Verified
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-400">{t.admin.subtitle}</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-xs text-slate-400 font-mono bg-slate-950 px-3.5 py-2 rounded-xl border border-slate-800">
            Authenticated: {currentUser?.email}
          </div>
          <button
            onClick={() => refreshAdminClaims()}
            className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition"
            title="Refresh ID Token Claims"
          >
            Refresh Token
          </button>
        </div>
      </div>

      {/* Admin Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-slate-800 text-xs font-bold">
        {[
          { id: 'overview', label: t.admin.tabs.overview, icon: Coins },
          { id: 'revenue', label: t.admin.tabs.revenue, icon: Coins },
          { id: 'withdrawals', label: t.admin.tabs.withdrawals, icon: History, count: withdrawalsList.filter(w => w.status === 'pending').length },
          { id: 'workers', label: t.admin.tabs.workers, icon: Cpu, count: workersList.length },
          { id: 'settings', label: t.admin.tabs.settings, icon: Sliders },
          { id: 'audit', label: t.admin.tabs.audit, icon: FileText, count: auditLogs.length },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition cursor-pointer whitespace-nowrap ${
                isActive
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900 border border-transparent'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
              {typeof tab.count === 'number' && tab.count > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-400">
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab: Overview */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
              <span className="text-xs text-slate-400 font-semibold">{t.admin.stats.activeWorkers}</span>
              <p className="text-3xl font-black text-white font-mono-numbers mt-1">{workersList.length}</p>
              <p className="text-[10px] text-sky-400 mt-0.5">Across Browser & Desktop nodes</p>
            </div>

            <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
              <span className="text-xs text-slate-400 font-semibold">Pending Withdrawals</span>
              <p className="text-3xl font-black text-amber-400 font-mono-numbers mt-1">
                {withdrawalsList.filter(w => w.status === 'pending').length}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">Sealed in Phase 1</p>
            </div>

            <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
              <span className="text-xs text-slate-400 font-semibold">{t.admin.stats.userSplit}</span>
              <p className="text-3xl font-black text-emerald-400 font-mono-numbers mt-1">20%</p>
              <p className="text-[10px] text-slate-400 mt-0.5">Attributable pool shares</p>
            </div>

            <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
              <span className="text-xs text-slate-400 font-semibold">{t.admin.stats.platformSplit}</span>
              <p className="text-3xl font-black text-sky-400 font-mono-numbers mt-1">80%</p>
              <p className="text-[10px] text-slate-400 mt-0.5">Pool ops & infrastructure</p>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Revenue Split Management (Sealed against client forgery) */}
      {activeTab === 'revenue' && (
        <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-6">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Lock className="w-5 h-5 text-amber-400" />
                <span>Financial Engine Lockdown</span>
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Manual client-side creation of confirmed mining revenue is permanently disabled to ensure zero fraudulent balances.
              </p>
            </div>
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-950/60 text-amber-400 border border-amber-500/30">
              Backend Daemon Only
            </span>
          </div>

          <div className="p-5 rounded-2xl bg-slate-950/80 border border-slate-800 text-xs text-slate-300 space-y-3">
            <h4 className="font-bold text-white flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Verifiable Settlement Protocol (Phase 2 Roadmap)</span>
            </h4>
            <p className="leading-relaxed">
              In accordance with strict security architecture, confirmed block revenue can only be credited via the trusted Node.js daemon validating cryptographic RPC blocks directly from the Monero stratum pool.
            </p>
            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-800 text-xs">
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-slate-500 text-[10px] uppercase font-bold">User Attributable Split</span>
                <p className="text-base font-extrabold text-amber-400 font-mono mt-0.5">20.00%</p>
              </div>
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-slate-500 text-[10px] uppercase font-bold">Platform Split</span>
                <p className="text-base font-extrabold text-sky-400 font-mono mt-0.5">80.00%</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Withdrawals Management */}
      {activeTab === 'withdrawals' && (
        <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-white">Cryptocurrency Payout Audit Queue</h3>
              <p className="text-xs text-slate-400">Read-only verification of withdrawal requests; on-chain broadcasting is sealed to backend daemon</p>
            </div>
            <span className="text-xs font-mono text-amber-400 font-bold">
              Pending: {withdrawalsList.filter(w => w.status === 'pending').length}
            </span>
          </div>

          {withdrawalsList.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center border border-dashed border-slate-800 rounded-2xl">
              No withdrawal records currently in queue.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-start text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-500 uppercase text-[10px] tracking-wider text-start">
                    <th className="pb-3 text-start">User ID</th>
                    <th className="pb-3 text-start">Amount</th>
                    <th className="pb-3 text-start">Monero Address</th>
                    <th className="pb-3 text-start">Status</th>
                    <th className="pb-3 text-start">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {withdrawalsList.map((w) => (
                    <tr key={w.id} className="hover:bg-slate-800/30 transition">
                      <td className="py-3 font-mono text-slate-300 text-[11px]">{w.userId?.substring(0, 10)}...</td>
                      <td className="py-3 font-mono font-bold text-white">{w.amount} {w.currency}</td>
                      <td className="py-3 font-mono text-slate-300 max-w-[160px] truncate" title={w.destinationAddress}>
                        {w.destinationAddress}
                      </td>
                      <td className="py-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          w.status === 'completed' ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/30' :
                          w.status === 'rejected' ? 'bg-rose-950 text-rose-400 border border-rose-500/30' :
                          'bg-amber-950 text-amber-400 border border-amber-500/30'
                        }`}>
                          {w.status}
                        </span>
                      </td>
                      <td className="py-3 text-slate-400">{new Date(w.requestedAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab: Hardware Workers */}
      {activeTab === 'workers' && (
        <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-4">
          <h3 className="text-base font-bold text-white">Global Mining Workers Across Users</h3>

          {workersList.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center border border-dashed border-slate-800 rounded-2xl">
              No workers reported online yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-start text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-500 uppercase text-[10px] tracking-wider text-start">
                    <th className="pb-3 text-start">Worker Name</th>
                    <th className="pb-3 text-start">User ID</th>
                    <th className="pb-3 text-start">Platform</th>
                    <th className="pb-3 text-start">Status</th>
                    <th className="pb-3 text-start">Cores</th>
                    <th className="pb-3 text-start">Last Seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {workersList.map((w) => (
                    <tr key={w.id} className="hover:bg-slate-800/30 transition">
                      <td className="py-3 font-bold text-white">{w.name}</td>
                      <td className="py-3 font-mono text-slate-400 text-[11px]">{w.userId?.substring(0, 10)}...</td>
                      <td className="py-3 capitalize text-slate-300">{w.platform}</td>
                      <td className="py-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-950 text-emerald-400 border border-emerald-500/30">
                          {w.status}
                        </span>
                      </td>
                      <td className="py-3 font-mono text-slate-400">{w.cpuCores} Cores</td>
                      <td className="py-3 text-slate-400">{w.lastSeen ? new Date(w.lastSeen).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab: System Settings */}
      {activeTab === 'settings' && (
        <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-6">
          <div>
            <h3 className="text-base font-bold text-white">{t.admin.systemSettingsTitle}</h3>
            <p className="text-xs text-slate-400">Server Configuration Profile (Read-Only client view)</p>
          </div>

          <div className="space-y-4 max-w-xl text-xs">
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
              <span className="text-slate-400">{t.admin.poolHost}</span>
              <p className="font-mono text-white font-bold">{stratumHost}</p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
              <span className="text-slate-400">{t.admin.poolPort}</span>
              <p className="font-mono text-white font-bold">{stratumPort}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                <span className="text-slate-400">{t.admin.userSplitRatio}</span>
                <p className="font-mono text-amber-400 font-bold">{userSplitRatio} (20%)</p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                <span className="text-slate-400">{t.admin.platformSplitRatio}</span>
                <p className="font-mono text-sky-400 font-bold">{platformSplitRatio} (80%)</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Audit Log */}
      {activeTab === 'audit' && (
        <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-4">
          <h3 className="text-base font-bold text-white">{t.admin.tabs.audit}</h3>

          {auditLogs.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center border border-dashed border-slate-800 rounded-2xl">
              No audit logs recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-start text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-500 uppercase text-[10px] tracking-wider text-start">
                    <th className="pb-3 text-start">Action</th>
                    <th className="pb-3 text-start">Actor</th>
                    <th className="pb-3 text-start">Resource</th>
                    <th className="pb-3 text-start">Details</th>
                    <th className="pb-3 text-start">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-800/30 transition">
                      <td className="py-3 font-mono font-bold text-amber-400 text-[11px]">{log.action}</td>
                      <td className="py-3 text-slate-300">{log.actorEmail || log.actorId}</td>
                      <td className="py-3 font-mono text-sky-400">{log.resource}</td>
                      <td className="py-3 text-slate-400 max-w-xs truncate" title={log.details}>{log.details}</td>
                      <td className="py-3 text-slate-500 font-mono text-[11px]">{new Date(log.timestamp).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

    </div>
  );
};
