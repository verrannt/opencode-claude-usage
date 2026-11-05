// Sidebar gauges for Claude subscription usage (5h + 7d). Plain JS against the opentui
// Solid runtime, so no JSX build step is needed.
// The palette, level colours, gauge layout, session/sidebar checks, compact text and slot
// wiring are adapted from @davidaayers/opencode-codex-usage-plugin (MIT); see
// THIRD_PARTY_NOTICES.md.
import { Plugin } from "@opencode/plugin/tui"
import { TextAttributes } from "@opentui/core"
import {
  createElement,
  createTextNode,
  effect,
  insert,
  insertNode,
  setProp,
  useTerminalDimensions,
} from "@opentui/solid"
import { createMemo, createSignal, onCleanup } from "solid-js"
import { formatPercent, gauge, loadUsage, shortReset, statusNote } from "./usage.js"

const PROVIDER_ID = "claude-agent"
const DEFAULT_REFRESH_MINUTES = 5
// How often the shared cache file is re-read; a request is only sent when one is due.
const TICK_MS = 30_000
const LAYOUT_WIDTH = 32
const COLUMN_GAP = 2
const LABEL_WIDTH = 3

// Minimal hyperscript over the Solid universal renderer: function props/children are reactive.
function h(tag, props = {}, ...children) {
  const el = createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === "function") effect((prev) => setProp(el, key, value(), prev))
    else setProp(el, key, value)
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue
    if (typeof child === "function") insert(el, child, null)
    else if (typeof child === "string" || typeof child === "number") insertNode(el, createTextNode(String(child)))
    else insertNode(el, child)
  }
  return el
}

function palette(api) {
  const text = api.theme.text
  return {
    text: text.base,
    muted: text.muted,
    accent: text.action.primary.base,
    success: text.feedback.success.base,
    warning: text.feedback.warning.base,
    error: text.feedback.error.base,
  }
}

function levelColor(percent, theme) {
  if (percent >= 90) return theme.error
  if (percent >= 75) return theme.warning
  if (percent >= 50) return theme.accent
  return theme.success
}

function isClaudeSession(api, sessionID) {
  if (api.options.always === true) return true
  const messages = api.data.session.message.list(sessionID) ?? []
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.type === "assistant" && message.model?.providerID) return message.model.providerID === PROVIDER_ID
  }
  const model = api.data.session.get(sessionID)?.model ?? api.ui.model.current()
  return model?.providerID === PROVIDER_ID
}

function isSidebarVisible(api, sessionID, width) {
  if (api.data.session.get(sessionID)?.parentID) return false
  return api.options.compact !== true && width > 120
}

function refreshMs(api) {
  const minutes = Number(api.options.refreshMinutes)
  return Math.max(1, Number.isFinite(minutes) ? minutes : DEFAULT_REFRESH_MINUTES) * 60_000
}

// One store shared by every view, backed by the cross-window cache in usage.js. It only
// touches the cache (and possibly the network) while some view wants data.
function createStore(api) {
  const [entry, setEntry] = createSignal({ loading: true })
  const [now, setNow] = createSignal(Date.now())
  let demand = 0
  let inFlight

  const refresh = (force = false) => {
    if (demand === 0 || inFlight) return inFlight
    inFlight = loadUsage({ intervalMs: refreshMs(api), force })
      .then((next) => setEntry(next))
      .catch((error) => setEntry((prev) => ({ ...prev, loading: false, error: error?.message ?? "Usage unavailable" })))
      .finally(() => {
        inFlight = undefined
        setNow(Date.now())
        api.renderer.requestRender()
      })
    return inFlight
  }

  const tick = setInterval(() => refresh(), TICK_MS)

  return {
    entry,
    now,
    refresh,
    want() {
      demand++
      if (demand === 1) refresh()
      return () => demand--
    },
    dispose() {
      clearInterval(tick)
    },
  }
}

// Registers demand while `active()` is true.
function useDemand(store, active) {
  effect(() => {
    if (!active()) return
    const release = store.want()
    onCleanup(release)
  })
}

