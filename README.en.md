# dsh-browser-mode

[中文](README.md) | English

[![Release](https://img.shields.io/github/v/release/Shad0wwa1ker/dsh-browser-mode?color=4c8bf5)](https://github.com/Shad0wwa1ker/dsh-browser-mode/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-2ea44f)](LICENSE)

A DeepSeek Harness (DSH) bundle that adds a **Browser mode** Session preset and keeps every other Session from opening a browser until the user explicitly agrees.

Verified on DSH `0.2.1-rc.2` (Windows 11 + Edge).

## Features

- Visible browser: `headless: false` by default, so you can watch it work and take over at any time.
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

This records the dependency `"@local/dsh-browser-mode": "github:Shad0wwa1ker/dsh-browser-mode"` in the profile and enables the bundle's two rows: the `preset-browser` preset and the `browser-gate` plugin. The browser dependencies (`dsh-browser-use`, the Playwright MCP provider) are pinned to `0.2.1-rc.2` in this package's `dependencies` and install with it, so no separate `pnpm add` is needed.

### One-time setup: the provider rows

Both providers must sit in the **profile** layer. Add them to `$DSH_PROFILE_DIR/cordis.patch.yml` (skip if already present):

```yaml
- insert:
    - id: browser-use
      name: "@deepseek-ai/dsh-browser-use"
    - id: browser-use-playwright-mcp
      name: "@deepseek-ai/dsh-experimental-browser-use-playwright-mcp"
      config:
        mode: launch
        headless: false
```

**Why the bundle cannot do this itself**: a row inserted by a bundle is registered for real in the profile composition, so a second `browserUse` service is a duplicate-registration error at load time. DSH's bundle syntax has no "insert only if absent" form, so this stays a documented step rather than part of `cordis.patch.yml`.

### Check the result

```
plugin_manager list_plugins
```

Both `include:preset-browser` and `include:browser-gate` should read `enabled: true` and `fiberPhase: "active"`. After editing `browser-gate.js`, toggle the bundle off and on so the new code is loaded.

## Usage

**Browser mode Session** — for a full web task: choose 「浏览器操作」 when creating the Session. Inside it the model calls `browser_navigate` and friends directly.

**Consent from any Session** — say "open this page and fill it in for me". The first browser call is refused, the model calls `browser_access`, and you get:

```
Allow browser use
May I open the browser in this Session? Purpose: …
[Allow]  [Deny]
```

After **Allow**, later browser calls in that Session pass. After **Deny**, the model continues with `web_search`, `web_fetch`, files and shell.

## How it works

### Why the provider must live in the profile

All three attempts to mount it inside a preset fail:

| Attempt | Result |
| --- | --- |
| Provider rows inside the preset | load error `Preset services require isolate realms: browserUse` |
| Same rows inside `isolate: { browserUse: true }` | preset loads, but the provider never receives `agent/created`, so no `browser_*` tools reach the Session |
| A second provider mounted by the preset | name collision with the profile one: `playwright-mcp: browser tool belongs to another Session` |

The cost of keeping it in the profile: the provider registers browser tools for **every** Session. That is what the gate is for.

### Why the gate denies instead of hiding

`tools.restrict()` in `@deepseek-ai/dsh-tools` only filters what a scope **inherits** (the global layer and ancestor layers):

> Restrictions filter what a scope inherits … never what its OWN layer registers.

The provider registers its tools through `createScope(ctx, agent)` — the Agent's **own** layer — so no restriction can hide them (measured: a plain Session still lists all 24 `mcp__playwright-mcp__*` names).

The supported lever is `tools.guard()`: it runs synchronously for every call, returns a string to deny, and no listener can turn that denial back into a call.

Decision order:

```
browser tool call
  ├─ name does not start with mcp__playwright-mcp__ → ignore
  ├─ name is browser_access                        → ignore
  ├─ agent preset is browser                       → allow
  ├─ agent was approved by the user                → allow
  └─ otherwise                                     → deny with an explanation
```

### How consent is remembered

`browser_access` calls `ctx.userQuestions.ask({ questions, agent, signal })` and, on Allow, stores the Agent id in an in-memory `Set`. Nothing is persisted and nothing crosses Sessions.

## Configuration

### Provider (profile layer)

| Field | Default | Notes |
| --- | --- | --- |
| `mode` | `launch` | One isolated browser per Session; `attach` connects to an existing browser and is exclusive |
| `headless` | `false` | `true` hides the window; keep `false` while debugging |
| `executablePath` | empty | Path to Edge, Chrome or Chromium; empty lets Playwright choose |
| `endpoint` | empty | Target address for `mode: attach` |
| `toolCallTimeoutMs` | empty | Per-call timeout for browser tools |

### Gate

Constants at the top of `browser-gate.js`:

```js
const TOOL_PREFIX = 'mcp__playwright-mcp__'  // provider tool prefix
const BROWSER_PRESET = 'browser'             // preset allowed to drive the browser
const ACCESS_TOOL = 'browser_access'         // consent tool name
const DENIED = '……'                          // text shown to the model on denial
```

If you change the preset `id`, change `BROWSER_PRESET` too, otherwise the gate never recognises the mode.

## Verification checklist

1. In a plain Session, ask it to open a URL: expect the denial text and no browser window.
2. In the same Session, say "you may use the browser": the Allow / Deny prompt appears; after Allow, opening a URL should show a visible window.
3. Create a Browser mode Session: it opens a URL directly, no prompt.
4. Ask for one real interaction (click a button, read a heading) to confirm the tools execute on the page.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| The Browser mode preset is missing | the profile provider rows are not enabled | add them as described above, then restart |
| `Preset services require isolate realms: browserUse` | provider rows were placed in the preset | keep them in the profile |
| No `browser_*` tools at all | provider not loaded, or DSH not restarted | check `include:browser-use` and `include:browser-use-playwright-mcp` |
| `browser tool belongs to another Session` | two Playwright providers in one process | keep only the profile one |
| A plain Session can open the browser | the gate is inactive | check `include:browser-gate`; reload after editing |
| Allow does nothing, or `human interaction is unavailable` | called from a subagent | consent only works in the main Session |
| `content.some is not a function` | older `browser_access` render contract | upgrade to ≥ 1.5.1 |

## Compatibility

- Verified on DSH `0.2.1-rc.2`, Windows 11, Edge.
- Depends on `@deepseek-ai/dsh-browser-use` and `@deepseek-ai/dsh-experimental-browser-use-playwright-mcp`, pinned in `package.json`; keep them aligned when DSH is upgraded.
- The gate uses public API only: `tools.guard()`, `tools.register()`, `agentPresets.composedPreset()`, `sessionProjections.stateOf()`, `userQuestions.ask()`. If any of them changes, `browser-gate` drops out of `active`: the browser becomes usable everywhere (the gate fails open) but Sessions keep working. Re-run the checklist after upgrading.

## Known limitations

- A plain Session still **sees** the `mcp__playwright-mcp__*` tool names; it just cannot run them.
- Browser state (pages, logins) stays inside one Session.
- Consent is in-memory only; a restart forgets it.
- A Session cannot switch presets mid-conversation, so temporary use goes through `browser_access`.
- A subagent cannot ask questions, so consent can only be granted in the main Session.

## Files

| File | Purpose |
| --- | --- |
| `browser-gate.js` | gate: `tools.guard` denial plus the `browser_access` consent tool |
| `cordis.patch.yml` | the `preset-browser` preset and the `browser-gate` row |
| `package.json` | bundle declaration (`dsh.bundle.patch`), exports, pinned dependencies |
| `README.md`, `README.en.md` | Chinese and English docs |
| `CHANGELOG.md` | version history |

## Development

Install from a local directory (junction-linked to the source, so a reload picks up edits):

```
plugin_manager install_bundle target:<absolute path to this repo>
plugin_manager set_bundle enabled:false target:@local/dsh-browser-mode
plugin_manager set_bundle enabled:true  target:@local/dsh-browser-mode
```

Publishing a version:

```powershell
git add .
git commit -m "feat: …"
git tag v1.5.2
git push && git push --tags
```

## License

[MIT](LICENSE)
