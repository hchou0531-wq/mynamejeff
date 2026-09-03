// Thin HTTP client for the Ethereal API. Handles auth, timeouts and error shaping.
// Nothing above this layer should know how Ethereal authenticates.
import { config, redact } from '../config.js'

export class EtherealError extends Error {
  constructor(message, { status = 0, route = '' } = {}) {
    super(message)
    this.name = 'EtherealError'
    this.status = status
    this.route = route
  }
}

export async function request(route, { method = 'GET', body, timeoutMs = 15000, cfg = config } = {}) {
  const url = `${cfg.ethereal.apiUrl}${route}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let res
  try {
    res = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.ethereal.apiKey}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (e) {
    clearTimeout(timer)
    const why = e.name === 'AbortError'
      ? `Ethereal did not respond within ${Math.round(timeoutMs / 1000)}s`
      : 'Could not reach Ethereal (is the site running?)'
    throw new EtherealError(why, { route })
  }
  clearTimeout(timer)

  const text = await res.text().catch(() => '')
  let data = {}
  try { data = text ? JSON.parse(text) : {} } catch { data = {} }

  if (!res.ok) {
    const detail = data.error || `HTTP ${res.status}`
    if (res.status === 401 || res.status === 403) {
      throw new EtherealError('Ethereal rejected the agent credentials (check ETHEREAL_API_KEY).', { status: res.status, route })
    }
    throw new EtherealError(redact(detail), { status: res.status, route })
  }
  return data
}

export const client = { request }
