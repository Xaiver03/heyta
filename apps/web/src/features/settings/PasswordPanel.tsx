/**
 * 设置页「修改登录密码」（口令这条路 W6f）
 * ==========================================
 *
 * 服务端（`/api/password/change`）、协议端口（`@heyta/app-host` 的 `changePassword`）、
 * 状态机（`useAuthStore.changePassword`）**早就都在**，缺的只有这个面板 ——
 * 也就是说在补上它之前，`changePassword` 这条动作**在整个仓库里没有一个调用点**，
 * 用户改不了自己的登录密码，而词条里已经写着"正在修改密码…"（`common.auth.busy.change`）。
 *
 * ## 分层（AGENTS.md §3.5）
 *
 * 这里**没有一行协议知识**，也没有"这个密码合不合格"的判断：
 *   - 端点、令牌怎么带、失败归类 → `@heyta/app-host` 的 `hosted-auth.ts`；
 *   - 长度上下限、常见口令、泄露库 → **服务端**（`password/policy.ts` 是唯一口径），
 *     这里**不做本地强度校验**，只做"没填不许发"；
 *   - 那个长度数字 → `@heyta/shared-schema` 的 `AUTH_PASSWORD_MIN_CODE_POINTS`，
 *     界面只念出来，**不自己写 8**；
 *   - 状态机 → `../auth/store.js`。**不另建一份 store**：`changePassword` 成功后要换上
 *     那枚刚被 `tokenVersion++` 作废的旧令牌，那份接线只有一份（`applyAuthSession`）。
 * 本文件只做两件事：**渲染**和**收集输入**。
 *
 * ## 🔴 四条必须说清楚的地方
 *
 *   1. **每一次都划清两个秘密的界线。** 标题与 lead 都点名"登录密码"，并明说加密口令
 *      不在这里（ADR-0040 §3.2 D1）。一句光秃秃的"密码已修改"会让人以为数据也跟着
 *      换了钥匙 —— 或者反过来，以为忘了加密口令能在这儿找回。
 *   2. **按钮不禁用**（ADR-0040 §3.7：禁用态让人困惑，提交后禁用还会甩掉焦点）。
 *      忙的时候再点是空操作，guard 在 `submit` 的第一行。
 *   3. **"其余设备都要重新登录"要在点之前就写出来**，不是成功之后才通知
 *      （`store.ts:260` 那句话欠的就是这一格）。
 *   4. **失败时不清空输入，焦点落到该改的那个框。** `invalid-credentials` 要改的是
 *      **当前密码**，`password-policy` 要改的是**新密码** —— 焦点丢在错的那个框里，
 *      用户会重打一遍根本没错的东西。其余原因（网络 / 过载 / 锁定）两个框都没错，
 *      **不动焦点**。
 *
 * ## 为什么这里没有"再输一次新密码"
 *
 * 这张表已经要求**当前密码** —— 那是"你是本人"的证明，比一个防手抖的确认框强得多，
 * 而显隐开关就在旁边，看一眼就能核对。⚠️ 服务端渲染的那张 `/reset-password` 页**有**
 * 确认框：那里没有当前密码可验。两个形状各自服务不同的证明责任，不是漂移。
 *
 * ## 「忘记密码」这一格为什么可以放
 *
 * 改密要当前密码，所以忘了当前密码的人在这张表里走不通。`/password/forgot` 是唯一的
 * 出口，而且它的响应**与账号是否存在无关**（反枚举）：对一个真有口令的账号它是真解药，
 * 对一个纯通行密钥账号它回同一句中性话、但**不发信**（`recovery.ts:117`）。
 * 所以这里的按钮只在**知道邮箱**时出现，成功句也只能是那句中性的
 * `common.auth.sent.reset`（"如果我们认得这个邮箱…"）—— **不许**写"信已发到"。
 */

import { useRef, useState } from 'react';

import { useI18n, type MessageKey, type MessageVars } from '@heyta/i18n';
import { AUTH_PASSWORD_MAX_CODE_POINTS, AUTH_PASSWORD_MIN_CODE_POINTS } from '@heyta/shared-schema';
import {
  authFailureMessageKey,
  defaultPasswordRevealed,
  passwordAutocomplete,
  passwordPolicyMessageKey,
} from '@heyta/ui';
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Loader2 } from 'lucide-react';

import { useAuthStore, type AuthStatus } from '../auth/store.js';
import { useSyncStore } from '../sync/store.js';

