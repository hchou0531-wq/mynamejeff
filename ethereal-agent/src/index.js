// Entry point: wires config → tools → router → Telegram, and starts the watcher.
import { config, validateConfig, redact } from './config.js'
import { buildTools } from './agent/tools.js'
import { createRouter } from './bot/commands.js'
import { Telegram } from './bot/telegram.js'
import { startPendingWatcher } from './notifications/orders.js'
import { startDailyBrief } from './notifications/dailyBrief.js'

async function main() {
  const problems = validateConfig()
  if (problems.length) {
    console.error('Cannot start — configuration incomplete:\n')
    for (const p of problems) console.error(`  • ${p}`)
    console.error('\nCopy .env.example to .env and fill it in.')
    process.exit(1)
  }

  const tools = buildTools()
  const tg = new Telegram()

  // Resolve the bot's own username first — the router needs it to recognise @mentions.
  const me = await tg.getMe()
  const { handleMessage } = createRouter({ tools, botUsername: me.username })

  console.log(`Ethereal Agent online as @${me.username}`)
  console.log(`Ethereal API: ${config.ethereal.apiUrl}`)
  console.log(`AI analysis: ${config.ai.enabled ? `on (${config.ai.model})` : 'off — using computed analysis'}`)
  console.log(`Authorized operators: ${config.telegram.allowedUserIds.length}`)
  console.log(`DMs: answers everything · Groups: only /commands, @${me.username} mentions, or replies to itself`)

  const stopWatcher = startPendingWatcher({
    tools,
    send: (userId, text) => tg.sendMessage(userId, text),
    onError: e => console.error(redact(String(e))),
  })
  if (config.notify.pollSeconds > 0) {
    console.log(`Watching for pending fulfillments every ${config.notify.pollSeconds}s`)
  }

  const stopBrief = startDailyBrief({
    tools,
    send: (userId, text) => tg.sendMessage(userId, text),
    onError: e => console.error(redact(String(e))),
  })
  if (config.dailyBrief.hour >= 0) {
    const hh = String(config.dailyBrief.hour).padStart(2, '0')
    const mm = String(config.dailyBrief.minute).padStart(2, '0')
    console.log(`Morning brief scheduled daily at ${hh}:${mm} local time`)
  }

  const shutdown = () => { stopWatcher(); stopBrief(); tg.stop(); process.exit(0) }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  await tg.poll(async (message) => {
    const reply = await handleMessage(message)
    if (!reply) return
    if (reply.photo) await tg.sendPhoto(message.chat.id, reply.photo, reply.caption)
    else await tg.sendMessage(message.chat.id, reply.text)
  }, { onError: e => console.error(redact(String(e))) })
}

main().catch(e => {
  console.error(redact(`Fatal: ${e.stack || e.message}`))
  process.exit(1)
})
