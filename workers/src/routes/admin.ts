import { Env } from '../types';
import { authenticateRequest } from '../auth';

export async function handleAdminVerifyClaims(request: Request, env: Env): Promise<Response> {
  const { user } = await authenticateRequest(request, env);

  if (!user.admin) {
    return new Response(
      JSON.stringify({ error: 'Forbidden: Operation requires verified administrator custom claims.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({
      success: true,
      uid: user.uid,
      email: user.email,
      role: 'admin',
      verifiedAt: new Date().toISOString()
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
