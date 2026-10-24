/**
 * 设置页的「个人资料」：昵称与头像的增删改查（R10）
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
 * ## 🔴 布局：三行，一列标签 + 一列控件（2026-10-24 重排）
 *
 * 产品负责人实拍的原话是「排版混乱」，逐条对得上：
 *
 * | 症状 | 病因 |
 * |---|---|
 * | 一屏三个近义标题（设置 / 个人资料 / 个人信息） | 组标题 `个人资料` + 面板自己的 `个人信息` 两级同名，层级塌成一条 |
 * | 头像和昵称的左边界各不相同 | 每块各自 `flex-direction: column`，标签/控件/按钮各起一行，缩进靠手感 |
 * | 昵称那一格看起来只是几行灰字 | `.ht-input` 的背景是 `surface`，而卡片**也是** `surface` ⇒ 没有框 |
 * | 三行长说明把三行的面板读成说明书 | 解释写进行里（`…nickname.hint`、`…avatar.needPassword`） |
 *
 * 所以现在的形状是 **一行一件事**：左列标签（+ 需要解释时一个 `?`），右列控件；
 * 行与行之间只隔一条发丝线。解释一律进 `?`（`SettingsInfoTip`），行里只留
 * 「一眼要用」的那一句。
 *
 * ## 🔴 分层：这个文件里不许有什么
 *
 * | 不许有 | 住在哪 |
 * |---|---|
 * | 端点路径、请求体、失败归类 | `@heyta/app-host` 的 `hosted-auth.ts` |
 * | 32 个码点 / 512 KB / 允许的格式 | `@heyta/shared-schema` 的 `account-profile-contract.ts` |
 * | 加密本身（Argon2id + AES-GCM / vault 信封） | `@heyta/sync-core` + `@heyta/sync-client` |
 * | 「这台设备有哪把钥匙」 | `useAvatarKey`（`features/sync/avatar-key.ts`） |
 * | 任何措辞 | `@heyta/i18n`（`check:ui-language` 拦硬编码） |
 *
 * 这里只有三件事：**渲染**、**收集输入**、**把图片压成契约要的形状**。
 * 第三件是**平台能力**（canvas 是浏览器的），所以它属于壳而不属于 app-host ——
 * RN 那侧要换 `ImageEditor`，但两端的**数字**是同一个。
 *
 * ## 🔴 三条容易写错的地方
 *
 *   1. **钥匙不在本机的时候，头像既看不见也换不了，而这不是错误。**
 *      钥匙（口令 / vault 根钥匙）从不落盘，所以每个新会话都要解锁一次
 *      （`credential-storage.ts`、ADR-0040 §7.2）。没有它，服务端那份密文对**我们**
 *      也一样解不开。所以这里给的是一个**陈述句** + 一个「去解锁」，
 *      不是红字、不是"加载失败"。
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

import { useAvatarKey } from '../sync/avatar-key.js';
import { useSyncStore } from '../sync/store.js';
import { EmailChangePanel } from './EmailChangePanel.js';
import { SettingsInfoTip } from './SettingsInfoTip.js';
import { loadAvatarImage, type AvatarFileError } from './avatar-encode.js';
import { SettingsAccountGate } from './SettingsAccountGate.js';
import { notifyAccountIdentityChanged } from './useAccountIdentity.js';

/** 一次写请求的结果，只用于决定底部那一行字。 */
type Notice =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; text: string }
  | { kind: 'error'; text: string };

