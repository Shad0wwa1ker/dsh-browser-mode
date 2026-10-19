# dsh-browser-mode

中文 | [English](README.en.md)

[![Release](https://img.shields.io/github/v/release/Shad0wwa1ker/dsh-browser-mode?color=4c8bf5)](https://github.com/Shad0wwa1ker/dsh-browser-mode/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-2ea44f)](LICENSE)

DeepSeek Harness（DSH）插件包：新增一个「浏览器操作」会话模式，并让其它会话在用户明确同意前无法打开浏览器。

在 DSH `0.2.1-rc.2`（Windows 11 + Edge）上实测通过。

## 特性

- 可见浏览器：默认 `headless: false`，能看着它操作，也能随时接管。
- 两种入口：新建「浏览器操作」会话，或就在当前会话里让模型申请授权。
- 按会话授权：授权只对当时那个 Agent 生效，存在插件内存里，重启或重开会话需重新同意。
- 拒绝可解释：被拦下时模型拿到的是中文说明和后续做法，而不是一句 `permission denied`。
- 失败即关闭：读不到预设、问答服务不可用、provider 未加载时，一律按「不可用浏览器」处理。

## 安装

### 一键安装

DSH 插件管理器的安装框接受 git 地址。把下面这一行粘贴到「包名或地址」：

```
github:Shad0wwa1ker/dsh-browser-mode
```

等价的工具调用：

```
plugin_manager install_bundle target:github:Shad0wwa1ker/dsh-browser-mode
```

安装会写入 profile 依赖 `"@local/dsh-browser-mode": "github:Shad0wwa1ker/dsh-browser-mode"`，并自动启用包内两行：预设 `preset-browser` 与门禁 `browser-gate`。浏览器依赖（`dsh-browser-use`、Playwright MCP provider）已在本包的 `dependencies` 中锁定为 `0.2.1-rc.2`，随包一起安装，不需要再手动 `pnpm add`。

### 首次使用前的一次性配置：provider

两个 provider 必须挂在 **profile 层**。在 `$DSH_PROFILE_DIR/cordis.patch.yml` 中加入（若已存在则跳过）：

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

**为什么这一步不能由插件包代劳**：插件包在 profile 组合里插入的行会真实再注册一次 `browserUse` 服务。如果用户已经有一份，就会在加载时报重复注册；DSH 的 bundle 语法没有「不存在才插入」的条件写法。因此它只作为文档步骤保留，不放进 `cordis.patch.yml`。

### 确认安装结果

```
plugin_manager list_plugins
```

`include:preset-browser` 与 `include:browser-gate` 两行都应是 `enabled: true`、`fiberPhase: "active"`。改过 `browser-gate.js` 后需要 `set_bundle` 关一次再开，新代码才会生效。

## 使用

**方式一：浏览器模式会话**（整段网页任务）

新建会话时把模式选为「浏览器操作」。该会话内模型直接调用 `browser_navigate` 等工具，不再询问。

**方式二：当前会话里申请**

直接说「用浏览器打开这个页面并填好」。模型第一次调用浏览器工具时会被拦下，随后调用 `browser_access`，界面弹出：

```
允许使用浏览器
是否允许我在这个会话里打开浏览器？用途：……
[允许]  [不允许]
```

点「允许」后，该会话后续的浏览器调用全部放行；点「不允许」，模型改用 `web_search`、`web_fetch`、文件与命令行继续。

## 原理

### 为什么 provider 必须在 profile 层

把 provider 塞进预设的三条路都试过，全部失败：

| 做法 | 结果 |
| --- | --- |
| provider 行放进预设 | 加载报错 `Preset services require isolate realms: browserUse` |
| 放进 `isolate: { browserUse: true }` 组 | 预设能加载，但 provider 收不到 `agent/created`，会话里没有 `browser_*` 工具 |
| 预设里再挂一个 provider | 与 profile 的那个重名，调用时报 `playwright-mcp: browser tool belongs to another Session` |

代价是：provider 在 profile 层会给**每个**会话注册浏览器工具。所以需要门禁。

### 为什么门禁只能拒绝、不能隐藏

`@deepseek-ai/dsh-tools` 的 `tools.restrict()` 只过滤一个作用域**继承来**的工具（全局层与祖先层）：

> Restrictions filter what a scope inherits … never what its OWN layer registers.

而 provider 用 `createScope(ctx, agent)` 把工具注册进该 Agent **自己的**层，任何 `restrict()` 都过滤不到（实测：普通会话仍能看到 24 个 `mcp__playwright-mcp__*` 工具名）。

唯一有效的杠杆是 `tools.guard()`：它在调用管线里同步执行，返回字符串即拒绝，且没有监听器能把拒绝改回放行。

决策顺序：

```
浏览器工具调用
  ├─ 名字不以 mcp__playwright-mcp__ 开头 → 不处理
  ├─ 是 browser_access                → 不处理
  ├─ Agent 的预设是 browser            → 放行
  ├─ Agent 已被用户授权                → 放行
  └─ 其它                             → 返回中文拒绝语
```

### 授权如何记录

`browser_access` 调用 `ctx.userQuestions.ask({ questions, agent, signal })`；用户选「允许」后，把该 Agent 的 id 记进插件内存的 `Set`。不落盘，不跨会话，不跨重启。

## 配置

### provider（profile 层）

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `mode` | `launch` | 每个会话起一个独立浏览器；`attach` 连接已有浏览器，此时独占，多会话不能共用 |
| `headless` | `false` | 改为 `true` 则隐藏窗口，调试时建议保持可见 |
| `executablePath` | 空 | 指定 Edge、Chrome 或 Chromium；留空由 Playwright 选择 |
| `endpoint` | 空 | `mode: attach` 时连接的目标地址 |
| `toolCallTimeoutMs` | 空 | 单次浏览器工具调用的超时 |

### 门禁

`browser-gate.js` 顶部常量：

```js
const TOOL_PREFIX = 'mcp__playwright-mcp__'  // provider 的工具前缀
const BROWSER_PRESET = 'browser'             // 直接用浏览器的预设 id
const ACCESS_TOOL = 'browser_access'         // 申请授权用的工具名
const DENIED = '……'                          // 拒绝时给模型看的文字
```

改 `preset-browser` 的 `id` 时，`BROWSER_PRESET` 必须一起改，否则门禁永远不认这个模式。

## 验证清单

1. 普通会话里让它打开某个网址：应收到拒绝语，且不弹浏览器窗口。
2. 同一会话里说「我同意你用浏览器」：出现「允许 / 不允许」，点「允许」后再次打开网址，应弹出可见窗口。
3. 新建「浏览器操作」会话：直接打开网址，不询问。
4. 让它做一步真实操作（点按钮、读标题），确认工具确实在页面上执行。

## 故障排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 预设列表里没有「浏览器操作」 | profile 两行 provider 未启用 | 按[一次性配置](#首次使用前的一次性配置provider)添加后重启 |
| 加载报 `Preset services require isolate realms: browserUse` | provider 行被放进了预设 | 把 provider 行留在 profile |
| 会话里完全没有 `browser_*` 工具 | provider 未加载，或未重启 | 看 `list_plugins` 里 `include:browser-use`、`include:browser-use-playwright-mcp` |
| 报 `browser tool belongs to another Session` | 一个进程里有两个 Playwright provider | 只保留 profile 那一个 |
| 普通会话能直接开浏览器 | 门禁未生效 | 看 `include:browser-gate` 是否 active；改过代码需重载 |
| 点「允许」没反应，或报 `human interaction is unavailable` | 在子 Agent 里调用 | 授权只能在主会话完成 |
| 报 `content.some is not a function` | 旧版 `browser_access` 的 `output.render` 返回值不合规 | 升级到 ≥ 1.5.1 |

## 兼容性

- 验证环境：DSH `0.2.1-rc.2`、Windows 11、Edge。
- 依赖 `@deepseek-ai/dsh-browser-use` 与 `@deepseek-ai/dsh-experimental-browser-use-playwright-mcp`，版本在 `package.json` 中锁定；DSH 升级后同步调整。
- 门禁只使用公开接口：`tools.guard()`、`tools.register()`、`agentPresets.composedPreset()`、`sessionProjections.stateOf()`、`userQuestions.ask()`。其中任何一个改名，`browser-gate` 会掉出 `active`，此时浏览器恢复为所有会话可用（门禁失效但不会破坏会话），升级后请重跑验证清单。

## 已知限制

- 普通会话里仍能**看到** `mcp__playwright-mcp__*` 工具名，只是调用会被拒绝。
- 浏览器状态（页面、登录态）只在单个会话内保留。
- 授权只存内存，重启即失效。
- 会话开始后不能切换预设，因此临时用浏览器走 `browser_access`，而不是切模式。
- 子 Agent 不能弹出问答，授权只能在主会话完成。

## 文件

| 文件 | 作用 |
| --- | --- |
| `browser-gate.js` | 门禁插件：`tools.guard` 拒绝 + `browser_access` 征求同意 |
| `cordis.patch.yml` | 预设 `preset-browser` 与门禁行 `browser-gate` |
| `package.json` | bundle 声明（`dsh.bundle.patch`）、导出、依赖锁定 |
| `README.md`、`README.en.md` | 中文、英文说明 |
| `CHANGELOG.md` | 版本记录 |

## 开发

本地目录安装（以 junction 链接到源码，改完重载即可）：

```
plugin_manager install_bundle target:<本仓库绝对路径>
plugin_manager set_bundle enabled:false target:@local/dsh-browser-mode
plugin_manager set_bundle enabled:true  target:@local/dsh-browser-mode
```

发布新版本：

```powershell
git add .
git commit -m "feat: …"
git tag v1.5.2
git push && git push --tags
```

## License

[MIT](LICENSE)
