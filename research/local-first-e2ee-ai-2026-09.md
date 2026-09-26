# 本地优先 + E2EE 应用如何做 AI 功能 —— 技术方案调研（2026-09）

> 调研日期：**2026-09-25**（`date` 实测）。
> 目标项目：**heyta** —— 本地优先任务管理应用，op-log 事件溯源同步（非 CRDT），服务端从设计上看不到用户明文。
> 约束：`AGENTS.md` 的许可证白名单为 MIT / Apache-2.0 / BSD / ISC / MPL-2.0 / 0BSD / Unlicense / CC0；
> **AGPL / GPL / LGPL / BUSL / FSL / Elastic / SSPL / CC-BY-NC 一律不得进入产品代码**。
>
> **工具说明**：本次调研期间内置 `web_search`（Tavily）持续返回 HTTP 432 不可用，改用 AnySearch CLI
> （`python3 ~/.claude/skills/anysearch/scripts/anysearch_cli.py search|batch_search|extract`）+ 内置 `web_fetch`。
> 所有事实后标 `[来源: URL]`；查不到的一律写「未找到公开信息」，不做推测填充。分析性内容显式标注「（分析）」。

---

## 板块 1 · 本地 / 端侧推理现状（2026）

### 1.1 手机端

#### Apple Foundation Models framework（iOS 26+）

- 框架自 **iOS 26.0 / iPadOS 26.0 / macOS 26.0 / visionOS 26.0** 起可用（watchOS 27.0+ 亦列入平台列表），
  提供对**设备端模型**与 **Private Cloud Compute 模型**的统一访问；设备端模型擅长摘要、**实体抽取**、文本与图像理解、
  润色等任务；需要更强推理与更大上下文时改用 PCC 或任意 server 模型
  `[来源: https://developer.apple.com/documentation/foundationmodels]`。
- **上下文窗口 4096 tokens**（每个 language model session），是硬上限；拉丁字母约 3–4 字符/token，
  **中文/日文/韩文约 1 字符/token**——即中文单次可用上下文只有约 4000 字
  `[来源: https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window]`。
  官方建议的应对是把大任务拆成多个 session 分段处理
  `[来源: https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window]`。
- **结构化输出的官方保证**：`@Generable` 宏让模型直接生成 Swift 数据结构实例，框架承诺 strong guarantees；
  `Tool` 协议支持工具调用 `[来源: https://developer.apple.com/documentation/foundationmodels]`。
  这是「自然语言 → 结构化任务」在 Apple 端最贴近需求的一等公民 API。
- **模型规模（官方口径）**：第三代 Apple Foundation Models（2026-06-08 发布，与 Google 合作）包含两个设备端模型——
  **AFM 3 Core** 是「下一代 **3-billion-parameter dense** 模型」；**AFM 3 Core Advanced** 是
  **20B 参数稀疏架构，按请求只激活 1–4B 参数**，权重存 flash（NAND）、按 prompt 路由专家进 DRAM，
  需要「最有能力的 Apple silicon 系统」
  `[来源: https://machinelearning.apple.com/research/introducing-third-generation-of-apple-foundation-models]`。
- **2026 年最大的变化：框架已对第三方 LLM 开放**。WWDC 2026 session 339 引入
  `LanguageModelExecutor` 协议，「让框架几乎可以对接任何 LLM，本地或服务端」，任何厂商或个人开发者都能实现
  `[来源: https://developer.apple.com/videos/play/wwdc2026/339/]`。同场 session 提到 PCC 现在支持
  **reasoning + 32K token 上下文窗口**，并新增 Core AI（本地模型 + ANE）与 MLX（MLX-Community 上千模型）两条路径
  `[来源: https://developer.apple.com/videos/play/wwdc2026/339/]`。
- **许可条款**：框架本身随 iOS SDK 分发（Apple 平台 SDK 许可，非开源）；PCC 上的 Apple Foundation Models 对
  **App Store Small Business Program 且首次下载量 < 200 万**的开发者免费开放，需申请 PCC entitlement
  `[来源: https://developer.apple.com/private-cloud-compute/]`。

#### Google：ML Kit GenAI / Gemini Nano / AICore

- ML Kit GenAI APIs 由 **Gemini Nano** 驱动，跑在 **AICore** 系统服务上；提供 Summarization、Proofreading、
  Rewriting、Image description、Speech recognition，以及**通用的 Prompt API**（自定义文本/多模态提示）
  `[来源: https://developers.google.com/ml-kit/genai]`。
- Prompt API 于 2025-10-30 以 **Alpha** 发布，定位是「自定义 on-device Gemini Nano 体验」
  `[来源: https://android-developers.googleblog.com/2025/10/ml-kit-genai-prompt-api-alpha-release.html]`。
- 官方列举的隐私卖点：输入/推理/输出全部本地处理、断网可用、**无按次服务端成本**；
  且因为模型由 AICore 共享，若设备上已有 Gemini Nano 就**不必再下载模型**
  `[来源: https://developers.google.com/ml-kit/genai]`。
- 模型更新走 **Google Play 系统更新**，不由应用手动管理
  `[来源: https://discuss.ai.google.dev/t/how-to-deploy-aicore-gemini-nano-on-pixel-other-devices/93284]`。
- **2026-04 的 AICore Developer Preview 引入 Gemma 4**，两种尺寸（E4B 等），是「下一代 Gemini Nano 的基础」
  `[来源: https://android-developers.googleblog.com/2026/04/AI-Core-Developer-Preview.html]`。
- 设备可用性受限：**Magic Compose 只对装有 AICore 的设备开放**，且限 18 岁以上、仅英文、仅 Android 手机
  `[来源: https://support.google.com/messages/answer/13632636?hl=en]`。
- **许可**：ML Kit GenAI API 有单独的 Additional Terms of Service，不是宽松开源许可；
  「开发者对 API 客户端与用户体验的安全性负全责」`[来源: https://developers.google.com/ml-kit/genai-terms]`。

#### MediaPipe LLM Inference → 已被 LiteRT-LM 取代

- ⚠️ **关键状态变化**：MediaPipe LLM Inference API（Android/iOS/Web）**已进入 maintenance-only 模式**，
  新功能与优化全部转向 **LiteRT-LM**，官方明确建议迁移
  `[来源: https://developers.google.com/edge/mediapipe/solutions/genai/llm_inference]`。
  （此前广泛引用的 MediaPipe 教程已过时，不应作为 2026 年新项目的选型依据。）
- **LiteRT-LM** 定位 production-ready 编排层，跨 Android / iOS / Web / Desktop / IoT，支持 GPU 与 NPU 加速、
  多模态、**function calling + constrained decoding**，支持 Gemma / Llama / Phi-4 / Qwen
  `[来源: https://developers.google.com/edge/litert-lm/overview]`。
- **官方实测性能表（Featured Model: Gemma-4-E2B，模型体积 2.58 GB）**
  `[来源: https://developers.google.com/edge/litert-lm/overview]`：

  | 平台（设备） | 后端 | Prefill (tk/s) | Decode (tk/s) | TTFT (s) | 峰值 CPU 内存 (MB) |
  |---|---|---|---|---|---|
  | Android (S26 Ultra) | CPU | 557 | 47 | 1.8 | 1733 |
  | Android (S26 Ultra) | GPU | 3808 | 52 | 0.3 | 676 |
  | iOS (iPhone 17 Pro) | CPU | 532 | 25 | 1.9 | 607 |
  | iOS (iPhone 17 Pro) | GPU | 2878 | 56 | 0.3 | 1450 |
  | macOS (MacBook Pro M4 Max) | GPU | 7835 | 160 | 0.1 | 1623 |
  | Windows (Intel LunarLake) | GPU | 3751 | 48 | 0.3 | 3540 |
  | IoT (Raspberry Pi 5 16GB) | CPU | 133 | 8 | 7.8 | 1546 |

- **许可**：**Apache-2.0** `[来源: https://github.com/google-ai-edge/LiteRT-LM]`。

#### Qualcomm AI Engine / GenieX

- **GenieX** 是 Qualcomm 2026-06 发布的端侧推理运行时，**BSD-3-Clause 开源**，跑 GGUF LLM 与 VLM，
  利用 Snapdragon 的 **NPU / GPU / CPU**；提供 CLI、Python、Java、Docker，以及
  **OpenAI 兼容的 localhost server**（「现有 OpenAI 客户端只需换 base URL」）
  `[来源: https://www.qualcomm.com/developer/blog/2026/06/geniex-developer-preview]`
  `[来源: https://github.com/qualcomm/GenieX]`。
- 限制：**只能在 Qualcomm Snapdragon 平台运行** `[来源: https://github.com/qualcomm/GenieX]`。
- 底层是 Qualcomm AI Engine Direct（QNN）/ Genie 高層 API，包装 tokenizer、QNN backend、KV-cache、采样
  `[来源: https://dragonwingdocs.qualcomm.com/Key-Documents/AI-Developer-Workflow/topic/use-genai-model-with-genie]`。

#### llama.cpp / MLC-LLM 在移动端

- **llama.cpp**：**MIT** `[来源: https://github.com/ggml-org/llama.cpp/blob/master/LICENSE]`；
  GGUF 格式 + Q4_K_M 等量化是端侧事实标准，也是 Ollama / LiteRT-LM（部分）/ Nextcloud llm2 / GenieX 的底层或兼容格式。
- **MLC-LLM**：基于 Apache TVM 的通用部署引擎，可编译到手机 / 笔记本 / 浏览器 / 服务器；
  官方有专门的 Mobile Deployment 文档（Android + iOS 构建、库打包、模型集成）
  `[来源: https://github.com/mlc-ai/mlc-llm]` `[来源: https://deepwiki.com/mlc-ai/mlc-llm/7.3-mobile-deployment]`。
  许可：**Apache-2.0**（分析：Apache TVM 与 MLC 生态一贯为 Apache-2.0；MLC-LLM 仓库未在本次检索中逐字核验 LICENSE 首段）。

### 1.2 桌面端

| 方案 | 许可 | 硬件要求 / 性能 | 备注 |
|---|---|---|---|
| **Ollama** | **MIT** `[来源: https://github.com/ollama/ollama/blob/main/LICENSE]` | 8GB 显存跑 7–8B 约 40+ tok/s；显存不足时 offload 到系统 RAM 会掉到 3–8 tok/s `[来源: https://localllm.in/blog/ollama-vram-requirements-for-local-llms]` | Apple Silicon 上 **0.19（2026-03-30）起改用 Apple MLX 后端**：Qwen3.5-35B-A3B NVFP4 在 M5 系列上 prefill **1851 tok/s**、decode **134 tok/s**（需 >32GB 统一内存）`[来源: https://ollama.com/blog/mlx]` |
| **llama.cpp** | **MIT** | CPU/GPU 通用，GGUF 量化 | 上游，被大量产品内嵌 |
| **LM Studio** | 闭源，**2025-07 起个人与商业用途均免费** `[来源: https://lmstudio.ai/app-terms]` `[来源: https://www.linkedin.com/posts/yagil-burowski_lm-studio-is-free-for-use-at-work-activity-7348410973529034752-YvIE]` | GUI 优先，带 OpenAI 兼容 server | 非 OSI 开源，不可嵌入产品代码（分析） |
| **Apple MLX / mlx-lm** | **MIT** `[来源: https://github.com/ml-explore/mlx]` | Apple Silicon 专用，统一内存 | WWDC26 把它列为 Foundation Models 的三条本地路径之一 `[来源: https://developer.apple.com/videos/play/wwdc2026/339/]` |
| **vLLM** | **Apache-2.0** `[来源: https://github.com/vllm-project/vllm]` | GPU compute capability **≥ 7.5**（T4 / RTX20xx / A100 / L4 / H100 / B200）；Blackwell 需 CUDA ≥ 12.8 `[来源: https://docs.vllm.ai/en/stable/getting_started/installation/gpu/]` | 高吞吐服务端，**不是单机桌面方案**；自托管 AI 网关的首选引擎 |

### 1.3 浏览器端

#### Chrome 内置 Gemini Nano（Prompt API）—— 限制比预期多

- **平台限制（官方原文）**：Prompt / Summarizer / Writer / Rewriter / Proofreader API 只在
  **Windows 10/11、macOS 13+、Linux、Chromebook Plus 上的 ChromeOS** 可用；
  **「Chrome for Android、iOS，以及非 Chromebook Plus 的 ChromeOS 目前不支持」**
  `[来源: https://developer.chrome.com/docs/ai/prompt-api]`。
- **硬件门槛**：至少 **22 GB 空闲磁盘**（Chrome profile 所在卷）；GPU 路径需 **> 4 GB VRAM**；
  CPU 路径需 **16 GB RAM + ≥ 4 核**；音频输入强制要 GPU；网络需无限流量或不计量连接
  `[来源: https://developer.chrome.com/docs/ai/prompt-api]`。
- 模型**不在浏览器安装包里**，首次使用该 origin 时单独下载；尺寸随浏览器更新变化，
  用 `chrome://on-device-internals` 查看当前大小
  `[来源: https://developer.chrome.com/docs/ai/prompt-api]`。
