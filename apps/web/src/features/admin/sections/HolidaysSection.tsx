import { useState } from 'react';

import { useI18n, type MessageKey } from '@heyta/i18n/provider';
import { isHttpPaperUrl } from '@heyta/shared-schema';

import { type AdminStoreState, type HolidayYearInput } from '../store.js';

import { FormField } from '../../../lib/form/FormField.js';

import {
  Badge,
  Button,
  DataTable,
  InlineFeedback,
  SideSheet,
  type DataTableColumn,
} from '../../../components/hta/index.js';

import { AdminEmpty, formatTime } from './shared.js';

/** 录入表单的初值。全空 —— **不给默认年份**：默认值会让人提交自己没看过的数字。 */
const EMPTY_HOLIDAY_FORM: HolidayYearInput = {
  yearText: '',
  papersText: '',
  noteText: '',
  offDaysText: '',
  workDaysText: '',
};

/** 逐日明细里的一行。`isOffDay` 是服务端存的布尔，这里只读、不重判。 */
type HolidayDay = { day: string; isOffDay: boolean };

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
 * 迁移口径（`.local/admin-redesign/05-reuse-map.md` §3/§8/§10/§16/§18、
 * `02-admin-ia.md` §3.10）：
 *   · 表单字段走 `FormField`（解剖唯一来源），控件去掉自拼的 `.ht-settings__admin-input`；
 *     放假/补班两个多值日期字段在上方各挂一枚原生 `<input type="date">`（§18 的轻量档）
 *     作为**结构化**入口：选一天即追加进下面那一行一值清单，仍由文本框持有原文
 *     （`store` 的 `HolidayYearInput` 契约不变，也不用新增词条去喂 `DatePicker` 的
 *     `labels`——那会要求新 i18n key）；
 *   · 已录入年度的列表仍是 `ul + flex 行`（§10 的基线），但**逐日 `days` 明细**用
 *     `SideSheet` + `DataTable` 展示（原来只显示 `dayCount`，运营没法核对哪天休/补）；
 *   · 撤销走**危险确认**（行内两步、危险实底档），并在途时 `disabled`；
 *   · 保存按钮在途时 `disabled`；回执统一走 `InlineFeedback` 渲染 `store.feedback`。
 *
 * ⚠️ 表单是**受控组件**，字段留在本地 state：每次键入都进 store 会让
 * 整块后台随字符重渲染，而 store 是各标签页共用的。
 */
