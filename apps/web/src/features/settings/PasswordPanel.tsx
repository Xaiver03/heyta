/**
 * 设置页的「登录密码」：两张表 —— **改**一个密码，或给账号**加**第一个密码（W6f / W7f）
 * ================================================================================
 *
 * 服务端（`/api/password/change` 与 `/api/password/set`）、协议端口
 * （`@heyta/app-host` 的 `changePassword` / `setInitialPassword`）、状态机
 * （`useAuthStore.changePassword` / `setPassword`）**早就都在**，缺的只有这个面板 ——
 * 也就是说在补上它之前，`changePassword` 这条动作**在整个仓库里没有一个调用点**，
 * 用户改不了自己的登录密码，而词条里已经写着"正在修改密码…"（`common.auth.busy.change`）。
 *
 * ## 为什么是**两张**表而不是一个智能表单
 *
 * 界面**不知道**这个账号有没有口令，而且**不许猜**：服务端在反枚举上的立场是
 * "响应不随账号状态变化"，而这里唯一可靠的判据是一次真实请求给出的 `code`。
 * 所以本面板的形状是：
 *
 *   · 默认摆**改密**那张（多数账号）；
 *   · 服务端回 `no_password_set` ⇒ 当场换到**设密**那张（不是红字 + 两个空框）；
 *   · 反过来在设密那张回 `password_already_set` ⇒ 换回改密；
 *   · 两条都留一个**主动**切换的入口（`switchToSet` / `switchToChange`）——
 *     "我刚注册时用的是通行密钥"这件事只有用户自己知道，让界面等他撞墙才知道，
 *     是 NNG 反对的那类"用错误信息当导航"。
 *
 * ## 分层（AGENTS.md §3.5）
 *
 * 这里**没有一行协议知识**，也没有"这个密码合不合格"的判断：
 *   - 端点、令牌怎么带、失败归类 → `@heyta/app-host` 的 `hosted-auth.ts`；
 *   - 长度上下限、常见口令、泄露库 → **服务端**（`password/policy.ts` 是唯一口径），
 *     这里**不做本地强度校验**，只做"没填不许发"；
 *   - 那个长度数字 → `@heyta/shared-schema` 的 `AUTH_PASSWORD_MIN_CODE_POINTS`，
 *     界面只念出来，**不自己写 8**；
 *   - 状态机 → `../auth/store.js`。**不另建一份 store**：改密成功后要换上那枚
 *     刚被 `tokenVersion++` 作废的旧令牌，那份接线只有一份（`applyAuthSession`）。
 * 本文件只做两件事：**渲染**和**收集输入**。
 *
 * ## 🔴 五条必须说清楚的地方
 *
 *   1. **每一次都划清两个秘密的界线。** 两张表的 lead 都点名"登录密码"，并明说加密口令
 *      不在这里（ADR-0040 §3.2 D1）。一句光秃秃的"密码已修改"会让人以为数据也跟着
 *      换了钥匙 —— 或者反过来，以为忘了加密口令能在这儿找回。
 *   2. **按钮不禁用**（ADR-0040 §3.7：禁用态让人困惑，提交后禁用还会甩掉焦点）。
 *      忙的时候再点是空操作，guard 在各 `submit` 的第一行。
 *   3. **后果要在点之前就写出来**，不是成功之后才通知。两张表那句是**相反**的：
 *      改密 ⇒ "其它设备都要重新登录"；设密 ⇒ "不会把任何地方踢下线"。
 *      （`store.ts` 把 `password-changed` 与 `password-set` 分成两个 kind，
 *      就是为了这里不必对一半人说错话。）
 *      ⚠️ 忙态那一句也跟着表走：`common.auth.busy.change` 字面带着
 *      "（其余设备需要重新认证）"，把它摆在设密那张按钮上，就和它正下方那句
 *      "不会把任何地方踢下线"当场打脸 —— 所以设密用的是 `…setBusy`。
 *   4. **失败时不清空输入，焦点落到该改的那个框。** `invalid-credentials` 要改的是
 *      **当前密码**，`password-policy` 要改的是**新密码** —— 焦点丢在错的那个框里，
 *      用户会重打一遍根本没错的东西。其余原因（网络 / 过载 / 锁定）两个框都没错，
 *      **不动焦点**。
 *   5. **设密那一屏不给"忘记密码"。** `requestPasswordReset` 对没有口令认证器的账号
 *      **刻意不发信**（反枚举，`recovery.ts:117`），明知是死路还摆一个按钮，
 *      就是界面在骗人。
 *
 * ## 为什么改密那张表没有"再输一次新密码"
 *
 * 这张表已经要求**当前密码** —— 那是"你是本人"的证明，比一个防手抖的确认框强得多，
 * 而显隐开关就在旁边，看一眼就能核对。⚠️ 服务端渲染的那张 `/reset-password` 页**有**
 * 确认框：那里没有当前密码可验。两个形状各自服务不同的证明责任，不是漂移。
 */

