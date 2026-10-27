import { describe, it, expect } from 'vitest';
import worker, { getCorsHeaders } from '../src/index';
import { createMockEnv } from './testHelpers';

describe('Cloudflare Worker - CORS & Electron Origin Validation', () => {
  const env = createMockEnv();

  it('handles OPTIONS preflight with HTTP 204 and CORS headers', async () => {
    const req = new Request('https://worker.spinnermine.workers.dev/api/health', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://spinnermine-cloud-production.web.app',
        'Access-Control-Request-Method': 'GET'
      }
    });

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://spinnermine-cloud-production.web.app');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });

  it('allows approved production Firebase Hosting web origin', async () => {
    const req = new Request('https://worker.spinnermine.workers.dev/api/health', {
      method: 'GET',
      headers: {
        Origin: 'https://spinnermine-cloud-production.web.app'
      }
    });

    const res = await worker.fetch(req, env);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://spinnermine-cloud-production.web.app');
    expect(res.headers.get('Vary')).toContain('Origin');
  });

  it('allows localhost development origins when ALLOW_LOCALHOST_ORIGIN is true', async () => {
    const req = new Request('https://worker.spinnermine.workers.dev/api/health', {
      method: 'GET',
      headers: {
        Origin: 'http://localhost:3000'
      }
    });

    const res = await worker.fetch(req, env);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
  });

  it('does NOT reflect unauthorized origin, denying CORS access for rogue websites', async () => {
    const req = new Request('https://worker.spinnermine.workers.dev/api/health', {
      method: 'GET',
      headers: {
        Origin: 'https://attacker-website.com'
      }
    });

    const res = await worker.fetch(req, env);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('permits Electron desktop client running with Origin: null', async () => {
    const req = new Request('https://worker.spinnermine.workers.dev/api/health', {
      method: 'GET',
      headers: {
        Origin: 'null'
      }
    });

    const res = await worker.fetch(req, env);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('null');
  });

  it('permits native desktop requests without an Origin header', async () => {
    const req = new Request('https://worker.spinnermine.workers.dev/api/health', {
      method: 'GET'
    });

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
  });
});
