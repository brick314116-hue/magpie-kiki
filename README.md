# Magpie × Kiki

让 Kiki 出现在 Magpie 的 **Agents** 页面：在 Magpie 里给 Kiki 选一个模型，Kiki 的新会话就用它。

**只需要装进 Magpie 一次。** Kiki 端插件是可选的兜底，不装也能用（见下面“为什么这次只装一边”）。

## 为什么这次只装一边

其他 harness 不用在它自己那边再装一个插件，原因是它们的配置刚好是 Magpie 能写的格式：

- 大多数 harness 的配置是 **JSON / YAML / env**，Magpie 的 agent 插件可以直接写；
- Codex 这类是 Magpie 的**内置 agent**，它的 TOML 由 Magpie 的 Go 代码直接写，不经过插件沙箱。

Kiki 不一样：供应商和模型在 **`~/.kiki/config.toml`（TOML）**，而 Magpie 的 agent 插件跑在 moejs 沙箱里，只支持 JSON / YAML / env，也没有文件系统。

但这个包还有另一半：`kiki.host.js`。`package.json` 里的 `main` 让 Magpie 的 **Bun 插件宿主**也加载这个包，宿主是常驻进程，有 `node:fs` 和定时器，可以直接写 Kiki 的 TOML。于是：

- **Magpie 端插件**：Agents 页面、模型选择、写 `~/.kiki/magpie.json`（JSON 交接文件）；
- **同一个包的 Bun 宿主部分**：每秒看一次交接文件，变化就写进 `config.toml` 和 `credentials.toml`；
- **Kiki 端插件（可选）**：在 Kiki 会话启动时做同一件事，共用同一份同步代码和同一把锁。

同步逻辑只有一份：`lib/bridge.mjs`。

## 安装

### 只装 Magpie 端（推荐）

从 npm 安装：

```sh
magpie plugin add magpie-agent-kiki
```

或先克隆本仓库，再装本地文件夹：

```sh
git clone https://github.com/brick314116-hue/magpie-kiki.git
magpie plugin add ./magpie-kiki
```

也可以在 Magpie 窗口的 **Plugins → Add a plugin** 里搜索 `kiki`（GitHub 上的 `magpie-plugin` 标签），或选择克隆下来的文件夹。

装好后 **Agents** 页会出现 **Kiki**，点它的模型选择器挑一个 Magpie 模型。选中后约 1 秒内写入 Kiki 的配置；然后**新开一个 Kiki 会话**即可。

> 让 Magpie 保持运行：自动同步发生在 Magpie 的 Bun 插件宿主里。Magpie 关着时，Kiki 仍用上次同步的配置。

### 可选：Kiki 端兜底

只有下面这些情况才需要：

- Magpie 没运行，而你想在终端里直接用 Kiki；
- 用 `magpie kiki <model>` 改完模型后，不等 Magpie 启动就马上开 Kiki；
- 这台机器的 Bun 不能用，Magpie 的插件宿主起不来。

在 Kiki 里：

```text
/plugins install --trust https://github.com/brick314116-hue/magpie-kiki
/plugins enable magpie-bridge
```

也可以安装本地克隆下来的同一个文件夹。GUI 里在安装预览中点 **允许并安装**，并选择**全局使用**（否则会话启动钩子不会跑）。

`--trust` / “允许并安装” 是 Kiki 对会运行代码的插件的知情同意。这个钩子只读写 `~/.kiki` 下的本机文件，没有网络请求，也不会常驻。

## 注意事项

