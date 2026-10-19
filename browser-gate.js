/**
 * Browser gate: browser tools run only in the `browser` Agent preset, or in
 * another preset after the user explicitly agrees in that Session.
 *
 * The Playwright MCP provider lives in the profile composition (a preset-scoped
 * provider cannot attach to Sessions in this build, and mounting a second one in
 * a preset collides on the `mcp__playwright-mcp__*` names). Living at profile
 * scope means the provider registers its tools for EVERY Agent, so this plugin
 * narrows usage back down with two pieces:
 *
 * 1. a global `tools.guard` that denies every browser tool call unless the
 *    Agent's preset is `browser` or that Agent has been unlocked, and
 * 2. a `browser_access` tool registered for each non-browser Agent: it asks the
 *    user "may I open the browser?" through `ctx.userQuestions`, and on a
 *    positive answer unlocks the browser tools for that Agent for the life of
 *    the Session.
 *
 * Why not hide the tools instead: the provider registers them through a scope
 * created for that Agent, which makes them the Agent's OWN registrations.
 * `tools.restrict()` only filters what a scope INHERITS (global and ancestor
 * layers) and explicitly rejects scope-local names, so no restriction can hide
 * them. The guard is therefore the only supported lever, and it is monotonic:
 * no other listener can turn a denial back into a call.
 *
 * The gate matches the configured tool prefix only, so no other tool is
 * affected, and a preset that cannot be resolved counts as "not the browser
 * mode" — the browser stays closed until the user says otherwise.
 *
 * @module @local/dsh-browser-mode/browser-gate
 */

/** Cordis plugin name. */
export const name = 'browser-gate'

/** The tool registry is the only hard dependency; the rest are lazy lookups. */
export const inject = ['tools']

/** Every Playwright MCP tool is registered under this prefix. */
const TOOL_PREFIX = 'mcp__playwright-mcp__'

/** The preset that is allowed to drive the browser without asking. */
const BROWSER_PRESET = 'browser'

/** The tool a non-browser Agent calls to ask the user for permission. */
const ACCESS_TOOL = 'browser_access'

const DENIED =
  '浏览器工具只在用户同意后才可用，当前会话还没有得到同意，所以没有打开浏览器。' +
  '尽量先不用浏览器完成任务：用 web_search / web_fetch 查资料，用文件、命令行等现有工具把能做的部分做完；' +
  '如果确实必须操作网页（登录、点击、填表、下载），调用 browser_access 让用户选择是否同意，' +
  '用户同意后这个会话就能直接使用浏览器工具。不要编造页面内容或操作结果。'

const ACCESS_DESCRIPTION =
  '向用户申请在当前会话里使用浏览器。只有确实需要操作网页、而浏览器工具被拒绝时才调用；' +
  '它会把一个「允许 / 不允许」的选择题交给用户，用户选择「允许」之后本会话的浏览器工具即可使用。' +
  '不要代替用户回答，也不要在用户没有同意的情况下假装已经同意。'

const ACCESS_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reason: {
      type: 'string',
      description: '为什么需要打开浏览器，一句话说明要做什么（用户会看到这句话）',
    },
  },
}

const ALLOW = '允许'
const DENY = '不允许'

/**
 * Narrow the profile-level browser provider and offer a consent path.
 * @param ctx - the plugin context at profile scope.
 */
