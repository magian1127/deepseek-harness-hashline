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

`hashline_edit` accepts two mutually exclusive input styles: a simple unique literal replacement using the original-style parameters (`old_string` / `new_string` / `replace_all`), or the `edits` list for anchored edits. In the default mode, the plugin supplements the built-in `read` and `edit` tools. New files should still use `write`. You can also enable **Replace built-in read/edit** so an agent that is allowed to edit can use Hashline semantics through the `read` and `edit` names.

## Features

| Capability | Description |
| --- | --- |
| `LINE:HASH` reads | Returns `LINE\|HASH  text` records with model-visible EOL/BOM metadata. The default hash covers the complete line and its real line ending. |
| Original-style edits | Simple unique literal replacement via `old_string` / `new_string` / `replace_all`, routed through the same safe write pipeline. |
| Three anchored edits | `set_line`, `replace_lines`, and `insert_after` |
| Exact replacement escape hatch | `replace` inside `edits` performs strict literal matching and requires a unique match by default. |
| Atomic batch edits | Validates all anchors first, rejects overlaps, and then writes atomically. |
| Version CAS protection | Uses the DSH file version to prevent concurrent changes between validation and writing. |
| Text fidelity | Preserves the UTF-8 BOM, untouched regions of mixed-EOL files, LF/CRLF style, and the final-newline state. |
| Stale-anchor recovery | Returns nearby current lines and fresh anchors when an anchor is no longer valid. |
| Native result cards | Successful reads reuse DSH native `ReadBlock`: the whole `LINE|HASH` is one gray, unselectable gutter while the text remains separately selectable and syntax-highlighted. Successful edits use native-style diff chrome: removed/added rows show gray, unselectable `-|OLD_HASH` / `+|NEW_HASH` gutters while preserving red/green diff semantics and content-only selection/copy. |
| Reversible replacement | Agent-scoped built-in tool replacement is reversible and is cleaned up with the owning Cordis Fiber. |
| Chinese prompt guidance | When enabled, the injected prompt guidance and tool descriptions are in Chinese while tool names stay in English. |

## Requirements

- DeepSeek Harness `0.1.0-rc.7` or a compatible version, using the `web` profile
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

Run the installation command again to update the dependency and persistent bundle. Refresh the page after browser-side changes. During local `link:` development, Host files hot reload when the DSH HMR service is available; otherwise restart DSH as indicated by its logs.

## Uninstallation

```powershell
dsh plugin --profile web remove deepseek-harness-hashline
```

Uninstallation removes the persistent bundle and running entries. It does not delete DSH session data. Existing user overrides in the `hashline` settings namespace may remain and can be reused after a later installation.

## Settings and data

| Data | Storage |
| --- | --- |
| Global enable switch, built-in read/edit replacement switch, and hash parameters | The DSH `hashline` settings namespace, edited under Settings > Plugins > Plugin configuration |

The plugin does not register capabilities beyond its model tools, upload data, or maintain independent data files. The client only contributes a configuration card to the existing `settings.plugin.item` slot and uses DSH `settingsScope` to read and write the same Host namespace.

## FAQ

**How is this different from the built-in `read` and `edit`?** The built-in tools operate on line numbers and text. Hashline binds an anchored edit to the hash anchor of the exact content most recently read, detects stale reads, and handles multiple edits as one atomic request. For a simple unique literal replacement you can also pass `old_string` / `new_string` directly; it goes through the same stable read and version CAS as anchored edits. Hashline reads use the DSH native read card, while edits use a native-style diff card with Hashline gutters.

**Can a short hash collide?** A short hash has a theoretical collision probability. The default 4 hexadecimal characters provide a 16-bit check and are combined with the line number and file-level version CAS. Increase `hashLength` for higher-risk deployments.

**How does Replace built-in read/edit work?** When enabled, an allowed agent sees `read` and `edit` using Hashline anchors, while `hashline_read` and `hashline_edit` are hidden. The original tools are restored when the setting is disabled. Replacement is installed only when the agent already has access to `read`, `edit`, `hashline_read`, and `hashline_edit`, so it cannot bypass visibility restrictions. When replacement is active, the built-in `read` / `edit` system-prompt guidance is also replaced in each allowed agent's scope by the same-named Hashline guidance, so the instructions never appear twice; disabling the setting restores the original guidance.

## Development documentation

- [Usage guide](docs/usage.md): tool parameters, anchor format, edit variants, and the safety model
- [Design notes](docs/design.md): tool boundaries, anchors, text model, DSH integration, and package shape
- [Development guide](docs/development.md): local development installation, HMR, testing, and verification

## License

[MIT](LICENSE)
