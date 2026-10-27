import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { Language } from '../types';
import { 
  User, 
  Languages, 
  ShieldAlert, 
  Lock, 
  CheckCircle2, 
  AlertCircle, 
  Mail, 
  PowerOff,
  Cpu
} from 'lucide-react';

interface AccountSettingsPageProps {
  onOpenConsentModal: () => void;
}

import { formatAuthError } from '../utils/auth-errors';

export const AccountSettingsPage: React.FC<AccountSettingsPageProps> = ({ onOpenConsentModal }) => {
  const { currentUser, userProfile, updateMiningConsent, resetPassword, updateUserLanguage } = useAuth();
  const { language, setLanguage, t } = useLanguage();

  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const handleLanguageChange = async (newLang: Language) => {
    setLanguage(newLang);
    if (currentUser) {
      await updateUserLanguage(newLang);
    }
  };

  const handlePasswordReset = async () => {
    if (!currentUser?.email) return;
    setResetError(null);
    try {
      await resetPassword(currentUser.email);
      setResetSent(true);
      setTimeout(() => setResetSent(false), 5000);
    } catch (err: any) {
      const formatted = formatAuthError(err, language);
      setResetError(formatted.message);
    }
  };

  const handleRevokeConsent = async () => {
    if (confirm('Are you sure you want to revoke your CPU mining consent? Real mining will remain disabled.')) {
      await updateMiningConsent(false);
    }
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      
      {/* Header */}
      <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/80 border border-slate-800 shadow-xl space-y-1">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">{t.settings.title}</h1>
        <p className="text-xs sm:text-sm text-slate-400">{t.settings.subtitle}</p>
      </div>

      <div className="space-y-6">
        
        {/* Profile Card */}
        <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-4">
          <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-400 border border-sky-500/20">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">{t.settings.profileCard}</h3>
              <p className="text-xs text-slate-400">Authenticated Miner Identity</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
              <span className="text-[10px] text-slate-500 uppercase font-semibold">Miner Handle</span>
              <p className="font-bold text-white mt-1">{userProfile?.displayName || 'Miner'}</p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
              <span className="text-[10px] text-slate-500 uppercase font-semibold">Registered Email</span>
              <p className="font-bold text-slate-300 mt-1">{currentUser?.email}</p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
              <span className="text-[10px] text-slate-500 uppercase font-semibold">Role & Access Tier</span>
              <p className="font-bold text-amber-400 uppercase mt-1">{userProfile?.role || 'user'}</p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
              <span className="text-[10px] text-slate-500 uppercase font-semibold">Account UID</span>
              <p className="font-mono text-[11px] text-slate-400 truncate mt-1">{currentUser?.uid}</p>
            </div>
          </div>
        </div>

        {/* Language Preferences Card */}
        <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-4">
          <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Languages className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">{t.settings.languageCard}</h3>
              <p className="text-xs text-slate-400">Switch application display language and text direction</p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-4">
            <button
              onClick={() => handleLanguageChange('en')}
              className={`w-full sm:w-auto px-6 py-3 rounded-2xl text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer ${
                language === 'en'
                  ? 'bg-sky-500/20 border-2 border-sky-400 text-sky-300 shadow-md shadow-sky-500/20'
                  : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <span>English (LTR)</span>
              {language === 'en' && <CheckCircle2 className="w-4 h-4 text-sky-400" />}
            </button>

            <button
              onClick={() => handleLanguageChange('ar')}
              className={`w-full sm:w-auto px-6 py-3 rounded-2xl text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer ${
                language === 'ar'
                  ? 'bg-sky-500/20 border-2 border-sky-400 text-sky-300 shadow-md shadow-sky-500/20'
                  : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <span>العربية (RTL)</span>
              {language === 'ar' && <CheckCircle2 className="w-4 h-4 text-sky-400" />}
            </button>
          </div>
        </div>

        {/* Mining Consent Policy Manager */}
        <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-4">
          <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">{t.settings.consentCard}</h3>
              <p className="text-xs text-slate-400">Manage hardware CPU utilization and 20%/80% revenue split consent</p>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${userProfile?.miningConsent ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                <span className="font-bold text-white">
                  {userProfile?.miningConsent ? t.consent.statusGranted : t.consent.statusMissing}
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                  Version {userProfile?.consentVersion || 'v1.0'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                {userProfile?.consentTimestamp 
                  ? `Consent recorded on ${new Date(userProfile.consentTimestamp).toLocaleString()}`
                  : 'No active agreement on file. Real mining requires voluntary consent.'}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {userProfile?.miningConsent ? (
                <button
                  onClick={handleRevokeConsent}
                  className="px-4 py-2 rounded-xl border border-rose-500/40 bg-rose-950/30 hover:bg-rose-950/60 text-rose-300 text-xs font-semibold transition cursor-pointer flex items-center gap-1.5"
                >
                  <PowerOff className="w-3.5 h-3.5" />
                  <span>{t.consent.revokeConsent}</span>
                </button>
              ) : (
                <button
                  onClick={onOpenConsentModal}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white text-xs font-bold shadow-md shadow-sky-500/20 transition cursor-pointer"
                >
                  {t.consent.grantButton}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Security & Password */}
        <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-4">
          <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">{t.settings.securityCard}</h3>
              <p className="text-xs text-slate-400">Account credential safety and recovery</p>
            </div>
          </div>

          {resetSent && (
            <div className="p-3.5 rounded-xl bg-emerald-950/50 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>{t.auth.resetSuccess}</span>
            </div>
          )}

          {resetError && (
            <div className="p-3.5 rounded-xl bg-rose-950/50 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400" />
              <span>{resetError}</span>
            </div>
          )}

          <div>
            <button
              onClick={handlePasswordReset}
              className="px-5 py-2.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition cursor-pointer"
            >
              {t.settings.changePassword}
            </button>
          </div>
        </div>

      </div>

    </div>
  );
};
