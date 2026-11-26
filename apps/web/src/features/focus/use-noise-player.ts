/**
 * 白噪音播放器（覆盖图谱 #51）
 * ============================
 *
 * 把 `lib/focus-noise.ts` 的纯参数接到**真实 Web Audio**：
 * 一段可循环的噪声 buffer → 单枚 BiquadFilter（预设决定）→ 增益 → 扬声器。
 *
 * 三条约束：
 *  1. **不引音频素材**：buffer 由 `generateNoiseSamples` 现场算，所以没有许可证问题；
 *  2. **仅在 `enabled` 时创建 AudioContext**：无用户手势时创建会被浏览器挂起并告警，
 *     而"点开关"本身就是用户手势 —— 延迟到这一刻创建最稳；
 *  3. **离开专注页就停**：组件卸载即 `stop()` + `close()`，不留后台噪音。
 */

import { useEffect, useRef } from 'react';

import { NOISE_PRESETS, generateNoiseSamples, type NoiseKind } from '../../lib/focus-noise.js';

/** 循环 buffer 的时长（秒）。够长到听不出循环点，又不吃内存。 */
const LOOP_SECONDS = 4;

export interface NoisePlayerOptions {
  readonly enabled: boolean;
  readonly kind: NoiseKind;
  readonly volume: number;
}

/** 取当前环境的 AudioContext 构造器（必要时回退 webkit 前缀）。没有就返回 undefined。 */
function audioContextCtor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') return undefined;
  const maybe = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return maybe.AudioContext ?? maybe.webkitAudioContext;
}

export function useNoisePlayer({ enabled, kind, volume }: NoisePlayerOptions): void {
  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);

  // 建立 / 拆除音频图。种类变化要重建（滤波器参数不同），音量变化不用。
  useEffect(() => {
    if (!enabled) return;
    const Ctor = audioContextCtor();
    if (Ctor === undefined) return;

    const ctx = new Ctor();
    ctxRef.current = ctx;

    const preset = NOISE_PRESETS[kind];
    const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * LOOP_SECONDS)), ctx.sampleRate);
    buffer.copyToChannel(generateNoiseSamples(kind, ctx.sampleRate, LOOP_SECONDS), 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    let tail: AudioNode = source;
    if (preset.filter !== null) {
      const filter = ctx.createBiquadFilter();
      filter.type = preset.filter.type;
      filter.frequency.value = preset.filter.frequencyHz;
      filter.Q.value = preset.filter.q;
      source.connect(filter);
      tail = filter;
    }

    const gain = ctx.createGain();
    gain.gain.value = volume;
    tail.connect(gain);
    gain.connect(ctx.destination);
    gainRef.current = gain;

    source.start();

    return () => {
      try {
        source.stop();
      } catch {
        // 已经停了：忽略。
      }
      gainRef.current = null;
      ctxRef.current = null;
      void ctx.close();
    };
    // `volume` 故意不在依赖里：音量用下面那条 effect 平滑调整，不重建整张图。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, kind]);

  // 音量变化：平滑过渡（setTargetAtTime 避免爆音）。
  useEffect(() => {
    const gain = gainRef.current;
    const ctx = ctxRef.current;
    if (gain === null || ctx === null) return;
    gain.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
  }, [volume]);
}
