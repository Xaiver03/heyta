/**
 * 设置页里的「?」说明（一行标签旁边的那枚问号）
 * =============================================
 *
 * ## 为什么要有它
 *
 * 产品负责人 2026-10-24 的原话：「还搞这么多说明文字，这是干什么呀？而且即使有说明
 * 文字，不应该是个问号吗？就是应该是一个 tooltip。」
 *
 * 她说的是「个人资料」那一屏：头像那格挂着三行长句，昵称那格挂着两句，邮箱那格又一句
 * —— 三行的面板读起来像一份说明书。而其中**只有一句**是用户当下必须知道的
 * （"现在缺什么、按哪里"）。其余是背景知识：解释该在**被问到的时候**出现。
 *
 * ## 形状与判据
 *
 * · 触发件是一枚**按钮**，不是 `title` 属性。`title` 不可键盘聚焦、不可读屏、
 *   触摸设备上永远出不来 —— 用它当"说明"等于那说明只对鼠标用户存在。
 * · 内容**常驻 DOM**、默认 `display: none`，由 `aria-describedby` 指过去。
 *   这样读屏用户在**没**打开它的状态下也能听到这段解释（ARIA 明确允许
 *   `describedby` 指向隐藏内容），而判据也不必先"打开"才读得到文案
 *   （`apps/web/tests/profile-panel.spec.tsx` 与 `e2e/tests/profile-avatar-e2ee.spec.ts`
 *   都直接读那枚 `data-testid` 的文字）。
 * · 打开条件 = 悬停 **或** 聚焦。只写悬停的话键盘用户拿不到，只写聚焦的话
 *   触摸设备拿不到（点一下会聚焦）。`Esc` 把它收掉（把焦点移走，
 *   于是"聚焦"这一路也断开）。
 *
 * ⚠️ 它不是浮层：`docs/agents/overlay-feedback.md` 的关闭策略表**不覆盖**
 * tooltip / hover card —— 那一类的开合由指针位置与焦点决定，没有 scrim、
 * 没有"取消/确认"。所以这里不引 `closePolicyOf`，也不该被当成一个 dialog。
 */
import { useId, useState } from 'react';
import { CircleHelp } from 'lucide-react';

import { ICON_SIZE } from '@heyta/design-system';

export function SettingsInfoTip({
  label,
  text,
  testId,
}: {
  /** 那枚问号的无障碍名字（"头像为什么要加密"这种）。 */
  label: string;
  /**
   * 解释正文。一句话到三句，超过就该考虑写成帮助页。
   *
   * 🔴 `React.ReactNode` 而不是 `string`（2026-10-24 晚）：有些句子内部带
   * `<strong>` 的重音（"这一步会把内容发到我们的**服务器**"），把它降级成纯字符串
   * 就等于为了搬进气泡而删掉重音。类型放宽的代价只是调用方写得更自由。
   */
  text: React.ReactNode;
  /** 正文那一格的 `data-testid`（判据用它读文案，见文件头）。 */
  testId: string;
}): React.JSX.Element {
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const open = hovered || focused;

  return (
    <span className="ht-settings__tip">
      <button
        type="button"
        className="ht-settings__tip-trigger"
        aria-label={label}
        aria-describedby={id}
        data-testid={`${testId}-trigger`}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          // 不 preventDefault：Esc 在浮层里是"关掉这一层"，而这一层只是说明，
          // 收起它**不**该顺手把设置浮层也关了 —— 焦点仍在触发件上时，
          // 上面的 onBlur 会把说明收掉；焦点不在它身上时 Esc 本来就该归浮层。
          setFocused(false);
          setHovered(false);
        }}
      >
        <CircleHelp size={ICON_SIZE.sm} aria-hidden="true" />
      </button>
      <span
        role="tooltip"
        id={id}
        className="ht-settings__tip-bubble"
        data-hidden={open ? undefined : 'true'}
        data-testid={testId}
      >
        {text}
      </span>
    </span>
  );
}
