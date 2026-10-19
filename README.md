# dsh-browser-mode

中文 | [English](README.en.md)

[![Release](https://img.shields.io/github/v/release/Shad0wwa1ker/dsh-browser-mode?color=4c8bf5)](https://github.com/Shad0wwa1ker/dsh-browser-mode/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-2ea44f)](LICENSE)

DeepSeek Harness（DSH）插件包：新增一个「浏览器操作」会话模式，浏览器来源可在运行时切换（默认 Edge），其它会话在用户明确同意前无法打开浏览器。

在 DSH `0.2.1-rc.2`（Windows 11 + Edge）上实测通过。

## 特性

- 可见浏览器：默认 `headless: false`，能看着它操作，也能随时接管。
- 浏览器来源可选：Edge（默认）、Playwright 内置 Chromium、或连接一个已经开着的浏览器（CDP）。
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

安装会写入 profile 依赖 `"@local/dsh-browser-mode": "github:Shad0wwa1ker/dsh-browser-mode"`，并自动启用包内三行：预设 `preset-browser`、来源 `browser-source`、门禁 `browser-gate`。

### 首次使用前的一次性配置

在 `$DSH_PROFILE_DIR/cordis.patch.yml` 里保留共享的 `browserUse` 注册表行（若已存在则跳过）：

```yaml
- insert:
    - id: browser-use
      name: "@deepseek-ai/dsh-browser-use"
```

Playwright MCP provider 由本插件的 `browser-source` 行负责挂载，**不需要**单独的 provider 行。这样浏览器来源才能在运行时切换。

> [!IMPORTANT]
> 从 1.5.1 或更早版本升级：请删掉 `browser-use-playwright-mcp` 那一行（`browser-use` 保留）。一个进程里只能有一个 provider；旧行还在时 `browser-source` 只打印一条迁移提示，不会接管。

### 更新到新版本

插件市场对 `github:owner/repo` 这种浮动源会读取仓库默认分支的 `package.json` 版本号做比较，所以每次发版只要改版本号并 push：

```powershell
git tag v1.6.0
git push && git push --tags
```

已安装的用户在插件市场点「更新」，或手工执行下面两条（`pnpm` 会把 GitHub 依赖重新解析到默认分支最新提交）：

```powershell
pnpm add "github:Shad0wwa1ker/dsh-browser-mode"
```

```
plugin_manager set_bundle enabled:false target:@local/dsh-browser-mode
plugin_manager set_bundle enabled:true  target:@local/dsh-browser-mode
```

### 确认安装结果

```
plugin_manager list_plugins
```

`include:preset-browser`、`include:browser-source`、`include:browser-gate` 三行都应是 `enabled: true`、`fiberPhase: "active"`。

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

## 浏览器来源

默认用 Microsoft Edge。三种来源：

| `source` | 行为 |
| --- | --- |
| `edge` | 启动本机 Edge（找不到时退回 Playwright 内置 Chromium） |
| `builtin` | 启动 Playwright 自带的 Chromium（`~/AppData/Local/ms-playwright/chromium-*`） |
| `endpoint` | 连接一个已经启动、开了调试端口的浏览器（`--cdp-endpoint`），此时独占，多会话不能共用 |

### 让模型切换

在任意会话里说「换成内置浏览器」「连接我开着的浏览器」，模型会调用 `browser_source`：

```
browser_source({ source: "builtin" })
browser_source({ source: "endpoint", endpoint: "http://127.0.0.1:9222" })
```

不带参数时只回显当前配置。切换会立刻重挂 provider，已经打开的浏览器会话需要重新调用浏览器工具。

### 手工改配置

`browser-source` 的字段都是 volatile，写进 profile 就会在下次加载时生效，也可以直接在 `cordis.patch.yml` 覆盖：

```yaml
- id: browser-source
  name: "@local/dsh-browser-mode/browser-source"
  config:
    source: builtin        # edge | builtin | endpoint
    endpoint: ""           # source=endpoint 时必填
    executablePath: ""     # source=edge 时可自定义路径
    headless: false
```

接远程浏览器时，先让浏览器以调试端口启动，例如：

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222 --user-data-dir="$env:TEMP\edge-cdp"
```

## 原理

### 为什么 provider 由本插件挂载

把 provider 塞进预设的三条路都试过，全部失败：

| 做法 | 结果 |
| --- | --- |
| provider 行放进预设 | 加载报错 `Preset services require isolate realms: browserUse` |
| 放进 `isolate: { browserUse: true }` 组 | 预设能加载，但 provider 收不到 `agent/created`，会话里没有 `browser_*` 工具 |
| 预设里再挂一个 provider | 与 profile 的那个重名，调用时报 `playwright-mcp: browser tool belongs to another Session` |

所以 provider 只能挂在 profile 层。本插件用 `browser-source` 这一行代挂，好处是：provider 的启动参数由插件自己算，改来源时销毁旧 fiber 再挂新的，不用重启 DSH。代价是 provider 会给**每个**会话注册浏览器工具，所以需要门禁。

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

### 来源（`browser-source`，bundle 内）

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `source` | `edge` | `edge` / `builtin` / `endpoint` |
| `endpoint` | 空 | `source: endpoint` 时连接的目标地址 |
| `executablePath` | 空 | 自定义浏览器路径；空则用 Edge 默认安装位置 |
| `headless` | `false` | 改为 `true` 则隐藏窗口，调试时建议保持可见 |

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
5. 说「换成内置浏览器」或调用 `browser_source({ source: "builtin" })`：下一次打开页面应换成 Playwright 自带 Chromium。

## 故障排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 预设列表里没有「浏览器操作」 | bundle 未启用或预设行失败 | 看 `list_plugins` 里 `include:preset-browser` 是否 active |
| 加载报 `Preset services require isolate realms: browserUse` | provider 行被放进了预设 | 把 provider 留在 profile 层，由 `browser-source` 挂载 |
| 会话里完全没有 `browser_*` 工具 | `browser-source` 未 active，或旧 `browser-use-playwright-mcp` 行还在 | 看 `include:browser-source`；删掉旧 provider 行后重载 |
| 报 `browser tool belongs to another Session` | 一个进程里有两个 Playwright provider | 只保留 `browser-source` 这一个 |
| 切换来源后浏览器没变 | 旧会话持有旧的 MCP 连接 | 在会话里重新调用一次浏览器工具 |
| 普通会话能直接开浏览器 | 门禁未生效 | 看 `include:browser-gate` 是否 active；改过代码需重载 |
| 点「允许」没反应，或报 `human interaction is unavailable` | 在子 Agent 里调用 | 授权只能在主会话完成 |
| 报 `content.some is not a function` | 旧版 `browser_access` 的 `output.render` 返回值不合规 | 升级到 ≥ 1.5.1 |

## 兼容性

- 验证环境：DSH `0.2.1-rc.2`、Windows 11、Edge。
- 依赖 `@deepseek-ai/dsh-experimental-browser-use-playwright-mcp` 与 `@deepseek-ai/schemastery`，版本在 `package.json` 中声明；DSH 升级后同步调整。
- 门禁只使用公开接口：`tools.guard()`、`tools.register()`、`agentPresets.composedPreset()`、`sessionProjections.stateOf()`、`userQuestions.ask()`。其中任何一个改名，`browser-gate` 会掉出 `active`，此时浏览器恢复为所有会话可用（门禁失效但不会破坏会话），升级后请重跑验证清单。
- 来源切换使用 `settings.update()` 写 volatile 字段 + `loader/volatile-update` 事件；DSH 去掉 volatile 通道时，切换会退化为报错并提示手工改 YAML（浏览器本身不受影响）。

## 已知限制

- 普通会话里仍能**看到** `mcp__playwright-mcp__*` 工具名，只是调用会被拒绝。
- 浏览器状态（页面、登录态）只在单个会话内保留。
- 授权只存内存，重启即失效。
- 会话开始后不能切换预设，因此临时用浏览器走 `browser_access`，而不是切模式。
- 子 Agent 不能弹出问答，授权只能在主会话完成。
- 切换来源会重挂 provider，已打开的页面不会保留。

## 文件

| 文件 | 作用 |
| --- | --- |
| `browser-gate.js` | 门禁插件：`tools.guard` 拒绝 + `browser_access` 征求同意 |
| `browser-source.js` | 来源插件：挂载 Playwright MCP provider，支持 Edge / 内置 Chromium / CDP，并提供 `browser_source` 工具 |
| `cordis.patch.yml` | 预设 `preset-browser`、来源行 `browser-source`、门禁行 `browser-gate` |
| `package.json` | bundle 声明（`dsh.bundle.patch`）、导出、依赖 |
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
git tag v1.6.0
git push && git push --tags
```

## License

[MIT](LICENSE)
