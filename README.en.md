# deepseek-harness-hashline

[中文](README.md) · [English](README.en.md)

> **Experimental**
>
> **This plugin is still under active testing and is not recommended for production use. Use it at your own risk and validate it in an isolated workspace before enabling it on real projects.**
>
> The API, settings, and tool behavior may change without notice.

<p align="center">
  <img alt="Status Experimental" src="https://img.shields.io/badge/Status-Experimental-ff6b6b">
  <img alt="Version 0.3.3" src="https://img.shields.io/badge/Version-0.3.3-5965d8">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-3b7a57">
</p>

**DeepSeek Harness hash-anchored file editing plugin**: provides `hashline_read` and `hashline_edit`, binding edits to the exact lines most recently read by the model through `LINE:HASH` anchors. This helps detect stale reads, supports multiple edits in one request, and makes file changes mechanically reliable.

`hashline_edit` is an anchored-only surface: `edits` is required and every element is a flat object — `op` is `set_line`, `replace_lines`, or `insert_after`, with `anchor` (or `start_anchor`+`end_anchor`) and `new_text`. `op` is optional: an element carrying only `anchor`+`new_text` parses as `set_line`, and one carrying only `start_anchor`+`end_anchor`+`new_text` parses as `replace_lines` (the common missing-`op` dialect is equivalent to the explicit form). Use the built-in `edit` (`old_string` / `new_string`) for a simple unique literal replacement and `write` for new files. Passing an actual `old_string` / `new_string` / `edits[].replace` payload is rejected before any file access with guidance toward the built-in `edit` (aligned with official v0.1.2: `null` placeholders for unused fields are ignored). Common malformed wrappers from models/adapters (fields hoisted to the argument root, array items materialized as root-level numeric keys, empty variant shells, missing `op`) are recovered automatically when unambiguous and noted in the result; irrecoverable shapes fail with a structural fingerprint and the canonical shape template. After enabling "Replace built-in read/edit", agents allowed to edit switch to the same-named strictly anchored `read` / `edit` with identical behavior.

## Features

| Capability | Description |
| --- | --- |
| `LINE:HASH` reads | Returns `LINE\|HASH  text` records with model-visible EOL/BOM metadata. The default hash covers the complete line and its real line ending. |
| Three anchored edits | `set_line`, `replace_lines`, and `insert_after`; each `edits` element is a flat `{op, anchor…, new_text}` object; op/field matching is enforced at execution time. |
| Dialect recovery | Unambiguous malformed wrappers (hoisted top-level fields, numeric-key shadows, empty variant shells, missing `op` — inferred from field shape: `anchor+new_text`→`set_line`, dual anchors→`replace_lines`) are recovered automatically and noted as `normalizedFrom`; conflicts are rejected without writing. |
| Atomic batch edits | Validates all anchors first, rejects overlaps, and then writes atomically. |
| Version CAS protection | Uses the DSH file version to prevent concurrent changes between validation and writing. |
| Text fidelity | Preserves the UTF-8 BOM (byte-path detection: `fs.readBytes` with BOM-preserving decode; falls back to `readText` on older DSH), untouched regions of mixed-EOL files, LF/CRLF style, and the final-newline state. |
| Stale-anchor recovery | Returns nearby current lines and fresh anchors when an anchor is no longer valid. |
| Native result cards | Successful reads reuse DSH native `ReadBlock`: the whole `LINE|HASH` is one gray, unselectable gutter while the text remains separately selectable and syntax-highlighted. Successful edits use native-style diff chrome: removed/added rows show gray, unselectable `-LINE|OLD_HASH` / `+LINE|NEW_HASH` gutters (the line number is 1-based in the old/new file) while preserving red/green diff semantics and content-only selection/copy. |
| Reversible strict replacement | The Agent-scoped `edit` accepts only fresh `LINE:HASH`. Open Design and DSH headless also require the default-off headless gate. The replacement is reversible and Fiber-owned. |
| Chinese prompt guidance | When enabled, the injected prompt guidance, tool descriptions, error messages, and tool output text are in Chinese while tool names stay in English. |

## Requirements

- DeepSeek Harness ≥ 0.1.7-alpha.2; the Web GUI uses `web`, Open Design stdio uses `open-design`, and DSH one-shot tasks use `headless`
- Node.js `^22.19.0 || >=24.0.0`
- `open-design`/`headless` run the Host half only (no Web configuration form)

## Installation

DSH bundles are profile-scoped, so Web, Open Design, and stock headless must be installed independently. Use this plugin's CLI for Web and official `dsh plugin` commands for non-interactive profiles. **DSH Desktop (the Electron app)**: supported (desktop Host port 19387); the desktop profile (`~/.dsh/profiles/desktop`) is owned exclusively by the app, and both the `dsh plugin` CLI and this plugin's CLI reject `--profile desktop` by name. For a link dev install (while the app is **not running**), edit `~/.dsh/profiles/desktop/package.json`:

```jsonc
"dependencies": { "deepseek-harness-hashline": "link:<absolute path to this repo>" },
"dsh": { "profile": { "bundles": [ /* keep official bundles, append */ "deepseek-harness-hashline" ] } }
```

then `pnpm install` inside the profile directory; start the app to mount, `npm run build` + restart after source changes, remove both entries + `pnpm install` to uninstall. Build a source checkout first:

```powershell
npm install
npm run build

# Web GUI
node bin/dsh-hashline.mjs install --profile web --link $PWD

# Open Design's actual stdio profile
dsh plugin --profile open-design add "link:$PWD"

# Optional: DSH's built-in one-shot headless profile
dsh plugin --profile headless add "link:$PWD"
```

`--link` must point at this plugin's source directory. Each command changes only its target profile; the next `open-design`/`headless` process loads the bundle without Web-port probing or HMR.

> ⚠️ A missing `link:` target can remain a plain dependency without joining `dsh.profile.bundles`. Verify each profile:

```powershell
node bin/dsh-hashline.mjs status --profile web
dsh plugin --profile open-design list
dsh --profile open-design --dump-default-config
dsh plugin --profile headless list
```

## Updates

Re-run the installation command to update the dependency and persistent bundle. Changes to
`lib/client.js` hot-swap automatically through DSH client HMR (a 500 ms stat poll plus the
`/plugins/events` SSE `rebuilt` frame driving an in-page replacement), so no page refresh is needed.

The Host half has no hot path: the `hmr` service surface no longer exposes `registerConfig` /
`partialReload`, and a profile bundle lives under `node_modules`, which the official watcher's
default `ignored` list excludes — a new build never reaches the long-running process, so a Host-side
change requires one `dsh web` restart.

## Uninstallation

```powershell
node bin/dsh-hashline.mjs remove --profile web
dsh plugin --profile open-design remove deepseek-harness-hashline
dsh plugin --profile headless remove deepseek-harness-hashline
```

Uninstallation is profile-scoped and removes the persistent bundle and running entries without deleting DSH session data. Existing user overrides in the `hashline` settings namespace may remain and can be reused after a later installation.

## Settings and data

| Data | Storage |
| --- | --- |
| Enablement, built-in read/edit replacement, the headless replacement gate, tool-selection guidance, prompt language, and four hash/read parameters | The DSH `hashline` settings namespace, edited on the sidebar Plugins page under this package (DSH 0.1.6+) |

The plugin does not register capabilities beyond its model tools, upload data, or maintain independent data files. The client only contributes a configuration form to the `plugins.bundle.config` slot (keyed by this package's npm name) and uses DSH `settingsScope` to read and write the same Host namespace.
The exact form order, defaults, and ranges are maintained only in the [Usage guide configuration section](docs/usage.md#配置).

## FAQ

**How is this different from the built-in `read` and `edit`?** Hashline binds an anchored edit to the exact content most recently read, detects stale reads, and handles multiple edits as one atomic request. `hashline_edit` accepts anchored `edits` only — a simple unique literal replacement is the built-in `edit`'s job, so the two tools complement each other instead of overlapping. Hashline reads use the DSH native read card, while edits use a native-style diff card with Hashline gutters.

**Can a short hash collide?** A short hash has a theoretical collision probability. The default 4 hexadecimal characters provide a 16-bit check and are combined with the line number and file-level version CAS. Increase `hashLength` for higher-risk deployments.

**How do I read large files?** A read without `offset`/`limit` is capped at 50 KiB and the tool then tells you to switch to windows. Pass explicit `offset`/`limit` to read any file in bounded windows; windowed reads and edits are not limited by total file size (each `new_text` still respects the 50 KiB cap).

**How does Replace built-in read/edit work?** When enabled, an allowed agent sees strict `read` and `edit` surfaces while `hashline_read` and `hashline_edit` are hidden. Call `read` before each change and use its fresh anchors. Each `edit.edits` element is a flat object: `op` is `set_line`, `replace_lines`, or `insert_after`, with `anchor` (or `start_anchor`+`end_anchor`) and `new_text`. Disabling the setting restores the original tools.

Open Design's `open-design` stdio profile and DSH's `headless` profile additionally require **Replace built-in read/edit in headless mode**, which is off by default. While the gate is off, they retain original `read` / `edit` and explicit `hashline_read` / `hashline_edit`. Replacement still requires all four inherited tools; minimal remains exempt and denies the global Hashline tools.

## Development documentation

- [Usage guide](docs/usage.md): tool parameters, anchor format, edit variants, and the safety model
- [Design notes](docs/design.md): tool boundaries, anchors, text model, DSH integration, and package shape
- [Development guide](docs/development.md): local development installation, HMR, testing, and verification

## License

[MIT](LICENSE)
