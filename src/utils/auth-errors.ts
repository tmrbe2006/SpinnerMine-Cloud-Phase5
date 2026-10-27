/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SpinnerMine Cloud - Comprehensive Bilingual Authentication & Authorization Error Handler
 *
 * Maps Firebase Auth and Firestore security errors into user-friendly, actionable messages in
 * Arabic and English. Explicitly avoids leaking sensitive tokens, secrets, or internal stack traces.
 */

import firebaseConfig from '../../firebase-applet-config.json';

export interface FormattedAuthError {
  code: string;
  title: string;
  message: string;
  actionUrl?: string;
  consoleUrl?: string;
  actionLabel?: string;
  suggestGoogleSignIn?: boolean;
  suggestGoogle?: boolean;
}

export function formatAuthError(err: any, language: 'ar' | 'en' = 'en'): FormattedAuthError {
  const isAr = language === 'ar';
  const rawCode = String(err?.code || err?.message || '');
  
  // Extract standard auth error code (e.g., auth/operation-not-allowed)
  let code = 'unknown';
  const match = rawCode.match(/auth\/[a-z0-9-]+/i) || rawCode.match(/permission-denied/i);
  if (match) {
    code = match[0].toLowerCase();
  }

  // Active production Firebase project ID
  const activeProjectId = (firebaseConfig as any)?.projectId || 'spinnermine-cloud-production';

  const providersConsoleUrl = `https://console.firebase.google.com/project/${activeProjectId}/authentication/providers`;
  const settingsConsoleUrl = `https://console.firebase.google.com/project/${activeProjectId}/authentication/settings`;

  // 1. Provider disabled in Firebase Console (Email/Password or Google)
  if (code === 'auth/operation-not-allowed' || rawCode.includes('OPERATION_NOT_ALLOWED') || rawCode.includes('PASSWORD_LOGIN_DISABLED')) {
    const isGoogleAttempt = rawCode.toLowerCase().includes('google') || String(err?.providerId || '').includes('google');
    
    if (isGoogleAttempt) {
      return {
        code: 'auth/operation-not-allowed',
        title: isAr ? 'مزود تسجيل الدخول بـ Google معطّل' : 'Google Sign-In Provider Disabled',
        message: isAr
          ? `مزود تسجيل الدخول بحساب Google غير مفعّل في لوحة تحكم Firebase لمشروعك (${activeProjectId}). للتفعيل: افتح Firebase Console > Authentication > Sign-in method، انقر على Google، فعّل خيار Enable وحدد بريد الدعم ثم احفظ.`
          : `Google Sign-In is currently disabled in your Firebase Console project (${activeProjectId}). To enable: open Firebase Console > Authentication > Sign-in method, click Google, toggle Enable, set support email, and save.`,
        actionUrl: providersConsoleUrl,
        consoleUrl: providersConsoleUrl,
        actionLabel: isAr ? 'فتح إعدادات مزودي Firebase' : 'Open Firebase Sign-in Providers',
        suggestGoogleSignIn: false
      };
    }

    return {
      code: 'auth/operation-not-allowed',
      title: isAr ? 'مزود البريد الإلكتروني معطّل' : 'Email/Password Provider Disabled',
      message: isAr
        ? `إنشاء الحساب بالبريد وكلمة المرور معطّل حالياً في إعدادات Firebase Console لمشروعك (${activeProjectId}). خطوات التفعيل: 1) افتح رابط لوحة تحكم Firebase أدناه 2) اختر Email/Password 3) فعّل خيار Enable واضغط Save. يمكنك أيضاً تسجيل الدخول بـ Google.`
        : `Email/Password authentication is currently disabled in your Firebase Console project (${activeProjectId}). Steps to enable: 1) Open Firebase Console link below 2) Select Email/Password 3) Toggle Enable and click Save. You can also sign in using Google.`,
      actionUrl: providersConsoleUrl,
      consoleUrl: providersConsoleUrl,
      actionLabel: isAr ? 'تفعيل Email/Password في Firebase' : 'Enable Email/Password in Firebase',
      suggestGoogleSignIn: true,
      suggestGoogle: true
    };
  }

  // 2. Email already in use
  if (code === 'auth/email-already-in-use') {
    return {
      code: 'auth/email-already-in-use',
      title: isAr ? 'البريد الإلكتروني مسجل مسبقاً' : 'Email Already Registered',
      message: isAr
        ? 'هذا البريد الإلكتروني مسجل بالفعل. يرجى تسجيل الدخول باستخدام كلمة المرور الخاصة بك أو استخدام خيار استعادة كلمة المرور.'
        : 'This email address is already in use. Please sign in with your password or use password recovery.'
    };
  }

  // 3. Invalid Email Format
  if (code === 'auth/invalid-email') {
    return {
      code: 'auth/invalid-email',
      title: isAr ? 'صيغة البريد غير صالحة' : 'Invalid Email Format',
      message: isAr
        ? 'يرجى إدخال عنوان بريد إلكتروني صحيح وتنسيق سليم (مثال: miner@example.com).'
        : 'Please enter a valid email address (e.g., miner@example.com).'
    };
  }

  // 4. Weak Password
  if (code === 'auth/weak-password') {
    return {
      code: 'auth/weak-password',
      title: isAr ? 'كلمة المرور ضعيفة' : 'Weak Password',
      message: isAr
        ? 'كلمة المرور ضعيفة جداً. يجب أن تتكون من 6 أحرف على الأقل، ويُفضل استخدام مزيج من الأحرف والأرقام.'
        : 'The password is too weak. It must be at least 6 characters long with letters and numbers.'
    };
  }

  // 5. Unauthorized Domain
  if (code === 'auth/unauthorized-domain') {
    const isElectronOrFile = typeof window !== 'undefined' && (
      Boolean((window as any).electronAPI || (window as any).electronMiningAPI) ||
      window.location.protocol === 'file:'
    );

    const desktopNotice = isAr
      ? `نطاق التطبيق المحلي (file://) في Windows غير مؤهل للإضافة إلى النطاقات المصرح بها (Authorized Domains) في مشروع Firebase (${activeProjectId}). يرجى استخدام تسجيل الدخول بالبريد الإلكتروني وكلمة المرور في تطبيق سطح المكتب، أو استخدام بوابة الويب.`
      : `The desktop local environment (file://) cannot be added to Authorized Domains in Firebase project (${activeProjectId}). Please use Email and Password authentication in the Windows application, or authenticate via the web portal.`;

    const webNotice = isAr
      ? `نطاق التطبيق الحالي غير مدرج في النطاقات المصرح بها (Authorized Domains) في مشروع Firebase (${activeProjectId}). يرجى إضافة النطاق من Firebase Console > Authentication > Settings للمتابعة.`
      : `The current application domain is not authorized for OAuth operations in Firebase project (${activeProjectId}). Please add this domain to Authorized Domains in Firebase Console > Authentication > Settings.`;

    return {
      code: 'auth/unauthorized-domain',
      title: isAr ? (isElectronOrFile ? 'مصادقة سطح المكتب (البريد وكلمة المرور)' : 'نطاق غير مصرّح به') : (isElectronOrFile ? 'Desktop Authentication (Email & Password)' : 'Unauthorized Domain'),
      message: isElectronOrFile ? desktopNotice : webNotice,
      actionUrl: settingsConsoleUrl,
      consoleUrl: settingsConsoleUrl,
      actionLabel: isAr ? 'إدارة النطاقات في Firebase' : 'Manage Authorized Domains',
      suggestGoogleSignIn: false
    };
  }

  // 6. Operation not supported in this environment (e.g., Electron / file:// popup)
  if (code === 'auth/operation-not-supported-in-this-environment') {
    return {
      code: 'auth/operation-not-supported-in-this-environment',
      title: isAr ? 'المصادقة المنبثقة غير مدعومة هنا' : 'Environment Not Supported for Popup',
      message: isAr
        ? 'تسجيل الدخول المنبثق عبر Google غير مدعوم في بيئة سطح المكتب المعزولة. يرجى استخدام تسجيل الدخول بالبريد الإلكتروني وكلمة المرور في تطبيق سطح المكتب، أو تسجيل الدخول عبر بوابة الويب.'
        : 'Google Sign-In popup is not supported in this isolated desktop environment. Please use Email and Password to sign in on desktop, or authenticate through the web browser portal.'
    };
  }

  // 7. Popup Blocked / Closed by user
  if (code === 'auth/popup-blocked') {
    return {
      code: 'auth/popup-blocked',
      title: isAr ? 'تم حظر النافذة المنبثقة' : 'Popup Blocked',
      message: isAr
        ? 'قام المتصفح بحظر نافذة تسجيل الدخول المنبثقة. يرجى السماح بالنوافذ المنبثقة للموقع لإكمال المصادقة.'
        : 'The authentication popup was blocked by your browser. Please allow popups for this site to complete sign-in.'
    };
  }

  if (code === 'auth/popup-closed-by-user') {
    return {
      code: 'auth/popup-closed-by-user',
      title: isAr ? 'تم إغلاق نافذة المصادقة' : 'Sign-In Cancelled',
      message: isAr
        ? 'تم إغلاق نافذة تسجيل الدخول قبل إتمام العملية. يرجى إعادة المحاولة.'
        : 'The sign-in popup was closed before completing authentication. Please try again.'
    };
  }

  // 8. Network Request Failed
  if (code === 'auth/network-request-failed') {
    return {
      code: 'auth/network-request-failed',
      title: isAr ? 'فشل الاتصال بالشبكة' : 'Network Connection Error',
      message: isAr
        ? 'تعذر الاتصال بخوادم المصادقة. يرجى التحقق من اتصالك بالإنترنت والمحاولة مجدداً.'
        : 'Unable to reach the authentication service. Please check your internet connection and try again.'
    };
  }

  // 9. Permission Denied (Firestore Rules)
  if (code === 'permission-denied' || rawCode.includes('permission-denied') || rawCode.includes('PERMISSION_DENIED')) {
    return {
      code: 'permission-denied',
      title: isAr ? 'تم رفض الصلاحية' : 'Permission Denied',
      message: isAr
        ? 'قواعد الأمان منعت الوصول إلى هذا المورد أو تسجيل البيانات. تأكد من صحة الحساب والصلاحيات الممنوحة.'
        : 'Security rules prevented this operation. Ensure you are signed in with the correct account permissions.'
    };
  }

  // 10. Invalid credentials / wrong password / user not found
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return {
      code: 'auth/invalid-credential',
      title: isAr ? 'بيانات غير صحيحة' : 'Invalid Credentials',
      message: isAr
        ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة. يرجى التحقق من البيانات والمحاولة مجدداً، أو استخدام استعادة كلمة المرور.'
        : 'Invalid email or password. Please verify your credentials and try again, or use password recovery.'
    };
  }

  // Generic fallback without exposing internal stack traces, tokens, or secrets
  let safeMessage = isAr
    ? 'حدث خطأ أثناء معالجة طلب المصادقة. يرجى المحاولة لاحقاً أو استخدام تسجيل الدخول بـ Google.'
    : 'An error occurred during authentication. Please try again or use Google Sign-in.';

  if (!isAr && err?.message && typeof err.message === 'string') {
    if (/bearer|token|secret|password|key|cred/i.test(err.message) || /eyJ[a-zA-Z0-9_\-\.]+/i.test(err.message)) {
      safeMessage = 'An authentication error occurred. Please verify your credentials or try signing in with Google.';
    } else {
      safeMessage = err.message.slice(0, 150);
    }
  }

  return {
    code: 'auth/unknown',
    title: isAr ? 'خطأ في المصادقة' : 'Authentication Error',
    message: safeMessage,
    suggestGoogleSignIn: true,
    suggestGoogle: true
  };
}
