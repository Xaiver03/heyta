/**
 * 动效试验台：六条笔记动效的**并排对照实现**
 * ============================================
 *
 * 每个 demo 都是同一个交互的两份实现：
 *
 *   左（`raw`）  —— 笔记原文的参数，**只用于对照**，任何一条都不得进入产品代码
 *   右（`tuned`）—— 换成设计系统的 token 与弹簧语义
 *
 * 🔴 为什么必须并排、而不是各写一页
 *
 * 动效的判断只能靠**同时看见**。分两次看，人记住的是"大概样子"，
 * 而这里要判断的恰恰是 28.4% 与 1.5% 过冲的差别、250ms 与 300ms 的差别 ——
 * 那种差别在记忆里不存在，只在并排时存在。
 *
 * 🔴 左侧的裸值是这个文件的**唯一许可**
 *
 * 它们不是"漏改"，是被研究对象本身：笔记给的就是 `stiffness: 260`、
 * `450ms`、`0.28`。把它们换成 token 就等于把被测物掉包，对照失去意义。
 * 每一处裸值旁都标了它撞的是哪条规则，读完即可删。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useSpring } from 'motion/react';

import { toSpringPhysics } from '@heyta/design-system';

import { noteSpringToDesignSystem, NOTE_SPRINGS, type NoteSpring } from './specs.js';

/* ────────────────────────────────────────────────────────────
   共用零件
   ──────────────────────────────────────────────────────────── */

/** 左/右两栏的容器。窄屏折成一列 —— 折起来时"并排"这个前提消失，
    所以每栏自己的标题必须仍然写清是哪一版。 */
