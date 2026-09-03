// Lightweight persistence for the agent.
//
// Ethereal's MongoDB is the source of truth for orders, earnings and fulfillment — this
// store only holds the agent's *own* state: which orders we've already notified about,
// what's awaiting a /confirm, and an audit log. That's a few KB, so a JSON file beats
// standing up a second database engine (and adds no native dependencies).
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'

// Resolved per call rather than at import, so tests can point config.dataDir elsewhere.
const stateFile = () => path.join(config.dataDir, 'state.json')
const logFile = () => path.join(config.dataDir, 'actions.log.jsonl')

const DEFAULT_STATE = {
  notifiedOrderCodes: [], // toy-code orders we've already pinged about
  pendingConfirmations: {}, // telegramUserId -> { txNumber, code, ... }
  lastBriefDate: null, // 'YYYY-MM-DD' (local) of the last morning brief sent
}

let cache = null

function ensureDir() {
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true })
}

export function readState() {
  if (cache) return cache
  ensureDir()
  try {
    cache = { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(stateFile(), 'utf8')) }
  } catch {
    cache = { ...DEFAULT_STATE }
  }
  return cache
}

export function writeState(next) {
  ensureDir()
  cache = { ...readState(), ...next }
  // Write-then-rename so a crash mid-write can't leave a truncated state file.
  const tmp = `${stateFile()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2))
  fs.renameSync(tmp, stateFile())
  return cache
}

// Append-only audit trail. Never store the raw toy code — only whether one was present.
export function appendAction(entry) {
  ensureDir()
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry })
  fs.appendFileSync(logFile(), line + '\n')
}

export function readActions(limit = 50) {
  try {
    return fs.readFileSync(logFile(), 'utf8')
      .split('\n')
      .filter(Boolean)
      .slice(-limit)
      .map(l => { try { return JSON.parse(l) } catch { return null } })
      .filter(Boolean)
  } catch { return [] }
}

// Test hook: drop the in-process cache so a fresh read hits disk.
export function _resetCache() { cache = null }
