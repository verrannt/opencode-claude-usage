// Estimated prompt-cache lifetime left for a session. No provider reports this, so it's derived
// from the session's last model request: a request that reads the cache renews its lifetime.
// Defaults: Claude Agent sessions keep their cache about an hour between requests in practice,
// and OpenAI (GPT-5.6 and later, Responses API) documents a 30-minute minimum.

export const DEFAULT_CACHE_MINUTES = { "claude-agent": 60, openai: 30 }

export function cacheMinutes(providerID, overrides = {}) {
  const minutes = Number(overrides?.[providerID] ?? DEFAULT_CACHE_MINUTES[providerID])
  return Number.isFinite(minutes) && minutes > 0 ? minutes : undefined
}

// The session's latest model step, by start time (message order isn't relied on): when its
// request started, its provider, and whether it touched the prompt cache at all.
export function lastStep(messages = []) {
  let latest
  for (const message of messages) {
    if (message?.type !== "assistant" || !message.model?.providerID || !message.time?.created) continue
    if (!latest || message.time.created > latest.time.created) latest = message
  }
  if (!latest) return undefined
  const cache = latest.tokens?.cache
  return {
    providerID: latest.model.providerID,
    requestedAt: latest.time.created,
    cached: cache ? (cache.read ?? 0) + (cache.write ?? 0) > 0 : true,
  }
}

// { status: "none" } when there's nothing to show; otherwise "running" (a request is in flight),
// "warm" with the time left, or "expired".
export function cacheState({ step, running = false, now = Date.now(), overrides }) {
  if (!step || !step.cached) return { status: "none" }
  const minutes = cacheMinutes(step.providerID, overrides)
  if (!minutes) return { status: "none" }
  const ttlMs = minutes * 60_000
  if (running) return { status: "running", remainingMs: ttlMs, fraction: 1, ttlMs }
  const remainingMs = step.requestedAt + ttlMs - now
  if (remainingMs <= 0) return { status: "expired", remainingMs: 0, fraction: 0, ttlMs }
  return { status: "warm", remainingMs, fraction: remainingMs / ttlMs, ttlMs }
}

export function formatCountdown(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`
}
