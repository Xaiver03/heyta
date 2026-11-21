# PI 内核在 RN/Hermes 的可移植性评估（静态分析）

> 日期：2026-11-22。结论基于**静态依赖分析**（未在真机跑，见"未核"）。源码：`/Volumes/RocaSSD/reference/pi-src`（commit `780bf31`，`@earendil-works/pi-agent-core@1.6.0`）。

## 0. 结论（先说）

- **内核循环本体可移植**：`pi-agent-core` 的 `Agent`/`agentLoop` 通过**注入 `streamFn`** 工作；`stream-fn.ts` **零依赖**（`setDefaultStreamFn` 由宿主提供，缺省直接抛错）。6 个源文件、96K、纯 ESM、**src 中零 `node:` 内置**。
- **但开箱即用不可移植**：包 `index` 会 re-export `proxy.ts`（运行时 import `pi-ai`），而 `pi-ai` 是**重 Node 包**——211 个源文件，依赖 `openai`/`@anthropic-ai/sdk`/`@aws-sdk/client-bedrock-runtime`/`@aws-sdk/credential-provider-node`/`@google/genai`/`http-proxy-agent`，且 src 里直接 `node:http/fs/crypto/zlib/os/path/readline/https`。要在 RN 用它必须做 tree-shaking + 自供 streamFn **且**验证打包结果，风险高。
- **产品决策（已定）**：**移动端用 heyta 原生引擎**（`runCloudAgentTurn`，纯 JS、零 Node 依赖、已有可移植门禁），**PI 内核仅作桌面增强**（同一 `CloudAgentTool` 契约，见 `ai-cloud-tools.ts` 的 `toCloudAgentTools`）。

## 1. 可复跑命令与读数

```bash
cd /Volumes/RocaSSD/reference/pi-src/packages
# 内核：零 node 内置、纯 ESM、6 文件
node -e "const p=require('./agent/package.json');console.log(p.name,p.version,p.type,p.dependencies)"
grep -rhoE "node:[a-z_]+" agent/src | sort | uniq -c        # 期望：无输出
find agent/src -name '*.ts' | wc -l                          # 6
du -sh agent/src                                             # 96K
# 默认 streamFn 由宿主提供（不依赖 pi-ai）
sed -n '1,30p' agent/src/stream-fn.ts
# pi-ai 是重 Node 包
node -e "const p=require('./ai/package.json');console.log(Object.keys(p.dependencies))"
grep -rhoE "node:[a-z_]+" ai/src | sort | uniq -c | sort -rn | head
find ai/src -name '*.ts' | wc -l                             # 211
```

## 2. 为什么这样分（不是"图省事"）

1. **Hermes 无 WASM、无 Node 内置**：`pi-ai` 的 provider/auth 直接 `node:fs/crypto/http`，在 RN 上会加载失败。
2. **heyta 自供模型层**：模型调用走自有 `createRoutedModelCall → invokeRouted`（出境闸门/熔断），**不需要** `pi-ai` 的 provider 目录。桌面若用 PI 内核，只需把 `streamFn` 接到 `invokeRouted`。
3. **原生引擎已满足四端**：`runCloudAgentTurn` 纯 TS + `fetch().json()`，有 `agent-portability.spec.ts` 机械门禁；移动/平板/Web 直接可用。

## 3. 未核（诚实）

- **真机跑 PI 内核**：未在 iOS/Android Hermes 上打包实测；若将来要在移动端用 PI 内核，需先证明打包后 `pi-ai` 可被完全 tree-shake 或提供无 pi-ai 的入口。
- **包体**：`pi-agent-core` 自身 96K；连同 `pi-ai`（211 文件 + 4 家 SDK）未做最终打包体积测定。

## 4. 决策记录

移动端 = 原生引擎（兜底，已实现）；桌面 = 可选 PI 内核（增强）。两者共用 `CloudAgentTool`。此结论写入 `docs/reference/agent-harness-runtime-compat.md` §0/§2。
