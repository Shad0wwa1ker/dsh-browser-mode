# dsh-browser-mode

中文 | [English](README.en.md)

给 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）加一个**「浏览器操作」模式**，并且管住其它会话：浏览器不是想开就开，要先得到你同意。

它由两块组成，装在一个 bundle 里：

| 组成 | 作用 |
| --- | --- |
| `browser` 预设（界面上叫「浏览器操作」） | 一套专门操作浏览器的 persona + 工具集，在**真实可见**的浏览器窗口里干活 |
| `browser-gate` 门禁插件 | 其它会话调用 `mcp__playwright-mcp__*` 时先拦下；模型可以调用 `browser_access` 弹一个「允许 / 不允许」，你点了允许，这个会话才能用浏览器 |

> 为什么需要门禁：Playwright MCP provider 只能挂在 profile 层（原因见[为什么长这样](#为什么长这样)），代价是它会给**每个**会话注册浏览器工具。没有门禁，任何对话都可能自己打开浏览器。

## 特性

- **可见的浏览器**：默认 `headless: false` + `mode: launch`，你能看着它操作，也能自己接管（比如输入密码）。
- **两种进入方式**：想认真做网页任务就新建「浏览器操作」会话；临时需要就在普通会话里让模型申请，点「允许」即可。
- **按会话授权**：授权只对当时那个会话、那个 agent 生效，存在插件进程内存里；重启 DSH 或重开会话要重新同意。
- **拒绝可解释**：被拦下时模型拿到的是中文说明（可以先不用浏览器、该怎么申请），而不是一句 `permission denied`。
- **失败即关闭**：读不到预设 id、问答服务不可用、provider 没挂上——一律当「不是浏览器模式」处理，宁可不开。

## 安装

### 1. 前置：profile 里必须有浏览器 provider

`browser-use` 与 Playwright MCP provider 必须在 **profile 层**开启。编辑 `$DSH_PROFILE_DIR/cordis.patch.yml`（Windows 一般是 `C:\Users\<你>\.dsh\profiles\desktop\cordis.patch.yml`），加入：

```yaml
- insert:
    - id: browser-use
      name: "@deepseek-ai/dsh-browser-use"
    - id: browser-use-playwright-mcp
      name: "@deepseek-ai/dsh-experimental-browser-use-playwright-mcp"
      config:
        mode: launch
        headless: false
        # 可选：指定浏览器。不写则由 Playwright 自己找。
        # executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
```

两个包的版本要和你的 DSH 对齐（本仓库在 `0.2.1-rc.2` 上验证）。装到 profile 的依赖里：

```powershell
# 在 profile 目录执行
pnpm add @deepseek-ai/dsh-browser-use@0.2.1-rc.2 @deepseek-ai/dsh-experimental-browser-use-playwright-mcp@0.2.1-rc.2
```

### 2. 安装 bundle

从 GitHub 装（推荐，和 `@local/dsh-balance-pill` 一样走 pnpm 的 git 依赖）：

```powershell
# 在 profile 目录执行（pnpm 需要能找到 git）
pnpm add "github:Shad0wwa1ker/dsh-browser-mode"
```

仓库里的 `name` 就是 `@local/dsh-browser-mode`，装好后依赖会显示为
`"@local/dsh-browser-mode": "github:Shad0wwa1ker/dsh-browser-mode"`。

然后把它加进 profile 的 bundle 列表，即 `package.json` 的 `dsh.profile.bundles`：

```json
"@local/dsh-browser-mode"
```

或者从本地目录装（开发时用，bundle 会以 junction 链接到源码目录，改完重载即可）：

```
plugin_manager install_bundle target:@local/dsh-browser-mode spec:<本仓库绝对路径>
```

### 3. 重载并确认

```
plugin_manager set_bundle enabled:false target:@local/dsh-browser-mode
plugin_manager set_bundle enabled:true  target:@local/dsh-browser-mode
plugin_manager list_plugins
```

`list_plugins` 里应看到两行都是 `enabled:true` / `fiberPhase:"active"`：

- `include:preset-browser`（预设）
- `include:browser-gate`（门禁）

改完 `browser-gate.js` 也必须这样关一次再开，插件才会用新代码。

## 使用

**方式一：浏览器模式会话**（推荐做整段网页任务）

新建会话时把模式选成「浏览器操作」。这个会话里模型直接用 `browser_navigate` 等工具，不需要询问。

**方式二：普通会话里临时申请**

直接说「用浏览器打开某个页面，帮我填一下」。模型会先被门禁拦下，然后调用 `browser_access`，界面上出现：

```
允许使用浏览器
是否允许我在这个会话里打开浏览器？用途：……
[允许]  [不允许]
```

点「允许」之后，这个会话后续的浏览器调用直接放行；点「不允许」，模型会继续用 `web_search` / `web_fetch` / 文件 / 命令行把能做的部分做完。

## 为什么长这样

### 为什么 provider 必须在 profile 层

实测三条「把浏览器塞进预设」的路都不通：

| 尝试 | 结果 |
| --- | --- |
| provider 直接放进预设 | 加载失败：`Preset services require isolate realms: browserUse` |
| 放进 `isolate: { browserUse: true }` 组 | 预设能加载，但 provider 收不到 `agent/created`，会话里没有任何 `browser_*` 工具 |
| 预设里再挂一个 provider | 与 profile 那个重名，调工具时报 `playwright-mcp: browser tool belongs to another Session` |

所以 provider 只能挂 profile 层。它会给每个会话注册工具，门禁负责把「能不能用」收回来。

### 为什么门禁是「拒绝」而不是「隐藏」

`@deepseek-ai/dsh-tools` 的 `tools.restrict()` 只过滤一个作用域**继承来的**工具（全局层 + 祖先层），并且明确拒绝作用域自己注册的名字：

> Restrictions filter what a scope inherits … never what its OWN layer registers.

而 provider 是用 `createScope(ctx, agent)` 把工具注册进**该 agent 自己的**作用域，所以任何 `restrict()` 都藏不掉它们（实测：普通会话里依然能看到 24 个 `mcp__playwright-mcp__*` 工具）。

唯一受支持的杠杆是 `tools.guard()`：它在调用管线里逐次同步执行，返回字符串即拒绝，且没有监听器能把拒绝改回放行。

因此门禁的行为是：

```
浏览器工具调用
  ├─ 名字不是 mcp__playwright-mcp__*  → 不管
  ├─ 是 browser_access              → 不管
  ├─ agent 的预设是 browser         → 放行
  ├─ agent 已被用户授权              → 放行
  └─ 其它                            → 返回中文拒绝语
```

### 授权是怎么记的

`browser_access` 通过 `ctx.userQuestions.ask()` 弹题；拿到「允许」后把该 agent 的 id 记进插件内存里的 `Set`。没有落盘，所以：

- 重启 DSH、重开会话、换 agent 都要重新同意；
- 不会出现「上次同意过，这次悄悄开」的情况。

## 配置

### provider（profile 层）

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `mode` | `launch` | `launch` 每个会话起一个独立浏览器；`attach` 连接已有浏览器（此时 provider 独占，多个会话不能共用） |
| `headless` | `false` | 关掉就看不见窗口；调试时建议保持 `false` |
| `executablePath` | 空 | 指定 Edge / Chrome / Chromium 可执行文件；不写由 Playwright 自己找 |
| `endpoint` | 空 | `mode: attach` 时要连的地址 |
| `toolCallTimeoutMs` | 空 | 单次浏览器工具调用的超时 |

### 预设

`cordis.patch.yml` 里 `preset-browser` 的 `id`（`browser`）、`name`、`order`、`description` 都可以改。**改 `id` 的话，`browser-gate.js` 里的 `BROWSER_PRESET` 必须一起改**，否则门禁永远不认这个模式。

### 门禁

`browser-gate.js` 顶部三个常量：

```js
const TOOL_PREFIX = 'mcp__playwright-mcp__'  // provider 的工具前缀
const BROWSER_PRESET = 'browser'             // 直接用浏览器的预设 id
const ACCESS_TOOL = 'browser_access'         // 申请同意用的工具名
const DENIED = '……'                          // 拒绝时给模型看的话
```

## 验证清单

1. **普通会话**里让它打开某个网址 → 要么说做不到，要么调用后收到拒绝语，**不会**弹 Edge 窗口。
2. 在同一个普通会话说「我同意你用浏览器」→ 模型调用 `browser_access`，界面弹出「允许 / 不允许」→ 点「允许」→ 再让它打开网址，此时应弹出浏览器窗口。
3. **新建「浏览器操作」会话** → 直接打开网址，弹出可见窗口，无需询问。
4. 让它做一步真实操作（点按钮、读标题），确认工具真的在执行。

## 故障排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 预设列表里没有「浏览器操作」/ 加载报 `Preset services require isolate realms: browserUse` | 预设里又挂了 provider | 把 provider 行留在 profile 层，预设里不要放 |
| 会话里完全没有 `browser_*` 工具 | profile 的两行没开，或没重启 | 检查 `list_plugins` 里 `browser-use`、`browser-use-playwright-mcp` 是否 active |
| 调工具报 `playwright-mcp: browser tool belongs to another Session` | 同一进程里挂了两个 Playwright provider（常见于 profile 和预设各一个） | 只保留 profile 那一个 |
| 普通会话能直接开浏览器 | 门禁没生效 | `list_plugins` 看 `include:browser-gate` 是否 active；改完代码要关一次再开 |
| 点「允许」没反应 / 提示 `human interaction is unavailable` | 在子 agent（subagent）里调用 | 只能在主会话里授权 |
| 调 `browser_access` 报 `content.some is not a function` | 工具没提供正确的 `output.render`（返回字符串而不是内容块数组） | 升级到 ≥1.5.1 |
| 弹不出确认框（问答服务不可用） | 没有 Web 客户端接通，或问答插件没挂 | 用「浏览器操作」会话，或直接在对话里说清楚要不要用 |

## 兼容性

- 在 **DSH `0.2.1-rc.2`** 上验证（Windows 11 + Edge）。
- 依赖 `@deepseek-ai/dsh-browser-use`、`@deepseek-ai/dsh-experimental-browser-use-playwright-mcp`，版本与本包 `package.json` 中的 pin 对齐；DSH 升级后同步改。
- 门禁只用稳定公开 API：`ctx.tools.guard()`、`ctx.tools.register()`、`agentPresets.composedPreset()`、`sessionProjections.stateOf()`、`userQuestions.ask()`。将来这些接口变了，`include:browser-gate` 会掉出 `active`，普通会话会退化成可以直接用浏览器（门禁失效），但不会把会话弄坏——升级后请重跑上面的验证清单。

## 已知限制

- 普通会话里仍然**看得见** `mcp__playwright-mcp__*` 工具（原因见上），只是调不动。
- 浏览器状态（页面、登录态）只在会话内保留，跨会话不保留；需要登录的任务请在同一会话里完成。
- 授权只记在内存，重启即失效。
- 会话不能中途切换预设（这个版本的预设只能在首轮之前选择），所以临时用浏览器靠 `browser_access`，不是靠切模式。
- 子 agent 不能弹问答，授权只能在主会话里给。

## 文件

| 文件 | 作用 |
| --- | --- |
| `browser-gate.js` | 门禁插件：`tools.guard` 拦截 + `browser_access` 征求同意 |
| `cordis.patch.yml` | 预设 `preset-browser` 与门禁行 `browser-gate` |
| `package.json` | bundle 声明（`dsh.bundle.patch`）、`exports`、依赖 pin |
| `README.md` / `README.en.md` | 中文 / 英文说明 |
| `CHANGELOG.md` | 版本记录 |

## 开发

```powershell
# 在 profile 目录用链接方式装一次，之后改代码只需重载 bundle
plugin_manager install_bundle target:@local/dsh-browser-mode spec:<本仓库路径>
plugin_manager set_bundle enabled:false target:@local/dsh-browser-mode
plugin_manager set_bundle enabled:true  target:@local/dsh-browser-mode
```

发布：

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
