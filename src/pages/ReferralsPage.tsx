import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { PhaseBadge } from '../components/common/PhaseBadge';
import { ReferralRecord } from '../types';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import { Users, Copy, CheckCircle2, Gift, Sparkles, ArrowRight, Share2 } from 'lucide-react';

export const ReferralsPage: React.FC = () => {
  const { currentUser, userProfile } = useAuth();
  const { t } = useLanguage();

  const [copied, setCopied] = useState(false);
  const [referrals, setReferrals] = useState<ReferralRecord[]>([]);

  const referralCode = userProfile?.referralCode || 'MINERX';
  const referralUrl = typeof window !== 'undefined' 
    ? `${window.location.origin}?ref=${referralCode}`
    : `https://spinnermine.cloud?ref=${referralCode}`;

  useEffect(() => {
    if (!currentUser) return;
    const q = query(
      collection(db, 'referrals'),
      where('referrerId', '==', currentUser.uid)
    );
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ReferralRecord));
        setReferrals(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'referrals');
      }
    );
    return () => unsub();
  }, [currentUser]);

  const handleCopy = () => {
    navigator.clipboard.writeText(referralUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      
      {/* Header */}
      <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/80 border border-slate-800 shadow-xl space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">{t.referrals.title}</h1>
          <PhaseBadge phase={1} text="+5% Bonus Active" />
        </div>
        <p className="text-xs sm:text-sm text-slate-400">{t.referrals.subtitle}</p>
      </div>

      {/* Share Box & Referral Code */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Link Generator Box */}
        <div className="md:col-span-2 p-6 sm:p-8 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">{t.referrals.yourLink}</h3>

          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-sky-400 truncate select-all">
              {referralUrl}
            </div>

            <button
              onClick={handleCopy}
              className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-bold text-xs shadow-lg shadow-sky-500/20 flex items-center justify-center gap-2 shrink-0 cursor-pointer transition"
            >
              {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? t.referrals.copied : t.referrals.copy}</span>
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>{t.referrals.yourCode}:</span>
            <span className="font-mono text-amber-400 font-extrabold bg-amber-950/60 px-2 py-0.5 rounded border border-amber-500/30">
              {referralCode}
            </span>
          </div>
        </div>

        {/* Stats Card */}
        <div className="p-6 rounded-3xl bg-slate-900/60 border border-slate-800 flex flex-col justify-between space-y-4">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase">{t.referrals.totalReferred}</span>
            <p className="text-3xl font-black text-white font-mono-numbers mt-1">{referrals.length}</p>
          </div>

          <div className="pt-4 border-t border-slate-800">
            <span className="text-xs font-semibold text-slate-400 uppercase">{t.referrals.commissionEarned}</span>
            <p className="text-xl font-bold text-amber-400 font-mono-numbers mt-0.5">0.000000 XMR</p>
            <p className="text-[10px] text-slate-500 mt-1">5% pool attribution (Phase 1 Baseline)</p>
          </div>
        </div>

      </div>

      {/* 3 Step Explainer */}
      <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/40 border border-slate-800 space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Gift className="w-4 h-4 text-amber-400" />
          <span>{t.referrals.howItWorks}</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-300">
          <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800/80">
            <p className="font-semibold text-sky-300">{t.referrals.step1}</p>
          </div>
          <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800/80">
            <p className="font-semibold text-amber-300">{t.referrals.step2}</p>
          </div>
          <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800/80">
            <p className="font-semibold text-emerald-300">{t.referrals.step3}</p>
          </div>
        </div>
      </div>

      {/* Directory Table */}
      <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-4">
        <h3 className="text-base font-bold text-white">{t.referrals.referralListTitle}</h3>

        {referrals.length === 0 ? (
          <p className="text-xs text-slate-400 py-8 text-center border border-dashed border-slate-800 rounded-2xl">
            {t.referrals.empty}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-500 uppercase text-[10px] tracking-wider text-start">
                  <th className="pb-3 text-start">Invited Miner ID</th>
                  <th className="pb-3 text-start">Code Used</th>
                  <th className="pb-3 text-start">Bonus Attributed</th>
                  <th className="pb-3 text-start">Joined Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {referrals.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-800/30 transition">
                    <td className="py-3 font-mono text-slate-300">{r.referredUserId.substring(0, 12)}...</td>
                    <td className="py-3 font-mono text-amber-400 font-bold">{r.referralCode}</td>
                    <td className="py-3 font-mono text-white font-bold">{r.bonusEarned || 0} XMR</td>
                    <td className="py-3 text-slate-400">{new Date(r.createdAt).toLocaleDateString()}</td>
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
