import { Env } from './types';
import { uint8ArrayToBase64Url } from './auth';

interface CachedAccessToken {
  token: string;
  expiresAt: number;
}

let cachedAccessToken: CachedAccessToken | null = null;

export interface ServiceAccountDiagnostic {
  configured: boolean;
  emailConfigured: boolean;
  privateKeyConfigured: boolean;
  keyFormatValid: boolean;
  tokenAcquired: boolean;
  error?: string;
  tokenEndpointStatus?: number;
}

// Convert PEM format PKCS#8 private key to Uint8Array safely
export function pemToPkcs8Bytes(pem: string): Uint8Array | null {
  try {
    if (!pem || typeof pem !== 'string') return null;

    // Handle escaped newlines (e.g. from environment variable or JSON string)
    const cleanPem = pem
      .replace(/\\n/g, '')
      .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/g, '')
      .replace(/-----END (?:RSA )?PRIVATE KEY-----/g, '')
      .replace(/\s+/g, '');

    if (!cleanPem) return null;

    const binary = atob(cleanPem);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function stringToBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  return uint8ArrayToBase64Url(bytes);
}

/**
 * Extracts email and private key PEM from environment variables,
 * supporting either separate secrets (FIREBASE_SERVICE_ACCOUNT_EMAIL + FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY)
 * or a single full JSON credential string (FIREBASE_SERVICE_ACCOUNT_KEY).
 */
export function extractServiceAccountCredentials(env: Env): { email: string | null; privateKeyPem: string | null } {
  let email = env.FIREBASE_SERVICE_ACCOUNT_EMAIL || null;
  let privateKeyPem = env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY || (env as any).FIREBASE_SERVICE_ACCOUNT_KEY || null;

  if (privateKeyPem && typeof privateKeyPem === 'string' && privateKeyPem.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(privateKeyPem);
      if (parsed.client_email) email = parsed.client_email;
      if (parsed.private_key) privateKeyPem = parsed.private_key;
    } catch {}
  }

  return { email, privateKeyPem };
}

/**
 * Obtains a Google OAuth 2.0 access token for Google Cloud Datastore / Firestore
 * using a service account private key stored in Cloudflare Secrets.
 *
 * Caches token until 5 minutes before expiry.
 */
export async function getServiceAccountAccessToken(env: Env): Promise<string | null> {
  const { email, privateKeyPem } = extractServiceAccountCredentials(env);

  if (!email || !privateKeyPem) {
    return null;
  }

  const now = Date.now();
  if (cachedAccessToken && cachedAccessToken.expiresAt > now) {
    return cachedAccessToken.token;
  }

  try {
    const pkcs8Bytes = pemToPkcs8Bytes(privateKeyPem);
    if (!pkcs8Bytes) {
      return null;
    }
    const privateKey = await crypto.subtle.importKey(
      'pkcs8',
      pkcs8Bytes as BufferSource,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const nowSeconds = Math.floor(now / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
      iss: email,
      scope: 'https://www.googleapis.com/auth/datastore',
      aud: 'https://oauth2.googleapis.com/token',
      exp: nowSeconds + 3600,
      iat: nowSeconds
    };

    const headerB64 = stringToBase64Url(JSON.stringify(header));
    const payloadB64 = stringToBase64Url(JSON.stringify(payload));
    const unsignedToken = `${headerB64}.${payloadB64}`;

    const signatureBytes = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      privateKey,
      new TextEncoder().encode(unsignedToken)
    );

    const signatureB64 = uint8ArrayToBase64Url(new Uint8Array(signatureBytes));
    const assertionJwt = `${unsignedToken}.${signatureB64}`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: assertionJwt
      })
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('[Service Account] Token request failed:', tokenRes.status, errText);
      return null;
    }

    const data: { access_token: string; expires_in: number } = await tokenRes.json();
    cachedAccessToken = {
      token: data.access_token,
      // Cache with 5 minute buffer
      expiresAt: now + (data.expires_in - 300) * 1000
    };

    return data.access_token;
  } catch (err: any) {
    console.error('[Service Account] Error signing JWT or requesting token:', err?.message || err);
    return null;
  }
}

/**
 * Diagnostic helper for health checks: inspects each step of service account authentication
 * without exposing sensitive private keys or tokens.
 */
export async function getServiceAccountDiagnostic(env: Env): Promise<ServiceAccountDiagnostic> {
  const { email, privateKeyPem } = extractServiceAccountCredentials(env);

  const emailConfigured = Boolean(email && email.includes('@'));
  const privateKeyConfigured = Boolean(privateKeyPem && privateKeyPem.trim().length > 50);

  if (!emailConfigured || !privateKeyConfigured) {
    return {
      configured: false,
      emailConfigured,
      privateKeyConfigured,
      keyFormatValid: false,
      tokenAcquired: false,
      error: 'Service Account credentials not configured in Cloudflare Secrets'
    };
  }

  const pkcs8Bytes = pemToPkcs8Bytes(privateKeyPem!);
  if (!pkcs8Bytes) {
    return {
      configured: true,
      emailConfigured: true,
      privateKeyConfigured: true,
      keyFormatValid: false,
      tokenAcquired: false,
      error: 'Private key format invalid: Cannot decode PKCS#8 PEM base64'
    };
  }

  try {
    const token = await getServiceAccountAccessToken(env);
    if (token) {
      return {
        configured: true,
        emailConfigured: true,
        privateKeyConfigured: true,
        keyFormatValid: true,
        tokenAcquired: true
      };
    }

    return {
      configured: true,
      emailConfigured: true,
      privateKeyConfigured: true,
      keyFormatValid: true,
      tokenAcquired: false,
      error: 'Token exchange with oauth2.googleapis.com failed'
    };
  } catch (err: any) {
    return {
      configured: true,
      emailConfigured: true,
      privateKeyConfigured: true,
      keyFormatValid: true,
      tokenAcquired: false,
      error: err.message || 'Token acquisition failed'
    };
  }
}

/**
 * Resets cached service account token (useful for tests)
 */
export function resetCachedAccessTokenForTesting() {
  cachedAccessToken = null;
}