import { useRef, useState } from 'react';

import { useI18n, type MessageKey, type MessageVars } from '@heyta/i18n';
import { AUTH_PASSWORD_MIN_CODE_POINTS } from '@heyta/shared-schema';
import {
  authFailureMessage,
  defaultPasswordRevealed,
  passwordAutocomplete,
} from '@heyta/ui';
import { ICON_SIZE } from '@heyta/design-system';
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Loader2 } from 'lucide-react';

import { useAuthStore, type AuthStatus } from '../auth/store.js';
import { useSyncStore } from '../sync/store.js';
import { SettingsAccountGate } from './SettingsAccountGate.js';

/**
 * 本面板自己那一段结果。
 *
 * 🔴 `field` 是**可选**的：不是每条失败都对应一个框（网络 / 过载 / 锁定两个框都没错），
 * 而"忘了把 field 填上"在类型上必须是合法的 —— 所以这里不能把它写成必填再到处塞占位值。
 */
type Outcome =
  | {
      readonly kind: 'failed';
      readonly key: MessageKey;
      readonly vars?: MessageVars;
      readonly field?: PanelField;
    }
  | { readonly kind: 'changed' }
  | { readonly kind: 'set' }
  | { readonly kind: 'reset-sent' };

/** 出错该落到哪个框（焦点与 `aria-invalid` 用同一个词表）。 */
type PanelField = 'current' | 'new';

/** 当前摆的是哪张表。见文件头"为什么是两张表"。 */
type Mode = 'change' | 'set';

/**
 * 全局 `failed` → 面板要渲染的那句话，加上该标红的框。
 *
 * 三个动作（改密 / 设密 / 发重置信）**共用这一份映射** —— 在面板里各写一遍
 * `reason → key` 就是 ADR-0040 §3.7 反对的那个形状。
 *
 * 🔴 句子**和它要带的数字**都来自 `@heyta/ui` 的 `authFailureMessage`（一份，与登录
 * 面板共用）：`password-policy` 那四种拒绝（太短 / 太长 / 太常见 / 出现在泄露库）用户
 * 要做的事各不相同，而不带数字的"口令不合格"等于什么也没说。
 *
 * ⚠️ `no-password-set` / `password-already-set` **不经过这里** —— 它们不是"一句错误"，
 * 而是"这张表摆错了"，调用处直接换表（换表之后由新表自己的 lead 说话）。
 *
 * `mode` 是**必填**参数，不是装饰：同一句 `email-not-verified` 在改密那张表上说的是
 * "密码是对的，只差最后一步"（真话 —— 那一次确实验过密码），在设密那张表上就是假话
 * （这一次没有任何密码被验过）。所以设密模式在进共享映射**之前**先把这句换掉。
 */
function failureOutcome(
  status: Extract<AuthStatus, { kind: 'failed' }>,
  mode: Mode,
): Extract<Outcome, { kind: 'failed' }> {
  const isPolicy = status.reason === 'password-policy' && status.policyCode !== undefined;
  const message: { key: MessageKey; vars?: MessageVars } =
    mode === 'set' && status.reason === 'email-not-verified'
      ? { key: 'web.settings.password.setNeedsVerified' }
      : authFailureMessage(status);
  // 要改哪个框：策略类与新口令本身有关；`invalid-credentials` 在**改密这张表**上指的是
  // 当前密码打错了（不是"你没登录"）。其余原因两个框都没错，**不动焦点**。
  const field: PanelField | undefined = isPolicy
    ? 'new'
    : mode === 'change' && status.reason === 'invalid-credentials'
      ? 'current'
      : undefined;
  return {
    kind: 'failed',
    key: message.key,
    ...(message.vars !== undefined ? { vars: message.vars } : {}),
    ...(field !== undefined ? { field } : {}),
  };
}

/**
 * 忙是从**共用的**那台认证状态机读的，所以必须按 action 收窄。
 *
 * 🔴 不加 `action === 'password-change'` 的话，一次**登录**失败会在设置页里
 * 渲染成"正在修改密码…"或者别的错位的句子。
 */
function useBusy(action: 'password-change' | 'password-set' | 'password-forgot'): boolean {
  return useAuthStore((s) => s.status.kind === 'busy' && s.status.action === action);
}

