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
            </h3>
            <p className="ht-settings__data-card-lead">
              {t('web.settings.dataUx.backupLead')}
            </p>
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
            </h3>
            <p className="ht-settings__data-card-lead">
              {t('web.settings.dataUx.migrationLead')}
            </p>
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
