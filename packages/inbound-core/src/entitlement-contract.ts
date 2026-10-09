/**
 * 自动收集权益的**线契约**：签发侧（官方实例）与消费侧（客户实例的宿主）共用这一份。
 *
 * 放进 `@heyta/inbound-core` 而不是各端各写，是因为动作词表与作用域档一旦漂移，
 * 症状是"客户端以为自己有权、服务端判无权"这种两边都自洽的错 —— 本仓库已经有过
 * 同一个判断写三遍的代价。
 */

/** 封闭词表。`session` 是唯一能建立/续期绑定的动作，不走逐次放行的取票通道。 */
export const AUTOMATION_ENTITLEMENT_ACTIONS = [
  'session',
  'rule-enable',
  'sender-credential-issue',
  'worker-register',
  'event-claim',
  'ai-reserve',
  'result-publish',
  'commit-permit',
  'draft-confirm',
] as const;

export type AutomationEntitlementAction = (typeof AUTOMATION_ENTITLEMENT_ACTIONS)[number];

export type AutomationEntitlementScope = 'none' | 'rule' | 'event';

/** 每个动作要求的作用域：票据 claims 与实际操作必须逐字一致。 */
export const AUTOMATION_ENTITLEMENT_SCOPES: Record<AutomationEntitlementAction, AutomationEntitlementScope> = {
  session: 'none',
  'rule-enable': 'rule',
  'sender-credential-issue': 'rule',
  'worker-register': 'none',
  'event-claim': 'none',
  'ai-reserve': 'event',
  'result-publish': 'event',
  'commit-permit': 'event',
  'draft-confirm': 'event',
};

export type AutomationActionTicketAction = Exclude<AutomationEntitlementAction, 'session'>;

/** 逐次放行的动作才从这条通道取票；把 `session` 混进来等于一次登录换到一张通用通行证。 */
export const AUTOMATION_ACTION_TICKET_ACTIONS: readonly AutomationActionTicketAction[] =
  AUTOMATION_ENTITLEMENT_ACTIONS.filter((action): action is AutomationActionTicketAction => action !== 'session');

export const AUTOMATION_ENTITLEMENT_TICKET_HEADER = 'x-heyta-entitlement-ticket';

/** 签发侧对票据寿命的硬上限；收到更长的寿命就当坏响应，不照单收下。 */
export const AUTOMATION_ENTITLEMENT_MAX_TICKET_LIFETIME_MS = 30_000;

/**
 * 签发与绑定握手对外的拒绝码。宿主按它决定"停止重试并显示等待权益"还是"这是缺陷"，
 * 所以**码的字面量只有一份**：签发侧（`server/src/automation/entitlement-issuer.ts`）与
 * 这里的等待族判据共用，两端各抄一遍的话，漂移的症状是宿主把该停的重试当成可重试。
 */
export const AUTOMATION_ISSUER_DENIALS = {
  ISSUER_NOT_CONFIGURED: 'AUTOMATION_ISSUER_NOT_CONFIGURED',
  NOT_ON_THIS_INSTANCE: 'AUTOMATION_ISSUER_NOT_ON_THIS_INSTANCE',
  ACTIVATION_INVALID: 'AUTOMATION_ACTIVATION_INVALID',
  ACTIVATION_RATE_LIMITED: 'AUTOMATION_ACTIVATION_RATE_LIMITED',
  ACTIVATION_RESEND_EXHAUSTED: 'AUTOMATION_ACTIVATION_RESEND_EXHAUSTED',
  LINK_CONFLICT: 'AUTOMATION_LINK_CONFLICT',
  LINK_NOT_BOUND: 'AUTOMATION_LINK_NOT_BOUND',
  SUBJECT_MISMATCH: 'AUTOMATION_SUBJECT_MISMATCH',
  MANIFEST_INVALID: 'AUTOMATION_REVOCATION_MANIFEST_INVALID',
  REVOCATION_NOT_INCREASING: 'AUTOMATION_REVOCATION_NOT_INCREASING',
  ACTION_UNKNOWN: 'AUTOMATION_ISSUER_ACTION_UNKNOWN',
  SCOPE_MISMATCH: 'AUTOMATION_ISSUER_SCOPE_MISMATCH',
} as const;

export type AutomationIssuerDenial = (typeof AUTOMATION_ISSUER_DENIALS)[keyof typeof AUTOMATION_ISSUER_DENIALS];

/**
 * 拒绝码里"这台实例此刻还没有权益"那一族：宿主应当显示 `waiting-entitlement`
 * 而不是把用户引到一条报错上。其余拒绝码都是请求本身写错了，属于缺陷。
 */
export const AUTOMATION_ENTITLEMENT_WAITING_DENIALS = [
  AUTOMATION_ISSUER_DENIALS.LINK_NOT_BOUND,
  AUTOMATION_ISSUER_DENIALS.ISSUER_NOT_CONFIGURED,
  AUTOMATION_ISSUER_DENIALS.NOT_ON_THIS_INSTANCE,
] as const;

export function isAutomationEntitlementWaitingDenial(code: string): boolean {
  return (AUTOMATION_ENTITLEMENT_WAITING_DENIALS as readonly string[]).includes(code);
}

/**
 * 作用域与动作是否相符。相符返回 `undefined`，否则返回不符的那一格。
 *
 * 只判"带没带"，不判带的是不是**对的那条** rule/event —— 归属只有客户实例知道
 * （它的库是端到端加密的，签发侧看不到也不该看）。
 */
export function automationEntitlementScopeMismatch(
  action: AutomationEntitlementAction,
  ruleId: string | undefined,
  eventId: string | undefined,
): 'RULE_SCOPE_MISSING' | 'EVENT_SCOPE_MISSING' | 'SCOPE_NOT_ALLOWED' | undefined {
  const scope = AUTOMATION_ENTITLEMENT_SCOPES[action];
  if (scope === 'rule') return ruleId !== undefined && eventId === undefined ? undefined : 'RULE_SCOPE_MISSING';
  if (scope === 'event') return eventId !== undefined && ruleId === undefined ? undefined : 'EVENT_SCOPE_MISSING';
  return ruleId === undefined && eventId === undefined ? undefined : 'SCOPE_NOT_ALLOWED';
}
