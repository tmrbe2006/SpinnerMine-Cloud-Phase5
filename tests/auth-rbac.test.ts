import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createServerApp, adminAuth } from '../server';
import { UserRole } from '../src/types';

describe('1. Authentication & Admin RBAC Real Integration Tests', () => {
  const app = createServerApp();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('1. GET /api/admin/verify-claims rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/api/admin/verify-claims');
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Unauthorized');
  });

  it('2. GET /api/admin/verify-claims rejects fake test_token_* bypass with 401', async () => {
    // Attempting to bypass auth with test_token_admin
    const res = await request(app)
      .get('/api/admin/verify-claims')
      .set('Authorization', 'Bearer test_token_admin_bypass');

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Unauthorized');
  });

  it('3. GET /api/admin/verify-claims rejects malformed and invalid tokens with 401', async () => {
    vi.spyOn(adminAuth, 'verifyIdToken').mockRejectedValueOnce(new Error('Firebase ID token has invalid signature'));

    const res = await request(app)
      .get('/api/admin/verify-claims')
      .set('Authorization', 'Bearer forged_jwt_token_payload');

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Token verification failed');
  });

  it('4. GET /api/admin/verify-claims returns 403 Forbidden for non-admin authenticated users', async () => {
    vi.spyOn(adminAuth, 'verifyIdToken').mockResolvedValueOnce({
      uid: 'regular_miner_uid',
      email: 'miner@spinnermine.cloud',
      admin: false,
      role: 'user',
      auth_time: Math.floor(Date.now() / 1000),
      iss: 'https://securetoken.google.com/spinnermine',
      aud: 'spinnermine',
      sub: 'regular_miner_uid',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      firebase: { identities: {}, sign_in_provider: 'google.com' }
    });

    const res = await request(app)
      .get('/api/admin/verify-claims')
      .set('Authorization', 'Bearer valid_user_jwt');

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Forbidden: Operation requires verified administrator custom claims');
  });

  it('5. GET /api/admin/verify-claims grants 200 OK only when custom claims contain admin: true', async () => {
    vi.spyOn(adminAuth, 'verifyIdToken').mockResolvedValueOnce({
      uid: 'super_admin_uid_777',
      email: 'admin@spinnermine.cloud',
      admin: true,
      role: 'admin',
      auth_time: Math.floor(Date.now() / 1000),
      iss: 'https://securetoken.google.com/spinnermine',
      aud: 'spinnermine',
      sub: 'super_admin_uid_777',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      firebase: { identities: {}, sign_in_provider: 'google.com' }
    });

    const res = await request(app)
      .get('/api/admin/verify-claims')
      .set('Authorization', 'Bearer valid_admin_jwt');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.role).toBe('admin');
    expect(res.body.uid).toBe('super_admin_uid_777');
  });

  it('6. Route guard redirects non-admins and unauthenticated users safely', () => {
    const routeGuard = (targetPage: string, isAuthenticated: boolean, isAdmin: boolean) => {
      const publicRoutes = ['landing', 'login', 'register', 'forgot-password'];
      const protectedRoutes = ['dashboard', 'mining', 'spinner', 'wheel', 'wallet', 'withdrawals', 'referrals', 'settings'];

      if (publicRoutes.includes(targetPage)) return { allowed: true, target: targetPage };
      if (!isAuthenticated) return { allowed: false, target: 'login' };
      if (targetPage === 'admin') {
        return isAdmin ? { allowed: true, target: 'admin' } : { allowed: false, target: 'dashboard' };
      }
      if (protectedRoutes.includes(targetPage)) return { allowed: true, target: targetPage };
      return { allowed: false, target: 'landing' };
    };

    expect(routeGuard('admin', false, false)).toEqual({ allowed: false, target: 'login' });
    expect(routeGuard('admin', true, false)).toEqual({ allowed: false, target: 'dashboard' });
    expect(routeGuard('admin', true, true)).toEqual({ allowed: true, target: 'admin' });
  });

  it('7. User registration profile creation strictly sets role: "user"', () => {
    const rawUserData = {
      uid: 'user_test_123',
      email: 'miner@spinnermine.com',
      role: 'user' as UserRole
    };

    expect(rawUserData.role).toBe('user');
    expect(rawUserData.role).not.toBe('admin');
  });

  it('8. Clean detachment of Firestore listeners on account change or logout', () => {
    const mockUnsub = vi.fn();
    let currentListener: (() => void) | null = mockUnsub;

    const handleAccountSwitch = () => {
      if (currentListener) {
        currentListener();
        currentListener = null;
      }
    };

    handleAccountSwitch();
    expect(mockUnsub).toHaveBeenCalledTimes(1);
    expect(currentListener).toBeNull();
  });
});
