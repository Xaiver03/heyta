# 设置页 UI 治理计划

**日期**: 2026-11-04  
**来源**: 三份审计报告（ui-ux-pro-max / apple-design / design-taste-frontend）的根因分析

---

## 问题根因

三份审计的共识：

1. **门禁按字面拼写设卡，换写法即绕过** —— `check:control-semantics` 点名了 `ht-btn--outline` 却没拒绝它
2. **动效/状态表征被当可选装饰** —— 文字反馈做到了工业级诚实，但 spinner 不转、sheet 无退场
3. **行语法未收敛** —— 同屏 ≥5 套"设置行解剖"，是 2026-10-24 重排的残留
4. **产品禁令执行过头** —— "严禁说明文字只准问号"导致整屏可见引导≈0

---

## 治理项

### G-1 门禁升级：拒绝未定义的按钮色调

**判据**: TSX 里 `className="ht-btn ht-btn--X"` 的 X 必须落在 CSS 已定义的档位集合内。

**实现**:
- 在 `scripts/check-control-semantics.mjs` 里补一条扫描
- 从 `controls.css` 提取所有 `.ht-btn--*` 类名作为白名单
- 扫 `apps/web/src/**/*.tsx` 里 `ht-btn--` 后跟的标识符，不在白名单即红
- 变异验证：临时写一个 `ht-btn--foo` 必须让门禁红

**优先级**: 高（防住下一次同类缺陷）

---

### G-2 新增尺：danger 语义色校验

**判据**: 渲染 `className="ht-settings__danger"` 的元素，其计算 `color` 必须等于 `--ht-color-danger`。

**实现**:
- 在 Playwright 的 settings 面板 spec 里加一条断言
- 取任意一个 `.ht-settings__danger` 元素，读 `getComputedStyle(el).color`
- 与 `--ht-color-danger` 解析后的 rgb 值比对

**优先级**: 高（C-1 类缺陷的防回归）

---

### G-3 字号纪律：可见消息禁 2xs

**判据**: `role="status"` / `role="alert"` / `.ht-settings__danger` / `.ht-settings__notice` 的 `font-size` 必须 ≥ `--ht-font-size-xs`（12px）。

**实现**:
- CSS lint 规则：扫 `ai-panels.css` 里这些类的 `font-size` 声明
- 或 Playwright 断言：对每个可见消息元素读计算字号

**优先级**: 中（H-1 类缺陷的防回归）

---

### G-4 统一 SettingsRow 组件契约

**目标**: 把同屏 ≥5 套行解剖收敛为一份 `SettingsRow` 组件，新面板强制使用。

**设计**:
```tsx
interface SettingsRowProps {
  label: string;
  tooltip?: { text: string; testId: string };
  children: React.ReactNode;
  testId?: string;
}
```

**迁移路径**:
1. 先抽组件（不改行为）
2. 逐面板迁移（ProfilePanel → PasskeyPanel → SessionsPanel → ...）
3. 每步跑 `check:ui-language` + typecheck

**优先级**: 中（长期维护成本，但本轮不阻塞）

---

### G-5 动效表征一等公民

**目标**: 状态表征（busy/done/error）必须有视觉动效，不能只靠文字。

**规则**:
- 所有 `<Loader2>` 必须带 `className="ht-spin"`
- 所有浮层/sheet 必须有对称的进出动画
- 门禁：grep `<Loader2` 不带 `ht-spin` 即红

**优先级**: 中（F-01 类缺陷的防回归）

---

### G-6 产品禁令校准

**现状**: "严禁说明文字只准问号" 执行过头，整屏可见引导≈0。

**建议**:
- 每个面板允许 **1 条**可见引导句（如"留空则显示邮箱"）
- 超过 1 条才进 `?`
- 这条需要产品负责人拍板，不在工程侧自决

**优先级**: 需产品决策

---

## 执行节奏

| 周次 | 做什么 | 状态 |
|---|---|---|
| W1（本轮） | G-1 + G-2 落地为门禁 | G-1 ✅（账本清空，A4 硬拒）；G-2 待 Playwright 臂 |
| W1（本轮） | G-3 + G-5 落地为门禁 | G-3 ✅ `check-font-size-discipline.mjs`；G-5 ✅ `check-spinner-discipline.mjs` |
| W3-W4 | G-4 SettingsRow 抽取 + ProfilePanel 迁移 | 待做（大型重构，不阻塞） |
| 待产品拍 | G-6 禁令校准 | 需产品负责人决策 |

---

## 验证方式

每条新门禁必须：
1. 在违规输入下真的会红（AGENTS §6 第 2 条）
2. 有变异臂（临时注入违规 → 门禁红 → 撤销 → 门禁绿）
3. 写进 `docs/agents/commands.md` 的 `verify:*` 列表
