// ---------------- Transactional email ----------------
// Pluggable by design: every caller only ever sees sendEmail()'s { ok, error } result, so
// swapping Resend for SMTP/SendGrid/Postmark later means changing the body of sendEmail()
// alone — no caller needs to change. Currently wired to Resend's HTTP API directly (no SDK
// dependency, just fetch) since it's the simplest thing that works on serverless.

const RESEND_API = 'https://api.resend.com/emails'

// The wordmark used to travel as a cid: attachment so it rendered with zero dependency on
// the site being reachable — but a cid part is still a MIME attachment, so several clients
// (Gmail among them) list it in the attachments tray even though it also renders inline,
// which reads as "why did this email attach a picture." Hotlinking it from the live site
// avoids that entirely, and doubles as the click-through the logo is meant to be — the site
// has been stable at this domain, so the dependency this trades back in is a safe one.
const SITE_URL = 'https://www.ethereals.lol'

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

// Shared chrome for every transactional email: the wordmark (linked to the site, exactly
// like clicking the logo in the app header would do), a heading, and the legal-ish footer.
// Kept as one function so the verification email and the welcome email can't drift into
// two different "brands" — everything reads as one gothic, engraved-metal aesthetic instead
// of the mismatched retro-terminal look this used to have.
function emailShell({ eyebrow, heading, bodyHtml, footerNote }) {
  return `
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${heading}</title>
<!--[if !mso]><!-->
<style>@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&family=Cormorant+Garamond:wght@400;600&display=swap');</style>
<!--<![endif]-->
</head>
<body style="margin:0;padding:0;background:#0a0912;">
<div style="background:radial-gradient(ellipse at top,#1d0f38 0%,#0a0912 60%);padding:44px 16px;font-family:'Cormorant Garamond',Georgia,'Times New Roman',serif;">
  <div style="max-width:480px;margin:0 auto;background:#140a24;border:1px solid #6b21a8;border-radius:4px;box-shadow:0 0 40px rgba(168,85,247,0.15);">
    <div style="padding:36px 36px 30px;">
      <div style="text-align:center;margin:0 0 22px;">
        <a href="${SITE_URL}" style="text-decoration:none;border:0;outline:none;">
          <img src="${SITE_URL}/wordmark.png" alt="Ethereal" width="200" style="display:inline-block;width:200px;max-width:70%;height:auto;border:0;">
        </a>
      </div>
      <div style="text-align:center;color:#c084fc;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin:0 0 4px;">&#10022;&nbsp;&nbsp;${eyebrow}&nbsp;&nbsp;&#10022;</div>
      <h1 style="font-family:'Cinzel',Georgia,serif;font-weight:700;text-align:center;color:#f3e8ff;font-size:22px;letter-spacing:0.5px;margin:0 0 26px;">${heading}</h1>

      ${bodyHtml}

      <div style="height:1px;background:linear-gradient(90deg,transparent,#6b21a8,transparent);margin:30px 0 16px;"></div>
      <p style="color:#6b6480;font-size:14px;margin:0;line-height:1.6;text-align:center;">${footerNote}</p>
    </div>
  </div>
  <p style="text-align:center;color:#4a4560;font-size:12px;margin:20px 0 0;font-family:ui-sans-serif,system-ui,sans-serif;">Ethereal &middot; A Realm of Rare Finds</p>
</div>
</body>
</html>`.trim()
}

export async function verificationEmailTemplate(code, siteUrl) {
  const minutes = parseInt(process.env.VERIFICATION_CODE_EXPIRATION_MINUTES, 10) || 10
  // siteUrl is always publicSiteUrl(request) from the caller (see app/api/[[...path]]/
  // route.js), which already resolves APP_URL / NEXT_PUBLIC_BASE_URL / Vercel's own env
  // vars / the request origin in that order. Used only for the CTA button below — the
  // wordmark and its link always point at the stable production domain (SITE_URL) so the
  // logo behaves the same in every email regardless of which environment sent it.
  const url = siteUrl || SITE_URL
  const text = [
    `Your Ethereal verification code is:`,
    ``,
    code,
    ``,
    `This code expires in ${minutes} minutes.`,
    `\nOnce verified: ${url}`,
    ``,
    `If you did not create this account, you can safely ignore this email.`,
  ].join('\n')

  const body = `
      <p style="color:#c9bfe0;font-size:17px;line-height:1.6;margin:0 0 22px;text-align:center;">Enter this code to verify your account and step into the marketplace.</p>

      <div style="background:#0a0912;border:1px solid #a855f7;border-radius:4px;padding:20px;text-align:center;margin:0 0 20px;">
        <span style="font-family:'Cinzel',Georgia,serif;font-weight:700;font-size:30px;letter-spacing:9px;color:#f472b6;">${code}</span>
      </div>

      <p style="color:#a394c7;font-size:15px;margin:0 0 28px;text-align:center;">This code expires in ${minutes} minutes and can only be used once.</p>

      <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:0 auto 6px;">
        <tr>
          <td style="background:linear-gradient(90deg,#a855f7,#f472b6);border-radius:3px;">
            <a href="${url}" style="display:block;padding:13px 28px;font-family:'Cinzel',Georgia,serif;font-weight:700;font-size:13px;letter-spacing:1.5px;color:#140a24;text-decoration:none;">ENTER ETHEREAL</a>
          </td>
        </tr>
      </table>`

  const html = emailShell({
    eyebrow: 'Verify your account',
    heading: 'Confirm It&rsquo;s You',
    bodyHtml: body,
    footerNote: 'If you did not create this account, you can safely ignore this email &mdash; no account will be activated.',
  })

  return { subject: 'Verify your Ethereal account', text, html }
}

