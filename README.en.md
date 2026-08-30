# deepseek-harness-hashline

[中文](README.md) · [English](README.en.md)

> **Experimental**
>
> **This plugin is still under active testing and is not recommended for production use. Use it at your own risk and validate it in an isolated workspace before enabling it on real projects.**
>
> The API, settings, and tool behavior may change without notice.

<p align="center">
  <img alt="Status Experimental" src="https://img.shields.io/badge/Status-Experimental-ff6b6b">
  <img alt="Version 0.1.0" src="https://img.shields.io/badge/Version-0.1.0-5965d8">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-3b7a57">
</p>

**DeepSeek Harness hash-anchored file editing plugin**: provides `hashline_read` and `hashline_edit`, binding edits to the exact lines most recently read by the model through `LINE:HASH` anchors. This helps detect stale reads, supports multiple edits in one request, and makes file changes mechanically reliable.

The explicit `hashline_edit` tool accepts two mutually exclusive input styles: compatibility parameters (`old_string` / `new_string` / `replace_all`) for a simple unique literal replacement, or the `edits` list for anchored edits. In the default mode, the plugin supplements the built-in `read` and `edit` tools. New files should still use `write`. When **Replace built-in read/edit** is enabled, allowed agents instead receive strict `read` / `edit` surfaces: `edit` requires fresh `LINE:HASH` anchors and does not expose literal-replacement parameters or unanchored `replace`.

## Features

| Capability | Description |
| --- | --- |
| `LINE:HASH` reads | Returns `LINE\|HASH  text` records with model-visible EOL/BOM metadata. The default hash covers the complete line and its real line ending. |
| Compatible literal replacement | Explicit `hashline_edit` supports `old_string` / `new_string` / `replace_all` for a simple unique replacement through the safe write pipeline. |
| Three anchored edits | `set_line`, `replace_lines`, and `insert_after`; every `edits` array element contains exactly one operation. |
| Exact replacement escape hatch | `replace` inside explicit `hashline_edit` performs strict literal matching and requires a unique match by default. |
| Atomic batch edits | Validates all anchors first, rejects overlaps, and then writes atomically. |
| Version CAS protection | Uses the DSH file version to prevent concurrent changes between validation and writing. |
| Text fidelity | Preserves the UTF-8 BOM, untouched regions of mixed-EOL files, LF/CRLF style, and the final-newline state. |
| Stale-anchor recovery | Returns nearby current lines and fresh anchors when an anchor is no longer valid. |
| Native result cards | Successful reads reuse DSH native `ReadBlock`: the whole `LINE|HASH` is one gray, unselectable gutter while the text remains separately selectable and syntax-highlighted. Successful edits use native-style diff chrome: removed/added rows show gray, unselectable `-|OLD_HASH` / `+|NEW_HASH` gutters while preserving red/green diff semantics and content-only selection/copy. |
| Reversible strict replacement | The Agent-scoped `edit` accepts only fresh `LINE:HASH` anchors; the replacement remains reversible and is cleaned up with the owning Cordis Fiber. |
| Chinese prompt guidance | When enabled, the injected prompt guidance and tool descriptions are in Chinese while tool names stay in English. |

## Requirements

- DeepSeek Harness ≥ 0.1.2-alpha.1, using the `web` profile
- Node.js `^22.19.0 || >=24.0.0`
- The web settings card also requires DSH support for `settings.register(..., { exposeToClients: true })`

## Installation

Replace `<absolute-path>` with the actual absolute path on your machine. The source checkout does not track the generated `lib/` directory. Install development dependencies once, then run `npm run build` before the first installation and after source changes:

```powershell
npm install
npm run build
```

Local file installation:

```powershell
dsh plugin --profile web add "file:<absolute-path>/deepseek-harness-hashline"
```

For continuous development, install with `link:` directly — the runtime resolves DSH peers from the profile, so no local junction setup is required:

```powershell
dsh plugin --profile web add "link:<absolute-path>/deepseek-harness-hashline"
```

Check the composition after installation:

```powershell
dsh --profile web --dump-config
```


## Updates

Run the installation command again to update the dependency and persistent bundle. Refresh the page after browser-side changes. During local `link:` development, Host files hot reload when the DSH HMR service is available; if unavailable, inspect this plugin's exact self-watch paths and report the failure instead of restarting DSH.

## Uninstallation

```powershell
dsh plugin --profile web remove deepseek-harness-hashline
```

Uninstallation removes the persistent bundle and running entries. It does not delete DSH session data. Existing user overrides in the `hashline` settings namespace may remain and can be reused after a later installation.

## Settings and data

| Data | Storage |
| --- | --- |
| Enablement, built-in read/edit replacement, tool-selection guidance, prompt language, and four hash/read parameters | The DSH `hashline` settings namespace, edited under Settings > Plugins > Plugin configuration |

The plugin does not register capabilities beyond its model tools, upload data, or maintain independent data files. The client only contributes a configuration card to the existing `settings.plugin.item` slot and uses DSH `settingsScope` to read and write the same Host namespace.
The exact card order, defaults, and ranges are maintained only in the [Usage guide configuration section](docs/usage.md#配置).

## FAQ

**How is this different from the built-in `read` and `edit`?** Hashline binds an anchored edit to the exact content most recently read, detects stale reads, and handles multiple edits as one atomic request. Explicit `hashline_edit` keeps `old_string` / `new_string` compatibility for simple cases and routes it through the stable-read and version-CAS pipeline. The `edit` surface installed by built-in replacement is strict and rejects those unanchored parameters. Hashline reads use the DSH native read card, while edits use a native-style diff card with Hashline gutters.

**Can a short hash collide?** A short hash has a theoretical collision probability. The default 4 hexadecimal characters provide a 16-bit check and are combined with the line number and file-level version CAS. Increase `hashLength` for higher-risk deployments.

**How does Replace built-in read/edit work?** When enabled, an allowed agent sees strict `read` and `edit` surfaces while `hashline_read` and `hashline_edit` are hidden. Call `read` before each change and use its fresh anchors. Every `edit.edits` array element must contain exactly one `set_line`, `replace_lines`, or `insert_after`; `old_string` / `new_string` and `replace` are rejected. Disabling the setting restores the original tools. Replacement is installed only when all four original capabilities are already visible, so it cannot bypass visibility restrictions. The same Agent scope also replaces the built-in prompt guidance and restores it when disabled.

## Development documentation

- [Usage guide](docs/usage.md): tool parameters, anchor format, edit variants, and the safety model
- [Design notes](docs/design.md): tool boundaries, anchors, text model, DSH integration, and package shape
- [Development guide](docs/development.md): local development installation, HMR, testing, and verification

## License

[MIT](LICENSE)
