// Agent-side order bookkeeping: notification dedupe + the pending /confirm handshake.
import { readState, writeState } from './db.js'

// ---- notification dedupe ----
export function isAlreadyNotified(orderCode) {
  return readState().notifiedOrderCodes.includes(String(orderCode))
}

export function markNotified(orderCodes) {
  const state = readState()
  const set = new Set(state.notifiedOrderCodes)
  for (const c of [].concat(orderCodes)) set.add(String(c))
  // Keep the list bounded; old codes can never reappear as "new" pending work.
  writeState({ notifiedOrderCodes: [...set].slice(-500) })
}

// ---- pending fulfillment confirmations ----
// A /fulfill stages the action; only a matching /confirm executes it. Staged entries
// expire so a forgotten confirmation can't be triggered much later by accident.
const CONFIRM_TTL_MS = 10 * 60 * 1000

export function stageFulfillment(userId, payload) {
  const state = readState()
  writeState({
    pendingConfirmations: {
      ...state.pendingConfirmations,
      [String(userId)]: { ...payload, stagedAt: Date.now() },
    },
  })
}

export function getStagedFulfillment(userId, txNumber) {
  const entry = readState().pendingConfirmations[String(userId)]
  if (!entry) return { ok: false, reason: 'none' }
  if (Date.now() - entry.stagedAt > CONFIRM_TTL_MS) return { ok: false, reason: 'expired' }
  if (String(entry.txNumber) !== String(txNumber)) return { ok: false, reason: 'mismatch', entry }
  return { ok: true, entry }
}

export function clearStagedFulfillment(userId) {
  const state = readState()
  const next = { ...state.pendingConfirmations }
  delete next[String(userId)]
  writeState({ pendingConfirmations: next })
}
