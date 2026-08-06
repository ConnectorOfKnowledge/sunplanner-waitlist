const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_SECONDS = 600; // 10 minutes

function optionalCampaignValue(value, maxLength) {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  if (!clean || clean.length > maxLength || !/^[a-zA-Z0-9._:/-]+$/.test(clean)) return null;
  return clean;
}

function optionalLandingPath(value) {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  if (!clean || clean.length > 300 || !clean.startsWith('/') || /[\u0000-\u001f\u007f?#]/.test(clean)) return null;
  return clean;
}

// KV-based limiter, not the Workers ratelimit binding: the binding's `period`
// field only accepts 10 or 60 seconds (verified against Cloudflare docs
// 2026-07-02), so it can't express a 10-minute window. Fixed-window counter,
// not sliding -- read-then-write has a small race under concurrent bursts,
// which is acceptable here (this stops a scripted loop and a real retry, not
// a coordinated distributed attack that needs atomic precision).
async function checkRateLimit(request, env) {
  if (!env.RATE_LIMIT_KV) return true; // fail open if binding is missing
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  const hashed = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  const key = `rl:${hashed}`;

  const current = await env.RATE_LIMIT_KV.get(key);
  const count = current ? parseInt(current, 10) : 0;
  if (count >= RATE_LIMIT_MAX) return false;

  await env.RATE_LIMIT_KV.put(key, String(count + 1), { expirationTtl: RATE_LIMIT_WINDOW_SECONDS });
  return true;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const withinLimit = await checkRateLimit(request, env);
  if (!withinLimit) {
    return Response.json(
      { success: false, error: 'Too many requests. Please try again in a few minutes.' },
      { status: 429 }
    );
  }

  const announcedLength = Number(request.headers.get('Content-Length') || 0);
  if (announcedLength > 4096) {
    return Response.json({ success: false, error: 'Request is too large.' }, { status: 413 });
  }

  let rawBody;
  try {
    rawBody = await request.text();
  } catch {
    return Response.json({ success: false, error: 'Invalid request body.' }, { status: 400 });
  }
  if (new TextEncoder().encode(rawBody).byteLength > 4096) {
    return Response.json({ success: false, error: 'Request is too large.' }, { status: 413 });
  }

  let data;
  try {
    data = JSON.parse(rawBody);
  } catch {
    return Response.json({ success: false, error: 'Invalid JSON.' }, { status: 400 });
  }

  // Honeypot: legitimate users never populate this hidden field, bots that
  // blind-fill every input do. Respond as if successful so bots don't learn
  // to skip the field, but never touch the database.
  if (typeof data.website === 'string' && data.website.trim() !== '') {
    return Response.json({ success: true });
  }

  // Validate email
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return Response.json(
      { success: false, error: 'A valid email address is required.' },
      { status: 400 }
    );
  }

  // Validate platform; default to android if missing or unrecognised
  const raw = typeof data.platform === 'string' ? data.platform.toLowerCase().trim() : '';
  const platform = ['android', 'iphone'].includes(raw) ? raw : 'android';

  // Name is optional; sanitise to plain text. Strip any leading character that
  // spreadsheet software (Excel/Sheets) interprets as a formula prefix, since
  // this column gets exported for the Play Store closed-test tester list.
  let name = typeof data.name === 'string' ? data.name.trim().slice(0, 80) : null;
  if (name) {
    name = name.replace(/^[=+\-@\t\r]+/, '').trim() || null;
  }

  // Campaign fields are deliberately small, optional, and parameterized. They
  // describe the website visit; they are not trusted as commands or URLs.
  const source = optionalCampaignValue(data.source, 100);
  const medium = optionalCampaignValue(data.medium, 60);
  const landingPath = optionalLandingPath(data.landing_path);

  try {
    try {
      await env.DB.prepare(
        'INSERT INTO signups (email, platform, name, campaign_source, campaign_medium, landing_path) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(email, platform, name || null, source, medium, landingPath).run();
    } catch (schemaError) {
      // Safe deployment ordering fallback: if code reaches an environment before
      // migration 0002, signup still works and only attribution is omitted.
      if (!String(schemaError?.message || '').includes('no column named')) throw schemaError;
      await env.DB.prepare(
        'INSERT INTO signups (email, platform, name) VALUES (?, ?, ?)'
      ).bind(email, platform, name || null).run();
    }
  } catch (err) {
    // Duplicate (email, platform) pair means already signed up -- treat as success
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return Response.json({ success: true });
    }
    console.error('D1 insert error:', err);
    return Response.json(
      { success: false, error: 'Server error. Please try again.' },
      { status: 500 }
    );
  }

  return Response.json({ success: true });
}
