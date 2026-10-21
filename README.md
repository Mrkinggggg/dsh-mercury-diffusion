# dsh-mercury-diffusion

DeepSeek Harness（dsh）插件：接入 [Inception Mercury](https://docs.inceptionlabs.ai) 扩散语言模型，获取的是 API 返回的真实去噪帧，并在 Web UI 里实时渲染它的扩散去噪过程，也就是"从乱码收敛成答案"的过程。

<img src=".\assets\show.gif" style="zoom: 67%;" />

## 快速开始

要求 dsh `>=0.2.1-rc.2 <0.3.0`、Node `^22.19 || >=24`。

执行

```sh
dsh plugin --profile web add dsh-mercury-diffusion
dsh web
```

或

```sh
git clone https://github.com/TonyWu2333/dsh-mercury-diffusion.git
cd dsh-mercury-diffusion
npm install
npm pack
dsh plugin --profile web add ./dsh-mercury-diffusion-0.2.0.tgz
dsh web
```

然后到 **设置 → 模型 → 添加模型供应商 → 自定义模型API** 填扩散模型供应商的 API 根地址（Inception 为 `https://api.inceptionlabs.ai`）与 API Key。插件不注册任何 provider，也不提供自己的配置页，用的是你在这里加的这条路由。

当你以支持**扩散渲染**的模型开启新对话或者切换到这些模型时，右侧将会出现悬浮按钮用于启用/关闭渲染效果。开关状态记在 dsh 的用户设置里（插件配置的 `diffusion.<provider>::<model>`），重启后保持。


## 工作方式

```
Mercury SSE (diffusing: 每块都是完整的当前文本)
  └─ 桥接（在 llm/stream 处接管，自行带上 diffusing: true 重发）
        ├─ 中间帧 ─→ DiffusionHub ─→ /api/mercury-diffusion/frames (SSE, Connection exact route)
        │                              └─→ 浏览器帧源（按节奏回放）─→ 助手气泡原地播放
        ├─ 第一帧：空文本 block-start（让气泡立即出现）
        └─ 结束后：最终文本的 text-delta / block-end ─→ 会话日志 / 对话
```

- **中间帧不进入会话日志，也不会发给模型。** dsh 的 `StreamChunk` 协议里 `text-delta` 只能追加，而扩散帧是整段替换，所以帧走旁路通道，只有收敛后的文本作为正常 assistant 消息落盘。这遵守 dsh "模型可见 ⟺ 写入日志"的约束。
- **只有当某个浏览器正在查看该会话时才请求 `diffusing`。** 输入区里挂着那个悬浮按钮组件，它同时保持帧通道订阅，作为"有人在看"的信号。标题生成、上下文压缩等辅助请求，以及 headless / ACP 等没有 Web 的场景，一律使用普通增量流式。
- **扩散能力由探针判定，不看模型名，也不花 token。** 进入会话时对「该路由 + 该模型」发一条结构上必然被拒的请求（`messages: []`，并把 `diffusing` 传成非法类型）。校验发生在生成之前，所以永远在产出 token 之前就被 400；只有真正认识这个字段的服务端才会额外报一条 `loc: ["body","diffusing"]` 类型错误，据此判定 `yes` / `no` / `unknown`，结论按 `provider::model` 缓存在进程内。
- **只接管能忠实重发的请求。** 带图片或文件、辅助调用、没有浏览器查看的会话、该模型开关关闭——一律原样交还原适配器；网关若不认 `diffusing`，在第一帧到达前失败也会自动退回原适配器。
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

## 本地演示

**不需要 API KEY**

`scripts/mock-mercury.mjs` 是一个本地假服务。`diffusing` 请求返回逐步去噪的整段文本，其他请求返回普通增量：

```sh
node scripts/mock-mercury.mjs   # http://127.0.0.1:18931/v1
```

起好后，在 **设置 → 模型 → 添加模型供应商 → 自定义模型API** 加一条路由即可，不需要改任何配置文件：

| 项 | 值 |
|---|---|
| API 地址 | `http://127.0.0.1:18931/v1` |
| 协议 | OpenAI Chat Completions |
| 模型 | `mercury-3` |
| API Key | 随便填，mock 不校验 |

## 开发

```sh
git clone https://github.com/TonyWu2333/dsh-mercury-diffusion.git
cd dsh-mercury-diffusion
npm install
npm run typecheck
npm test          # node --test，含真实 dsh BlockAssembler 的组装校验和端到端帧通道测试
npm run build     # lib/index.js（Host，ESM）+ lib/client.js（dsh client-module 闭包格式）
```

构建脚本会做纯度检查：客户端 bundle 只允许 require dsh `PLATFORM_MODULES` 中的模块，并且不能内联任何 `@deepseek-ai/*` 运行时代码。

## 已知限制

- Inception 文档只说明了扩散模式下的**文本**帧。工具调用参数在扩散模式下是增量还是整段快照，文档没有写。桥接会同时保留两种拼法，在结束时选择能解析成 JSON 的那种。这一行为还没有用真实 API 验证。
- 播放的是真实去噪帧，帧数由模型决定，一般只有 5 到 10 帧，动画持续约 1 到 2 秒；官网是固定 1.5 秒的前端动画。
- 浏览器端没有配置项：dsh 的浏览器插件拿不到 cordis.yml 配置，所以回放节奏和重连退避时间都是写在代码里的常量。
- Inception 免费额度在高峰期会限流（"free tier is at capacity"），dsh 会自动重试；重试成功后照常播放。
- Mercury 模型只接受文本输入：图片会由 dsh 转成文字占位；带图片或文件的回合不走桥接，仍由原适配器按普通增量处理。
