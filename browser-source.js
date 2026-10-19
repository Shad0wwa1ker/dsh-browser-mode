// browser-source: mount the Playwright MCP provider from this bundle and let
// the user pick where the visible browser comes from.
//
// Three sources:
//   edge      launch Microsoft Edge (the default and the historic behaviour)
//   builtin   launch the Chromium that Playwright already downloaded
//             (no --executable-path, so the provider falls back to it)
//   endpoint  attach to an already running browser over CDP
//
// The choice is stored in `$DSH_PROFILE_DIR/browser-source.json`, because the
// Loader's config document is rewritten by plugin reinstall and management while
// this file survives. A non-default value in the row config (edited by hand) still
// wins, and the row fields stay volatile so `loader/volatile-update` remounts the
// provider without a process restart. The provider cannot change its launch
// arguments in place, so this plugin disposes and remounts its provider fiber on
// every change.
//
// A profile that still carries the standalone `browser-use-playwright-mcp` row
// from plugin versions <= 1.5.1 already has a provider. Mounting a second one
// would throw `browser use provider "playwright-mcp" is already registered`, so
// this plugin then logs a migration hint and leaves that row in charge.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import * as providerModule from '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp'

export const name = 'browser-source'

export const inject = ['browserUse', 'tools']

const ACCESS_TOOL = 'browser_source'
const DEFAULT_ENDPOINT = ''
const DEFAULTS = { source: 'edge', endpoint: DEFAULT_ENDPOINT, executablePath: '', headless: false }
const SOURCES = new Set(['edge', 'builtin', 'endpoint'])

const EDGE_PATHS = {
  win32: [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
  darwin: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  linux: ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'],
}

export const Config = Schema.object({
  source: Schema.union([Schema.const('edge'), Schema.const('builtin'), Schema.const('endpoint')]).default('edge').volatile(),
  endpoint: Schema.string().default(DEFAULT_ENDPOINT).volatile(),
  executablePath: Schema.string().default('').volatile(),
  headless: Schema.boolean().default(false).volatile(),
})

const providerPlugin = {
  name: providerModule.name,
  inject: providerModule.inject,
  Config: providerModule.Config,
  apply: providerModule.apply,
}

function edgePath() {
  for (const candidate of EDGE_PATHS[process.platform] ?? []) {
    if (existsSync(candidate)) return candidate
  }
  return ''
}

function resolveSource(config) {
  const source = config.source?.get?.() ?? config.source ?? 'edge'
  const endpoint = (config.endpoint?.get?.() ?? config.endpoint ?? '').trim()
  const executablePath = (config.executablePath?.get?.() ?? config.executablePath ?? '').trim()
  const headless = config.headless?.get?.() ?? config.headless ?? false
  return { source, endpoint, executablePath, headless }
}

/**
 * Where the last explicit choice is kept. The Loader's own config document can be
 * rewritten (or replaced wholesale) by plugin reinstall and management, so the
 * plugin treats this small JSON file as the source of truth and the row config as
 * the fallback/default.
 */
function statePath() {
  const dir = process.env.DSH_PROFILE_DIR
    ?? join(homedir(), '.dsh', 'profiles', process.env.DSH_PROFILE ?? 'desktop')
  return join(dir, 'browser-source.json')
}

function readState() {
  try {
    const value = JSON.parse(readFileSync(statePath(), 'utf8'))
    if (value === null || typeof value !== 'object') return { values: {}, config: null }
    if (value.config !== null && typeof value.config === 'object') {
      return { values: value, config: value.config }
    }
    // A file written before the snapshot existed carried only the values.
    return { values: value, config: null }
  } catch {
    return { values: {}, config: null }
  }
}

function writeState(values, config) {
  const file = statePath()
  const temporary = `${file}.tmp`
  const payload = { ...values, config: resolveSource(config) }
  writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  renameSync(temporary, file)
}

/**
 * The row config is the snapshot the file was written against. When it still
 * matches, the stored choice wins; when the user edited it by hand, the edited
 * keys win — and are recorded as the new snapshot by the next write.
 */
function effective(config) {
  const fromConfig = resolveSource(config)
  const { values: saved, config: snapshot } = readState()
  const result = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS)) {
    const configured = fromConfig[key]
    const edited = snapshot !== null && JSON.stringify(configured) !== JSON.stringify(snapshot[key])
    const candidate = edited ? configured : saved[key] ?? configured
    const valid = key === 'source'
      ? SOURCES.has(candidate)
      : key === 'headless'
        ? typeof candidate === 'boolean'
        : typeof candidate === 'string'
    result[key] = valid ? candidate : DEFAULTS[key]
  }
  return result
}