- 官方声明「使用该模型时**没有任何数据发给 Google 或第三方**」
  `[来源: https://developer.chrome.com/docs/ai/prompt-api]`。
- **上下文管理**：每个 session 有有限上下文；窗口满时浏览器**自动逐对驱逐最老的消息**，
  若单条新 prompt 大到连清空历史都放不下则直接抛 `QuotaExceededError`；官方推荐用
  `session.contextUsage` / `session.contextWindow` 监控，并用 Summarizer 做 **session compacting**
  （把摘要放进 `initialPrompts`，该部分永不被驱逐）
  `[来源: https://developer.chrome.com/docs/ai/session-compacting]`。
- 社区报告 Prompt API 单次输入限制约 **1024 tokens**、session 窗口约 **4096 tokens**
  `[来源: https://groups.google.com/a/chromium.org/g/chrome-ai-dev-preview-discuss/c/IUHkRzyZcOE]`
  （非官方文档，仅供参考）。
- **Mozilla 公开反对 Prompt API**，理由之一是「开发者与用户都无法选择模型，只能用 Gemini Nano」
  `[来源: https://www.reddit.com/r/linux/comments/1t01wpv/mozillas_opposition_to_chromes_prompt_api_which/]`。

#### WebLLM / transformers.js

- **WebLLM（MLC）**：Apache-2.0，WebGPU 加速的浏览器内推理引擎
  `[来源: https://github.com/mlc-ai/web-llm]`；论文实测**可达同设备原生性能的 80%**，且仍有提升空间
  `[来源: https://arxiv.org/html/2412.15803v2]`。
- **transformers.js**：**Apache-2.0**，v3 起支持 WebGPU（官方称比 WASM 快最多 100×）、
  120 个架构、Hub 上 1200+ 预转换模型
  `[来源: https://github.com/huggingface/transformers.js]` `[来源: https://huggingface.co/blog/transformersjs-v3]`。
  v4 已发布并继续支持 WebGPU `[来源: https://www.reddit.com/r/javascript/comments/1s7r9qh/huggingface_has_just_released_transformerjs_v4/]`。

### 1.4 汇总对照

| 方案 | 许可 | 平台 | 模型尺寸 | 结构化输出能力 | 主要硬限制 |
|---|---|---|---|---|---|
| Apple Foundation Models | Apple SDK 条款 | iOS 26+/macOS 26+ | 3B dense（AFM3 Core）/ 20B 稀疏激活 1–4B | `@Generable` 强保证 + `Tool` | **4096 token 上下文**；需 Apple Intelligence 设备 |
| ML Kit GenAI（Gemini Nano） | Google 附加条款 | Android（AICore 设备） | 由 AICore 管理，共享模型 | 通用 Prompt API（Alpha） | 设备白名单；仅英文等限制随功能而异 |
| LiteRT-LM | Apache-2.0 | Android/iOS/Web/Desktop/IoT | Gemma-4-E2B = 2.58 GB | function calling + constrained decoding | 需自行分发模型 |
| GenieX | BSD-3-Clause | 仅 Snapdragon | GGUF 任意 | OpenAI 兼容 API（可约束解码，未逐字核验） | 仅 Qualcomm |
| llama.cpp / MLC-LLM | MIT / Apache-2.0 | 全平台 | 任意 GGUF / 编译产物 | 需自行做约束解码 | 工程量大 |
| Chrome Prompt API | 浏览器内置 | **仅桌面 Chrome** | Gemini Nano（大小随版本变） | JSON Schema 支持有限（未找到官方保证） | 22GB 磁盘 / 4GB VRAM / 无移动端 |
| WebLLM / transformers.js | Apache-2.0 | 有 WebGPU 的浏览器 | 通常 ≤ 8B（受显存限） | 需自行约束 | 首次下载大；WebGPU 覆盖率 |
| Ollama / MLX / vLLM | MIT / MIT / Apache-2.0 | 桌面 / 服务器 | 1B–70B+ | 各家支持 JSON schema / grammar | 桌面需 GPU 或大内存 |

### 1.5 关键问题：1B–8B 小模型做「自然语言 → 结构化任务」够用吗？

**结论：格式（schema 合规）基本够用，取值（内容正确）不够用；且工程可靠性是主要风险来源。**
公开评测数据如下。

**(a) The Structured Output Benchmark（SOB，2026-04，arXiv:2604.25359）** —— 目前最贴近该问题的公开评测：

- 评测 **21 个模型，参数范围 8B–358B**（用 vLLM 服务），跨文本 / 图像 / 音频三种来源，
  5,000 条文本记录 + 209 条图像 + 115 条音频；每条给出自然语言问题 + 必须遵守的 JSON schema + 已核验的 ground truth
  `[来源: https://arxiv.org/html/2604.25359v1]`。
- **核心发现**：「模型达到近乎完美的 schema 合规，但最好的 Value Accuracy（叶子值精确匹配）
  在文本上只有 **83.0%**，图像 **67.2%**，音频 **23.7%**——上下文越长抽取越难」
  `[来源: https://arxiv.org/html/2604.25359v1]`。
- 图 2 的描述更尖锐：「**每个模型的 JSON Pass 都超过 84%，但没有一个模型的 Value Accuracy 超过 80.4%**」，
  两者之差就是「结构化输出幻觉」
  `[来源: https://arxiv.org/html/2604.25359v1]`。
- 实测结果表中规模最小的几项（文本域首列 / 总体）：
  **Schematron-8B 0.832**、**IBM-Granite-4.0 0.832**、**Phi-4 0.831**、GPT-OSS-20B 0.732，
  而 Qwen3-235B 0.857、Claude-Sonnet-4.6 0.854、GPT-5 0.849
  `[来源: https://arxiv.org/html/2604.25359v1]`。
  → **8B 级模型与前沿模型的差距在文本抽取上只有约 2–3 个百分点**，但绝对水平都停在 ~83%。
- 该论文的定位很关键：SOB 用的是**多跳 QA 式长上下文**，比「把一句话解析成一条任务」难得多。
  对 heyta 的短句输入，难度显著低于该基准（分析）——但这也意味着**缺少直接对标的公开评测**。

**(b) IFStruct（Liquid AI，2026-06）** —— 关于「小模型能不能学会」的正面证据：

- 任务定义是「产出有效结构化输出并遵守多样 schema 要求」，**只评结构不评内容质量**，二元打分
  `[来源: https://www.liquid.ai/blog/ifstruct-v1.0]`。
- **关键结论：「这个任务对小型模型来说高度可学习」——用 RL 在专用训练集上训过的
  LFM2.5-350M 可以超过 Qwen3.5-4B、granite-4.0-h-tiny 等大得多的模型**
  `[来源: https://www.liquid.ai/blog/ifstruct-v1.0]`。
- 同时指出：**约束生成（constrained generation）只能保证语法有效，不能保证模型选对字段和值**
  `[来源: https://www.liquid.ai/blog/ifstruct-v1.0]`。
- 评测覆盖多种 schema 呈现方式（自然语言聊天式描述、带路径的 bullet、原始 JSON Schema、
  带注释的示例、扁平路径表、ASCII 表），并刻意压测字符串转义（多行文本、引号、代码片段、文件路径、stack trace）
  `[来源: https://www.liquid.ai/blog/ifstruct-v1.0]`。

**(c) 「Less Is More」（2026-04，arXiv:2604.24636）** —— 目前最有价值的**工程现实**证据：

- 生产级 Android 应用的纵向案例研究（Palabrita 猜词游戏，5 天 204 次提交，约 90 次与 AI 相关），
  模型为 **Gemma 4 E2B（2.6B）+ Qwen3 0.6B**
  `[来源: https://arxiv.org/html/2604.24636v1]`。
- 初始设计是「LLM 生成完整结构化谜题（word / category / difficulty / 5 条提示，JSON）」，
  最终**被迫退化为**「词表提供单词，LLM 只写 3 条短提示，失败时有确定性回退」
  `[来源: https://arxiv.org/html/2604.24636v1]`。
- 归纳出**五类端侧 SLM 特有故障**：输出格式违规、约束违规、上下文质量退化、延迟不兼容、模型选择不稳定；
  并给出具体症状——**600MB 的模型持续把 JSON 包在 markdown code fence 里**、
  生成字母数不对的词、**三次生成后因 KV cache 饱和而质量下降**
  `[来源: https://arxiv.org/html/2604.24636v1]`。
- 论文的核心结论值得直接引用为设计原则：
  **「端侧 SLM 在生产移动应用中是可行的，但只有开发者接受一个根本约束：
  最可靠的端侧 LLM 功能，是 LLM 做得最少的那个功能」**
  `[来源: https://arxiv.org/html/2604.24636v1]`。
  缓解手段包括多层防御性解析、带失败反馈的上下文重试、session 轮换、渐进式 prompt 硬化、系统性削减职责
  `[来源: https://arxiv.org/html/2604.24636v1]`。

**(d) BFCL（Berkeley Function Calling Leaderboard）** —— 工具调用方向的公开榜单，V4 版本仍在更新
（最新数据 2026-04-12，最新模型 BTL-3 88.5%）
`[来源: https://gorilla.cs.berkeley.edu/leaderboard.html]` `[来源: https://benchlm.ai/benchmarks/bfcl-v4]`。
**小模型（1B–8B）在该榜上的逐项分数未找到公开的稳定快照**——各第三方镜像榜的收录模型集不一致，
不宜作为选型依据。

**(e) 产品侧的间接证据**：

- **Things 3** 的自然语言输入是**规则式**的（官方支持文档只描述 When/Deadline 的写法约定，未提 AI）
  `[来源: https://culturedcode.com/things/support/articles/9780167/]`。
- **Todoist** 的自然语言解析与 AI 功能明确**跑在自家基础设施上**（非端侧）：
  「我们把 Todoist 所有 AI 功能跑在我们的安全基础设施上」
  `[来源: https://www.todoist.com/todoist-assist]`；Ramble 语音转任务强调 SOC2 Type II 与「输入被安全处理」
  `[来源: https://www.todoist.com/help/todoist/todoist-and-ai/dictate-to-add-tasks-with-ramble-P1Raq7vVF]`。
- **滴答清单**有独立的 AI 功能帮助页（自然表达 → 待办、录音转待办等），
  但**其推理位置与隐私架构未找到公开信息**
  `[来源: https://help.dida365.com/articles/7444671678778441728]`。
- **Apple Reminders 在 iOS 27 获得自然语言输入**，被描述为「Reminders 此前已有一定程度的自然语言支持」
  `[来源: https://www.curbcuts.co/blog/2026-6-12-yaslf8i3hz5y9oa2jndw9dz2liseb7]`。

> **对 heyta 的直接含义（分析）**：自然语言 → 结构化任务属于「短输入 + 小 schema + 高容错」的抽取任务，
> 比 SOB 的多跳长上下文容易得多；用 3–8B 模型 + **约束解码**（grammar / JSON Schema）在
> Apple / Android / 桌面三端都有官方或成熟路径。但**必须按「LLM 做得最少」设计**：
> 让模型只输出意图与槽位（标题 / 日期 / 优先级 / 清单名），解析失败就走确定性回退（正则 + 日期库），
> 且**绝不把模型输出直接写入 op-log**——必须经一层 schema 校验与用户确认。

---

## 板块 2 · BYOK（用户自带 Key）

### 2.1 密钥存储

| 平台 | 机制 | 关键事实 |
|---|---|---|
| iOS | Keychain / Secure Enclave | 私钥存 Keychain，磁盘加密且仅本 app 可访问 `[来源: https://developer.apple.com/documentation/security/protecting-keys-with-the-secure-enclave]`；`kSecAttrAccessibleWhenUnlockedThisDeviceOnly` = 仅解锁时可访问且**不迁移到新设备** `[来源: https://developer.apple.com/documentation/security/ksecattraccessiblewhenunlockedthisdeviceonly]` |
| Android | Keystore + Tink/DataStore | `EncryptedSharedPreferences` 已在 `androidx.security:security-crypto` **1.1.0 正式弃用** `[来源: https://developer.android.com/reference/androidx/security/crypto/EncryptedSharedPreferences]`；推荐迁到 DataStore + Tink + Keystore `[来源: https://proandroiddev.com/goodbye-encryptedsharedpreferences-a-2026-migration-guide-4b819b4a537a]`。**Keystore 不防运行时钩子**：OWASP MASTG 演示用 Frida hook `Cipher.doFinal` 提取受 Keystore 保护的 API key `[来源: https://mas.owasp.org/MASTG-DEMO-0106/]` |
| 桌面 | macOS Keychain / Windows DPAPI / Linux libsecret | Electron `safeStorage` 三平台分别落到 Keychain、DPAPI、libsecret `[来源: https://electronjs.org/docs/latest/api/safe-storage]` |
| 浏览器 | WebCrypto / IndexedDB | `CryptoKey.extractable === false` 时 `exportKey()`/`wrapKey()` 抛异常 `[来源: https://developer.mozilla.org/en-US/docs/Web/API/CryptoKey/extractable]`；不可导出 key 可存 IndexedDB 跨刷新持久化。**但它只防「带走密钥」，不防「使用密钥」**——XSS 仍可让页面用该 key 解密/签名并外传结果 `[来源: https://crypto.stackexchange.com/questions/85587/what-do-people-use-non-extractable-webcrypto-keys-for]` |

