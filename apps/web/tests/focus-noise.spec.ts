/**
 * 专注白噪音（覆盖图谱 #51）—— 纯逻辑判据
 * ==========================================
 *
 * 判三件**真会坏**的事：
 *   1. 音量必须被夹进 [0,1]（0 会让声音消失得莫名其妙，>1 会削波）；
 *   2. 三种噪声都有合法的合成参数（频率落在人耳可闻区、Q 为正）；
 *   3. **噪声算法本身**：白噪音近似零均值、相邻无关；棕噪音明显更"平滑"
 *      （相邻差值平均更小）。这一条能失败 —— 把棕噪音的积分去掉，它立刻红。
 *
 * 最后一条是关键：只测"函数没抛错"的判据永远不会红。这里用固定的伪随机序列
 * 把统计性质测出来。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_NOISE_PREF,
  NOISE_KINDS,
  NOISE_PRESETS,
  NOISE_VOLUME_DEFAULT,
  __clearNoisePrefForTests,
  clampNoiseVolume,
  generateNoiseSamples,
  isNoiseKind,
  loadNoisePref,
  saveNoisePref,
  type NoisePref,
} from '../src/lib/focus-noise.js';

/** 可复现的线性同余伪随机源 [0,1)。 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function meanAbsDiff(samples: Float32Array): number {
  let sum = 0;
  for (let i = 1; i < samples.length; i += 1) sum += Math.abs(samples[i] - samples[i - 1]);
  return sum / (samples.length - 1);
}

beforeEach(() => {
  __clearNoisePrefForTests();
});

describe('音量夹取', () => {
  it('越界被夹进 [0,1]，NaN 回默认', () => {
    expect(clampNoiseVolume(-1)).toBe(0);
    expect(clampNoiseVolume(2)).toBe(1);
    expect(clampNoiseVolume(0.3)).toBeCloseTo(0.3);
    expect(clampNoiseVolume(Number.NaN)).toBe(NOISE_VOLUME_DEFAULT);
    expect(clampNoiseVolume('0.5')).toBe(NOISE_VOLUME_DEFAULT);
  });
});

describe('噪声预设', () => {
  it('三种噪声都有合法参数', () => {
    expect(NOISE_KINDS).toEqual(['rain', 'white', 'brown']);
    for (const kind of NOISE_KINDS) {
      const preset = NOISE_PRESETS[kind];
      if (preset.filter !== null) {
        expect(preset.filter.frequencyHz).toBeGreaterThan(20);
        expect(preset.filter.frequencyHz).toBeLessThan(20000);
        expect(preset.filter.q).toBeGreaterThan(0);
      }
    }
    // rain 走带通（雨滴感），white 直通，brown 走低通。
    expect(NOISE_PRESETS.rain.filter?.type).toBe('bandpass');
    expect(NOISE_PRESETS.white.filter).toBeNull();
    expect(NOISE_PRESETS.brown.filter?.type).toBe('lowpass');
  });

  it('isNoiseKind 只认三种', () => {
    expect(isNoiseKind('rain')).toBe(true);
    expect(isNoiseKind('white')).toBe(true);
    expect(isNoiseKind('brown')).toBe(true);
    expect(isNoiseKind('pink')).toBe(false);
    expect(isNoiseKind(undefined)).toBe(false);
  });
});

describe('采样生成（统计性质）', () => {
  const SAMPLE_RATE = 8000;
  const SECONDS = 2;

  it('长度 = 采样率 × 时长，且都在 [-1,1]', () => {
    const out = generateNoiseSamples('white', SAMPLE_RATE, SECONDS, seeded(1));
    expect(out.length).toBe(SAMPLE_RATE * SECONDS);
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('白噪音近似零均值', () => {
    const out = generateNoiseSamples('white', SAMPLE_RATE, SECONDS, seeded(42));
    let sum = 0;
    for (const v of out) sum += v;
    expect(Math.abs(sum / out.length)).toBeLessThan(0.05);
  });

  it('🔴 棕噪音比白噪音明显更平滑（相邻差值平均更小）', () => {
    // 两个用同一条随机序列，唯一差别是 fill 算法 —— 这条能失败：把棕噪音的积分去掉即红。
    const white = generateNoiseSamples('white', SAMPLE_RATE, SECONDS, seeded(7));
    const brown = generateNoiseSamples('brown', SAMPLE_RATE, SECONDS, seeded(7));
    expect(meanAbsDiff(brown)).toBeLessThan(meanAbsDiff(white) / 4);
  });
});

describe('偏好持久化', () => {
  it('默认关闭，读回默认值', () => {
    expect(loadNoisePref()).toEqual(DEFAULT_NOISE_PREF);
  });

  it('存进去的合法值能读回，非法值逐字段回落', () => {
    const pref: NoisePref = { enabled: true, kind: 'brown', volume: 0.7 };
    saveNoisePref(pref);
    expect(loadNoisePref()).toEqual(pref);

    // 手写一份坏的：enabled 不是布尔、kind 不认识、volume 越界。
    localStorage.setItem('heyta.focus-noise', JSON.stringify({ enabled: 'yes', kind: 'pink', volume: 5 }));
    const fallback = loadNoisePref();
    expect(fallback.enabled).toBe(false);
    expect(fallback.kind).toBe(DEFAULT_NOISE_PREF.kind);
    expect(fallback.volume).toBe(1); // 越界被夹到上限
  });
});
