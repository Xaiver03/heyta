/**
 * 课表导入入口（Web，最小一档）
 * ==============================
 *
 * 对齐移动端 `WebTimetableImport` 的思路——**解析层完全复用** `@heyta/domain`
 *（`parseCourseICS` / `parseCourseCSV` / `planCourseImport`），落库复用 `@heyta/app-host`
 * 的 `importCourses`（稳定 id 去重、守恒律全在那里）。Web 端只做一件平台差异的事：
 * 用文件选择器读一个 `.ics` / `.csv` 文本，而不是移动端的应用内浏览器。
 *
 * 🔴 这里**不写任何"哪一行算课程 / 导到哪"的判断**：解析、去重、跳过原因都在共享层。
 * 这里只把"选文件 → 读文本 → 交给共享管线 → 报一句结果"接起来。
 */

import { useRef, useState } from 'react';

import { ICON_SIZE } from '@heyta/design-system';
import { parseCourseCSV, parseCourseICS, planCourseImport } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { Upload } from 'lucide-react';

import { IconButton } from '../../components/hta/index.js';
import { useHabitStore } from '../habits/store.js';
import { readFileText } from '../settings/import-file.js';

export function CalendarTimetableImport(): React.JSX.Element {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const importCourses = useHabitStore((s) => s.importCourses);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const onFile = (file: File | undefined): void => {
    if (file === undefined || busy) return;
    setBusy(true);
    setNotice(null);
    void (async () => {
      try {
        const text = await readFileText(file);
        const lower = file.name.toLowerCase();
        const rawRows = lower.endsWith('.csv') ? parseCourseCSV(text) : parseCourseICS(text);
        const plan = planCourseImport(rawRows);
        if (plan.rows.length === 0) {
          setNotice(t('web.calendar.timetable.importEmpty'));
          return;
        }
        const result = await importCourses(plan.rows);
        setNotice(
          plan.report.skipped > 0
            ? t('web.calendar.timetable.importResultSkipped', {
                created: result.created.length,
                skipped: plan.report.skipped,
              })
            : t('web.calendar.timetable.importResult', { created: result.created.length }),
        );
      } catch {
        setNotice(t('web.calendar.timetable.importFailed'));
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div className="ht-content__cal-timetable-import">
      <input
        ref={input}
        hidden
        type="file"
        accept=".ics,.csv,.txt"
        data-testid="calendar-timetable-import-input"
        aria-label={t('web.calendar.timetable.import')}
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          // 允许连续导入同一个文件（否则第二次选它不会触发 change）。
          e.currentTarget.value = '';
        }}
      />
      <IconButton
        label={t('web.calendar.timetable.import')}
        icon={<Upload size={ICON_SIZE.sm} aria-hidden="true" />}
        size="sm"
        disabled={busy}
        data-testid="calendar-timetable-import"
        onClick={() => input.current?.click()}
      />
      {notice === null ? null : (
        <span className="ht-content__cal-timetable-import-status" role="status" data-testid="calendar-timetable-import-status">
          {notice}
        </span>
      )}
    </div>
  );
}
