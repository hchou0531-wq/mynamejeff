// Authorization + rate limiting for the bot.
import { config } from '../config.js'
import { logAction } from '../database/actions.js'

export function isAuthorized(userId, cfg = config) {
  return cfg.telegram.allowedUserIds.includes(String(userId))
}

// Deliberately vague: an unauthorized stranger learns nothing about what this bot is or
// who it belongs to.
export const DENIAL_MESSAGE = 'Not available.'

export function denyAndLog(userId, command) {
  logAction({ userId, command, action: 'auth', result: 'denied' })
  return DENIAL_MESSAGE
}

// Simple per-user sliding window. Guards against a runaway client or a spammed keyboard
// hammering the Ethereal API.
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 25
const hits = new Map()

export function rateLimit(userId, { now = Date.now(), windowMs = WINDOW_MS, max = MAX_PER_WINDOW } = {}) {
  const key = String(userId)
  const recent = (hits.get(key) || []).filter(t => now - t < windowMs)
  if (recent.length >= max) {
    hits.set(key, recent)
    return { allowed: false, retryAfterSec: Math.ceil((windowMs - (now - recent[0])) / 1000) }
  }
  recent.push(now)
  hits.set(key, recent)
  return { allowed: true }
}

export function _resetRateLimit() { hits.clear() }
