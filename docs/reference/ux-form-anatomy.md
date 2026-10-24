<!-- 现状读数，**不是规范**。规范在 [`../agents/ux-principles.md`](../agents/ux-principles.md)。
     引用本文件之前先按 §0 的命令重跑 —— 这份表会漂，而它漂的方式是"看起来很权威"。 -->

# 表单解剖现状读数（2026-10-24）

只读审计的产物。回答一个问题：**这个仓库里"填一个表单"一共有几种做法。**
读数取自 `apps/web/src/features/**` + `apps/mobile/src` + `packages/ui/src`。

## 0. 复现命令

```bash
# 解剖种类：数"标签在哪、怎么拿到样式"
grep -rn "className=\"ht-habit-create-dialog__field\"" apps/web/src          # 左标签一行一容器（本批新增）
grep -rn "<label" apps/web/src/features --include=*.tsx | wc -l              # 包装式 / 兄弟式都算在内
grep -rn "htmlFor=" apps/web/src/features --include=*.tsx | wc -l            # 兄弟式（htmlFor + CSS 类）
grep -rn "StyleSheet.create" apps/web/src/features --include=*.tsx | wc -l   # 模块级 styles 对象
grep -rn "min-block-size\|min-height\|block-size\|height:" \
  apps/web/src/styles/app/*.css | grep -c "field\|input"                     # 高度权威
```

## 0b. 2026-10-24 之后的读数（**优先看这一段**）

同一个命令重跑：手写 `<label>` **72 处 / 27 文件**（此前审计里说的 84 处是把
设置页与详情面都算进去了，口径差在"是否只数 `<label` 这五个字符"）。

解剖种类从 **6 种收敛到 2 种**，由 `apps/web/src/lib/form/FormField.tsx` 一处实现：

| `layout` | 用在哪 |
|---|---|
| `stacked` 标签在上 | 表单页（一次录入） |
| `inline` 标签在左 | 设置 / 属性面板（扫读已有值） |

判据：`pnpm check:form-anatomy`（手写 `<label>` 只减不增 + `.ht-input-field*` 单一来源）。
⚠️ **只迁移了两处**（添加习惯、新建清单），其余 25 处仍在账本里 —— **收敛不等于清完**。

## 1. 解剖种类（2026-10-24 之前，保留作对照）：**6 种**

| # | 形状 | 代表 | 代价 |
|---|---|---|---|
| 1 | **左标签 / 右控件，一行一容器** | `apps/web/src/features/habits/HabitsView.tsx`（本批），`apps/web/src/styles/app/sheets.css` 的 `.ht-sheet__row` | ✅ 目标形状 |
| 2 | 包装式 `<label>` 内含 `<span>` + 控件（标签在上） | `HabitsView.tsx`（本批之前）、`tasks/TaskOrganizer.tsx`、`tasks/TaskRepeat.tsx`、`tasks/SubtaskPicker.tsx`、`settings/InboundAutomationSettings.tsx` | 字段纵向 76px，一屏放不下 |
| 3 | 兄弟 `<label htmlFor>` + CSS 类 | `categories/CategoryCreateDialog.tsx`、`settings/PasswordPanel.tsx`、`settings/EmailChangePanel.tsx`、`settings/SyncSettingsPanel.tsx` | 无 label 内距约定（见 §2） |
| 4 | 模块级 styles 对象 | `share/JoinSharedListDialog.tsx`、`share/ShareFeature.tsx` | `font: inherit` 没写 ⇒ 回落 UA 13.33px |
| 5 | 共享 `Field`（**存在但只用于设置**） | `auth/AuthForm` 一族、`apps/mobile/src/ui/kit.tsx` | 唯一有解剖的地方，但没被别处复用 |
| 6 | 没有 label | `tasks/TaskDetailCard.tsx`、`apps/mobile/src/ui/habit-goal-slot.tsx` | 可访问名靠 `aria-label` 兜 |

## 2. 四种 label 内距

`0` / `4px` / `8px` / `16px` 各有用例（`HabitGoalEditor.tsx` 是 0；`.ht-settings__field` 有效值 4）。
⇒ 同一产品里"标签离它的控件多远"没有答案。

## 3. 五套高度权威、五种渲染高度

| 高度权威 | 谁在用 | 渲染结果 |
|---|---|---|
| `--ht-size-field-height` | `AuthForm`、`kit.tsx`、`QuadrantBoard` | 44 ✅ |
| `--ht-touch-target-min` | 多数表单输入框（**拿按钮的 token 给字段定高**） | 44，但语义用反 |
| 内容高（`line-height` 撑） | `JoinSharedListDialog`、`ShareFeature` | ≈34 |
| UA 默认 | 零样式的 `<select>` | ≈22 |
| 只给 padding | `admin.css` 那一段 | ≈37 |

🔴 五种里面只有一种是**为字段设计的**。`check:design` 判的是"是不是 token"，
所以"拿按钮的 token 给输入框定高"在它眼里完全合法。

## 4. 结构性结论

1. **tokens 层是唯一长出解剖知识的地方**，但它只能承载值。
   `--ht-layout-form-label-width` 的注释写着一份完整的行解剖规范，
   而它的**消费者只有一个文件**。
2. `packages/ui` **没有** `form/`、**没有** `button/`。所以每个表单自己拼 `<label>+<input>`：
   解剖的重复度 = 手写 `<label>` 的处数（现量见 §0），判据覆盖度 = 0。
3. 门禁粒度是"文件 / 站点 / 读数"，它能**冻结债务**，不能**约束形状**；
   它甚至会**接受**错误形状（`check:overlay` 把自绘模态登记进账本即可）。

## 5. 本批动了什么、没动什么

- ✅ 动了：`HabitsView.tsx` 的这一个对话框（种 1 的形状 + 收起式图标 + 间隔复习）；
  新增 `--ht-layout-form-label-width`；新增 `e2e/tests/habit-create-shape.spec.ts`（S1–S5）。
- ❌ 没动：其余 25 个填表界面、`packages/ui` 的共享原语（**仍未建**）、
  移动端对应界面（`apps/mobile` 的新建习惯仍是"TextField + 主按钮"）。
