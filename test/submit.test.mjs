import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/submit.js';

function context(body, options = {}) {
  const calls = [];
  const statement = {
    bind(...values) { calls.push({ sql: this.sql, values }); return this; },
    async run() { return { success: true }; },
  };
  return {
    calls,
    value: {
      request: new Request('https://sunplanner.example/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' },
        body: JSON.stringify(body),
      }),
      env: {
        RATE_LIMIT_KV: null,
        DB: { prepare(sql) { return Object.assign(Object.create(statement), { sql }); } },
        ...options.env,
      },
    },
  };
}

test('stores bounded attribution through SQL parameters', async () => {
  const ctx = context({
    email: 'Person@Example.com', platform: 'iphone', name: '=2+2', website: '',
    source: 'newsletter.august', medium: 'email', landing_path: '/field-notes/clouds/',
  });
  const response = await onRequestPost(ctx.value);
  assert.equal(response.status, 200);
  assert.equal(ctx.calls.length, 1);
  assert.match(ctx.calls[0].sql, /campaign_source, campaign_medium, landing_path/);
  assert.deepEqual(ctx.calls[0].values, [
    'person@example.com', 'iphone', '2+2', 'newsletter.august', 'email', '/field-notes/clouds/',
  ]);
});

test('drops malformed attribution without rejecting a real signup', async () => {
  const ctx = context({
    email: 'person@example.com', platform: 'android', website: '',
    source: "x'); DROP TABLE signups;--", medium: 'email campaign', landing_path: 'https://evil.example/',
  });
  const response = await onRequestPost(ctx.value);
  assert.equal(response.status, 200);
  assert.deepEqual(ctx.calls[0].values.slice(3), [null, null, null]);
});

test('honeypot returns success without touching D1', async () => {
  const ctx = context({ email: 'bot@example.com', website: 'filled-by-bot' });
  const response = await onRequestPost(ctx.value);
  assert.equal(response.status, 200);
  assert.equal(ctx.calls.length, 0);
});

test('invalid email is rejected before touching D1', async () => {
  const ctx = context({ email: 'not-an-email', website: '' });
  const response = await onRequestPost(ctx.value);
  assert.equal(response.status, 400);
  assert.equal(ctx.calls.length, 0);
});

test('oversized direct requests are rejected before parsing or D1', async () => {
  const ctx = context({ email: 'person@example.com', website: '', padding: 'x'.repeat(5000) });
  const response = await onRequestPost(ctx.value);
  assert.equal(response.status, 413);
  assert.equal(ctx.calls.length, 0);
});
