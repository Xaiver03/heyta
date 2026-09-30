/**
 * 快速捕捉复刻件的**形状登记处**（纯数据，不 import React）
 * ==========================================================
 *
 * 复现对象：`packages/ui/src/capture/CaptureComposer.tsx`（M3 第八刀起，共享实现，
 * web 与 mobile 共用）+ `apps/web/src/features/capture/CaptureComposer.tsx`
 * 宿主注入的两条文案。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么需要它（与 `habit-shape.ts` / `quadrant-shape.ts` / `app-shell-shape.ts` 同一理由）
 *
 * `docs/research/dida-view-unification.md` §9.1 是**永久判决**：
 * `apps/landing/src/mockup/**` 静态 import `@heyta/ui` 会让首屏
 * **+61.9 kB gzip（+31%）**。替代约束是「**纯数据登记处 + 会红判据**」——
 * 本文件是登记处，`tests/mockup-capture-shape.spec.tsx` 是会红判据。
 *
 * 没有登记处时，捕获输入行会在 `AppWindow.tsx` 里被手抄成两个 div
 * （一个 `.mk-input` + 一个 `.mk-btn-primary`），而它抄的是**另一族组件**的
 * 取值：`.mk-btn-primary` 同时被 `FocusRing.tsx` 用着，那一族对应的是
 * `FocusPanel` 的按钮（`paddingHorizontal: space.4`、`gap: space.2`）——
 * 于是捕获这一块看起来"有类名、有样式"，但每个数值都是隔壁邻居的。
 * 这类漂移**没有任何门禁看得见**（`check:design` 管取值来源、`check:ui-language`
 * 管硬编码文案，没有一条在问"复刻抄的是不是这一个组件的取值"）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 复刻的是**空态**：芯片与预览都不该出现
 *
 * 共享组件只有在 `chips.length > 0` 时才渲染识别芯片与「实际标题」预览；
 * 空输入框下两者都不渲染。展厅这一格画的就是空输入框（显示 placeholder），
 * 所以**没有芯片不是缺口，是空态的全部内容**。判据把这条写成断言：
 *
 *   · 真实现仍然用 `chips.length > 0` 守着那两块（它一旦改成"总是渲染"，
 *     复刻的空态就不再等价 → 红）；
 *   · 复刻渲染出来的行里**恰好两个**子元素（输入框 + 按钮）。
 *
 * ⚠️ 反过来说清楚：**本登记处不画**"输入一段话 → 看见读懂了什么"这个签名交互。
 * 那是捕获真正的卖点，也是营销页目前没有演示的东西 —— 已如实登记在
 * `docs/plans/multi-platform-adaptation.md` 的第八刀 3.5 步那一节，别当它不存在。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 类名为什么带 `--capture` 修饰符，而不是直接改基础规则
 *
 * `mockup.css` 的 `.mk-input` / `.mk-btn-primary` 是**两个组件共用**的：
 * `FocusRing.tsx` 的「暂停」按钮与「关联任务」行也在用，而 `FocusPanel` 的按钮
 * 确实是 `space.4` / `space.2`。所以捕获这一块只加修饰类去覆盖**它自己那一组**
 * 取值，基础规则一字不动 —— 改基础规则等于顺手改掉另一个复刻件的保真度。
 *
 * ⚠️ `mk-*` 前缀族有**只减不增**的预算（`mockup-task-row.spec.tsx`，
 * 当前 32/32 已顶格）。修饰类不新增族（`^\.mk-[a-z0-9]+` 只取到 `mk-input` /
 * `mk-btn`），所以这里**不能**新建 `mk-capture*` 这类族名。
 */

import type { MessageKey } from '@heyta/i18n/provider';

/**
 * 复刻件输入框里的草稿：**空字符串**。
 *
 * 🔴 这是"芯片与预览为什么都不渲染"的唯一理由（见文件头）。
 * 它必须与 `MOCK_CAPTURE_CAN_SUBMIT` 一致 —— 空草稿 ⇒ 标题为空 ⇒ 不许提交。
 */
export const MOCK_CAPTURE_DRAFT = '';

/**
 * 空草稿下能不能提交。
 *
 * 共享层算出来的值是 `false`（`captureCanSubmit(parsed)`：去掉识别片段后标题为空
 * 不许提交），按钮因此带 `state.disabled-opacity`。
 * 复刻原来把这个按钮画成**全不透明**的 —— 访客看到的是一个"能点"的添加按钮，
 * 装上的应用里它在空输入框下是灰的。
 */
export const MOCK_CAPTURE_CAN_SUBMIT = false;

/**
 * 提交按钮里 `+` 图标的边长（px）。
 *
 * 真实现是 `tokens['icon.sm']`（`--ht-icon-sm`，1rem = 16px）。
 * 纯数据模块拿不到 token 表（那会把 `@heyta/design-system` 的 native 表
 * 带进首屏），所以这里登记**数值**，由判据与 `icon.sm` 对账。
 */
export const MOCK_CAPTURE_ADD_ICON_SIZE = 16;

/** 复刻件用到的类名。基础类是共用的，`--capture` 修饰类才是捕获自己的取值。 */
export const MOCK_CAPTURE_CLASS = {
  /** 输入行容器（= 共享组件的 `compose` 那一行）。 */
  row: 'mk-compose',
  /** 输入框：基础 `.mk-input` + 捕获修饰类。 */
  input: 'mk-input mk-input--capture',
  /** 提交按钮：基础 `.mk-btn-primary` + 捕获修饰类。 */
  add: 'mk-btn-primary mk-btn-primary--capture',
  /** 空标题时的按钮态：真实现给的是 `opacity: state.disabled-opacity`。 */
  addOff: 'mk-btn-primary--off',
} as const;

/**
 * 复刻件渲染的两条文案，**用应用自己的 key**（`web.capture.*`）。
 *
 * ⚠️ 不是 `landing.mock.*`：宿主 `features/capture/CaptureComposer.tsx` 注入的
 * 就是这两条，中文逐字相同 —— 那正是最舒服的漂移藏身处（抄错 key 看不出来）。
 *
 * 共享组件一共要 13 条 `web.capture.*` 文案（`labels` 的每一项），
 * 另外 11 条（`addLabel` / `matchesAria` / `rejected` / `unused` / `previewLead` /
 * `previewEmpty` / `restoreAria` / `ignoreAria` / `priority.*`）属于**芯片与预览**
 * 这两个本复刻件不画的状态，登记在真实现那边由 `packages/ui/tests` 与
 * `apps/web/tests` 管。
 */
export const MOCK_CAPTURE_KEYS = {
  placeholder: 'web.capture.placeholder',
  add: 'web.capture.add',
} as const satisfies Record<string, MessageKey>;

/** 提交按钮的类名：空标题时追加"禁用态"那一笔。 */
export function mockCaptureAddClass(canSubmit: boolean): string {
  return canSubmit
    ? MOCK_CAPTURE_CLASS.add
    : `${MOCK_CAPTURE_CLASS.add} ${MOCK_CAPTURE_CLASS.addOff}`;
}

/**
 * 真实现里守着"有识别才渲染"的那两个条件（判据按源码文本核对）。
 *
 * ⚠️ 登记成常量而不是写在 spec 里：它是**真实现的行为**，复刻的空态等价性
 * 完全建立在它之上 —— 放在这里，改动它的人会先看到这段注释。
 */
export const MOCK_CAPTURE_LIVE_GUARD = 'chips.length > 0';