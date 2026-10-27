import { describe, it, expect, vi } from 'vitest';
import worker from '../src/index';
import { createMockEnv } from './testHelpers';

describe('Cloudflare Worker - Health Endpoint', () => {
  const env = createMockEnv();

  it('GET /api/health returns HTTP 200 with structured status and metadata', async () => {
    const request = new Request('https://worker.spinnermine.workers.dev/api/health', {
      method: 'GET'
    });

    const response = await worker.fetch(request, env);
    expect(response.status).toBe(200);

    const body: any = await response.json();
    expect(body.platform).toContain('SpinnerMine Cloud');
    expect(body.service).toBe('spinnermine-backend');
    expect(body.version).toBe('1.0.4');
    expect(body.phase).toBe(2);
    expect(body.firebase).toBeDefined();
    expect(body.firebase.projectId).toBe('spinnermine-cloud-production');
    expect(body.firebase.databaseId).toBe('(default)');
    expect(body.security).toContain('Zero-Trust');

    // Distinct diagnostics
    expect(body.firebase.reachability).toBeDefined();
    expect(body.firebase.serverAuth).toBeDefined();
    expect(body.firebase.firestoreAccess).toBeDefined();
    expect(body.firebase.workerRegistration).toBeDefined();
    expect(body.firebase.workerRegistration.ready).toBe(true);
    expect(body.firebase.financialEndpoints.status).toBe('LOCKED_KEYLESS_MODE');
    expect(body.firebase.authArchitecture).toBe('KEYLESS_DELEGATED_FIREBASE_ID_TOKEN');

    // Without service account secrets configured, connected MUST be false (zero false claims)
    expect(body.firebase.connected).toBe(false);
    expect(body.firebase.serverAuth.status).toBe('PENDING_SECRETS');
    expect(body.status).toBe('operational_keyless');
  });

  it('GET /api/health never exposes server secrets or service account keys', async () => {
    const envWithSecrets = createMockEnv({
      FIREBASE_SERVICE_ACCOUNT_EMAIL: 'sa@spinnermine-cloud-production.iam.gserviceaccount.com',
      FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASC...',
      GAME_SERVER_SECRET: 'supersecretkey12345678901234567890'
    });

    const request = new Request('https://worker.spinnermine.workers.dev/api/health', {
      method: 'GET'
    });

    const response = await worker.fetch(request, envWithSecrets);
    const bodyStr = await response.text();

    expect(bodyStr).not.toContain('supersecretkey');
    expect(bodyStr).not.toContain('PRIVATE KEY');
    expect(bodyStr).not.toContain('gserviceaccount.com');
  });

  it('Returns 404 for unmapped API route', async () => {
    const request = new Request('https://worker.spinnermine.workers.dev/api/unmapped-endpoint', {
      method: 'GET'
    });

    const response = await worker.fetch(request, env);
    expect(response.status).toBe(404);
    const body: any = await response.json();
    expect(body.error).toContain('Not Found');
  });
});