export function Panes({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="lab-panes">{children}</div>;
}

export function Pane({
  tone,
  label,
  children,
}: {
  tone: 'raw' | 'tuned';
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={`lab-pane lab-pane--${tone}`}>
      <span className="lab-pane__tag">{label}</span>
      <div className="lab-pane__body">{children}</div>
    </div>
  );
}

/** 笔记弹簧 → Motion 的 `useSpring` 选项。质量恒为 1，与 `toSpringPhysics` 同一条假设。 */
function springOptionsFor(note: NoteSpring): { stiffness: number; damping: number; mass: number } {
  return { stiffness: note.stiffness, damping: note.damping, mass: 1 };
}

/**
 * 开关的滑块位移（px）= 轨道 56 − 两侧内边距 2×2 − 滑块 28。
 *
 * Motion 的 `x` 只认 px 数字与百分比；这里用数字而不是 `100%`，
 * 是因为百分比的基准是**滑块自身宽度**（28），会滑不到轨道末端。
 */
const SWITCH_TRAVEL_PX = 24;

/* ────────────────────────────────────────────────────────────
   1. 按压回弹
   ──────────────────────────────────────────────────────────── */

/**
 * 按下缩、松手弹回。
 *
 * 🔴 笔记版与设计系统版的差别**全在阻尼**：两版的缩放深度也不同
 * （0.94 / 当前 `--ht-motion-press-scale`），但真正决定读感的是 28.4% 过冲 ——
 * 按下时元素会越过 0.94 继续缩一点再回来。这就是"颤"。
 */
/**
 * 读一个数值型 token。
 *
 * 🔴 右边这一栏**不许写死 0.97**：它是"设计系统版"，而设计系统的取值在
 * `tokens.css` 里。写死之后，`--ht-motion-press-scale` 改过（2026-11-15 从
 * 0.97 改到 0.95），这一页会继续展示旧值 —— 一个说自己是"对照"却照着旧尺子
 * 量的页面，比没有这一页更坏。
 */
function readScaleToken(name: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function PressDemo(): React.JSX.Element {
  const note = NOTE_SPRINGS.press!;
  const ds = noteSpringToDesignSystem(note).dampingRatio;
  const pressScale = readScaleToken('--ht-motion-press-scale', 0.95);

  const rawScale = useSpring(1, springOptionsFor(note));
  const tunedScale = useSpring(1, springOptionsFor({ stiffness: 246.74, damping: 31.42 }));

  return (
    <Panes>
      <Pane tone="raw" label={`笔记参数 · ζ=${ds.toFixed(2)} · 过冲 28.4%`}>
        <motion.button
          type="button"
          className="lab-btn lab-btn--raw"
          style={{ scale: rawScale }}
          onPointerDown={() => rawScale.set(0.94)}
          onPointerUp={() => rawScale.set(1)}
          onPointerLeave={() => rawScale.set(1)}
        >
          按下我
        </motion.button>
      </Pane>
      <Pane tone="tuned" label={`设计系统 · press-scale ${pressScale} · ζ=1.00`}>
        <motion.button
          type="button"
          className="lab-btn"
          style={{ scale: tunedScale }}
          onPointerDown={() => tunedScale.set(pressScale)}
          onPointerUp={() => tunedScale.set(1)}
          onPointerLeave={() => tunedScale.set(1)}
        >
          按下我
        </motion.button>
      </Pane>
    </Panes>
  );
}

/* ────────────────────────────────────────────────────────────
   2. 弹性开关
   ──────────────────────────────────────────────────────────── */

/**
 * 滑块拉伸 1.35 倍。
 *
 * ⚠️ 左侧的 `280` 是笔记原值，它落在 `--ht-duration-normal`(200) 与
 * `--ht-duration-slow`(300) 之间 —— 设计系统里**没有这一档**，这正是"裸值"
 * 的含义：它不属于任何既有刻度，无法被调参统一影响。
 */
export function SwitchDemo(): React.JSX.Element {
  const note = NOTE_SPRINGS.switch!;
  const [rawOn, setRawOn] = useState(false);
  const [tunedOn, setTunedOn] = useState(false);
  /**
   * 拉伸是**一次性脉冲**：只在切换的瞬间出现 ~140ms。
   *
   * 🔴 用状态驱动而不是关键帧数组 `[1, 1.35, 1]`：Motion 按**解析后的值序列**
   * 判断要不要重播，同一组关键帧在第二次点击时被当作"没变"直接跳过 ——
   * 实测就是这样：`x` 位移了 24px，`scaleX` 一动不动停在 1。
   */
  const [stretching, setStretching] = useState(false);
  const stretchTimer = useRef<number | null>(null);

  const pulseStretch = useCallback(() => {
    setStretching(true);
    if (stretchTimer.current !== null) window.clearTimeout(stretchTimer.current);
    stretchTimer.current = window.setTimeout(() => setStretching(false), 140);
  }, []);

  useEffect(
    () => () => {
      if (stretchTimer.current !== null) window.clearTimeout(stretchTimer.current);
    },
    [],
  );

  return (
    <Panes>
      <Pane tone="raw" label="笔记参数 · scaleX 1.35 · 280ms">
        <button
          type="button"
          className={`lab-switch lab-switch--raw${rawOn ? ' is-on' : ''}`}
          onClick={() => {
            setRawOn((v) => !v);
            pulseStretch();
          }}
          aria-pressed={rawOn}
          aria-label="笔记版开关"
        >
          <motion.span
            className="lab-switch__thumb"
            animate={{ x: rawOn ? SWITCH_TRAVEL_PX : 0, scaleX: stretching ? 1.35 : 1 }}
            transition={{
              x: { type: 'spring', ...springOptionsFor(note) },
              /* 🔴 笔记只给了"拉伸 1.35"，没给拉伸本身的时长/曲线 —— 140ms 是
                 为了让"拉长→收回"能看清而取的展示值，不是从笔记抄来的。 */
              scaleX: { duration: 0.14, ease: 'easeOut' },
            }}
          />
        </button>
        <p className="lab-hint">滑块被拉长 35%；切到右端时右侧会被轨道裁掉一角</p>
      </Pane>
      <Pane tone="tuned" label="设计系统 · 无拉伸 · duration-normal 200ms">
        <button
          type="button"
          className={`lab-switch${tunedOn ? ' is-on' : ''}`}
          onClick={() => setTunedOn((v) => !v)}
          aria-pressed={tunedOn}
          aria-label="设计系统版开关"
        >
          <motion.span
            className="lab-switch__thumb"
            animate={{ x: tunedOn ? SWITCH_TRAVEL_PX : 0 }}
            transition={{
              type: 'spring',
              ...toSpringPhysics(1, 0.4),
            }}
          />
        </button>
        <p className="lab-hint">位置用弹簧，底色用 200ms —— 不拉长</p>
      </Pane>
    </Panes>
  );
}

/* ────────────────────────────────────────────────────────────
   3. 波纹跟手
   ──────────────────────────────────────────────────────────── */

interface Ripple {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

/**
 * 点击点扩散的波纹。
 *
 * 🔴 这一条是**不建议**：波纹是 Material 的交互语言，本仓按下反馈用
 * `--ht-state-pressed-opacity` 的叠加层表达。左侧保留它，是为了看见
 * "同一处按下，两个设计语言的区别"，不是候选方案。
 */
export function RippleDemo(): React.JSX.Element {
  const [ripples, setRipples] = useState<readonly Ripple[]>([]);
  const seq = useRef(0);

  const spawn = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    seq.current += 1;
    const id = seq.current;
    setRipples((prev) => [...prev, { id, x: event.clientX - rect.left, y: event.clientY - rect.top }]);
    // 450ms 之后移除节点。这里用定时器而不是动画回调，是因为
    // 移除与动画时长必须是**同一个数**，而动画的 `onComplete` 在快速连点时会乱序。
    window.setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, 450);
  }, []);

  return (
    <Panes>
      <Pane tone="raw" label="笔记参数 · 450ms · 2.4× · 0.28">
        <button type="button" className="lab-btn lab-btn--raw lab-btn--ripple" onPointerDown={spawn}>
          连点看波纹
          {ripples.map((r) => (
            <motion.span
              key={r.id}
              className="lab-ripple"
              style={{ left: r.x, top: r.y }}
              initial={{ scale: 0, opacity: 0.28 }}
              animate={{ scale: 2.4, opacity: 0 }}
              transition={{ duration: 0.45, ease: 'easeOut' }}
            />
          ))}
        </button>
      </Pane>
      <Pane tone="tuned" label="设计系统 · state-pressed 0.08 · 100ms">
        <button type="button" className="lab-btn lab-btn--pressed">按住我</button>
        <p className="lab-hint">按下 = 叠加 8% 状态层，无扩散、无位移</p>
      </Pane>
    </Panes>
  );
}

