/**
 * 通行密钥自助管理面板（设置页）
 * ==============================
 *
 * 服务端此前只有注册 / 登录 / 恢复，**没有任何"列我的凭据 / 删某一条 / 给某一条改名"的入口**，
 * 界面里更没有。这个面板补的就是那个缺口：用户终于能看到自己注册了哪些
 * 通行密钥，删掉一条已知丢失/泄露的，并给它们起名字。
 *
 * ## 分层（AGENTS.md §3.5）
 *
 * 这里**没有一行协议知识**，也没有"最后一条能不能删"的判断：
 *   - 端点、方法、令牌怎么带、失败怎么归类 → `@heyta/app-host` 的 `hosted-auth.ts`；
 *   - "最后一条"由**服务端**拒绝（409），这里只把 `last-passkey` 翻成人话；
 *   - 名字怎么归一化（首尾空白、空串 → 没名字）→ **服务端**，这里原样送出输入；
 *   - 状态机 → `./passkeysStore.js`。
 * 本文件只做两件事：**把状态渲染成人看得懂的句子**，以及**收集用户输入**。
 *
 * ## 🔴 三个必须说清楚的地方
 *
 *   1. **加载失败 ≠ 没有凭据。** 加载失败时不许画空列表，否则一次网络抖动
 *      看起来像"我的凭据全没了"。空列表只在**真的加载成功且为空**时才画。
 *   2. **删除是两段式**（删除 → 确认删除）。删凭据不是可撤销操作，
 *      而一个单击就生效的删除按钮在设置页里迟早会被误点。
 *   3. **改名失败时输入框不关。** 关掉就等于把用户刚打的字丢掉，而失败
 *      恰恰是他需要改一改再存的时候（比如名字太长）。
 *
 * ## 名字与回落
 *
 * `passkey.name` 是**可空**的：没起过名字时显示创建时间 / 上次使用两个真实
 * 存在的字段，而不是编一个"未命名"当名字。清空输入框再保存 = 去掉名字
 * （服务端把空串与纯空白都归一成 `null`），所以不需要一个单独的"删除名字"按钮。
 *
 * 仍然**没有**"是否当前设备"：那只能靠 credential ID 判断，而接口刻意不返回它。
 */

import { useEffect, useState } from 'react';

