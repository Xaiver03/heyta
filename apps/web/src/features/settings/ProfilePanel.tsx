/**
 * 设置页的「个人信息」：昵称与头像的增删改查（R10）
 * =================================================
 *
 * 产品负责人 2026-10-02 的原话是"个人 Profile 页面的增删改查"。形态取自她认可的
 * 六家竞品：**头像 → 菜单 → 二级页**（菜单项「编辑个人信息」，落点就是本面板）。
 * 完整调研与裁决链在 `docs/plans/ui-review-fill-zh-timeline.md` §8。
 *
 * ## 为什么它在设置浮层里，而不是一个新的 `view`
 *
 * 应用只有**一个**次级表面机制（`App.tsx` 的 `settingsBaseView` + `.ht-sheet`），
 * 它的存在理由是"次级表面里做的事都需要回头看下面"。再造一个浮层态就是把同一件事
 * 写第二份 —— 而本仓库已经为这种事付过三次学费（AGENTS §3.5 的两处实测漂移、
 * §7 第 66 条）。加一个 `ViewKey` 还会连带撞 R9 那条页头标题判据与 `narrow-sweep`
 * 的视图遍历（它按 `VIEW_TABS` 数视图）。
 *
 * ## 🔴 分层：这个文件里不许有什么
 *
 * | 不许有 | 住在哪 |
 * |---|---|
 * | 端点路径、请求体、失败归类 | `@heyta/app-host` 的 `hosted-auth.ts` |
 * | 32 个码点 / 512 KB / 允许的格式 | `@heyta/shared-schema` 的 `account-profile-contract.ts` |
 * | 加密本身（Argon2id + AES-GCM） | `@heyta/sync-core`，由 app-host 调用 |
 * | 任何措辞 | `@heyta/i18n`（`check:ui-language` 拦硬编码） |
 *
 * 这里只有三件事：**渲染**、**收集输入**、**把图片压成契约要的形状**。
 * 第三件是**平台能力**（canvas 是浏览器的），所以它属于壳而不属于 app-host ——
 * RN 那侧要换 `ImageEditor`，但两端的**数字**是同一个。
 *
 * ## 🔴 三条容易写错的地方
 *
 *   1. **口令不在内存里的时候，头像既看不见也换不了，而这不是错误。**
 *      `credential-storage.ts` 的立场是"只落 `baseUrl` 与 `token`，**绝不落口令**"，
 *      所以每个新会话都要用户再填一次（`SyncBar.tsx:143-147` 已经写明了这件事）。
 *      口令就是头像的钥匙 —— 没有它，服务端那份密文对**我们**也一样解不开。
 *      所以这里给的是一个**陈述句**（`…avatar.needPassword`），不是红字、不是"加载失败"。
 *      ⚠️ 把它做成错误提示的症状：从没设过头像的人每次刷新都被凶一次。
 *
 *   2. **昵称的字数用码点，不用 `.length`。**
 *      `displayNameCodePoints` 与 `ACCOUNT_DISPLAY_NAME_MAX_CODE_POINTS` 都来自契约：
 *      界面自己数一遍就是第二套口径，而 emoji（代理对）会让两套口径差一倍 ——
 *      症状是"界面说没超，服务端拒了"，那是最让用户困惑的一种不一致。
 *
 *   3. **空昵称是合法值，语义是"清除"。**
 *      留空 ⇒ 界面回落到邮箱派生的显示名（`displayNameFromEmail`，一份只读派生值）。
 *      所以保存按钮不能因为"没填"而变成"没操作"：从有到空是一次**真实的**写。
 */

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@heyta/i18n';
import {
  deleteAccountAvatar,
  getAccountProfile,
  planDisplayNameWrite,
  resolveAccountAvatarImage,
  updateAccountDisplayName,
  uploadAccountAvatar,
  type AccountAvatarImage,
} from '@heyta/app-host';
import {
  ACCOUNT_AVATAR_CONTENT_TYPES,
  ACCOUNT_AVATAR_EDGE_PX,
  ACCOUNT_AVATAR_MAX_SOURCE_BYTES,
  ACCOUNT_DISPLAY_NAME_MAX_CODE_POINTS,
  avatarDataUri,
  avatarInitialFromEmail,
  displayNameCodePoints,
} from '@heyta/shared-schema';

