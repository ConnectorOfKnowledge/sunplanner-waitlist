export async function onRequestPost(context) {
  const { request, env } = context;

  let data;
  try {
    data = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid JSON.' }, { status: 400 });
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

  try {
    await env.DB.prepare(
      'INSERT INTO signups (email, platform) VALUES (?, ?)'
    ).bind(email, platform).run();
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
