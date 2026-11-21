import { useState } from 'react';

import { useI18n, type MessageKey } from '@heyta/i18n/provider';
import { isHttpPaperUrl } from '@heyta/shared-schema';

import {
  ADMIN_HOLIDAY_NOTICE_KEY,
  type AdminStoreState,
  type HolidayYearInput,
} from '../store.js';

import { FormField } from '../../../lib/form/FormField.js';

import { AdminEmpty, formatTime } from './shared.js';

/** 录入表单的初值。全空 —— **不给默认年份**：默认值会让人提交自己没看过的数字。 */
const EMPTY_HOLIDAY_FORM: HolidayYearInput = {
  yearText: '',
  papersText: '',
  noteText: '',
  offDaysText: '',
  workDaysText: '',
};

/**
 * 「调休 / 补班」面板。W4b 的最后一层（服务端与契约早已就绪，缺的就是这一块）。
 * ============================================================================
 *
 * 🔴 **这一块不做任何合法性判断。** 日期存不存在、`isOffDay` 是不是布尔、
 * 同一天有没有出现两次、年份在不在 2007–2100 —— 全部由
 * `packages/shared-schema` 的 `holidayYearPutSchema` 在服务端裁决
 * （那是**唯一一份**规则，见该文件头"为什么形状被钉成 days[] 这一种"）。
 * 这里多判一次就是 §3.5 那条"同一个判断抄两遍"，而两遍的标准迟早会分叉：
 * 表现是"界面放行了、服务端 400"或反过来，两种都让人以为对方坏了。
 *
 * 所以本组件只有三件事：
 *   1. **回显**已录入的年度**连同 papers**（判据② —— 出处链接是这件事的举证入口，
 *      看不见链接的后台等于让运营替数据背书）；
 *   2. 收集一整年的输入并**一次 PUT**（一个用户意图 = 一次请求；
 *      "整年替换"与"要么全收要么全不收"都在服务端那一层保证）；
 *   3. 撤销某一年 —— 语义是**退回随包表**，不是"清空那一年"，
 *      措辞必须说清，否则运营会以为撤销之后日历上什么都不标。
 *
 * ⚠️ 表单是**受控组件**，字段留在本地 state：每次键入都进 store 会让
 * 整块后台随字符重渲染，而 store 是各标签页共用的。
 */