function Gauge(api, store, label, window, width) {
  const theme = () => palette(api)
  const color = () => levelColor(window.usedPercent, theme())
  const bar = gauge(window.usedPercent, width - LABEL_WIDTH - 1)
  const percent = formatPercent(window.usedPercent)
  const reset = () => {
    const suffix = ` · ${shortReset(window.resetsAt, store.now())}`
    const available = width - percent.length
    return suffix.length > available ? `${suffix.slice(0, available - 1)}…` : suffix
  }
  return h(
    "box",
    { flexDirection: "column", flexShrink: 0, width },
    h(
      "box",
      { flexDirection: "row" },
      h("text", { fg: () => theme().muted }, `${label.padEnd(LABEL_WIDTH)} `),
      h(
        "text",
        { flexShrink: 0, width: width - LABEL_WIDTH - 1 },
        h("span", { style: () => ({ fg: color() }) }, bar.fill),
        h("span", { style: () => ({ fg: theme().muted }) }, bar.track),
      ),
    ),
    h(
      "text",
      { width, wrapMode: "none", truncate: true },
      h("span", { style: () => ({ fg: color() }) }, percent),
      h("span", { style: () => ({ fg: theme().muted }) }, reset),
    ),
  )
}

function Gauges(api, store, usage) {
  const windows = [
    ["5h", usage.fiveHour],
    ["7d", usage.sevenDay],
  ].filter(([, window]) => window)
  if (windows.length === 0) return h("text", { fg: () => palette(api).muted }, "No usage windows")
  const width = windows.length === 1 ? LAYOUT_WIDTH : (LAYOUT_WIDTH - COLUMN_GAP) / 2
  return h(
    "box",
    { flexDirection: "row", width: LAYOUT_WIDTH, columnGap: COLUMN_GAP },
    windows.map(([label, window]) => Gauge(api, store, label, window, width)),
  )
}

function SidebarView(api, store, sessionID) {
  const visible = createMemo(() => isClaudeSession(api, sessionID()))
  useDemand(store, visible)
  const theme = () => palette(api)
  const usage = createMemo(() => store.entry().usage)
  const note = () => statusNote(store.entry(), store.now())
  return h(
    "box",
    { visible },
    () =>
      visible()
        ? h(
            "box",
            { flexDirection: "column" },
            h("text", { fg: () => theme().text, attributes: TextAttributes.BOLD }, "Claude Usage"),
            () => {
              const current = usage()
              if (current) return Gauges(api, store, current)
              if (store.entry().loading) return h("text", { fg: () => theme().muted }, "Loading...")
              if (!note()) return h("text", { fg: () => theme().muted }, "No usage yet")
              return null
            },
            // With numbers on screen, a failure is a muted note; without them it's a warning.
            () =>
              note()
                ? h(
                    "text",
                    { fg: () => (usage() ? theme().muted : theme().warning), width: LAYOUT_WIDTH, wrapMode: "none", truncate: true },
                    note,
                  )
                : null,
          )
        : h("box"),
  )
}

function CompactView(api, store, sessionID) {
  const dimensions = useTerminalDimensions()
  const visible = createMemo(
    () => isClaudeSession(api, sessionID()) && !isSidebarVisible(api, sessionID(), dimensions().width),
  )
  useDemand(store, visible)
  const text = () => {
    const usage = store.entry().usage
    if (!usage) return store.entry().loading ? "Claude ..." : ""
    const windows = [
      ["5h", usage.fiveHour],
      ["7d", usage.sevenDay],
    ].filter(([, window]) => window)
    if (windows.length === 0) return ""
    const [label, worst] = windows.reduce((a, b) => (b[1].usedPercent > a[1].usedPercent ? b : a))
    return `Claude ${label} ${formatPercent(worst.usedPercent)}`
  }
  return h("box", { visible }, h("text", { fg: () => palette(api).muted }, text))
}

export default Plugin.define({
  id: "claude-usage",
  setup(api) {
    const store = createStore(api)
    const sidebar = api.ui.slot({
      prepend: "sidebar.content",
      render: (props) => SidebarView(api, store, () => props.sessionID),
    })
    const compact = api.ui.slot({
      append: "prompt.footer.status",
      render: (props) =>
        h("box", {}, () => (props.sessionID ? CompactView(api, store, () => props.sessionID) : h("box", { visible: false }))),
    })
    api.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "claude-usage.refresh",
          title: "Refresh Claude usage",
          group: "Claude",
          palette: true,
          slash: { name: "claude-usage" },
          run: () => store.refresh(true),
        },
      ],
    }))
    return () => {
      sidebar()
      compact()
      store.dispose()
    }
  },
})
