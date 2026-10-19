# Changelog

All notable changes to this bundle. Versions follow [SemVer](https://semver.org/).

## Unreleased

- Docs: rewrite both READMEs — one-paste install, one-time provider setup with
  the reason it cannot be bundled, shorter prose, consistent structure.
- Verified installing the published repo straight from the plugin manager:
  `plugin_manager install_bundle target:github:Shad0wwa1ker/dsh-browser-mode`
  resolves `1.5.1` and enables `preset-browser` and `browser-gate`.

## 1.5.1 — 2026-10-19

- Fix `browser_access` failing with `content.some is not a function`: a tool's
  `output.render` must return content blocks (`[{ type: 'text', text }]`), not a
  bare string.
- Key approvals by Agent id instead of object identity, so a re-wrapped Agent
  keeps its consent.

## 1.5.0 — 2026-10-19

- Add the `browser_access` tool: a non-browser Session can now ask the user for
  browser permission with an Allow / Deny prompt instead of being told to open a
  new Session.
- Denial text and README updated accordingly; the preset keeps the shortened
  "authorization and safety" section (irreversible actions need consent, no
  passwords in chat or files).

## 1.4.1 — 2026-10-19

- Rework the denial text: try non-browser tools first, then offer the browser.
- Drop the "do not bypass captchas / risk controls / terms of service" bullet
  from the preset persona.

## 1.4.0 — 2026-10-19

- Remove the tool-hiding attempt. `tools.restrict()` cannot hide tools an Agent
  registers in its own scope, which is exactly what the Playwright MCP provider
  does; only `tools.guard()` can enforce the gate. Documented the dead ends.
- Gate now reports the preset id and the reason in the denial text.

## 1.3.0 — 2026-10-19

- First version with the profile-scope `browser-gate` plugin and the
  `preset-browser` preset in one bundle.

## Earlier

Development iterations before publication: a preset-only provider
(`Preset services require isolate realms: browserUse`), an isolated provider
(preset loads, no tools reach the Session), and a duplicate provider
(`browser tool belongs to another Session`). Those attempts are why the provider
now lives in the profile composition only.