> 🔴 **结论（分析）**：LLM API key 是 **bearer 凭据**，必须以 `Authorization` 头明文发出，
> 因此 **WebCrypto 非导出密钥在架构上无法保护「用户粘进网页的 LLM key」**——XSS 直接读得到。
> 若 heyta 做 BYOK，密钥必须限制在原生壳（Keychain / Keystore）内；
> Web 端只能给「服务端代理」或「不支持 BYOK」两个选项。

### 2.2 移动端直连第三方 API 的坑

- **CORS**：
  - **原生 RN 网络栈不受 CORS 约束**（CORS 是浏览器机制）——该结论在社区被广泛复述，
    但**未找到官方规范级来源** `[来源: https://www.reddit.com/r/reactnative/comments/yo5tzw/dealing_with_cors/]`。
    WebView 例外：Joplin 报告 iOS/Android 的 `react-native-webview` 存在 CORS 限制
    `[来源: https://discourse.joplinapp.org/t/fetch-cors-issue-on-mobile-end-seeking-solution/44383]`。
  - **Web 构建完全受 CORS 约束，且两大厂商行为不同**：
    - **Anthropic 支持浏览器直连，但需要显式 opt-in 头**：
      `anthropic-dangerous-direct-browser-access: true`；不带该头会返回
      `"CORS requests must set 'anthropic-dangerous-direct-browser-access' header"`
      `[来源: https://simonwillison.net/2024/Aug/23/anthropic-dangerous-direct-browser-access/]`
      `[来源: https://github.com/ChatGPTNextWeb/NextChat/issues/5429]`。
      该头的名字本身就是警告：**绝不应该在客户端代码里暴露 API key**
      `[来源: https://news.ycombinator.com/item?id=41326384]`。
    - **OpenAI 的 CORS 支持不稳定**：从 localhost 直接 fetch 会遇到 CORS policy 错误
      `[来源: https://community.openai.com/t/how-to-fix-cors-policy-error-when-fetching-openai-api-from-localhost/1140420]`；
      且有用户报告 **Responses API 停止发送 `Access-Control-Allow-Origin` 头**
      `[来源: https://community.openai.com/t/has-the-cors-policy-changed-responses-api/1372791]`。
      → **Web 端直连 OpenAI 属于随时可能失效的依赖**（分析）。
  - **可自建/自托管的端点通常自己控制 CORS**（llama.cpp / Ollama / vLLM / LocalAI 都可配），
    这是 Web 端唯一可控的路径（分析）。
- **流式 SSE**：RN 原生 `fetch` 会缓冲分块，标准 fetch/polyfill 拿不到逐 token 流，需要原生模块或 polyfill
  `[来源: https://stackoverflow.com/questions/77725698/how-to-achieve-text-streaming-in-react-native-using-openai-api]`；
  可选 SSE / WebSocket 二进制流 / `fetch` ReadableStream 三种，社区实现如 `react-native-fetch-sse`
  `[来源: https://github.com/Albert-Gao/react-native-fetch-sse]`。
- **区域封锁**：OpenAI 与 Anthropic 在**网络边缘**封锁中国大陆 IP，无 header/DNS 技巧可绕过，
  只能走境外网关或用国内替代（DeepSeek / 豆包 / 通义等）
  `[来源: https://teamorouter.com/blogs/access-ai-apis-china-without-vpn-2026]`。
  Anthropic 另公开指控 Moonshot、DeepSeek 通过假账号与盗刷信用卡绕道访问 Claude
  `[来源: https://www.scmp.com/news/us/diplomacy/article/3367112/moonshot-deepseek-secretly-routed-user-requests-claude-anthropic-claims]`。
  → 对中文优先的 heyta，**DeepSeek / 豆包是比 OpenAI / Anthropic 更现实的 BYOK 目标**（分析）。
- **计费与配额、TLS 证书固定、App Store 针对「客户端内置用户自有 key」的具体条款**：
  **未找到公开信息**（本次未检索到官方规范或行业报告）。
- **key 在客户端可被提取**：移动 app 内嵌 key 可被提取滥用
  `[来源: https://www.guardsquare.com/blog/protect-api-keys-from-leaks]`；
  Electron 应用可解包 asar 读出源码与硬编码密钥
  `[来源: https://danaepp.com/reverse-engineering-electron-apps-to-discover-apis]`。
- **已记录的泄漏事件**：OpenAI 2026-09 披露 6 起模型相关事故，含模型使用暴露的 API key、
  以及在 GitHub 上搜索泄漏 key `[来源: https://cybersecuritynews.com/openai-models-api-key-leaks/]`；
  2026-01 有恶意浏览器扩展专门窃取 OpenAI API key
  `[来源: https://www.obsidiansecurity.com/blog/small-tools-big-risk-when-browser-extensions-start-stealing-api-keys]`。

### 2.3 使用 BYOK 的开源/商业产品

| 产品 | 密钥存储 | 是否代理 | 许可 | 备注 |
|---|---|---|---|---|
| **Obsidian Copilot** | 本机 **Obsidian Keychain**（BYOK 设置项） | 不代理 | **AGPL-3.0** `[来源: https://github.com/logancyang/obsidian-copilot]` | 历史问题：曾把 key 明文存在插件 `data.json`，2026-02 有 issue 要求改用原生 Secret Storage `[来源: https://github.com/logancyang/obsidian-copilot/issues/2162]`。🔴 许可不可用于 heyta |
| **Raycast AI** | per-provider 自定义 key（Anthropic/Google/OpenAI/OpenRouter） | 不代理，直连 provider 计费 | 闭源 | BYOK 于 v1.100.0（2025-06-11）加入 `[来源: https://manual.raycast.com/ai/bring-your-own-key]` |
| **BoltAI** | Apple Keychain（AES-256），可选用户自设 passphrase 二次加密 | 不代理 | 闭源 | `[来源: https://docs.boltai.com/blog/how-boltai-handles-your-api-keys]` |
| **LobeChat** | 可服务端存储 | **可选代理**：key 只存服务端，从不下发客户端 | 未找到公开信息（本次） | `.env.example` 明写 key「stored server-side only and NEVER exposed」`[来源: https://github.com/lobehub/lobehub/blob/canary/.env.example]` |
| **Open WebUI** | 服务端数据库 | 服务端代理 | **非 OSI**（2025-05 从 BSD-3 改为带 CLA 与反背书条款的 Open WebUI License）`[来源: https://docs.openwebui.com/license/]` | 🔴 不可用 |
| **Cherry Studio** | 本地设备 | 不代理 | **AGPL-3.0** | 🔴 不可用 |
| **Jan** | 未找到公开信息 | 本地优先，可选本地 API server | **Apache-2.0** | `[来源: https://www.jan.ai/docs]` |

> **观察到的三种模式（分析）**：
> (1) **纯客户端持有**（Raycast / BoltAI / Obsidian Copilot）——key 落本地 Keychain，浏览器场景无法提供同等保证；
> (2) **服务端持有 + 代理**（LobeChat / Open WebUI）——key 永不下发，但用户必须信任运营者，与 heyta 的 E2EE 前提冲突；
> (3) **自建实例凭据**（Immich）——key 只对用户自己的实例有效，泄漏影响面小。

---

## 板块 3 · 隐私增强的云端推理

### 3.1 机密计算 / TEE 能不能真做到「服务端看不到明文」

**结论：对软件层运营方成立，对硬件层运营方不成立。** TEE 的威胁模型是「防御拥有整个基础设施特权
（可 dump VM 内存、绕过内部接口）的恶意云厂商与服务管理员」，但**不覆盖**提示注入、越狱、数据投毒
`[来源: https://arxiv.org/html/2606.11145v1]`。

**已发表的开销数字**：

- **H100（vLLM 0.5.4 基准）**：绝大多数典型 LLM 查询开销 **< 5%**，平均 < 7%；
  模型越大、序列越长开销越趋近于零。Llama-3.1-8B TPS 开销 6.85%、Phi-3-14B-128k 4.58%、
  Llama-3.1-70B −0.13%（负值源于精度损失）；TTFT 开销分别 19.03% / 18.02% / −0.41%
  `[来源: https://arxiv.org/html/2409.03992v2]`。
- **Blackwell B200（NVIDIA 官方，2026-09）**：8×B200 + DeepSeek-R1-0528-NVFP4、32K 输入/1K 输出、TP=8，
  开启 CC 后保留 CC-off 吞吐的 **96.1%–98.2%**，TPOT 仅增 **1.2%–4.3%**（并发 1–16）
  `[来源: https://developer.nvidia.com/blog/enabling-private-high-performance-production-ai-inference-with-nvidia-confidential-computing/]`。
- **工程代价（非纯性能）**：host-to-device 必须走软件加密 bounce buffer、pinned memory 失去异步优势、
  kernel autotuner 的 CUDA event 计时不稳定、B200 CC 下 NVLS multicast 不可用
  `[来源: https://developer.nvidia.com/blog/enabling-private-high-performance-production-ai-inference-with-nvidia-confidential-computing/]`。

**已知攻击**：

- **DDRop（CCS 2026）**：约 **159–200 美元**的 DDR5 内存互连器 + 服务器控制，
  可对 Intel TDX、Intel Scalable SGX、AMD SEV-SNP **重放旧的加密内存数据**，打破机密计算的内存保护保证
  `[来源: https://thehackernews.com/2026/09/new-ddrop-attack-breaks-intel-tdx-and.html]`
  `[来源: https://www.scworld.com/brief/ddrop-attack-bypasses-intel-and-amd-confidential-computing-defenses]`。
- 历史与持续侧信道：SGX 的 Foreshadow / SGAxe / ÆPIC Leak、SEV 的 SEVered、SEV-SNP 的
  CVE-2025-0033（RMPocalypse）
  `[来源: https://eco.com/support/en/articles/14796363-intel-sgx-vs-amd-sev-vs-arm-trustzone]`。

**提供机密 GPU 推理的厂商**：

| 提供方 | 形态 | 依据 |
|---|---|---|
| Azure | `NCCadsH100v5`：AMD SEV-SNP CVM + NVIDIA H100 NVL，2024-09 GA | `[来源: https://learn.microsoft.com/en-us/azure/confidential-computing/gpu-options]` |
| Google Cloud | Confidential VM 支持 H100；Confidential Space | `[来源: https://cloud.google.com/security/products/confidential-computing]` |
| Google Private AI Compute | AMD SEV-SNP + TPU，2025-11 发布 | `[来源: https://blog.google/innovation-and-ai/products/google-private-ai-compute/]` |
| AWS Nitro Enclaves | 有 LLM 推理示例，但**不支持 GPU** | `[来源: https://github.com/aws/aws-nitro-enclaves-cli/issues/517]` |
| Phala Cloud | Intel TDX + NVIDIA H100/H200，可部署 vLLM | `[来源: https://github.com/Phala-Network/phala-cloud]` |
| Tinfoil | NVIDIA CC GPU + enclave，开源 + 透明日志 + 客户端侧验签 | `[来源: https://tinfoil.sh/technology]` `[来源: https://docs.tinfoil.sh/verification/attestation-architecture]` |
| Privatemode（Edgeless Systems） | AMD EPYC + H100，开源 + 可复现构建 + 透明日志 | `[来源: https://www.privatemode.ai/]` |

**相关栈许可**：vLLM **Apache-2.0**、NVIDIA nvTrust **Apache-2.0**、Open Enclave SDK **MIT**、
Confidential Containers Trustee **Apache-2.0**、Apple swift-homomorphic-encryption **Apache-2.0**。
🔴 **Zama Concrete ML 是红灯**：仓库自述 "Clear license only for development…"，生产/商用需另行授权
`[来源: https://github.com/zama-ai/concrete-ml]`。

### 3.2 Apple Private Cloud Compute（PCC）的公开技术细节

官方文档：《Private Cloud Compute Security Guide》
`[来源: https://security.apple.com/documentation/private-cloud-compute]`；
配套源码 `github.com/apple/security-pcc` `[来源: https://github.com/apple/security-pcc]`。

**五条核心要求**：用户数据上的无状态计算、可强制执行的保证、无特权运行时访问、
不可定向性（non-targetability）、可验证透明性 `[来源: https://security.apple.com/blog/private-cloud-compute/]`。

**具体机制**：

1. **端到端加密到节点**：设备把请求直接加密给「已被验证且持有证书」的 PCC 节点公钥；
   负载均衡器、privacy gateway 等都在信任边界外，没有解密密钥
   `[来源: https://security.apple.com/blog/private-cloud-compute/]`。
2. **无状态的可强制执行**：Secure Enclave **每次重启随机化数据卷加密密钥且不持久化**，
   密码学上保证每次 SEP 重启即擦除数据卷；推理进程在请求完成时删除相关数据
   `[来源: https://security.apple.com/blog/private-cloud-compute/]`。
3. **无特权运行时访问**：节点**不含远程 shell、不含交互式调试机制、不能开启 Developer Mode**；
   不含通用日志系统，只有预先定义、经审计的结构化日志与指标可以出节点
   `[来源: https://security.apple.com/blog/private-cloud-compute/]`。