/**
 * 一个口令框 + 它的显隐开关。三处用（当前密码 / 新密码 / 设密那一个框）。
 *
 * 抽出来是因为这三段**逐字相同**（只有 label / ref / autoComplete 不同）——
 * 而"给口令框加 maxLength"这种错法（NIST 明令禁止静默截断）恰好只会加在其中一处。
 * 三处共用一份 DOM，就只可能犯一次。
 *
 * ⚠️ 显隐状态**在**这个组件里，所以三个框各自独立：改密那张表上"当前密码"展开
 * 不会把"新密码"一起展开。默认档由 `@heyta/ui` 给（ADR-0040 §3.7）—— web 壳是
 * 桌面 ⇒ 默认遮住，而两档都保留开关（默认值不是能力）。
 */
function PasswordField(props: {
  id: string;
  testId: string;
  revealTestId: string;
  label: string;
  autoComplete: 'current-password' | 'new-password';
  invalid: boolean;
  value: string;
  onChange: (next: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}): React.JSX.Element {
  const { t } = useI18n();
  const [revealed, setRevealed] = useState(defaultPasswordRevealed('desktop'));
  return (
    <div className="ht-settings__field">
      <label className="ht-settings__item-label" htmlFor={props.id}>
        {props.label}
      </label>
      <div className="ht-settings__actions">
        <input
          ref={props.inputRef}
          id={props.id}
          className="ht-input"
          type={revealed ? 'text' : 'password'}
          // 🔴 **不写 maxLength**：NIST 禁止静默截断口令输入，超长交给服务端按码点判。
          data-testid={props.testId}
          value={props.value}
          // 失败后不清空（ADR-0040 §3.7）：除了成功那一条，没有任何路径重置它。
          onChange={(e) => {
            props.onChange(e.target.value);
          }}
          autoComplete={props.autoComplete}
          aria-invalid={props.invalid}
        />
        <button
          type="button"
          className="ht-btn ht-btn--ghost"
          data-testid={props.revealTestId}
          aria-pressed={revealed}
          onClick={() => {
            setRevealed((v) => !v);
          }}
        >
          {revealed ? (
            <EyeOff size={ICON_SIZE.xs} aria-hidden="true" />
          ) : (
            <Eye size={ICON_SIZE.xs} aria-hidden="true" />
          )}{' '}
          {/*
            标签**固定**说"显示密码"，状态交给 `aria-pressed`（扁平开关的写法）：
            一个跟着状态改字的按钮（"显示"↔"隐藏"）配上 pressed 会让读屏念出
            "隐藏密码，已按下"这种自相矛盾的话。
          */}
          {t('common.auth.form.showPassword')}
        </button>
      </div>
    </div>
  );
}

export function PasswordPanel(): React.JSX.Element {
  const { t } = useI18n();

  const baseUrl = useSyncStore((s) => s.baseUrl);
  const token = useSyncStore((s) => s.token);
  const email = useSyncStore((s) => s.email);

  const busyChange = useBusy('password-change');
  const busySet = useBusy('password-set');
  const busyForgot = useBusy('password-forgot');

  const [mode, setMode] = useState<Mode>('change');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [setDraft, setSetDraft] = useState('');
  /** 本地校验（只有"没填"这一种）落在哪个框。 */
  const [localError, setLocalError] = useState<PanelField | undefined>(undefined);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const currentRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLInputElement>(null);
  const setRef = useRef<HTMLInputElement>(null);

  const signedIn = typeof token === 'string' && token !== '';

  const invalidField = localError ?? (outcome?.kind === 'failed' ? outcome.field : undefined);

  /** 焦点落到该改的那个框。设密那张只有一个框，它占用词表里的 `'new'`。 */
  const focusField = (field: PanelField | undefined): void => {
    if (field === undefined) return;
    (field === 'current' ? currentRef : mode === 'set' ? setRef : nextRef).current?.focus();
  };

  /**
   * 换表。
   *
   * 🔴 必须把**草稿与结果一起清掉**：留着"当前密码"那一格的内容换到设密表，
   * 用户看到的是一句他刚刚打过的口令被摆在"新密码"的位置上 —— 那是把旧秘密
   * 写进新秘密的框里（而设密成功之后那句恰恰就变成"当前密码"了）。反向同理。
   */
  const switchMode = (to: Mode): void => {
    setMode(to);
    setCurrent('');
    setNext('');
    setSetDraft('');
    setLocalError(undefined);
    setOutcome(null);
  };

  const submitChange = async (): Promise<void> => {
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
      // 服务端说"这个账号没有口令" ⇒ 这不是一个错误落点，而是**摆错了表**。
      // 换表比在改密表下面留一句"这里没有可改的密码"有用：换过去他才有一个出口。
      if (status.reason === 'no-password-set') {
        switchMode('set');
        return;
      }
      const result = failureOutcome(status, 'change');
      focusField(result.field);
      setOutcome(result);
      return;
    }
    // 到不了这里：这条动作只会落 `password-changed` 或 `failed`。
    // 不写 `else throw` —— 但**也不静默留一条旧结果**，所以显式清空。
    setOutcome(null);
  };

  const submitSet = async (): Promise<void> => {
    // 同样是 guard 而不是 disabled。
    if (busySet) return;
    if (setDraft === '') {
      setLocalError('new');
      setRef.current?.focus();
      return;
    }
    setLocalError(undefined);
    setOutcome(null);
    await useAuthStore.getState().setPassword(baseUrl, token, setDraft);
    const status = useAuthStore.getState().status;
    if (status.kind === 'password-set') {
      // 草稿必须清掉：这句口令此刻已经是**当前**口令，留在框里就是一句
      // 看起来还能再提交的旧输入。
      setSetDraft('');
      setOutcome({ kind: 'set' });
      return;
    }
    if (status.kind === 'failed') {
      if (status.reason === 'password-already-set') {
        // 反面同形：这个账号**已经有**口令 ⇒ 该走的是改密那张表。
        switchMode('change');
        return;
      }
      const result = failureOutcome(status, 'set');
      focusField(result.field);
      setOutcome(result);
      return;
    }
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
          ? failureOutcome(status, mode)
          : null,
    );
  };

  return (
    <div className="ht-settings" data-testid="password-panel">
      <h2 className="ht-settings__title ht-type-section-title">{t('web.settings.password.title')}</h2>
      {/* 🔴 两张表的 lead 不是同一句：改密是"这里改的只是…"，设密是"多一条路"。 */}
      <p className="ht-settings__hint">
        {mode === 'change' ? t('web.settings.password.lead') : t('web.settings.password.setLead')}
      </p>

      {!signedIn ? (
        <SettingsAccountGate
          messageKey="web.settings.password.needsSignIn"
          testId="password-needs-sign-in"
        />
      ) : mode === 'set' ? (
        /*
          「设第一个密码」那张表：一个框、没有"当前密码"（这个账号从来没有过），
          也**不给**"忘记密码" —— 那条路对没有口令认证器的账号刻意不发信。
        */
        <div className="ht-settings__section">
          <PasswordField
            id="ht-password-set"
            testId="password-set-field"
            revealTestId="password-reveal-set"
            label={t('web.settings.password.setField')}
            autoComplete={passwordAutocomplete('register')}
            invalid={invalidField === 'new'}
            value={setDraft}
            onChange={(v) => {
              setSetDraft(v);
              if (localError === 'new') setLocalError(undefined);
            }}
            inputRef={setRef}
          />
          <p className="ht-settings__hint" data-testid="password-set-hint">
            {t('web.settings.password.minLength', { min: AUTH_PASSWORD_MIN_CODE_POINTS })}{' '}
            {t('common.auth.form.passwordHint')}
          </p>

          <div className="ht-settings__actions">
            <button
              type="button"
              className="ht-btn ht-btn--primary"
              data-testid="password-set-submit"
              // 同样没有 `disabled`：忙时点击是 `submitSet` 第一行的 guard。
              onClick={() => {
                void submitSet();
              }}
            >
              {busySet ? (
                <Loader2 size={ICON_SIZE.xs} aria-hidden="true" />
              ) : (
                <CheckCircle2 size={ICON_SIZE.xs} aria-hidden="true" />
              )}{' '}
              {busySet ? t('web.settings.password.setBusy') : t('web.settings.password.setSubmit')}
            </button>

            {/* 回改密那张表。这句是**提问**不是断言（"已经设过了？"）——
                界面不知道，知道的人是用户。 */}
            <button
              type="button"
              className="ht-btn ht-btn--ghost"
              data-testid="password-switch-to-change"
              onClick={() => {
                switchMode('change');
              }}
            >
              {t('web.settings.password.switchToChange')}
            </button>
          </div>

          {/*
            🔴 这句与改密那张的 `otherDevices` 是**相反**的后果，且必须在点之前看得见：
            加一个认证器不把任何人踢下线（这条不 bump `tokenVersion`）。
          */}
          <p className="ht-settings__hint" data-testid="password-set-consequence">
            {t('web.settings.password.setConsequence')}
          </p>

          <div aria-live="polite" data-testid="password-set-live">
            {localError !== undefined && (
              <p className="ht-settings__danger" data-testid="password-set-local-error">
                <AlertTriangle size={ICON_SIZE.xs} aria-hidden="true" />{' '}
                {t('common.auth.form.passwordRequired')}
              </p>
            )}

            {outcome?.kind === 'set' && (
              <p className="ht-settings__notice" data-testid="password-set-done">
                <CheckCircle2 size={ICON_SIZE.xs} aria-hidden="true" />{' '}
                {t('web.settings.password.setDone')}
              </p>
            )}

            {outcome?.kind === 'failed' && (
              <p className="ht-settings__danger" data-testid="password-set-failed">
                <AlertTriangle size={ICON_SIZE.xs} aria-hidden="true" />{' '}
                {t(outcome.key, outcome.vars)}
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="ht-settings__section">
          <PasswordField
            id="ht-password-current"
            testId="password-current"
            revealTestId="password-reveal-current"
            label={t('web.settings.password.current')}
            autoComplete={passwordAutocomplete('sign-in')}
            invalid={invalidField === 'current'}
            value={current}
            onChange={(v) => {
              setCurrent(v);
              if (localError === 'current') setLocalError(undefined);
            }}
            inputRef={currentRef}
          />

          <PasswordField
            id="ht-password-new"
            testId="password-new"
            revealTestId="password-reveal-new"
            label={t('web.settings.password.new')}
            autoComplete={passwordAutocomplete('register')}
            invalid={invalidField === 'new'}
            value={next}
            onChange={(v) => {
              setNext(v);
              if (localError === 'new') setLocalError(undefined);
            }}
            inputRef={nextRef}
          />
          <p className="ht-settings__hint" data-testid="password-hint">
            {t('web.settings.password.minLength', { min: AUTH_PASSWORD_MIN_CODE_POINTS })}{' '}
            {t('common.auth.form.passwordHint')}
          </p>

          <div className="ht-settings__actions">
            <button
              type="button"
              className="ht-btn ht-btn--primary"
              data-testid="password-submit"
              // 🔴 没有 `disabled`：忙的时候点它是空操作（`submitChange` 第一行的 guard）。
              onClick={() => {
                void submitChange();
              }}
            >
              {busyChange ? (
                <Loader2 size={ICON_SIZE.xs} aria-hidden="true" />
              ) : (
                <CheckCircle2 size={ICON_SIZE.xs} aria-hidden="true" />
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
                  <Loader2 size={ICON_SIZE.xs} aria-hidden="true" />
                ) : (
                  <AlertTriangle size={ICON_SIZE.xs} aria-hidden="true" />
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
            🔴 这句在**点之前**就得看得见：
            "其余设备全部要重新登录"是改密的后果，不是失败信息。
          */}
          <p className="ht-settings__hint" data-testid="password-consequence">
            {t('web.settings.password.otherDevices')}
          </p>

          {/*
            「从来没设过？」是**主动**出口：不必先撞一次墙才找得到另一张表。
            放在后果句之后而不是表单顶部 —— 多数账号要的是改密，把设密那张表
            摆在最前面会把多数人带错（它的前提是"你没设过密码"）。
          */}
          <button
            type="button"
            className="ht-btn ht-btn--ghost"
            data-testid="password-switch-to-set"
            onClick={() => {
              switchMode('set');
            }}
          >
            {t('web.settings.password.switchToSet')}
          </button>

          {/*
            `aria-live`：错误与成功都必须是**文字**（WCAG SC 3.3.1）且要播报。
            这块平时是空的 —— 挂着合法（没有节点可读）。
          */}
          <div aria-live="polite" data-testid="password-live">
            {localError !== undefined && (
              <p className="ht-settings__danger" data-testid="password-local-error">
                <AlertTriangle size={ICON_SIZE.xs} aria-hidden="true" />{' '}
                {t('common.auth.form.passwordRequired')}
              </p>
            )}

            {outcome?.kind === 'changed' && (
              <p className="ht-settings__notice" data-testid="password-changed">
                <CheckCircle2 size={ICON_SIZE.xs} aria-hidden="true" />{' '}
                {t('web.settings.password.changed')}
              </p>
            )}

            {outcome?.kind === 'reset-sent' && (
              <p className="ht-settings__notice" data-testid="password-reset-sent">
                <CheckCircle2 size={ICON_SIZE.xs} aria-hidden="true" />{' '}
                {t('common.auth.sent.reset')}
              </p>
            )}

            {outcome?.kind === 'failed' && (
              <p className="ht-settings__danger" data-testid="password-failed">
                <AlertTriangle size={ICON_SIZE.xs} aria-hidden="true" />{' '}
                {t(outcome.key, outcome.vars)}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
