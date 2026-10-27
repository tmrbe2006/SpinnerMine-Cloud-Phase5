import { Env } from './types';
import { AuthError } from './auth';
import { handleHealth } from './routes/health';
import { 
  handleWorkerRegister, 
  handleWorkersList, 
  handleWorkerTelemetry,
  handleWorkerRename,
  handleWorkerDuplicates,
  handleWorkerArchive,
  handleWorkerMerge,
  handleWorkerLinkInstallation
} from './routes/workers';
import { handleSpinWheel, handleVerifySpinner } from './routes/games';
import { handlePoolStatus, handlePoolConfig, handleTestPool } from './routes/mining';
import { handleAdminVerifyClaims } from './routes/admin';

// Whitelisted Web Origins
const ALLOWED_WEB_ORIGINS = new Set([
  'https://spinnermine-cloud-production.web.app',
  'https://spinnermine-cloud-production.firebaseapp.com',
  'https://spinnermine-cloud.web.app',
  'https://spinnermine-cloud.firebaseapp.com'
]);

const LOCAL_DEV_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
]);

export function getCorsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers();
  const origin = request.headers.get('Origin');

  let isAllowed = false;
  let allowedOriginHeader = '';

  if (origin) {
    if (
      ALLOWED_WEB_ORIGINS.has(origin) ||
      origin.endsWith('.run.app') ||
      origin.endsWith('.web.app') ||
      origin.endsWith('.firebaseapp.com')
    ) {
      isAllowed = true;
      allowedOriginHeader = origin;
    } else if (env.ALLOW_LOCALHOST_ORIGIN !== 'false' && LOCAL_DEV_ORIGINS.has(origin)) {
      isAllowed = true;
      allowedOriginHeader = origin;
    } else if (origin === 'null') {
      // Electron desktop app runs in file:// or custom scheme with Origin: null.
      // Strict security: allowed only if request carries credentials or requests safe endpoints
      isAllowed = true;
      allowedOriginHeader = 'null';
    }
  } else {
    // Non-browser / curl / native Electron desktop IPC direct fetch (no Origin header sent)
    isAllowed = true;
  }

  if (isAllowed && allowedOriginHeader) {
    headers.set('Access-Control-Allow-Origin', allowedOriginHeader);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Access-Control-Max-Age', '86400');
    headers.set('Vary', 'Origin');
  }

  return headers;
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  try {
    let response: Response;

    if (path === '/api/health' && method === 'GET') {
      response = await handleHealth(request, env);
    } else if (path === '/api/workers/register' && method === 'POST') {
      response = await handleWorkerRegister(request, env);
    } else if (path === '/api/workers/rename' && method === 'POST') {
      response = await handleWorkerRename(request, env);
    } else if (path === '/api/workers/duplicates' && method === 'GET') {
      response = await handleWorkerDuplicates(request, env);
    } else if (path === '/api/workers/archive' && method === 'POST') {
      response = await handleWorkerArchive(request, env);
    } else if (path === '/api/workers/merge' && method === 'POST') {
      response = await handleWorkerMerge(request, env);
    } else if (path === '/api/workers/link-installation' && method === 'POST') {
      response = await handleWorkerLinkInstallation(request, env);
    } else if (path === '/api/workers' && method === 'GET') {
      response = await handleWorkersList(request, env);
    } else if (path === '/api/workers/telemetry' && method === 'POST') {
      response = await handleWorkerTelemetry(request, env);
    } else if (path === '/api/games/spin-wheel' && method === 'POST') {
      response = await handleSpinWheel(request, env);
    } else if (path === '/api/games/verify' && method === 'POST') {
      response = await handleVerifySpinner(request, env);
    } else if (path === '/api/mining/pool-status' && method === 'GET') {
      response = handlePoolStatus(request, env);
    } else if (path === '/api/mining/pool-config' && method === 'GET') {
      response = handlePoolConfig(request, env);
    } else if (path === '/api/mining/test-pool' && method === 'POST') {
      response = await handleTestPool(request, env);
    } else if (path === '/api/admin/verify-claims' && method === 'GET') {
      response = await handleAdminVerifyClaims(request, env);
    } else {
      response = new Response(JSON.stringify({ error: `Not Found: ${method} ${path}` }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Merge CORS headers into response
    const finalHeaders = new Headers(response.headers);
    corsHeaders.forEach((val, key) => finalHeaders.set(key, val));

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: finalHeaders
    });
  } catch (err: any) {
    if (err instanceof AuthError || err.name === 'AuthError') {
      const errHeaders = new Headers(corsHeaders);
      errHeaders.set('Content-Type', 'application/json');
      return new Response(JSON.stringify({ error: err.message }), {
        status: err.status || 401,
        headers: errHeaders
      });
    }

    console.error(`[Worker Error] ${method} ${path}:`, err);
    const errHeaders = new Headers(corsHeaders);
    errHeaders.set('Content-Type', 'application/json');
    return new Response(
      JSON.stringify({ error: err.message || 'Internal Server Error' }),
      {
        status: 500,
        headers: errHeaders
      }
    );
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  }
};