/* ────────────────────────────────────────────────────────────
   4. 点赞反馈 → 勾完一条任务
   ──────────────────────────────────────────────────────────── */

const PARTICLES = 8;

/**
 * 爱心 1.3 + 8 个粒子，改造成"勾完一条任务"。
 *
 * 🔴 关键判断：`ζ=0.289`（38.8% 过冲）**不能**落在勾选框上。勾选是每天几十次
 * 的动作，每次都颤会变成噪音；它只适合"完成"这种一次性、可庆祝的时刻。
 * 所以右侧把它拆成两拍：勾选框用临界阻尼（稳），庆祝用动量档（有生命）。
 */
export function TaskDoneDemo(): React.JSX.Element {
  const note = NOTE_SPRINGS.like!;
  const [liked, setLiked] = useState(false);
  const [done, setDone] = useState(false);

  const dsMomentum = toSpringPhysics(0.8, 0.4);
  const dsSteady = toSpringPhysics(1, 0.4);

  return (
    <Panes>
      <Pane tone="raw" label={`笔记参数 · 1.3× · ζ=${noteSpringToDesignSystem(note).dampingRatio.toFixed(2)} · 过冲 38.8%`}>
        <div className="lab-like">
          <motion.button
            type="button"
            className={`lab-heart${liked ? ' is-liked' : ''}`}
            onClick={() => setLiked((v) => !v)}
            aria-pressed={liked}
            aria-label="点赞"
            animate={{ scale: liked ? [1, 1.3, 1] : 1 }}
            transition={{ scale: { type: 'spring', ...springOptionsFor(note) } }}
          >
            ♥
            {liked
              ? Array.from({ length: PARTICLES }, (_, i) => {
                  const angle = (Math.PI * 2 * i) / PARTICLES;
                  return (
                    <motion.span
                      key={i}
                      className="lab-particle"
                      initial={{ x: 0, y: 0, opacity: 1 }}
                      animate={{ x: Math.cos(angle) * 34, y: Math.sin(angle) * 34, opacity: 0 }}
                      transition={{ duration: 0.45, ease: 'easeOut' }}
                    />
                  );
                })
              : null}
          </motion.button>
          <p className="lab-hint">38.8% 过冲：回弹时会越过 1 再收一下</p>
        </div>
      </Pane>
      <Pane tone="tuned" label="设计系统 · 勾选框 ζ=1 / 庆祝 ζ=0.8">
        <button
          type="button"
          className={`lab-task${done ? ' is-done' : ''}`}
          onClick={() => setDone((v) => !v)}
          aria-pressed={done}
        >
          <motion.span
            className="lab-check"
            animate={{ scale: done ? [0.8, 1] : 1 }}
            transition={{ scale: { type: 'spring', ...dsSteady } }}
          >
            {done ? (
              <svg viewBox="0 0 20 20" aria-hidden="true" className="lab-check__tick">
                <path d="M4.5 10.5 L8.5 14.5 L15.5 6.5" />
              </svg>
            ) : null}
          </motion.span>
          <span className="lab-task__label">勾完一条任务</span>
          {done ? (
            <motion.span
              className="lab-task__celebrate"
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', ...dsMomentum, delay: 0.12 }}
            >
              ✓ 完成
            </motion.span>
          ) : null}
        </button>
      </Pane>
    </Panes>
  );
}

