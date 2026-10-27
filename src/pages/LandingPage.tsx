import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { AppPage } from '../types';
import { PhaseBadge } from '../components/common/PhaseBadge';
import { 
  Cpu, 
  Percent, 
  Gamepad2, 
  ShieldCheck, 
  Zap, 
  ArrowRight, 
  CheckCircle2, 
  Sparkles, 
  Layers, 
  Sliders, 
  Laptop, 
  Compass,
  Coins
} from 'lucide-react';

interface LandingPageProps {
  setCurrentPage: (page: AppPage) => void;
  onOpenConsentModal: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ setCurrentPage, onOpenConsentModal }) => {
  const { currentUser, userProfile } = useAuth();
  const { t } = useLanguage();

  return (
    <div className="space-y-24 py-8 md:py-16">
      
      {/* Hero Section */}
      <section className="relative max-w-5xl mx-auto px-4 sm:px-6 text-center space-y-8">
        
        {/* Glow backdrop */}
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-96 h-96 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-20 left-1/3 -translate-x-1/2 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900/90 border border-slate-700/80 shadow-lg text-xs font-semibold text-slate-300">
          <PhaseBadge phase={1} text={t.phase1Badge} />
          <span className="text-slate-500">&bull;</span>
          <span className="text-amber-400 font-bold flex items-center gap-1">
            <Percent className="w-3.5 h-3.5" /> 20% Attributable User Split
          </span>
        </div>

        <h1 className="text-3xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-white leading-tight">
          {t.landing.heroTitle}
        </h1>

        <p className="max-w-3xl mx-auto text-sm sm:text-base md:text-lg text-slate-400 leading-relaxed font-normal">
          {t.landing.heroSub}
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
          <button
            onClick={() => setCurrentPage(currentUser ? 'dashboard' : 'register')}
            className="w-full sm:w-auto px-8 py-3.5 rounded-2xl bg-gradient-to-r from-sky-500 via-blue-600 to-sky-600 hover:from-sky-400 hover:to-blue-500 text-white font-bold text-sm shadow-xl shadow-sky-500/25 flex items-center justify-center gap-2.5 transition transform hover:-translate-y-0.5 cursor-pointer"
          >
            <span>{t.landing.launchDashboard}</span>
            <ArrowRight className="w-4 h-4 rtl:rotate-180" />
          </button>

          <button
            onClick={() => {
              if (currentUser) {
                setCurrentPage('mining');
              } else {
                setCurrentPage('login');
              }
            }}
            className="w-full sm:w-auto px-7 py-3.5 rounded-2xl border border-slate-800 bg-slate-900/80 hover:bg-slate-800 text-slate-200 font-semibold text-sm transition flex items-center justify-center gap-2 cursor-pointer"
          >
            <Cpu className="w-4 h-4 text-sky-400" />
            <span>{t.landing.viewMining}</span>
          </button>
        </div>

        {/* Live Metrics Showcase Teaser */}
        <div className="pt-12 grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto text-start">
          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-sm">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Algorithm</p>
            <p className="text-base font-extrabold text-white mt-1">RandomX</p>
            <p className="text-[10px] text-sky-400 mt-0.5">CPU-Optimized (XMR)</p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-sm">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Miner Share</p>
            <p className="text-base font-extrabold text-amber-400 mt-1">20% Net Confirmed</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Pool Attributable</p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-sm">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Platform Share</p>
            <p className="text-base font-extrabold text-sky-400 mt-1">80% Infrastructure</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Pool Nodes & Gas</p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-sm">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Engine Security</p>
            <p className="text-base font-extrabold text-emerald-400 mt-1">Zero-Trust RBAC</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Immutable Ledger</p>
          </div>
        </div>

      </section>

      {/* Revenue Split Transparency Section */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center max-w-3xl mx-auto space-y-3 mb-12">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white">
            {t.landing.splitTitle}
          </h2>
          <p className="text-xs sm:text-sm text-slate-400">
            SpinnerMine Cloud operates under an open and verifiable financial policy. Every accepted share is counted and matched against pool block payouts.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* User 20% Card */}
          <div className="relative p-8 rounded-3xl bg-gradient-to-b from-amber-950/30 to-slate-900/80 border border-amber-500/40 shadow-xl overflow-hidden group">
            <div className="absolute top-0 end-0 w-32 h-32 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />
            <div className="flex items-center justify-between mb-4">
              <span className="text-4xl sm:text-5xl font-black text-amber-400 tracking-tight">20%</span>
              <div className="p-3 rounded-2xl bg-amber-500/20 text-amber-300 border border-amber-500/30">
                <Coins className="w-6 h-6" />
              </div>
            </div>
            <h3 className="text-lg font-bold text-white mb-2">{t.landing.splitUser}</h3>
            <p className="text-xs text-slate-300 leading-relaxed">{t.landing.splitUserDesc}</p>
            <ul className="mt-6 space-y-2 text-xs text-slate-400">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Zero hidden pool deduction fees</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Real cryptographic Monero blockchain payout</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Direct payout to personal wallet address</span>
              </li>
            </ul>
          </div>

          {/* Platform 80% Card */}
          <div className="relative p-8 rounded-3xl bg-gradient-to-b from-sky-950/30 to-slate-900/80 border border-sky-500/40 shadow-xl overflow-hidden group">
            <div className="absolute top-0 end-0 w-32 h-32 bg-sky-500/10 rounded-full blur-2xl pointer-events-none" />
            <div className="flex items-center justify-between mb-4">
              <span className="text-4xl sm:text-5xl font-black text-sky-400 tracking-tight">80%</span>
              <div className="p-3 rounded-2xl bg-sky-500/20 text-sky-300 border border-sky-500/30">
                <Layers className="w-6 h-6" />
              </div>
            </div>
            <h3 className="text-lg font-bold text-white mb-2">{t.landing.splitPlatform}</h3>
            <p className="text-xs text-slate-300 leading-relaxed">{t.landing.splitPlatformDesc}</p>
            <ul className="mt-6 space-y-2 text-xs text-slate-400">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0" />
                <span>Stratum pool server maintenance & bandwidth</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0" />
                <span>Daily Wheel of Fortune and Spinner game reward reserve</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0" />
                <span>5% Referral commission funding</span>
              </li>
            </ul>
          </div>

        </div>
      </section>

      {/* Platform Features Grid */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center max-w-3xl mx-auto space-y-3 mb-12">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white">
            {t.landing.featuresTitle}
          </h2>
          <p className="text-xs sm:text-sm text-slate-400">
            A cohesive architecture combining high-efficiency CPU computing with interactive casual gameplay.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          
          <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 hover:border-sky-500/40 transition">
            <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-400 flex items-center justify-center mb-4">
              <Cpu className="w-5 h-5" />
            </div>
            <h4 className="text-sm font-bold text-white mb-2">{t.landing.f1Title}</h4>
            <p className="text-xs text-slate-400 leading-relaxed">{t.landing.f1Desc}</p>
          </div>

          <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 hover:border-sky-500/40 transition">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400 flex items-center justify-center mb-4">
              <Laptop className="w-5 h-5" />
            </div>
            <h4 className="text-sm font-bold text-white mb-2">{t.landing.f2Title}</h4>
            <p className="text-xs text-slate-400 leading-relaxed">{t.landing.f2Desc}</p>
          </div>

          <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 hover:border-amber-500/40 transition">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center mb-4">
              <Gamepad2 className="w-5 h-5" />
            </div>
            <h4 className="text-sm font-bold text-white mb-2">{t.landing.f3Title}</h4>
            <p className="text-xs text-slate-400 leading-relaxed">{t.landing.f3Desc}</p>
          </div>

          <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 hover:border-emerald-500/40 transition">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mb-4">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h4 className="text-sm font-bold text-white mb-2">{t.landing.f4Title}</h4>
            <p className="text-xs text-slate-400 leading-relaxed">{t.landing.f4Desc}</p>
          </div>

        </div>
      </section>

      {/* Roadmap Comparison */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="p-8 sm:p-10 rounded-3xl bg-slate-900/70 border border-slate-800 space-y-8">
          <div className="text-center space-y-2">
            <h3 className="text-xl sm:text-2xl font-bold text-white">{t.landing.roadmapTitle}</h3>
            <p className="text-xs text-slate-400">Clear phase boundaries ensure stability, security, and honest progress.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-6 rounded-2xl bg-sky-950/20 border border-sky-500/30">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-sky-300">{t.landing.phase1Title}</h4>
                <PhaseBadge phase={1} text="Active" />
              </div>
              <p className="text-xs text-slate-300 leading-relaxed mb-4">{t.landing.phase1Desc}</p>
              <ul className="space-y-1.5 text-[11px] text-slate-400">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-sky-400" /> Firebase Auth & Firestore Schemas
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-sky-400" /> English & Arabic RTL/LTR Engine
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-sky-400" /> Progressive Web App (PWA) Offline Shell
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-sky-400" /> Explicit Policy v1.0 Consent Engine
                </li>
              </ul>
            </div>

            <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-700/60">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-amber-300">{t.landing.phase2Title}</h4>
                <PhaseBadge phase={2} text="Roadmap" />
              </div>
              <p className="text-xs text-slate-300 leading-relaxed mb-4">{t.landing.phase2Desc}</p>
              <ul className="space-y-1.5 text-[11px] text-slate-400">
                <li className="flex items-center gap-2">
                  <Sliders className="w-3.5 h-3.5 text-amber-400" /> Real WebAssembly RandomX CPU Worker
                </li>
                <li className="flex items-center gap-2">
                  <Sliders className="w-3.5 h-3.5 text-amber-400" /> Live Stratum Monero Pool WebSockets
                </li>
                <li className="flex items-center gap-2">
                  <Sliders className="w-3.5 h-3.5 text-amber-400" /> Native Windows XMRig Client Installer
                </li>
                <li className="flex items-center gap-2">
                  <Sliders className="w-3.5 h-3.5 text-amber-400" /> Monero Blockchain Payout Automation
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Final Call to Action */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
        <div className="p-8 sm:p-12 rounded-3xl bg-gradient-to-r from-sky-950/60 via-slate-900 to-amber-950/30 border border-slate-800 shadow-2xl space-y-6">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white">
            {t.landing.ctaTitle}
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 max-w-xl mx-auto">
            {t.landing.ctaSub}
          </p>
          <button
            onClick={() => setCurrentPage(currentUser ? 'dashboard' : 'register')}
            className="px-8 py-3.5 rounded-2xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-bold text-sm shadow-xl shadow-sky-500/25 inline-flex items-center gap-2 transition cursor-pointer"
          >
            <span>{t.nav.register}</span>
            <ArrowRight className="w-4 h-4 rtl:rotate-180" />
          </button>
        </div>
      </section>

    </div>
  );
};
