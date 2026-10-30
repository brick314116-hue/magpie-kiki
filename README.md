# Magpie × Kiki

让 Kiki 出现在 Magpie 的 **Agents** 页面：在 Magpie 里给 Kiki 选一个模型，Kiki 的新会话就用它。

同一个文件夹是两种插件：

| 位置 | 作用 |
| --- | --- |
| `package.json` + `kiki.agent.js` | **Magpie agent 插件**。在 Agents 页把 Kiki 列出来，选模型后写 `~/.kiki/magpie.json`（JSON 交接文件）。 |
| `kimi.plugin.json` + `hooks/sync.mjs` | **Kiki 插件**。每次 Kiki 会话启动时读取 `~/.kiki/magpie.json`，把模型、网关地址和密钥写进 `~/.kiki/config.toml` 和 `~/.kiki/credentials/credentials.toml`。 |

## 为什么需要两边各装一次

Magpie 的 agent 插件只能编辑 **JSON / YAML / env** 文件，而 Kiki 的供应商和模型配置在 **`~/.kiki/config.toml`（TOML）**，Magpie 目前不能直接写。所以：

1. Magpie 侧把选择写成一个 JSON 交接文件；
2. Kiki 侧插件在会话启动时把它落进 `config.toml`。

两边都不需要常驻进程，也不联网。Kiki 侧只在会话启动时跑一次，几毫秒。

## 安装

### 第 1 步：装进 Magpie

先克隆本仓库，再把这个文件夹装进 Magpie：

```sh
git clone https://github.com/brick314116-hue/magpie-kiki.git
magpie plugin add ./magpie-kiki
```

也可以在 Magpie 窗口的 **Plugins → Add a plugin** 里选择克隆下来的文件夹。

装好后 **Agents** 页会出现 **Kiki**，点它的模型选择器挑一个 Magpie 模型。

> 不同 Magpie 版本对“直接填 GitHub 地址”的支持不一样；用本地文件夹最稳。

### 第 2 步：装进 Kiki（只需一次）

在 Kiki 里（TUI 或 GUI 的插件安装）：

```text
/plugins install --trust https://github.com/brick314116-hue/magpie-kiki
/plugins enable magpie-bridge
```

也可以把仓库克隆到本地后安装同一个文件夹：

```text
/plugins install --trust ./magpie-kiki
/plugins enable magpie-bridge
```

GUI 里在安装预览中点 **允许并安装**，并选择**全局使用**（否则会话启动钩子不会跑）。

> `--trust` / “允许并安装” 是 Kiki 对会运行代码的插件的知情同意。这个插件只会在会话启动时运行 `hooks/sync.mjs`，没有网络请求，也没有常驻进程。

### 第 3 步：先开一个新会话

在 Magpie 里选好模型后，**新开一个 Kiki 会话**。已经在运行的会话会保留它自己的模型，这是 Kiki 的设计。

## 注意事项