/* ────────────────────────────────────────────────────────────
   5. 复选框（六条里唯一开箱就对的）
   ──────────────────────────────────────────────────────────── */

/**
 * 方框 0.8→1 + 对勾 300ms 描边。
 *
 * 笔记这一条**没给刚度阻尼**，只说"弹性放大"。所以左侧只能照做：
 * 用 CSS 的 `--ht-ease-spring`（一条带 10% 过冲的缓动曲线）——
 * 这是"说不清物理、只能给条曲线"的典型写法。
 * 右侧换成真弹簧（ζ=1 / response=0.3），差别在于**能不能被中途接住**。
 */
export function CheckboxDemo(): React.JSX.Element {
  const [rawOn, setRawOn] = useState(true);
  const [tunedOn, setTunedOn] = useState(true);

  return (
    <Panes>
      <Pane tone="raw" label="笔记原文 · 无弹簧参数 · ease-spring 曲线">
        <div className="lab-checks">
          {[0, 1, 2].map((i) => (
            <button
              key={i}
              type="button"
              className={`lab-check-row${i === 0 ? (rawOn ? ' is-on' : '') : ' is-on'}`}
              onClick={() => i === 0 && setRawOn((v) => !v)}
            >
              <span className={`lab-check lab-check--curve${i === 0 ? (rawOn ? ' is-on' : '') : ' is-on'}`}>
                <svg viewBox="0 0 20 20" aria-hidden="true" className="lab-check__tick">
                  <path d="M4.5 10.5 L8.5 14.5 L15.5 6.5" />
                </svg>
              </span>
              <span className="lab-task__label">曲线：{i === 0 ? '看它弹' : '第 ' + (i + 1) + ' 条'}</span>
            </button>
          ))}
        </div>
      </Pane>
      <Pane tone="tuned" label="设计系统 · ζ=1 / response 0.3 · 勾 300ms">
        <div className="lab-checks">
          {[0, 1, 2].map((i) => (
            <button
              key={i}
              type="button"
              className="lab-check-row"
              onClick={() => i === 0 && setTunedOn((v) => !v)}
            >
              <motion.span
                className={`lab-check${i === 0 ? (tunedOn ? ' is-on' : '') : ' is-on'}`}
                animate={{ scale: i === 0 ? (tunedOn ? [0.8, 1] : 1) : [0.8, 1] }}
                transition={{ type: 'spring', ...toSpringPhysics(1, 0.3) }}
              >
                {(i === 0 ? tunedOn : true) ? (
                  <svg viewBox="0 0 20 20" aria-hidden="true" className="lab-check__tick">
                    {/*
                      🔴 描边走 CSS，不走 Motion —— 两条实测原因：
                      1. `pathLength` 是 Motion 的 SVG 专有键，但它会写 inline
                         `stroke-dasharray`，与样式表里的同一条属性打架，实测
                         `strokeDasharray` 全程停在样式表的 `12px` 上（勾是瞬间出现的）。
                      2. 更根本的是语义：弹簧描述**位置**，而描边是**路径长度**。
                         300ms 本来就是时长量，正好是 `--ht-duration-slow`。
                    */}
                    <path d="M4.5 10.5 L8.5 14.5 L15.5 6.5" />
                  </svg>
                ) : null}
              </motion.span>
              <span className="lab-task__label">弹簧：{i === 0 ? '看它弹' : '第 ' + (i + 1) + ' 条'}</span>
            </button>
          ))}
        </div>
      </Pane>
    </Panes>
  );
}

