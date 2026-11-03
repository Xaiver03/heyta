/**
 * 图片输入：线格式、预算、披露、路由
 * ==================================
 *
 * 这份测试钉的是**四条**在图片这件事上会被悄悄破坏的不变量：
 *
 * 1. **不带图时请求体逐字不变。** 加图片能力不该让五条既有调用点换形 ——
 *    它们的字节形状已经被 `wire.spec.ts` 按原始串钉住，这里再按"同一份输入
 *    新旧两条路"对比一次，因为图片是在**同一个**组装点里加的。
 * 2. **图挂在最后一条 user 消息上**，不是新起一轮、也不是第一条。
 * 3. **有图就必须披露**：`fields` 里没有 `images` 直接抛错，而不是发出去再算。
 * 4. **预算是硬的**：超预算的图在请求体存在之前就被拒，不截断、不静默丢。
 *
 * 另外顺手钉住 `resolveRoute` 的 `requires` 叠加 —— 那是"本次请求额外要求
 * 能力"的唯一入口，`vision` 从此有了真实消费者。
 */

import { describe, expect, it } from 'vitest';

import {
  base64ByteLength,
  base64Length,
  fitWithinDimension,
  fitWithinPixels,
  IMAGE_BUDGET,
  planImageRequest,
  requestImageDimensions,
  resolveRoute,
  type AiEndpointConfig,
  type AiRoutingConfig,
} from '../src/index.js';
import { buildChatRequestBody, egressBytesFor } from '../src/wire.js';

/** 一段合法的 base64（内容不重要：线格式这一层不解码图片，只搬字节）。 */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const IMAGE = { mediaType: 'image/png' as const, base64: PNG };

const LOCAL: AiEndpointConfig = {
  id: 'local',
  label: '本机',
  endpoint: 'http://localhost:11434/v1',
  model: 'qwen3:8b',
};

const LOCAL_VISION: AiEndpointConfig = {
  ...LOCAL,
  id: 'local-vision',
  capabilities: ['structured_output', 'vision'],
};

function config(overrides: Partial<AiRoutingConfig> = {}): AiRoutingConfig {
  return {
    enabled: true,
    allowRemote: false,
    endpoints: [LOCAL, LOCAL_VISION],
    routes: { prioritize: [{ endpointId: 'local' }] },
    ...overrides,
  };
}

describe('不带图时请求体逐字不变', () => {
  it('单条 system+user 的请求体与加图片能力之前完全相同', () => {
    const body = buildChatRequestBody('m', { system: 's', user: 'u' });
    expect(JSON.stringify(body)).toBe(
      JSON.stringify({
        model: 'm',
        messages: [
          { role: 'system', content: 's' },
          { role: 'user', content: 'u' },
        ],
      }),
    );
  });

  it('显式传空数组等同于不传', () => {
    const withEmpty = buildChatRequestBody('m', { system: 's', user: 'u', images: [], fields: [] });
    const without = buildChatRequestBody('m', { system: 's', user: 'u' });
    expect(JSON.stringify(withEmpty)).toBe(JSON.stringify(without));
  });
});

describe('图挂在最后一条 user 消息上', () => {
  it('文本在前、图片在后，且是 OpenAI 的 image_url + data URL', () => {
    const body = buildChatRequestBody('m', {
      system: 's',
      user: '把这张图变成任务',
      fields: ['title', 'images'],
      images: [IMAGE],
    });

    expect(body.messages).toEqual([
      { role: 'system', content: 's' },
      {
        role: 'user',
        content: [
          { type: 'text', text: '把这张图变成任务' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } },
        ],
      },
    ]);
  });

  it('多轮时挂到最后一条 user，而不是第一条', () => {
    const body = buildChatRequestBody('m', {
      system: 's',
      user: '忽略：这条由 messages 覆盖',
      messages: [
        { role: 'system', content: 's' },
        { role: 'user', content: '第一问' },
        { role: 'assistant', content: '第一答' },
        { role: 'user', content: '第二问' },
      ],
      fields: ['images'],
      images: [IMAGE],
    });

    const [, first, assistant, last] = body.messages as readonly Record<string, unknown>[];
    expect(first?.content).toBe('第一问');
    expect(assistant?.content).toBe('第一答');
    expect(Array.isArray(last?.content)).toBe(true);
    expect((last?.content as readonly unknown[]).length).toBe(2);
  });

  it('没有 user 消息承载时响亮失败，而不是把图当第一条发出去', () => {
    expect(() =>
      buildChatRequestBody('m', {
        system: 's',
        user: 'u',
        messages: [{ role: 'system', content: 's' }],
        fields: ['images'],
        images: [IMAGE],
      }),
    ).toThrow(/user 消息/);
  });
});

