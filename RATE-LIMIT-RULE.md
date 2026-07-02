# Rate limiting on POST /submit

**Status (2026-07-02): shipped as a code-level KV limiter, not the zone-level WAF rule
originally spec'd below.** Reroute reason: `subtl.agency` is not a Cloudflare zone --
nameservers are `launch1/launch2.spaceship.net` (Spaceship DNS), and
`sunplanner.subtl.agency` is a CNAME to `sunplanner-waitlist.pages.dev`. There is no zone
to attach a WAF rule to, and never was -- this was never a token-permission gap, moving DNS
to Cloudflare to enable it reverses a settled decision and wasn't on the table. The original
plan below is kept for the record, not as an active TODO.

## What actually shipped

`functions/submit.js`: a KV-based fixed-window counter, 5 requests / 10 minutes per IP,
keyed on a SHA-256 hash of `CF-Connecting-IP` (not the raw IP). On breach: `429` with a
generic message ("Too many requests. Please try again in a few minutes.") that doesn't
reveal the threshold. KV namespace `RATE_LIMIT_KV` (id `f694d171f3764bfdb8ca3161380b2a6a`)
bound to the Pages project alongside the existing `DB` (D1) binding.

Considered the Workers `ratelimit` binding first (Cloudflare's platform-native option, GA as
of Sept 2025) but its `period` field only accepts 10 or 60 seconds -- can't express a 10-minute
window, so it was never viable for this spec regardless of Pages Functions compatibility.

**Verified live** (2026-07-02): 7 rapid POSTs to `https://sunplanner.subtl.agency/submit` --
requests 1-5 returned `200` and landed in D1 (confirmed via direct query, then cleaned up),
requests 6-7 returned `429` and never reached the database.

---

*Original plan (superseded, kept for context):*

## Why this instead of code

The staged honeypot (branch `security-audit-fixes-2026-07-02`) stops casual/naive bots that
blind-fill every form field. It does nothing against a targeted scripted attacker calling
`/submit` directly with curl/Python at volume. That needs a request-volume control in front of
the function, which is exactly what Cloudflare's platform-native rate limiting is for — no new
KV binding, no app code to maintain, enforced at the edge before the request ever reaches the
Pages Function.

## Where to create it

Cloudflare dashboard → pick the account → the `subtl.agency` zone → **Security** → **WAF** →
**Rate limiting rules** → Create rule. (Top-level dashboard URL, verified real:
https://dash.cloudflare.com/ — the exact sub-path wasn't verified live since Cloudflare's nav
changes; navigate from there.)

## Rule definition

| Field | Value |
|---|---|
| Rule name | `submit-rate-limit` |
| When incoming requests match | Hostname = `sunplanner.subtl.agency` AND URI Path = `/submit` AND Method = `POST` |
| Characteristics (how requests are counted) | IP address (Cloudflare's default per-visitor characteristic) |
| Period | 10 minutes |
| Requests threshold | 5 requests per period per IP |
| Action | **Managed Challenge** on threshold breach |
| Mitigation timeout | 10 minutes (matches the counting period; re-evaluate after) |
| Escalation | If a single IP keeps tripping this rule across multiple periods, convert that rule (or add a second rule keyed the same way) to action = **Block** instead of Managed Challenge |

## Why these numbers

A real visitor submits `/submit` once, maybe twice (a genuine retry after a network hiccup).
5 requests / 10 minutes per IP comfortably covers that with margin, while still stopping
sustained abuse — a card-testing-style loop of hundreds/thousands of requests trips the rule
almost immediately. Managed Challenge (rather than an immediate hard Block) avoids collateral
damage to shared/NAT'd IPs (coffee shops, campgrounds, cell carriers) where multiple genuine
visitors share one public IP — appropriate here since this audience skews toward mobile/nomadic
connections, not fixed home IPs.

## After activating

Confirm it's live with a quick burst test from a single IP (6+ rapid POSTs to `/submit`) and
verify the 6th+ request gets challenged/blocked rather than reaching the function. Cloudflare's
Security Events log (same zone, Security → Events) will show the rule firing.

## Status

**Not yet created.** Needs either Cloudflare dashboard access (a few clicks, described above)
or a scoped `CLOUDFLARE_API_TOKEN` with Zone:Firewall Services:Edit permission on this zone, for
Claude to create it via the Cloudflare API/`wrangler`. Neither was available in the session that
wrote this doc.
