import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { WithdrawalRecord } from '../types';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import { History, ExternalLink, Clock, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';

export const WithdrawalsPage: React.FC = () => {
  const { currentUser } = useAuth();
  const { t } = useLanguage();

  const [withdrawals, setWithdrawals] = useState<WithdrawalRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) return;
    const q = query(
      collection(db, 'withdrawals'),
      where('userId', '==', currentUser.uid)
    );
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as WithdrawalRecord));
        // Sort in memory by date descending
        list.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
        setWithdrawals(list);
        setLoading(false);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'withdrawals');
        setLoading(false);
      }
    );
    return () => unsub();
  }, [currentUser]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[10px] font-bold bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="w-3 h-3" /> Completed
          </span>
        );
      case 'processing':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[10px] font-bold bg-sky-950/60 text-sky-400 border border-sky-500/30">
            <Clock className="w-3 h-3 animate-spin" /> Processing
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[10px] font-bold bg-rose-950/60 text-rose-400 border border-rose-500/30">
            <XCircle className="w-3 h-3" /> Rejected
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[10px] font-bold bg-amber-950/60 text-amber-400 border border-amber-500/30">
            <Clock className="w-3 h-3" /> Pending Review
          </span>
        );
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      
      {/* Header */}
      <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/80 border border-slate-800 shadow-xl space-y-1">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">{t.withdrawals.title}</h1>
        <p className="text-xs sm:text-sm text-slate-400">{t.withdrawals.subtitle}</p>
      </div>

      {/* Withdrawals Table */}
      <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-4">
        {withdrawals.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-slate-800 rounded-2xl space-y-2">
            <History className="w-8 h-8 text-slate-600 mx-auto" />
            <p className="text-xs text-slate-400">{t.withdrawals.empty}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-500 uppercase text-[10px] tracking-wider text-start">
                  <th className="pb-3 text-start">{t.withdrawals.id}</th>
                  <th className="pb-3 text-start">{t.withdrawals.amount}</th>
                  <th className="pb-3 text-start">{t.withdrawals.address}</th>
                  <th className="pb-3 text-start">{t.withdrawals.status}</th>
                  <th className="pb-3 text-start">{t.withdrawals.date}</th>
                  <th className="pb-3 text-start">{t.withdrawals.txHash}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {withdrawals.map((w) => (
                  <tr key={w.id} className="hover:bg-slate-800/30 transition">
                    <td className="py-3 font-mono text-slate-400 text-[11px]">{w.id.substring(0, 10)}...</td>
                    <td className="py-3 font-mono font-bold text-white">{w.amount} {w.currency}</td>
                    <td className="py-3 font-mono text-slate-300 max-w-[180px] truncate" title={w.destinationAddress}>
                      {w.destinationAddress}
                    </td>
                    <td className="py-3">{getStatusBadge(w.status)}</td>
                    <td className="py-3 text-slate-400">{new Date(w.requestedAt).toLocaleDateString()}</td>
                    <td className="py-3">
                      {w.txHash ? (
                        <a
                          href={`https://xmrchain.net/tx/${w.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 font-mono text-[11px]"
                        >
                          <span>{w.txHash.substring(0, 8)}...</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-slate-600 font-mono">-</span>
                      )}
                      {w.rejectionReason && (
                        <p className="text-[10px] text-rose-400 mt-0.5">Reason: {w.rejectionReason}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
};