import { useSyncStore } from '../sync/store.js';
import { loadAvatarImage, type AvatarFileError } from './avatar-encode.js';
import { notifyAccountIdentityChanged } from './useAccountIdentity.js';

/** 一次写请求的结果，只用于决定底部那一行字。 */
type Notice =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; text: string }
  | { kind: 'error'; text: string };

export function ProfilePanel(): React.JSX.Element {
  const { t } = useI18n();

  const baseUrl = useSyncStore((s) => s.baseUrl);
  const token = useSyncStore((s) => s.token);
  const password = useSyncStore((s) => s.password);
  const email = useSyncStore((s) => s.email);

  /** 🔴 没有令牌就**一个请求都不发**（规则住在 app-host，这里只是不去调它）。 */
  const signedIn = baseUrl !== '' && token !== undefined;
  /** 口令只在内存里，所以它决定的是"这台设备今天能不能碰头像"。 */
  const canTouchAvatar = signedIn && password !== undefined && password !== '';

  const [draft, setDraft] = useState('');
  /** 服务端当前那个昵称。用来区分"没改过"与"改回原值"，也用来出占位符。 */
  const [savedName, setSavedName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  /** 读侧的结论由共享裁决给出（`absent` / `needs-password` / `undecryptable` / `unreadable`）。 */
  const [avatarState, setAvatarState] = useState<AccountAvatarImage['state'] | undefined>(
    undefined,
  );
  const [nameNotice, setNameNotice] = useState<Notice>({ kind: 'idle' });
  const [avatarNotice, setAvatarNotice] = useState<Notice>({ kind: 'idle' });
  /**
   * 🔴 资料**读取**失败单独一行，不借用昵称或头像那两句。
   * 以前这里写的是 `nameNotice = t('common.profile.avatar.failed')` ——
   * 一次 GET 失败，界面却在昵称下面说"头像没有传上去"：一件从没发生过的事。
   */
  const [loadNotice, setLoadNotice] = useState<Notice>({ kind: 'idle' });
  const fileRef = useRef<HTMLInputElement | null>(null);
  /** 卸载后**不许**再 setState：这两条路都是 await 回来的。 */
  const aliveRef = useRef(true);
  /** 账号/口令切换后，前一个会话的响应即使晚到也不能写回当前面板。 */
  const sessionGenerationRef = useRef(0);
  useEffect(() => {
    // StrictMode 会执行 setup → cleanup → setup；每次 setup 都恢复存活状态。
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /**
   * 读取当前资料。
   *
   * 🔴 头像**分两步**：先拿 `avatarHash`（服务端给的就是这个，它解不开内容），
   * 再用口令把密文解出来。所以"有没有头像"和"这台设备能不能显示头像"
   * 是两个不同的问题，界面上必须分开答 —— 合并成一个的症状是没有口令的人
   * 被告知"你还没有头像"，然后他传一张上去，把**自己原来那张**覆盖掉。
   */
  useEffect(() => {
    const generation = ++sessionGenerationRef.current;
    let cancelled = false;
    const isCurrent = (): boolean =>
      aliveRef.current && !cancelled && sessionGenerationRef.current === generation;

    if (!signedIn || token === undefined) {
      setSavedName(null);
      setDraft('');
      setAvatarUrl(undefined);
      setAvatarState(undefined);
      return () => {
        cancelled = true;
      };
    }
    const options = { baseUrl };
    void (async () => {
      const profile = await getAccountProfile(options, token);
      if (!isCurrent()) return;
      if (!profile.ok) {
        setLoadNotice({ kind: 'error', text: t('common.profile.loadFailed') });
        return;
      }
      setLoadNotice({ kind: 'idle' });
      setSavedName(profile.displayName);
      setDraft(profile.displayName ?? '');
      // 🔴 "要不要取图 / 有没有口令 / 解不解得开"不在这里判 —— 见
      //   `resolveAccountAvatarImage`。移动端接的是同一个函数（AGENTS §3.5）。
      //   原来这里是三段 `if (avatarHash === null) … / if (password === '') return;`，
      //   把解码失败的四种原因压成了同一个 `undefined`：口令不对的人因此被界面
      //   告知"你还没有头像"，他接着点「换一张」，把自己原来那张覆盖掉。
      const reading = await resolveAccountAvatarImage(options, token, password, profile.avatarHash);
      if (!isCurrent()) return;
      setAvatarState(reading.state);
      if (reading.state === 'ready') setAvatarUrl(reading.dataUri);
      else if (reading.state === 'absent') setAvatarUrl(undefined);
      // 其余三种**不动**已显示的图：一次取不到不该让已经看到的头像凭空消失，
      // 而 `avatarState` 那句话会说明它可能不是最新的。
    })();
    return () => {
      cancelled = true;
    };
  }, [baseUrl, password, signedIn, t, token]);

  /** 换一张：编码在前、上限判断在后，任何一步不对都**不发请求**。 */
  const onPickFile = async (file: File): Promise<void> => {
    const generation = sessionGenerationRef.current;
    if (!signedIn || token === undefined || password === undefined) {
      setAvatarNotice({
        kind: 'error',
        text: t('common.profile.avatar.needPassword'),
      });
      return;
    }
    setAvatarNotice({ kind: 'busy' });
    const encoded = await loadAvatarImage(file);
    if (!aliveRef.current || sessionGenerationRef.current !== generation) return;
    if (!encoded.ok) {
      setAvatarNotice({ kind: 'error', text: fileErrorText(encoded.error) });
      return;
    }
    const outcome = await uploadAccountAvatar(
      { baseUrl },
      token,
      password,
      encoded.image,
    );
    if (!aliveRef.current || sessionGenerationRef.current !== generation) return;
    if (!outcome.ok) {
      setAvatarNotice({ kind: 'error', text: t('common.profile.avatar.failed') });
      return;
    }
    setAvatarUrl(avatarDataUri(encoded.image));
    // 🔴 说的是**头像**那句。这里曾经复用 `nickname.saved`（"昵称已保存"），
    //    于是用户换完照片看到的是一句关于别的东西的话。
    setAvatarNotice({ kind: 'done', text: t('common.profile.avatar.uploaded') });
    setAvatarState('ready');
    notifyAccountIdentityChanged();
  };

  const fileErrorText = (error: AvatarFileError): string =>
    error === 'bad-type'
      ? t('common.profile.avatar.badType', {
          types: ACCOUNT_AVATAR_CONTENT_TYPES.map((c) => c.replace('image/', '')).join(' / '),
        })
      : error === 'too-big'
        ? t('common.profile.avatar.tooBig', {
            max: `${Math.floor(ACCOUNT_AVATAR_MAX_SOURCE_BYTES / 1024)} KB`,
          })
        : t('common.profile.avatar.failed');

  const saveNickname = async (): Promise<void> => {
    const generation = sessionGenerationRef.current;
    // 🔴 「这一发到底发不发、发什么」不在这里判 —— 见 `planDisplayNameWrite`。
    //    移动端做的是同一件事，两边各写一遍就是从两个地方各判一遍（AGENTS §3.5）。
    //    `baseUrl === ''` 折算成"没有可用凭据"：本机的 `signedIn` 就是这么定义的。
    const plan = planDisplayNameWrite({
      token: baseUrl === '' ? undefined : token,
      draft,
      saved: savedName,
    });
    if (plan.action === 'skip') return;
    setNameNotice({ kind: 'busy' });
    const outcome = await updateAccountDisplayName({ baseUrl }, plan.token, plan.value);
    if (!aliveRef.current || sessionGenerationRef.current !== generation) return;
    if (!outcome.ok) {
      setNameNotice({ kind: 'error', text: t('common.profile.nickname.failed') });
      return;
    }
    setSavedName(outcome.displayName);
    setNameNotice({
      kind: 'done',
      text:
        outcome.displayName === null
          ? t('common.profile.nickname.cleared')
          : t('common.profile.nickname.saved'),
    });
    notifyAccountIdentityChanged();
  };

  const removeAvatar = async (): Promise<void> => {
    const generation = sessionGenerationRef.current;
    if (!signedIn || token === undefined) return;
    setAvatarNotice({ kind: 'busy' });
    const outcome = await deleteAccountAvatar({ baseUrl }, token);
    if (!aliveRef.current || sessionGenerationRef.current !== generation) return;
    if (!outcome.ok) {
      setAvatarNotice({ kind: 'error', text: t('common.profile.avatar.failed') });
      return;
    }
    setAvatarUrl(undefined);
    setAvatarState('absent');
    setAvatarNotice({ kind: 'done', text: t('common.profile.avatar.removed') });
    notifyAccountIdentityChanged();
  };

  const codePoints = displayNameCodePoints(draft);
  /** 没有头像时圈里的字母 —— 判定在共享层，与移动端同一份（这里只是渲染它）。 */
  const avatarInitial = avatarInitialFromEmail(email);
  /** 读侧那三种"有头像但这台设备显示不出来"的状态才需要说一句话。 */
  const avatarReadMessage =
    avatarState === 'undecryptable'
      ? t('common.profile.avatar.undecryptable')
      : avatarState === 'unreadable'
        ? t('common.profile.avatar.unreadable')
        : null;
  const tooLong = codePoints > ACCOUNT_DISPLAY_NAME_MAX_CODE_POINTS;
  /** 与当前值相同 ⇒ 这一次点击不产生写（空转的请求也算副作用）。 */
  const unchanged = draft.trim() === (savedName ?? '').trim();

  return (
    <section className="ht-settings" data-testid="profile-panel">
      <h2 className="ht-settings__title ht-type-section-title">
        {t('common.profile.title')}
      </h2>
      {!signedIn ? (
        <p className="ht-settings__hint" data-testid="profile-signin-required">
          {t('common.profile.signInToEdit')}
        </p>
      ) : null}
      <NoticeLine notice={loadNotice} testId="profile-load-notice" />

      <div className="ht-settings__section" data-testid="profile-avatar-row">
        <div className="ht-settings__item-label">{t('common.profile.avatar.label')}</div>
        <div className="ht-settings__avatar" data-testid="profile-avatar">
          {avatarUrl === undefined ? (
            // 没有图就用邮箱首字母。⚠️ 拿不到邮箱时**不编一个字母**（与头像菜单同一条纪律，
            // 两处现在都读 `avatarInitialFromEmail`）。
            avatarInitial === undefined ? null : <span aria-hidden="true">{avatarInitial}</span>
          ) : (
            <img src={avatarUrl} alt="" data-testid="profile-avatar-img" />
          )}
        </div>
        {/*
          文件输入本身**不显示**：它是隐藏的，点「换一张」才弹系统选择框。
          ⚠️ 但它必须**在 DOM 里**而不是条件渲染 —— 真浏览器判据要点它，
          而 `accept` 白名单是契约的一部分（服务端只看密文，格式只有这里能拦）。
        */}
        <input
          ref={fileRef}
          type="file"
          accept={ACCOUNT_AVATAR_CONTENT_TYPES.join(',')}
          className="ht-settings__file"
          data-testid="profile-avatar-file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file !== undefined) void onPickFile(file);
          }}
        />
        <div className="ht-settings__actions">
          <button
            type="button"
            className="ht-btn ht-btn--ghost"
            data-testid="profile-avatar-change"
            disabled={!canTouchAvatar}
            onClick={() => fileRef.current?.click()}
          >
            {t('common.profile.avatar.change')}
          </button>
          {avatarUrl === undefined ? null : (
            <button
              type="button"
              className="ht-btn ht-btn--ghost"
              data-testid="profile-avatar-remove"
              disabled={!canTouchAvatar}
              onClick={() => void removeAvatar()}
            >
              {t('common.profile.avatar.remove')}
            </button>
          )}
        </div>
        {canTouchAvatar ? null : (
          <p className="ht-settings__hint" data-testid="profile-avatar-need-password">
            {t('common.profile.avatar.needPassword')}
          </p>
        )}
        <NoticeLine notice={avatarNotice} testId="profile-avatar-notice" />
        {/*
          读侧那句与写侧那句**分开渲染**：`avatarNotice` 记的是"用户刚做的那件事的结果"，
          这一行记的是"这台设备现在能不能看到头像"。合成一行的后果是
          上传成功后紧跟着一次读取失败，界面就把两件不同的事说成同一句。
        */}
        {avatarReadMessage === null ? null : (
          <p className="ht-settings__hint" data-testid="profile-avatar-read-notice">
            {avatarReadMessage}
          </p>
        )}
      </div>

      <div className="ht-settings__section" data-testid="profile-nickname-row">
        <label className="ht-settings__item-label" htmlFor="profile-nickname">
          {t('common.profile.nickname.label')}
        </label>
        <input
          id="profile-nickname"
          type="text"
          className="ht-input"
          data-testid="profile-nickname-input"
          disabled={!signedIn}
          value={draft}
          maxLength={ACCOUNT_DISPLAY_NAME_MAX_CODE_POINTS * 2}
          placeholder={t('common.profile.nickname.placeholder')}
          onChange={(event) => {
            setDraft(event.target.value);
            setNameNotice({ kind: 'idle' });
          }}
        />
        <p className="ht-settings__hint">
          {t('common.profile.nickname.hint', {
            max: String(ACCOUNT_DISPLAY_NAME_MAX_CODE_POINTS),
          })}
        </p>
        {tooLong ? (
          <p className="ht-settings__danger" data-testid="profile-nickname-toolong">
            {t('common.profile.nickname.toolong', {
              max: String(ACCOUNT_DISPLAY_NAME_MAX_CODE_POINTS),
              count: String(codePoints),
            })}
          </p>
        ) : null}
        <div className="ht-settings__actions">
          <button
            type="button"
            className="ht-btn ht-btn--primary"
            data-testid="profile-nickname-save"
            disabled={!signedIn}
            onClick={() => void saveNickname()}
          >
            {t('common.profile.nickname.save')}
          </button>
        </div>
        <NoticeLine notice={nameNotice} testId="profile-nickname-notice" />
      </div>

      {email === undefined ? null : (
        <div className="ht-settings__section" data-testid="profile-email-row">
          <div className="ht-settings__item-label">{t('common.profile.email.label')}</div>
          <p className="ht-settings__hint" data-testid="profile-email">
            {email}
          </p>
          <p className="ht-settings__hint">{t('common.profile.email.hint')}</p>
        </div>
      )}
    </section>
  );
}

function NoticeLine({
  notice,
  testId,
}: {
  notice: Notice;
  testId: string;
}): React.JSX.Element | null {
  if (notice.kind === 'idle' || notice.kind === 'busy') return null;
  return (
    <p
      className={notice.kind === 'error' ? 'ht-settings__danger' : 'ht-settings__notice'}
      data-testid={testId}
      role="status"
    >
      {notice.text}
    </p>
  );
}
