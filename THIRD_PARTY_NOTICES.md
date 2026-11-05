# Third-party notices

## opencode-codex-usage-plugin

Parts of this project are adapted from
[@davidaayers/opencode-codex-usage-plugin](https://github.com/davidaayers/opencode-codex-usage-plugin)
by David Ayers, a fork of
[zaniluca/opencode-codex-usage-plugin](https://github.com/zaniluca/opencode-codex-usage-plugin)
by Luca Zani. The adapted parts are:

- `usage.js`: the eighth-block `gauge()` function.
- `tui.js`: the theme palette and usage-level colours (50/75/90% thresholds), the gauge
  layout (widths, label/bar row, percent and reset row with truncation), the provider
  check for a session (`isClaudeSession`), the sidebar visibility check
  (`isSidebarVisible`), the compact footer text, and how the sidebar and footer views
  are registered.

That project is distributed under the following license:

```text
MIT License

Copyright (c) 2026 Luca Zani

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