export function apply(ctx) {
  /**
   * Preset id of the Agent behind one call.
   *
   * The registry answers from the Agent's live composition; the session
   * projection is the durable fallback (it also covers a binding whose
   * generation was collected). Anything unresolved stays `undefined`.
   */
  const presetOf = (agent) => {
    if (agent === undefined || agent === null) return undefined
    try {
      const id = ctx.get('agentPresets')?.composedPreset?.(agent.ctx)
      if (id !== undefined) return id
    } catch {
      // Fall through to the durable projection.
    }
    try {
      return ctx.get('sessionProjections')?.stateOf?.(agent.session, 'agentPreset')
    } catch {
      return undefined
    }
  }

  /**
   * Agents the user has agreed to let drive the browser, keyed by Agent id so a
   * re-wrapped Agent object still matches; falls back to the object itself.
   */
  const unlocked = new Set()
  const keyOf = (agent) => (typeof agent?.id === 'string' ? agent.id : agent)

  const mayUseBrowser = (agent) => {
    if (presetOf(agent) === BROWSER_PRESET) return true
    return agent !== undefined && agent !== null && unlocked.has(keyOf(agent))
  }

  /**
   * Ask the user whether this Session may drive the browser.
   * @returns the model-facing answer text.
   */
  const askForAccess = async (argument, exec) => {
    const agent = exec.agent
    if (mayUseBrowser(agent)) {
      return '这个会话已经可以使用浏览器了，直接调用浏览器工具即可。'
    }
    const service = ctx.get('userQuestions')
    if (service === undefined || typeof service.ask !== 'function') {
      return '现在弹不出确认框（问答服务不可用）。请直接用文字询问用户是否允许使用浏览器，等用户回复后再继续。'
    }
    const reason = typeof argument?.reason === 'string' ? argument.reason.trim() : ''
    let answer
    try {
      answer = await service.ask({
        questions: [{
          id: 'browser-access',
          header: '允许使用浏览器',
          question: reason.length > 0
            ? `是否允许我在这个会话里打开浏览器？用途：${reason}`
            : '是否允许我在这个会话里打开浏览器？',
          options: [
            { label: ALLOW, description: '本会话内可以直接使用浏览器工具' },
            { label: DENY, description: '保持浏览器关闭，继续用其他方式完成任务' },
          ],
        }],
        ...agent === undefined ? {} : { agent },
        ...exec.signal === undefined ? {} : { signal: exec.signal },
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return `没有拿到用户的答复（${detail}）。请直接用文字询问用户是否允许使用浏览器。`
    }
    const labels = []
    for (const item of answer?.answers ?? []) {
      for (const selected of item?.selected ?? []) labels.push(String(selected))
      if (typeof item?.custom === 'string') labels.push(item.custom)
    }
    const text = labels.join(' ')
    const negative = /不允许|不同意|不要|不用|拒绝|不能|禁止|no\b|nope/i.test(text)
    const positive = /允许|同意|可以|行|好的|授权|yes|ok|sure/i.test(text)
    if (!negative && positive) {
      if (agent !== undefined && agent !== null) unlocked.add(keyOf(agent))
      return '用户已经同意使用浏览器。现在可以调用浏览器工具了；先用 browser_navigate 打开页面，再按 snapshot 里的 ref 操作。'
    }
    return '用户没有同意使用浏览器。不要打开浏览器；可以继续用 web_search / web_fetch、文件和命令行把能做的部分做完，需要时再向用户申请。'
  }

  /** Definition of the consent tool, registered once at profile scope. */
  const accessTool = {
    name: ACCESS_TOOL,
    description: ACCESS_DESCRIPTION,
    parameters: ACCESS_PARAMETERS,
    output: {
      schema: { type: 'string' },
      render(_args, value) {
        return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }]
      },
    },
    async execute(argument, exec) {
      return askForAccess(argument, exec)
    },
  }

  ctx.tools.guard((exec) => {
    if (typeof exec?.name !== 'string') return undefined
    if (exec.name === ACCESS_TOOL) return undefined
    if (!exec.name.startsWith(TOOL_PREFIX)) return undefined
    if (mayUseBrowser(exec.agent)) return undefined
    return DENIED
  })

  // One global registration: every Agent inherits it, so a Session that was
  // already running when the plugin loaded can ask too. Browser-mode Sessions
  // also see the name, but calling it there just reports that no permission is
  // needed — cheaper than tracking per-Agent registrations.
  ctx.tools.register(accessTool)
}
