import assert from "node:assert/strict"
import { test } from "node:test"
import { cacheMinutes, cacheState, formatCountdown, lastStep } from "../cache.js"

const MIN = 60_000

function assistant(providerID, created, cache = { read: 100, write: 10 }) {
  return { type: "assistant", model: { id: "m", providerID }, time: { created }, tokens: { input: 1, output: 1, cache } }
}

test("lastStep takes the latest assistant step and skips other messages", () => {
  const messages = [assistant("openai", 1000), assistant("claude-agent", 2000), { type: "user", time: { created: 3000 } }]
  assert.deepEqual(lastStep(messages), { providerID: "claude-agent", requestedAt: 2000, cached: true })
  assert.deepEqual(lastStep([...messages].reverse()), { providerID: "claude-agent", requestedAt: 2000, cached: true })
  assert.equal(lastStep([]), undefined)
  assert.equal(lastStep([{ type: "user" }]), undefined)
})

test("lastStep notices a step that didn't use the cache", () => {
  assert.equal(lastStep([assistant("openai", 1000, { read: 0, write: 0 })]).cached, false)
  // No token data yet (still streaming): assume it caches.
  assert.equal(lastStep([{ type: "assistant", model: { providerID: "openai" }, time: { created: 1 } }]).cached, true)
})

test("cacheMinutes uses defaults and overrides", () => {
  assert.equal(cacheMinutes("claude-agent"), 60)
  assert.equal(cacheMinutes("openai"), 30)
  assert.equal(cacheMinutes("vercel"), undefined)
  assert.equal(cacheMinutes("claude-agent", { "claude-agent": 5 }), 5)
  assert.equal(cacheMinutes("vercel", { vercel: 10 }), 10)
  assert.equal(cacheMinutes("openai", { openai: 0 }), undefined)
})

test("cacheState counts down from the last request", () => {
  const step = { providerID: "openai", requestedAt: 0, cached: true }
  const warm = cacheState({ step, now: 10 * MIN })
  assert.equal(warm.status, "warm")
  assert.equal(warm.remainingMs, 20 * MIN)
  assert.ok(Math.abs(warm.fraction - 2 / 3) < 1e-9)
  assert.equal(cacheState({ step, now: 30 * MIN }).status, "expired")
  assert.equal(cacheState({ step, now: 31 * MIN, overrides: { openai: 45 } }).status, "warm")
})

test("cacheState shows a running request as active and hides what it can't estimate", () => {
  const step = { providerID: "claude-agent", requestedAt: 0, cached: true }
  assert.equal(cacheState({ step, running: true, now: 999 * MIN }).status, "running")
  assert.equal(cacheState({ step: undefined }).status, "none")
  assert.equal(cacheState({ step: { ...step, cached: false } }).status, "none")
  assert.equal(cacheState({ step: { ...step, providerID: "vercel" } }).status, "none")
})

test("formatCountdown", () => {
  assert.equal(formatCountdown(45_000), "45s")
  assert.equal(formatCountdown(59 * MIN + 59_000), "59m59s")
  assert.equal(formatCountdown(5 * MIN), "5m00s")
  assert.equal(formatCountdown(-1), "0s")
})
