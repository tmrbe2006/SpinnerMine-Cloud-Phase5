import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { Cpu, Percent, Flame, Layers, Power, CheckCircle, ShieldAlert, X } from 'lucide-react';

interface MiningConsentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConsentGranted?: () => void;
}

export const MiningConsentModal: React.FC<MiningConsentModalProps> = ({ isOpen, onClose, onConsentGranted }) => {
  const { updateMiningConsent, userProfile } = useAuth();
  const { t } = useLanguage();
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleGrantConsent = async () => {
    if (!agreed) return;
    setSubmitting(true);
    try {
      await updateMiningConsent(true);
      if (onConsentGranted) onConsentGranted();
      onClose();
    } catch (err) {
      console.error('Failed to save consent:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-700/80 p-6 md:p-8 shadow-2xl text-slate-100 my-8">
        
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-400">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">{t.consent.title}</h2>
              <p className="text-xs text-sky-400 font-medium">{t.consent.subtitle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 5 Core Consent Pillars */}
        <div className="mt-5 space-y-4 max-h-[55vh] overflow-y-auto pe-2">
          
          {/* Point 1: CPU Utilization */}
          <div className="flex items-start gap-3.5 p-3.5 rounded-xl bg-slate-800/40 border border-slate-700/50">
            <div className="p-2 rounded-lg bg-sky-950 text-sky-400 shrink-0 mt-0.5">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-100">{t.consent.point1Title}</h4>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">{t.consent.point1Desc}</p>
            </div>
          </div>

          {/* Point 2: 20% User / 80% Platform Revenue Split */}
          <div className="flex items-start gap-3.5 p-3.5 rounded-xl bg-amber-950/20 border border-amber-500/30">
            <div className="p-2 rounded-lg bg-amber-950 text-amber-400 shrink-0 mt-0.5">
              <Percent className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold text-amber-300">{t.consent.point2Title}</h4>
                <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  Fixed Ratio
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">{t.consent.point2Desc}</p>
            </div>
          </div>

          {/* Point 3: Power & Device Temperature */}
          <div className="flex items-start gap-3.5 p-3.5 rounded-xl bg-slate-800/40 border border-slate-700/50">
            <div className="p-2 rounded-lg bg-rose-950 text-rose-400 shrink-0 mt-0.5">
              <Flame className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-100">{t.consent.point3Title}</h4>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">{t.consent.point3Desc}</p>
            </div>
          </div>

          {/* Point 4: Background Tab Limitations */}
          <div className="flex items-start gap-3.5 p-3.5 rounded-xl bg-slate-800/40 border border-slate-700/50">
            <div className="p-2 rounded-lg bg-indigo-950 text-indigo-400 shrink-0 mt-0.5">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-100">{t.consent.point4Title}</h4>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">{t.consent.point4Desc}</p>
            </div>
          </div>

          {/* Point 5: Instant Revocation & Control */}
          <div className="flex items-start gap-3.5 p-3.5 rounded-xl bg-slate-800/40 border border-slate-700/50">
            <div className="p-2 rounded-lg bg-emerald-950 text-emerald-400 shrink-0 mt-0.5">
              <Power className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-100">{t.consent.point5Title}</h4>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">{t.consent.point5Desc}</p>
            </div>
          </div>
        </div>

        {/* Existing Status if any */}
        {userProfile?.miningConsent && (
          <div className="mt-4 flex items-center gap-2 p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-500/30 text-emerald-400 text-xs">
            <CheckCircle className="w-4 h-4 shrink-0" />
            <span>
              {t.consent.consentGrantedOn} {userProfile.consentVersion || 'v1.0'} (
              {userProfile.consentTimestamp ? new Date(userProfile.consentTimestamp).toLocaleString() : 'Active'})
            </span>
          </div>
        )}

        {/* Checkbox agreement */}
        <div className="mt-5 pt-4 border-t border-slate-800">
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-1 w-4 h-4 rounded border-slate-600 bg-slate-800 text-sky-500 focus:ring-sky-500 focus:ring-offset-slate-900 cursor-pointer"
            />
            <span className="text-xs text-slate-200 leading-relaxed font-medium">
              {t.consent.acceptCheckbox}
            </span>
          </label>

          <div className="mt-6 flex flex-col sm:flex-row items-center justify-end gap-3">
            <button
              onClick={onClose}
              className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-slate-700 bg-slate-800 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition cursor-pointer"
            >
              {t.consent.declineButton}
            </button>
            <button
              disabled={!agreed || submitting}
              onClick={handleGrantConsent}
              className={`w-full sm:w-auto px-6 py-2.5 rounded-xl text-xs font-bold shadow-lg transition flex items-center justify-center gap-2 cursor-pointer ${
                agreed && !submitting
                  ? 'bg-gradient-to-r from-sky-500 to-blue-600 text-white hover:from-sky-400 hover:to-blue-500 shadow-sky-500/20'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
              }`}
            >
              <CheckCircle className="w-4 h-4" />
              <span>{submitting ? 'Recording Policy v1.0...' : t.consent.grantButton}</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