export function ProfilePanel({
  active = true,
  onRequestUnlock,
}: {
  active?: boolean;
  /**
   * 「去解锁」的去处。
   *
   * 🔴 为什么是回调而不是这里自己 `setState`：这一节住在设置浮层里，而"切到哪一节"
   * 是浮层（`App.tsx`）的事。面板自己记住一个 section 名，就等于在这里抄了一份
   * 导航表 —— 那张表已经有一处漂过一次（`settings-anchors.ts` 的注释）。
   */
  onRequestUnlock?: (() => void) | undefined;
}): React.JSX.Element {
  const { t } = useI18n();

  const baseUrl = useSyncStore((s) => s.baseUrl);
  const token = useSyncStore((s) => s.token);
  const email = useSyncStore((s) => s.email);
  /** 钥匙（口令或 vault 根钥匙）—— 唯一口径见 `useAvatarKey`。 */
  const { key: avatarKey } = useAvatarKey({ active });

  /** 🔴 没有令牌就**一个请求都不发**（规则住在 app-host，这里只是不去调它）。 */
  const signedIn = baseUrl !== '' && token !== undefined;
  /** 钥匙只在内存里，所以它决定的是"这台设备今天能不能碰头像"。 */
  const canTouchAvatar = signedIn && avatarKey !== undefined;

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
  /** 账号/钥匙切换后，前一个会话的响应即使晚到也不能写回当前面板。 */
  const sessionGenerationRef = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;
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
   * 再用钥匙把密文解出来。所以"有没有头像"和"这台设备能不能显示头像"
   * 是两个不同的问题，界面上必须分开答 —— 合并成一个的症状是没有钥匙的人
   * 被告知"你还没有头像"，然后他传一张上去，把**自己原来那张**覆盖掉。
   */
  useEffect(() => {
    const generation = ++sessionGenerationRef.current;
    let cancelled = false;
    const isCurrent = (): boolean =>
      aliveRef.current && !cancelled && sessionGenerationRef.current === generation;

    if (!active || !signedIn || token === undefined) {
      if (!active) return () => {
        cancelled = true;
      };
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
      // 🔴 "要不要取图 / 有没有钥匙 / 解不解得开"不在这里判 —— 见
      //   `resolveAccountAvatarImage`。移动端接的是同一个函数（AGENTS §3.5）。
      //   原来这里是三段 `if (avatarHash === null) … / if (password === '') return;`，
      //   把解码失败的四种原因压成了同一个 `undefined`：口令不对的人因此被界面
      //   告知"你还没有头像"，他接着点「换一张」，把自己原来那张覆盖掉。
      const reading = await resolveAccountAvatarImage(options, token, avatarKey, profile.avatarHash);
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
  }, [active, avatarKey, baseUrl, signedIn, t, token]);

  /** 换一张：编码在前、上限判断在后，任何一步不对都**不发请求**。 */
  const onPickFile = async (file: File): Promise<void> => {
    const generation = sessionGenerationRef.current;
    if (!activeRef.current || !signedIn || token === undefined || avatarKey === undefined) {
      setAvatarNotice({
        kind: 'error',
        text: t('common.profile.avatar.needPassword'),
      });
      return;
    }
    setAvatarNotice({ kind: 'busy' });
    const encoded = await loadAvatarImage(file);
    if (!activeRef.current || !aliveRef.current || sessionGenerationRef.current !== generation) return;
    if (!encoded.ok) {
      setAvatarNotice({ kind: 'error', text: fileErrorText(encoded.error) });
      return;
    }
    const outcome = await uploadAccountAvatar(
      { baseUrl },
      token,
      avatarKey,
      encoded.image,
    );
    if (!activeRef.current || !aliveRef.current || sessionGenerationRef.current !== generation) return;
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
    if (!activeRef.current) return;
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
    if (!activeRef.current || !aliveRef.current || sessionGenerationRef.current !== generation) return;
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
    if (!activeRef.current || !signedIn || token === undefined) return;
    setAvatarNotice({ kind: 'busy' });
    const outcome = await deleteAccountAvatar({ baseUrl }, token);
    if (!activeRef.current || !aliveRef.current || sessionGenerationRef.current !== generation) return;
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

  if (!signedIn) return (
    <section className="ht-settings" data-testid="profile-panel" aria-label={t('common.profile.title')}>
      <SettingsAccountGate messageKey="common.profile.signInToEdit" testId="profile-signin-required" />
    </section>
  );

  /**
   * 🔴 这个面板**没有自己的 `<h2>`**（2026-10-24）。
   *
   * 它上面那层组标题已经写着「个人资料」，面板再写一个「个人信息」就是同一屏
   * 两个近义标题 —— 组标题与面板标题一般大，层级全塌。可访问名改用 `aria-label`
   * 留在这一节上：读屏拿到的名字没变，视觉上少掉一级。
   */
  return (
    /*
      🔴 面板自己就是那张卡片（`.ht-settings__content > … > .ht-settings` 给它
      `surface` + 圆角），里面**不再套**一层 `.ht-settings__section` ——
      白色套白色会让"卡片"这件事看不见，只能靠阴影猜（2026-10-24 实拍）。
      行之间的分隔交给发丝线，卡片边界交给面板。
    */
    <section
      className="ht-settings ht-settings--rows"
      data-testid="profile-panel"
      aria-label={t('common.profile.title')}
    >
      <NoticeLine notice={loadNotice} testId="profile-load-notice" />

      {/*
        一行一件事：左列标签，右列控件。

        🔴 `?` 是**常驻**的，不是"钥匙缺失时才出现"的补丁：它回答的是
        "头像为什么是加密的"，而这个事实在钥匙齐备时同样成立。
        钥匙缺失时多出来的是下面那句**可执行**的短句 +「去解锁」。
      */}
      <div className="ht-settings__row" data-testid="profile-avatar-row">
        <div className="ht-settings__row-label">
          <span className="ht-settings__item-label">{t('common.profile.avatar.label')}</span>
          <SettingsInfoTip
            label={t('common.profile.avatar.whyLabel')}
            text={t('common.profile.avatar.why')}
            testId="profile-avatar-why"
          />
        </div>
        <div className="ht-settings__row-body">
          <div className="ht-settings__avatar-line">
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
          </div>
          {/*
            钥匙不在本机：**一句可执行的话 + 一个真的能去的地方**。
            原来这里是三行长句，而且指向设置里一个登录态下根本不渲染的输入框。
          */}
          {canTouchAvatar ? null : (
            <div className="ht-settings__action-line">
              {/*
                ⚠️ 「去解锁」**不在**这句话里面：那句话是一个 `data-testid` 的
                文案载体，判据（`e2e/tests/profile-avatar-e2ee.spec.ts`）对它的
                断言是**整段文字相等**。把按钮塞进同一个元素，读到的就成了
                「…就能换头像。去解锁」—— 一条因为排版而变红的假缺陷。
              */}
              <p
                className="ht-settings__hint"
                role="status"
                data-testid="profile-avatar-need-password"
              >
                {t('common.profile.avatar.needPassword')}
              </p>
              {onRequestUnlock === undefined ? null : (
                <button
                  type="button"
                  className="ht-btn ht-btn--ghost ht-settings__inline-action"
                  data-testid="profile-avatar-unlock"
                  onClick={onRequestUnlock}
                >
                  {t('common.profile.avatar.unlock')}
                </button>
              )}
            </div>
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
      </div>

      <div className="ht-settings__row" data-testid="profile-nickname-row">
        <div className="ht-settings__row-label">
          <label className="ht-settings__item-label" htmlFor="profile-nickname">
            {t('common.profile.nickname.label')}
          </label>
          <SettingsInfoTip
            label={t('common.profile.nickname.whyLabel')}
            text={t('common.profile.nickname.why')}
            testId="profile-nickname-why"
          />
        </div>
        <div className="ht-settings__row-body">
          <div className="ht-settings__actions">
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
          {/* 行里只留一眼要用的那个数；"昵称不是什么"在 `?` 里。 */}
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
          <NoticeLine notice={nameNotice} testId="profile-nickname-notice" />
        </div>
      </div>

      {email === undefined ? null : (
        <div className="ht-settings__row" data-testid="profile-email-row">
          <div className="ht-settings__row-label">
            <span className="ht-settings__item-label">{t('common.profile.email.label')}</span>
          </div>
          <div className="ht-settings__row-body">
            <p className="ht-settings__value" data-testid="profile-email">
              {email}
            </p>
            <SettingsInfoTip
            testId="tip-profile-email"
            label={t('common.profile.email.label')}
            text={t('common.profile.email.hint')}
          />
          </div>
        </div>
      )}

      {/*
        换绑登录邮箱（ADR-0063）。它挂在**邮箱那一行的正下面**而不是另开一节：
        「这个地址能换」这件事，用户只在看见当前地址的那一刻会想到 ——
        放在设置页别处就是让他先读到一句"邮箱是登录标识"，再去别的地方找那个按钮。
        面板自己带未登录 guard（与这里的 `signedIn` 同一条口径）。
      */}
      {/*
        与上面三行之间画一条线：换邮箱是**另一件事**（它牵涉两个收件箱和一次确认），
        不是第四行资料。原来它和行之间只有一段看不见的空白（白卡片上白空隙）。
      */}
      <div className="ht-settings__footer">
        <EmailChangePanel active={active} />
      </div>
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
