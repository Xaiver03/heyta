# 落地页动效整改计划

由 `improve-animations` skill 审计产出。判据是 Emil Kowalski 的动效哲学
（见 `~/.agents/skills/improve-animations/AUDIT.md`），取值全部来自该文件，
不凭记忆近似。

- 审计对象：`apps/landing`（落地页，非应用本体）
- 基准提交：`18b34ce`
- 审计方式：4 个只读子代理分 8 个类别并行审计 → 每条发现回到 `file:line` 亲自复核

## 计划表

| # | 标题 | 严重度 | 类别 | 状态 |
| --- | --- | --- | --- | --- |
| 001 | `revealVariants` 缺 transition，全站入场跑在库默认弹簧上 | HIGH | 7 Cohesion & tokens / 2 Easing | DONE |
| 002 | 英雄卡入场位移被指针弹簧覆盖（`y` 通道冲突） | HIGH | 5 Performance / 3 Physicality | DONE |
| 003 | 展厅 coverflow 每帧写 4 个 transform + 永久 `will-change` | HIGH | 5 Performance | DONE |
| 004 | 错峰节奏没有唯一权威（0.06/0.07/0.08/0.16 散落 6 处） | MEDIUM | 7 Cohesion & tokens | DONE |
| 005 | CSS 动效收尾（按下反馈 / 非对称时序 / 材质过渡 / 死 token） | LOW | 3 / 4 / 7 / 8 | DONE |

全部 5 项已实施并通过验证（本目录保留作为可追溯记录）。

> 📁 本目录原先在仓库根下的 `plans/` —— 那是仓库里**唯一**一处游离在 `docs/` 之外的
> 规划目录。已 `git mv` 到 `docs/plans/landing-motion-audit/`，与其它计划同处一地，
> 免得下次有人找"落地页动效审计在哪"时先翻根目录。内容一字未改。

## 验证结果（实施后实测）

- 落地页：`pnpm test` **36 passed**（原 35，新增 1 条钉住 001 的回归）、`tsc` 干净、`pnpm build` 成功
- 仓库 gate：`pnpm check` **EXIT=0**，10 项全绿（含 `check:design` 扫 `apps/landing/src`）
- 真实 Chrome 行为断言：**14/14 通过**，关键几条
  - 英雄卡入场实测最大 `translateY = 32.0px`（正好 2rem）→ 002 修好了「从未执行过」的入场位移
  - 展厅窗口 `transform` 是单条字符串，无残留 transform 键；进入视口 `will-change` 生效、离开后回到 `auto`
  - `prefers-reduced-motion: reduce` 下英雄卡 `transform: none`、展厅无 3D 变换、淡入保留
  - 无 console error / 未捕获异常
- 截图核对：亮色 / 暗色 / 390px 移动端 / 展厅 / 自建 / 页脚，布局与 3D 纵深均正常

## 未做（单独评估）

- **WebGL 画布淡入**：`Deferred` + lazy chunk 挂载时 `.lp-sync__canvas` 会突然出现。
  修它需要给 `landing.css` 引入第一个 `@keyframes`，而该文件刻意保持零 keyframes
  （见 `SelfHost.tsx:95-102` 注释）。属于「missed opportunity」，不是缺陷，故未纳入本轮。
- **末尾 CTA 的「高情绪时刻」预算**（`FinalCta.tsx:28` 与普通区块用同一套入场）：
  主观性强，且改动会波及 004 刚统一的节奏，留待专门评估。

## 推荐执行顺序

001 → 002 → 003 → 004 → 005。

依赖关系：

- **001 必须先于 004**：两者都改 `lib/motion.ts` 与同一批调用点，004 的常量要建立在
  001 改完的签名之上。
- **002 与 003 无依赖**，但都改 `landing.css`，串行改避免冲突。
- **005 最后做**：它是收尾项，且其中「消费 `--ht-motion-spring-response-rotation`」
  要等 001 定下 `MotionPreset` 的形状。

## 审计中已排除（刻意设计，不动）

- `Hero.tsx` 指针倾斜用两个独立 X/Y 弹簧、从当前值回中 —— 文件头
  `Hero.tsx:8-19` 已说明理由，符合 AUDIT §4「弹簧携带速度」。
- `SelfHost.tsx` 光标闪烁 `ease: 'linear'` + `repeat: Infinity` —— AUDIT §2
  明确「常量运动用 linear」。
- 导航主题图标 ±90° 旋转的**方向**语义（`Nav.tsx:79-83` 注释）—— 刻意设计。
  其时机（0.4s 弹簧）与页面其余弹簧一致，保留。
- `mockup/*` 装饰性复现件（`pointer-events: none`）—— 刻意静态。
- 展厅 300vh sticky 跨度、SyncScene 有界振荡 —— 注释已说明理由。

## 验证基线

每个计划改完都要跑：

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"
cd apps/landing && pnpm test && pnpm typecheck && pnpm build
cd ../.. && pnpm check          # 必须 EXIT=0
```

并做视觉验证（headless Chrome/CDP 截图：亮色 / 暗色 / 390px 移动端 / reduced-motion）。