import { useI18n, type MessageKey } from '@heyta/i18n';
import { HOSTED_PASSKEY_NAME_MAX_LENGTH, type HostedAuthFailureReason } from '@heyta/app-host';
import { AlertTriangle, CheckCircle2, Loader2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';

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
 * 添加失败原因 → 词条 key。
 *
 * 🔴 与删除失败**刻意分开**：`passkey-unsupported`（这台设备没有通行密钥能力）
 * 与 `passkey-cancelled`（用户在系统弹窗里取消）只可能来自添加，而删除那侧
 * 的 `last-passkey` 只可能来自删除。混用会让用户看到一句解释错动作的话。
 */
function addFailureKey(reason: HostedAuthFailureReason): MessageKey {
  switch (reason) {
    case 'passkey-unsupported':
      return 'web.passkeys.error.passkeyUnsupported';
    case 'passkey-cancelled':
      return 'web.passkeys.error.passkeyCancelled';
    case 'passkey-already-registered':
      return 'web.passkeys.error.passkeyAlreadyRegistered';
    case 'unauthorized':
      return 'web.passkeys.error.unauthorized';
    case 'network':
      return 'web.passkeys.error.network';
    default:
      return 'web.passkeys.error.add';
  }
}

/**
 * 改名失败原因 → 词条 key。
 *
 * 🔴 `passkey-name-too-long`（服务端 400）单独一句：笼统的"操作没有完成"
 * 会让用户不知道是网络问题还是自己名字打长了，而后者改一下就能过。
 * 这条词条带 `{max}` 占位符，调用处会一并把上限传进去；对不带占位符的
 * 那几句来说多余的参数是无害的（`translate` 只替换模板里出现过的占位符）。
 */
function renameFailureKey(reason: HostedAuthFailureReason): MessageKey {
  switch (reason) {
    case 'passkey-name-too-long':
      return 'web.passkeys.error.nameTooLong';
    case 'passkey-not-found':
      return 'web.passkeys.error.passkeyNotFound';
    case 'unauthorized':
      return 'web.passkeys.error.unauthorized';
    case 'network':
      return 'web.passkeys.error.network';
    default:
      return 'web.passkeys.error.rename';
  }
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
  const adding = usePasskeysStore((s) => s.adding);
  const addFailure = usePasskeysStore((s) => s.addFailure);
  const justAdded = usePasskeysStore((s) => s.justAdded);
  const renamingId = usePasskeysStore((s) => s.renamingId);
  const renameFailure = usePasskeysStore((s) => s.renameFailure);
  const justRenamed = usePasskeysStore((s) => s.justRenamed);
  const load = usePasskeysStore((s) => s.load);
  const remove = usePasskeysStore((s) => s.remove);
  const rename = usePasskeysStore((s) => s.rename);
  const add = usePasskeysStore((s) => s.add);
  const dismissNotice = usePasskeysStore((s) => s.dismissNotice);

  /** 两段式删除：第一下进入"确认"，第二下才真的删。 */
  const [confirmingId, setConfirmingId] = useState<string | undefined>(undefined);
  /** 正在改名的是哪一行（同一时刻只开一个输入框）。 */
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  /** 改名输入框里的草稿。 */
  const [draftName, setDraftName] = useState<string>('');

  const signedIn = typeof token === 'string' && token !== '';

  useEffect(() => {
    if (!signedIn) return;
    // 换账号 / 换服务器地址都重拉：列表必须属于**当前**这个账号。
    void load(baseUrl, token);
  }, [baseUrl, token, signedIn, load]);

  const closeEditors = (): void => {
    setConfirmingId(undefined);
    setEditingId(undefined);
  };

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
            {/*
              🔴 这个按钮是"删最后一条被拒 → 先添加一条新的"那句话的**唯一出口**。
              没有它，用户被指向一个做不到的动作（添加走公开注册路径是静默
              空操作），然后删掉旧凭据就再也登不进去。
            */}
            <button
              type="button"
              className="ht-btn ht-btn--primary"
              data-testid="passkeys-add"
              disabled={adding}
              onClick={() => {
                dismissNotice();
                closeEditors();
                void add(baseUrl, token);
              }}
            >
              {adding ? (
                <Loader2 size={12} aria-hidden="true" />
              ) : (
                <Plus size={12} aria-hidden="true" />
              )}{' '}
              {adding ? t('web.passkeys.adding') : t('web.passkeys.add')}
            </button>
            <button
              type="button"
              className="ht-btn ht-btn--ghost"
              data-testid="passkeys-refresh"
              disabled={status.kind === 'loading'}
              onClick={() => {
                dismissNotice();
                closeEditors();
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

          {adding && (
            <p className="ht-settings__hint" role="status" data-testid="passkeys-adding">
              {t('web.passkeys.waitingForPrompt')}
            </p>
          )}

          {justAdded && (
            <p className="ht-settings__notice" role="status" data-testid="passkeys-added">
              <CheckCircle2 size={12} aria-hidden="true" /> {t('web.passkeys.added')}
            </p>
          )}

          {addFailure !== undefined && (
            <p className="ht-settings__danger" role="alert" data-testid="passkeys-add-failed">
              <AlertTriangle size={12} aria-hidden="true" /> {t(addFailureKey(addFailure))}
            </p>
          )}

          {justRenamed && (
            <p className="ht-settings__notice" role="status" data-testid="passkeys-renamed">
              <CheckCircle2 size={12} aria-hidden="true" /> {t('web.passkeys.renamed')}
            </p>
          )}

          {renameFailure !== undefined && (
            <p className="ht-settings__danger" role="alert" data-testid="passkeys-rename-failed">
              <AlertTriangle size={12} aria-hidden="true" />{' '}
              {t(renameFailureKey(renameFailure), { max: HOSTED_PASSKEY_NAME_MAX_LENGTH })}
            </p>
          )}

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
              const renaming = renamingId === passkey.id;
              const confirming = confirmingId === passkey.id;
              const editing = editingId === passkey.id;
              return (
                <section
                  className="ht-settings__section"
                  key={passkey.id}
                  data-testid={`passkey-row-${passkey.id}`}
                >
                  {passkey.name !== null && (
                    <p className="ht-settings__item-label" data-testid={`passkey-name-${passkey.id}`}>
                      {passkey.name}
                    </p>
                  )}
                  <p className="ht-settings__hint">
                    {t('web.passkeys.createdAt', { date: shortDate(passkey.createdAt) })}
                    {' · '}
                    {passkey.lastUsedAt === null
                      ? t('web.passkeys.neverUsed')
                      : t('web.passkeys.lastUsedAt', {
                          date: shortDate(passkey.lastUsedAt),
                        })}
                  </p>

                  {editing ? (
                    <div className="ht-settings__actions">
                      <input
                        className="ht-input"
                        type="text"
                        data-testid={`passkey-name-input-${passkey.id}`}
                        value={draftName}
                        // 上限与服务端共用同一个常量：让用户打完 100 个字再被拒
                        // 是一次没必要的往返（服务端仍是权威，见 zod 那边的 400）。
                        maxLength={HOSTED_PASSKEY_NAME_MAX_LENGTH}
                        placeholder={t('web.passkeys.renamePlaceholder')}
                        disabled={renaming}
                        onChange={(e) => setDraftName(e.target.value)}
                      />
                      <button
                        type="button"
                        className="ht-btn ht-btn--primary"
                        data-testid={`passkey-name-save-${passkey.id}`}
                        disabled={renaming}
                        onClick={() => {
                          void (async () => {
                            // 空串 = 去掉名字：归一化在服务端做，这里原样送出。
                            await rename(baseUrl, token, passkey.id, draftName);
                            // 🔴 **只在成功时**收起输入框。失败还收起就等于把
                            // 用户刚打的字丢掉 —— 而失败正是他要改一改再存的时候。
                            if (usePasskeysStore.getState().renameFailure === undefined) {
                              setEditingId(undefined);
                            }
                          })();
                        }}
                      >
                        {renaming ? (
                          <Loader2 size={12} aria-hidden="true" />
                        ) : (
                          <CheckCircle2 size={12} aria-hidden="true" />
                        )}{' '}
                        {t('web.passkeys.save')}
                      </button>
                      <button
                        type="button"
                        className="ht-btn ht-btn--ghost"
                        data-testid={`passkey-name-cancel-${passkey.id}`}
                        disabled={renaming}
                        onClick={() => setEditingId(undefined)}
                      >
                        {t('web.passkeys.cancel')}
                      </button>
                    </div>
                  ) : (
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
                        <>
                          <button
                            type="button"
                            className="ht-btn ht-btn--ghost"
                            data-testid={`passkey-rename-${passkey.id}`}
                            disabled={deleting || renaming}
                            onClick={() => {
                              dismissNotice();
                              setConfirmingId(undefined);
                              // 草稿从**当前名字**起步；没名字时是空串。
                              setDraftName(passkey.name ?? '');
                              setEditingId(passkey.id);
                            }}
                          >
                            <Pencil size={12} aria-hidden="true" /> {t('web.passkeys.rename')}
                          </button>
                          <button
                            type="button"
                            className="ht-btn ht-btn--ghost"
                            data-testid={`passkey-delete-${passkey.id}`}
                            disabled={deleting}
                            onClick={() => {
                              dismissNotice();
                              setEditingId(undefined);
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
                        </>
                      )}
                    </div>
                  )}
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