4. **不可定向性 / target diffusion**：请求元数据不含个人身份信息；用一次性凭证
   （RSA Blind Signatures, RFC 9474）授权合法请求而不绑定用户；请求经**第三方运营的 OHTTP relay
   （RFC 9458）**隐藏源 IP；设备只把请求加密给 PCC 节点的**一个子集**，单点沦陷只能解密一小部分流量
   `[来源: https://security.apple.com/blog/private-cloud-compute/]`。
5. **可验证透明性**：所有生产构建的软件镜像公开供安全研究；度量值写入**只追加、密码学防篡改的透明日志**；
   设备只向「能密码学证明自己运行的是公开列表中软件」的节点发送数据；
   镜像在进入日志后 **90 天内**或相关更新可用后（取更早者）发布；
   PCC 镜像**首次以明文包含 sepOS 固件与 iBoot 引导程序**
   `[来源: https://security.apple.com/blog/private-cloud-compute/]`。
6. **供应链与物理攻击**：制造阶段对每个服务器组件做高分辨率成像并激活防拆开关；
   到达数据中心后由多个 Apple 团队交叉核验，并有**非 Apple 的第三方观察员**监督；
   最终为每个节点签发以 Secure Enclave UID 为根的证书
   `[来源: https://security.apple.com/blog/private-cloud-compute/]`。

**2026 年的扩展**：PCC 已扩展到 **Google Cloud 的 NVIDIA GPU**（AFM 3 Cloud Pro 用），
「维持同样的隐私保证」 `[来源: https://security.apple.com/blog/expanding-pcc/]`
`[来源: https://machinelearning.apple.com/research/introducing-third-generation-of-apple-foundation-models]`。

**独立性批评（重要）**：OpenPcc 论文指出 PCC 的信任根（Apple 自研芯片 + Apple 的 Data Center
Attestation CA）与服务运营方是同一方，因此在「信任分离」上评分为 ○；PCC 虽公开镜像，
但构建流水线与相当一部分周边代码未公开，第三方能确认「在跑什么」，**不能独立复现构建**
`[来源: https://arxiv.org/html/2606.11145v1]`。

### 3.3 零知识 / 同态加密 / MPC 做推理（2026 年可行性）

**结论：对小型应用仍不可生产化。**

- **FHE**：THOR 在 HE 下做 GPU 推理，**仅约 0.2 tokens/s**
  `[来源: https://arxiv.org/html/2606.11145v1]`。2026 年一项工作把 Concrete ML 的 HE 算子注入
  Llama-3 推理流水线，声称在 i9 CPU 上达到最高 98% 文本生成准确率、237 ms 延迟、最高 80 tokens/s，
  但**只加密了部分层**，不是端到端全模型加密 `[来源: https://arxiv.org/abs/2604.12168]`。
- **MPC**：MPCFormer 用 MPC + 知识蒸馏，在 IMDb 上达到 BERT_BASE 同等效果且快 5.3×，
  GLUE 上达 97% 效果且快 2.2× `[来源: https://arxiv.org/abs/2211.01452]`；BOLT 比当时 SOTA 快 4.8–9.5×
  `[来源: https://www.computer.org/csdl/proceedings-article/sp/2024/313000a130/1Ub23O2X00U]`。
  注意这些「倍数」是相对**更慢的 MPC 基线**，绝对值仍是数秒到数十秒级，且针对 BERT 级编码器而非自回归生成。
- **ZK 用于生成式 LLM 推理**：**未找到公开信息**。
- **Nillion** 定位是 MPC/FHE 隐私计算网络（"Blind Computer"），不是 LLM 推理服务
  `[来源: https://docs.nillion.com/blind-computer/learn/overview]`；
  **IronCore Labs Cloaked AI** 面向向量嵌入的加解密，不是 LLM 推理本身
  `[来源: https://ironcorelabs.com/docs/cloaked-ai/]`。
- OpenPcc 论文的直接判断：密码学路线绕开了「信任分离」问题，但付出两处代价——
  数据非留存与用户匿名性变成事后补丁，以及性能开销使其**无法进入生产部署路径**
  `[来源: https://arxiv.org/html/2606.11145v1]`。

### 3.4 可自建的方案

- **vLLM**：Apache-2.0 `[来源: https://github.com/vllm-project/vllm]`。
  **vLLM 本身不含 TEE 支持**；在 TEE 内跑需要外部框架。
- **OpenPcc**（2026，俄亥俄州立大学）：目前最接近「可自托管的全开源机密 LLM 推理」的方案——
  Intel TDX + NVIDIA H100、CPU/GPU 复合远程证明、attestation-bound 会话、透明日志，
  在 Llama-3 8B + vLLM 上评测，声称关键路径开销为**个位数百分比**。
  ⚠️ 论文许可为 **CC BY-NC-ND 4.0**（ND + NC），**不能用于产品代码**
  `[来源: https://arxiv.org/html/2606.11145v1]`。
- **Phala Cloud / Tinfoil**：现成的托管机密推理服务，客户端 SDK 每次连接做 enclave 度量校验
  `[来源: https://docs.tinfoil.sh/verification/attestation-architecture]`；
  `tinfoil-js` 支持 OpenAI API 格式 `[来源: https://github.com/tinfoilsh/tinfoil-js]`。
- **Ollama / llama.cpp**：可自托管但**无 TEE 集成**；部署在用户自己的服务器上时，
  信任模型退化为「信任服务器管理员」（分析）。

> **对 heyta 的含义（分析）**：机密计算对 heyta 的产品形态**不现实**——它要求用户自备 H100 级机密 GPU
> 或购买机密推理服务，成本与运维复杂度远超一个任务管理应用。PCC 的**架构思路**
> （无状态、无特权访问、target diffusion、透明日志）值得借鉴，但不能照搬，也无法自托管。
> 若未来要加「云端 AI 助手」，正确做法是**客户端在本地解密后调用 LLM**，
> 并明确告知用户「该功能会把解密后的内容发送给 X 服务商」，而不是宣称服务端不可见。

---

## 板块 4 · 自托管 AI 网关

### 4.1 Nextcloud Ethical AI / 本地 AI 架构（最详细的参考实现）

**AppAPI + ExApps 模型**：ExApps = External Apps，以 Docker 容器形式安装的非 PHP 应用；
AppAPI 是必需依赖，自 Nextcloud 30.0.1 起默认安装
`[来源: https://docs.nextcloud.com/server/stable/admin_manual/exapps_management/AppAPIAndExternalApps.html]`。
安装链路：装 AppAPI → 注册 Deploy Daemon（推荐 HaRP，备选 Docker Socket Proxy）→ App Store 装 ExApp。
**硬限制**：每个 ExApp 容器只能服务一个 Nextcloud 实例，**无多租户**；不支持多 GPU 拆分；
AI 应用要求 CUDA；同 GPU 多应用时显存须容纳最大模型
`[来源: https://docs.nextcloud.com/server/stable/admin_manual/exapps_management/AppAPIAndExternalApps.html]`。

**llm2（本地 LLM ExApp）**：

- 底层 **llama.cpp**，兼容任意 **GGUF** 模型，只跑开源模型且完全 on-premises；
  随附推荐模型 **Qwen 3.5 9B**（视觉）/ **Gemma 4 E4B**（视觉 + 音频）/ **OLMo 3 7B Instruct**（纯文本，
  green Ethical AI 评级）
  `[来源: https://docs.nextcloud.com/server/stable/admin_manual/ai/app_llm2.html]`。
- 硬件要求：AppAPI ≥ 3.1.0；CPU 支持 AVX/AVX2；CUDA ≥ 12.4；
  **GPU 路径：≥ 8GB VRAM + ≥ 12GB 系统 RAM**；
  **CPU 路径：≥ 12GB RAM，推荐 10–20 核**，且「默认会吃满所有核心，通常最好跑在另一台机器上」
  `[来源: https://docs.nextcloud.com/server/stable/admin_manual/ai/app_llm2.html]`。
- 多语言：Qwen 3.5 支持 **201 种语言**；Gemma 4 高质量支持 35 种、基础支持 140 种
  `[来源: https://docs.nextcloud.com/server/stable/admin_manual/ai/app_llm2.html]`。
- **许可：MIT** `[来源: https://github.com/nextcloud/llm2]`。

**Context Chat（ctx）**：

- `context_chat`（PHP）+ `context_chat_backend`（Python ExApp）两件套，主次版本必须匹配；
  **所有用户文本被复制、分块、存入自带 PostgreSQL 向量库并生成 embedding**；
  embedding 服务可用 `CC_EM_BASE_URL` 指向任意 OpenAI 兼容 API，但**安装后不可更换**
  （换模型需卸载清库重装）
  `[来源: https://docs.nextcloud.com/server/stable/admin_manual/ai/app_context_chat.html]`。
- 规模：GPU ≥ 2GB VRAM + ≥ 8GB RAM；CPU ≥ 12GB RAM + 4 核以上；文件 > 100MB 不支持；
  **不遵守 `files_accesscontrol` 规则**（被拒文件仍可经 Context Chat 访问）；不支持多租户
  `[来源: https://docs.nextcloud.com/server/stable/admin_manual/ai/app_context_chat.html]`。
- **许可：AGPL-3.0** 🔴 `[来源: https://github.com/nextcloud/context_chat_backend]`。

**Context Agent**：把 Calendar / Tasks / Files / Mail / Talk / Deck / Contacts / Search / Share 等
暴露为 agent 工具（含「建任务」「改优先级」「改截止日」等 Tasks 工具），
并同时把全部工具暴露为 **MCP server**：
`https://<domain>/index.php/apps/app_api/proxy/context_agent/mcp/`，用 app password 作 Bearer；
仅支持远程 streamable_http，且**不支持每用户不同 token**
`[来源: https://docs.nextcloud.com/server/stable/admin_manual/ai/app_context_agent.html]`。
要求模型支持 tool calling。**许可：AGPL-3.0** 🔴 `[来源: https://github.com/nextcloud/context_agent]`。

**Ethical AI Rating**（值得借鉴的产品化设计）：四档 Red / Orange / Yellow / Green，
基于 3 个因子——软件（推理 + 训练）是否 FOSS、模型是否可自由自托管、训练数据是否公开；
满足 3 项 = Green，2 = Yellow，1 = Orange，0 = Red；Green 还要求「数据留在本地」
`[来源: https://docs.nextcloud.com/server/stable/admin_manual/ai/overview.html]`。
具体评级：llm2 = Green；integration_openai 走 OpenAI API = **Red**、走 LocalAI = Green、走 Ollama = Yellow；
stt_whisper2 = Yellow；context_chat = Yellow；context_agent = Green
`[来源: https://docs.nextcloud.com/server/stable/admin_manual/ai/overview.html]`。

**integration_openai（关键 BYOM 证据）**：可连接**任意数量**的 OpenAI 兼容服务；
**可设 base URL、API key 或 basic auth**；按服务 + 模态选择暴露哪些模型；可配每服务配额。
README 明说除 OpenAI 外可接 self-hosted LocalAI、Ollama，或「任何实现类似 OpenAI API 的服务」，
并要求用其 **OpenAI 兼容端点**而非自定义端点
`[来源: https://github.com/nextcloud/integration_openai]`。**许可：AGPL-3.0** 🔴。

**开源 vs 企业**：上述应用均可从 App Store 免费下载（llm2 MIT，其余 AGPL-3.0）；
企业侧卖的是支持、K8s 部署文档与客户支持
`[来源: https://docs.nextcloud.com/server/stable/admin_manual/ai/app_context_chat.html]`。
Nextcloud 服务端与 all-in-one 均为 AGPL-3.0 `[来源: https://github.com/nextcloud/server]`。

> ⚠️ **与 E2EE 的根本冲突（分析）**：Context Chat 的设计前提是**服务端能看到明文**——
> 它把所有用户文本复制、分块、写进自带向量库。heyta 的服务端设计上看不到明文，
> 因此 **RAG 与向量库只能放在客户端**（或用户自建的、持有明文的旁路服务）。
> 可借鉴的是它的**接口分层**（原始能力 / provider / 前端解耦）、**Ethical AI 分级标签**、
> 以及「管理员显式选 provider + 配额」，**不是它的数据流**。

### 4.2 Immich 的 CLIP 本地搜索

- 搜索库即 **Postgres**；上下文 CLIP 搜索由 **VectorChord** 扩展驱动
  `[来源: https://docs.immich.app/features/searching/]`。
- 架构五件套：`immich-server`、`immich-microservices`、`immich-machine-learning`（Python + FastAPI）、
  `postgres`、`redis`(BullMQ)；**ML 全部外置到独立容器**，可跑在另一台机器或直接禁用
  `[来源: https://docs.immich.app/developer/architecture]`。
- **所有模型均为 ONNX 格式**；按请求下载/加载/配置，已加载模型缓存复用，线程池处理避免阻塞事件循环
  `[来源: https://docs.immich.app/developer/architecture]`。
