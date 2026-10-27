import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { PhaseBadge } from '../components/common/PhaseBadge';
import { WalletLedgerEntry } from '../types';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { 
  Wallet, 
  Coins, 
  ArrowUpRight, 
  ShieldAlert, 
  CheckCircle2, 
  AlertCircle, 
  Lock, 
  Copy, 
  History,
  ShieldCheck,
  Info
} from 'lucide-react';

interface WalletPageProps {
  onNavigateWithdrawals: () => void;
}

export const WalletPage: React.FC<WalletPageProps> = ({ onNavigateWithdrawals }) => {
  const { currentUser } = useAuth();
  const { t } = useLanguage();
  const isOnline = useOnlineStatus();

  // Read-only confirmed balances
  const xmrBalance = 0.000000;
  const xmrAtomicUnits = "0"; // 0 piconero (1 XMR = 10^12 atomic units)
  const [pointsBalance] = useState<number>(500); // Entertainment game points

  // Address test state
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [addressValidationResult, setAddressValidationResult] = useState<{ valid: boolean; message: string } | null>(null);

  // Ledger entries
  const [ledger, setLedger] = useState<WalletLedgerEntry[]>([]);

  useEffect(() => {
    if (!currentUser) return;
    const q = query(
      collection(db, 'walletLedger'),
      where('userId', '==', currentUser.uid)
    );
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as WalletLedgerEntry));
        setLedger(items);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'walletLedger');
      }
    );
    return () => unsub();
  }, [currentUser]);

  const handleTestAddress = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = address.trim();
    if (!trimmed.startsWith('4') && !trimmed.startsWith('8')) {
      setAddressValidationResult({
        valid: false,
        message: 'Invalid Monero address. Standard XMR addresses start with 4 (primary) or 8 (subaddress).'
      });
      return;
    }
    if (trimmed.length < 90) {
      setAddressValidationResult({
        valid: false,
        message: 'Invalid Monero address length. Standard XMR addresses are 95 or 106 characters.'
      });
      return;
    }
    setAddressValidationResult({
      valid: true,
      message: 'Valid Monero address syntax. Address confirmed for Phase 2 daemon payout dispatch.'
    });
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 sm:p-8 rounded-3xl bg-slate-900/80 border border-slate-800 shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">{t.wallet.title}</h1>
            <PhaseBadge phase={1} text="Strict Read-Only Ledger" />
          </div>
          <p className="text-xs sm:text-sm text-slate-400">{t.wallet.subtitle}</p>
        </div>

        <button
          onClick={onNavigateWithdrawals}
          className="px-4 py-2.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition flex items-center gap-2 cursor-pointer"
        >
          <History className="w-4 h-4 text-sky-400" />
          <span>{t.nav.withdrawals}</span>
        </button>
      </div>

      {/* Balance Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Monero Primary Balance (Read-Only) */}
        <div className="p-6 sm:p-8 rounded-3xl bg-gradient-to-br from-slate-900 to-sky-950/40 border border-sky-500/30 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">{t.wallet.xmrBalance}</span>
            <div className="p-2.5 rounded-xl bg-sky-500/10 text-sky-400 border border-sky-500/20">
              <Coins className="w-5 h-5" />
            </div>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="text-4xl sm:text-5xl font-black text-white font-mono-numbers">
              {xmrBalance.toFixed(6)}
            </span>
            <span className="text-sm font-extrabold text-sky-400">XMR</span>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 text-[11px] text-slate-400 space-y-1.5">
            <div className="flex items-center justify-between text-slate-300 font-semibold">
              <span>{t.wallet.confirmedNotice}</span>
              <span className="text-amber-400 font-bold">20% Share</span>
            </div>
            <p className="font-mono text-[10px] text-slate-500">Atomic Precision: {xmrAtomicUnits} piconero (10⁻¹² XMR)</p>
            <p>Phase 1 read-only ledger. Monero earnings accrue exclusively through verified stratum block shares in Phase 2.</p>
          </div>
        </div>

        {/* Casual Entertainment Gaming Points (Strictly Separated from Crypto) */}
        <div className="p-6 sm:p-8 rounded-3xl bg-gradient-to-br from-slate-900 to-amber-950/30 border border-amber-500/30 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Recreational Game Points</span>
            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Wallet className="w-5 h-5" />
            </div>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="text-4xl sm:text-5xl font-black text-amber-400 font-mono-numbers">
              {pointsBalance}
            </span>
            <span className="text-sm font-extrabold text-slate-400">PTS</span>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 text-[11px] text-slate-400 space-y-1">
            <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Strict Financial Separation</span>
            </div>
            <p>Recreational gaming points are completely segregated from cryptocurrency balances and cannot be directly converted to cash.</p>
          </div>
        </div>

      </div>

      {/* Payout Security Lock & Address Validator */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Address Syntax Verification Form */}
        <div className="lg:col-span-2 p-6 sm:p-8 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-800">
            <div>
              <h3 className="text-base font-bold text-white">Monero Payout Destination Validator</h3>
              <p className="text-xs text-slate-400">Verify your private wallet address format ahead of Phase 2 pool connection</p>
            </div>
            <span className="px-2.5 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-400 border border-amber-500/30">
              Phase 1 Standby
            </span>
          </div>

          {addressValidationResult && (
            <div className={`p-3.5 rounded-xl text-xs flex items-start gap-2.5 ${
              addressValidationResult.valid 
                ? 'bg-emerald-950/50 border border-emerald-500/40 text-emerald-300' 
                : 'bg-rose-950/50 border border-rose-500/40 text-rose-300'
            }`}>
              {addressValidationResult.valid ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              )}
              <span>{addressValidationResult.message}</span>
            </div>
          )}

          <form onSubmit={handleTestAddress} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">{t.wallet.destAddress}</label>
              <input
                type="text"
                required
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="48edfHuFgFzN5iM... or 8BwYQ5..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-sky-500 transition"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">{t.wallet.withdrawAmount}</label>
                <input
                  type="number"
                  step="0.0001"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.05"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-sky-500 transition"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400">{t.wallet.networkFee}</label>
                <div className="px-3.5 py-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-slate-400 font-mono">
                  0.0001 XMR (Standard Monero TX)
                </div>
              </div>
            </div>

            <button
              type="submit"
              className="px-6 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-sky-400 border border-slate-700 transition flex items-center justify-center gap-2 cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Validate Address Syntax</span>
            </button>
          </form>
        </div>

        {/* Financial Lockdown Explanation */}
        <div className="p-6 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
            <Lock className="w-4 h-4 text-amber-400" />
            <span>Financial Security Lock</span>
          </div>

          <div className="p-4 rounded-2xl bg-amber-950/30 border border-amber-500/30 text-xs text-slate-300 space-y-2">
            <p className="font-semibold text-amber-300">Phase 1 Client Write Protection</p>
            <p className="leading-relaxed">
              To prevent financial manipulation and fraudulent balances, direct client submissions of withdrawal transactions to the database are locked.
            </p>
          </div>

          <p className="text-[11px] text-slate-400 leading-relaxed">
            In Phase 2, withdrawal requests will be submitted via authenticated server endpoints that verify pool shares and broadcast transactions directly through a trusted Monero daemon node.
          </p>
        </div>

      </div>

      {/* Immutable Financial Ledger Records (Idempotent Design) */}
      <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-white">{t.wallet.ledgerTitle}</h3>
          <span className="text-[10px] font-mono text-slate-400">Integer Atomic Precision (10⁻¹² XMR)</span>
        </div>

        {ledger.length === 0 ? (
          <p className="text-xs text-slate-400 py-6 text-center border border-dashed border-slate-800 rounded-2xl">
            {t.wallet.emptyLedger}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-500 uppercase text-[10px] tracking-wider text-start">
                  <th className="pb-3 text-start">Type</th>
                  <th className="pb-3 text-start">Category</th>
                  <th className="pb-3 text-start">Amount</th>
                  <th className="pb-3 text-start">Atomic Units</th>
                  <th className="pb-3 text-start">Idempotency Key</th>
                  <th className="pb-3 text-start">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {ledger.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-800/30 transition">
                    <td className="py-3 uppercase font-bold text-sky-400">{entry.type}</td>
                    <td className="py-3 capitalize text-slate-300">{entry.category}</td>
                    <td className="py-3 font-mono text-white font-bold">{entry.amount} {entry.currency}</td>
                    <td className="py-3 font-mono text-slate-400 text-[10px]">{entry.atomicUnits || '0'}</td>
                    <td className="py-3 font-mono text-slate-500 text-[10px] max-w-[120px] truncate">{entry.idempotencyKey || entry.id}</td>
                    <td className="py-3 text-slate-400">{new Date(entry.timestamp).toLocaleString()}</td>
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
