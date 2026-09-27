/**
 * 通行密钥自助管理面板（设置页）
 * ==============================
 *
 * 服务端此前只有注册 / 登录 / 恢复，**没有任何"列我的凭据 / 删某一条"的入口**，
 * 界面里更没有。这个面板补的就是那个缺口：用户终于能看到自己注册了哪些
 * 通行密钥，并删掉一条已知丢失/泄露的。
 *
 * ## 分层（AGENTS.md §3.5）
 *
 * 这里**没有一行协议知识**，也没有"最后一条能不能删"的判断：
 *   - 端点、方法、令牌怎么带、失败怎么归类 → `@heyta/app-host` 的 `hosted-auth.ts`；
 *   - "最后一条"由**服务端**拒绝（409），这里只把 `last-passkey` 翻成人话；
 *   - 状态机 → `./passkeysStore.js`。
 * 本文件只做两件事：**把状态渲染成人看得懂的句子**，以及**收集用户输入**。
 *
 * ## 🔴 两个必须说清楚的地方
 *
 *   1. **加载失败 ≠ 没有凭据。** 加载失败时不许画空列表，否则一次网络抖动
 *      看起来像"我的凭据全没了"。空列表只在**真的加载成功且为空**时才画。
 *   2. **删除是两段式**（删除 → 确认删除）。删凭据不是可撤销操作，
 *      而一个单击就生效的删除按钮在设置页里迟早会被误点。
 *
 * ## 没有"名称"与"是否当前设备"
 *
 * 服务端的 `Passkey` 表没有 `name` 列（改名要一次数据库迁移，本轮不做），
 * 而"是否当前设备"只能靠 credential ID 判断，接口刻意不返回它。
 * 界面因此显示**创建时间 / 上次使用**两个真实存在的字段 —— 不编一个假的。
 */

import { useEffect, useState } from 'react';

import { useI18n, type MessageKey } from '@heyta/i18n';
import type { HostedAuthFailureReason } from '@heyta/app-host';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Trash2 } from 'lucide-react';

import { useSyncStore } from '../sync/store.js';
import { usePasskeysStore } from './passkeysStore.js';

/**
 * 删除失败原因 → 词条 key。
 *
 * 🔴 这是**唯一**让 `HostedAuthFailureReason` 在这个面板里变成句子的地方。
 * `passkey-not-found` 与 `last-passkey` 各说各的话，因为用户该做的事不同：
 * 前者不必再管（列表已刷新），后者要"先加一条新的"。
 */
function deleteFailureKey(reason: HostedAuthFailureReason): MessageKey {
  switch (reason) {
    case 'passkey-not-found':
      return 'web.passkeys.error.passkeyNotFound';
    case 'last-passkey':
      return 'web.passkeys.error.lastPasskey';
    case 'unauthorized':
      return 'web.passkeys.error.unauthorized';
    case 'network':
      return 'web.passkeys.error.network';
    default:
      return 'web.passkeys.error.other';
  }
}

/** 列表加载失败原因 → 词条 key。除了"就是加载不出来"以外都尽量具体。 */
function loadFailureKey(reason: HostedAuthFailureReason): MessageKey {
  if (reason === 'unauthorized') return 'web.passkeys.error.unauthorized';
  if (reason === 'network') return 'web.passkeys.error.network';
  return 'web.passkeys.error.load';
}

/**
 * ISO 8601 → `YYYY-MM-DD`。
 *
 * 🔴 刻意**不用** `Intl` / `toLocaleDateString`：日期在这里只回答"哪一天"，
 * 不参与本地化文案，而且 `Intl` 的输出随运行环境变，会让测试对时区/ICU 敏感。
 */
function shortDate(iso: string): string {
  return iso.slice(0, 10);
}