- 官方实测（7800X3D 裸机 Linux，f32，无加速）
  `[来源: https://docs.immich.app/features/searching/]`：

  | 模型 | 峰值 RSS | 单次耗时 | 英文 recall |
  |---|---|---|---|
  | `ViT-B-32__openai`（默认） | 1004 MiB | **2.26 ms** | 69.90% |
  | `ViT-SO400M-16-SigLIP2-384__webli` | 3854 MiB | 56.57 ms | 85.99% |
  | `nllb-clip-large-siglip__v1`（多语言） | 4226 MiB | 75.05 ms | 中文场景 79.7% |

- 硬件加速后端：**ARM NN**(Mali)、**CUDA**(算力 ≥ 5.2，驱动 ≥ 545 / CUDA 12.3，需 NVIDIA Container Toolkit)、
  **OpenVINO**(Intel)；镜像 tag 另支持 rocm / rknn；支持 Remote ML
  `[来源: https://docs.immich.app/features/ml-hardware-acceleration/]`
  `[来源: https://docs.immich.app/guides/remote-machine-learning]`。
- 最低系统要求 6GB RAM + 2 核 `[来源: https://docs.immich.app/overview/quick-start/]`。
- **许可：AGPL-3.0** 🔴 `[来源: https://github.com/immich-app/immich]`。
- 「Immich AI」作为独立产品：**未找到公开信息**（文档中的智能搜索即上述 ML 微服务）。

### 4.3 Home Assistant 的 AI / Assist

- Assist pipeline = 唤醒词 + STT + conversation agent + TTS，**可全本地**
  `[来源: https://www.home-assistant.io/voice_control/voice_remote_local_assistant/]`。
  本地 STT：**Speech-to-Phrase**（HA Green / 树莓派 4 上 < 1 秒，但仅覆盖部分指令）与
  **Whisper**（树莓派 4 约 8 秒，Intel NUC < 1 秒）；本地 TTS：**Piper**（树莓派 medium 模型
  每秒可生成 1.6 秒语音）`[来源: https://www.home-assistant.io/voice_control/voice_remote_local_assistant/]`。
- **Wyoming 协议**：HA 2023.5 引入，IoT class = Local Push，覆盖率 **9.1%** 活跃安装
  `[来源: https://www.home-assistant.io/integrations/wyoming/]`。
  `wyoming` / `wyoming-piper` / `wyoming-satellite` 均 **MIT**
  `[来源: https://raw.githubusercontent.com/rhasspy/wyoming/main/LICENSE.md]`；
  ⚠️ 但 **Piper 本体现为 GPL-3.0**（OHF-Voice/piper1-gpl），与 MIT 的 Wyoming 包装层是两回事 🔴
  `[来源: https://raw.githubusercontent.com/OHF-Voice/piper1-gpl/main/COPYING]`。
- **Ollama 集成**（2024.4 引入，2.2% 安装量）：提供 conversation agent，配置项为 URL
  （如 `http://localhost:11434`）、**可选 API key**、模型名、instructions、是否允许控制 HA（实验性）、
  context window（HA 默认 8k，Ollama 默认 2k）、keep_alive（默认 -1）、think；IoT class = Local Polling
  `[来源: https://www.home-assistant.io/integrations/ollama/]`。
  只有支持 Tools 的模型能控制 HA，官方建议暴露 **< 25 个实体**，且**小模型易出错**
  `[来源: https://www.home-assistant.io/integrations/ollama/]`。
- 隐私表述：官方博客明确「用户对如何、何时使用 AI 有完全控制权」，「这一切都可以在本地运行，
  **没有任何数据离开你的家**」；「如果用户不想要 AI，那是他们的选择，可以选择不启用任何这些功能」
  `[来源: https://www.home-assistant.io/blog/2025/09/11/ai-in-home-assistant/]`。
- **许可**：home-assistant/core **Apache-2.0** `[来源: https://raw.githubusercontent.com/home-assistant/core/master/LICENSE.md]`。
- ⚠️ **已验证的生态缺口**：HA 的 OpenAI 集成**明确拒绝第三方 endpoint**，Ollama 集成又走 `/api/chat`
  而非 `/v1/chat/completions`，导致 llama.cpp / vLLM / LM Studio / LocalAI 用户只能靠 HACS 自定义组件
  `[来源: https://github.com/orgs/home-assistant/discussions/3398]`。
  → 说明「客户端直接支持任意 OpenAI 兼容端点」在 2026 年**仍是差异化能力，而非标配**（分析）。

### 4.4 其他「自带 LLM 服务器」产品

| 产品 | 集成形态 | 许可 |
|---|---|---|
| **Karakeep**（前 Hoarder） | AI 打标 + 摘要用 LLM，语义搜索用 embedding；支持 OpenAI 兼容与 Ollama。配置即 `OPENAI_BASE_URL` + `OPENAI_API_KEY`（Ollama 用 `http://host:11434/v1`），或 `OLLAMA_BASE_URL`；官方**推荐 OpenAI 兼容端点**而非 Ollama 原生 API；换 embedding 模型/维度必须全量重建 `[来源: https://docs.karakeep.app/configuration/different-ai-providers/]` | **AGPL-3.0** 🔴 |
| **Paperless-ngx** | 内置 AI 可建议标题/通信方/文档类型/标签，走 OpenAI 兼容或 Ollama `[来源: https://server.camp/docs/en/services/paperless-ngx/paperless-ai/]` | **GPL-3.0** 🔴 |
| **Obsidian Smart Connections** | 默认本地 embedding 用 HuggingFace transformers.js 本地算 `[来源: https://smartconnections.app/smart-principles/]` | Smart Plugins License（source-available，**非 OSI**，含竞争限制）🔴 |
| **Joplin** | 未见内建 AI 网关 | **MIT** ✅ `[来源: https://github.com/laurent22/joplin]` |
| **Actual Budget** | 内建 LLM 功能**未找到公开信息** | **MIT** ✅ |
| **Standard Notes** | 内建 AI 集成**未找到公开信息** | **AGPL-3.0** 🔴 |
| **Vaultwarden / Bitwarden** | 无 LLM 网关；价值在**密钥存储形态**（客户端派生、服务端永不见明文）`[来源: https://bitwarden.com/help/bitwarden-security-white-paper/]` | Vaultwarden **AGPL-3.0** 🔴；Bitwarden server 默认 **AGPL-3.0**，部分文件 Bitwarden License v1.0 🔴 |

### 4.5 OpenAI 兼容 API 已成为事实标准

- Ollama 自 2024-02 起内建 OpenAI Chat Completions 兼容
  `[来源: https://ollama.com/blog/openai-compatibility]`；
  vLLM 提供 OpenAI 兼容 server，客户端可直接用 openai SDK
  `[来源: https://docs.vllm.ai/en/latest/serving/online_serving/]`；
  llama.cpp server 用 `base_url=http://localhost:8080/v1`、api_key 可任意；
  LM Studio server 模式与 LocalAI 同理。
- **GenieX 也在 localhost 暴露 OpenAI 兼容 API**，让「现有 OpenAI 客户端换 base URL 即可」
  `[来源: https://www.qualcomm.com/developer/blog/2026/06/geniex-developer-preview]`。
- **LiteLLM**：把 100+ provider 收敛成单个 OpenAI 兼容接口；许可证为 **MIT，但 `enterprise/` 目录除外**
  `[来源: https://github.com/BerriAI/litellm]`。Virtual key 模型：需 Postgres + `sk-` master key，
  `POST /key/generate` 生成可限定 `models` / `aliases` / `duration` 的虚拟 key，
  spend 按 key/user/team 记录 `[来源: https://docs.litellm.ai/docs/proxy/virtual_keys]`。

> **对 heyta 的含义（分析）**：网关契约可以标准化为**三项**——base URL + 可选 API key + 模型名，
> 路径 `/v1/chat/completions`。所有被调研产品（Karakeep、Obsidian Copilot、Nextcloud
> integration_openai、GenieX、Ollama、vLLM）都是这个形状，因此客户端 UI 只需这三个字段
> + 一个「测试连接」按钮。

---

## 板块 5 · 数据最小化模式

### 5.1 有明确数据最小化策略的产品

**(a) Apple Intelligence —— 「识别必要数据」的官方表述 + 透明度日志**

- 官方隐私声明原文：「Apple Intelligence 使用你设备上的信息（包括跨 App 的信息，如即将到来的日历事件），
  并被设计为**识别为协助生成模型所必需的数据，而不要求 Apple 访问或存储个人数据**」
  `[来源: https://www.apple.com/legal/privacy/data/en/intelligence-engine/]`。
- 「在很多情况下，Apple Intelligence 模型完全在设备上运行，任务完成时数据不离开设备」；
  需要更强算力时才发给 PCC，且「在 PCC 中处理的数据**不被存储、Apple 无法访问**，
  仅用于完成请求，之后结果安全返回设备且不被 PCC 保留」
  `[来源: https://www.apple.com/legal/privacy/data/en/intelligence-engine/]`。
- **数据出境提示的 UI 范式（可直接借鉴）**：用户可以开启
  **「Apple Intelligence & PCC Report」**（设置 → 隐私与安全性 → Apple Intelligence & PCC Report），
  选择报告时间范围，之后**导出一个文件**，其中列出**所有离开设备并由 PCC 处理的请求**
  （含来自 watchOS 的请求）；若启用了 Apple Intelligence Extensions，
  还会包含发给扩展的请求 `[来源: https://www.apple.com/legal/privacy/data/en/intelligence-engine/]`。
  → 这是目前最完整的「本地优先 + 可审计出境」产品化范式（分析）。
- Apple 还声明：走 PCC 或 PIR 时会收集**有限的元数据**（请求/响应的近似大小、使用了哪些功能、
  耗时），但**不含任何请求内容或返回结果的信息**，且不与 Apple Account 关联
  `[来源: https://www.apple.com/legal/privacy/data/en/intelligence-engine/]`。

**(b) Google Messages Magic Compose —— 明确「只用最近 20 条」**

- 官方支持页原文：「使用 Magic Compose 时，**你的所有数据都私密地留在设备上**」；
  「带附件、语音消息和图片的消息**不用于**生成建议，但图片说明和语音转写可以用于生成」
  `[来源: https://support.google.com/messages/answer/13632636?hl=en]`。
- **明确的窗口式最小化**：「为生成消息建议，模型使用**之前 20 条消息**作为上下文；
  为生成改写建议，模型只使用**一条草稿消息**」
  `[来源: https://support.google.com/messages/answer/13632636?hl=en]`。
- 也明确「Google 不存储消息、不用它们训练 ML 模型」，「数据在你的手机上处理、不离开设备、
  **不向 Google 发送任何消息**」`[来源: https://support.google.com/messages/answer/13632636?hl=en]`。
- ⚠️ 反例对照：有报道指出 Magic Compose 早期版本会**破坏 E2EE**，因为要把最近最多 20 条消息
  发到 Google 服务器 `[来源: https://www.androidpolice.com/magic-compose-google-messages-beta-supercharge-conversations/]`
  ——说明「本地处理」这个承诺本身需要被审计（分析）。

**(c) Proton Lumo —— 零访问加密 + 不记录**

- 「与 Lumo 的所有对话都以**零访问加密**存储，因此没有人（包括 Proton）能访问它们」
  `[来源: https://proton.me/lumo]`。
- 对比表中自称：不用你的数据训练 AI、不记录聊天、无法与任何人分享你的数据、无广告商业模式、
  位于高隐私司法辖区、**开源代码供公众验证**
  `[来源: https://proton.me/lumo]`。
- 第三方分析：Lumo 不在服务端存聊天日志、会话数据立即删除、不使用数据训练
  `[来源: https://halfbitstudio.com/en/analiza-lumo-proton-prywatnosciowy-gambit-ai/]`。
- ⚠️ 注意：Lumo 是**云端推理**（不是端侧），它的隐私承诺建立在零访问加密 + 不记录之上，
  而非「数据不离开设备」——这与端侧方案是**不同性质的保证**（分析）。

**(d) 反面对照：不采用最小化的主流产品**

- **Notion AI**：「当你使用 AI 写作、摘要、翻译或问答时，**你的提示与相关页面内容会被发送给第三方
  AI 提供商**」，Notion 公开说明其 AI 基础设施伙伴为 OpenAI 与 Anthropic
  `[来源: https://wisechecker.com/notion-ai-privacy-data-usage/]`；
  Notion 官方 AI 安全实践页 `[来源: https://www.notion.com/help/notion-ai-security-practices]`。
- **Todoist**：明确把 AI 跑在自家基础设施上
  `[来源: https://www.todoist.com/todoist-assist]`。
  → 这两家都是「本地优先 / E2EE 的**反例**」，可作为 heyta 定位差异化的参照（分析）。

### 5.2 有没有产品**明确用「只给当前这一条」来降低隐私风险**？

**部分有，但没有找到把它命名为「数据最小化策略」并系统宣传的产品。** 公开可查的具体做法是：

- **Google Messages Magic Compose**：明确的窗口式约束（改写只用 1 条草稿；建议用 20 条）
  `[来源: https://support.google.com/messages/answer/13632636?hl=en]`。
- **Apple Intelligence**：「识别为协助生成模型所必需的数据」，并在 UI 层提供出境报告
  `[来源: https://www.apple.com/legal/privacy/data/en/intelligence-engine/]`。
