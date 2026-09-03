// Audit log. Every meaningful action gets a row: who, what, which order, outcome.
import { appendAction, readActions } from './db.js'
import { redact } from '../config.js'

export function logAction({ userId, command, orderId = null, action, result, detail = null }) {
  appendAction({
    userId: String(userId ?? 'system'),
    command: redact(command),
    orderId: orderId == null ? null : String(orderId),
    action,
    result, // 'ok' | 'denied' | 'error' | 'pending'
    // Never log a toy code, a token, or an API key.
    detail: detail == null ? null : redact(String(detail)).slice(0, 300),
  })
}

export function recentActions(limit = 50) { return readActions(limit) }