/**
 * 本面板自己那一段结果。
 *
 * 🔴 `field` 是**可选**的：不是每条失败都对应一个框（网络 / 过载 / 锁定两个框都没错），
 * 而"忘了把 field 填上"在类型上必须是合法的 —— 所以这里不能把它写成必填再到处塞占位值。
 */
type Outcome =
  | { readonly kind: 'failed'; readonly key: MessageKey; readonly vars?: MessageVars; readonly field?: PanelField }
  | { readonly kind: 'changed' }
  /**
   * 这个账号**从来没有**口令（纯通行密钥 / 魔法链接注册的）。
   *
   * 🔴 单独一个形状而不是"一行红字"：这里没有"当前密码"可打，把整张表单摆着
   * 等用户去猜自己记错了什么，是界面在浪费别人的时间。
   * 这一屏也**不再**给那个"忘记密码"的按钮：`requestPasswordReset` 对没有口令
   * 认证器的账号**刻意不发信**（反枚举，`recovery.ts:117`），而这一屏刚说完
   * "这个账号没有口令" —— 再摆一个不会发信的按钮就是明知是死路还指过去。
   * 要给这种账号加第一个口令，缺的是 `/password/set` 那条路由（登记为缺口）。
   */
  | { readonly kind: 'no-password' }
  | { readonly kind: 'reset-sent' };

/** 出错该落到哪个框（焦点与 `aria-invalid` 用同一个词表）。 */
type PanelField = 'current' | 'new';

/**
 * 全局 `failed` → 面板要渲染的那句话，加上该标红的框。
 *
 * 两个动作（改密 / 发重置信）**共用这一份映射** —— 在面板里各写一遍
 * `reason → key` 就是 ADR-0040 §3.7 反对的那个形状。
 *
 * 🔴 `password-policy` 走**下一层**判别：不带 `policyCode` 界面只能说"口令不合格"，
 * 而四种拒绝（太短 / 太长 / 太常见 / 出现在泄露库）用户要做的事各不相同。
 */
function failureOutcome(
  status: Extract<AuthStatus, { kind: 'failed' }>,
): Extract<Outcome, { kind: 'failed' }> {
  const isPolicy = status.reason === 'password-policy' && status.policyCode !== undefined;
  const key = isPolicy
    ? passwordPolicyMessageKey(status.policyCode)
    : authFailureMessageKey(status.reason, { retryAfterSeconds: status.retryAfterSeconds });
  // 要改哪个框：策略类与新口令本身有关；`invalid-credentials` 在**这张表**上指的是
  // 当前密码打错了（不是"你没登录"）。其余原因两个框都没错，**不动焦点**。
  const field: PanelField | undefined = isPolicy
    ? 'new'
    : status.reason === 'invalid-credentials'
      ? 'current'
      : undefined;
  return {
    kind: 'failed',
    key,
    ...(isPolicy
      ? { vars: { min: AUTH_PASSWORD_MIN_CODE_POINTS, max: AUTH_PASSWORD_MAX_CODE_POINTS } }
      : {}),
    ...(field !== undefined ? { field } : {}),
  };
}

/**
 * 忙是从**共用的**那台认证状态机读的，所以必须按 action 收窄。
 *
 * 🔴 不加 `action === 'password-change'` 的话，一次**登录**失败会在设置页里
 * 渲染成"正在修改密码…"或者别的错位的句子。
 */
function useBusy(action: 'password-change' | 'password-forgot'): boolean {
  return useAuthStore((s) => s.status.kind === 'busy' && s.status.action === action);
}