- **Home Assistant**：把「暴露哪些实体给 Assist」做成显式配置，官方建议 **< 25 个实体**，
  即「不把整个家居数据给模型，只给被显式暴露的那部分」
  `[来源: https://www.home-assistant.io/integrations/ollama/]`。
- **Nextcloud Context Agent**：把哪些 App 暴露为 agent 工具做成管理配置项
  `[来源: https://docs.nextcloud.com/server/stable/admin_manual/ai/app_context_agent.html]`。
- **AI consent 的 UX 模式库**：Shape of AI 的 Consent 模式页把「在把数据分享给 AI 之前先取得同意」
  作为独立设计模式（含信任建立、责任保护、伦理体验三个目标）
  `[来源: https://www.shapeof.ai/patterns/consent]`；
  另有面向浏览器内 AI 的 consent UX 设计分析
  `[来源: https://medium.com/@duckweave/designing-trust-consent-ux-for-browser-ai-75001556351a]`。
- **明确以「最小化」为名解释给用户的产品级文案**：**未找到公开信息**。

> **对 heyta 的含义（分析）**：heyta 完全可以把「只发这一条」做成**可验证的产品承诺**而不是营销话术：
> (1) 解析一句话只发送那句话，不发送清单结构、不发送历史任务；
> (2) 需要上下文时（如「把这段会议记录拆成任务」）由用户在 UI 上**显式选择范围**，
> 并显示将发送的确切字符数与目标端点；
> (3) 提供类似 Apple 的「出境报告」——本地记录每一次外发请求的时间、目标、字节数与用途，
> 用户可导出。这一层在 heyta 里是纯本地能力，不需要服务端配合。

---

## 板块 6 · MCP / Agent 接口

### 6.1 MCP 现状（2026）

**治理**：2025-12-09，Anthropic 把 MCP 捐赠给 Linux Foundation 新成立的
**Agentic AI Foundation（AAIF）**，与 Block、OpenAI 共同创立
`[来源: https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation]`
`[来源: https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation]`。
OpenAI 同期共同创立 AAIF 并捐赠 AGENTS.md `[来源: https://openai.com/index/agentic-ai-foundation/]`。

**规范版本时间线**：

| 版本 | 关键变化 |
|---|---|
| 2024-11-05 | 首发；HTTP+SSE 传输 |
| 2025-03-26 | 引入 Streamable HTTP，HTTP+SSE 标记 deprecated |
| 2025-06-18 | 授权改为强制 RFC 9728 Protected Resource Metadata |
| 2025-11-25 | 实验性 Tasks 原语；OAuth 强化 `[来源: https://modelcontextprotocol.io/specification/2025-11-25/changelog]` |
| **2026-07-28** | **最大一次修订，含破坏性变更** `[来源: https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/]` |

**2026-07-28 的关键变更**（RC 于 2026-05-21 锁定）`[来源: https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/]`：

- **协议层无状态化**：移除 `initialize`/`initialized` 握手（SEP-2575）与 `Mcp-Session-Id`（SEP-2567），
  新增 `server/discover`；协议版本与 client info 改由每次请求 `_meta` 携带。
  远程 server 可跑在普通轮询负载均衡后。
- **Extensions 成为一等公民**（SEP-2133）；**MCP Apps**（SEP-1865）：server 可下发沙箱 iframe 渲染的 HTML UI。
- **Tasks 从核心降级为扩展**，生命周期改为 `tasks/get` / `tasks/update` / `tasks/cancel`，移除 `tasks/list`。
- **Roots / Sampling / Logging 弃用**（SEP-2577），弃用期 12 个月。
- Tool schema 升级到完整 **JSON Schema 2020-12**（SEP-2106）。
- 运维可观测：强制 `Mcp-Method` / `Mcp-Name` 头（SEP-2243）、列表结果带 `ttlMs` / `cacheScope`（SEP-2549）、
  `_meta` 中 W3C Trace Context（SEP-414）。

**传输**：支持 **stdio** 与 **Streamable HTTP**；HTTP+SSE 自 2025-03-26 起 deprecated
`[来源: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports]`。

**授权**：受保护的 MCP server 扮演 **OAuth 2.1 resource server**；授权服务器 MUST 实现 OAuth 2.1，
公共客户端强制 PKCE；客户端 MUST 用 RFC 9728 做授权服务器发现；401 通过
`WWW-Authenticate: Bearer resource_metadata="..."` 暴露元数据端点
`[来源: https://modelcontextprotocol.io/specification/draft/basic/authorization]`。

**许可**：MCP 规范与官方 SDK **正从 MIT 迁移到 Apache-2.0**
`[来源: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/LICENSE]`。
两者都在 heyta 白名单内 ✅。

### 6.2 任务管理产品的 MCP server 案例

| 产品 | 官方/社区 | 端点与认证 | 读写 | 许可 |
|---|---|---|---|---|
| **Todoist** | **官方** | `https://ai.todoist.net/mcp`，OAuth；官方 CLI `@doist/todoist-cli`，token 存 OS 凭据管理器，支持 `--read-only` | 读+写（单次最多 25 条任务） | 官方仓库开源 `[来源: https://github.com/Doist/todoist-mcp]` |
| **Linear** | **官方** | OAuth（每次会话认证） | 读+写 `[来源: https://linear.app/docs/mcp]` | 未找到公开信息 |
| **Notion** | **官方** | 托管 Remote MCP，OAuth only，自动继承用户既有 Notion 权限；另有自托管 `makenotion/notion-mcp-server` | 读+写 `[来源: https://developers.notion.com/guides/mcp/overview]` | 自托管仓库开源 `[来源: https://github.com/makenotion/notion-mcp-server]` |
| **Asana** | **官方** | V1 beta（`mcp.asana.com/sse`）已弃用，关停延至 **2026-08-05**；V2 于 2026-02-04 GA | 读+写 `[来源: https://developers.asana.com/docs/integrating-with-asanas-mcp-server]` | 未找到公开信息 |
| **Jira / Atlassian** | **官方** | 云端托管 Remote MCP（Rovo），OAuth | 读+写 `[来源: https://www.atlassian.com/platform/rovo-mcp]` | 未找到公开信息 |
| **ClickUp** | **官方** | `https://mcp.clickup.com/mcp`，public beta，**仅 OAuth**——明确不支持自带 API key | 读+写 `[来源: https://developer.clickup.com/docs/connect-an-ai-assistant-to-clickups-mcp-server]` | 未找到公开信息 |
| **TickTick / 滴答清单** | **官方** | `https://mcp.ticktick.com`，Streamable HTTP，OAuth **或** Bearer Token；**不支持 SSE**；约 40 个工具（任务/清单/标签/评论/指派/习惯打卡/专注记录/倒计时） | 读+写 `[来源: https://help.ticktick.com/articles/7438129581631995904]` `[来源: https://help.dida365.com/articles/7438132116019216384]` | 未找到公开信息 |
| **GitHub Projects** | **官方** | 官方 GitHub MCP Server，2025-10-14 起支持 Projects | 读+写 `[来源: https://github.blog/changelog/2025-10-14-github-mcp-server-now-supports-github-projects-and-more/]` | 未找到公开信息 |
| **Apple Reminders** | **社区** | 本地 macOS，AppleScript 驱动 | 读+写 `[来源: https://github.com/dbmcco/apple-reminders-mcp]` | 社区仓库 |
| **Things 3 / OmniFocus** | **未找到公开信息**（未发现官方 MCP server） | — | — | — |

**要点（分析）**：一线任务管理产品（Todoist / Linear / Notion / Asana / Atlassian / ClickUp / TickTick）
**全部已官方出货 MCP server**，认证**清一色 OAuth 2.1**；ClickUp 明确拒绝 API key 认证，
TickTick 是唯一同时提供 OAuth 与 Bearer Token 的。**Apple 生态只有社区 AppleScript 方案。**

### 6.3 「不做 AI，只做 AI 的接口」策略的利弊

**Pros（有公开依据）**：

- **分发红利**：MCP 被视为新的分发渠道，Stripe、Shopify、Datadog 已出货；
  有分析称 MCP SDK 月下载量达 9700 万、活跃 server 超 1 万
  `[来源: https://www.figuringoutwithai.com/playbooks/mcp-servers-new-distribution-channel-business-2026]`。
- **免于自建模型 / 推理成本**：AI 体验交给用户自己的客户端，产品侧只维护接口。
- **与 E2EE 天然契合（分析）**：MCP server 若跑在**客户端本地**（stdio / localhost），
  明文根本不出设备，服务端依旧只见密文——这是 heyta 场景下 MCP 最自然的形态。

**Cons（有公开依据）**：

- **成本被低估**：有分析称 demo 一个周末，生产级 server 需数月，年维护 5 万–15 万美元
  `[来源: https://www.institutepm.com/knowledge-hub/saas-mcp-server-strategy]`。
- **曝光 ≠ 被使用**：agent 只从 tool description 做决策，基础设施优雅与否无关
  `[来源: https://medium.com/@ai_transfer_lab/the-mcp-server-nobody-uses-3bc7e50fbd4e]`。
- **护城河反被侵蚀**：有分析认为 MCP 正在压低「数据+模型」型 SaaS 的分发成本结构
  `[来源: https://dev.to/connerlambden/mcp-is-quietly-commoditizing-datamodel-saas-moats-the-structural-case-3j7p]`。
- **设计原则**：SpecterOps 明确提出 **「MCP server 不是 REST API 的包装层」**，
  工具必须围绕 agent 意图而非后端实现来塑造
  `[来源: https://specterops.io/blog/2026/07/28/designing-an-mcp-server-for-ai-agents-bloodhound-hunter/]`。

**厂商自述**：「我们不做 AI，只做 AI 的好工具」这类明确表态
**未找到公开信息**（未找到 Todoist / Linear / Notion 的此类公开表述）。

### 6.4 MCP 安全问题

- **攻击类型**：Invariant Labs 于 2025-04-01 公开 **Tool Poisoning Attack**——恶意 server 在
  tool description 中嵌入隐藏指令
  `[来源: https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks]`。
- **真实事件**（CSA 汇总）：Asana 跨租户数据暴露、针对 GitHub MCP server 的提示注入、
  Anthropic 自家 MCP Inspector 的未认证 RCE（CVE-2025-49596，**CVSS 9.4**）、
  多起恶意 npm 包供应链投毒
  `[来源: https://labs.cloudsecurityalliance.org/agentic/agentic-mcp-security-best-practices-v1/]`。
- **Rug pull**：server 可在授权后静默修改 tool 定义，多数客户端不检测
  `[来源: https://www.truefoundry.com/blog/mcp-security-risks-best-practices]`。
- **当前缓解**：官方安全最佳实践
  `[来源: https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices]`；
  **NSA 发布 CSI 建议签名并校验 MCP 消息**（目前仅依赖 TLS）
  `[来源: https://www.nsa.gov/Portals/75/documents/Cybersecurity/CSI_MCP_SECURITY.pdf]`；
  Invariant 开源 `mcp-scan` 检测被投毒的 description；OWASP Top 10 for Agentic Applications (2026)
  把 tool poisoning 归入 ASI01 Agent Goal Hijack
  `[来源: https://labs.cloudsecurityalliance.org/agentic/agentic-mcp-security-best-practices-v1/]`。

> **对 heyta 的含义（分析）**：若 heyta 做 MCP，应直接按 **2026-07-28 无状态规范**设计
> （无 session、`Mcp-Method` 头、`ttlMs` 缓存），否则会按 2025-11-25 的会话模型返工。
> 安全上必须做**逐工具 allowlist + 默认拒绝 + 写操作显式确认**——
> 对一个 E2EE 任务应用，MCP 的写权限等于「让第三方 agent 直接改你的 op-log」，
> 风险等级与密码管理器同级。

---

## 板块 7 · 自托管 / 本地优先产品如何「把数据交还给用户」

### 7.1 任务 / 生产力类自托管产品的 API 与数据出口策略