export function HolidaysSection(props: { store: AdminStoreState }): React.JSX.Element {
  const { t } = useI18n();
  const years = props.store.holidayYears;
  const [form, setForm] = useState<HolidayYearInput>(EMPTY_HOLIDAY_FORM);
  /** 两步式撤销：`null` = 没有待确认的年份。见下面 `revoke` 那段注释。 */
  const [pendingRevokeYear, setPendingRevokeYear] = useState<number | null>(null);

  const field = (key: keyof HolidayYearInput) => (event: { target: { value: string } }): void => {
    setForm((previous) => ({ ...previous, [key]: event.target.value }));
  };

  const notice = props.store.holidayNotice;
  const echo = props.store.holidayEcho;

  return (
    // 🔴 返回**片段**而不是再套一层 `ht-settings__section`：外层那一节已经是
    // 一个带边框与内边距的盒子，套第二层会画成"框里有框"（其余标签页同样是片段）。
    <>
      <p className="ht-settings__hint">{t('web.admin.holiday.lead')}</p>

      {notice !== null && (
        <p
          className={notice === 'failed' ? 'ht-settings__danger' : 'ht-settings__notice'}
          data-testid="admin-holiday-notice"
        >
          {t(ADMIN_HOLIDAY_NOTICE_KEY[notice] as MessageKey)
            .replace('{year}', String(echo?.year ?? '—'))
            .replace('{count}', String(echo?.dayCount ?? '—'))}
        </p>
      )}

      {/* ── 已录入的年度（判据②：papers 必须**回显成可点的链接**）───── */}
      <h5 className="ht-settings__admin-h5">{t('web.admin.holiday.list')}</h5>
      {years === null ? (
        <p className="ht-settings__hint">{t('web.admin.loading')}</p>
      ) : (
        <>
          <p className="ht-settings__hint">
            {t('web.admin.holiday.version').replace('{version}', years.version)}
          </p>
          {years.years.length === 0 ? (
            <AdminEmpty titleKey="web.admin.holiday.list.none" />
          ) : (
            <ul className="ht-settings__admin-list" data-testid="admin-holiday-years">
              {years.years.map((year) => (
                <li key={year.year} className="ht-settings__admin-staticRow">
                  <span className="ht-settings__admin-rowMain ht-settings__admin-rowMain--wrap">
                    {year.year} ·{' '}
                    {t('web.admin.holiday.dayCount').replace('{count}', String(year.dayCount))}
                    {year.note === null ? '' : ` · ${year.note}`}
                  </span>
                  <span className="ht-settings__admin-rowMeta">
                    {formatTime(year.updatedAt)} · {year.updatedBy ?? '—'}
                  </span>
                  {/* 🔴 出处链接**必须渲染出来**。契约把 papers 限定成 http/https
                      的唯一理由就是这里要把它做成 `<a href>`（见
                      `isHttpPaperUrl` 的注释：`z.string().url()` 放行 `javascript:`）。
                      所以这三条同时是判据与防线：链接本身、它的文字、以及
                      `rel` 防止被打开的站点反向拿到后台这一页的 window。 */}
                  <span
                    className="ht-settings__admin-badges ht-settings__admin-badges--papers"
                    data-testid="admin-holiday-papers"
                  >
                    {year.papers.map((paper) =>
                      /*
                       * 🔴 渲染层这一道是**第二道**，不是装饰。
                       * 迁移 SQL 的「手工补充 2/3」写的就是"http/https 由契约层 + 渲染层两处钉"，
                       * 而只钉契约层的说法不成立：绕过 PUT 进来的行（运维直接跑 SQL、
                       * 将来的导入通道、库里已存在的旧值）都不会再过 zod，于是后台的
                       * `href` 里就是一条 `javascript:`。同一串还经公开 GET 原样下发，
                       * 所以这里按**取到值的样子**判，不按"入库时应当合法"判。
                       */
                      isHttpPaperUrl(paper) ? (
                        <a
                          key={paper}
                          className="ht-settings__admin-badge"
                          href={paper}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          {paper}
                        </a>
                      ) : (
                        <span key={paper} className="ht-settings__admin-badge" data-testid="admin-holiday-paper-rejected">
                          {paper}
                        </span>
                      ),
                    )}
                  </span>
                  <div className="ht-settings__admin-actions">
                    <button
                      type="button"
                      className="ht-settings__admin-btn ht-settings__admin-btn--danger"
                      data-testid="admin-holiday-revoke"
                      onClick={() => {
                        props.store.clearHolidayNotice();
                        setPendingRevokeYear(year.year);
                      }}
                    >
                      {t('web.admin.holiday.revoke')}
                    </button>
                    {pendingRevokeYear === year.year && (
                      // 🔴 撤销是**两步**：服务端语义是"删掉这一年的覆盖行 ⇒ 客户端
                      // 退回随包表"，不是"那一年没有任何安排"。一次点击就删掉一整年、
                      // 而且措辞写成"清空"，会让运营在错误的理解上做出正确的点击。
                      <span
                        className="ht-settings__danger"
                        data-testid="admin-holiday-revoke-confirm"
                      >
                        {t('web.admin.holiday.revoke.confirm')}
                        <button
                          type="button"
                          className="ht-settings__admin-btn ht-settings__admin-btn--danger"
                          data-testid="admin-holiday-revoke-yes"
                          onClick={() => {
                            setPendingRevokeYear(null);
                            void props.store.deleteHolidayYear(year.year);
                          }}
                        >
                          {t('web.admin.holiday.revoke.yes')}
                        </button>
                        <button
                          type="button"
                          className="ht-settings__admin-btn"
                          data-testid="admin-holiday-revoke-cancel"
                          onClick={() => {
                            setPendingRevokeYear(null);
                          }}
                        >
                          {t('web.admin.close')}
                        </button>
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* ── 录入一整年 ───────────────────────────────────────────── */}
      <h5 className="ht-settings__admin-h5">{t('web.admin.holiday.form.title')}</h5>
      <p className="ht-settings__hint">{t('web.admin.holiday.form.lead')}</p>
      <form
        className="ht-settings__admin-detail"
        onSubmit={(event) => {
          event.preventDefault();
          setPendingRevokeYear(null);
          void props.store.saveHolidayYear(form).then((saved) => {
            // 只有服务端**收了**才清输入：失败了还清空，等于把运营刚敲的一整年
            // 逐日表丢掉，而他要从头再打一遍。
            if (saved) setForm(EMPTY_HOLIDAY_FORM);
          });
        }}
      >
                <FormField id="admin-holiday-year-input" label={t('web.admin.holiday.form.year')}>
          {(fieldProps) => (
  <input
    {...fieldProps}
              className="ht-settings__admin-input"
              type="number"
              inputMode="numeric"
              data-testid="admin-holiday-year-input"
              value={form.yearText}
              onChange={field('yearText')}
            />
          )}
        </FormField>
                <FormField id="admin-holiday-papers-input" label={t('web.admin.holiday.form.papers')}>
          {(fieldProps) => (
  <textarea
    {...fieldProps}
              className="ht-settings__admin-input"
              rows={2}
              data-testid="admin-holiday-papers-input"
              value={form.papersText}
              onChange={field('papersText')}
            />
          )}
        </FormField>
                <FormField id="admin-holiday-off-input" label={t('web.admin.holiday.form.offDays')}>
          {(fieldProps) => (
  <textarea
    {...fieldProps}
              className="ht-settings__admin-input"
              rows={4}
              data-testid="admin-holiday-off-input"
              value={form.offDaysText}
              onChange={field('offDaysText')}
            />
          )}
        </FormField>
                <FormField id="admin-holiday-work-input" label={t('web.admin.holiday.form.workDays')}>
          {(fieldProps) => (
  <textarea
    {...fieldProps}
              className="ht-settings__admin-input"
              rows={4}
              data-testid="admin-holiday-work-input"
              value={form.workDaysText}
              onChange={field('workDaysText')}
            />
          )}
        </FormField>
                <FormField id="admin-holiday-note-input" label={t('web.admin.holiday.form.note')}>
          {(fieldProps) => (
  <input
    {...fieldProps}
              className="ht-settings__admin-input"
              data-testid="admin-holiday-note-input"
              value={form.noteText}
              onChange={field('noteText')}
            />
          )}
        </FormField>
        <div className="ht-settings__admin-actions">
          <button type="submit" className="ht-settings__admin-btn" data-testid="admin-holiday-save">
            {t('web.admin.holiday.save')}
          </button>
        </div>
      </form>
    </>
  );
}