export function PasskeyPanel(): React.JSX.Element {
  const { t } = useI18n();

  // 令牌来自同步设置（登录成功后由认证 store 写进去）。
  const baseUrl = useSyncStore((s) => s.baseUrl);
  const token = useSyncStore((s) => s.token);

  const status = usePasskeysStore((s) => s.status);
  const deletingId = usePasskeysStore((s) => s.deletingId);
  const deleteFailure = usePasskeysStore((s) => s.deleteFailure);
  const justDeleted = usePasskeysStore((s) => s.justDeleted);
  const load = usePasskeysStore((s) => s.load);
  const remove = usePasskeysStore((s) => s.remove);
  const dismissNotice = usePasskeysStore((s) => s.dismissNotice);

  /** 两段式删除：第一下进入"确认"，第二下才真的删。 */
  const [confirmingId, setConfirmingId] = useState<string | undefined>(undefined);

  const signedIn = typeof token === 'string' && token !== '';

  useEffect(() => {
    if (!signedIn) return;
    // 换账号 / 换服务器地址都重拉：列表必须属于**当前**这个账号。
    void load(baseUrl, token);
  }, [baseUrl, token, signedIn, load]);

  return (
    <div className="ht-settings" data-testid="passkeys-panel">
      <h2 className="ht-settings__title">{t('web.passkeys.title')}</h2>
      <p className="ht-settings__hint">{t('web.passkeys.lead')}</p>

      {!signedIn ? (
        <p className="ht-settings__hint" data-testid="passkeys-needs-sign-in">
          {t('web.passkeys.needsSignIn')}
        </p>
      ) : (
        <>
          <div className="ht-settings__actions">
            <button
              type="button"
              className="ht-btn ht-btn--ghost"
              data-testid="passkeys-refresh"
              disabled={status.kind === 'loading'}
              onClick={() => {
                dismissNotice();
                setConfirmingId(undefined);
                void load(baseUrl, token);
              }}
            >
              {status.kind === 'loading' ? (
                <Loader2 size={12} aria-hidden="true" />
              ) : (
                <RefreshCw size={12} aria-hidden="true" />
              )}{' '}
              {t('web.passkeys.refresh')}
            </button>
          </div>

          {status.kind === 'loading' && (
            <p className="ht-settings__hint" role="status" data-testid="passkeys-loading">
              {t('web.passkeys.loading')}
            </p>
          )}

          {/*
            🔴 加载失败**不是**空列表。说清楚"没加载出来"，不要让用户以为
            自己的凭据全没了。
          */}
          {status.kind === 'failed' && (
            <p className="ht-settings__danger" role="alert" data-testid="passkeys-load-failed">
              <AlertTriangle size={12} aria-hidden="true" />{' '}
              {t(loadFailureKey(status.reason))}
            </p>
          )}

          {status.kind === 'loaded' && status.passkeys.length === 0 && (
            <p className="ht-settings__hint" data-testid="passkeys-empty">
              {t('web.passkeys.empty')}
            </p>
          )}

          {status.kind === 'loaded' &&
            status.passkeys.map((passkey) => {
              const deleting = deletingId === passkey.id;
              const confirming = confirmingId === passkey.id;
              return (
                <section
                  className="ht-settings__section"
                  key={passkey.id}
                  data-testid={`passkey-row-${passkey.id}`}
                >
                  <p className="ht-settings__hint">
                    {t('web.passkeys.createdAt', { date: shortDate(passkey.createdAt) })}
                    {' · '}
                    {passkey.lastUsedAt === null
                      ? t('web.passkeys.neverUsed')
                      : t('web.passkeys.lastUsedAt', {
                          date: shortDate(passkey.lastUsedAt),
                        })}
                  </p>
                  <div className="ht-settings__actions">
                    {confirming ? (
                      <>
                        <button
                          type="button"
                          className="ht-btn ht-btn--primary"
                          data-testid={`passkey-confirm-${passkey.id}`}
                          disabled={deleting}
                          onClick={() => {
                            setConfirmingId(undefined);
                            void remove(baseUrl, token, passkey.id);
                          }}
                        >
                          {deleting ? (
                            <Loader2 size={12} aria-hidden="true" />
                          ) : (
                            <Trash2 size={12} aria-hidden="true" />
                          )}{' '}
                          {t('web.passkeys.confirmDelete')}
                        </button>
                        <button
                          type="button"
                          className="ht-btn ht-btn--ghost"
                          data-testid={`passkey-cancel-${passkey.id}`}
                          onClick={() => setConfirmingId(undefined)}
                        >
                          {t('web.passkeys.cancel')}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="ht-btn ht-btn--ghost"
                        data-testid={`passkey-delete-${passkey.id}`}
                        disabled={deleting}
                        onClick={() => {
                          dismissNotice();
                          setConfirmingId(passkey.id);
                        }}
                      >
                        {deleting ? (
                          <Loader2 size={12} aria-hidden="true" />
                        ) : (
                          <Trash2 size={12} aria-hidden="true" />
                        )}{' '}
                        {deleting ? t('web.passkeys.deleting') : t('web.passkeys.delete')}
                      </button>
                    )}
                  </div>
                </section>
              );
            })}

          {justDeleted && (
            <p className="ht-settings__notice" role="status" data-testid="passkeys-deleted">
              <CheckCircle2 size={12} aria-hidden="true" /> {t('web.passkeys.deleted')}
            </p>
          )}

          {deleteFailure !== undefined && (
            <p className="ht-settings__danger" role="alert" data-testid="passkeys-delete-failed">
              <AlertTriangle size={12} aria-hidden="true" /> {t(deleteFailureKey(deleteFailure))}
            </p>
          )}
        </>
      )}
    </div>
  );
}
