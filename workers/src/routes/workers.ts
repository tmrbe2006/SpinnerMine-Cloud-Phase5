import { Env } from '../types';
import { authenticateRequest } from '../auth';
import { getDocument, setDocument, queryCollection } from '../firestore';
import { getServiceAccountAccessToken } from '../serviceAccount';

export async function handleWorkerRegister(request: Request, env: Env): Promise<Response> {
  const { user, rawToken } = await authenticateRequest(request, env);
  const body: any = await request.json().catch(() => ({}));
  const { workerId, name, deviceName, platform, cpuCores, threads, xmrigVersion, installationId } = body;

  const safeInstallationId = installationId && typeof installationId === 'string'
    ? installationId.trim().replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 64)
    : null;

  // Authoritative token: prefer Service Account if configured, else user ID Token
  const serviceToken = await getServiceAccountAccessToken(env);
  const activeToken = serviceToken || rawToken;

  let currentOperation = 'INIT';

  try {
    // 1. Deduplication: Check if an active worker or primary worker exists for this installation or user
    let existingDoc: any = null;
    let safeWorkerId = '';

    try {
      currentOperation = 'QUERY miningWorkers (deduplication)';
      const userWorkers = await queryCollection(
        'miningWorkers',
        { field: 'userId', op: 'EQUAL', value: user.uid },
        activeToken,
        env
      );

      // A. Match active worker by installationId
      if (safeInstallationId) {
        const match = userWorkers.find((w: any) => w.installationId === safeInstallationId && !w.isArchived && !w.mergedInto);
        if (match) {
          existingDoc = match;
          safeWorkerId = match.id || match.workerId;
        } else {
          // If this installation was previously merged, resolve to the primary worker it was merged into
          const mergedMatch = userWorkers.find((w: any) => w.installationId === safeInstallationId && w.mergedInto);
          if (mergedMatch && mergedMatch.mergedInto) {
            const primaryTarget = userWorkers.find((w: any) => (w.id === mergedMatch.mergedInto || w.workerId === mergedMatch.mergedInto) && !w.isArchived && !w.mergedInto);
            if (primaryTarget) {
              existingDoc = primaryTarget;
              safeWorkerId = primaryTarget.id || primaryTarget.workerId;
            }
          }
        }
      }

      // B. Requirement 8: Prevent creating a third device for the primary Windows installation (tm)
      if (!safeWorkerId && (!workerId || workerId === 'w_qBPFqVEe_tm') && (platform === 'windows' || !platform)) {
        const tmWorker = userWorkers.find((w: any) => (w.id === 'w_qBPFqVEe_tm' || w.workerId === 'w_qBPFqVEe_tm' || w.name === 'tm') && !w.isArchived && !w.mergedInto);
        if (tmWorker) {
          existingDoc = tmWorker;
          safeWorkerId = tmWorker.id || tmWorker.workerId;
        }
      }
    } catch (qErr: any) {
      console.warn('[Workers Register] deduplication check note:', qErr.message);
    }

    if (!safeWorkerId) {
      if (!workerId || typeof workerId !== 'string' || workerId.trim().length < 2) {
        return new Response(JSON.stringify({ error: 'Valid workerId is required (minimum 2 characters)' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      safeWorkerId = workerId.trim().replace(/[^a-zA-Z0-9_\-]/g, '');
    }

    const now = new Date().toISOString();
    const resolvedName = String(name || deviceName || existingDoc?.name || safeWorkerId).slice(0, 64);
    const resolvedDevice = String(deviceName || name || existingDoc?.deviceName || 'Windows PC').slice(0, 64);

    // 2. Check existing worker registration and verify ownership if not already fetched
    if (!existingDoc) {
      currentOperation = `GET miningWorkers/${safeWorkerId}`;
      existingDoc = await getDocument('miningWorkers', safeWorkerId, activeToken, env);
      if (existingDoc && existingDoc.userId !== user.uid && !user.admin) {
        return new Response(JSON.stringify({ 
          error: 'Forbidden: Worker ID is already registered to another user account',
          code: 'PERMISSION_DENIED',
          status: 403,
          operation: currentOperation
        }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // 3. Prevent duplicate device names under this user account (ignoring archived or same installation)
    try {
      currentOperation = 'QUERY miningWorkers (name uniqueness)';
      const userWorkers = await queryCollection(
        'miningWorkers',
        { field: 'userId', op: 'EQUAL', value: user.uid },
        activeToken,
        env
      );
      const conflictingDoc = userWorkers.find(
        (w: any) => {
          if (w.id === safeWorkerId) return false;
          if (w.isArchived || w.mergedInto) return false;
          if (safeInstallationId && w.installationId === safeInstallationId) return false;
          return w.name === resolvedName || w.deviceName === resolvedName;
        }
      );
      if (conflictingDoc) {
        return new Response(
          JSON.stringify({
            error: `Conflict: A worker named "${resolvedName}" is already registered on your account with ID: ${conflictingDoc.id}. Please use a unique device name.`,
            code: 'ALREADY_EXISTS',
            status: 409,
            operation: currentOperation
          }),
          {
            status: 409,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }
    } catch (err: any) {
      console.warn('[Workers Register] Device name uniqueness check warning:', err.message);
    }

    // 4. Ensure user profile document exists in users/{uid}
    try {
      currentOperation = `GET users/${user.uid}`;
      const userDoc = await getDocument('users', user.uid, activeToken, env);
      if (!userDoc) {
        currentOperation = `CREATE users/${user.uid}`;
        const defaultProfile = {
          uid: user.uid,
          email: user.email || '',
          displayName: user.email?.split('@')[0] || resolvedName || 'Miner',
          photoURL: '',
          role: 'user', // Least privilege default
          language: 'ar',
          theme: 'dark',
          miningConsent: false,
          referralCode: Math.random().toString(36).substring(2, 8).toUpperCase(),
          createdAt: now,
          updatedAt: now
        };
        await setDocument('users', user.uid, defaultProfile, activeToken, env, true);
      }
    } catch (err: any) {
      console.warn('[Workers Register] Auto-provision user warning:', err.message);
    }

    // 5. Construct authoritative worker document
    // STRICT ISOLATION: Never include balance, earnings, or payout fields
    currentOperation = existingDoc ? `UPDATE miningWorkers/${safeWorkerId}` : `CREATE miningWorkers/${safeWorkerId}`;
    const workerData: Record<string, any> = {
      workerId: safeWorkerId,
      userId: user.uid,
      name: resolvedName,
      deviceName: resolvedDevice,
      platform: ['windows', 'linux', 'mac', 'browser'].includes(platform) ? platform : 'windows',
      cpuCores: Math.max(1, Math.min(128, Number(cpuCores) || 4)),
      threads: Math.max(1, Math.min(64, Number(threads) || 2)),
      xmrigVersion: String(xmrigVersion || '6.26.0').slice(0, 32),
      status: existingDoc?.status || 'offline',
      reportedHashrate: existingDoc?.reportedHashrate ?? 0,
      lastSeen: now,
      createdAt: existingDoc?.createdAt || now,
      updatedAt: now
    };

    if (safeInstallationId) {
      workerData.installationId = safeInstallationId;
    } else if (existingDoc?.installationId) {
      workerData.installationId = existingDoc.installationId;
    }

    if (existingDoc?.isArchived !== undefined) {
      workerData.isArchived = existingDoc.isArchived;
    }
    if (existingDoc?.mergedInto !== undefined) {
      workerData.mergedInto = existingDoc.mergedInto;
    }

    // If writing via privileged service account, preserve acceptedShares count
    if (serviceToken && existingDoc) {
      workerData.acceptedShares = existingDoc.acceptedShares ?? 0;
      workerData.rejectedShares = existingDoc.rejectedShares ?? 0;
    }

    await setDocument('miningWorkers', safeWorkerId, workerData, activeToken, env, true);

    return new Response(
      JSON.stringify({
        success: true,
        worker: workerData,
        message: existingDoc ? 'Mining worker updated successfully' : 'Mining worker successfully paired to account'
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (err: any) {
    console.error(`[Workers Register] Failed during [${currentOperation}]:`, err);
    const isPermissionError = err.status === 403 || err.code === 'PERMISSION_DENIED' || err.message?.includes('PERMISSION_DENIED') || err.message?.includes('Missing or insufficient permissions');
    const httpStatus = isPermissionError ? 403 : (err.status || 500);
    const errCode = isPermissionError ? 'PERMISSION_DENIED' : (err.code || 'DATABASE_ERROR');
    const userFriendlyMsg = isPermissionError
      ? `Firestore permission denied during [${currentOperation}]: Please verify that firestore.rules are published to project spinnermine-cloud-production.`
      : (err.message || 'Unknown database error');

    return new Response(
      JSON.stringify({
        error: `Failed to register mining worker: ${userFriendlyMsg}`,
        code: errCode,
        operation: currentOperation,
        status: httpStatus
      }),
      {
        status: httpStatus,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

export async function handleWorkerRename(request: Request, env: Env): Promise<Response> {
  const { user, rawToken } = await authenticateRequest(request, env);
  const body: any = await request.json().catch(() => ({}));
  const { workerId, name, deviceName } = body;

  if (!workerId || typeof workerId !== 'string') {
    return new Response(JSON.stringify({ error: 'Valid workerId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const safeWorkerId = workerId.trim().replace(/[^a-zA-Z0-9_\-]/g, '');
  const newName = String(name || deviceName || '').trim().slice(0, 64);
  if (!newName) {
    return new Response(JSON.stringify({ error: 'A valid non-empty name is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const serviceToken = await getServiceAccountAccessToken(env);
  const activeToken = serviceToken || rawToken;

  try {
    const existingDoc = await getDocument('miningWorkers', safeWorkerId, activeToken, env);
    if (!existingDoc) {
      return new Response(JSON.stringify({ error: 'Worker not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (existingDoc.userId !== user.uid && !user.admin) {
      return new Response(JSON.stringify({ error: 'Forbidden: You do not own this worker device' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const now = new Date().toISOString();
    await setDocument('miningWorkers', safeWorkerId, {
      name: newName,
      deviceName: String(deviceName || newName).trim().slice(0, 64),
      updatedAt: now
    }, activeToken, env, true);

    return new Response(JSON.stringify({
      success: true,
      workerId: safeWorkerId,
      name: newName,
      message: 'Worker renamed successfully without altering device identity'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: `Failed to rename worker: ${err.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function handleWorkerLinkInstallation(request: Request, env: Env): Promise<Response> {
  const { user, rawToken } = await authenticateRequest(request, env);
  const body: any = await request.json().catch(() => ({}));
  const { workerId, installationId, consentConfirmed } = body;

  if (!workerId || typeof workerId !== 'string') {
    return new Response(JSON.stringify({ error: 'Valid workerId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!installationId || typeof installationId !== 'string' || !installationId.startsWith('inst_')) {
    return new Response(JSON.stringify({ error: 'Valid installationId starting with inst_ is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Requirement 5: Link after explicit user consent
  if (!consentConfirmed) {
    return new Response(JSON.stringify({ error: 'Explicit user consent is required to link permanent installation identity' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const safeWorkerId = workerId.trim().replace(/[^a-zA-Z0-9_\-]/g, '');
  const safeInstallationId = installationId.trim().replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 64);
  const serviceToken = await getServiceAccountAccessToken(env);
  const activeToken = serviceToken || rawToken;

  try {
    const existingDoc = await getDocument('miningWorkers', safeWorkerId, activeToken, env);
    if (!existingDoc) {
      return new Response(JSON.stringify({ error: 'Worker not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Requirement 3 & 6: Verify Firebase UID and worker ownership
    if (existingDoc.userId !== user.uid && !user.admin) {
      return new Response(JSON.stringify({ 
        error: 'Forbidden: You do not own this worker device',
        code: 'PERMISSION_DENIED'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check if another active worker already has this installationId
    const userWorkers = await queryCollection(
      'miningWorkers',
      { field: 'userId', op: 'EQUAL', value: user.uid },
      activeToken,
      env
    );
    const conflictingWorker = userWorkers.find((w: any) => 
      w.id !== safeWorkerId && 
      w.workerId !== safeWorkerId && 
      w.installationId === safeInstallationId && 
      !w.isArchived && 
      !w.mergedInto
    );

    if (conflictingWorker) {
      return new Response(JSON.stringify({ 
        error: `Conflict: Installation ID is already assigned to active worker ${conflictingWorker.id || conflictingWorker.name}. Please resolve duplicate devices first.`,
        code: 'ALREADY_EXISTS'
      }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const now = new Date().toISOString();
    // Requirement 4, 9, 10: Preserve workerId, acceptedShares, retain all fields, zero financial impact
    await setDocument('miningWorkers', safeWorkerId, {
      installationId: safeInstallationId,
      installationLinkedAt: now,
      updatedAt: now
    }, activeToken, env, true);

    return new Response(JSON.stringify({
      success: true,
      workerId: safeWorkerId,
      installationId: safeInstallationId,
      name: existingDoc.name,
      retainedAcceptedShares: existingDoc.acceptedShares || 0,
      financialBalanceImpact: 0,
      message: `Permanent installation ID successfully linked to worker ${safeWorkerId}.`
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: `Failed to link installation ID: ${err.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function handleWorkerDuplicates(request: Request, env: Env): Promise<Response> {
  const { user, rawToken } = await authenticateRequest(request, env);
  const serviceToken = await getServiceAccountAccessToken(env);
  const activeToken = serviceToken || rawToken;

  try {
    const allWorkers = await queryCollection(
      'miningWorkers',
      { field: 'userId', op: 'EQUAL', value: user.uid },
      activeToken,
      env
    );

    const activeWorkers = allWorkers.filter((w: any) => !w.isArchived && !w.mergedInto && w.status !== 'archived');
    const groups: Array<{
      primaryWorkerId: string;
      primaryName: string;
      duplicateWorkerId: string;
      duplicateName: string;
      reason: string;
      duplicateSessionsCount: number;
      duplicateAcceptedShares: number;
    }> = [];

    // Group by installationId
    const byInst = new Map<string, any[]>();
    for (const w of activeWorkers) {
      if (w.installationId) {
        const list = byInst.get(w.installationId) || [];
        list.push(w);
        byInst.set(w.installationId, list);
      }
    }

    for (const [_, list] of byInst.entries()) {
      if (list.length > 1) {
        const sorted = [...list].sort((a, b) => {
          if (a.id === 'w_qBPFqVEe_tm' || a.name === 'tm') return -1;
          if (b.id === 'w_qBPFqVEe_tm' || b.name === 'tm') return 1;
          return (a.createdAt || '').localeCompare(b.createdAt || '');
        });
        const primary = sorted[0];
        for (let i = 1; i < sorted.length; i++) {
          const dup = sorted[i];
          groups.push({
            primaryWorkerId: primary.id,
            primaryName: primary.name || primary.deviceName || primary.id,
            duplicateWorkerId: dup.id,
            duplicateName: dup.name || dup.deviceName || dup.id,
            reason: 'Identical Installation ID',
            duplicateSessionsCount: 0,
            duplicateAcceptedShares: dup.acceptedShares || 0
          });
        }
      }
    }

    // Check known legacy pair (tm vs ty)
    const tmDoc = activeWorkers.find((w: any) => w.id === 'w_qBPFqVEe_tm' || w.name === 'tm');
    const tyDoc = activeWorkers.find((w: any) => w.id === 'w_GyAldfJ5_ty' || w.name === 'ty');
    if (tmDoc && tyDoc && tmDoc.id !== tyDoc.id) {
      const already = groups.some(g => g.primaryWorkerId === tmDoc.id && g.duplicateWorkerId === tyDoc.id);
      if (!already) {
        groups.push({
          primaryWorkerId: tmDoc.id,
          primaryName: tmDoc.name || 'tm',
          duplicateWorkerId: tyDoc.id,
          duplicateName: tyDoc.name || 'ty',
          reason: 'Legacy Windows PC Duplicate Registration',
          duplicateSessionsCount: 0,
          duplicateAcceptedShares: tyDoc.acceptedShares || 0
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      duplicatesFound: groups.length > 0,
      groups
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: `Failed to inspect duplicate workers: ${err.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function handleWorkerArchive(request: Request, env: Env): Promise<Response> {
  const { user, rawToken } = await authenticateRequest(request, env);
  const body: any = await request.json().catch(() => ({}));
  const { workerId, reason } = body;

  if (!workerId || typeof workerId !== 'string') {
    return new Response(JSON.stringify({ error: 'Valid workerId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const safeWorkerId = workerId.trim().replace(/[^a-zA-Z0-9_\-]/g, '');
  const serviceToken = await getServiceAccountAccessToken(env);
  const activeToken = serviceToken || rawToken;

  try {
    const existingDoc = await getDocument('miningWorkers', safeWorkerId, activeToken, env);
    if (!existingDoc) {
      return new Response(JSON.stringify({ error: 'Worker not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (existingDoc.userId !== user.uid && !user.admin) {
      return new Response(JSON.stringify({ error: 'Forbidden: You do not own this worker device' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const now = new Date().toISOString();
    await setDocument('miningWorkers', safeWorkerId, {
      isArchived: true,
      archivedAt: now,
      archiveReason: String(reason || 'user_archived').slice(0, 128),
      status: 'archived',
      updatedAt: now
    }, activeToken, env, true);

    return new Response(JSON.stringify({
      success: true,
      workerId: safeWorkerId,
      message: 'Worker safely archived without document deletion or financial modification'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: `Failed to archive worker: ${err.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function handleWorkerMerge(request: Request, env: Env): Promise<Response> {
  const { user, rawToken } = await authenticateRequest(request, env);
  const body: any = await request.json().catch(() => ({}));
  const { primaryWorkerId, secondaryWorkerId, reason } = body;

  if (!primaryWorkerId || !secondaryWorkerId) {
    return new Response(JSON.stringify({ error: 'Both primaryWorkerId and secondaryWorkerId are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const safePrimary = String(primaryWorkerId).trim().replace(/[^a-zA-Z0-9_\-]/g, '');
  const safeSecondary = String(secondaryWorkerId).trim().replace(/[^a-zA-Z0-9_\-]/g, '');

  if (safePrimary === safeSecondary) {
    return new Response(JSON.stringify({ error: 'Cannot merge a worker into itself' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const serviceToken = await getServiceAccountAccessToken(env);
  const activeToken = serviceToken || rawToken;

  try {
    const [primaryDoc, secondaryDoc] = await Promise.all([
      getDocument('miningWorkers', safePrimary, activeToken, env),
      getDocument('miningWorkers', safeSecondary, activeToken, env)
    ]);

    if (!primaryDoc || !secondaryDoc) {
      return new Response(JSON.stringify({ 
        error: 'One or both worker documents not found',
        code: 'NOT_FOUND' 
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Requirement 4: Strictly prevent merging workers belonging to different users
    if (primaryDoc.userId !== secondaryDoc.userId) {
      return new Response(JSON.stringify({ 
        error: 'Forbidden: Cannot merge workers belonging to different user accounts',
        code: 'CROSS_USER_MERGE_FORBIDDEN'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Requirement 3: Verify caller ownership of both documents
    if (primaryDoc.userId !== user.uid && !user.admin) {
      return new Response(JSON.stringify({ 
        error: 'Forbidden: You do not own the primary worker device',
        code: 'PERMISSION_DENIED'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (secondaryDoc.userId !== user.uid && !user.admin) {
      return new Response(JSON.stringify({ 
        error: 'Forbidden: You do not own the duplicate worker device',
        code: 'PERMISSION_DENIED'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Requirement 5: Verify linked sessions and historical mining contributions before merge
    let secondarySessionsCount = 0;
    try {
      const userSessions = await queryCollection(
        'miningSessions',
        { field: 'userId', op: 'EQUAL', value: user.uid },
        activeToken,
        env
      );
      secondarySessionsCount = userSessions.filter((s: any) => (s.workerId === safeSecondary || s.id === safeSecondary)).length;
    } catch (sessErr: any) {
      console.warn('[Worker Merge] Session query notice:', sessErr.message);
    }

    const retainedAcceptedShares = Number(secondaryDoc.acceptedShares) || 0;
    const retainedRejectedShares = Number(secondaryDoc.rejectedShares) || 0;
    const now = new Date().toISOString();
    const mergeReason = String(reason || `merged_into_${safePrimary}`).slice(0, 128);

    // Requirement 6: NEVER delete document! Preserve duplicate with full audit trail and status: archived
    await setDocument('miningWorkers', safeSecondary, {
      mergedInto: safePrimary,
      mergedAt: now,
      isArchived: true,
      archivedAt: now,
      archiveReason: mergeReason,
      status: 'archived',
      updatedAt: now
    }, activeToken, env, true);

    return new Response(JSON.stringify({
      success: true,
      primaryWorkerId: safePrimary,
      mergedWorkerId: safeSecondary,
      primaryName: primaryDoc.name || primaryDoc.deviceName || safePrimary,
      duplicateName: secondaryDoc.name || secondaryDoc.deviceName || safeSecondary,
      retainedAcceptedShares,
      retainedRejectedShares,
      auditedSessionsCount: secondarySessionsCount,
      financialBalanceImpact: 0, // Strict zero balance change: financial integrity guaranteed
      auditRecord: {
        action: 'WORKER_MERGE',
        mergedBy: user.uid,
        primaryWorkerId: safePrimary,
        duplicateWorkerId: safeSecondary,
        timestamp: now,
        reason: mergeReason,
        retainedAcceptedShares,
        auditedSessionsCount: secondarySessionsCount
      },
      message: `Worker ${safeSecondary} safely merged into primary worker ${safePrimary}. Document retained for audit.`
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: `Failed to merge workers: ${err.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function handleWorkersList(request: Request, env: Env): Promise<Response> {
  const { user, rawToken } = await authenticateRequest(request, env);
  const serviceToken = await getServiceAccountAccessToken(env);
  const activeToken = serviceToken || rawToken;

  try {
    const filter = user.admin ? null : { field: 'userId', op: 'EQUAL' as const, value: user.uid };
    const workers = await queryCollection('miningWorkers', filter, activeToken, env);
    return new Response(JSON.stringify({ success: true, workers }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: `Failed to fetch workers: ${err.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function handleWorkerTelemetry(request: Request, env: Env): Promise<Response> {
  const { user, rawToken } = await authenticateRequest(request, env);
  const body: any = await request.json().catch(() => ({}));
  const { workerId, reportedHashrate, status, sessionId, lastError, cpuUsage, threads } = body;

  if (!workerId || typeof workerId !== 'string') {
    return new Response(JSON.stringify({ error: 'Valid workerId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const safeWorkerId = workerId.trim().replace(/[^a-zA-Z0-9_\-]/g, '');
  const serviceToken = await getServiceAccountAccessToken(env);
  const activeToken = serviceToken || rawToken;

  try {
    const existingDoc = await getDocument('miningWorkers', safeWorkerId, activeToken, env);
    if (!existingDoc) {
      return new Response(JSON.stringify({ 
        error: 'Worker not found. Please register this device first before transmitting telemetry.',
        code: 'NOT_FOUND',
        status: 404
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (existingDoc && existingDoc.userId !== user.uid && !user.admin) {
      return new Response(JSON.stringify({ 
        error: 'Forbidden: You do not own this worker device registration',
        code: 'PERMISSION_DENIED',
        status: 403
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const now = new Date().toISOString();
    const telemetryUpdate: Record<string, any> = {
      workerId: safeWorkerId,
      userId: user.uid,
      lastSeen: now,
      updatedAt: now,
      status: ['registered', 'online', 'offline', 'mining', 'paused', 'error'].includes(status) ? status : 'online',
      reportedHashrate: Math.max(0, Number(reportedHashrate) || 0)
    };

    if (sessionId) telemetryUpdate.sessionId = String(sessionId).slice(0, 128);
    if (lastError !== undefined) telemetryUpdate.lastError = String(lastError).slice(0, 500);
    if (threads !== undefined) telemetryUpdate.threads = Math.max(1, Number(threads) || 1);
    if (cpuUsage !== undefined) telemetryUpdate.cpuUsage = Math.min(100, Math.max(0, Number(cpuUsage) || 0));

    let finalCpuUsage = telemetryUpdate.cpuUsage;
    let fallbackNotice: string | undefined;

    try {
      await setDocument('miningWorkers', safeWorkerId, telemetryUpdate, activeToken, env, true);
    } catch (patchErr: any) {
      const isPermissionDenied = patchErr.status === 403 || 
                                 patchErr.code === 'PERMISSION_DENIED' || 
                                 patchErr.message?.includes('PERMISSION_DENIED') || 
                                 patchErr.message?.includes('Missing or insufficient permissions');

      // Backward-compatibility: If legacy published rules reject cpuUsage, retry without cpuUsage
      if (isPermissionDenied && telemetryUpdate.cpuUsage !== undefined) {
        console.warn(`[Worker Telemetry] Firestore PATCH returned 403 with cpuUsage. Retrying without cpuUsage for legacy production rules compatibility...`);
        const fallbackUpdate = { ...telemetryUpdate };
        delete fallbackUpdate.cpuUsage;
        try {
          await setDocument('miningWorkers', safeWorkerId, fallbackUpdate, activeToken, env, true);
          finalCpuUsage = undefined;
          fallbackNotice = 'Heartbeat updated in Firestore (cpuUsage omitted: update firestore.rules in Firebase Production to enable cpuUsage persistence)';
        } catch (retryErr: any) {
          // If retry still fails, throw original error
          throw patchErr;
        }
      } else {
        throw patchErr;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        telemetryRecorded: true,
        version: '1.0.3',
        workerId: safeWorkerId,
        reportedHashrate: telemetryUpdate.reportedHashrate,
        cpuUsage: finalCpuUsage,
        status: telemetryUpdate.status,
        financialBalanceImpact: 0, // Strict zero balance change: verified pool daemon required for revenue
        timestamp: now,
        ...(fallbackNotice ? { notice: fallbackNotice } : {})
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (err: any) {
    console.error('[Worker Telemetry] Failed:', err);
    const isPermissionError = err.status === 403 || err.code === 'PERMISSION_DENIED' || err.message?.includes('PERMISSION_DENIED') || err.message?.includes('Missing or insufficient permissions');
    const httpStatus = isPermissionError ? 403 : (err.status || 500);
    const errCode = isPermissionError ? 'PERMISSION_DENIED' : (err.code || 'DATABASE_ERROR');
    return new Response(
      JSON.stringify({ 
        error: `Failed to record worker telemetry: ${err.message}`,
        code: errCode,
        status: httpStatus
      }),
      {
        status: httpStatus,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}
