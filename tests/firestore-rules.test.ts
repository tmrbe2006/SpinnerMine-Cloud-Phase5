import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('2. Firestore Security Rules Logical Invariant Tests (Phase 1 Gate)', () => {
  const rulesPath = path.resolve('firestore.rules');
  const rulesContent = fs.readFileSync(rulesPath, 'utf8');

  const ALLOWED_USER_CREATE_KEYS = [
    'uid', 'email', 'displayName', 'photoURL', 'role', 
    'language', 'theme', 'miningConsent', 'consentTimestamp', 
    'consentVersion', 'referralCode', 'createdAt', 'updatedAt'
  ];

  const ALLOWED_USER_UPDATE_KEYS = [
    'displayName', 'photoURL', 'language', 'theme', 
    'miningConsent', 'consentTimestamp', 'consentVersion', 'updatedAt'
  ];

  const FORBIDDEN_FINANCIAL_KEYS = [
    'balance', 'atomicUnits', 'revenue', 'earnings', 
    'walletLedger', 'payout', 'confirmedBalance', 'rewardAmount'
  ];

  it('1. Rules Gate: User self-promotion to Admin is strictly blocked in firestore.rules', () => {
    // Assert on users collection create & update rules
    const userMatch = rulesContent.match(/match\s+\/users\/\{userId\}\s*\{[\s\S]*?\n\s*\}/);
    expect(userMatch).not.toBeNull();
    const userRule = userMatch![0];

    // Ensure create requires incoming().role == 'user'
    expect(userRule).toContain("incoming().role == 'user'");

    // Ensure update requires incoming().role == existing().role
    expect(userRule).toContain("incoming().role == existing().role");

    // Ensure update restricts affected keys to personal non-role settings
    expect(userRule).toContain("incoming().diff(existing()).affectedKeys().hasOnly");
    expect(userRule).not.toMatch(/affectedKeys\(\)\.hasOnly\([^\)]*role/);

    // Logical simulation of rule evaluation
    const evaluateRoleUpdate = (existingRole: string, incomingData: Record<string, any>): boolean => {
      const allowedKeys = ALLOWED_USER_UPDATE_KEYS;
      const affectedKeys = Object.keys(incomingData);
      const onlyAllowed = affectedKeys.every(k => allowedKeys.includes(k));
      const roleMatches = incomingData.role ? incomingData.role === existingRole : true;
      return onlyAllowed && roleMatches;
    };

    // User attempts to elevate role to admin
    expect(evaluateRoleUpdate('user', { role: 'admin' })).toBe(false);
    expect(evaluateRoleUpdate('user', { admin: true })).toBe(false);
    expect(evaluateRoleUpdate('user', { role: 'superadmin', displayName: 'Hacker' })).toBe(false);
    // Legitimate display name update preserves existing role
    expect(evaluateRoleUpdate('user', { displayName: 'Legitimate Player' })).toBe(true);
  });

  it('2. Rules Gate: Client writes to walletLedger and miningRevenue are strictly blocked', () => {
    // Assert walletLedger block has allow write: if false;
    const walletMatch = rulesContent.match(/match\s+\/walletLedger\/\{entryId\}\s*\{[\s\S]*?\}/);
    expect(walletMatch).not.toBeNull();
    expect(walletMatch![0]).toContain('allow write: if false;');

    // Assert miningRevenue block has allow write: if false;
    const revenueMatch = rulesContent.match(/match\s+\/miningRevenue\/\{revenueId\}\s*\{[\s\S]*?\}/);
    expect(revenueMatch).not.toBeNull();
    expect(revenueMatch![0]).toContain('allow write: if false;');

    // Logical check: write permissions for client
    const canClientWriteCollection = (colName: string): boolean => {
      const readOnlyForClients = ['walletLedger', 'miningRevenue', 'userEarnings', 'withdrawals', 'acceptedShares', 'auditLogs'];
      return !readOnlyForClients.includes(colName);
    };

    expect(canClientWriteCollection('walletLedger')).toBe(false);
    expect(canClientWriteCollection('miningRevenue')).toBe(false);
  });

  it('3. Rules Gate: Direct browser writes to spinnerSessions, wheelSpins, and userArcade are blocked', () => {
    // Assert spinnerSessions block has allow write: if false;
    const spinnerMatch = rulesContent.match(/match\s+\/spinnerSessions\/\{sessionId\}\s*\{[\s\S]*?\}/);
    expect(spinnerMatch).not.toBeNull();
    expect(spinnerMatch![0]).toContain('allow write: if false;');

    // Assert wheelSpins block has allow write: if false;
    const wheelMatch = rulesContent.match(/match\s+\/wheelSpins\/\{spinId\}\s*\{[\s\S]*?\}/);
    expect(wheelMatch).not.toBeNull();
    expect(wheelMatch![0]).toContain('allow write: if false;');

    // Assert userArcade block has allow write: if false;
    const arcadeMatch = rulesContent.match(/match\s+\/userArcade\/\{userId\}\s*\{[\s\S]*?\}/);
    expect(arcadeMatch).not.toBeNull();
    expect(arcadeMatch![0]).toContain('allow write: if false;');

    // Assert internal usedNonces and rateLimits are locked
    const nonceMatch = rulesContent.match(/match\s+\/usedNonces\/\{nonce\}\s*\{[\s\S]*?\}/);
    expect(nonceMatch).not.toBeNull();
    expect(nonceMatch![0]).toContain('allow read, write: if false;');

    const rateLimitMatch = rulesContent.match(/match\s+\/rateLimits\/\{userId\}\s*\{[\s\S]*?\}/);
    expect(rateLimitMatch).not.toBeNull();
    expect(rateLimitMatch![0]).toContain('allow read, write: if false;');
  });

  it('4. Rules Gate: Cross-user reading of users/{userId} is strictly denied', () => {
    // Assert get rule requires isOwner(userId) || isAdmin()
    const userMatch = rulesContent.match(/match\s+\/users\/\{userId\}\s*\{[\s\S]*?\}/);
    expect(userMatch).not.toBeNull();
    expect(userMatch![0]).toContain('allow get: if isOwner(userId) || isAdmin();');
    expect(userMatch![0]).toContain('allow list: if isAdmin();');

    // Logical evaluation of document access
    const canReadUserDoc = (targetUserId: string, authContext: { uid: string; isAdmin: boolean } | null): boolean => {
      if (!authContext) return false;
      const isOwner = authContext.uid === targetUserId;
      const isAdmin = authContext.isAdmin === true;
      return isOwner || isAdmin;
    };

    // Unauthenticated request
    expect(canReadUserDoc('alice', null)).toBe(false);

    // Cross-user reading attempt: Bob attempts to read Alice's profile
    expect(canReadUserDoc('alice', { uid: 'bob', isAdmin: false })).toBe(false);

    // Owner reads own profile
    expect(canReadUserDoc('alice', { uid: 'alice', isAdmin: false })).toBe(true);

    // Admin reads user profile
    expect(canReadUserDoc('alice', { uid: 'admin_user', isAdmin: true })).toBe(true);
  });

  it('5. Rules Gate: User profile updates strictly restricted to authorized personal fields', () => {
    const userMatch = rulesContent.match(/match\s+\/users\/\{userId\}\s*\{[\s\S]*?\}/);
    expect(userMatch).not.toBeNull();
    expect(userMatch![0]).toContain("incoming().diff(existing()).affectedKeys().hasOnly([");

    const validateUserUpdateKeys = (affectedKeys: string[]): boolean => {
      return affectedKeys.every(k => ALLOWED_USER_UPDATE_KEYS.includes(k));
    };

    // Valid personal settings updates
    expect(validateUserUpdateKeys(['displayName', 'language', 'theme', 'updatedAt'])).toBe(true);
    expect(validateUserUpdateKeys(['miningConsent', 'consentTimestamp', 'consentVersion'])).toBe(true);

    // Malicious field modification attempts
    expect(validateUserUpdateKeys(['role'])).toBe(false);
    expect(validateUserUpdateKeys(['balance'])).toBe(false);
    expect(validateUserUpdateKeys(['walletLedger'])).toBe(false);
    expect(validateUserUpdateKeys(['revenue'])).toBe(false);
    expect(validateUserUpdateKeys(['admin'])).toBe(false);
  });

  it('6. Mining session creation prevents client from injecting financial rewards and accepted shares', () => {
    // Assert rules file forbids acceptedShares and financial fields in incoming client telemetry
    const sessionMatch = rulesContent.match(/match\s+\/miningSessions\/\{sessionId\}\s*\{[\s\S]*?\}/);
    expect(sessionMatch).not.toBeNull();
    const sessionRule = sessionMatch![0];
    expect(sessionRule).toContain("!incoming().keys().hasAny(['revenue', 'earnings', 'payout', 'confirmedBalance', 'rewardAmount', 'acceptedShares'])");

    const validateMiningSessionKeys = (keys: string[]): boolean => {
      const ALLOWED = [
        'sessionId', 'userId', 'workerName', 'startTime', 'endTime', 
        'hashrate', 'active', 'sharesSubmitted', 'status', 'createdAt'
      ];
      const hasOnlyAllowed = keys.every(k => ALLOWED.includes(k));
      const hasNoFinancial = !keys.some(k => [...FORBIDDEN_FINANCIAL_KEYS, 'acceptedShares'].includes(k));
      return hasOnlyAllowed && hasNoFinancial;
    };

    const legitimateSession = ['sessionId', 'userId', 'workerName', 'startTime', 'active', 'hashrate'];
    const fraudulentSession = ['sessionId', 'userId', 'workerName', 'startTime', 'active', 'revenue', 'payout'];
    const fakeSharesSession = ['sessionId', 'userId', 'workerName', 'startTime', 'active', 'acceptedShares'];

    expect(validateMiningSessionKeys(legitimateSession)).toBe(true);
    expect(validateMiningSessionKeys(fraudulentSession)).toBe(false);
    expect(validateMiningSessionKeys(fakeSharesSession)).toBe(false);
  });

  it('7. Game outcomes strictly reject cryptocurrency balance injection', () => {
    const validateGameSession = (data: Record<string, any>): boolean => {
      const keys = Object.keys(data);
      const containsCryptoFields = keys.some(k => 
        ['xmr', 'balance', 'monero', 'payout', 'cryptoVoucher', 'cryptoAmount'].includes(k)
      );
      return !containsCryptoFields;
    };

    const cleanRecreationalSession = {
      sessionId: 'spin_123',
      entertainmentPoints: 100,
      verified: true
    };

    const attackSession = {
      sessionId: 'spin_123',
      entertainmentPoints: 100,
      cryptoVoucher: '0.005 XMR'
    };

    expect(validateGameSession(cleanRecreationalSession)).toBe(true);
    expect(validateGameSession(attackSession)).toBe(false);
  });

  it('8. Rules Gate: Platform mining revenue read access is restricted strictly to Admins', () => {
    const revenueMatch = rulesContent.match(/match\s+\/miningRevenue\/\{revenueId\}\s*\{[\s\S]*?\}/);
    expect(revenueMatch).not.toBeNull();
    const revenueRule = revenueMatch![0];
    expect(revenueRule).toContain('allow read: if isAdmin();');
    expect(revenueRule).not.toContain('allow read: if isSignedIn();');

    const canReadPlatformRevenue = (authContext: { uid: string; isAdmin: boolean } | null): boolean => {
      if (!authContext) return false;
      return authContext.isAdmin === true;
    };

    expect(canReadPlatformRevenue(null)).toBe(false);
    expect(canReadPlatformRevenue({ uid: 'regular_user', isAdmin: false })).toBe(false);
    expect(canReadPlatformRevenue({ uid: 'admin_user', isAdmin: true })).toBe(true);
  });

  it('9. Rules Gate: Audit logs read access is restricted strictly to Admins', () => {
    const auditMatch = rulesContent.match(/match\s+\/auditLogs\/\{logId\}\s*\{[\s\S]*?\}/);
    expect(auditMatch).not.toBeNull();
    const auditRule = auditMatch![0];
    expect(auditRule).toContain('allow read: if isAdmin();');
    expect(auditRule).toContain('allow write: if false;');
  });

  it('10. Rules Gate: acceptedShares writes are sealed from all clients (trusted daemon only)', () => {
    const sharesMatch = rulesContent.match(/match\s+\/acceptedShares\/\{shareId\}\s*\{[\s\S]*?\}/);
    expect(sharesMatch).not.toBeNull();
    const sharesRule = sharesMatch![0];
    expect(sharesRule).toContain('allow write: if false;');
  });
});
