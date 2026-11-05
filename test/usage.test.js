import assert from "node:assert/strict"
import { test } from "node:test"
import { formatPercent, gauge, parseUsage, shortReset } from "../usage.js"

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
