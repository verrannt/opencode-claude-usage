// Codex usage for every ChatGPT login stored in OpenCode (the OpenAI provider's "Sign in with
// ChatGPT"), via the ChatGPT usage endpoint the Codex CLI reads. Credentials come from OpenCode's
// credential API. Like the Claude side, we never refresh tokens: OpenCode refreshes a login when
// it uses it, and refreshing here could sign OpenCode out of that account.
import { EXPIRED_MESSAGE, requestJson, UsageError, windowLabel } from "./usage.js"

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"

export function isCodexCredential(credential) {
  return (
    credential?.integrationID === "openai" &&
    credential.value?.type === "oauth" &&
    typeof credential.value.access === "string"
  )
}

function toWindow(raw) {
  if (!raw || typeof raw.used_percent !== "number") return null
  return {
    label: windowLabel(raw.limit_window_seconds),
    seconds: raw.limit_window_seconds ?? 0,
    usedPercent: raw.used_percent,
    resetsAt: Number.isFinite(raw.reset_at) ? raw.reset_at * 1000 : null,
  }
}

// Shortest window first, so a 5h window sits left of the weekly one like Claude's.
export function parseCodexUsage(body) {
  const rateLimit = body?.rate_limit
  const windows = [toWindow(rateLimit?.primary_window), toWindow(rateLimit?.secondary_window)]
    .filter(Boolean)
    .sort((a, b) => a.seconds - b.seconds)
    .map(({ seconds, ...window }) => window)
  return { windows }
}

export async function fetchCodexUsage(credential, now = Date.now()) {
  const { access, expires, metadata } = credential.value
  // Skip the request for a token we know has expired.
  if (expires && expires <= now) throw new UsageError(EXPIRED_MESSAGE, { code: "expired" })
  const headers = { Authorization: `Bearer ${access}`, "User-Agent": "opencode-subscription-usage" }
  if (metadata?.accountID) headers["ChatGPT-Account-Id"] = metadata.accountID
  return parseCodexUsage(await requestJson(USAGE_URL, headers))
}
