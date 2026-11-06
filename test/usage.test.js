import assert from "node:assert/strict"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { parseClaudeUsage } from "../claude.js"
import { fetchCodexUsage, isCodexCredential, parseCodexUsage } from "../codex.js"
import {
  backoffMs,
  cachePath,
  formatPercent,
  gauge,
  gaugeColumns,
  loadUsage,
  shortReset,
  statusNote,
  UsageError,
  windowLabel,
} from "../usage.js"

const MIN = 60_000
const USAGE = { windows: [{ label: "5h", usedPercent: 6, resetsAt: null }] }

async function harness() {
  const path = join(await mkdtemp(join(tmpdir(), "claude-usage-")), "usage.json")
  const clock = { t: 1_000_000 }
  const calls = { n: 0 }
  let result = () => USAGE
  const load = (opts = {}) =>
    loadUsage({
      intervalMs: 5 * MIN,
      path,
      now: () => clock.t,
      fetcher: async () => {
        calls.n++
        return result()
      },
      ...opts,
    })
  return { path, clock, calls, load, fail: (fn) => (result = fn) }
}

test("loadUsage fetches once per interval and serves the cache in between", async () => {
  const { clock, calls, load } = await harness()
  assert.deepEqual((await load()).usage, USAGE)
  clock.t += 4 * MIN
  assert.deepEqual((await load()).usage, USAGE)
  assert.equal(calls.n, 1)
  clock.t += MIN
  await load()
  assert.equal(calls.n, 2)
})

test("a forced refresh skips the interval but not within 30s", async () => {
  const { clock, calls, load } = await harness()
  await load()
  clock.t += 10_000
  await load({ force: true })
  assert.equal(calls.n, 1)
  clock.t += 30_000
  await load({ force: true })
  assert.equal(calls.n, 2)
})

test("the cache file is shared between loaders", async () => {
  const a = await harness()
  await a.load()
  const b = await loadUsage({ intervalMs: 5 * MIN, path: a.path, now: () => a.clock.t, fetcher: async () => assert.fail() })
  assert.deepEqual(b.usage, USAGE)
  assert.doesNotMatch(await readFile(a.path, "utf8"), /token/i)
})

test("rate limiting backs off, keeps the last usage and blocks forced refreshes", async () => {
  const { clock, calls, load, fail } = await harness()
  await load()
  fail(() => {
    throw new UsageError("Rate limited", { rateLimited: true })
  })
  clock.t += 5 * MIN
  const limited = await load()
  assert.deepEqual(limited.usage, USAGE)
  assert.equal(limited.retryAt, clock.t + 5 * MIN)
  assert.equal(statusNote(limited, clock.t), "Rate limited · retry in 5m")
  clock.t += 4 * MIN
  await load({ force: true })
  assert.equal(calls.n, 2)
  clock.t += MIN
  const again = await load()
  assert.equal(calls.n, 3)
  assert.equal(again.retryAt, clock.t + 10 * MIN)
  fail(() => USAGE)
  clock.t += 10 * MIN
  const ok = await load()
  assert.equal(ok.failures, 0)
  assert.equal(ok.error, undefined)
  assert.equal(statusNote(ok), "")
})

test("cachePath gives each account its own file", () => {
  assert.notEqual(cachePath("claude"), cachePath("codex-cred_1"))
  assert.match(cachePath("codex-cred_1"), /opencode-claude-usage[\\/]codex-cred_1\.json$/)
  assert.match(cachePath("../x"), /\.\._x\.json$/)
})

test("errors record their code so the sidebar can hide or explain them", async () => {
  const { load, fail } = await harness()
  fail(() => {
    throw new UsageError("No login", { code: "no_login" })
  })
  const entry = await load()
  assert.equal(entry.code, "no_login")
  assert.equal(entry.retryAt, undefined)
})

test("backoff doubles up to 30 minutes and honours retry-after", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => backoffMs(n) / MIN), [5, 10, 20, 30, 30])
  assert.equal(backoffMs(1, 45 * MIN), 45 * MIN)
})

test("parseClaudeUsage maps the 5h and 7d windows", () => {
  const usage = parseClaudeUsage({
    five_hour: { utilization: 6.0, resets_at: "2026-11-05T16:40:00.023287+00:00" },
    seven_day: { utilization: 9.0, resets_at: null },
    seven_day_opus: null,
  })
  assert.deepEqual(usage.windows, [
    { label: "5h", usedPercent: 6, resetsAt: Date.parse("2026-11-05T16:40:00.023Z") },
    { label: "7d", usedPercent: 9, resetsAt: null },
  ])
})

