// Sidebar gauges for Claude subscription usage (5h + 7d), modelled on
// @davidaayers/opencode-codex-usage-plugin. Plain JS against the opentui Solid runtime,
// so no JSX build step is needed.
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
import { fetchUsage, formatPercent, gauge, shortReset } from "./usage.js"

const PROVIDER_ID = "claude-agent"
const POLL_MS = 60_000
const MIN_REFRESH_MS = 15_000
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

// One poller shared by every view; it only hits the network while some view wants data.
function createStore(api) {
  const [state, setState] = createSignal({ status: "loading", usage: null, message: "Loading..." })
  const [now, setNow] = createSignal(Date.now())
  let demand = 0
  let inFlight
  let lastFetch = 0

  const refresh = (force = false) => {
    if (demand === 0 || inFlight) return inFlight
    if (!force && Date.now() - lastFetch < MIN_REFRESH_MS) return
    lastFetch = Date.now()
    inFlight = fetchUsage()
      .then((usage) => setState({ status: "ready", usage, message: "" }))
      .catch((error) => {
        const message = error?.message ?? "Usage unavailable"
        // Keep showing the last good numbers on a transient failure.
        setState((prev) => (prev.usage ? { ...prev, message } : { status: "error", usage: null, message }))
      })
      .finally(() => {
        inFlight = undefined
        setNow(Date.now())
        api.renderer.requestRender()
      })
    return inFlight
  }

  const poll = setInterval(() => refresh(true), POLL_MS)
  const tick = setInterval(() => setNow(Date.now()), 30_000)
  const stopEvents = api.data.listen(({ details }) => {
    if (details.type === "session.step.ended" || details.type === "session.usage.updated") refresh()
  })

  return {
    state,
    now,
    refresh,
    want() {
      demand++
      if (demand === 1) refresh(true)
      return () => demand--
    },
    dispose() {
      clearInterval(poll)
      clearInterval(tick)
      stopEvents()
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
  const usage = createMemo(() => store.state().usage)
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
              const { status, message } = store.state()
              return h("text", { fg: () => (status === "error" ? theme().warning : theme().muted) }, message)
            },
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
    const usage = store.state().usage
    if (!usage) return store.state().status === "loading" ? "Claude ..." : ""
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