// Sent once, right after a code successfully verifies an account — a short orientation so
// a brand-new buyer doesn't land in an empty inbox with nothing but a "you're verified"
// notification inside the app itself (which they may never open again if the tab is gone).
export async function welcomeEmailTemplate(siteUrl) {
  const url = siteUrl || SITE_URL
  const steps = [
    ['Browse the market', 'Filter listings by category, rarity, and price. Save anything you&rsquo;re not ready to buy yet with the bookmark icon &mdash; it&rsquo;ll wait for you under Save for Later.'],
    ['Check the seller', 'Every listing shows the seller&rsquo;s reputation and history. A new or low-reputation seller isn&rsquo;t automatically a problem, but it&rsquo;s worth a second look before a large purchase.'],
    ['Pay with crypto', 'Checkout is crypto-only. Send exactly the quoted amount to the address shown for your order &mdash; underpaying or overpaying can delay confirmation.'],
    ['Track your order', 'Your account page shows every order&rsquo;s status in real time, from payment confirmation through delivery.'],
    ['Ask before you assume', 'If anything about a listing or an order looks off, use chat or reach out on Discord before sending payment &mdash; it&rsquo;s always faster to ask first.'],
  ]
  const stepsHtml = steps.map(([title, body], i) => `
      <tr>
        <td style="padding:0 0 20px;vertical-align:top;width:34px;">
          <div style="width:26px;height:26px;border:1px solid #a855f7;border-radius:50%;color:#f472b6;font-family:'Cinzel',Georgia,serif;font-weight:700;font-size:13px;text-align:center;line-height:26px;">${i + 1}</div>
        </td>
        <td style="padding:0 0 20px 14px;vertical-align:top;">
          <p style="color:#f3e8ff;font-family:'Cinzel',Georgia,serif;font-weight:700;font-size:14px;letter-spacing:0.3px;margin:0 0 4px;">${title}</p>
          <p style="color:#a394c7;font-size:16px;line-height:1.55;margin:0;">${body}</p>
        </td>
      </tr>`).join('')

  const text = [
    `Welcome to Ethereal!`,
    ``,
    `Your account is verified. Here's a quick guide to the marketplace:`,
    ``,
    ...steps.map(([title, body], i) => `${i + 1}. ${title} — ${body.replace(/&rsquo;/g, "'").replace(/&mdash;/g, '-')}`),
    ``,
    `Visit: ${url}`,
  ].join('\n')

  const body = `
      <p style="color:#c9bfe0;font-size:17px;line-height:1.6;margin:0 0 26px;text-align:center;">Your account is verified &mdash; welcome in. Here&rsquo;s a short guide to finding your way around.</p>

      <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:100%;margin:0 0 6px;">
        ${stepsHtml}
      </table>

      <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:10px auto 0;">
        <tr>
          <td style="background:linear-gradient(90deg,#a855f7,#f472b6);border-radius:3px;">
            <a href="${url}" style="display:block;padding:13px 28px;font-family:'Cinzel',Georgia,serif;font-weight:700;font-size:13px;letter-spacing:1.5px;color:#140a24;text-decoration:none;">BROWSE THE MARKET</a>
          </td>
        </tr>
      </table>`

  const html = emailShell({
    eyebrow: 'Welcome',
    heading: 'Welcome to Ethereal',
    bodyHtml: body,
    footerNote: 'Questions about an order or a listing? Reach out any time through in-app chat or Discord support.',
  })

  return { subject: 'Welcome to Ethereal — your guide to the marketplace', text, html }
}
