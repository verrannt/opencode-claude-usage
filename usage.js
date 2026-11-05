// Claude subscription usage (5h session / 7d weekly) via the same endpoint Claude Code's /usage uses.
// Credentials come from Claude Code's own login (`claude auth login`), which opencode's
// "Claude Agent" provider also uses. We only read the access token; we never refresh it,
// because rotating the refresh token here would log Claude Code out.
import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
const KEYCHAIN_SERVICE = "Claude Code-credentials"

export class UsageError extends Error {}

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
  if (response.status === 429) throw new UsageError("Usage endpoint rate limited")
  if (!response.ok) throw new UsageError(`Usage request failed (${response.status})`)
  return parseUsage(await response.json())
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
