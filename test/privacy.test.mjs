import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const privacyPath = new URL('../privacy.html', import.meta.url);

test('privacy copy discloses every waitlist attribution field and its purpose', async () => {
  const html = await readFile(privacyPath, 'utf8');

  assert.match(html, /campaign source, channel, and first page/i);
  assert.match(html, /which of our own links and outreach led to a signup/i);
  assert.match(html, /Cloudflare Web Analytics/i);
  assert.match(html, /does not use a tracking cookie/i);
  assert.match(html, /platform choice, optional name, and campaign labels/i);
});
