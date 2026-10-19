# dsh-browser-mode

[中文](README.md) | English

[![Release](https://img.shields.io/github/v/release/Shad0wwa1ker/dsh-browser-mode?color=4c8bf5)](https://github.com/Shad0wwa1ker/dsh-browser-mode/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-2ea44f)](LICENSE)
[![DSH](https://img.shields.io/badge/DeepSeek%20Harness-0.2.1--rc.2-6f42c1)](https://github.com/deepseek-ai)

A [DeepSeek Harness](https://github.com/deepseek-ai) (DSH) bundle that adds a **Browser mode** and keeps the browser on a leash everywhere else: no Session opens a browser until you say so.

Two parts, shipped together:

| Part | What it does |
| --- | --- |
| `browser` Agent preset (labelled 「浏览器操作」 in the UI) | A persona and toolset for driving a **visible** browser window |
| `browser-gate` plugin | Denies `mcp__playwright-mcp__*` calls in every other Session; the model can call `browser_access`, which asks you Allow / Deny, and only then can that Session use the browser |

> Why a gate at all: the Playwright MCP provider can only live in the profile composition (see [Architecture](#architecture)), which means it registers browser tools for **every** Session. Without a gate, any conversation can open a browser on its own.

## Features

- **Visible browser** — `headless: false` and `mode: launch` by default, so you can watch it work and take over when needed (typing a password, for example).
- **Two ways in** — open a 「浏览器操作」 Session for a real web task, or ask in any Session and click **Allow**.
- **Per-Session consent** — an approval applies only to that Session's agent and lives in plugin memory; restarting DSH or starting a new Session asks again.
- **Explainable refusal** — a blocked call returns a real explanation (try other tools first, and how to ask for permission), not a bare `permission denied`.
- **Fail closed** — an unresolvable preset id, a missing question service, or a missing provider all count as "not browser mode": the browser stays shut.

## Install

### 1. Prerequisite: the browser provider in the profile

`browser-use` and the Playwright MCP provider must be enabled at the **profile** layer. Edit `$DSH_PROFILE_DIR/cordis.patch.yml` (on Windows usually `C:\Users\<you>\.dsh\profiles\desktop\cordis.patch.yml`):

```yaml
- insert:
    - id: browser-use
      name: "@deepseek-ai/dsh-browser-use"
    - id: browser-use-playwright-mcp
      name: "@deepseek-ai/dsh-experimental-browser-use-playwright-mcp"
      config:
        mode: launch
        headless: false
        # Optional: point at a specific browser. Omit to let Playwright pick.
        # executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
```

Keep the two package versions aligned with your DSH build (verified on `0.2.1-rc.2`), installed in the profile:

```powershell
# run in the profile directory
pnpm add @deepseek-ai/dsh-browser-use@0.2.1-rc.2 @deepseek-ai/dsh-experimental-browser-use-playwright-mcp@0.2.1-rc.2
```

### 2. Install the bundle

From GitHub (same pattern as `@local/dsh-balance-pill`, a pnpm git dependency):

```powershell
# run in the profile directory (pnpm must be able to find git)
pnpm add "github:Shad0wwa1ker/dsh-browser-mode"
```

The repo's `name` is `@local/dsh-browser-mode`, so the dependency lands as
`"@local/dsh-browser-mode": "github:Shad0wwa1ker/dsh-browser-mode"`.

Then add it to the profile's bundle list, `dsh.profile.bundles` in `package.json`:

```json
"@local/dsh-browser-mode"
```

Or install from a local directory (for development — the bundle is junction-linked to the source tree, so a reload picks up edits):

```
plugin_manager install_bundle target:@local/dsh-browser-mode spec:<absolute path to this repo>
```

### 3. Reload and check

```
plugin_manager set_bundle enabled:false target:@local/dsh-browser-mode
plugin_manager set_bundle enabled:true  target:@local/dsh-browser-mode
plugin_manager list_plugins
```

Both rows should show `enabled:true` / `fiberPhase:"active"`:

- `include:preset-browser` (the preset)
- `include:browser-gate` (the gate)

Editing `browser-gate.js` requires the same disable/enable cycle before the new code is used.

## Usage

**Option 1 — Browser Session** (best for a full web task)

Pick 「浏览器操作」 as the preset when creating a Session. The model calls `browser_navigate` and friends directly, no questions asked.

**Option 2 — ask from any Session**

Say "open this page in the browser and fill it in for me". The gate blocks the call, the model calls `browser_access`, and a prompt appears:

```
Allow browser use
May I open the browser in this Session? Purpose: …
[Allow]  [Deny]
```

After **Allow**, later browser calls in that Session pass; after **Deny**, the model continues with `web_search` / `web_fetch` / files / shell.

## Architecture

### Why the provider must live in the profile

All three attempts to mount the provider inside a preset fail in this build:

| Attempt | Result |
| --- | --- |
| Provider rows inside the preset | load error: `Preset services require isolate realms: browserUse` |
| Same rows inside an `isolate: { browserUse: true }` group | preset loads, but the provider never receives `agent/created`, so the Session gets no `browser_*` tools |
| A second provider mounted by the preset | name collision with the profile one: `playwright-mcp: browser tool belongs to another Session` |

So the provider stays in the profile composition. It registers tools for every Session; the gate takes the "may I use it" decision back.

### Why the gate denies instead of hiding

`tools.restrict()` in `@deepseek-ai/dsh-tools` only filters what a scope **inherits** (the global layer and ancestor layers) and explicitly rejects names registered by the scope itself:

> Restrictions filter what a scope inherits … never what its OWN layer registers.

The provider registers its tools through `createScope(ctx, agent)` — the Agent's **own** layer — so no restriction can hide them (measured: a plain Session still lists all 24 `mcp__playwright-mcp__*` tools).

The only supported lever is `tools.guard()`: it runs synchronously for every call, returning a string denies it, and no listener can turn that denial back into a call.

So the decision table is:

```
browser tool call
  ├─ name is not mcp__playwright-mcp__*  → ignore
  ├─ name is browser_access             → ignore
  ├─ agent preset is browser            → allow
  ├─ agent was approved by the user     → allow
  └─ otherwise                          → deny with an explanation
```

### How consent is remembered

`browser_access` calls `ctx.userQuestions.ask()` and, on Allow, records the agent id in an in-memory `Set`. Nothing is persisted, so:

- restarting DSH, reopening a Session, or switching agents asks again;
- there is no "I said yes once, so it may open silently forever".

## Configuration

### Provider (profile layer)

| Field | Default | Notes |
| --- | --- | --- |
| `mode` | `launch` | `launch` starts an isolated browser per Session; `attach` connects to an existing one (exclusive — Sessions cannot share it) |
| `headless` | `false` | Set `true` to hide the window; keep `false` while debugging |
| `executablePath` | empty | Path to Edge / Chrome / Chromium; empty lets Playwright choose |
| `endpoint` | empty | Address to attach to when `mode: attach` |
| `toolCallTimeoutMs` | empty | Per-call timeout for browser tools |

### Preset

`id` (`browser`), `name`, `order` and `description` of `preset-browser` in `cordis.patch.yml` are yours to change. **If you change `id`, change `BROWSER_PRESET` in `browser-gate.js` too**, otherwise the gate never recognises the mode.

### Gate

The constants at the top of `browser-gate.js`:

```js
const TOOL_PREFIX = 'mcp__playwright-mcp__'  // provider tool prefix
const BROWSER_PRESET = 'browser'             // preset allowed to drive the browser
const ACCESS_TOOL = 'browser_access'         // consent tool name
const DENIED = '……'                          // text shown to the model on denial
```

## Verification checklist

1. In a **plain Session**, ask it to open a URL → it either declines or gets the denial text, and **no browser window appears**.
2. In the same plain Session, say "you may use the browser" → the model calls `browser_access`, the Allow / Deny prompt appears → **Allow** → ask again to open a URL, and the browser window opens.
3. Create a **「浏览器操作」 Session** → it opens a URL directly, visible window, no prompt.
4. Ask for one real interaction (click a button, read a heading) to confirm the tools actually run.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Preset missing, or load error `Preset services require isolate realms: browserUse` | provider rows were put inside the preset | keep the provider rows in the profile |
| No `browser_*` tools at all in a Session | profile rows disabled, or DSH not restarted | check `browser-use` / `browser-use-playwright-mcp` in `list_plugins` |
| `playwright-mcp: browser tool belongs to another Session` | two Playwright providers in one process | keep only the profile one |
| A plain Session can open the browser | gate not active | check `include:browser-gate` in `list_plugins`; reload the bundle after edits |
| Allow does nothing / `human interaction is unavailable` | called from a subagent | consent only works in the main Session |
| `browser_access` fails with `content.some is not a function` | wrong `output.render` contract (string instead of content blocks) | upgrade to ≥ 1.5.1 |
| No prompt appears (question service unavailable) | no Web client attached, or the question plugin is missing | use a Browser Session, or agree in plain text |

## Compatibility

- Verified on **DSH `0.2.1-rc.2`** (Windows 11 + Edge).
- Depends on `@deepseek-ai/dsh-browser-use` and `@deepseek-ai/dsh-experimental-browser-use-playwright-mcp`, pinned in `package.json` to match that build; bump them together with DSH.
- The gate uses stable public APIs only: `ctx.tools.guard()`, `ctx.tools.register()`, `agentPresets.composedPreset()`, `sessionProjections.stateOf()`, `userQuestions.ask()`. If any of them changes, `include:browser-gate` drops out of `active`, the browser becomes directly usable again (the gate fails open), and Sessions still work — rerun the checklist above after upgrading.

## Known limitations

- A plain Session still **sees** the `mcp__playwright-mcp__*` tool names (see above); it just cannot run them.
- Browser state (pages, logins) lives only inside a Session; it does not survive Session switches.
- Consent is in-memory only; a restart forgets it.
- A Session cannot switch presets mid-conversation in this build, which is why temporary browser use goes through `browser_access` instead of a mode switch.
- A subagent cannot ask questions, so consent can only be granted in the main Session.

## Files

| File | Purpose |
| --- | --- |
| `browser-gate.js` | the gate: `tools.guard` denial plus the `browser_access` consent tool |
| `cordis.patch.yml` | the `preset-browser` preset and the `browser-gate` row |
| `package.json` | bundle declaration (`dsh.bundle.patch`), exports, dependency pins |
| `README.md` / `README.en.md` | Chinese / English docs |
| `CHANGELOG.md` | version history |

## Development

```powershell
# link the working tree once, then a bundle reload picks up edits
plugin_manager install_bundle target:@local/dsh-browser-mode spec:<path to this repo>
plugin_manager set_bundle enabled:false target:@local/dsh-browser-mode
plugin_manager set_bundle enabled:true  target:@local/dsh-browser-mode
```

Publishing:

```powershell
git init
git add .
git commit -m "feat: browser mode preset plus consent gate"
git branch -M main
git remote add origin https://github.com/Shad0wwa1ker/dsh-browser-mode.git
git push -u origin main
```

## License

[MIT](LICENSE)
