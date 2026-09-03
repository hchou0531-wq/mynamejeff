#!/usr/bin/env node
/**
 * Boots an ephemeral in-memory MongoDB, then starts the Next.js dev server pointed at it
 * and runs scripts/backtest.mjs against it.
 *
 *   node scripts/test-server.mjs
 *
 * Lets the full suite run without touching (or depending on) the real Atlas cluster.
 * Everything is torn down on exit; the real MONGO_URL in .env is never modified.
 */
import { MongoMemoryServer } from 'mongodb-memory-server'
import { spawn } from 'node:child_process'

const PORT = process.env.TEST_PORT || '3111'
let mongo, server

const shutdown = async (code) => {
  if (server && !server.killed) { try { process.kill(-server.pid, 'SIGKILL') } catch {} }
  if (mongo) { try { await mongo.stop() } catch {} }
  process.exit(code)
}
process.on('SIGINT', () => shutdown(130))
process.on('SIGTERM', () => shutdown(143))

const waitForServer = async (url, timeoutMs = 120000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url)
      if (r.status < 600) return true
    } catch {}
    await new Promise(r => setTimeout(r, 500))
  }
  return false
}

const run = async () => {
  console.log('▸ starting in-memory MongoDB…')
  mongo = await MongoMemoryServer.create()
  const uri = mongo.getUri()
  console.log(`  ${uri}`)

  console.log(`▸ starting Next.js dev server on :${PORT}…`)
  server = spawn('npx', ['next', 'dev', '--hostname', '127.0.0.1', '--port', PORT], {
    env: {
      ...process.env,
      MONGO_URL: uri,
      DB_NAME: 'ethereal_test',
      ADMIN_EMAIL: 'admin@test.local',
      ADMIN_PASSWORD: 'test-admin-pw',
      ADMIN_DASHBOARD_SECRET: 'test-dashboard-secret',
      TOTP_ENCRYPTION_KEY: '0'.repeat(64),
      BLOCKBEE_API_KEY: '',
      NODE_OPTIONS: '--max-old-space-size=2048',
      // Build somewhere else so this never corrupts the .next cache of a dev server the
      // user already has running from this same directory.
      NEXT_DIST_DIR: '.next-test',
    },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const serverLog = []
  server.stdout.on('data', d => serverLog.push(String(d)))
  server.stderr.on('data', d => serverLog.push(String(d)))

  const base = `http://127.0.0.1:${PORT}`
  const up = await waitForServer(`${base}/api/config`)
  if (!up) {
    console.error('✗ dev server never became ready. Output:\n' + serverLog.join('').slice(-3000))
    return shutdown(1)
  }
  console.log('  ready\n')

  const bt = spawn('node', ['scripts/backtest.mjs'], {
    env: { ...process.env, BASE: base },
    stdio: 'inherit',
  })
  bt.on('exit', (code) => shutdown(code ?? 1))
}

run().catch(async (e) => { console.error('harness error:', e); await shutdown(1) })
