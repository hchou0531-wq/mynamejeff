// ---------------- Transactional email ----------------
// Pluggable by design: every caller only ever sees sendEmail()'s { ok, error } result, so
// swapping Resend for SMTP/SendGrid/Postmark later means changing the body of sendEmail()
// alone — no caller needs to change. Currently wired to Resend's HTTP API directly (no SDK
// dependency, just fetch) since it's the simplest thing that works on serverless.
const RESEND_API = 'https://api.resend.com/emails'

// Named so a missing-config log (and emailConfigured() callers) can say exactly which
// var is absent — "RESEND_API_KEY / EMAIL_FROM not configured" used to name both every
// time regardless of which one was actually missing, which is the difference between a
// 30-second dashboard fix and a "why is nothing in the Resend dashboard at all" support
// thread when only one Vercel environment scope has the vars set.
function missingEmailConfigVars() {
  const missing = []
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_API_KEY.trim()) missing.push('RESEND_API_KEY')
  if (!process.env.EMAIL_FROM || !process.env.EMAIL_FROM.trim()) missing.push('EMAIL_FROM')
  return missing
}

export function emailConfigured() {
  return missingEmailConfigVars().length === 0
}

// Exposed so an operator-facing diagnostic can say *which* var is absent without the
// caller re-deriving the list. Returns [] when fully configured.
export function emailConfigProblems() {
  return missingEmailConfigVars()
}

// The automated suite (scripts/test-server.mjs) runs the real app with the real process
// env, so RESEND_API_KEY/EMAIL_FROM leak in from .env unless something stops them. They
// did: every `npm test` run fired real Resend sends at the suite's synthetic
// `@test.local` addresses, all of which hard-bounce. One run put ~100 bounces on a
// days-old sending domain — the exact profile that gets a domain throttled or blocked by
// the upstream provider, which would take down verification email for real users.
// Blocking at this chokepoint (rather than only blanking the key in the harness) means no
// future test path can reach the provider by inheriting env some other way.
function providerSuppressed() {
  return process.env.TEST_MODE === 'true'
}

// Never throws — a misconfigured or down email provider must not crash the request that
// triggered the send (signup, resend). Callers check `.ok` and decide what the user sees.
export async function sendEmail({ to, subject, html, text }) {
  if (providerSuppressed()) {
    // TEST_MODE reads the code back over HTTP (see devEmailCaptures), so nothing is lost
    // by never dispatching — and the real provider is never touched.
    console.warn('[email] TEST_MODE=true — provider call suppressed; no email dispatched.')
    return { ok: false, error: 'suppressed_test_mode' }
  }
  const missing = missingEmailConfigVars()
  if (missing.length) {
    console.error(`[email] Not configured — missing ${missing.join(' and ')}. Email not sent. Check this env/environment scope in the deployment platform.`)
    return { ok: false, error: 'not_configured' }
  }
  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, html, text }),
    })
    if (!res.ok) {
      // Log the provider's failure detail server-side only — never surfaced to the caller,
      // which only gets a generic ok:false.
      const body = await res.text().catch(() => '')
      console.error(`[email] Resend send failed (HTTP ${res.status}):`, body.slice(0, 500))
      return { ok: false, error: 'send_failed' }
    }
    return { ok: true }
  } catch (e) {
    console.error('[email] Resend send threw:', e.message)
    return { ok: false, error: 'send_failed' }
  }
}

// Branded to match the site's own pixel-art design system (font-pixel/"Press Start 2P",
// the --eth-gold/--eth-lavender palette, sharp corners, thick borders) rather than a generic
// SaaS-email look. Web fonts are a progressive enhancement here — most email clients (Outlook
// desktop especially) ignore @import entirely, so everything also has to hold up on the
// monospace fallback alone. Plain-text part included for clients that render it, and so the
// code is never ONLY inside HTML markup.
export function verificationEmailTemplate(code, siteUrl) {
  const minutes = parseInt(process.env.VERIFICATION_CODE_EXPIRATION_MINUTES, 10) || 10
  // siteUrl is always publicSiteUrl(request) from the caller (see app/api/[[...path]]/
  // route.js), which already resolves APP_URL / NEXT_PUBLIC_BASE_URL / Vercel's own env
  // vars / the request origin in that order — reading NEXT_PUBLIC_BASE_URL again here
  // directly would just re-run one step of that chain in isolation, out of order, and
  // without the URL validation publicSiteUrl() does. This module is provider plumbing;
  // it shouldn't also own a second, partial copy of the resolution policy.
  const url = siteUrl || ''
  const text = [
    `Your Ethereal verification code is:`,
    ``,
    code,
    ``,
    `This code expires in ${minutes} minutes.`,
    url ? `\nOnce verified: ${url}` : '',
    ``,
    `If you did not create this account, you can safely ignore this email.`,
  ].filter(l => l !== '').join('\n')

  const html = `
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Verify your Ethereal account</title>
<!--[if !mso]><!-->
<style>@import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap');</style>
<!--<![endif]-->
</head>
<body style="margin:0;padding:0;background:#0a0912;">
<div style="background:#0a0912;padding:40px 16px;font-family:'VT323',ui-monospace,'Courier New',monospace;">
  <div style="max-width:420px;margin:0 auto;background:#140a24;border:3px solid #6b21a8;padding:0;">
    <div style="padding:28px 28px 24px;">
      <div style="text-align:center;margin:0 0 20px;">${
        url
          ? `<img src="${url}/wordmark.png" alt="Ethereal" width="220" style="display:inline-block;width:220px;height:auto;">`
          // no site URL to host an <img> from (e.g. no request context) — fall back to plain text
          : `<span style="font-family:'Press Start 2P',ui-monospace,'Courier New',monospace;font-size:23px;letter-spacing:2px;color:#f3e8ff;">ETHEREAL</span>`
      }</div>
      <div style="height:2px;background:#6b21a8;margin:0 0 20px;"></div>

      <p style="color:#a394c7;font-size:18px;line-height:1.5;margin:0 0 22px;letter-spacing:0.5px;">&gt; VERIFY YOUR ACCOUNT_</p>

      <p style="color:#f3e8ff;font-size:16px;margin:0 0 10px;">Your verification code:</p>
      <div style="background:#0a0912;border:3px solid #a855f7;padding:18px;text-align:center;margin:0 0 20px;">
        <span style="font-family:'Press Start 2P',ui-monospace,'Courier New',monospace;font-size:26px;letter-spacing:10px;color:#f472b6;">${code}</span>
      </div>

      <p style="color:#a394c7;font-size:15px;margin:0 0 26px;">This code expires in ${minutes} minutes. It can only be used once.</p>

      ${url ? `
      <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:0 0 26px;">
        <tr>
          <td style="background:#a855f7;">
            <a href="${url}" style="display:block;padding:14px 22px;font-family:'Press Start 2P',ui-monospace,'Courier New',monospace;font-size:11px;letter-spacing:1px;color:#140a24;text-decoration:none;">ENTER ETHEREAL &gt;</a>
          </td>
        </tr>
      </table>` : ''}

      <div style="height:2px;background:#6b21a8;margin:0 0 16px;"></div>
      <p style="color:#6b6480;font-size:13px;margin:0;line-height:1.6;">If you did not create this account, you can safely ignore this email &mdash; no account will be activated.</p>
    </div>
  </div>
</div>
</body>
</html>`.trim()

  return { subject: 'Verify your Ethereal account', text, html }
}
