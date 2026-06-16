/**
 * POST /api/submit
 * Validates an email address and inserts it into the D1 `signups` table.
 * D1 binding name: DB (configure in Cloudflare Pages → Settings → Functions → D1 bindings)
 *
 * Export the signups list:
 *   wrangler d1 execute sunplanner-waitlist --command "SELECT email, created_at FROM signups ORDER BY created_at DESC;"
 */

export async function onRequestPost(context) {
  const { request, env } = context;

  // Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  // Validate email
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: 'A valid email address is required.' }, { status: 400 });
  }

  // Guard: DB must be bound
  if (!env.DB) {
    console.error('D1 binding "DB" is not configured.');
    return Response.json({ error: 'Service unavailable.' }, { status: 503 });
  }

  try {
    await env.DB
      .prepare("INSERT INTO signups (email, created_at) VALUES (?, datetime('now'))")
      .bind(email)
      .run();

    return Response.json({ success: true });
  } catch (err) {
    // UNIQUE constraint = already signed up — treat as success to avoid leaking info
    const msg = String(err?.message ?? '') + String(err?.cause?.message ?? '');
    if (msg.includes('UNIQUE') || msg.includes('unique')) {
      return Response.json({ success: true });
    }
    console.error('DB insert error:', err);
    return Response.json({ error: 'Server error — please try again.' }, { status: 500 });
  }
}

// Reject non-POST methods cleanly
export async function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  return new Response('Method Not Allowed', { status: 405 });
}
