# dsh-mercury-diffusion

DeepSeek Harness（dsh）插件：接入 [Inception Mercury](https://docs.inceptionlabs.ai) 扩散语言模型，并在 Web UI 里实时渲染它的扩散去噪过程，也就是"从乱码收敛成答案"的过程。

- **模型接入**：注册 `mercury` provider，提供 Mercury 3 / 2.5 / 2，支持工具调用、reasoning effort（`instant` / `low` / `medium` / `high`）和 usage 统计。
- **扩散渲染**：当某个会话在 Web UI 中打开时，请求会带上 Mercury 的 `diffusing: true`。和 [chat.inceptionlabs.ai](https://chat.inceptionlabs.ai/) 一样，回答直接在自己的气泡里从乱码逐帧收敛，整段先弱化显示，透明度从 0.2 渐变到 1。收敛后切换成正常的 Markdown 排版。区别在于官网用的是前端模拟动画，这里播放的是 API 返回的真实去噪帧。

## 安装

要求 dsh `>=0.2.1-rc.2 <0.3.0`、Node `^22.19 || >=24`。

```sh
git clone https://github.com/TonyWu2333/dsh-mercury-diffusion.git
cd dsh-mercury-diffusion
npm install
npm pack                                   # 生成 dsh-mercury-diffusion-0.1.0.tgz（会自动执行构建）
dsh plugin --profile web add ./dsh-mercury-diffusion-0.1.0.tgz
dsh web
```

然后到 **插件 → dsh-mercury-diffusion → 配置** 填入 API Key（也可以用环境变量 `INCEPTION_API_KEY`），在输入框的模型选择器中选择 **Inception Mercury → Mercury 3**。

## 配置

### 在 dsh 界面里设置（推荐）

打开 **插件 → dsh-mercury-diffusion**，点击行上的 **配置** 按钮，可以设置：

- **API Key**：保存后不会回显。
- **API 地址**。
- **扩散渲染开关**。

保存后立即生效，不用重启。设置会写进当前 profile 的 `cordis.patch.yml`，Key 以明文保存在本机。

如果没有在界面里保存 Key，插件使用环境变量 `INCEPTION_API_KEY`。这个变量可以写在启动目录的 `.env` 或 `~/.dsh/.env` 里，也可以在启动前 export。环境变量是配置 schema 的默认值，所以在界面里只改地址或开关时，它照样生效。点"清除已保存的 Key"可以回到使用环境变量。

### 在配置文件里设置

插件行的 id 是 `mercury-diffusion`。在 profile 的 `cordis.patch.yml` 中覆盖时，patch 会替换整个 `config`，需要写出所有用到的键：

```yaml
- id: mercury-diffusion
  config:
    apiKey: !!js process.env.INCEPTION_API_KEY
    diffusing: true
```

| 字段 | 默认值 | 说明 |
|---|---|---|
| `apiKey` | 必填 | Inception API Key。缺失时插件加载失败并告警，dsh 其他部分照常运行 |
| `baseURL` | `https://api.inceptionlabs.ai/v1` | API 根地址 |
| `provider` / `providerName` | `mercury` / `Inception Mercury` | provider 路由名和显示名 |
| `models` | Mercury 3 / 2.5 / 2 | 模型列表：`id`、`name`、`contextWindow`、`maxTokens`、`reasoningEfforts`、可选的 `defaultEffort` |
| `diffusing` | `true` | 为 `false` 时始终使用普通流式 |
| `frameIntervalMs` | `33` | 推送给浏览器的最小帧间隔；被跳过的帧中只保留最新一帧 |
| `streamIdleTimeoutMs` | `300000` | provider 流空闲超时 |
| `heartbeatMs` | `15000` | 帧通道的保活注释间隔 |

## 工作方式

```
Mercury SSE (diffusing: 每块都是完整的当前文本)
  └─ MercuryAdapter ── 中间帧 ─→ DiffusionHub ─→ /api/mercury-diffusion/frames (SSE, Connection exact route)
        │                                              └─→ 浏览器帧源（按节奏回放）─→ 助手气泡原地播放
        ├─ 第一帧：空文本 block-start（让气泡立即出现）
        └─ 结束后：最终文本的 text-delta / block-end ─→ 会话日志 / 对话
```

- **中间帧不进入会话日志，也不会发给模型。** dsh 的 `StreamChunk` 协议里 `text-delta` 只能追加，而扩散帧是整段替换，所以帧走旁路通道，只有收敛后的文本作为正常 assistant 消息落盘。这遵守 dsh "模型可见 ⟺ 写入日志"的约束。
- **只有当某个浏览器正在查看该会话时才请求 `diffusing`。** 输入区里挂着一个不可见组件，负责保持帧通道订阅，作为"有人在看"的信号。标题生成、上下文压缩等辅助请求，以及 headless / ACP 等没有 Web 的场景，一律使用普通增量流式。
- **按节奏回放。** Mercury 一次回答通常只有 5 到 10 帧，而且往往同时到达，所以浏览器端每帧至少显示 180 毫秒，收敛后停留 400 毫秒再换成 Markdown。
- **气泡认领。** 一次扩散只会绑定到一个气泡：要么是正在生成的气泡，要么是正文与最终帧完全相同的气泡。多步回合里，后一步的气泡不会抢走前一步还在播放的动画。
- 帧通道只对 owner Peer 开放，鉴权沿用 dsh Connection 的规则。

### 替换了 dsh 的助手消息渲染器

dsh 没有给助手消息的正文开放扩展点，而 keyed 插槽只能整体替换、不能包一层。所以插件以更高优先级注册了 `conversation.chat.node[assistant-step]`，**所有模型的助手消息都会经过它**。正常情况下的渲染移植自 dsh ui-chat 的 `AssistantNodeView`（MIT 许可）：

- **完全沿用：** Markdown 和代码块（`MarkdownText`）、文件链接、过程折叠，以及官方的思考过程正文 Factory 和图片画廊 Factory。
- **与原生的差异：** 思考过程的"完成后预览"开关读的是 ui-chat 自己注册时拿到的设置，插件拿不到，所以只在生成过程中显示预览。
- **停用插件即恢复：** 停用或卸载插件后，dsh 原生的渲染器立刻恢复。
- **升级风险：** dsh 升级如果改了助手消息的数据结构，需要同步更新这个渲染器。

调试：在浏览器控制台执行 `localStorage.setItem('dsh-mercury-debug', '1')` 后刷新页面，会输出帧接收和气泡认领日志。

## 本地演示（不需要 API Key）

`scripts/mock-mercury.mjs` 是一个本地假服务。`diffusing` 请求返回逐步去噪的整段文本，其他请求返回普通增量：

```sh
node scripts/mock-mercury.mjs   # http://127.0.0.1:18931/v1
```

把下面内容保存为 `mock-overlay.yml`，用 `dsh --profile web --patch ./mock-overlay.yml` 启动：

```yaml
- id: mercury-diffusion
  config:
    apiKey: mock-key
    baseURL: http://127.0.0.1:18931/v1
```

## 开发

```sh
npm install
npm run typecheck
npm test          # node --test，含真实 dsh BlockAssembler 的组装校验和端到端帧通道测试
npm run build     # lib/index.js（Host，ESM）+ lib/client.js（dsh client-module 闭包格式）
```

构建脚本会做纯度检查：客户端 bundle 只允许 require dsh `PLATFORM_MODULES` 中的模块，并且不能内联任何 `@deepseek-ai/*` 运行时代码。

## 已知限制

- Inception 文档只说明了扩散模式下的**文本**帧。工具调用参数在扩散模式下是增量还是整段快照，文档没有写。适配器会同时保留两种拼法，在结束时选择能解析成 JSON 的那种。这一行为还没有用真实 API 验证。
- 播放的是真实去噪帧，帧数由模型决定，一般只有 5 到 10 帧，动画持续约 1 到 2 秒；官网是固定 1.5 秒的前端动画。
- 浏览器端没有配置项：dsh 的浏览器插件拿不到 cordis.yml 配置，所以回放节奏和重连退避时间都是写在代码里的常量。
- Inception 免费额度在高峰期会限流（"free tier is at capacity"），dsh 会自动重试；重试成功后照常播放。
- Mercury 模型只接受文本输入。图片会由 dsh 自动转成文字占位。