describe('披露与预算是断言，不是约定', () => {
  it('有图但 fields 里没有 images ⇒ 抛错，且错误里点名 images', () => {
    expect(() =>
      buildChatRequestBody('m', {
        system: 's',
        user: 'u',
        fields: ['title'],
        images: [IMAGE],
      }),
    ).toThrow(/images/);
  });

  it('完全不传 fields 也算漏报', () => {
    expect(() => buildChatRequestBody('m', { system: 's', user: 'u', images: [IMAGE] })).toThrow(
      /images/,
    );
  });

  it('单张超过 maxBytesPerImage ⇒ 抛错（不截断）', () => {
    const tooBig = 'A'.repeat(base64Length(IMAGE_BUDGET.maxBytesPerImage + 1));
    expect(() =>
      buildChatRequestBody('m', {
        system: 's',
        user: 'u',
        fields: ['images'],
        images: [{ mediaType: 'image/png', base64: tooBig }],
      }),
    ).toThrow(/预算/);
  });

  it('张数超过 maxImagesPerRequest ⇒ 抛错', () => {
    const images = Array.from({ length: IMAGE_BUDGET.maxImagesPerRequest + 1 }, () => IMAGE);
    expect(() =>
      buildChatRequestBody('m', { system: 's', user: 'u', fields: ['images'], images }),
    ).toThrow(/预算/);
  });
});

describe('egressBytesFor 把图片算进出境量', () => {
  it('多一张图，出境字节严格变大', () => {
    const text = egressBytesFor('m', { system: 's', user: 'u' });
    const one = egressBytesFor('m', {
      system: 's',
      user: 'u',
      fields: ['images'],
      images: [IMAGE],
    });
    expect(one).toBeGreaterThan(text);
    // 差额至少是 base64 串本身（+ 线格式包壳）
    expect(one - text).toBeGreaterThan(PNG.length);
  });
});

describe('几何：只缩不放，两个判据都要', () => {
  it('已经在预算内 ⇒ 原样返回（绝不插值放大）', () => {
    expect(fitWithinPixels(800, 600, 1_000_000)).toEqual({ width: 800, height: 600 });
    expect(fitWithinDimension(800, 600, 1_600)).toEqual({ width: 800, height: 600 });
  });

  it('按长边等比缩到像素预算内，且不超预算', () => {
    const out = fitWithinPixels(4000, 3000, 1_000_000);
    expect(out.width * out.height).toBeLessThanOrEqual(1_000_000);
    expect(out.width).toBeGreaterThan(out.height);
    // 比例大致保持（允许取整误差）
    expect(Math.abs(out.width / out.height - 4 / 3)).toBeLessThan(0.01);
  });

  it('极端长条图不会被算成 0', () => {
    const out = fitWithinPixels(10_000, 3, 1_000_000);
    expect(out.width).toBeGreaterThan(0);
    expect(out.height).toBeGreaterThan(0);
    expect(out.width * out.height).toBeLessThanOrEqual(1_000_000);
  });

  it('单边判据能挡住"像素不多但长边离谱"的形状', () => {
    const out = fitWithinDimension(10_000, 100, 1_600);
    expect(out.width).toBe(1_600);
    expect(out.height).toBe(16);
  });

  it('两个判据串联后两个上界都成立', () => {
    const out = requestImageDimensions(8_000, 8_000);
    expect(out.width).toBeLessThanOrEqual(IMAGE_BUDGET.maxImageDimension);
    expect(out.height).toBeLessThanOrEqual(IMAGE_BUDGET.maxImageDimension);
    expect(out.width * out.height).toBeLessThanOrEqual(IMAGE_BUDGET.maxImagePixels);
  });

  it('非法输入不被静默改成 0', () => {
    expect(fitWithinPixels(0, 100, 1_000)).toEqual({ width: 0, height: 100 });
    expect(fitWithinDimension(100, 100, 0)).toEqual({ width: 100, height: 100 });
  });
});