- **Magpie 端是必需的，Kiki 端不是。** 只装 Magpie 就能用；不装 Kiki 侧插件时，Magpie 必须运行，自动同步才会发生。
- **同步有约 1 秒延迟。** 宿主每秒检查一次交接文件；选完模型后等 1 秒再开 Kiki 最稳。想彻底消除这个窗口，就装 Kiki 侧插件——它在会话启动前同步。
- **Magpie 关着时，CLI 改模型不会立即生效。** `magpie kiki <model>` 只写交接文件；等 Magpie 下次启动，宿主才会把它写进 `config.toml`。急着用就装 Kiki 侧插件，或先 `magpie plugin list`（它会启动一次宿主并完成同步）。
- **需要 Bun。** Magpie 的插件宿主是 Bun 1.4.x（Magpie 会自己下载）。Bun 不可用时宿主不启动，自动同步不会发生；此时 Kiki 侧插件是兜底。
- **只支持 `~/.kiki`。** 如果 Magpie 进程能读到 `KIKI_HOME`，脚本也认它；但没有为每个 Kiki 实例分别配置的界面。
- **只影响新会话。** Kiki 在会话创建/启动时确定模型；已经开着的会话不会中途换模型。
- **会修改两个文件。** `~/.kiki/config.toml` 和 `~/.kiki/credentials/credentials.toml` 里会出现带 `magpie-bridge` 标记的块；不要手改标记块，下一次同步会覆盖。取消选择会自动撤回。
- **密钥保存在本机。** `credentials.toml` 会保存 Magpie 网关的密钥（脚本会尽量设为仅当前用户可读；Windows 上 `chmod` 可能不起作用）。不要把这两个文件提交到 Git。
- **Kiki 侧钩子以你的用户权限运行 Node。** 它只读写上述本机文件，不联网、不常驻。Magpie 侧跑在 Magpie 自带的 Bun 宿主里，同样只读写这些本机文件。
- **默认思考档位是 `high`。** 模型有思考档位时，`default_effort` 会优先选 `high`，其次 `medium` / `low`，都没有时用列表里的最后一个档位。想临时换档位，在 Kiki 会话里选；想改默认值，需要改脚本后重新安装。
- **两边同时装也不会打架。** 两份代码共用 `~/.kiki/.magpie-bridge/sync.lock` 和同一套原子写入；同时触发时后到的会跳过。
- **npm 上已发布 `magpie-agent-kiki`。** Magpie 的 Discover 通过 GitHub 的 `magpie-plugin` 标签发现 agent 插件；npm 搜索只收 OpenCode / pi 插件，所以搜 npm 不一定能看到它。想进入 Magpie 的推荐列表，还需要向 `magpie-community/plugins` 的 `registry.json` 提交 `kind: "agent"` 条目（可选）。

## 它写了什么

`~/.kiki/config.toml` 末尾会多出一块带标记的内容，例如：

```toml
# >>> magpie-bridge >>>
# Written from ~/.kiki/magpie.json by the Magpie Bridge Kiki plugin.
# magpie owns these values; edits here last until the next session.
[providers."magpie-kiki"]
type = "openai"
base_url = "http://127.0.0.1:3425/v1"

[models."magpie-kiki/workbuddy/deepseek-v4.1-flash[1m]"]
provider = "magpie-kiki"
model = "workbuddy/deepseek-v4.1-flash[1m]"
max_context_size = 1000000
display_name = "Deepseek-V4.1-Flash"
capabilities = ["thinking", "image_in"]
support_efforts = ["xhigh"]
default_effort = "xhigh"
# <<< magpie-bridge <<<
```

同时把 `default_model` 改成 `magpie-kiki/<模型 id>`，并在
`~/.kiki/credentials/credentials.toml` 写入同一个 provider 的 `api_key`。

- `capabilities` 和 `support_efforts` 来自 Magpie 对该模型的描述：有思考档位时 Kiki 才能选档位，模型支持图片时才能粘贴截图。`default_effort` 是 Kiki 启动思考模型时需要的默认档位（优先 `high`，其次 `medium` / `low`；都没有时用列表里的最后一个档位）。
- 你原有的注释、其他 provider/model、`agent_executor_overrides` 等都不会被重写。
- 标记块里的内容由 Magpie 管理，手改会在下一次同步被覆盖。
- 如果 Kiki 自己重写了 `config.toml`（把注释丢掉），插件下次也会按表名把旧块清掉再写，不会出现重复表。

