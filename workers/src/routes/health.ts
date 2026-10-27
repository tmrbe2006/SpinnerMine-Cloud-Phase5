import { Env } from '../types';
import { getServiceAccountAccessToken, getServiceAccountDiagnostic } from '../serviceAccount';

// Deployment trigger: synchronize Cloudflare production with the latest tested Heartbeat fixes.
export async function handleHealth(request: Request, env: Env): Promise<Response> {
  const projectId = env.FIREBASE_PROJECT_ID || 'spinnermine-cloud-production';
  const databaseId = env.FIRESTORE_DATABASE_ID || '(default)';
  const firebaseEndpoint = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}`;

  // 1. Check Public API Reachability (Google Firestore REST service status)
  let publicReachability = {
    endpoint: firebaseEndpoint,
    online: false,
    httpStatus: 0,
    notice: ''
  };

  try {
    const publicRes = await fetch(firebaseEndpoint, { method: 'GET' });
    publicReachability.httpStatus = publicRes.status;
    if (publicRes.status === 401) {
      // 401 strictly indicates Google's Firestore service is online and enforcing authentication
      publicReachability.online = true;
      publicReachability.notice = 'Firestore endpoint is online and actively enforcing authentication credentials.';
    } else if (publicRes.status === 200) {
      publicReachability.online = true;
      publicReachability.notice = 'Firestore endpoint is publicly reachable.';
    } else if (publicRes.status === 404) {
      publicReachability.online = false;
      publicReachability.notice = `Database or project not found at Google endpoint [HTTP 404]. Verify projectId="${projectId}".`;
    } else {
      publicReachability.online = false;
      publicReachability.notice = `Unexpected response from Google Firestore endpoint [HTTP ${publicRes.status}].`;
    }
  } catch (err: any) {
    publicReachability.online = false;
    publicReachability.notice = err.message ? err.message.slice(0, 100) : 'Failed to reach Google Firestore endpoint';
  }

  // 2. Check Server Authentication (Service Account Credentials in Cloudflare Secrets)
  const saDiag = await getServiceAccountDiagnostic(env);
  const serviceToken = await getServiceAccountAccessToken(env);

  const serverAuth = {
    configured: saDiag.configured,
    emailConfigured: saDiag.emailConfigured,
    privateKeyConfigured: saDiag.privateKeyConfigured,
    keyFormatValid: saDiag.keyFormatValid,
    authenticated: saDiag.tokenAcquired,
    status: saDiag.tokenAcquired
      ? 'AUTHENTICATED'
      : (saDiag.configured ? 'AUTH_FAILED' : 'PENDING_SECRETS'),
    ...(saDiag.error ? { notice: saDiag.error } : {})
  };

  // 3. Authenticated Firestore Access (Only tested if serverAuth is valid; never based on 401/403)
  let firestoreAccess: {
    authenticated: boolean;
    connected: boolean;
    httpStatus: number;
    status: string;
    notice?: string;
  } = {
    authenticated: false,
    connected: false,
    httpStatus: 0,
    status: 'UNAUTHENTICATED',
    notice: 'Authenticated administrative checks require service account token.'
  };

  if (serviceToken) {
    try {
      const authRes = await fetch(firebaseEndpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${serviceToken}`,
          'Content-Type': 'application/json'
        }
      });

      firestoreAccess.httpStatus = authRes.status;
      firestoreAccess.authenticated = true;

      if (authRes.status === 200) {
        firestoreAccess.connected = true;
        firestoreAccess.status = 'CONNECTED';
        firestoreAccess.notice = 'Service account successfully authenticated with Google Cloud Firestore.';
      } else if (authRes.status === 403) {
        firestoreAccess.connected = false;
        firestoreAccess.status = 'PERMISSION_DENIED';
        firestoreAccess.notice = 'Service account lacks IAM roles/datastore.user or roles/datastore.owner permissions on project spinnermine-cloud-production.';
      } else if (authRes.status === 404) {
        firestoreAccess.connected = false;
        firestoreAccess.status = 'DATABASE_NOT_FOUND';
        firestoreAccess.notice = `Firestore database "${databaseId}" not found in project "${projectId}".`;
      } else {
        firestoreAccess.connected = false;
        firestoreAccess.status = `HTTP_${authRes.status}`;
        firestoreAccess.notice = `Authenticated check returned unexpected status HTTP ${authRes.status}`;
      }
    } catch (err: any) {
      firestoreAccess.connected = false;
      firestoreAccess.status = 'ERROR';
      firestoreAccess.notice = err.message ? err.message.slice(0, 100) : 'Authenticated connection check failed';
    }
  }

  // 4. Worker Registration Readiness Evaluation
  const workerRegistrationReady = true;
  const registrationMode = firestoreAccess.connected
    ? 'AUTHORITATIVE_SERVICE_ACCOUNT'
    : 'VERIFIED_USER_BEARER_ID_TOKEN';

  let overallStatus: string;
  if (firestoreAccess.connected) {
    overallStatus = 'healthy';
  } else if (!serverAuth.configured) {
    overallStatus = 'operational_keyless';
  } else {
    overallStatus = 'degraded';
  }

  const payload = {
    status: overallStatus,
    platform: 'SpinnerMine Cloud (Cloudflare Worker)',
    service: 'spinnermine-backend',
    version: env.BACKEND_VERSION || '1.0.4',
    phase: 2,
    security: 'Zero-Trust RBAC & Financial Lockdown Active',
    timestamp: new Date().toISOString(),
    firebase: {
      projectId,
      databaseId,
      mode: 'PRODUCTION',
      authArchitecture: serverAuth.configured ? 'SERVER_SERVICE_ACCOUNT' : 'KEYLESS_DELEGATED_FIREBASE_ID_TOKEN',
      connected: firestoreAccess.connected, // Strictly true ONLY on genuine HTTP 200 authenticated access
      reachability: {
        online: publicReachability.online,
        httpStatus: publicReachability.httpStatus,
        notice: publicReachability.notice
      },
      serverAuth: {
        configured: serverAuth.configured,
        authenticated: serverAuth.authenticated,
        status: serverAuth.status,
        ...(serverAuth.notice ? { notice: serverAuth.notice } : {})
      },
      firestoreAccess: {
        status: firestoreAccess.status,
        httpStatus: firestoreAccess.httpStatus,
        ...(firestoreAccess.notice ? { notice: firestoreAccess.notice } : {})
      },
      workerRegistration: {
        ready: workerRegistrationReady,
        mode: registrationMode,
        notice: 'Worker registration requires a valid Firebase ID Token (Bearer) on POST /api/workers/register'
      },
      financialEndpoints: {
        status: serverAuth.configured ? 'AUTHORITATIVE' : 'LOCKED_KEYLESS_MODE',
        notice: serverAuth.configured
          ? 'Authoritative server credentials active.'
          : 'Financial rewards, withdrawals, and accepted shares are strictly locked in keyless mode until authoritative server credentials are configured.'
      }
    }
  };

  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
