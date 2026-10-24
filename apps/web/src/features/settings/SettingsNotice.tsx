import type { ReactNode } from 'react';
import { CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { ICON_SIZE } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';
import './settings-notice.css';
import { SettingsInfoTip } from './SettingsInfoTip.js';

/**
 * 一条「约束 / 状态」——
 * =====================
 *
 * 产品负责人 2026-10-24 的禁令：设置界面里**不许**再直接写说明文字，只允许
 * "一个圈里一个问号"。这条组件原来正是那面墙的来源：`⚠️ 需要一台空设备` 下面
 * 跟着一整句"只支持还原到空库：本机已经有数据时会直接拒绝，不会清空或覆盖……"。
 *
 * 现在的分工：
 *
 * | 部分 | 去留 | 为什么 |
 * |---|---|---|
 * | 图标 | 留 | 它说的是"这条是什么性质"（约束/成功/失败），不是解释 |
 * | 标题 | **留** | 它必须是一句**能独立站住**的话（"需要一台空设备"）；写不出这样的标题，说明这堆字本来就不该在设置里 |
 * | 正文 | 进 `?` | 除非它是**反馈**（`live` 或 `danger`：失败/进行中必须直接可见） |
 * | 动作 | 留 | 按钮不是说明文字 |
 *
 * 🔴 `live` / `danger` 例外不是偷懒：失败与"正在做"必须**不用点**就看得到 ——
 * 把"这一单没下成"藏进气泡是另一种形式的骗人。
 */
export function SettingsNotice({ title, children, tone = 'info', actions, testId, live = false }: {
  title: ReactNode;
  children?: ReactNode;
  tone?: 'info' | 'success' | 'warning' | 'danger';
  actions?: ReactNode;
  testId?: string;
  live?: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  const Icon = tone === 'success' ? CircleCheck : tone === 'info' ? Info : TriangleAlert;
  /** 正文进气泡的条件：有正文、不是反馈、不是失败态。 */
  const detailInTip = children !== undefined && !live && tone !== 'danger' && tone !== 'success';
  return <div className={`ht-settings__notice ht-settings__notice--${tone}`} data-testid={testId}
    role={live ? (tone === 'danger' ? 'alert' : 'status') : undefined}>
    <Icon size={ICON_SIZE.sm} aria-hidden="true" />
    <div className="ht-settings__notice-body">
      <div className="ht-type-headline">
        {title}
        {detailInTip ? (
          <SettingsInfoTip
            testId={`${testId ?? 'notice'}-detail`}
            /* 标题不是字符串时（带图标的 ReactNode）用通用无障碍名，不写硬编码字面量。 */
            label={typeof title === 'string' ? title : t('common.tip.label')}
            text={children}
          />
        ) : null}
      </div>
      {detailInTip ? null : children ? <div className="ht-settings__notice-detail">{children}</div> : null}
      {actions ? <div className="ht-settings__actions">{actions}</div> : null}
    </div>
  </div>;
}
