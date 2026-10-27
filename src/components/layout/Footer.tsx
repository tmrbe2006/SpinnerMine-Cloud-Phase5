import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { ShieldCheck, Cpu, Percent, Lock } from 'lucide-react';

export const Footer: React.FC = () => {
  const { t } = useLanguage();

  return (
    <footer className="border-t border-slate-900 bg-slate-950/90 text-slate-400 text-xs py-10 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        
        {/* Top Split & Integrity Disclosures */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-6 rounded-2xl bg-slate-900/40 border border-slate-800/80">
          
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shrink-0">
              <Percent className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-200">Verifiable 20% / 80% Split</h4>
              <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                20% attributable confirmed revenue awarded to the user miner. 80% retained for pool nodes, security, and infrastructure.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400 shrink-0">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-200">Zero Simulated Fake Earnings</h4>
              <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                Phase 1 strictly establishes real cryptographic ledgers and security rules. No misleading counters or fake numbers.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-200">User-Controlled CPU Policy</h4>
              <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                Mining is 100% voluntary with explicit policy v1.0 consent. Throttling and pause buttons give you absolute control.
              </p>
            </div>
          </div>

        </div>

        {/* Bottom Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-900 text-[11px] text-slate-500">
          <div className="flex items-center gap-2">
            <img src="./icon.svg" alt="SpinnerMine" className="w-4 h-4 object-contain" />
            <span>SpinnerMine Cloud &copy; {new Date().getFullYear()} — Monero Cloud Mining & Interactive Gaming Platform.</span>
          </div>

          <div className="flex items-center gap-4">
            <span>RandomX Architecture</span>
            <span>&bull;</span>
            <span>Firestore Enterprise RBAC</span>
            <span>&bull;</span>
            <span>WebAssembly Ready</span>
          </div>
        </div>

      </div>
    </footer>
  );
};
