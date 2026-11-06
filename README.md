# opencode-claude-usage

An [OpenCode](https://opencode.ai) TUI sidebar plugin that shows your subscription usage as compact gauges with reset countdowns: your Claude plan's 5-hour and 7-day windows, and the Codex limits of every ChatGPT account you've signed in to in OpenCode.

```text
Usage
Cache ████████████▍░░░░░  41m12s
Claude
5h  ███▍░░░░░░░  7d  █▎░░░░░░░░░
31% · 2h10m        11% · 1d17h
Codex · OpenAI
5h  ───────────  7d  ███████▎░░░
n/a                66% · 4d16h
Codex · OpenAI 2 ●
5h  ───────────  7d  ▎░░░░░░░░░░
n/a                2% · 6d23h
```

It's meant for people who use OpenCode with subscription logins rather than API keys: the **Claude Agent** provider, which signs in with Claude Code (`claude auth login`), and the **OpenAI** provider's **Sign in with ChatGPT**. The presentation is adapted from [@davidaayers/opencode-codex-usage-plugin](https://github.com/davidaayers/opencode-codex-usage-plugin), which shows Codex usage for the Codex CLI's account (see [Credits](#credits)).

## Features

- **All your accounts**: Claude, plus one section per ChatGPT login stored in OpenCode, labelled with the name OpenCode gave the login. With several ChatGPT logins, `●` marks the one OpenCode currently uses.
- **Same layout for every account**: a 5-hour and a 7-day column, with time until each window resets. When a plan has no 5-hour window (some Codex plans only have a weekly one), that column shows a dashed bar and `n/a`.
- **Prompt-cache countdown**: an estimate of how long the current session's prompt cache stays warm, counting down every second from the session's last model request (`active` while a request runs, `expired` afterwards). See [Prompt cache estimate](#prompt-cache-estimate).
- **Colours from your theme**: `success` below 50%, `accent` from 50%, `warning` from 75%, `error` from 90%.
- **Compact footer line**: on narrow terminals (sidebar hidden) or in child sessions, shows the most constrained window of the account the session uses, e.g. `Claude 5h 31%` or `Codex 7d 2%`.
- **Gentle on rate limits**: refreshes every 5 minutes by default, shares one cache and request schedule per account across all OpenCode windows and plugin reloads, and backs off (5 → 30 minutes) when an endpoint rate limits. The last numbers stay on screen with a short note such as `Rate limited · retry in 5m`.
- **Manual refresh**: `/claude-usage` or **Refresh subscription usage** in the command palette (at most every 30 seconds per account, never during a backoff).
- **No build step or dependencies**: plain JavaScript against the OpenCode-provided Solid/OpenTUI runtime.

## Requirements

- OpenCode 2.x (tested on 2.2.5), with the TUI on the same machine as your Claude Code login.
- For Claude: a Pro or Max subscription, signed in through Claude Code (`claude auth login`).
- For Codex: one or more ChatGPT accounts connected in OpenCode with `/connect` → **OpenAI** → **Sign in with ChatGPT**.

Accounts you haven't signed in to are left out.

## Install

### With the OpenCode CLI

```sh
opencode plugin add github:verrannt/opencode-claude-usage
```

This installs the plugin from GitHub and adds `"github:verrannt/opencode-claude-usage"` to the `plugins` list in `~/.config/opencode/cli.json`. Update it later with `opencode plugin update`.

If you also use `@davidaayers/opencode-codex-usage-plugin`, you can remove it: this plugin already shows that account's Codex usage, as long as it's also signed in to OpenCode.

### From source

```sh
git clone https://github.com/verrannt/opencode-claude-usage.git
```

Then either point `cli.json` at the clone:

```jsonc
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["/absolute/path/to/opencode-claude-usage"],
}
```

or copy `tui.js`, `usage.js`, `claude.js`, `codex.js`, `cache.js` and `package.json` into `~/.config/opencode/plugins/claude-usage/`, where OpenCode discovers plugins without any configuration. Use only one of these, or the plugin loads twice.

## Configuration

Pass options with the object form in `cli.json`:

```jsonc
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": [
    {
      "package": "github:verrannt/opencode-claude-usage",
      "options": { "compact": true },
    },
  ],
}
```

| Option           | Type      | Default | Description                                                                                     |
| ---------------- | --------- | ------- | ----------------------------------------------------------------------------------------------- |
| `compact`        | `boolean` | `false` | Always use the compact footer line, e.g. when you hide the sidebar manually.                    |
| `refreshMinutes` | `number`  | `5`     | Minutes between usage requests per account (minimum 1). Lower values hit rate limits sooner.   |
| `cacheMinutes`   | `object`  | `{ "claude-agent": 60, "openai": 30 }` | Prompt-cache lifetime per provider ID for the countdown. Add a provider to show the countdown for it too. |

To rename a Codex section, rename the login in OpenCode; the plugin uses its label.

## How it works

- **Claude credentials**: the plugin reads Claude Code's OAuth access token, from the macOS keychain (`Claude Code-credentials`) or from `~/.claude/.credentials.json` (or `$CLAUDE_CONFIG_DIR/.credentials.json`) on other systems. The token is only sent to `api.anthropic.com`.
- **Claude usage**: `GET https://api.anthropic.com/api/oauth/usage`, the endpoint behind Claude Code's `/usage` command.
- **ChatGPT credentials**: the plugin lists OpenCode's stored logins through OpenCode's own client API (`credential.list`) and uses the access token of each **Sign in with ChatGPT** login. API-key logins are ignored. The tokens are only sent to `chatgpt.com`.
- **Codex usage**: `GET https://chatgpt.com/backend-api/wham/usage`, the endpoint the Codex CLI reads for its rate limits.
- **No token refresh**: the plugin never refreshes a token itself, because rotating a refresh token could sign Claude Code or OpenCode out. OpenCode refreshes a ChatGPT login when it uses that account, so a login you haven't used for about a week (the token lifetime) shows `Login expired · use it once` and keeps its last numbers until you switch to it once. The same applies to Claude.
- **Shared cache**: the latest result and request schedule for each account live in `~/.cache/opencode-claude-usage/` (or under `$XDG_CACHE_HOME`), one file per account named `claude.json` or `codex-<credential id>.json`. They hold usage numbers and timestamps only, never credentials. Every OpenCode window reads them every 30 seconds and only sends a request when one is due, so several windows cost no more requests than one.
- **Rate limits**: the endpoints are rate limited per account, and Claude Code's own `/usage` counts against the same Claude limit. On HTTP 429 the plugin waits 5 minutes, doubling up to 30 minutes on repeated 429s, or longer if the server sends a `retry-after`.

## Prompt cache estimate

No provider reports how long a prompt cache has left, so the countdown is an estimate: the provider's cache lifetime minus the time since the session's last model request. A request that reads the cache renews its lifetime, so each step restarts the countdown. The line is hidden for providers without a configured lifetime and when the last step didn't use the cache.

- **Claude Agent: 60 minutes.** Claude Code labels its cache writes as 5-minute entries, but in practice its caches survive pauses of up to about an hour and are gone after that. That's what the author measured across several hundred pauses in their own sessions; it isn't documented behaviour, so set `cacheMinutes` if yours differs.
- **OpenAI (ChatGPT sign-in): 30 minutes.** OpenAI documents a 30-minute minimum cache lifetime for GPT-5.6 and later models on the Responses API, which OpenCode uses. Entries are sometimes kept longer.

A cache can still be evicted early, so treat the time left as an upper bound. Changing the start of the prompt (model, instructions, tools) also starts a new cache, which the estimate can't see.

## Limitations

- Neither usage endpoint is documented or officially supported by Anthropic or OpenAI; either may change or disappear.
- If you use `CLAUDE_CONFIG_DIR`, Claude Code may store its keychain entry under a different name; the plugin then falls back to `$CLAUDE_CONFIG_DIR/.credentials.json`.
- Only ChatGPT logins stored in OpenCode are shown. A Codex CLI login that isn't also signed in to OpenCode isn't.

## Development

```sh
npm test
```

`usage.js` holds request handling, the per-account cache with backoff, and formatting. `claude.js` and `codex.js` read each service's credentials and usage. `cache.js` estimates the prompt-cache time left. `tui.js` holds the sidebar and footer views. Everything except `tui.js` has unit tests.

## Credits

The gauge display and sidebar logic are adapted from
[@davidaayers/opencode-codex-usage-plugin](https://github.com/davidaayers/opencode-codex-usage-plugin)
by David Ayers, itself a fork of
[zaniluca/opencode-codex-usage-plugin](https://github.com/zaniluca/opencode-codex-usage-plugin)
by Luca Zani, both under the MIT license. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
for the adapted parts and the original license notice.

## License

[MIT](LICENSE). Third-party portions: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