/* ────────────────────────────────────────────────────────────
   6. 磁吸
   ──────────────────────────────────────────────────────────── */

/** 左侧的判定半径（120px）与吸偏强度（0.35），都是笔记原值。 */
const NOTE_RADIUS = 120;
const NOTE_PULL = 0.35;
/** 右侧沿用仓库 `Magnetic.tsx` 的取值：吸偏 0.2、上限 8px。 */
const TUNED_PULL = 0.2;
const TUNED_MAX = 8;

/**
 * 指针靠近时按钮被吸过去。
 *
 * 🔴 两版的差别不只是数值：左侧按比例放大且**没有上限**，
 * 指针离得远时会飞出很远；右侧先钳制在 8px 内 ——
 * 这是"导航型 CTA 不是玩具"那条判断（`Magnetic.tsx` 文件头第 3 条）。
 */
export function MagneticDemo(): React.JSX.Element {
  const note = NOTE_SPRINGS.magnetic!;
  const rawX = useSpring(0, springOptionsFor(note));
  const rawY = useSpring(0, springOptionsFor(note));
  const tunedX = useSpring(0, springOptionsFor({ stiffness: 246.74, damping: 31.42 }));
  const tunedY = useSpring(0, springOptionsFor({ stiffness: 246.74, damping: 31.42 }));

  const [near, setNear] = useState(false);
  const [rawActive, setRawActive] = useState(false);
  const [tunedActive, setTunedActive] = useState(false);

  return (
    <Panes>
      <Pane tone="raw" label="笔记参数 · 进入 120px · 强度 0.35 · 无上限">
        <div
          className={`lab-magnet${near ? ' is-near' : ''}${rawActive ? ' is-active' : ''}`}
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const dx = event.clientX - (rect.left + rect.width / 2);
            const dy = event.clientY - (rect.top + rect.height / 2);
            setNear(Math.hypot(dx, dy) <= NOTE_RADIUS);
            setRawActive(true);
            rawX.set(dx * NOTE_PULL);
            rawY.set(dy * NOTE_PULL);
          }}
          onPointerLeave={() => {
            setRawActive(false);
            setNear(false);
            rawX.set(0);
            rawY.set(0);
          }}
        >
          <span className="lab-magnet__zone" aria-hidden="true" />
          <motion.button type="button" className="lab-btn lab-btn--raw" style={{ x: rawX, y: rawY }}>
            吸我过去
          </motion.button>
        </div>
        <p className="lab-hint">虚线是 120px 判定圈；无上限时会飞出圈外</p>
      </Pane>
      <Pane tone="tuned" label="设计系统 · 强度 0.2 · 上限 8px · ζ=1">
        <div
          className={`lab-magnet${tunedActive ? ' is-active' : ''}`}
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const dx = event.clientX - (rect.left + rect.width / 2);
            const dy = event.clientY - (rect.top + rect.height / 2);
            setTunedActive(true);
            const pulled = Math.hypot(dx * TUNED_PULL, dy * TUNED_PULL);
            const clamp = pulled > TUNED_MAX ? TUNED_MAX / pulled : 1;
            tunedX.set(dx * TUNED_PULL * clamp);
            tunedY.set(dy * TUNED_PULL * clamp);
          }}
          onPointerLeave={() => {
            setTunedActive(false);
            tunedX.set(0);
            tunedY.set(0);
          }}
        >
          <motion.button type="button" className="lab-btn" style={{ x: tunedX, y: tunedY }}>
            吸我过去
          </motion.button>
        </div>
        <p className="lab-hint">位移被钳在 8px 内 —— 注意到，但说不清</p>
      </Pane>
    </Panes>
  );
}

/**
 * 键盘可读性兜底：动效消失后，状态仍然要能被看见。
 *
 * `prefers-reduced-motion` 下全部 `--ht-duration-*` 已被 tokens.css 压到 1ms，
 * 但 Motion 的弹簧不受 CSS 变量影响 —— 所以这里额外把位移量归零，
 * 只保留颜色/文字变化（与 `lib/motion.ts` 的第二条通道同一个理由）。
 */
export function useReducedMotionFlag(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent): void => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}