/** Provider configuration for the selected source. */
function providerConfig({ source, endpoint, executablePath, headless }) {
  if (source === 'endpoint') {
    if (!endpoint) throw new Error('source=endpoint 需要填写 CDP 地址（例如 http://127.0.0.1:9222）')
    return { mode: 'attach', endpoint }
  }
  if (headless) return { mode: 'launch', headless: true }
  const explicit = source === 'builtin' ? '' : executablePath || edgePath()
  return explicit
    ? { mode: 'launch', headless: false, executablePath: explicit }
    : { mode: 'launch', headless: false }
}

/** One-line human description of the effective source. */
function describeSource(config) {
  return describeResolved(effective(config))
}

/** Same description, from already-resolved plain values. */
function describeResolved({ source, endpoint, executablePath }) {
  if (source === 'endpoint') return `远程浏览器（CDP：${endpoint || '未填写'}）`
  if (source === 'builtin') return 'Playwright 内置 Chromium'
  const edge = executablePath || edgePath()
  return edge ? `Microsoft Edge（${edge}）` : 'Microsoft Edge（未找到安装路径，改用 Playwright 内置 Chromium）'
}

export function apply(ctx, config) {
  let fiber
  let queue = Promise.resolve()

  /** Dispose the previous provider fiber, then mount one for the current source. */
  const remount = () => {
    queue = queue.then(async () => {
      const previous = fiber
      fiber = undefined
      if (previous !== undefined) {
        try {
          await previous.dispose()
        } catch (error) {
          console.error('[browser-source]', `disposing the previous provider failed: ${String(error?.message ?? error)}`)
        }
      }
      if (ctx.get('browserUse')?.registration !== undefined) {
        console.warn('[browser-source]',
          'another browser provider is already registered — the profile still has browser-use-playwright-mcp; '
          + 'delete that row (keep browser-use) so this plugin can manage the browser source',
        )
        return
      }
      let options
      const values = effective(config)
      try {
        options = providerConfig(values)
      } catch (error) {
        console.error('[browser-source]', String(error?.message ?? error))
        return
      }
      fiber = ctx.plugin(providerPlugin, options)
      console.log('[browser-source]', `browser source: ${describeResolved(values)}`)
    })
    return queue
  }

  ctx.effect(() => {
    void remount()
    const onChange = () => {
      void remount()
    }
    ctx.on('loader/volatile-update', onChange)
    return () => {
      ctx.off('loader/volatile-update', onChange)
      const previous = fiber
      fiber = undefined
      void previous?.dispose()
    }
  })

  ctx.tools.register({
    name: ACCESS_TOOL,
    description: [
      '查看或切换浏览器来源：edge（默认，Microsoft Edge）、builtin（Playwright 内置 Chromium）、endpoint（连接已运行的浏览器，需给 CDP 地址）。',
      '不带参数时只返回当前配置；带参数时保存配置并立刻重挂浏览器，已经打开的会话需要重新调用浏览器工具。',
      '用户说“用内置浏览器”“换成 Edge”“连接我开着的浏览器”时调用本工具。',
    ].join('\n'),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        source: { type: 'string', enum: ['edge', 'builtin', 'endpoint'], description: '浏览器来源' },
        endpoint: { type: 'string', description: 'source=endpoint 时必填，例如 http://127.0.0.1:9222' },
        executablePath: { type: 'string', description: '自定义浏览器可执行文件路径（source=edge 时可选）' },
        headless: { type: 'boolean', description: '无头运行，默认 false（可见窗口）' },
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const current = effective(config)
      const changed = ['source', 'endpoint', 'executablePath', 'headless'].filter((key) => args?.[key] !== undefined)
      if (changed.length === 0) {
        return [
          `当前来源：${describeSource(config)}`,
          `source=${current.source}`,
          `endpoint=${current.endpoint || '（未填写）'}`,
          `executablePath=${current.executablePath || '（跟随来源）'}`,
          `headless=${String(current.headless)}`,
          '切换示例：browser_source({ source: "builtin" })、browser_source({ source: "endpoint", endpoint: "http://127.0.0.1:9222" })。',
        ].join('\n')
      }
      const next = { ...current }
      for (const key of changed) next[key] = args[key]
      if (next.source === 'endpoint' && !next.endpoint.trim()) {
        return '没有改成远程浏览器：source=endpoint 需要 CDP 地址，请让用户提供（例如 Edge 用 --remote-debugging-port=9222 启动后的 http://127.0.0.1:9222）。'
      }
      if (!SOURCES.has(next.source)) {
        return `没有保存：source 只能是 ${[...SOURCES].join(' / ')}。`
      }
      try {
        writeState(next, config)
      } catch (error) {
        return `保存失败：${String(error?.message ?? error)}（配置文件：${statePath()}）`
      }
      await remount()
      return `已切换浏览器来源为 ${describeResolved(next)}（配置：${JSON.stringify(next)}）。已打开的会话需要重新调用浏览器工具生效。`
    },
  })
}
