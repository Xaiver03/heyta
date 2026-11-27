/**
 * 专注白噪音（覆盖图谱 #51）
 * ==========================
 *
 * 产品裁决：白噪音/铃声**用 Web Audio API 现场合成**，不引第三方音频资产或库
 * —— 音频资产有许可证与维护门槛，而"雨声/白噪音"这类平稳噪声的生成算法很短、
 * 完全可测。这里放**纯逻辑**（预设参数 + 采样生成 + 偏好校验），
 * Web Audio 的接线在 `features/focus/use-noise-player.ts`，UI 在 `NoiseSettings.tsx`。
 *
 * ⚠️ 这是**平台能力**（Web Audio 只存在于 web/Electron 渲染进程），
 * 不属于 `packages/` 的业务语义；与 `lib/focus-config.ts` 同一条边界判断。
 */

/** 三种可选噪声。`rain` 是白噪音经带通后的"雨滴感"，`brown` 是更低沉的棕噪音。 */
export type NoiseKind = 'rain' | 'white' | 'brown';

/** 每种噪声的合成参数（纯数据，可测；不依赖 AudioContext）。 */
export interface NoisePreset {
  /** 采样填充算法：白噪音或棕噪音。`rain` 用白噪音再经带通滤波。 */
  readonly fill: 'white' | 'brown';
  /** 串在声源后的单枚 BiquadFilter；`null` = 直通。 */
  readonly filter: {
    readonly type: 'lowpass' | 'highpass' | 'bandpass';
    readonly frequencyHz: number;
    readonly q: number;
  } | null;
}

/**
 * 预设表。
 *
 * - `white`：全频段均匀，最"沙沙"，适合盖住环境人声；
 * - `rain`：白噪音过 ~1200Hz 带通（Q≈0.7），听感像雨；
 * - `brown`：能量集中在低频（-6dB/oct），更"厚"，久听不刺耳。
 *
 * 频率都落在人耳可闻区，且给的是**合成参数**不是音频素材。
 */
export const NOISE_PRESETS: Record<NoiseKind, NoisePreset> = {
  white: { fill: 'white', filter: null },
  rain: { fill: 'white', filter: { type: 'bandpass', frequencyHz: 1200, q: 0.7 } },
  brown: { fill: 'brown', filter: { type: 'lowpass', frequencyHz: 900, q: 0.5 } },
};

export const NOISE_KINDS: readonly NoiseKind[] = ['rain', 'white', 'brown'];

/** 音量合法区间（0–1 线性增益）。 */
export const NOISE_VOLUME_MIN = 0;
export const NOISE_VOLUME_MAX = 1;
export const NOISE_VOLUME_DEFAULT = 0.4;

/** 把任意输入夹成合法音量。非数 / 越界都落到 [0,1]；NaN 回默认。 */
export function clampNoiseVolume(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return NOISE_VOLUME_DEFAULT;
  return Math.min(NOISE_VOLUME_MAX, Math.max(NOISE_VOLUME_MIN, value));
}

/** 是不是一个已登记的噪声种类。 */
export function isNoiseKind(value: unknown): value is NoiseKind {
  return value === 'rain' || value === 'white' || value === 'brown';
}

/** 持久化的偏好形状。 */
export interface NoisePref {
  readonly enabled: boolean;
  readonly kind: NoiseKind;
  readonly volume: number;
}

export const DEFAULT_NOISE_PREF: NoisePref = {
  enabled: false,
  kind: 'rain',
  volume: NOISE_VOLUME_DEFAULT,
};

const STORAGE_KEY = 'heyta.focus-noise';

/**
 * 生成一段可循环的单声道噪声采样。
 *
 * **纯函数**：给同一个 `rand` 序列与参数，输出逐位相同 —— 所以单测能验证
 * "白噪音零均值 / 棕噪音更平滑"这类真实属性，而不是只看"没抛错"。
 *
 * @param kind       噪声种类（决定 fill 算法）
 * @param sampleRate 采样率（AudioContext 通常是 44100 或 48000）
 * @param seconds    时长（秒）；循环播放时取几秒即可
 * @param rand       均匀随机源 [0,1)，默认 `Math.random`；单测注入可复现序列
 */
export function generateNoiseSamples(
  kind: NoiseKind,
  sampleRate: number,
  seconds: number,
  rand: () => number = Math.random,
): Float32Array {
  const fill = NOISE_PRESETS[kind].fill;
  const length = Math.max(1, Math.floor(sampleRate * seconds));
  const out = new Float32Array(length);

  if (fill === 'brown') {
    // 棕噪音 = 白噪音的积分（带泄漏，防止直流漂移），再归一化到 [-1,1]。
    let last = 0;
    let peak = 1e-9;
    for (let i = 0; i < length; i += 1) {
      const white = rand() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      out[i] = last;
      if (Math.abs(last) > peak) peak = Math.abs(last);
    }
    for (let i = 0; i < length; i += 1) out[i] = (out[i] ?? 0) / peak;
    return out;
  }

  // 白噪音：独立均匀采样，天然零均值、无相邻相关。
  for (let i = 0; i < length; i += 1) out[i] = rand() * 2 - 1;
  return out;
}

/** 读持久化的白噪音偏好。任一字段不合法就逐字段回落（同 `focus-config` 的纪律）。 */
export function loadNoisePref(): NoisePref {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return DEFAULT_NOISE_PREF;
  }
  if (raw === null) return DEFAULT_NOISE_PREF;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_NOISE_PREF;
  }
  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_NOISE_PREF;
  const record = parsed as Record<string, unknown>;

  return {
    enabled: record.enabled === true,
    kind: isNoiseKind(record.kind) ? record.kind : DEFAULT_NOISE_PREF.kind,
    volume: clampNoiseVolume(record.volume),
  };
}

/** 写持久化的白噪音偏好（先夹取音量，永远不写非法值）。 */
export function saveNoisePref(pref: NoisePref): void {
  const safe: NoisePref = {
    enabled: pref.enabled,
    kind: isNoiseKind(pref.kind) ? pref.kind : DEFAULT_NOISE_PREF.kind,
    volume: clampNoiseVolume(pref.volume),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  } catch {
    // 存不上不影响本次生效（同 `focus-config`）。
  }
}

/** 仅供测试：清掉持久化偏好。 */
export function __clearNoisePrefForTests(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 同 saveNoisePref 的防御姿态。
  }
}
