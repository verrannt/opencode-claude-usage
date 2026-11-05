// Claude subscription usage (5h session / 7d weekly) via the same endpoint Claude Code's /usage uses.
// Credentials come from Claude Code's own login (`claude auth login`), which opencode's
// "Claude Agent" provider also uses. We only read the access token; we never refresh it,
// because rotating the refresh token here would log Claude Code out.
import { execFile } from "node:child_process"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
const KEYCHAIN_SERVICE = "Claude Code-credentials"
const FORCE_MIN_MS = 30_000
const BACKOFF_MIN_MS = 5 * 60_000
const BACKOFF_MAX_MS = 30 * 60_000

export class UsageError extends Error {
  constructor(message, { rateLimited = false, retryAfterMs = 0 } = {}) {
    super(message)
    this.rateLimited = rateLimited
    this.retryAfterMs = retryAfterMs
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 5000 }, (error, stdout) => (error ? reject(error) : resolve(stdout)))
  })
}

export async function readCredentials() {
  if (process.platform === "darwin") {
    try {
      const raw = await run("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"])
      const oauth = JSON.parse(raw).claudeAiOauth
      if (oauth?.accessToken) return oauth
    } catch {}
  }
  const dir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")
  try {
    const oauth = JSON.parse(await readFile(join(dir, ".credentials.json"), "utf8")).claudeAiOauth
    if (oauth?.accessToken) return oauth
  } catch {}
  throw new UsageError("No Claude login; run `claude auth login`")
}

function toWindow(raw) {
  if (!raw || typeof raw.utilization !== "number") return null
  const resetsAt = raw.resets_at ? Date.parse(raw.resets_at) : NaN
  return { usedPercent: raw.utilization, resetsAt: Number.isFinite(resetsAt) ? resetsAt : null }
}

export function parseUsage(body) {
  return { fiveHour: toWindow(body?.five_hour), sevenDay: toWindow(body?.seven_day) }
}

export async function fetchUsage() {
  const { accessToken } = await readCredentials()
  let response
  try {
    response = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10000),
    })
  } catch (error) {
    throw new UsageError(`Usage request failed: ${error?.message ?? error}`)
  }
  if (response.status === 401) throw new UsageError("Claude login expired; use Claude once to refresh")
  if (response.status === 429) {
    const seconds = Number(response.headers.get("retry-after"))
    throw new UsageError("Rate limited", {
      rateLimited: true,
      retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0,
    })
  }
  if (!response.ok) throw new UsageError(`Usage request failed (${response.status})`)
  return parseUsage(await response.json())
}

// The endpoint is rate limited per account, so every OpenCode window and plugin reload shares
// one cache file (usage numbers only, never credentials) and one request schedule.
export function cachePath() {
  return join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "opencode-claude-usage", "usage.json")
}

async function readCache(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"))
  } catch {
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
export async function loadUsage({ intervalMs, force = false, now = Date.now, fetcher = fetchUsage, path = cachePath() }) {
  const cache = await readCache(path)
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

// Adapted from @davidaayers/opencode-codex-usage-plugin (MIT); see THIRD_PARTY_NOTICES.md.
// Status note shown under the gauges, or alone before any usage has loaded.
export function statusNote(entry, now = Date.now()) {
  if (!entry.error) return ""
  if (entry.rateLimited && entry.retryAt) return `Rate limited · retry in ${shortReset(entry.retryAt, now)}`
  return entry.error
}

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