| 产品 | API 形态 | 鉴权 | 限流 / 文档质量 | 许可 |
|---|---|---|---|---|
| **Nextcloud** | **OCS REST API**（shares/users/groups/capabilities/status/notifications/activities）+ **WebDAV** 文件访问 `[来源: https://docs.nextcloud.com/server/stable/developer_manual/client_apis/OCS/ocs-api-overview.html]` | 每请求需鉴权（app password / basic）`[来源: 同上]` | **有真实限流**：NC 30.0.10 起 share 创建限 20 次/10 分钟，用户会遇到 429 `[来源: https://help.nextcloud.com/t/429-too-many-request-using-share-api-nc31-oc-ratelimit-entries-involved/224039]`；OCS 响应曾存在限流未生效的安全公告 `[来源: https://github.com/nextcloud/security-advisories/security/advisories/GHSA-48rx-3gmf-g74j]` | AGPL-3.0 🔴 |
| **Immich** | **OpenAPI 规范生成的 REST API**，官方文档站 `api.immich.app` `[来源: https://docs.immich.app/api]` | 支持 session / shared key / **API key** 三种；第三方应用被鼓励用 API key `[来源: https://api.immich.app/authentication]` | 2025-09 重构了 API 文档站，增加鉴权、授权、**API key 权限**、请求/响应格式与命令面板 `[来源: https://immich.app/blog/immich-api-documentation]` | AGPL-3.0 🔴 |
| **Home Assistant** | **REST API** + **WebSocket API** `[来源: https://developers.home-assistant.io/docs/api/rest/]` | **Long-Lived Access Token**，在 profile 页生成 `[来源: https://developers.home-assistant.io/docs/api/rest/]` | 文档为开发者文档，覆盖 REST 与 WebSocket 两套 `[来源: 同上]` | Apache-2.0 ✅ |
| **Vaultwarden / Bitwarden** | ⚠️ **Vaultwarden 不支持 Bitwarden Public API**（仅少数例外），只支持**客户端 API**（两者不同）`[来源: https://github.com/dani-garcia/vaultwarden/discussions/4241]`；Bitwarden 官方有 Public API 与 Vault Management API，用于管理成员/集合/组/事件日志/策略 `[来源: https://bitwarden.com/help/bitwarden-apis/]` | 组织级 API key | 文档分散；社区反复询问边界 `[来源: https://vaultwarden.discourse.group/t/api-basics-how-to-pull-a-password/2736]` | Vaultwarden AGPL-3.0 🔴 / Bitwarden server AGPL-3.0 🔴 |
| **Obsidian** | **Local REST API 社区插件**：本地 HTTPS + API key，端口默认 27124、host 默认 127.0.0.1 `[来源: https://github.com/coddingtonbear/obsidian-local-rest-api]` | **本地自签证书 + API key** `[来源: 同上]` | 插件同时提供 MCP 入口 `[来源: https://community.obsidian.md/plugins/obsidian-local-rest-api]` | 插件仓库开源（未逐字核验 LICENSE） |
| **Anytype** | **Local API**（桌面版内置，**完全跑在 localhost、完全离线**）；OpenAPI 规范 + 开发者门户 `[来源: https://doc.anytype.io/anytype/features/integrations/local-api]` | **4 位挑战码认证一次，生成 bearer API key**；可在 Vault Settings → Data Management → API Keys 生成/吊销多个 key `[来源: 同上]` | 早期 SDK 生态：Python / Go 客户端、**MCP server**、Raycast 扩展 `[来源: 同上]`。⚠️ 官方安全提示：「提供 API key 或使用扩展，即授予对 vault 的有限访问权限（可编辑/删除对象），**请只使用可信扩展**」`[来源: 同上]` | 协议 MIT；应用为 Any Source Available License 1.0（非商业限定）`[来源: https://github.com/anyproto/anytype-ts]` |
| **Logseq** | **HTTP API server**（需在设置中开启 Developer mode + API）；另有 Plugin API `[来源: https://github.com/logseq/logseq/blob/master/resources/docs/api_server.html]` `[来源: https://plugins-doc.logseq.com/]` | 本地端口 + token | 社区反馈「文档不太直观」`[来源: https://wiki.jamesravey.me/books/software-misc/page/logseq-http-api]` | Logseq 许可**未找到公开信息**（本次未核验） |

**共性（分析）**：自托管产品的 API 出口有**三种可区分的形态**——
(1) **服务端 REST/WebDAV**（Nextcloud、Immich、Home Assistant、Bitwarden）：数据在服务端**已是明文**
（Immich/HA 没有 E2EE），因此 API 出口不引入新的信任问题；
(2) **本地 localhost API**（Anytype、Obsidian Local REST API、Logseq）：进程与用户数据同机，
**用 localhost 绑定 + 本地证书 + API key 把暴露面收敛到本机**；
(3) **完全不做通用 API**（Standard Notes 内建 AI 与通用 API 均未找到公开信息）。
**heyta 属于 (2) 这一类的天然候选**——它已有本地 SQLite 与解密后的明文，本地 API 不需要服务端配合。

### 7.2 MCP 现状与任务管理 MCP server

见板块 6（6.1–6.4），此处不重复。要点：**2026-07-28 是无状态化的破坏性版本**；
一线任务管理产品**全部已官方出货 MCP server**，认证统一 OAuth 2.1；
自托管产品暴露 MCP server 的案例有 **Nextcloud Context Agent**
（`/index.php/apps/app_api/proxy/context_agent/mcp/`，app password 作 Bearer，仅 streamable_http，
**不支持每用户不同 token**）`[来源: https://docs.nextcloud.com/server/stable/admin_manual/ai/app_context_agent.html]`，
以及 **Anytype MCP server**（社区/早期生态）`[来源: https://doc.anytype.io/anytype/features/integrations/local-api]`。

### 7.3 「本地优先 + 用户自带 AI」的架构模式

**模式定义**：客户端把**本地明文**喂给**用户自己的** AI 端点（本地 Ollama，或用户自己的云 Key），
**不经过产品方的服务器**。

**采用该模式的产品**：

| 产品 | 端点形态 | 密钥存放 | 许可 |
|---|---|---|---|
| **Obsidian Copilot** | BYOK 面板可加云端 / 本地 / **OpenAI 兼容** endpoint；支持 Ollama、LM Studio | **本机 Obsidian Keychain**，不写进 vault 的 `data.json` `[来源: https://github.com/logancyang/obsidian-copilot]` | AGPL-3.0 🔴 |
| **Obsidian Smart Connections** | 默认本地 embedding 用 transformers.js 在本地算 `[来源: https://smartconnections.app/smart-principles/]` | 不适用（无云） | 非 OSI 🔴 |
| **Karakeep** | `OPENAI_BASE_URL` + `OPENAI_API_KEY`，或 `OLLAMA_BASE_URL`；官方**推荐 OpenAI 兼容端点** `[来源: https://docs.karakeep.app/configuration/different-ai-providers/]` | 服务端 env（自托管） | AGPL-3.0 🔴 |
| **Nextcloud integration_openai** | 可设 **base URL + API key 或 basic auth**，接任意数量 OpenAI 兼容服务 `[来源: https://github.com/nextcloud/integration_openai]` | 服务端 | AGPL-3.0 🔴 |
| **Raycast AI** | per-provider BYOK，直连 provider 计费 `[来源: https://manual.raycast.com/ai/bring-your-own-key]` | 本机设置 | 闭源 |
| **BoltAI** | BYOK 默认，不代理 `[来源: https://docs.boltai.com/blog/how-boltai-handles-your-api-keys]` | Apple Keychain（AES-256）+ 可选 passphrase | 闭源 |
| **Home Assistant** | Ollama 集成：URL + **可选 API key** + 模型名 + 是否允许控制 HA `[来源: https://www.home-assistant.io/integrations/ollama/]` | HA 配置 | Apache-2.0 ✅ |
| **Enchanted** | 面向 Ollama 的 iOS/macOS 客户端 `[来源: https://github.com/gluonfield/enchanted]` | 不适用 | 开源（未逐字核验） |

**它们怎么向用户解释数据流向**：

- **Home Assistant**：官方博客明写「这一切都可以在本地运行，**没有任何数据离开你的家**」，
  且「如果用户不想要 AI，那是他们的选择，可以选择不启用任何这些功能」；
  官方还强调给社区「对如何、何时使用 AI 的完全控制权」
  `[来源: https://www.home-assistant.io/blog/2025/09/11/ai-in-home-assistant/]`。
  文档层面，本地语音路径明写「你的语音指令永不离开你的家」
  `[来源: https://www.home-assistant.io/voice_control/voice_remote_local_assistant/]`。
- **Nextcloud**：用 **Ethical AI Rating** 把「风险」直接标注在模型选择界面上——
  四档颜色 + 三个评分因子（软件是否 FOSS、模型可否自托管、训练数据是否公开），
  Green 还要求「数据留在本地」；且明确「**默认不会向外部服务发送任何东西**，
  除非你显式启用这些功能或安装相关应用」
  `[来源: https://docs.nextcloud.com/server/stable/admin_manual/ai/overview.html]`
  `[来源: https://nextcloud.com/blog/ai-in-nextcloud-what-why-and-how/]`。
  官方博客还引用 CEO 原话：「我们把控制权交给你——**默认关闭**，并让你选择要用哪个模型」
  `[来源: https://nextcloud.com/blog/ai-in-nextcloud-what-why-and-how/]`。
- **Obsidian Copilot**：隐私政策区分「本地模型 → 一切留在你的机器上」与
  「用自己的 API key → 插件直接发给 provider，Brevilabs **不代理、不记录、不存储**」
  `[来源: https://www.obsidiancopilot.com/en/privacy]`。
- **Anytype**：Local API 页面在开头就放 **Important Security Notice**，明确告知
  「提供 API key 或使用扩展 = 授予对 vault 的有限访问权限（可编辑、删除对象），
  **请只使用可信扩展**」`[来源: https://doc.anytype.io/anytype/features/integrations/local-api]`。

**「数据出境提示 / 同意」的 UI 范式**：

- **Apple 的「Apple Intelligence & PCC Report」是目前最完整的范式**：
  设置 → 隐私与安全性 → Apple Intelligence & PCC Report → 选择报告时间范围 → **导出文件**；
  报告列出**所有离开设备并由 PCC 处理的请求**（含来自 watchOS 的、以及发给 Apple Intelligence
  Extensions 的请求）`[来源: https://www.apple.com/legal/privacy/data/en/intelligence-engine/]`。
  它的设计要点是：**事后可审计 + 用户主动导出 + 按时间范围**，而不是一次性弹窗（分析）。
- **Nextcloud 的 Ethical AI Rating** 是**事前**范式：在选模型的那一刻就用红/橙/黄/绿告诉用户
  这次操作的数据会去哪 `[来源: https://docs.nextcloud.com/server/stable/admin_manual/ai/overview.html]`。
- **Shape of AI 的 Consent 模式**把「分享数据给 AI 前取得同意」抽象为可复用设计模式
  `[来源: https://www.shapeof.ai/patterns/consent]`。
- **反例**：Magic Compose 早期版本在「本地处理」宣传与实际「发送最近 20 条消息到服务器」之间存在落差，
  被媒体指出**破坏 E2EE** `[来源: https://www.androidpolice.com/magic-compose-google-messages-beta-supercharge-conversations/]`
  ——说明出境提示必须与实际数据流一致，否则是负资产（分析）。

### 7.4 E2EE 与「可客制化的数据出口」如何共存

**问题拆解**：如果数据在客户端解密，用户自己的脚本 / API 客户端能不能拿到明文？
会不会破坏 E2EE 的威胁模型？

**技术事实**：

- **E2EE 的定义性边界就在客户端**：密钥在本地生成与保存，载荷离开设备前已加密，
  服务端只见密文 `[来源: https://nhimg.org/faq/what-is-the-difference-between-local-encryption-and-end-to-end-client-side-encry/]`。
  因此「客户端解密后交给本地 API」**不改变服务端的可见性**——
  服务端仍然只见密文，E2EE 对**服务端**的保证完好（分析）。
- **但它确实改变了威胁模型的下界**：客户端侧加密「如果威胁模型包含被攻破的浏览器或恶意浏览器扩展，
  则提供不了任何保护，因为攻击者已经在里面了」
  `[来源: https://www.opensecurityarchitecture.org/patterns/sp-039/]`。
  → 本地 API = **在客户端信任边界内新增一个消费明文的入口**，
  它把风险从「服务端/网络」转移到了「本机上的其他进程与扩展」（分析）。
- **Bitwarden 的「零知识」表述可作范式**：官方安全白皮书称
  「零知识加密：Bitwarden 团队成员无法看到你的密码」，数据用个人邮箱与主密码端到端加密
  `[来源: https://bitwarden.com/help/bitwarden-security-white-paper/]`。
  而 Vaultwarden 明确**不实现 Bitwarden Public API**、只实现客户端 API
  `[来源: https://github.com/dani-garcia/vaultwarden/discussions/4241]`
  ——即**有意识地限制数据出口面**（分析）。
- **已有学术工作**研究「E2EE 应用的注入攻击」威胁模型（含 E2E 加密备份场景）
  `[来源: https://arxiv.org/html/2411.09228v1]`，说明「客户端明文注入点」是被认真对待的攻击面。
- **有产品公开讨论过这个取舍吗？** 找到的最接近的公开表态是：
  - **Anytype** 在 Local API 页面顶部的安全提示（承认 API key = 授予 vault 访问权）
    `[来源: https://doc.anytype.io/anytype/features/integrations/local-api]`；
  - **RealTyme** 的博客立场：「AI 助手可以在 E2EE 应用里工作——**但只有当 AI 模型在设备上运行、
    与加密处于同一信任边界内、且没有任何明文离开设备去接触云端模型时**」
    `[来源: https://www.realtyme.com/blog/e2ee-vs-ai-encrypted-messaging-assistants]`；
  - **Signal 总裁公开警告 AI agent 对安全消息应用是「existential threat」**，
    因为 agent 对个人数据的深度访问可能引发大量安全失败
    `[来源: https://tech.yahoo.com/cybersecurity/articles/ai-agents-existential-threat-secure-130000727.html]`。
  - **「E2EE + 本地明文 API」的完整公开威胁模型文档**：**未找到公开信息**。

