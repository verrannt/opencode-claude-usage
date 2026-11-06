// Shared pieces for every account: request/error handling, the cross-window cache with
// rate-limit backoff, and formatting. Usage is normalised to
// { windows: [{ label: "5h" | "7d" | ..., usedPercent, resetsAt (ms) }] }.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

const FORCE_MIN_MS = 30_000
const BACKOFF_MIN_MS = 5 * 60_000
const BACKOFF_MAX_MS = 30 * 60_000

export class UsageError extends Error {
  // code: "no_login" | "expired" | undefined
  constructor(message, { code, rateLimited = false, retryAfterMs = 0 } = {}) {
    super(message)
    this.code = code
    this.rateLimited = rateLimited
    this.retryAfterMs = retryAfterMs
  }
}

export const EXPIRED_MESSAGE = "Login expired · use it once"

export async function requestJson(url, headers) {
  let response
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) })
  } catch (error) {
    throw new UsageError(`Request failed: ${error?.message ?? error}`)
  }
  if (response.status === 401) throw new UsageError(EXPIRED_MESSAGE, { code: "expired" })
  if (response.status === 429) {
    const seconds = Number(response.headers.get("retry-after"))
    throw new UsageError("Rate limited", {
      rateLimited: true,
      retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0,
    })
  }
  if (!response.ok) throw new UsageError(`Request failed (${response.status})`)
  return response.json()
}

// "5h", "7d", or the nearest whole hours/days for windows we don't know yet.
export function windowLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "?"
  if (seconds % 86400 === 0) return `${seconds / 86400}d`
  return `${Math.round(seconds / 3600)}h`
}

// The usage endpoints are rate limited per account, so every OpenCode window and plugin reload
// shares one cache file per account (usage numbers only, never credentials) and one schedule.
export function cachePath(key, legacy = false) {
  const name = String(key).replace(/[^\w.-]/g, "_")
  const directory = legacy ? "opencode-claude-usage" : "opencode-subscription-usage"
  return join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), directory, `${name}.json`)
}

async function readCache(path, legacyPath) {
  try {
    return JSON.parse(await readFile(path, "utf8"))
  } catch (error) {
    // Adopt the old cache without dropping a rate-limit backoff or fetching just for the rename.
    if (error.code === "ENOENT" && legacyPath) {
      const legacy = await readCache(legacyPath)
      if (Object.keys(legacy).length) {
        await writeCache(path, legacy)
        return legacy
      }
    }
    return {}
  }
}

async function writeCache(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(value))
  await rename(tmp, path)
}

export function backoffMs(failures, retryAfterMs = 0) {
  return Math.max(retryAfterMs, Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.max(0, failures - 1)))
}

// A forced refresh may skip the regular interval but never a rate-limit backoff.
export function nextFetchAt(cache, intervalMs, force = false) {
  const attemptAt = cache.attemptAt ?? 0
  return Math.max(attemptAt + (force ? FORCE_MIN_MS : intervalMs), cache.retryAt ?? 0)
}

// Returns the shared cache entry, fetching first when a request is due. Failures are
// recorded in the entry (keeping the last good usage) instead of thrown.
export async function loadUsage({ intervalMs, fetcher, path, legacyPath, force = false, now = Date.now }) {
  const cache = await readCache(path, legacyPath)
  if (now() < nextFetchAt(cache, intervalMs, force)) return cache
  // Claim the attempt before fetching so other windows don't request at the same time.
  await writeCache(path, { ...cache, attemptAt: now() })
  let next
  try {
    next = { usage: await fetcher(), fetchedAt: now(), attemptAt: now(), failures: 0 }
  } catch (error) {
    const failures = (cache.failures ?? 0) + 1
    next = {
      ...cache,
      attemptAt: now(),
      failures,
      error: error?.message ?? "Usage unavailable",
      code: error?.code,
      rateLimited: error?.rateLimited === true,
      retryAt: error?.rateLimited ? now() + backoffMs(failures, error.retryAfterMs) : undefined,
    }
  }
  await writeCache(path, next)
  return next
}

export function formatPercent(value) {
  if (!Number.isFinite(value)) return "?"
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`
}

export function shortReset(resetsAt, now = Date.now()) {
  if (resetsAt == null) return "?"
  const minutes = Math.ceil((resetsAt - now) / 60000)
  if (minutes <= 0) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h${String(minutes % 60).padStart(2, "0")}m`
  return `${Math.floor(hours / 24)}d${hours % 24}h`
}

// Fixed 5h | 7d columns when the service reports only those windows, marking a missing one as
// unavailable so every account has the same layout. Other windows are shown as reported.
export function gaugeColumns(windows = []) {
  const fixed = ["5h", "7d"]
  if (windows.length === 0 || !windows.every((window) => fixed.includes(window.label))) return windows.slice(0, 2)
  return fixed.map((label) => windows.find((window) => window.label === label) ?? { label, unavailable: true })
}

// Status note shown under an account's gauges, or alone before any usage has loaded.
export function statusNote(entry, now = Date.now()) {
  if (!entry?.error) return ""
  if (entry.rateLimited && entry.retryAt) return `Rate limited · retry in ${shortReset(entry.retryAt, now)}`
  return entry.error
}

// Adapted from @davidaayers/opencode-codex-usage-plugin (MIT); see THIRD_PARTY_NOTICES.md.
const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"]

export function gauge(percent, width) {
  const cells = Math.min(1, Math.max(0, percent / 100)) * width
  let full = Math.floor(cells)
  let partial = EIGHTHS[Math.round((cells - full) * 8)] ?? ""
  if (partial === EIGHTHS[8]) {
    full += 1
    partial = ""
  }
  return { fill: "█".repeat(full) + partial, track: "░".repeat(width - full - (partial ? 1 : 0)) }
}
