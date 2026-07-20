const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_SECONDS = 600; // 10 minutes

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

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// P16: real-time signup notification to Lonnie's phone. Fired only on a genuinely
// fresh signup (never on the duplicate-email or honeypot paths -- see call site).
// Fails open by design: any error here is logged and swallowed, never surfaced to
// the signup response, and env.waitUntil keeps it off the response's critical path.
//
// The `mode:{source}` KV flag is the noise valve from the 90-day plan (P16): flipping
// it to "digest" stops the real-time push, but no digest SENDER exists yet to consume
// the counter it keeps accumulating -- that's a separate, not-yet-built Worker. Until
// that exists, flipping this to "digest" produces silence, not a daily summary. Do not
// flip it before the sender is built.
async function sendSignupPush(env, context, { platform, name, source }) {
  if (!env.PUSHOVER_APP_TOKEN || !env.PUSHOVER_USER_KEY) return; // secrets not provisioned yet

  const push = (async () => {
    try {
      const mode = (await env.RATE_LIMIT_KV.get(`mode:${source}`)) || 'realtime';

      const today = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
      const countKey = `cnt:${source}:${today}`;
      const current = await env.RATE_LIMIT_KV.get(countKey);
      const count = (current ? parseInt(current, 10) : 0) + 1;
      const midnightUTC = new Date();
      midnightUTC.setUTCHours(24, 0, 0, 0);
      const ttl = Math.max(60, Math.floor((midnightUTC.getTime() - Date.now()) / 1000));
      await env.RATE_LIMIT_KV.put(countKey, String(count), { expirationTtl: ttl });

      if (mode !== 'realtime') return; // valved off -- see comment above the function

      // Deliberately no email in the push body -- Pushover is a third party this
      // project hasn't disclosed as a data recipient, and email isn't needed to feel
      // the traction. Platform + name (if given) + running count is enough; full
      // detail is one D1 query away.
      const who = name ? `${name} (${platform})` : platform;
      const label = source === 'newsletter' ? 'newsletter signup' : 'waitlist signup';
      const message = `${who} -- ${ordinal(count)} ${label} today`;

      await fetch('https://api.pushover.net/1/messages.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: env.PUSHOVER_APP_TOKEN,
          user: env.PUSHOVER_USER_KEY,
          title: source === 'newsletter' ? 'New newsletter signup' : 'New waitlist signup',
          message,
          // Priority 1 bypasses Pushover quiet hours -- the whole point of this
          // feature is Lonnie feeling it the instant it happens, not next morning.
          priority: '1',
        }).toString(),
      });
    } catch (err) {
      console.error('signup push failed (fail-open, never blocks signup):', err);
    }
  })();

  context.waitUntil(push);
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

  let data;
  try {
    data = await request.json();
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

  // P8: newsletter front door. `source` distinguishes which form this came from
  // (defaults to 'waitlist' for the original CTA, unchanged behavior). Phone is
  // optional and lightly sanitised, not strictly validated (E.164 enforcement is
  // a later nice-to-have, not a launch blocker).
  const source = data.source === 'newsletter' ? 'newsletter' : 'waitlist';
  const newsletterConsent = data.newsletterConsent === true;
  let phone = typeof data.phone === 'string' ? data.phone.trim().slice(0, 20) : null;
  if (phone) {
    phone = phone.replace(/[^\d+\-() ]/g, '') || null;
  }

  let isNewRow = false;
  try {
    await env.DB.prepare(
      'INSERT INTO signups (email, platform, name, newsletter_consent, phone, source) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(email, platform, name || null, newsletterConsent ? 1 : 0, phone, source).run();
    isNewRow = true;
  } catch (err) {
    if (!(err.message && err.message.includes('UNIQUE constraint failed'))) {
      console.error('D1 insert error:', err);
      return Response.json(
        { success: false, error: 'Server error. Please try again.' },
        { status: 500 }
      );
    }

    // Row already exists for this (email, platform) -- this is the P8 re-opt-in path:
    // an existing waitlister filling the /newsletter form, or someone re-subscribing
    // after a previous unsubscribe. Update instead of silently dropping the new
    // fields (the original code just returned success here and threw them away).
    // Only touch fields this request actually supplied; never stomp existing data
    // with nulls from an unrelated resubmit.
    const sets = [];
    const binds = [];
    if (name) {
      sets.push('name = ?');
      binds.push(name);
    }
    if (newsletterConsent) {
      // Granting consent also clears any prior suppression -- an explicit new
      // opt-in is exactly the self-service "re-subscribe" path a suppressed
      // person needs.
      sets.push('newsletter_consent = 1', 'suppressed = 0');
    }
    if (phone) {
      sets.push('phone = ?');
      binds.push(phone);
    }
    if (source === 'newsletter') {
      sets.push('source = ?');
      binds.push(source);
    }
    if (sets.length) {
      binds.push(email, platform);
      try {
        await env.DB.prepare(
          `UPDATE signups SET ${sets.join(', ')} WHERE email = ? AND platform = ?`
        ).bind(...binds).run();
      } catch (updateErr) {
        console.error('D1 update-on-conflict error (fail-open, still reports success):', updateErr);
      }
    }
    return Response.json({ success: true });
  }

  // Only reached on a genuinely fresh insert -- the duplicate/re-opt-in path above
  // and the honeypot path both return earlier and never reach here.
  if (isNewRow) {
    await sendSignupPush(env, context, { platform, name, source });
  }

  return Response.json({ success: true });
}