export function PasswordPanel(): React.JSX.Element {
  const { t } = useI18n();

  const baseUrl = useSyncStore((s) => s.baseUrl);
  const token = useSyncStore((s) => s.token);
  const email = useSyncStore((s) => s.email);

  const busyChange = useBusy('password-change');
  const busyForgot = useBusy('password-forgot');

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  /** 本地校验（只有"没填"这一种）落在哪个框。 */
  const [localError, setLocalError] = useState<PanelField | undefined>(undefined);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  // 显隐默认档由 `@heyta/ui` 给（ADR-0040 §3.7）。web 壳传 desktop：手机浏览器自己带
  // peek 按钮，而"默认明文"在任何端都不是好默认。两档都保留开关。
  const [revealCurrent, setRevealCurrent] = useState(defaultPasswordRevealed('desktop'));
  const [revealNext, setRevealNext] = useState(defaultPasswordRevealed('desktop'));

  const currentRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLInputElement>(null);

  const signedIn = typeof token === 'string' && token !== '';

  const invalidField =
    localError ?? (outcome?.kind === 'failed' ? outcome.field : undefined);

  const submit = async (): Promise<void> => {
    // 🔴 in-flight guard（不是 disabled）：忙的时候重复点击直接忽略。
    if (busyChange) return;
    const missing: PanelField | undefined =
      current === '' ? 'current' : next === '' ? 'new' : undefined;
    setLocalError(missing);
    if (missing !== undefined) {
      // 视觉顺序优先（GOV.UK 的校验模式，与 `firstAuthErrorField` 同一条理由）：
      // 焦点跳到一个用户视线不在那里的框，比不跳更糟。
      (missing === 'current' ? currentRef : nextRef).current?.focus();
      return;
    }
    setOutcome(null);
    await useAuthStore.getState().changePassword(baseUrl, token, current, next);
    const status = useAuthStore.getState().status;
    if (status.kind === 'password-changed') {
      // 两个草稿都清掉：此刻"当前密码"已经不是当前密码了，留着只会让人下一轮
      // 拿旧的那句去填第一个框。
      setCurrent('');
      setNext('');
      setOutcome({ kind: 'changed' });
      return;
    }
    if (status.kind === 'failed') {
      if (status.reason === 'no-password-set') {
        setOutcome({ kind: 'no-password' });
        return;
      }
      const result = failureOutcome(status);
      if (result.field !== undefined) {
        (result.field === 'current' ? currentRef : nextRef).current?.focus();
      }
      setOutcome(result);
      return;
    }
    // 到不了这里：这条动作只会落 `password-changed` 或 `failed`。
    // 不写 `else throw` —— 但**也不静默留一条旧结果**，所以显式清空。
    setOutcome(null);
  };

  const sendReset = async (): Promise<void> => {
    if (busyForgot || email === undefined) return;
    setOutcome(null);
    await useAuthStore.getState().forgotPassword(baseUrl, email);
    const status = useAuthStore.getState().status;
    // 🔴 成功也只能渲染那句**中性的**话（`common.auth.sent.reset`：
    // "如果我们认得这个邮箱…"）。这一条响应与账号是否存在无关，界面不许替服务端
    // 把那个条件判掉。
    setOutcome(
      status.kind === 'reset-sent'
        ? { kind: 'reset-sent' }
        : status.kind === 'failed'
          ? failureOutcome(status)
          : null,
    );
  };

  return (
    <div className="ht-settings" data-testid="password-panel">
      <h2 className="ht-settings__title">{t('web.settings.password.title')}</h2>
      <p className="ht-settings__hint">{t('web.settings.password.lead')}</p>

      {!signedIn ? (
        <p className="ht-settings__hint" data-testid="password-needs-sign-in">
          {t('web.settings.password.needsSignIn')}
        </p>
      ) : outcome?.kind === 'no-password' ? (
        /*
          这个账号没有口令 —— 表单整张**收起来**：留着两个框等用户去猜自己
          记错了什么，比说一句话更浪费时间。
        */
        <p className="ht-settings__hint" data-testid="password-no-password">
          {t('web.settings.password.noPassword')}
        </p>
      ) : (
        <div className="ht-settings__section">
          <label className="ht-settings__item-label" htmlFor="ht-password-current">
            {t('web.settings.password.current')}
          </label>
          <div className="ht-settings__actions">
            <input
              ref={currentRef}
              id="ht-password-current"
              className="ht-input"
              type={revealCurrent ? 'text' : 'password'}
              // 🔴 **不写 maxLength**：NIST 禁止静默截断口令输入，超长交给服务端按码点判。
              data-testid="password-current"
              value={current}
              // 失败后不清空（ADR-0040 §3.7）：除了成功那一条，没有任何路径重置它。
              onChange={(e) => {
                setCurrent(e.target.value);
                if (localError === 'current') setLocalError(undefined);
              }}
              autoComplete={passwordAutocomplete('sign-in')}
              aria-invalid={invalidField === 'current'}
            />
            <button
              type="button"
              className="ht-btn ht-btn--ghost"
              data-testid="password-reveal-current"
              aria-pressed={revealCurrent}
              onClick={() => setRevealCurrent((v) => !v)}
            >
              {revealCurrent ? (
                <EyeOff size={12} aria-hidden="true" />
              ) : (
                <Eye size={12} aria-hidden="true" />
              )}{' '}
              {/*
                标签**固定**说"显示密码"，状态交给 `aria-pressed`（扁平开关的写法）：
                一个跟着状态改字的按钮（"显示"↔"隐藏"）配上 pressed 会让读屏念出
                "隐藏密码，已按下"这种自相矛盾的话。
              */}
              {t('common.auth.form.showPassword')}
            </button>
          </div>

          <label className="ht-settings__item-label" htmlFor="ht-password-new">
            {t('web.settings.password.new')}
          </label>
          <div className="ht-settings__actions">
            <input
              ref={nextRef}
              id="ht-password-new"
              className="ht-input"
              type={revealNext ? 'text' : 'password'}
              data-testid="password-new"
              value={next}
              onChange={(e) => {
                setNext(e.target.value);
                if (localError === 'new') setLocalError(undefined);
              }}
              autoComplete={passwordAutocomplete('register')}
              aria-invalid={invalidField === 'new'}
            />
            <button
              type="button"
              className="ht-btn ht-btn--ghost"
              data-testid="password-reveal-new"
              aria-pressed={revealNext}
              onClick={() => setRevealNext((v) => !v)}
            >
              {revealNext ? (
                <EyeOff size={12} aria-hidden="true" />
              ) : (
                <Eye size={12} aria-hidden="true" />
              )}{' '}
              {t('common.auth.form.showPassword')}
            </button>
          </div>
          <p className="ht-settings__hint" data-testid="password-hint">
            {t('web.settings.password.minLength', { min: AUTH_PASSWORD_MIN_CODE_POINTS })}{' '}
            {t('common.auth.form.passwordHint')}
          </p>

          <div className="ht-settings__actions">
            <button
              type="button"
              className="ht-btn ht-btn--primary"
              data-testid="password-submit"
              // 🔴 没有 `disabled`：忙的时候点它是空操作（`submit` 第一行的 guard）。
              onClick={() => {
                void submit();
              }}
            >
              {busyChange ? (
                <Loader2 size={12} aria-hidden="true" />
              ) : (
                <CheckCircle2 size={12} aria-hidden="true" />
              )}{' '}
              {busyChange ? t('common.auth.busy.change') : t('web.settings.password.submit')}
            </button>

            {email === undefined ? null : (
              <button
                type="button"
                className="ht-btn ht-btn--ghost"
                data-testid="password-forgot"
                onClick={() => {
                  void sendReset();
                }}
              >
                {busyForgot ? (
                  <Loader2 size={12} aria-hidden="true" />
                ) : (
                  <AlertTriangle size={12} aria-hidden="true" />
                )}{' '}
                {t('common.auth.form.forgotPassword')}
              </button>
            )}
          </div>

          {/*
            那句"重置链接会发到 X"是给上面那个按钮**交代去处**：按钮不知道账号
            有没有口令（服务端也不许界面猜），所以这句话只能报邮箱、不保证送达。
          */}
          {email === undefined ? null : (
            <p className="ht-settings__hint" data-testid="password-reset-to">
              {t('web.settings.password.resetTo', { email })}
            </p>
          )}

          {/*
            🔴 这句在**点之前**就得看得见（`store.ts:260` 欠的那一格）：
            "其余设备全部要重新登录"是改密的后果，不是失败信息。
          */}
          <p className="ht-settings__hint" data-testid="password-consequence">
            {t('web.settings.password.otherDevices')}
          </p>

          {/*
            `aria-live`：错误与成功都必须是**文字**（WCAG SC 3.3.1）且要播报。
            这块平时是空的 —— 挂着合法（没有节点可读）。
          */}
          <div aria-live="polite" data-testid="password-live">
            {localError !== undefined && (
              <p className="ht-settings__danger" data-testid="password-local-error">
                <AlertTriangle size={12} aria-hidden="true" /> {t('common.auth.form.passwordRequired')}
              </p>
            )}

            {outcome?.kind === 'changed' && (
              <p className="ht-settings__notice" data-testid="password-changed">
                <CheckCircle2 size={12} aria-hidden="true" /> {t('web.settings.password.changed')}
              </p>
            )}

            {outcome?.kind === 'reset-sent' && (
              <p className="ht-settings__notice" data-testid="password-reset-sent">
                <CheckCircle2 size={12} aria-hidden="true" />{' '}
                {t('common.auth.sent.reset')}
              </p>
            )}

            {outcome?.kind === 'failed' && (
              <p className="ht-settings__danger" data-testid="password-failed">
                <AlertTriangle size={12} aria-hidden="true" /> {t(outcome.key, outcome.vars)}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
