// Claude subscription usage (5h session / 7d weekly) via the same endpoint Claude Code's /usage uses.
// Credentials come from Claude Code's own login (`claude auth login`), which opencode's
// "Claude Agent" provider also uses. We only read the access token; we never refresh it,
// because rotating the refresh token here would log Claude Code out.
import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { requestJson, UsageError } from "./usage.js"

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
const KEYCHAIN_SERVICE = "Claude Code-credentials"

function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 5000 }, (error, stdout) => (error ? reject(error) : resolve(stdout)))
  })
}

export async function readClaudeCredentials() {
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
  throw new UsageError("No Claude login; run `claude auth login`", { code: "no_login" })
}

function toWindow(label, raw) {
  if (!raw || typeof raw.utilization !== "number") return null
  const resetsAt = raw.resets_at ? Date.parse(raw.resets_at) : NaN
  return { label, usedPercent: raw.utilization, resetsAt: Number.isFinite(resetsAt) ? resetsAt : null }
}

export function parseClaudeUsage(body) {
  return { windows: [toWindow("5h", body?.five_hour), toWindow("7d", body?.seven_day)].filter(Boolean) }
}

export async function fetchClaudeUsage() {
  const { accessToken } = await readClaudeCredentials()
  const body = await requestJson(USAGE_URL, {
    Authorization: `Bearer ${accessToken}`,
    "anthropic-beta": "oauth-2025-04-20",
    "Content-Type": "application/json",
  })
  return parseClaudeUsage(body)
}
