import { ArchiveRestore, Database } from 'lucide-react';
import { ICON_SIZE } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';

import { AdminPanel } from '../admin/AdminPanel.js';
import { ExportPanel } from './ExportPanel.js';
import { ImportPanel } from './ImportPanel.js';
import { TickTickImportPanel } from './TickTickImportPanel.js';
import './data-settings.css';

/**
 * Data settings information architecture.
 *
 * The three cards mirror the user's mental model: create a portable backup,
 * restore a heyta backup, or migrate from another product. The admin console
 * remains a fourth, permission-gated card; AdminPanel owns its own title and
 * renders nothing until the server confirms administrator access.
 */
import { SettingsInfoTip } from './SettingsInfoTip.js';

export function DataSettingsPanel({ active = true }: { active?: boolean }): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="ht-settings__data-stack" data-testid="data-settings-panel">
      <section className="ht-settings__data-card" data-testid="data-backup-card">
        <header className="ht-settings__data-card-header">
          <div>
            <h3 className="ht-settings__data-card-title ht-type-headline">
              <Database size={ICON_SIZE.sm} aria-hidden="true" />
              {t('web.settings.dataUx.backupTitle')}
              {/*
                🔴 **2026-11-08 删掉了一枚问号**（J2）。它的正文是
                「保留一份完整的本地备份，也可以将它还原到一台空设备。」
                —— 而这一屏里**紧接着就是导出/导入那一排按钮**，各自写着干什么。
                这是 J2 的第三类靶子：**复述分区功能**（分区的动作已经自解释了）。
                ⚠️ 与「迁移」那张卡不同：那张的气泡写的是**步骤**（"先查看预览，再合并"），
                是用户真的要知道的操作顺序，所以保留。
              */}
            </h3>

          </div>
        </header>
        <ExportPanel />
        <ImportPanel />
      </section>

      <section className="ht-settings__data-card" data-testid="data-migration-card">
        <header className="ht-settings__data-card-header">
          <div>
            <h3 className="ht-settings__data-card-title ht-type-headline">
              <ArchiveRestore size={ICON_SIZE.sm} aria-hidden="true" />
              {t('web.settings.dataUx.migrationTitle')}
              <SettingsInfoTip
                testId="tip-data-migration"
                label={t('web.settings.dataUx.migrationTitle')}
                text={t('web.settings.dataUx.migrationLead')}
              />
            </h3>

          </div>
        </header>
        <TickTickImportPanel />
      </section>

      {/* AdminPanel owns both the permission check and its title. Keeping it
          outside a pre-rendered card avoids exposing an empty admin heading to
          ordinary users while still grouping it after user data actions. */}
      <AdminPanel active={active} />
    </div>
  );
}