describe('base64 的两个方向', () => {
  it('字节 → base64 长度按 4/3 向上取整', () => {
    expect(base64Length(0)).toBe(0);
    expect(base64Length(1)).toBe(4);
    expect(base64Length(3)).toBe(4);
    expect(base64Length(4)).toBe(8);
  });

  it('base64 串 → 字节数与真实解码一致（含填充）', () => {
    expect(base64ByteLength(PNG)).toBe(Buffer.from(PNG, 'base64').length);
    expect(base64ByteLength('QUJD')).toBe(3); // "ABC"
    expect(base64ByteLength('QUJDRA==')).toBe(4); // "ABCD"
  });
});

describe('planImageRequest 的拒绝原因按"最该先解决的那条"给', () => {
  const ok = { mediaType: 'image/png' as const, bytes: 1_000, width: 100, height: 100 };

  it('通过时给出总额与 base64 长度', () => {
    const plan = planImageRequest([ok, ok]);
    expect(plan).toEqual({ ok: true, totalBytes: 2_000, totalBase64: base64Length(2_000) });
  });

  it('格式先查：SVG 不在白名单', () => {
    expect(planImageRequest([{ ...ok, mediaType: 'image/svg+xml' as never }])).toEqual({
      ok: false,
      reason: 'unsupported-media-type',
    });
  });

  it('再查单张、张数、总额', () => {
    expect(planImageRequest([{ ...ok, bytes: IMAGE_BUDGET.maxBytesPerImage + 1 }])).toEqual({
      ok: false,
      reason: 'image-too-large',
    });
    expect(
      planImageRequest(Array.from({ length: IMAGE_BUDGET.maxImagesPerRequest + 1 }, () => ok)),
    ).toEqual({ ok: false, reason: 'too-many-images' });
    // 🔴 这条分支必须**真的能红**：两张都不超单张上限，合起来超总额。
    // 若哪天有人把单张上限改成"总额 ÷ 张数"，这里会立刻变成不可达 —— 那正是要拦的。
    const big = { ...ok, bytes: IMAGE_BUDGET.maxBytesPerImage };
    expect(big.bytes * IMAGE_BUDGET.maxImagesPerRequest).toBeGreaterThan(
      IMAGE_BUDGET.maxTotalImageBytes,
    );
    expect(planImageRequest([big, big])).toEqual({
      ok: false,
      reason: 'images-over-total-budget',
    });
  });

  it('尺寸读错（0 或超边）也被拒', () => {
    expect(planImageRequest([{ ...ok, width: 0 }])).toEqual({
      ok: false,
      reason: 'image-dimensions-too-large',
    });
    expect(planImageRequest([{ ...ok, width: IMAGE_BUDGET.maxImageDimension + 1 }])).toEqual({
      ok: false,
      reason: 'image-dimensions-too-large',
    });
  });
});

describe('resolveRoute：本次请求的额外能力要求', () => {
  it('不带 requires 时，没声明 vision 的端点仍是候选', () => {
    const r = resolveRoute(config(), 'prioritize', { now: 0 });
    expect(r.candidates.map((c) => c.endpointConfig.id)).toEqual(['local']);
  });

  it('带 requires: [vision] 时，没声明 vision 的端点被排除为 capability-missing', () => {
    const r = resolveRoute(config(), 'prioritize', { now: 0, requires: ['vision'] });
    expect(r.candidates).toHaveLength(0);
    expect(r.excluded.map((e) => e.reason)).toEqual(['capability-missing']);
  });

  it('requires 的重复项不会让同一条排除原因出现两次', () => {
    const r = resolveRoute(config(), 'prioritize', {
      now: 0,
      requires: ['vision', 'vision', 'structured_output'],
    });
    expect(r.excluded).toHaveLength(1);
  });

  it('功能本身的要求与本次要求取并集：两边都满足才进候选', () => {
    const r = resolveRoute(
      config({ routes: { prioritize: [{ endpointId: 'local-vision' }] } }),
      'prioritize',
      { now: 0, requires: ['vision'] },
    );
    expect(r.candidates.map((c) => c.endpointConfig.id)).toEqual(['local-vision']);
  });
});
