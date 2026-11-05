import assert from "node:assert/strict"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { backoffMs, formatPercent, gauge, loadUsage, parseUsage, shortReset, statusNote, UsageError } from "../usage.js"

const MIN = 60_000
const USAGE = { fiveHour: { usedPercent: 6, resetsAt: null }, sevenDay: null }

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

test("backoff doubles up to 30 minutes and honours retry-after", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => backoffMs(n) / MIN), [5, 10, 20, 30, 30])
  assert.equal(backoffMs(1, 45 * MIN), 45 * MIN)
})

test("parseUsage maps the 5h and 7d windows", () => {
  const usage = parseUsage({
    five_hour: { utilization: 6.0, resets_at: "2026-11-05T16:40:00.023287+00:00" },
    seven_day: { utilization: 9.0, resets_at: null },
    seven_day_opus: null,
  })
  assert.deepEqual(usage.fiveHour, { usedPercent: 6, resetsAt: Date.parse("2026-11-05T16:40:00.023Z") })
  assert.deepEqual(usage.sevenDay, { usedPercent: 9, resetsAt: null })
})

test("parseUsage tolerates missing windows", () => {
  assert.deepEqual(parseUsage({ five_hour: null }), { fiveHour: null, sevenDay: null })
  assert.deepEqual(parseUsage(undefined), { fiveHour: null, sevenDay: null })
  assert.equal(parseUsage({ five_hour: { utilization: null } }).fiveHour, null)
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
