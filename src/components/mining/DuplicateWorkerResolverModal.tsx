import React, { useState } from 'react';
import { MiningWorker } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { getShortInstallationId } from '../../utils/installation-id';
import { mergeWorkers, archiveWorker } from '../../services/apiClient';
import { 
  AlertTriangle, 
  CheckCircle2, 
  GitMerge, 
  Archive, 
  ShieldCheck, 
  Laptop, 
  RefreshCw,
  Clock,
  Layers
} from 'lucide-react';

export interface DuplicateGroupItem {
  primaryWorkerId: string;
  primaryName: string;
  duplicateWorkerId: string;
  duplicateName: string;
  reason: string;
  duplicateSessionsCount: number;
  duplicateAcceptedShares: number;
  installationId?: string;
}

interface DuplicateWorkerResolverModalProps {
  isOpen: boolean;
  onClose: () => void;
  groups: DuplicateGroupItem[];
  workers: MiningWorker[];
  idToken?: string;
  getIdToken?: (forceRefresh?: boolean) => Promise<string | null>;
  onResolved: () => void;
}

export const DuplicateWorkerResolverModal: React.FC<DuplicateWorkerResolverModalProps> = ({
  isOpen,
  onClose,
  groups,
  workers,
  idToken,
  getIdToken,
  onResolved
}) => {
  const { language } = useLanguage();
  const { currentUser } = useAuth();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  if (!isOpen) return null;

  // Requirement 3: Safe token acquisition helper with force-refresh support
  const resolveFreshToken = async (forceRefresh = false): Promise<string | null> => {
    // 1. Caller supplied getIdToken callback
    if (getIdToken) {
      try {
        const token = await getIdToken(forceRefresh);
        if (token && token.trim()) return token.trim();
      } catch (err) {
        console.warn('[Duplicate Resolver] getIdToken prop failed:', err);
      }
    }
    // 2. Direct from Firebase Auth currentUser
    if (currentUser) {
      try {
        const token = await currentUser.getIdToken(forceRefresh);
        if (token && token.trim()) return token.trim();
      } catch (err) {
        console.warn('[Duplicate Resolver] currentUser.getIdToken failed:', err);
      }
    }
    // 3. Fallback to idToken prop if not forcing refresh
    if (!forceRefresh && idToken && typeof idToken === 'string' && idToken.trim()) {
      return idToken.trim();
    }
    return null;
  };

  const handleMerge = async (primaryId: string, secondaryId: string) => {
    setProcessingId(secondaryId);
    setFeedback(null);

    // Requirement 2 & 4: Strictly disallow action if no authenticated user
    if (!currentUser) {
      setFeedback({
        type: 'error',
        message: language === 'ar'
          ? 'انتهت جلسة تسجيل الدخول أو لم يتم تسجيل الدخول. يرجى تسجيل الدخول مجددًا للمتابعة بأمان.'
          : 'Session expired or not signed in. Please sign in again to continue safely.'
      });
      setProcessingId(null);
      return;
    }

    // Requirement 3: Fetch fresh token prior to operation
    let token = await resolveFreshToken(false);
    if (!token) {
      token = await resolveFreshToken(true);
    }

    // Requirement 4: Never send request without a valid token
    if (!token) {
      setFeedback({
        type: 'error',
        message: language === 'ar'
          ? 'انتهت صلاحية جلسة تسجيل الدخول. يرجى إعادة تسجيل الدخول لتأكيد هويتك وأمان حسابك.'
          : 'Your session has expired. Please sign in again to verify your identity.'
      });
      setProcessingId(null);
      return;
    }

    try {
      let res = await mergeWorkers(primaryId, secondaryId, 'Merged via duplicate resolver', token);

      // Requirement 3: Safe retry on session expiration
      const isAuthError = !res.success && (
        res.error?.includes('Unauthorized') ||
        res.error?.includes('Token') ||
        res.error?.includes('token') ||
        res.error?.includes('expired') ||
        res.error?.includes('401')
      );

      if (isAuthError) {
        const forcedToken = await resolveFreshToken(true);
        if (forcedToken) {
          res = await mergeWorkers(primaryId, secondaryId, 'Merged via duplicate resolver (retry)', forcedToken);
        }
      }

      if (res.success) {
        const auditNote = res.retainedAcceptedShares !== undefined 
          ? (language === 'ar' ? ` [الأسهم المحفوظة للتدقيق: ${res.retainedAcceptedShares}، الجلسات المفحوصة: ${res.auditedSessionsCount || 0}]` : ` [Audited Shares: ${res.retainedAcceptedShares}, Linked Sessions: ${res.auditedSessionsCount || 0}]`)
          : '';
        setFeedback({
          type: 'success',
          message: language === 'ar'
            ? `تم دمج السجل (${secondaryId}) بنجاح داخل السجل الأساسي (${primaryId}). لم يُحذف أي مستند من قاعدة البيانات.${auditNote}`
            : `Successfully merged (${secondaryId}) into primary record (${primaryId}). No documents were deleted.${auditNote}`
        });
        setTimeout(() => {
          onResolved();
        }, 1600);
      } else {
        const isStillAuthError = (
          res.error?.includes('Unauthorized') ||
          res.error?.includes('Token') ||
          res.error?.includes('token') ||
          res.error?.includes('expired') ||
          res.error?.includes('401')
        );

        setFeedback({
          type: 'error',
          message: isStillAuthError
            ? (language === 'ar'
                ? 'انتهت جلسة تسجيل الدخول أو الرمز غير صالح. يرجى تسجيل الدخول مرة أخرى للمتابعة.'
                : 'Session expired or invalid authentication token. Please sign in again.')
            : (res.error || (language === 'ar' ? 'فشل دمج الأجهزة' : 'Failed to merge devices'))
        });
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Operation failed'
      });
    } finally {
      setProcessingId(null);
    }
  };

  const handleArchive = async (workerId: string) => {
    setProcessingId(workerId);
    setFeedback(null);

    // Requirement 2 & 4: Strictly disallow action if no authenticated user
    if (!currentUser) {
      setFeedback({
        type: 'error',
        message: language === 'ar'
          ? 'انتهت جلسة تسجيل الدخول أو لم يتم تسجيل الدخول. يرجى تسجيل الدخول مجددًا للمتابعة بأمان.'
          : 'Session expired or not signed in. Please sign in again to continue safely.'
      });
      setProcessingId(null);
      return;
    }

    // Requirement 3: Fetch fresh token prior to operation
    let token = await resolveFreshToken(false);
    if (!token) {
      token = await resolveFreshToken(true);
    }

    // Requirement 4: Never send request without a valid token
    if (!token) {
      setFeedback({
        type: 'error',
        message: language === 'ar'
          ? 'انتهت صلاحية جلسة تسجيل الدخول. يرجى إعادة تسجيل الدخول لتأكيد هويتك وأمان حسابك.'
          : 'Your session has expired. Please sign in again to verify your identity.'
      });
      setProcessingId(null);
      return;
    }

    try {
      let res = await archiveWorker(workerId, 'Archived via duplicate resolver', token);

      // Requirement 3: Safe retry on session expiration
      const isAuthError = !res.success && (
        res.error?.includes('Unauthorized') ||
        res.error?.includes('Token') ||
        res.error?.includes('token') ||
        res.error?.includes('expired') ||
        res.error?.includes('401')
      );

      if (isAuthError) {
        const forcedToken = await resolveFreshToken(true);
        if (forcedToken) {
          res = await archiveWorker(workerId, 'Archived via duplicate resolver (retry)', forcedToken);
        }
      }

      if (res.success) {
        setFeedback({
          type: 'success',
          message: language === 'ar'
            ? `تمت أرشفة السجل المكرر (${workerId}) بأمان. لن يظهر متصلاً بعد الآن.`
            : `Successfully archived duplicate (${workerId}). It will no longer appear online.`
        });
        setTimeout(() => {
          onResolved();
        }, 1200);
      } else {
        const isStillAuthError = (
          res.error?.includes('Unauthorized') ||
          res.error?.includes('Token') ||
          res.error?.includes('token') ||
          res.error?.includes('expired') ||
          res.error?.includes('401')
        );

        setFeedback({
          type: 'error',
          message: isStillAuthError
            ? (language === 'ar'
                ? 'انتهت جلسة تسجيل الدخول أو الرمز غير صالح. يرجى تسجيل الدخول مرة أخرى للمتابعة.'
                : 'Session expired or invalid authentication token. Please sign in again.')
            : (res.error || (language === 'ar' ? 'فشلت الأرشفة' : 'Archiving failed'))
        });
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Operation failed'
      });
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-2xl rounded-3xl bg-slate-900 border border-slate-700 p-6 sm:p-8 shadow-2xl text-slate-100 space-y-6 max-h-[90vh] overflow-y-auto">
        
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Layers className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-white">
                {language === 'ar' ? 'معالجة تسجيلات الأجهزة المكررة' : 'Resolve Duplicate Device Registrations'}
              </h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              {language === 'ar'
                ? 'تم اكتشاف تسجيل نفس تثبيت Windows أكثر من مرة (مثل tm وty). يمكنك دمج أو أرشفة السجلات المكررة مع الاحتفاظ بالسجل الأساسي وبكامل سجل التدقيق.'
                : 'Detected multiple registrations for the same Windows installation (e.g., tm and ty). You can merge or archive duplicate records while preserving the primary record and audit history.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
          >
            ✕
          </button>
        </div>

        {/* Financial and Audit Guarantee Banner */}
        <div className="p-3.5 rounded-2xl bg-sky-950/40 border border-sky-500/30 text-sky-200 text-xs flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-sky-300">
              {language === 'ar' ? 'ضمان الأمان والنزاهة المالية' : 'Financial Integrity & Safe Audit Guarantee'}
            </p>
            <p className="text-[11px] text-sky-300/80 leading-relaxed">
              {language === 'ar'
                ? 'لن يتم حذف أي مستند من Firestore تلقائياً، ولن يتم نقل أرصدة مالية أو أسهم تعدين دون تحقق موثوق. سيتم تمييز السجل المكرر كمؤرشف/مدمج لإنهاء حالة الاتصال المتزامن.'
                : 'No documents are automatically deleted from Firestore, and no balances or unverified shares are modified. The duplicate record is flagged as merged/archived to eliminate double-online status.'}
            </p>
          </div>
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div className={`p-4 rounded-2xl border text-xs flex items-center gap-3 ${
            feedback.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
              : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
          }`}>
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
        )}

        {/* Groups List */}
        {groups.length === 0 ? (
          <div className="text-center py-8 border border-dashed border-slate-800 rounded-2xl text-slate-400 space-y-2">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
            <p className="text-xs font-semibold">
              {language === 'ar' ? 'لا توجد تسجيلات مكررة نشطة حالياً!' : 'No active duplicate registrations detected!'}
            </p>
            <p className="text-[11px] text-slate-500">
              {language === 'ar' ? 'جميع أجهزتك مرتبطة بمعرفات تثبيت فريدة.' : 'All your registered workers have distinct device identities.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((g, idx) => {
              const primaryWorker = workers.find(w => w.workerId === g.primaryWorkerId || w.id === g.primaryWorkerId);
              const duplicateWorker = workers.find(w => w.workerId === g.duplicateWorkerId || w.id === g.duplicateWorkerId);
              const isBusy = processingId === g.duplicateWorkerId;

              return (
                <div key={idx} className="p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                    <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4" />
                      <span>{g.reason}</span>
                    </span>
                    {g.installationId && (
                      <span className="font-mono text-[10px] text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                        Installation: {getShortInstallationId(g.installationId)}
                      </span>
                    )}
                  </div>

                  {/* Primary vs Duplicate Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Primary Worker */}
                    <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-500/30 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                          {language === 'ar' ? 'السجل الأساسي (المحتفظ به)' : 'Primary Record (Retained)'}
                        </span>
                        <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
                      </div>
                      <div className="flex items-center gap-2">
                        <Laptop className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span className="text-xs font-bold text-white">{g.primaryName}</span>
                      </div>
                      <p className="font-mono text-[10px] text-slate-400 truncate">ID: {g.primaryWorkerId}</p>
                      <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1">
                        <span>Shares: {primaryWorker?.acceptedShares || 0}</span>
                        <span>{primaryWorker?.status || 'offline'}</span>
                      </div>
                    </div>

                    {/* Duplicate Worker */}
                    <div className="p-3.5 rounded-xl bg-rose-950/20 border border-rose-500/30 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400">
                          {language === 'ar' ? 'السجل المكرر (للمعالجة)' : 'Duplicate Candidate'}
                        </span>
                        <span className="w-2 h-2 rounded-full bg-rose-400" />
                      </div>
                      <div className="flex items-center gap-2">
                        <Laptop className="w-4 h-4 text-rose-400 shrink-0" />
                        <span className="text-xs font-bold text-white">{g.duplicateName}</span>
                      </div>
                      <p className="font-mono text-[10px] text-slate-400 truncate">ID: {g.duplicateWorkerId}</p>
                      <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1">
                        <span>Linked Sessions: {g.duplicateSessionsCount}</span>
                        <span>Shares: {g.duplicateAcceptedShares}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col sm:flex-row items-center justify-end gap-2.5 pt-2">
                    <button
                      type="button"
                      onClick={() => handleArchive(g.duplicateWorkerId)}
                      disabled={isBusy}
                      className="w-full sm:w-auto px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs border border-slate-700 transition cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      <Archive className="w-3.5 h-3.5 text-slate-400" />
                      <span>{language === 'ar' ? 'أرشفة المكرر فقط' : 'Archive Duplicate Only'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleMerge(g.primaryWorkerId, g.duplicateWorkerId)}
                      disabled={isBusy}
                      className="w-full sm:w-auto px-5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs shadow-md transition cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      {isBusy ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <GitMerge className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {language === 'ar' 
                          ? `دمج ${g.duplicateName} داخل ${g.primaryName}` 
                          : `Merge ${g.duplicateName} into ${g.primaryName}`}
                      </span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="pt-2 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 transition"
          >
            {language === 'ar' ? 'إغلاق' : 'Close'}
          </button>
        </div>

      </div>
    </div>
  );
};