test("parseClaudeUsage tolerates missing windows", () => {
  assert.deepEqual(parseClaudeUsage({ five_hour: null }), { windows: [] })
  assert.deepEqual(parseClaudeUsage(undefined), { windows: [] })
  assert.deepEqual(parseClaudeUsage({ five_hour: { utilization: null } }), { windows: [] })
})

test("parseCodexUsage maps windows by duration, shortest first", () => {
  const usage = parseCodexUsage({
    plan_type: "team",
    rate_limit: {
      primary_window: { used_percent: 64, limit_window_seconds: 604800, reset_at: 1794298076 },
      secondary_window: { used_percent: 12, limit_window_seconds: 18000, reset_at: null },
    },
  })
  assert.deepEqual(usage.windows, [
    { label: "5h", usedPercent: 12, resetsAt: null },
    { label: "7d", usedPercent: 64, resetsAt: 1794298076000 },
  ])
  assert.deepEqual(parseCodexUsage({ rate_limit: { primary_window: null, secondary_window: null } }), { windows: [] })
  assert.deepEqual(parseCodexUsage(undefined), { windows: [] })
})

test("gaugeColumns keeps 5h | 7d columns and marks a missing window unavailable", () => {
  const fiveHour = { label: "5h", usedPercent: 10, resetsAt: null }
  const week = { label: "7d", usedPercent: 64, resetsAt: null }
  assert.deepEqual(gaugeColumns([fiveHour, week]), [fiveHour, week])
  assert.deepEqual(gaugeColumns([week]), [{ label: "5h", unavailable: true }, week])
  assert.deepEqual(gaugeColumns([fiveHour]), [fiveHour, { label: "7d", unavailable: true }])
  const month = { label: "30d", usedPercent: 5, resetsAt: null }
  assert.deepEqual(gaugeColumns([month]), [month])
  assert.deepEqual(gaugeColumns([]), [])
})

test("windowLabel names known and unknown windows", () => {
  assert.equal(windowLabel(18000), "5h")
  assert.equal(windowLabel(604800), "7d")
  assert.equal(windowLabel(86400 * 30), "30d")
  assert.equal(windowLabel(3600 * 3), "3h")
  assert.equal(windowLabel(undefined), "?")
})

test("isCodexCredential only accepts ChatGPT OAuth logins", () => {
  const oauth = { integrationID: "openai", value: { type: "oauth", access: "x" } }
  assert.equal(isCodexCredential(oauth), true)
  assert.equal(isCodexCredential({ integrationID: "openai", value: { type: "key", key: "sk" } }), false)
  assert.equal(isCodexCredential({ integrationID: "claude-code", value: { type: "oauth", access: "x" } }), false)
  assert.equal(isCodexCredential(undefined), false)
})

test("fetchCodexUsage reports an expired token without a request", async () => {
  const credential = { value: { type: "oauth", access: "x", expires: 1000 } }
  await assert.rejects(fetchCodexUsage(credential, 2000), (error) => error.code === "expired")
})

test("formatPercent rounds and clamps", () => {
  assert.equal(formatPercent(41.6), "42%")
  assert.equal(formatPercent(130), "100%")
  assert.equal(formatPercent(-3), "0%")
  assert.equal(formatPercent(NaN), "?")
})

test("shortReset formats countdowns", () => {
  const now = 0
  assert.equal(shortReset(null, now), "?")
  assert.equal(shortReset(-1, now), "now")
  assert.equal(shortReset(45 * 60e3, now), "45m")
  assert.equal(shortReset(90 * 60e3, now), "1h30m")
  assert.equal(shortReset((41 * 60 + 5) * 60e3, now), "1d17h")
})

test("gauge fills with eighth blocks and keeps its width", () => {
  assert.deepEqual(gauge(0, 10), { fill: "", track: "░".repeat(10) })
  assert.deepEqual(gauge(100, 10), { fill: "█".repeat(10), track: "" })
  assert.deepEqual(gauge(42, 10), { fill: "████▎", track: "░░░░░" })
  for (let p = 0; p <= 100; p++) {
    const { fill, track } = gauge(p, 13)
    assert.equal([...fill].length + [...track].length, 13)
  }
})
