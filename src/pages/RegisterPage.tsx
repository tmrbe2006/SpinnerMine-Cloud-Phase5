import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { AppPage } from '../types';
import { Mail, Lock, User, Tag, AlertCircle, ArrowRight, ExternalLink } from 'lucide-react';
import { formatAuthError, FormattedAuthError } from '../utils/auth-errors';

interface RegisterPageProps {
  setCurrentPage: (page: AppPage) => void;
}

export const RegisterPage: React.FC<RegisterPageProps> = ({ setCurrentPage }) => {
  const { registerWithEmail, loginWithGoogle } = useAuth();
  const { t, language } = useLanguage();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [formattedError, setFormattedError] = useState<FormattedAuthError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Auto-detect ?ref= URL param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref) {
      setReferralCode(ref.toUpperCase());
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password) {
      setFormattedError({
        code: 'validation/missing-fields',
        title: language === 'ar' ? 'حقول ناقصة' : 'Missing Fields',
        message: language === 'ar' ? 'يرجى إكمال جميع الحقول المطلوبة للمتابعة.' : 'Please complete all required fields.'
      });
      return;
    }
    if (password.length < 6) {
      setFormattedError({
        code: 'auth/weak-password',
        title: language === 'ar' ? 'كلمة المرور قصيرة' : 'Weak Password',
        message: language === 'ar' ? 'يجب أن تتكون كلمة المرور من 6 أحرف على الأقل.' : 'Password must be at least 6 characters long.'
      });
      return;
    }
    if (password !== confirmPassword) {
      setFormattedError({
        code: 'validation/password-mismatch',
        title: language === 'ar' ? 'عدم تطابق كلمة المرور' : 'Password Mismatch',
        message: language === 'ar' ? 'كلمتا المرور غير متطابقتين. يرجى إعادة التحقق.' : 'Passwords do not match.'
      });
      return;
    }

    setFormattedError(null);
    setSubmitting(true);
    try {
      await registerWithEmail(email, password, name.trim(), referralCode.trim() || undefined);
      setCurrentPage('dashboard');
    } catch (err: any) {
      console.error('Registration error:', err);
      const parsed = formatAuthError(err, language);
      setFormattedError(parsed);
    } finally {
      setSubmitting(false);
    }
  };

  const isElectron = typeof window !== 'undefined' && (
    Boolean((window as any).electronAPI || (window as any).electronMiningAPI) ||
    window.location.protocol === 'file:'
  );

  const handleGoogleSignIn = async () => {
    if (isElectron) {
      setFormattedError({
        code: 'auth/unauthorized-domain',
        title: language === 'ar' ? 'المصادقة الأصلية لتطبيق Windows' : 'Desktop Native Authentication',
        message: language === 'ar'
          ? 'في تطبيق سطح المكتب Windows، يُرجى إنشاء الحساب مباشرة باستخدام النموذج أدناه. تدفق Google OAuth مخصص لمتصفحات الويب ولا يقبل بروتوكول ملفات سطح المكتب (file://).'
          : 'In the Windows desktop application, please create your account directly with the form below. Google OAuth is designed for web browsers and does not permit desktop local file protocols (file://).',
        actionUrl: 'https://spinnermine-cloud-production.web.app',
        actionLabel: language === 'ar' ? 'فتح بوابة الويب' : 'Open Web Portal',
        suggestGoogleSignIn: false
      });
      return;
    }
    setFormattedError(null);
    setSubmitting(true);
    try {
      await loginWithGoogle();
      setCurrentPage('dashboard');
    } catch (err: any) {
      console.error('Google sign in error:', err);
      setFormattedError(formatAuthError(err, language));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[85vh] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md p-8 rounded-3xl bg-slate-900/90 border border-slate-800 shadow-2xl space-y-6">
        
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-gradient-to-tr from-sky-500 to-blue-600 p-[1.5px] shadow-lg shadow-sky-500/20">
            <div className="w-full h-full bg-slate-950 rounded-[14px] flex items-center justify-center">
              <img src="./icon.svg" alt="SpinnerMine" className="w-8 h-8 object-contain" />
            </div>
          </div>
          <h2 className="text-2xl font-black text-white tracking-tight">{t.auth.signUpTitle}</h2>
          <p className="text-xs text-slate-400">{t.auth.signUpSub}</p>
        </div>

        {/* Formatted Error Alert */}
        {formattedError && (
          <div className="p-4 rounded-2xl bg-rose-950/50 border border-rose-500/40 text-rose-200 text-xs space-y-2 shadow-lg">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold text-rose-300">{formattedError.title}</p>
                <p className="text-slate-300 text-[11px] leading-relaxed">{formattedError.message}</p>
              </div>
            </div>

            {formattedError.actionUrl && (
              <a
                href={formattedError.actionUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-900/60 hover:bg-sky-800 text-sky-200 border border-sky-500/30 font-semibold text-[11px] transition"
              >
                <span>{formattedError.actionLabel || 'Open Console'}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}

            {formattedError.suggestGoogleSignIn && (
              <div className="pt-1 border-t border-rose-500/20">
                <p className="text-[11px] text-amber-300 font-semibold mb-2">
                  {language === 'ar' ? 'يمكنك الدخول مباشرة الآن عبر Google:' : 'You can sign in immediately using Google:'}
                </p>
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={submitting}
                  className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center justify-center gap-2 border border-slate-600 transition"
                >
                  <span>{t.auth.googleSignIn}</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Google Sign-in */}
        <button
          onClick={handleGoogleSignIn}
          disabled={submitting}
          className="w-full py-3 px-4 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 text-xs font-bold text-white transition flex items-center justify-center gap-3 cursor-pointer disabled:opacity-50"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          <span>{t.auth.googleSignIn}</span>
        </button>

        {/* Divider */}
        <div className="relative flex items-center justify-center">
          <div className="border-t border-slate-800 w-full" />
          <span className="bg-slate-900 px-3 text-[11px] text-slate-500 uppercase tracking-wider font-semibold">
            {t.auth.orDivider}
          </span>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300">{t.auth.displayNameLabel}</label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-500 absolute start-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Miner-Zero"
                className="w-full ps-10 pe-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-sky-500 transition"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300">{t.auth.emailLabel}</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute start-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="miner@spinnermine.com"
                className="w-full ps-10 pe-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-sky-500 transition"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300">{t.auth.passwordLabel}</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute start-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                className="w-full ps-10 pe-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-sky-500 transition"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300">{t.auth.confirmPasswordLabel}</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute start-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat password"
                className="w-full ps-10 pe-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-sky-500 transition"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
              <span>{t.auth.referralCodeLabel}</span>
              <span className="text-[10px] text-amber-400 font-bold">+5% bonus share</span>
            </label>
            <div className="relative">
              <Tag className="w-4 h-4 text-slate-500 absolute start-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                placeholder="e.g. ALPHA7"
                maxLength={10}
                className="w-full ps-10 pe-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-amber-400 font-mono placeholder-slate-600 focus:outline-none focus:border-amber-500 transition uppercase"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-xs font-bold text-white shadow-lg shadow-sky-500/20 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 mt-2"
          >
            <span>{submitting ? 'Creating Rig Account...' : t.auth.signUpTitle}</span>
            <ArrowRight className="w-4 h-4 rtl:rotate-180" />
          </button>
        </form>

        {/* Footer Link */}
        <div className="text-center pt-2">
          <p className="text-xs text-slate-400">
            {t.auth.haveAccount}{' '}
            <button
              onClick={() => setCurrentPage('login')}
              className="text-sky-400 hover:text-sky-300 font-bold transition cursor-pointer"
            >
              {t.nav.login}
            </button>
          </p>
        </div>

      </div>
    </div>
  );
};
