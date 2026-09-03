// Central config. Reads .env (no dependency — tiny parser) and validates what's required.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Minimal .env loader: KEY=VALUE per line, ignores blanks/comments, strips wrapping quotes.
// Real environment variables always win over the file.
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadEnvFile(path.join(ROOT, '.env'))

const allowed = String(process.env.TELEGRAM_ALLOWED_USER_ID || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

export const config = {
  root: ROOT,
  dataDir: path.join(ROOT, 'data'),
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    allowedUserIds: allowed,
  },
  ethereal: {
    apiUrl: (process.env.ETHEREAL_API_URL || 'http://localhost:3000/api').replace(/\/+$/, ''),
    apiKey: process.env.ETHEREAL_API_KEY || '',
  },
  ai: {
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'claude-sonnet-5',
    get enabled() { return !!this.apiKey },
  },
  notify: {
    pollSeconds: Number(process.env.NOTIFY_POLL_SECONDS ?? 120),
  },
  dailyBrief: {
    // Local time. Set DAILY_BRIEF_HOUR=-1 to switch the morning brief off.
    hour: Number(process.env.DAILY_BRIEF_HOUR ?? 9),
    minute: Number(process.env.DAILY_BRIEF_MINUTE ?? 0),
    // If the machine was off/asleep at the scheduled time, still send when it comes back
    // — but only within this many hours, so a late-night start doesn't fire a stale brief.
    catchUpHours: Number(process.env.DAILY_BRIEF_CATCHUP_HOURS ?? 6),
  },
}

// Returns a list of human-readable problems; empty means good to start.
export function validateConfig(cfg = config) {
  const problems = []
  if (!cfg.telegram.token) problems.push('TELEGRAM_BOT_TOKEN is not set (create a bot with @BotFather).')
  if (!cfg.telegram.allowedUserIds.length) problems.push('TELEGRAM_ALLOWED_USER_ID is not set (your numeric Telegram id, from @userinfobot).')
  if (!cfg.ethereal.apiKey) problems.push('ETHEREAL_API_KEY is not set (the admin user id from your Ethereal database).')
  if (!cfg.ethereal.apiUrl) problems.push('ETHEREAL_API_URL is not set.')
  return problems
}

// Secrets must never reach logs or Telegram. Scrubs anything that looks like one.
export function redact(text) {
  let out = String(text ?? '')
  for (const secret of [config.telegram.token, config.ethereal.apiKey, config.ai.apiKey]) {
    if (secret && secret.length >= 8) out = out.split(secret).join('[redacted]')
  }
  return out
}
