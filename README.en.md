# dsh-browser-mode

[中文](README.md) | English

[![Release](https://img.shields.io/github/v/release/Shad0wwa1ker/dsh-browser-mode?color=4c8bf5)](https://github.com/Shad0wwa1ker/dsh-browser-mode/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-2ea44f)](LICENSE)

A DeepSeek Harness (DSH) bundle that adds a **Browser mode** Session preset, lets you switch the browser source at runtime (Edge by default), and keeps every other Session from opening a browser until the user explicitly agrees.

Verified on DSH `0.2.1-rc.2` (Windows 11 + Edge).

## Features

- Visible browser: `headless: false` by default, so you can watch it work and take over at any time.
- Selectable browser source: Edge (default), Playwright's bundled Chromium, or an already running browser over CDP.
- Two ways in: a dedicated Browser mode Session, or a consent prompt in the current Session.
- Per-Session consent: an approval applies only to that Agent and lives in plugin memory; restarting DSH or starting a new Session asks again.
- Explainable refusal: a blocked call returns a reason and the next step, not a bare `permission denied`.
- Fail closed: an unresolvable preset, a missing question service, or an unloaded provider all count as "no browser".

## Install

### One paste

The plugin manager accepts git addresses. Paste this into its package field:

```
github:Shad0wwa1ker/dsh-browser-mode
```

Equivalent tool call:

```
plugin_manager install_bundle target:github:Shad0wwa1ker/dsh-browser-mode
```

This records the dependency `"@local/dsh-browser-mode": "github:Shad0wwa1ker/dsh-browser-mode"` in the profile and enables the bundle's three rows: the `preset-browser` preset, `browser-source`, and the `browser-gate`.

### One-time setup

Keep the shared `browserUse` registry row in `$DSH_PROFILE_DIR/cordis.patch.yml` (skip if already present):

```yaml
- insert:
    - id: browser-use
      name: "@deepseek-ai/dsh-browser-use"
```

The Playwright MCP provider is mounted by this bundle's `browser-source` row, so it needs no provider row of its own. That is what makes runtime switching possible.

> [!IMPORTANT]
> Upgrading from 1.5.1 or earlier: remove the `browser-use-playwright-mcp` row (keep `browser-use`). One process can host only one provider; while the old row exists `browser-source` logs a migration hint and stays passive.

### Updating to a newer version

The plugin market compares the `version` in the default branch's `package.json` for floating `github:owner/repo` sources, so a release only needs a version bump and a push:

```powershell
git tag v1.6.0
git push && git push --tags
```

Installed users press "Update" in the plugin market, or run these (pnpm re-resolves the GitHub dependency to the default branch):

```powershell
pnpm add "github:Shad0wwa1ker/dsh-browser-mode"
```

```
plugin_manager set_bundle enabled:false target:@local/dsh-browser-mode
plugin_manager set_bundle enabled:true  target:@local/dsh-browser-mode
```

### Confirm the install

```
plugin_manager list_plugins
```

`include:preset-browser`, `include:browser-source`, and `include:browser-gate` should all read `enabled: true` and `fiberPhase: "active"`.

## Use

**Option 1: a Browser mode Session** (a whole web task)

Pick "浏览器操作" as the mode when creating a Session. The model calls `browser_navigate` and friends without asking.

**Option 2: ask from the current Session**

Say "open this page in the browser and fill it in". The first browser call is refused, the model calls `browser_access`, and the UI asks:

```
Allow browser use?
May I open a browser in this Session? Purpose: …
[Allow]  [Do not allow]
```

After Allow, every browser call in that Session passes; after Do not allow, the model falls back to `web_search`, `web_fetch`, files, and the shell.

## Browser source

Edge is the default. Three sources:

| `source` | Behaviour |
| --- | --- |
| `edge` | launches the local Microsoft Edge (falls back to Playwright's Chromium when it is not found) |
| `builtin` | launches Playwright's own Chromium (`~/AppData/Local/ms-playwright/chromium-*`) |
| `endpoint` | attaches to a browser already started with a debugging port (`--cdp-endpoint`); this mode is exclusive, one Session at a time |

### Ask the model to switch

In any Session say "use the built-in browser" or "connect to my running browser"; the model calls `browser_source`:

```
browser_source({ source: "builtin" })
browser_source({ source: "endpoint", endpoint: "http://127.0.0.1:9222" })
```

With no arguments it only reports the current configuration. A switch remounts the provider immediately; sessions that already opened pages must call a browser tool again.

### Edit the configuration by hand

The choice is stored in `$DSH_PROFILE_DIR/browser-source.json` (on Windows `%USERPROFILE%\.dsh\profiles\<profile>\browser-source.json`). It is a plain file rather than Loader configuration because reinstalling or managing plugins rewrites the Loader's document while this file survives. Delete it to return to the default (Edge).

You can also override the row in the profile's `cordis.patch.yml` — a **non-default value wins over the file**, while defaults (`edge` / `''` / `''` / `false`) let the stored choice apply:

```yaml
- id: browser-source
  name: "@local/dsh-browser-mode/browser-source"
  config:
    source: builtin        # edge | builtin | endpoint
    endpoint: ""           # required when source=endpoint
    executablePath: ""     # optional override for source=edge
    headless: false
```

For a remote browser, start it with a debugging port first, for example:

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222 --user-data-dir="$env:TEMP\edge-cdp"
```

## How it works

### Why the bundle mounts the provider

All three attempts to keep the provider inside the preset failed:

| Approach | Result |
| --- | --- |
| provider row inside the preset | load error `Preset services require isolate realms: browserUse` |
| inside `isolate: { browserUse: true }` | preset loads, but the provider never receives `agent/created`, so Sessions get no `browser_*` tools |
| a second provider inside the preset | name clash with the profile one; calls fail with `playwright-mcp: browser tool belongs to another Session` |

The provider therefore has to live at the profile layer. This bundle mounts it from the `browser-source` row so the launch arguments belong to the plugin: switching the source disposes the old fiber and mounts a new one without restarting DSH. The cost is that the provider registers browser tools for **every** Session, which is what the gate is for.

### Why the gate refuses instead of hiding

`@deepseek-ai/dsh-tools`' `tools.restrict()` filters only what a scope **inherits** (global and ancestor layers):

> Restrictions filter what a scope inherits … never what its OWN layer registers.

The provider registers its tools into the Agent's **own** layer through `createScope(ctx, agent)`, so no `restrict()` can filter them (measured: an ordinary Session still lists 24 `mcp__playwright-mcp__*` tools).

The only usable lever is `tools.guard()`: it runs synchronously in the call pipeline, a returned string refuses the call, and no listener can turn a refusal back into an allow.

Decision order:

```
browser tool call
  ├─ name does not start with mcp__playwright-mcp__ → pass
  ├─ it is browser_access                          → pass
  ├─ the Agent's preset is browser                  → pass
  ├─ the Agent was approved by the user             → pass
  └─ anything else                                  → return the refusal text
```

### How consent is recorded

`browser_access` calls `ctx.userQuestions.ask({ questions, agent, signal })`. When the user chooses Allow, the Agent id goes into an in-memory `Set`. Nothing is persisted; it does not survive a new Session or a restart.

## Configuration

### Source (`browser-source`, inside the bundle)

| Field | Default | Meaning |
| --- | --- | --- |
| `source` | `edge` | `edge` / `builtin` / `endpoint` |
| `endpoint` | empty | CDP target when `source: endpoint` |
| `executablePath` | empty | custom browser path; empty means the default Edge install location |
| `headless` | `false` | `true` hides the window; keep it visible while debugging |

### Gate

Constants at the top of `browser-gate.js`:

```js
const TOOL_PREFIX = 'mcp__playwright-mcp__'  // the provider's tool prefix
const BROWSER_PRESET = 'browser'             // the preset id that may use the browser directly
const ACCESS_TOOL = 'browser_access'         // the consent tool name
const DENIED = '……'                          // the refusal text shown to the model
```

If you change the preset `id` in `preset-browser`, change `BROWSER_PRESET` too, otherwise the gate never recognises the mode.

## Checks

1. In an ordinary Session ask it to open a URL: expect the refusal text and no browser window.
2. In the same Session say "I allow you to use the browser": the Allow / Do not allow prompt appears; after Allow the URL opens in a visible window.
3. Create a Browser mode Session: it opens URLs without asking.
4. Ask for one real interaction (click a button, read a title) and confirm the tool actually ran on the page.
5. Say "use the built-in browser" or call `browser_source({ source: "builtin" })`: the next page should open in Playwright's Chromium.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| No "Browser mode" in the preset list | the bundle or its preset row is not active | check `include:preset-browser` in `list_plugins` |
| `Preset services require isolate realms: browserUse` | a provider row was put inside the preset | keep the provider at the profile layer; `browser-source` mounts it |
| No `browser_*` tools at all | `browser-source` is not active, or the old `browser-use-playwright-mcp` row still exists | check `include:browser-source`; delete the old provider row and reload |
| `browser tool belongs to another Session` | two Playwright providers in one process | keep only `browser-source` |
| The source switch does not show up | the Session still holds the previous MCP connection | call a browser tool again in that Session |
| An ordinary Session opens a browser | the gate is not active | check `include:browser-gate`; reload after code changes |
| The Allow button does nothing, or `human interaction is unavailable` | called from a child Agent | consent works only in the main Session |
| `content.some is not a function` | an old `browser_access` returned the wrong shape from `output.render` | upgrade to ≥ 1.5.1 |

## Compatibility

- Verified on DSH `0.2.1-rc.2`, Windows 11, Edge.
- Depends on `@deepseek-ai/dsh-experimental-browser-use-playwright-mcp` and `@deepseek-ai/schemastery`, declared in `package.json`; adjust them together with DSH upgrades.
- The gate uses public interfaces only: `tools.guard()`, `tools.register()`, `agentPresets.composedPreset()`, `sessionProjections.stateOf()`, `userQuestions.ask()`. If one is renamed, `browser-gate` drops out of `active` and the browser becomes available to every Session (the gate fails open but does not break Sessions); re-run the checks after upgrading.
- Source switching uses `settings.update()` on volatile fields plus the `loader/volatile-update` event. If DSH drops the volatile channel, switching degrades to an error that points at the YAML override; the browser itself keeps working.

## Known limitations

- Ordinary Sessions still **see** the `mcp__playwright-mcp__*` names; only calling them is refused.
- Browser state (pages, login) lives inside one Session only.
- Consent is in memory and dies with a restart.
- A preset cannot be changed after the first turn, so ad-hoc browser use goes through `browser_access` rather than switching modes.
- Child Agents cannot show the consent prompt; approval happens in the main Session.
- Switching the source remounts the provider; open pages are not preserved.

## Files

| File | Purpose |
| --- | --- |
| `browser-gate.js` | the gate: `tools.guard` refusal plus the `browser_access` consent tool |
| `browser-source.js` | the source plugin: mounts the Playwright MCP provider for Edge / bundled Chromium / CDP and registers `browser_source` |
| `cordis.patch.yml` | the `preset-browser` preset, the `browser-source` row, and the `browser-gate` row |
| `package.json` | bundle manifest (`dsh.bundle.patch`), exports, dependencies |
| `README.md`, `README.en.md` | Chinese and English docs |
| `CHANGELOG.md` | version history |

## Development

Install from a local directory (a junction to the source tree, so a reload picks up edits):

```
plugin_manager install_bundle target:<absolute path to this repo>
plugin_manager set_bundle enabled:false target:@local/dsh-browser-mode
plugin_manager set_bundle enabled:true  target:@local/dsh-browser-mode
```

Release a new version:

```powershell
git add .
git commit -m "feat: …"
git tag v1.6.0
git push && git push --tags
```

## License

[MIT](LICENSE)
