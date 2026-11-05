# opencode-claude-usage

An [OpenCode](https://opencode.ai) TUI sidebar plugin that shows your Claude subscription's 5-hour and 7-day usage as compact gauges with reset countdowns.

```text
Claude Usage
5h  █▏░░░░░░░░░  7d  ▉░░░░░░░░░░
11% · 1h30m        9% · 1d17h
```

It's meant for people who use OpenCode's **Claude Agent** provider, which signs in with Claude Code (`claude auth login`) and counts against your Pro/Max plan limits. The presentation is adapted from [@davidaayers/opencode-codex-usage-plugin](https://github.com/davidaayers/opencode-codex-usage-plugin), which does the same for Codex (see [Credits](#credits)).

## Features

- **Two gauges**: the 5-hour session window and the 7-day weekly window, with time until each one resets.
- **Colours from your theme**: `success` below 50%, `accent` from 50%, `warning` from 75%, `error` from 90%.
- **Compact footer line**: on narrow terminals (sidebar hidden) or in child sessions, shows the most constrained window in the prompt footer, e.g. `Claude 5h 11%`.
- **Live updates**: every 60 seconds, after each model step (at most every 15 seconds), and on demand with `/claude-usage` or **Refresh Claude usage** in the command palette.
- **Shows only for Claude Agent sessions**: hidden when the session uses another provider.
- **No build step or dependencies**: plain JavaScript against the OpenCode-provided Solid/OpenTUI runtime.

## Requirements

- OpenCode 2.x (tested on 2.2.5).
- A Claude Pro or Max subscription, signed in through Claude Code (`claude auth login`), and the **Claude Agent** provider connected in OpenCode (`/connect`).

## Install

### With the OpenCode CLI

```sh
opencode plugin add github:verrannt/opencode-claude-usage
```

This installs the plugin from GitHub and adds `"github:verrannt/opencode-claude-usage"` to the `plugins` list in `~/.config/opencode/cli.json`. Update it later with `opencode plugin update`.

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

or copy `tui.js`, `usage.js` and `package.json` into `~/.config/opencode/plugins/claude-usage/`, where OpenCode discovers plugins without any configuration. Use only one of these, or the plugin loads twice.

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

| Option    | Type      | Default | Description                                                                     |
| --------- | --------- | ------- | ------------------------------------------------------------------------------- |
| `compact` | `boolean` | `false` | Always use the compact footer line, e.g. when you hide the sidebar manually.    |
| `always`  | `boolean` | `false` | Show usage in every session, not only sessions on the Claude Agent provider.    |

## How it works

- **Credentials**: the plugin reads Claude Code's OAuth access token, from the macOS keychain (`Claude Code-credentials`) or from `~/.claude/.credentials.json` (or `$CLAUDE_CONFIG_DIR/.credentials.json`) on other systems. The token is only sent to `api.anthropic.com`.
- **Usage source**: `GET https://api.anthropic.com/api/oauth/usage`, the endpoint behind Claude Code's `/usage` command.
- **No token refresh**: the plugin never refreshes the token itself, because rotating the refresh token could sign Claude Code out. If the token has expired, the sidebar says so until Claude Code or the Claude Agent provider refreshes it on its next request.
- On a temporary failure, the last good numbers stay on screen.

## Limitations

- The usage endpoint isn't documented or officially supported by Anthropic and may change or disappear.
- If you use `CLAUDE_CONFIG_DIR`, Claude Code may store its keychain entry under a different name; the plugin then falls back to `$CLAUDE_CONFIG_DIR/.credentials.json`.

## Development

```sh
npm test
```

`usage.js` holds credential lookup, the API call and formatting, and has unit tests. `tui.js` holds the sidebar and footer views.

## Credits

The gauge display and sidebar logic are adapted from
[@davidaayers/opencode-codex-usage-plugin](https://github.com/davidaayers/opencode-codex-usage-plugin)
by David Ayers, itself a fork of
[zaniluca/opencode-codex-usage-plugin](https://github.com/zaniluca/opencode-codex-usage-plugin)
by Luca Zani, both under the MIT license. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
for the adapted parts and the original license notice.

## License

[MIT](LICENSE). Third-party portions: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