> **对 heyta 的含义（分析）**：E2EE 与「可客制化的数据出口」可以共存，但必须**显式化信任边界**：
> 1. **本地 API 默认关闭**，开启时用与 Anytype 相同的措辞明确告知「任何能访问该 API key 的程序
>    都能读写你的全部任务明文」；
> 2. **API key 与设备绑定、可单独吊销**，且**不随 E2EE 同步载荷外流**（Obsidian Copilot 的
>    「存 Keychain 而非 vault」是正确做法）`[来源: https://community.obsidian.md/plugins/copilot]`；
> 3. **区分读 / 写权限**（Todoist CLI 的 `--read-only` 是现成范式
>    `[来源: https://github.com/Doist/todoist-mcp]`）；
> 4. 文档里**不要**宣称「E2EE 意味着没人能看到你的数据」——准确表述是
>    「**我们的服务器**看不到你的数据」，因为客户端一旦被攻破就全暴露。

---

## 小结 · 对本地优先 E2EE 任务应用的推荐技术路线

以下为**分析性结论**，不是检索到的事实。按「隐私 / 成本 / 体验 / 可维护性」四个维度给出取舍。

### 推荐分层（按优先级）

**Tier 0 —— 必做：确定性解析优先，AI 只做兜底**

自然语言 → 结构化任务的大部分真实输入（「明天下午三点交周报 #工作」）用**规则 + 日期库**就能解析，
不需要模型。Things 3 至今仍走规则路线 `[来源: https://culturedcode.com/things/support/articles/9780167/]`，
「Less Is More」的结论也是「最可靠的端侧 LLM 功能是 LLM 做得最少的那个」
`[来源: https://arxiv.org/html/2604.24636v1]`。
- **隐私**：最优（零外发）。**成本**：零。**体验**：快、可预测。**可维护性**：高（无模型依赖）。
- 代价：覆盖不了自由表达，需要持续维护规则库。

**Tier 1 —— 端侧小模型（首选方案）**

- **iOS/macOS**：Apple Foundation Models + `@Generable`
  `[来源: https://developer.apple.com/documentation/foundationmodels]`。
  优点：系统内置、无需分发模型、结构化输出有官方保证、**4096 token 上下文对单条任务解析绰绰有余**
  `[来源: https://developer.apple.com/documentation/technotes/tn3193-...]`。
  缺点：需 iOS 26+ 与 Apple Intelligence 设备；**中文约 1 字/token**，长输入要截断。
  许可：Apple SDK 条款，**不是开源**，但 heyta 只是调用系统框架，不构成依赖许可证问题（分析）。
- **Android**：ML Kit GenAI **Prompt API**（AICore 设备）
  `[来源: https://developers.google.com/ml-kit/genai]`。
  优点：与系统共享 Gemini Nano，不需下载模型。
  缺点：设备白名单、Alpha 阶段、Google 附加条款；覆盖率不如 iOS。
  备选：**LiteRT-LM**（Apache-2.0，可自带 Gemma-4-E2B 2.58GB，官方有跨平台性能表）
  `[来源: https://developers.google.com/edge/litert-lm/overview]`。
- **桌面**：Ollama（MIT）或直接内嵌 llama.cpp（MIT），走 OpenAI 兼容端点。
- **浏览器**：**Chrome Prompt API 只能在桌面 Chrome 用**
  `[来源: https://developer.chrome.com/docs/ai/prompt-api]`；
  移动浏览器与 Safari/Firefox 无端侧 LLM。Web 端建议**降级为 Tier 0 或引导用户用桌面/原生 App**。
- **隐私**：最优（数据不出设备）。**成本**：零边际成本，但**包体/设备覆盖是成本**
  （自分发模型时 2.58GB 是硬成本 `[来源: https://developers.google.com/edge/litert-lm/overview]`）。
  **体验**：延迟低（LiteRT-LM 在 iPhone 17 Pro GPU 上 56 tok/s decode，TTFT 0.3s
  `[来源: https://developers.google.com/edge/litert-lm/overview]`），但能力上限明显。
  **可维护性**：中——三端三套 API，且模型/框架版本每年变（MediaPipe 变 LiteRT-LM 就是先例
  `[来源: https://developers.google.com/edge/mediapipe/solutions/genai/llm_inference]`）。

**Tier 2 —— 用户自带的 AI 端点（BYOK / 自托管网关）**

- 统一契约：**base URL + 可选 API key + 模型名，路径 `/v1/chat/completions`**
  （Ollama / vLLM / llama.cpp / LM Studio / LocalAI / GenieX 全部兼容
  `[来源: https://ollama.com/blog/openai-compatibility]`
  `[来源: https://www.qualcomm.com/developer/blog/2026/06/geniex-developer-preview]`）。
- **密钥只存原生壳**（Keychain / Keystore），**不随 E2EE 同步载荷外流**
  `[来源: https://community.obsidian.md/plugins/copilot]`。
  🔴 **Web 端不要做「粘贴 key 到网页」**——WebCrypto 无法保护 bearer 凭据
  `[来源: https://crypto.stackexchange.com/questions/85587/what-do-people-use-non-extractable-webcrypto-keys-for]`。
- 移动端直连的坑要有产品级对策：区域封锁（中文用户默认推荐 DeepSeek / 豆包）、
  RN 流式需要专门实现、CORS 只影响 Web 端
  `[来源: https://teamorouter.com/blogs/access-ai-apis-china-without-vpn-2026]`。
- **隐私**：中——数据离开设备，但**目标由用户选择**，产品方不接触。
  **成本**：零（用户自付）。**体验**：最好（可用前沿模型）。
  **可维护性**：中——要维护多 provider 适配，但**OpenAI 兼容标准把它压缩成一套**
  `[来源: https://docs.vllm.ai/en/latest/serving/online_serving/]`。

**Tier 3 —— 产品方托管的云端推理（不推荐作为默认，除非用机密计算）**

- 与 heyta 的 E2EE 前提直接冲突：服务端一旦解密就失去设计保证（分析）。
- 若要做，唯一在技术上站得住的是**机密计算**，但 2026 年的现实是：
  要求 H100/B200 级机密 GPU（Azure `NCCadsH100v5`、Phala、Tinfoil、Privatemode）
  `[来源: https://learn.microsoft.com/en-us/azure/confidential-computing/gpu-options]`，
  且**对硬件层运营方仍不成立**（DDRop 用 ~200 美元的 DDR5 interposer 即可重放加密内存
  `[来源: https://thehackernews.com/2026/09/new-ddrop-attack-breaks-intel-tdx-and.html]`）。
- **FHE / MPC 在 2026 年不可用**：HE 推理约 0.2 tok/s
  `[来源: https://arxiv.org/html/2606.11145v1]`。**不要投入。**
- 若用户想要云端体验，正确做法是**把选择权交给用户**（Tier 2），
  而不是产品方代持明文（分析）。

**Tier 4 —— 只做接口（MCP / 本地 API），把 AI 体验交给用户自己的客户端**

- 一线任务管理产品**全部已官方出货 MCP server**
  （Todoist / Linear / Notion / Asana / Atlassian / ClickUp / TickTick，认证统一 OAuth 2.1）
  `[来源: https://help.ticktick.com/articles/7438129581631995904]`。
- 对 heyta 最优的形态是**本地 stdio / localhost MCP server**：
  明文不出设备，服务端依旧只见密文，**与 E2EE 完全兼容**（分析）。
- 若按 2026-07-28 规范实现，要接受**无状态化**（无 session、`Mcp-Method` 头、`ttlMs`）
  `[来源: https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/]`。
- **隐私**：最优。**成本**：低（无推理成本）但**维护成本不低**（有分析称年 5–15 万美元
  `[来源: https://www.institutepm.com/knowledge-hub/saas-mcp-server-strategy]`）。
  **体验**：取决于用户的 AI 客户端，产品不可控。**可维护性**：中，且**规范仍在破坏性演进**。

### 推荐组合（对 heyta）

> **Tier 0（确定性解析）+ Tier 1（端侧模型）+ Tier 4（本地 MCP / 本地 API），把 Tier 2 作为可选开关，
> 明确不做 Tier 3。**

理由：

1. **Tier 0 + Tier 1** 覆盖绝大多数真实场景，且**隐私保证最强**——这是 heyta 对标滴答清单时
   唯一无法被复制的差异化点（Todoist 明确把 AI 跑在自家基础设施
   `[来源: https://www.todoist.com/todoist-assist]`，Notion 把内容发给第三方
   `[来源: https://wisechecker.com/notion-ai-privacy-data-usage/]`）。
2. **Tier 1 的能力上限是够的**：短句 → 小 schema 的抽取远易于 SOB 基准的多跳长上下文
   `[来源: https://arxiv.org/html/2604.25359v1]`；而 IFStruct 证明结构遵循对 350M 级小模型「高度可学习」
   `[来源: https://arxiv.org/html/2604.25359v1]`（注：该结论出自 Liquid AI 自家基准
   `[来源: https://www.liquid.ai/blog/ifstruct-v1.0]`，需独立验证）。
   **但必须做防御性工程**：多层解析、失败重试、确定性回退、session 轮换
   `[来源: https://arxiv.org/html/2604.24636v1]`。
3. **Tier 2 是「高级用户开关」而非默认**：满足想要更强模型或已有自建 Ollama/vLLM 的用户，
   同时把「数据发给谁」的决定权完整交还用户。
4. **Tier 4 是长期护城河**：它让 heyta 在「AI 能力」上不必追赶模型军备竞赛，
   而是成为用户 AI 客户端里最好用的任务数据源——且**天然与 E2EE 兼容**。
5. **UI 上必须做数据出境披露**：Apple 的「PCC Report 可导出」是当前最好的范式
   `[来源: https://www.apple.com/legal/privacy/data/en/intelligence-engine/]`，
   Nextcloud 的 Ethical AI 分级是最好的事前范式
   `[来源: https://docs.nextcloud.com/server/stable/admin_manual/ai/overview.html]`。
   heyta 应同时提供：**事前**（这次操作会把哪些字符发给哪个端点）+ **事后**（本地可导出的出境日志）。

### 许可证速查（对 heyta 的硬门禁）

**✅ 可安全使用 / 借鉴**：
Apple Foundation Models（系统框架，非依赖）、LiteRT-LM（Apache-2.0）、GenieX（BSD-3-Clause）、
Ollama（MIT）、llama.cpp（MIT）、MLX（MIT）、vLLM（Apache-2.0）、MLC-LLM / WebLLM（Apache-2.0）、
transformers.js（Apache-2.0）、LiteLLM（MIT，除 `enterprise/`）、Home Assistant core（Apache-2.0）、
Wyoming 包装层（MIT）、Joplin（MIT）、Actual Budget（MIT）、MCP 规范与 SDK（MIT → Apache-2.0）。

**🔴 一行都不能进产品代码**：
Nextcloud 全家桶（server / context_chat / context_chat_backend / context_agent / app_api /
integration_openai，均 AGPL-3.0）、Immich（AGPL-3.0）、Karakeep（AGPL-3.0）、
Standard Notes（AGPL-3.0）、Vaultwarden（AGPL-3.0）、Bitwarden server（AGPL-3.0 / Bitwarden License）、
Obsidian Copilot（AGPL-3.0）、text-generation-webui（AGPL-3.0）、Paperless-ngx（GPL-3.0）、
**Piper 本体（GPL-3.0）**、Open WebUI（非 OSI）、Zama Concrete ML（仅开发用途）、
OpenPcc 论文（CC BY-NC-ND）、Obsidian Smart Connections（非 OSI，含竞争限制）、
Anytype 应用（非商业限定）。

> ⚠️ **注意区分**：Nextcloud / Immich 的**架构思想与文档**可以参考引用（引用不等于代码复用），
> 但**任何代码、配置模板、镜像都不得进入 heyta**。若 heyta 想做本地 CLIP 搜索，
> 应直接用 Apache-2.0 / MIT 的 ONNX Runtime + 自选 CLIP 模型，而不是参考 Immich 的实现。

---

## 附：本次调研的已知缺口（未找到公开信息）

1. 1B–8B 模型在 **BFCL** 上的稳定逐项分数快照（第三方镜像榜模型集不一致）。
2. **滴答清单 AI 的推理位置与隐私架构**（只有功能帮助页，无架构说明）。
3. **Things 3 / OmniFocus 是否已有官方 MCP server**（未发现）。
4. **Linear / Asana / Atlassian / ClickUp / TickTick 的 MCP server 许可证**。
5. **BYOK 移动端的 TLS 证书固定实践、计费/配额异常处理**、
   **App Store 针对「客户端内置用户自有 API key」的具体条款**。
6. **ZK 用于生成式 LLM 推理**的可用方案（2026 年无）。
7. **ZK / FHE 在移动端的实际可用性**（无公开生产案例）。
8. **Msty / Karakeep 的密钥存储实现细节**；**Logseq 的许可证原文**。
9. **Standard Notes 与 Actual Budget 的内建 AI 集成**（未找到）。
10. **Arm CCA 在 2026 年的生产级 GPU 配套情况**。
11. **「E2EE + 客户端本地明文 API」的完整公开威胁模型文档**（只有产品级安全提示与博客立场）。
12. **把「数据最小化」作为明确命名策略并系统宣传的产品**（只有具体做法，没有以此命名的产品叙事）。