## 撤回

在 Magpie 的 Agents 页把 Kiki 切回它自己的模型，或关掉 Kiki 那一行。约 1 秒内（或下一次 Kiki 会话启动时），插件会：

- 删掉 `config.toml` 和 `credentials.toml` 里的 `magpie-bridge` 块；
- 把 `default_model` 恢复成你原来的值和整行注释；
- 删除 `~/.kiki/.magpie-bridge/state.json`。

已经打开的 Kiki 会话不受影响；新会话会回到原来的模型。

如果先卸载了插件，标记块会留下。手动删除
`# >>> magpie-bridge >>>` 到 `# <<< magpie-bridge <<<` 之间的内容，把
`default_model` 改回去，并删除 `~/.kiki/magpie.json` 和
`~/.kiki/.magpie-bridge/`。

## Magpie Library

这个 agent 插件也声明了 Kiki 的 Library 位置，Magpie 的指令、MCP 服务器和 Skills 会分别写到：

- `~/.kiki/AGENTS.md`（指令）
- `~/.kiki/mcp.json`（MCP，Kimi 形状）
- `~/.kiki/skills/`（Skills）

## 排查

- **Kiki 没出现在 Magpie 的 Agents 页**：确认文件夹里有 `package.json`，并且 `"magpie": {"agent": "./kiki.agent.js"}` 和 `"main": "./kiki.host.js"` 都在；`~/.kiki` 目录存在（Magpie 用这个目录判断 Kiki 是否安装）。在 Magpie 的 Plugins 页看这行有没有报错。
- **Magpie 里搜不到这个插件**：Magpie 的 Discover 通过 GitHub 的 `magpie-plugin` 标签发现 agent 插件（本仓库已加）；它不会把 agent 插件放进 npm 搜索结果。直接运行 `magpie plugin add magpie-agent-kiki` 最稳。
- **选了模型但 Kiki 没变**：
  1. 确认 Magpie 正在运行，等 1–2 秒；
  2. 看 `~/.kiki/.magpie-bridge/last.log`；
  3. 在 Magpie 的 Plugins 页看这个插件有没有加载错误；
  4. 仍然不行就装 Kiki 侧插件，用会话启动钩子兜底。
- **Magpie 的插件宿主没起来**：Magpie 需要 Bun 1.4.x。运行一次 `magpie plugin list` 会触发宿主；如果它报 Bun 的错误，按提示处理。Kiki 侧插件不依赖 Magpie 的宿主。
- **`node` 找不到**：只有 Kiki 侧可选钩子用 `node`。安装 Node.js 18+ 并确保它在 Kiki 进程的 PATH 里。
- **`config.toml` 里已经有 `magpie-kiki` provider**：插件会认为那是你自己的，不覆盖，日志里会写
  `already has a magpie-kiki provider table`。先改名或删除那个表再试。

## 要求

- Magpie 0.1.2229 或更新（Bun 插件宿主；已在 0.1.2229 上验证）
- Kiki 0.5.0 或更新（`config.toml` 的 provider/model 格式；可选插件需要 hooks）
- Bun 1.4.x（Magpie 会自己下载，供插件宿主使用）
- Node.js 18+（只给可选的 Kiki 侧钩子用）

## 文件

```text
package.json          Magpie 插件的清单（npm / Magpie 读取）
kiki.agent.js         Magpie agent 描述 + connect
kiki.host.js          Bun 插件宿主入口：监听交接文件并同步
lib/bridge.mjs        两边共用的同步逻辑
kimi.plugin.json      Kiki 插件清单（可选的 SessionStart hook）
hooks/sync.mjs        Kiki 侧钩子入口，调用 lib/bridge.mjs
icon.svg              图标
LICENSE               MIT 许可证
README.md             本文件
```
