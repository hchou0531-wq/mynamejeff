// Minimal Telegram Bot API client over long polling.
//
// The Bot API is a handful of plain HTTPS calls, so this avoids a dependency (and the
// supply-chain surface that comes with one) for roughly the same amount of code.
import { config, redact } from '../config.js'

export class Telegram {
  constructor({ token = config.telegram.token, fetchImpl = fetch } = {}) {
    this.token = token
    this.fetch = fetchImpl
    this.offset = 0
    this.stopped = false
  }

  get base() { return `https://api.telegram.org/bot${this.token}` }

  async call(method, payload) {
    const res = await this.fetch(`${this.base}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    if (!data.ok) throw new Error(redact(`Telegram ${method} failed: ${data.description || res.status}`))
    return data.result
  }

  sendMessage(chatId, text, extra = {}) {
    // Telegram hard-caps messages at 4096 characters.
    const body = String(text ?? '')
    const chunks = body.length <= 4000 ? [body] : body.match(/[\s\S]{1,4000}/g)
    return chunks.reduce(
      (p, chunk) => p.then(() => this.call('sendMessage', { chat_id: chatId, text: chunk, ...extra })),
      Promise.resolve(),
    )
  }

  // multipart/form-data upload for images.
  async sendPhoto(chatId, pngBuffer, caption = '') {
    const form = new FormData()
    form.append('chat_id', String(chatId))
    if (caption) form.append('caption', caption)
    form.append('photo', new Blob([pngBuffer], { type: 'image/png' }), 'dashboard.png')

    const res = await this.fetch(`${this.base}/sendPhoto`, { method: 'POST', body: form })
    const data = await res.json().catch(() => ({}))
    if (!data.ok) throw new Error(redact(`Telegram sendPhoto failed: ${data.description || res.status}`))
    return data.result
  }

  async getMe() { return this.call('getMe', {}) }

  // Long-polls forever, handing each message to `onMessage`. One slow or failing handler
  // must not stall the loop, so handler errors are caught per-update.
  async poll(onMessage, { timeoutSec = 30, onError = console.error } = {}) {
    while (!this.stopped) {
      let updates = []
      try {
        updates = await this.call('getUpdates', { offset: this.offset, timeout: timeoutSec })
      } catch (e) {
        onError(redact(`poll error: ${e.message}`))
        await new Promise(r => setTimeout(r, 3000))
        continue
      }
      for (const u of updates) {
        this.offset = u.update_id + 1
        if (!u.message) continue
        try {
          await onMessage(u.message)
        } catch (e) {
          onError(redact(`handler error: ${e.stack || e.message}`))
        }
      }
    }
  }

  stop() { this.stopped = true }
}
