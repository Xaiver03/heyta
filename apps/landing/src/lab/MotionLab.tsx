/**
 * 动效参数试验台（dev-only）
 * ==========================
 *
 * 用法：
 *
 *     cd apps/landing
 *     ./node_modules/.bin/vite --root src/lab --port 5190
 *
 * 打开 `http://localhost:5190/`。**它不是站点的一页** —— 不在
 * `src/site/pages.ts` 的注册表里，所以 `gen:entries` 不会为它生成入口、
 * 生产构建的 `input` 也不含它，`sitemap.xml` 更不会有它。
 * 这是刻意的：试验台是给人判断用的，不是要发布的内容。
 *
 * 页面回答一个问题：**这 6 条笔记参数，哪些能进我们的设计系统。**
 * 所以每一节都并排给出「笔记原参数」与「设计系统改法」，并在下面写清
 * 判定依据 —— 依据只有三份：`tokens.css` §3c、`design-system.md` 的禁止裸值、
 * 以及仓库里已经在跑的实现。
 */

import { MOTION_SPECS, noteToDesignSystem, NOTE_SPRINGS, type Verdict } from './specs.js';
import {
  CheckboxDemo,
  MagneticDemo,
  PressDemo,
  RippleDemo,
  SwitchDemo,
  TaskDoneDemo,
  useReducedMotionFlag,
} from './demos.js';

const VERDICT_LABEL: Readonly<Record<Verdict, string>> = {
  fits: '✅ 开箱就对',
  adapt: '🔧 思路可用，参数要换',
  reject: '🚫 不建议',
  worth: '🎯 值得做，但要改造',
};

const DEMOS: Readonly<Record<string, () => React.JSX.Element>> = {
  press: PressDemo,
  switch: SwitchDemo,
  ripple: RippleDemo,
  like: TaskDoneDemo,
  checkbox: CheckboxDemo,
  magnetic: MagneticDemo,
};

export function MotionLab(): React.JSX.Element {
  const reduced = useReducedMotionFlag();
  return (
    <main className="lab">
      <header className="lab__header">
        <h1 className="lab__title">动效参数试验台</h1>
        <p className="lab__lede">
          6 条笔记参数 → 本仓设计系统的换算、命中与判定。左边是笔记原文的实现，右边是换成
          <code>tokens.css</code> 语义之后的同一交互。两栏都<strong>能点</strong>。
        </p>
      </header>

      {reduced ? (
        <p className="lab__reduce">
          你的系统开了「减少动效」：页面里的 CSS 过渡已压到 1ms，但**弹簧不受 CSS 影响** ——
          所以下面两栏仍然会动。这正是本仓 `lib/motion.ts` 要另开一条通道的原因。
        </p>
      ) : null}

      <ConversionTable />

      {MOTION_SPECS.map((spec) => {
        const Demo = DEMOS[spec.id];
        return (
          <section key={spec.id} className="lab__section" id={`sec-${spec.id}`}>
            <div className="lab__section-head">
              <h2 className="lab__section-title">{spec.title}</h2>
              <span className={`lab__verdict lab__verdict--${spec.verdict}`}>{VERDICT_LABEL[spec.verdict]}</span>
            </div>
            <p className="lab__note">笔记原文：{spec.note}</p>
            <p className="lab__scene">放在 heyta 的落点：{spec.scene}</p>
            {Demo === undefined ? null : <Demo />}
            <p className="lab__reason">{spec.reasoning}</p>
            {spec.token === undefined ? null : (
              <p className="lab__token">
                对应 token：<code>{spec.token}</code>
              </p>
            )}
          </section>
        );
      })}

      <footer className="lab__footer">
        <p>
          结论汇总：6 条里 <strong>1 条开箱就对</strong>（复选框）、<strong>2 条已在跑且更克制</strong>
          （按压、磁吸）、<strong>2 条要换参数</strong>（开关、点赞改造）、<strong>1 条不建议</strong>（波纹）。
        </p>
        <p className="lab-hint">试验台的裸值只存在于左侧对照物上；右侧全部走 token，可直接抄进组件。</p>
      </footer>
    </main>
  );
}

/**
 * 换算表。
 *
 * 🔴 这张表是整页的地基：它证明"刚度 260"不是一句手感描述，
 * 而是一组可以换算成阻尼比的数字。回代校验列全为 ✓ 时，
 * 说明这些笔记参数确实落在我们的参数化空间里 —— 只是档位不同。
 */
function ConversionTable(): React.JSX.Element {
  // 🔴 只列**有弹簧参数**的条目。第 3 条（波纹）是时长动效、第 5 条（复选框）
  // 笔记没给刚度阻尼 —— 它们不进这张表，因为"没有 k/c"不是"k/c 不达标"，
  // 混进来会让读者以为它们不及格（而复选框恰恰是唯一开箱就对的那条）。
  const rows = MOTION_SPECS.flatMap((spec) => {
    const note = NOTE_SPRINGS[spec.id];
    return note === undefined ? [] : [{ spec, note, ...noteToDesignSystem(note) }];
  });

  return (
    <section className="lab__section">
      <h2 className="lab__section-title">换算表：笔记的 (k, c) 等于我们的哪一档</h2>
      <div className="lab__table-wrap">
        <table className="lab__table">
          <thead>
            <tr>
              <th scope="col">动效</th>
              <th scope="col">笔记 k / c</th>
              <th scope="col">阻尼比 ζ</th>
              <th scope="col">响应</th>
              <th scope="col">过冲</th>
              <th scope="col">回代校验</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.spec.id}>
                <th scope="row">{row.spec.title}</th>
                <td>
                  {row.note.stiffness} / {row.note.damping}
                </td>
                <td>{row.designSystem.dampingRatio.toFixed(3)}</td>
                <td>{row.designSystem.response.toFixed(3)}s</td>
                <td className={row.designSystem.overshootPercent > 10 ? 'lab__cell--warn' : undefined}>
                  {row.designSystem.overshootPercent.toFixed(1)}%
                </td>
                <td title={`回代：k=${row.roundTrip.stiffness.toFixed(2)} c=${row.roundTrip.damping.toFixed(2)}`}>
                  {row.sameFactory ? '✓ 一致' : '✗ 不一致'}
                </td>
              </tr>
            ))}
                <tr className="lab__row--ref">
              <th scope="row">设计系统默认</th>
              <td>ζ=1 / r=0.4</td>
              <td>1.000</td>
              <td>0.400s</td>
              <td>0.0%</td>
              <td>—</td>
            </tr>
            <tr className="lab__row--ref">
              <th scope="row">设计系统动量档</th>
              <td>ζ=0.8 / r=0.4</td>
              <td>0.800</td>
              <td>0.400s</td>
              <td>1.5%</td>
              <td>—</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="lab-hint">
        过冲 &gt; 10% 标红：那是"明显在颤"的区间。笔记 4 条弹簧里有 3 条落在红区。
      </p>
      <p className="lab-hint">
        第 3 条（波纹）是时长动效、第 5 条（复选框）笔记没给刚度阻尼 ——
        两者不参与弹簧对比：前者本来就不是弹簧，后者缺参数不等于不达标。
      </p>
    </section>
  );
}
