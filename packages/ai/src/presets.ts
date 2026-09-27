/**
 * 端点预设
 * =========
 *
 * "一键本机 Ollama" 这类预设。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么预设**必须放在 `packages/` 而不是设置页里**
 *
 * `check-layering` 有一条规则禁止 `apps/*` 里出现模型端点字面量
 * （`no-model-endpoint-in-apps`），它的 pattern 恰好会命中 `:11434/v1`。
 *
 * 我第一次写设置页时以为这条规则会碍事 —— **它其实是对的**：
 *
 * - 走哪个端点、用什么模型名、要不要密钥，全是**产品语义**（ADR-0003）
 * - 更重要的是：**预设本身就是一份"我们会往哪发数据"的声明**。
 *   它散落在 UI 里，用户就无从知道 heyta 到底建议了哪些目的地
 *   （ADR-0005 / ADR-0006 的出境约束要靠这个可审计）
 *
 * 所以规则不是在找麻烦，它是在提醒：**预设是数据，不是界面文案。**
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ## 只内置本机预设
 *
 * ⚠️ **刻意不内置任何云端预设**（不带 OpenAI / DeepSeek / 通义 之类的条目）。
 *
 * 理由：一份云端端点清单会**过期**（模型改名、价格变化、地区不可用），
 * 而过期的清单比没有清单更糟 —— 用户会照着它填，然后撞上一个他无法理解的错误。
 * 更麻烦的是，内置云端预设等于 heyta 在**推荐**某个目的地，
 * 而"数据发到哪"应该是用户自己的决定。
 *
 * 本机预设没有这些问题：它不需要任何外部信息（地址就是 localhost，
 * 模型名是用户自己 `ollama pull` 下来的，且随时可改）。
 *
 * 云端端点让用户**自己填** —— 那时他知道自己在填什么。
 */

import type { AiEndpointConfig } from './routing.js';

/** 预设。 */
export interface AiEndpointPreset {
  id: string;
  label: string;
  /** 一句给用户看的说明。**必须说清数据去哪。** */
  note: string;
  config: AiEndpointConfig;
  /** 用这个预设还需要用户做什么（例如先装好 Ollama）。 */
  prerequisite?: string;
}

/**
 * 本机预设。
 *
 * 🔴 两者都是**回环地址** → `classifyDestination` 判为 `none` →
 * **不需要任何出境授权**。这正是它们适合做预设的原因：
 * 用户点一下就能用，且不需要同意任何数据出境。
 */
export const AI_ENDPOINT_PRESETS: readonly AiEndpointPreset[] = [
  {
    id: 'ollama',
    label: '本机 Ollama',
    note: '数据不出这台设备，不需要授权，也不需要 API key。',
    prerequisite: '需要先装好 Ollama 并 pull 一个模型（例如 ollama pull qwen3:8b）。',
    config: {
      id: 'ollama',
      label: '本机 Ollama',
      endpoint: 'http://localhost:11434/v1',
      model: 'qwen3:8b',
      // 本机端点通常不校验密钥；留空即可，所以不设 keyRef
    },
  },
  {
    id: 'lm-studio',
    label: '本机 LM Studio',
    note: '数据不出这台设备，不需要授权，也不需要 API key。',
    prerequisite: '需要在 LM Studio 里打开本地服务器（默认端口 1234）。',
    config: {
      id: 'lm-studio',
      label: '本机 LM Studio',
      endpoint: 'http://127.0.0.1:1234/v1',
      model: 'local-model',
    },
  },
];

/**
 * 按 id 取预设。
 *
 * ⚠️ **当前零生产调用点**：界面直接消费 `AI_ENDPOINT_PRESETS`（它要整张表渲染）。
 * 保留的理由：它是"按稳定 id 取一个预设"的端口能力（导入配置、深链、
 * 未来的"恢复默认端点"都要用到），且行为已被测试钉住
 * （`findPreset 认得自己目录里的，不认别的`）。**不要因为今天没人调就删** ——
 * 删掉它只是让下一个需要它的人再写一遍 `.find()`。
 */
export function findPreset(id: string): AiEndpointPreset | undefined {
  return AI_ENDPOINT_PRESETS.find((p) => p.id === id);
}

/**
 * 全部内置预设的目的地类别。
 *
 * 🔴 这个函数存在的意义是**让"预设都是本机的"成为一条可断言的属性**，
 * 而不是一句注释。将来若有人加了云端预设，测试会红 ——
 * 而那正是需要有人**明确决定**"我们要不要推荐云端"的时刻。
 *
 * ⚠️ **它的调用点是测试（与将来可能的设置页只读展示），不是生产路径。**
 * 这**不是**"零调用点的死代码"：它是**守门用的断言面**，
 * 删掉它，那条守门测试就只能去自己重新推导"哪些端点算本机"，
 * 而那会引入第二套判断（本仓库最忌讳的形状）。**保留。**
 */
export function presetDestinations(): readonly { id: string; isLocalOnly: boolean }[] {
  return AI_ENDPOINT_PRESETS.map((p) => ({
    id: p.id,
    isLocalOnly: p.config.endpoint.includes('localhost') || p.config.endpoint.includes('127.0.0.1'),
  }));
}
