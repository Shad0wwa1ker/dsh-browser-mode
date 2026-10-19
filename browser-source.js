// browser-source: mount the Playwright MCP provider from this bundle and let
// the user pick where the visible browser comes from.
//
// Three sources:
//   edge      launch Microsoft Edge (the default and the historic behaviour)
//   builtin   launch the Chromium that Playwright already downloaded
//             (no --executable-path, so the provider falls back to it)
//   endpoint  attach to an already running browser over CDP
//
// The fields are declared volatile, so a value written through
// `settings.update()` lands in the profile's cordis.patch.yml and reaches this
// plugin through `loader/volatile-update` without a process restart. The
// provider itself cannot change its launch arguments in place, so this plugin
// disposes and remounts its provider fiber on every change.
//
// A profile that still carries the standalone `browser-use-playwright-mcp` row
// from plugin versions <= 1.5.1 already has a provider. Mounting a second one
// would throw `browser use provider "playwright-mcp" is already registered`, so
// this plugin then logs a migration hint and leaves that row in charge.

import { existsSync } from 'node:fs'
import Schema from '@deepseek-ai/schemastery'
import * as providerModule from '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp'

export const name = 'browser-source'

export const inject = ['browserUse', 'tools']

const ACCESS_TOOL = 'browser_source'
const DEFAULT_ENDPOINT = ''

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

/** Provider configuration for the selected source. */
function providerConfig(config) {
  const { source, endpoint, executablePath, headless } = resolveSource(config)
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
  return describeResolved(resolveSource(config))
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
      try {
        options = providerConfig(config)
      } catch (error) {
        console.error('[browser-source]', String(error?.message ?? error))
        return
      }
      fiber = ctx.plugin(providerPlugin, options)
      console.log('[browser-source]', `browser source: ${describeSource(config)}`)
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
      const current = resolveSource(config)
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
      if (args.source === 'endpoint' && !(args.endpoint ?? current.endpoint).trim()) {
        return '没有改成远程浏览器：source=endpoint 需要 CDP 地址，请让用户提供（例如 Edge 用 --remote-debugging-port=9222 启动后的 http://127.0.0.1:9222）。'
      }
      const settings = ctx.get('settings')
      if (settings === undefined) {
        return '无法保存：当前组合没有 settings 服务。请在 profile 的 cordis.patch.yml 里手动修改 browser-source 行的 config（source / endpoint / executablePath / headless），然后重载插件。'
      }
      const entryId = ctx.fiber.entry?.options.id ?? 'browser-source'
      // The Loader can expose the row either as the declared id or as the
      // composed entry id (`include:<id>`), so accept any of those spellings.
      const form = settings
        .describe()
        .find((row) => row.ns === entryId || row.ns === `include:${entryId}` || row.ns.endsWith(`:${entryId}`))
      if (form === undefined) {
        return `无法保存：插件行 ${entryId} 没有可写配置（可能被更高优先级的配置覆盖）。请手动改 profile 的 cordis.patch.yml。`
      }
      const patch = {}
      for (const key of changed) patch[key] = args[key]
      try {
        await settings.update(form.ns, patch, form.revision)
      } catch (error) {
        return `保存失败：${String(error?.message ?? error)}`
      }
      const next = { ...current, ...patch }
      return `已切换浏览器来源为 ${describeResolved(next)}（配置：${JSON.stringify(next)}）。已打开的会话需要重新调用浏览器工具生效。`
    },
  })
}