- **必须两边都装。** 只把文件夹导入 Magpie，Kiki 会出现在 Agents 页，选模型也会写 `~/.kiki/magpie.json`，但 Kiki 不会去读；必须再装 Kiki 侧的 `magpie-bridge` 并**启用**，钩子才会把模型写进 `config.toml`。
- **Kiki 侧要“全局使用”。** 只安装、不启用（或只在别的会话里启用）时，会话启动钩子不会运行。`/plugins list` 里应能看到 `magpie-bridge` 处于启用状态。
- **默认只支持 `~/.kiki`。** Magpie 侧固定写 `~/.kiki/magpie.json`，并用 `~/.kiki` 判断 Kiki 是否安装。如果你的 Kiki 用了自定义 `KIKI_HOME`，这套插件不适用。
- **只影响新会话。** Kiki 在会话创建/启动时确定模型；已经开着的会话不会中途换模型。选好模型后开新会话即可。
- **会修改两个文件。** `~/.kiki/config.toml` 和 `~/.kiki/credentials/credentials.toml` 里会出现带 `magpie-bridge` 标记的块；不要手改标记块，下一次会话会被覆盖。取消选择会自动撤回；如果先卸载 Kiki 插件，块会留下，按下面“撤回”一节的说明手动删除。
- **密钥保存在本机。** `credentials.toml` 会保存 Magpie 网关的密钥（脚本会尽量设为仅当前用户可读；Windows 上 `chmod` 可能不起作用）。不要把这两个文件提交到 Git。
- **钩子以你的用户权限运行 Node。** 它只读写上述本机文件，不联网、不常驻；介意的话可以先读一遍 `hooks/sync.mjs`。
- **默认思考档位是 `high`。** 模型有思考档位时，`default_effort` 会优先选 `high`，其次 `medium` / `low`，都没有时用列表里的最后一个档位。想临时换档位，在 Kiki 会话里选；想改默认值，需要改脚本后重新安装 Kiki 插件。
- **没有发布到 npm / Magpie 社区 registry。** 直接从本仓库或本地文件夹安装即可。要让 Magpie 的在线 Plugins 列表也收录，需要另外发布 npm 包并向社区仓库提交 `registry.json` 条目（可选）。

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
- 标记块里的内容由 Magpie 管理，手改会在下一次 Kiki 会话被覆盖。
- 如果 Kiki 自己重写了 `config.toml`（把注释丢掉），插件下次也会按表名把旧块清掉再写，不会出现重复表。

## 撤回

在 Magpie 的 Agents 页把 Kiki 切回它自己的模型，或关掉 Kiki 那一行。下一次 Kiki 会话启动时，插件会：

- 删掉 `config.toml` 和 `credentials.toml` 里的 `magpie-bridge` 块；
- 把 `default_model` 恢复成你原来的值和整行注释；
- 删除 `~/.kiki/.magpie-bridge/state.json`。

已经打开的 Kiki 会话不受影响；新会话会回到原来的模型。

如果先卸载了 Kiki 插件，`config.toml` 里的块会留下。手动删除
`# >>> magpie-bridge >>>` 到 `# <<< magpie-bridge <<<` 之间的内容，并把
`default_model` 改回去即可。

## Magpie Library

这个 agent 插件也声明了 Kiki 的 Library 位置，Magpie 的指令、MCP 服务器和 Skills 会分别写到：

- `~/.kiki/AGENTS.md`（指令）
- `~/.kiki/mcp.json`（MCP，Kimi 形状）
- `~/.kiki/skills/`（Skills）

## 排查

- **Kiki 没出现在 Magpie 的 Agents 页**：确认文件夹里有 `package.json` 且 `"magpie": {"agent": "./kiki.agent.js"}`，并且 `~/.kiki` 目录存在（Magpie 用这个目录判断 Kiki 是否安装）；在 Magpie 的 Plugins 页看这行有没有报错。
- **选了模型但 Kiki 没变**：确认 Kiki 插件已安装且**启用**（`/plugins list` 里有 `magpie-bridge`），并且是**全局使用**；然后开新会话。
- **看同步日志**：`~/.kiki/.magpie-bridge/last.log`。每次会话启动会重写；没有内容表示没做改动或一切正常。
- **`node` 找不到**：Kiki 插件的钩子用 `node` 运行。安装 Node.js 18+ 并确保它在 Kiki 进程的 PATH 里。
- **`config.toml` 里已经有 `magpie-kiki` provider**：插件会认为那是你自己的，不覆盖，日志里会写
  `already has a magpie-kiki provider table`。先改名或删除那个表再试。

## 要求

- Kiki 0.5.0 或更新（`config.toml` 的 provider/model 格式、插件 hooks）
- Magpie 0.1.2219 或更新（agent 插件）
- Node.js 18+（只给 Kiki 侧钩子用）

## 文件

```text
package.json          Magpie 插件的清单（npm / Magpie 读取）
kiki.agent.js         Magpie agent 描述 + connect
kimi.plugin.json      Kiki 插件清单（SessionStart hook）
hooks/sync.mjs        Kiki 侧同步脚本
icon.svg              图标
LICENSE               MIT 许可证
README.md             本文件
```