export function HolidaysSection(props: { store: AdminStoreState }): React.JSX.Element {
  const { t } = useI18n();
  const store = props.store;
  const years = store.holidayYears;
  const [form, setForm] = useState<HolidayYearInput>(EMPTY_HOLIDAY_FORM);
  /** 两步式撤销：`null` = 没有待确认的年份。见下面 `revoke` 那段注释。 */
  const [pendingRevokeYear, setPendingRevokeYear] = useState<number | null>(null);
  /** 逐日明细抽屉当前展开的年份（`null` = 抽屉关闭）。命名不带 `Id`：它不是一个"选中实体"。 */
  const [openYear, setOpenYear] = useState<number | null>(null);

  const field =
    (key: keyof HolidayYearInput) =>
    (event: { target: { value: string } }): void => {
      setForm((previous) => ({ ...previous, [key]: event.target.value }));
    };

  /** 把日期选择器选中的一天追加成"一行一值"。只做追加/去尾空行，不校验、不去重。 */
  const appendDay = (key: 'offDaysText' | 'workDaysText', day: string): void => {
    if (day === '') return;
    setForm((previous) => {
      const current = previous[key].replace(/\s+$/u, '');
      return { ...previous, [key]: current === '' ? day : `${current}\n${day}` };
    });
  };

  /**
   * 回执：渲染统一反馈通道 `store.feedback`（audit R1「唯一回执原语」的数据侧）。
   *
   * ⚠️ 这里**额外**用 `holidayNotice !== null` 做门：`setActiveTab` 只清那五个
   * `*Notice` 字段、**不清** `feedback`，所以切到本分区时 `feedback` 可能还挂着
   * 上一格的一条回执。`holidayNotice` 被 `setActiveTab → clearHolidayNotice` 清掉，
   * 拿它当"这条回执属于本分区"的判据，可避免在调休页复述别处的成功/失败。
   * （真正的修法应是 `setActiveTab` 一并 `clearFeedback`，见交付说明的「需 store 支持点」。）
   */
  const feedback = store.feedback;
  const showFeedback = feedback !== null && store.holidayNotice !== null;
  const feedbackText =
    feedback === null
      ? ''
      : t(feedback.message as MessageKey)
          .replace('{year}', String(store.holidayEcho?.year ?? '—'))
          .replace('{count}', String(store.holidayEcho?.dayCount ?? '—'));

  const openYearData =
    openYear === null ? null : (years?.years.find((year) => year.year === openYear) ?? null);

  /** 逐日明细两列。 */
  const dayColumns: readonly DataTableColumn<HolidayDay>[] = [
    {
      key: 'day',
      header: t('web.admin.holiday.day.date'),
      render: (row) => row.day,
    },
    {
      key: 'kind',
      header: t('web.admin.holiday.day.kind'),
      render: (row) => (
        <Badge tone={row.isOffDay ? 'info' : 'warning'}>
          {row.isOffDay ? t('web.admin.holiday.day.off') : t('web.admin.holiday.day.work')}
        </Badge>
      ),
    },
  ];

  return (
    // 🔴 返回**片段**而不是再套一层 `ht-settings__section`：外层那一节已经是
    // 一个带边框与内边距的盒子，套第二层会画成"框里有框"（其余标签页同样是片段）。
    <>
      <p className="ht-settings__hint">{t('web.admin.holiday.lead')}</p>

      {/* ── 统一回执（InlineFeedback 渲染 store.feedback）──────────── */}
      {showFeedback && feedback !== null && (
        <InlineFeedback tone={feedback.tone} testID="admin-holiday-notice">
          {feedbackText}
        </InlineFeedback>
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
                        <span
                          key={paper}
                          className="ht-settings__admin-badge"
                          data-testid="admin-holiday-paper-rejected"
                        >
                          {paper}
                        </span>
                      ),
                    )}
                  </span>
                  <div className="ht-settings__admin-actions">
                    {/* 逐日明细：原来只显示 dayCount，运营无法核对哪天休/补；现在开抽屉看逐日。 */}
                    <Button
                      size="sm"
                      tone="ghost"
                      data-testid="admin-holiday-days-open"
                      onClick={() => {
                        store.clearHolidayNotice();
                        setOpenYear(year.year);
                      }}
                    >
                      {t('web.admin.holiday.days.view')}
                    </Button>
                    <Button
                      tone="danger"
                      disabled={store.pending.holidayDelete}
                      data-testid="admin-holiday-revoke"
                      onClick={() => {
                        store.clearHolidayNotice();
                        setPendingRevokeYear(year.year);
                      }}
                    >
                      {t('web.admin.holiday.revoke')}
                    </Button>
                    {pendingRevokeYear === year.year && (
                      // 🔴 撤销是**两步**：服务端语义是"删掉这一年的覆盖行 ⇒ 客户端
                      // 退回随包表"，不是"那一年没有任何安排"。一次点击就删掉一整年、
                      // 而且措辞写成"清空"，会让运营在错误的理解上做出正确的点击。
                      <span
                        className="ht-settings__danger"
                        data-testid="admin-holiday-revoke-confirm"
                      >
                        {t('web.admin.holiday.revoke.confirm')}
                        {/* 危险确认的唯一主按钮：danger + commit（实底），在途时禁用。 */}
                        <Button
                          tone="danger"
                          commit
                          disabled={store.pending.holidayDelete}
                          loading={store.pending.holidayDelete}
                          data-testid="admin-holiday-revoke-yes"
                          onClick={() => {
                            // 不在这里关掉确认：让它在途时带着 `disabled`+转圈留在原地，
                            // 删完由「重读年度列表」把这一行（连同确认）一起移除。
                            void store.deleteHolidayYear(year.year);
                          }}
                        >
                          {t('web.admin.holiday.revoke.yes')}
                        </Button>
                        <Button
                          tone="secondary"
                          data-testid="admin-holiday-revoke-cancel"
                          onClick={() => {
                            setPendingRevokeYear(null);
                          }}
                        >
                          {t('web.admin.close')}
                        </Button>
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* ── 逐日明细抽屉（SideSheet + DataTable）────────────────────── */}
      {openYearData !== null && (
        <SideSheet
          testId="admin-holiday-days"
          labelledBy="admin-holiday-days-title"
          title={`${String(openYearData.year)} · ${t('web.admin.holiday.dayCount').replace(
            '{count}',
            String(openYearData.dayCount),
          )}`}
          onCancel={() => setOpenYear(null)}
          footer={
            <Button tone="secondary" onClick={() => setOpenYear(null)}>
              {t('web.admin.close')}
            </Button>
          }
        >
          <DataTable
            columns={dayColumns}
            rows={openYearData.days}
            rowKey={(row) => `${row.day}|${String(row.isOffDay)}`}
            emptyTitle={t('web.admin.list.none')}
            caption={t('web.admin.holiday.list')}
            testID="admin-holiday-days-table"
          />
        </SideSheet>
      )}

      {/* ── 录入一整年 ───────────────────────────────────────────── */}
      <h5 className="ht-settings__admin-h5">{t('web.admin.holiday.form.title')}</h5>
      <p className="ht-settings__hint">{t('web.admin.holiday.form.lead')}</p>
      <form
        className="ht-settings__admin-detail"
        onSubmit={(event) => {
          event.preventDefault();
          setPendingRevokeYear(null);
          void store.saveHolidayYear(form).then((saved) => {
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
              rows={2}
              data-testid="admin-holiday-papers-input"
              value={form.papersText}
              onChange={field('papersText')}
            />
          )}
        </FormField>

        <FormField id="admin-holiday-off-input" label={t('web.admin.holiday.form.offDays')}>
          {(fieldProps) => (
            <>
              {/*
               * 结构化入口：选一天即追加进下面那一行一值清单（`YYYY-MM-DD`）。
               * 用原生 `<input type="date">`（reuse-map §18 的轻量档），
               * 避免为 `DatePicker` 的 `labels` 新增 i18n 词条。
               */}
              <input
                type="date"
                aria-label={t('web.admin.holiday.form.offDays')}
                data-testid="admin-holiday-off-date"
                onChange={(event) => {
                  appendDay('offDaysText', event.currentTarget.value);
                  event.currentTarget.value = '';
                }}
              />
              <textarea
                {...fieldProps}
                rows={4}
                data-testid="admin-holiday-off-input"
                value={form.offDaysText}
                onChange={field('offDaysText')}
              />
            </>
          )}
        </FormField>

        <FormField id="admin-holiday-work-input" label={t('web.admin.holiday.form.workDays')}>
          {(fieldProps) => (
            <>
              <input
                type="date"
                aria-label={t('web.admin.holiday.form.workDays')}
                data-testid="admin-holiday-work-date"
                onChange={(event) => {
                  appendDay('workDaysText', event.currentTarget.value);
                  event.currentTarget.value = '';
                }}
              />
              <textarea
                {...fieldProps}
                rows={4}
                data-testid="admin-holiday-work-input"
                value={form.workDaysText}
                onChange={field('workDaysText')}
              />
            </>
          )}
        </FormField>

        <FormField id="admin-holiday-note-input" label={t('web.admin.holiday.form.note')}>
          {(fieldProps) => (
            <input
              {...fieldProps}
              data-testid="admin-holiday-note-input"
              value={form.noteText}
              onChange={field('noteText')}
            />
          )}
        </FormField>

        <div className="ht-settings__admin-actions">
          <Button
            type="submit"
            tone="primary"
            disabled={store.pending.holidaySave}
            loading={store.pending.holidaySave}
            data-testid="admin-holiday-save"
          >
            {t('web.admin.holiday.save')}
          </Button>
        </div>
      </form>
    </>
  );
}
