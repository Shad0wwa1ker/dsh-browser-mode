/**
 * Host half of the browser-mode client carrier.
 *
 * This module intentionally does nothing on the Host. Its only job is to be the
 * loader row that imports the bare package specifier `@local/dsh-browser-mode`:
 * `dsh-client-modules` composes a package's client bundle from a row whose
 * `options.name` is the exact package name (`exactPackageSpecifier`), while
 * subpath rows such as `@local/dsh-browser-mode/browser-gate` are ignored by
 * that scan. Without this row the client half (`client.js`, the settings page)
 * is never added to the boot graph.
 *
 * The real Host plugins live in `browser-gate.js` and `browser-source.js`.
 */

export const name = 'browser-mode-client';

/** No Host-side behaviour; the client bundle registers itself. */
export function apply() {}
