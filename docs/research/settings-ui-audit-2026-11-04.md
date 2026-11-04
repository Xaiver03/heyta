# 设置页 UI 审计报告

**审计日期**: 2026-11-04  
**审计范围**: 设置页账号面板（ProfilePanel + EmailChangePanel）  
**审计框架**: ui-ux-pro-max + Apple HIG + design-taste-frontend

---

## 问题清单

### 🔴 CRITICAL

#### 1. "换一张"按钮无加载反馈
- **位置**: `ProfilePanel.tsx:359-367`
- **症状**: 点击后无视觉变化，用户不知道是否生效
- **违反规则**:
  - ui-ux-pro-max §2 Touch & Interaction: `loading-buttons` - "Disable button during async operations; show spinner or progress"
  - Apple HIG §1 Response: "Respond on pointer-down, not on release"
- **对比**: `EmailChangePanel.tsx:324-329` 正确实现了 Loader2 图标
- **修复**: 
  1. 添加 `disabled={avatarNotice.kind === 'busy'}` 
  2. 添加 Loader2 图标（需 import）

---

### 🟠 HIGH

#### 2. 昵称输入框无宽度约束
- **位置**: `ProfilePanel.tsx:407-431`
- **症状**: 输入框铺满整行，宽屏上非常难看
- **违反规则**:
  - ui-ux-pro-max §8 Forms & Feedback: 表单字段应有合理宽度
  - Apple HIG §15 Typography: "Limit to 65-75 characters per line"
  - design-taste-frontend §4.6: "Label ABOVE input... Standard gap-2 for input blocks"
- **对比**: `EmailChangePanel.tsx:284` 正确使用 `.ht-settings__field` (max 42rem)
- **修复**: 用 `.ht-settings__field` 包裹输入框 + 按钮

---

### 🟡 MEDIUM

#### 3. 按钮风格一致性待确认
- **位置**: `ProfilePanel.tsx:359-378` vs `422-430`
- **现状**: 
  - 头像行："换一张" + "删除" = `ht-btn--ghost`（透明底）
  - 昵称行："保存昵称" = `ht-btn--primary`（实心底）
- **分析**: 这可能是**有意为之** —— 头像操作是次要动作，昵称保存是主要动作
- **决策**: 保持现状，但需在代码注释中说明理由
- **违反规则**: 无（如果是有意的）

#### 4. 输入框背景与卡片同色
- **位置**: `controls.css:344` + `sheets.css:357-358`
- **症状**: `.ht-input` 背景是 `surface`，卡片也是 `surface` → 无边框感
- **历史**: 文件头注释（line 25）已记录这个问题
- **现状**: `sheets.css:357-358` 已有覆盖规则
- **决策**: 已解决，无需改动

---

### 🟢 LOW / 已实现

#### 5. 按钮按下反馈
- **位置**: `controls.css:173-175`
- **现状**: 已实现 `transform: scale(var(--ht-motion-press-scale))`
- **符合**: Apple HIG §1 Response ✓

#### 6. 按钮禁用状态
- **位置**: `controls.css:153-155`
- **现状**: 已实现 `opacity: var(--ht-state-disabled-opacity)`
- **符合**: ui-ux-pro-max §2 `disabled-states` ✓

#### 7. EmailChangePanel 加载状态
- **位置**: `EmailChangePanel.tsx:324-329`
- **现状**: 已正确实现 Loader2 图标
- **符合**: 所有规则 ✓

---

## 修复计划

### 改动 1: ProfilePanel 昵称行加宽度约束
**文件**: `apps/web/src/features/settings/ProfilePanel.tsx`  
**行数**: 407-431  
**改动**:
```tsx
// 之前
<div className="ht-settings__row-body">
  <div className="ht-settings__actions">
    <input ... />
    <button ... />
  </div>
</div>

// 之后
<div className="ht-settings__row-body">
  <div className="ht-settings__field">  {/* 新增 */}
    <div className="ht-settings__actions">
      <input ... />
      <button ... />
    </div>
  </div>  {/* 新增 */}
</div>
```

### 改动 2: "换一张"按钮加加载状态
**文件**: `apps/web/src/features/settings/ProfilePanel.tsx`  
**行数**: 62 (import), 359-367 (button)  
**改动**:
```tsx
// 1. 添加 import
import { Loader2 } from 'lucide-react';
import { ICON_SIZE } from '@heyta/design-system';

// 2. 修改按钮
<button
  type="button"
  className="ht-btn ht-btn--ghost"
  data-testid="profile-avatar-change"
  disabled={!signedIn || avatarNotice.kind === 'busy'}  // 新增 disabled 条件
  onClick={() => fileRef.current?.click()}
>
  {avatarNotice.kind === 'busy' ? (  // 新增加载图标
    <Loader2 size={ICON_SIZE.xs} aria-hidden="true" />
  ) : null}{' '}
  {t('common.profile.avatar.change')}
</button>
```

### 改动 3: 添加按钮风格一致性注释
**文件**: `apps/web/src/features/settings/ProfilePanel.tsx`  
**行数**: 358-379  
**改动**: 在头像行按钮组上方添加注释，说明为什么用 ghost 而不是 primary

---

## 验证清单

- [ ] 昵称输入框在宽屏上有合理最大宽度（42rem）
- [ ] 点击"换一张"后按钮变灰 + 显示转圈图标
- [ ] 上传完成后按钮恢复可点击
- [ ] 所有按钮风格有明确的代码注释说明理由
- [ ] 运行 `pnpm typecheck` 通过
- [ ] 运行相关测试通过

---

## 根因分析

**为什么会出现这些问题？**

1. **门禁不够严？**  
   - 现有门禁（typecheck, test, check:ui-language）抓不到视觉一致性问题
   - 缺少"表单字段必须包在约束容器里"这类规则

2. **执行规范不够严？**  
   - 规范有（`.ht-settings__field` 存在），但没强制要求所有输入框都用
   - EmailChangePanel 用了，ProfilePanel 没用 —— 同一张卡片两种口径

3. **根本原因**  
   - **设计系统执行层缺口**：规则写了"用语义名不用外观名"，但没规定"输入框必须包在 `.ht-settings__field` 里"
   - **缺少视觉回归测试**：无法自动捕获"输入框全宽难看"这类问题
   - **代码审查盲点**：审查者可能没在宽屏上看过这个页面

**建议的长期改进**：
1. 在 `docs/agents/design-system.md` 添加规则："所有设置页输入框必须包在 `.ht-settings__field` 里"
2. 考虑添加视觉回归测试（如 Chromatic）
3. 在 PR 模板里加一项："在宽屏（1440px+）上验证表单布局"
