/**
 * 活动与邀请（福利中心）
 * ======================
 *
 * 这一层是**纯逻辑**：怎么归一化一张邀请码、一张码在什么情况下可以绑定、
 * 奖励几天、活动目录长什么样。它不碰数据库、不认识 Fastify、也不认识 React ——
 * 服务端（结算）与客户端（输入框预校验、活动列表渲染）消费的是**同一份**规则。
 *
 * ## 🔴 奖励天数与"激活"的定义（产品决定，不是调参）
 *
 * - **奖励 5 天 `hosting`**（`INVITE_REWARD_DAYS`）。
 *   为什么是"5 天"而不是"1 个月"：这是一次**凭空多出来的会员**，
 *   没有对应的收入。5 天足够让被邀请人和邀请人都真的用上一次，
 *   而它对收入的敞口是可算的（一次邀请 ≈ ¥0.83 的托管成本）。
 * - **"激活" = 被邀请人完成邮箱验证**，不是"注册"。
 *   注册那一刻我们什么都不知道（邮箱可能是编的），而验证是**只有邮箱主人本人**
 *   才能做的动作（要拿到那封信里的链接）。把发奖挂在这一步，
 *   是"怎样才能不被刷"这个问题唯一便宜的答案。
 *
 * ## 🔴 为什么要有上限，以及上限为什么放在"绑定"而不是"发奖"
 *
 * 邀请奖励是**铸币**：每成功一次就凭空多出 5 天。没有上限的话，
 * 一个愿意开小号的人可以不花一分钱把会员续到无限远。
 *
 * 上限口径是"**30 天内已绑定的邀请数**"，且在**绑定那一刻**判定：
 *
 * | 放在哪 | 后果 |
 * |---|---|
 * | 绑定处（本模块） | 超限时**根本不建这条邀请**，于是"建了的邀请一定会发奖"是恒真的 |
 * | 发奖处 | 会造出"已激活但没发奖"的行 —— 界面上成功邀请 +1、会员一天没涨 |
 *
 * 后者的两个数字分别在两张表里，对不上时没有任何东西会报错。所以上限前移。
 * 代价是**未验证的挂起邀请也占额度** —— 这是可接受的：额度是 20，而诚实用户
 * 不会有 20 个拖着不验证的邀请。
 *
 * ## 这一层刻意**不做**的事
 *
 * - **不认识中文**。活动标题/正文的措辞在 `packages/i18n`（界面文案唯一事实源），
 *   这里只给**语义 id**（`invite-friends`），由 UI 映射到词条。
 *   见 AGENTS.md §5 第 2 条：语义名，不用外观名。
 * - **不判断码"存在不存在"**。那是数据库的事；这里只回答"这个形状对不对"
 *   （`isInviteCodeShape`），好让输入框在**按下按钮之前**就能说"这个码不对"。
 */

/**
 * 邀请码字母表：**刻意剔除了易混字符**。
 *
 * 去掉 `0/O`、`1/I/L` —— 这个码是要被人**手抄、口述、贴进群聊**的，
 * 而"用户把 `O` 打成 `0`"造成的失败与"码真的失效了"在界面上长得一模一样。
 * 剔掉之后这类歧义在**输入阶段**就不存在了，不需要靠客服去猜。
 */
export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** 邀请码长度。8 位 × 31 字母表 ≈ 8.5e11 种，撞码不是现实风险。 */
export const INVITE_CODE_LENGTH = 8;

/**
 * 奖励天数。见文件头：**产品决定，不是调参**。
 *
 * ⚠️ 它与 `SUBSCRIPTION_PERIOD_DAYS`（30）是两回事：那个是"一次付款买多久"，
 * 这个是"一次邀请送多久"。改这里不会影响收银台。
 */
export const INVITE_REWARD_DAYS = 5;

/** 上限的统计窗口（天）。用滚动窗口而不是自然月：自然月有"月底冲量"的怪形状。 */
export const INVITE_CAP_WINDOW_DAYS = 30;

/**
 * 窗口内最多能**绑定**多少条邀请。
 *
 * 20 是刻意宽松的：诚实用户邀请不到 20 个人，而刷子会被它挡住 ——
 * 上限的目的不是精算风险，是让"无限续期"这条路不存在。
 */
export const INVITE_CAP_PER_WINDOW = 20;

/**
 * 邀请链接上的查询参数名。
 *
 * ⚠️ 客户端**必须**用它来读 URL（不要各写一份字面量）：拼错一次的结果是
 * "链接能打开，但邀请码没带上"，而那看起来像一个静默的、没有错误的现象。
 */
export const INVITE_QUERY_PARAM = 'invite';

/**
 * 归一化用户输入的邀请码。
 *
 * 🔴 **这是唯一做归一化的地方。** 数据库里 `invite_codes.code` 有一条
 * CHECK 钉住"存进去的必须已经是本函数的产出形状"（大写、无空白），
 * 所以这里的规则与那条约束是**同一个约定**的两端，改一边必须改另一边。
 *
 * 规则：
 * 1. 丢掉所有非字母数字字符 —— 用户会粘进 `ABC-123`、`ABC 123`、
 *    甚至带零宽空格的整段文本，而他们并没有做错什么；
 * 2. 转大写 —— 码的字母表只有大写。
 *
 * 刻意**不**在这里做"把 `O` 纠正成 `0`"之类的容错：字母表里两者都不存在，
 * 猜一个只会把"输错了"变成一个更晚、更难查的失败。
 */
export const normalizeInviteCode = (raw: string): string =>
  raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

/**
 * 归一化之后是不是一个**可能存在**的码的形状。
 *
 * 用在输入框：形状不对就当场说"这个码不对"，不必去服务端问一趟。
 * ⚠️ 它**不是**"这个码有效"——有效只有服务端能回答（码在库里）。
 * 返回 `true` 只说明"值得拿去问一次"。
 */
export const isInviteCodeShape = (normalized: string): boolean =>
  normalized.length === INVITE_CODE_LENGTH &&
  [...normalized].every((ch) => INVITE_CODE_ALPHABET.includes(ch));

/** 码的形状不对时的提示分类。UI 用它选措辞（长短两类）。 */
export type InviteCodeShapeProblem = 'empty' | 'length' | 'characters';

/** 把形状判定细化到**为什么**，好让提示说的是真话（"少一位"≠"有非法字符"）。 */
export const inspectInviteCodeShape = (
  normalized: string,
): InviteCodeShapeProblem | null => {
  if (normalized.length === 0) return 'empty';
  if (normalized.length !== INVITE_CODE_LENGTH) return 'length';
  if (![...normalized].every((ch) => INVITE_CODE_ALPHABET.includes(ch))) {
    return 'characters';
  }
  return null;
};

/** 一条邀请为什么没被绑定。 */
export type InviteAttachRejection =
  /** 用自己发的码。见迁移里的 `referrals_no_self_invite`（防铸币）。 */
  | 'SELF_INVITE'
  /** 码被运营停用了。 */
  | 'CODE_DISABLED'
  /** 这个被邀请人已经算在另一条邀请上了（`invitee_user_id` 唯一）。 */
  | 'INVITEE_ALREADY_REFERRED'
  /** 邀请人在窗口内已经绑定到上限。 */
  | 'CAP_REACHED';

export type InviteAttachDecision =
  | { readonly attached: true }
  | { readonly attached: false; readonly reason: InviteAttachRejection };

export interface InviteAttachInput {
  /** 码的归属人。 */
  readonly inviterUserId: number;
  /** 正在注册的人。 */
  readonly inviteeUserId: number;
  /** 这张码是否被停用。 */
  readonly codeDisabled: boolean;
  /** 库里是否已经有 `invitee_user_id = inviteeUserId` 的一行。 */
  readonly inviteeAlreadyReferred: boolean;
  /** 邀请人在窗口内**已绑定**的邀请数（含未激活的）。 */
  readonly invitesInWindow: number;
  /** 上限，默认 `INVITE_CAP_PER_WINDOW`（可注入以便测试边界）。 */
  readonly cap?: number;
}

/**
 * 要不要把这张码绑定到这个新账号上。
 *
 * 🔴 **判定顺序是有意义的**：先排"自己邀请自己"，再排"码被停用"，
 * 最后才是上限。因为如果一个用户拿自己的码去绑定，正确的说法是
 * "不能邀请自己"，而不是"额度用完了"—— 后者会让一个从没邀请过人的用户
 * 收到一句关于额度的假话。
 *
 * ⚠️ 这个函数**只决定绑不绑**，不决定"要不要告诉用户"。
 * 注册路径必须对外保持中性（反枚举），所以拒绝**不会**让注册失败。
 */
export const decideInviteAttach = (input: InviteAttachInput): InviteAttachDecision => {
  const cap = input.cap ?? INVITE_CAP_PER_WINDOW;

  if (input.inviterUserId === input.inviteeUserId) {
    return { attached: false, reason: 'SELF_INVITE' };
  }
  if (input.codeDisabled) {
    return { attached: false, reason: 'CODE_DISABLED' };
  }
  if (input.inviteeAlreadyReferred) {
    return { attached: false, reason: 'INVITEE_ALREADY_REFERRED' };
  }
  // `>=`：cap = 20 表示"最多 20 条"，已绑定 20 条时第 21 条要被拒。
  if (input.invitesInWindow >= cap) {
    return { attached: false, reason: 'CAP_REACHED' };
  }
  return { attached: true };
};

/** 活动 id。语义名 —— UI 用它映射到词条，见文件头。 */
export const CAMPAIGN_IDS = ['invite-friends'] as const;

export type CampaignId = (typeof CAMPAIGN_IDS)[number];

/** 活动的"怎么参与"类型。目前只有一种，但列表结构不为此收窄。 */
export type CampaignKind = 'invite';

export interface CampaignDefinition {
  readonly id: CampaignId;
  readonly kind: CampaignKind;
  /** 完成一次发放的奖励天数。与 `INVITE_REWARD_DAYS` 同源。 */
  readonly rewardDays: number;
}

/**
 * 活动目录：**静态配置，不是数据库表**。
 *
 * ## 为什么不建一张 `campaigns` 表
 *
 * 建表的意义是"运营不改代码就能上下线活动"。而 heyta **今天没有任何运营后台** ——
 * 一张没人能编辑的表只会让下一个人误以为"改这里就能上活动"，然后发现要手写 SQL。
 * 静态配置在此时是**更诚实**的形状：加一个活动 = 一次发版，而发版这件事
 * 本来就要走评审。
 *
 * ## 🔴 什么时候必须改成表
 *
 * 出现下列任一条，静态配置就开始说假话，那时应改为表 + 运营入口：
 * 1. 需要**限时限量**（"前 100 名"、"春节 7 天"）—— 那就有了运行时状态；
 * 2. 需要**下线一个已上线的活动**而不发版（尤其是奖励发错的时候）；
 * 3. 活动数 > 3，或需要 A/B 不同人群看到不同活动。
 */
export const CAMPAIGN_CATALOG: readonly CampaignDefinition[] = [
  { id: 'invite-friends', kind: 'invite', rewardDays: INVITE_REWARD_DAYS },
];

/** 按 id 取活动定义；未知 id 返回 `null`（不抛 —— 老客户端会遇到新 id）。 */
export const findCampaign = (id: string): CampaignDefinition | null =>
  CAMPAIGN_CATALOG.find((c) => c.id === id) ?? null;

/**
 * 通知事件词表。
 *
 * 🔴 客户端遇到**未知** `kind` 必须优雅跳过，不能渲染空卡片、也不能抛
 * —— 老客户端遇到服务端新加的事件是正常情况（这与 op-log 里
 * "未知实体应被优雅跳过"是同一条纪律）。
 */
export const NOTIFICATION_KINDS = ['referral-activated'] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const isNotificationKind = (value: unknown): value is NotificationKind =>
  typeof value === 'string' && (NOTIFICATION_KINDS as readonly string[]).includes(value);

/**
 * `referral-activated` 的载荷：谁用我的码激活了、给了我几天。
 *
 * ## 为什么只有这两个字段
 *
 * 服务端**看不到用户内容**（E2EE 硬约束），所以这张表里能装的只有账号级事实。
 * 而"账号级事实"里也刻意**不存被邀请人的邮箱全址**：
 * 邀请人要知道的是"某个人激活了"，不是一个可以用来反向联系/画像的地址。
 * `displayName` 是注册邮箱的用户名部分（`star@x.com` → `star`），
 * 在**写入通知时**取一次快照 —— 之后对方改邮箱不会改写这条历史。
 */
export interface ReferralActivatedPayload {
  /**
   * 被邀请人的展示名（邮箱用户名部分的快照）。
   *
   * 🔴 **可以是 `null`**：邮箱用户名部分拿不到时（账号用了别的登录方式）
   * 我们不编一个名字，而是把"没有名字"如实存下来，由**读取方**决定怎么兜底。
   * 兜底必须发生在渲染层 —— 那里才知道读者此刻用的是哪种语言；
   * 在这里写死一个中文串会让一条三年前的通知，在用户今天切成英文之后
   * 还夹着一个中文字段。
   */
  readonly displayName: string | null;
  /** 本次发放的天数。 */
  readonly days: number;
}

/**
 * 从邮箱取展示名；拿不到就返回 `null`（**不编一个名字**）。
 *
 * 见 `ReferralActivatedPayload.displayName`：兜底是渲染层的事。
 */
export const displayNameFromEmail = (email: string): string | null => {
  const at = email.indexOf('@');
  const local = (at === -1 ? email : email.slice(0, at)).trim();
  return local.length === 0 ? null : local;
};

/**
 * 校验一条**来自数据库 / 网络**的载荷。
 *
 * 🔴 这是数据边界，所以**不做类型信任**（AGENTS.md 的既有纪律）：
 * `Json` 列可以装任意 JSON，`payload.days` 完全可能是字符串或 `undefined`。
 * 拿一个 `unknown` 直接当 `ReferralActivatedPayload` 用，
 * 结果是文案里少一个数字 —— 而失败会出现在**渲染层**，
 * 排查方向会跑到措辞模板上去。
 *
 * 返回 `null` 表示"这条通知渲染不了"，调用方应**跳过它**（不是渲染半条）。
 */
export const parseReferralActivatedPayload = (
  payload: unknown,
): ReferralActivatedPayload | null => {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const displayName = record.displayName;
  const days = record.days;

  // `displayName` 允许**恰好是 `null`**（"读不出名字"），但不允许空串
  // —— 空串会在文案里渲染出「 成功激活」，而那看起来像界面 bug。
  const displayNameOk =
    displayName === null ||
    (typeof displayName === 'string' && displayName.trim().length > 0);
  if (!displayNameOk) return null;

  if (typeof days !== 'number' || !Number.isFinite(days) || days <= 0) return null;

  return { displayName: displayName as string | null, days };
};

/**
 * 通知的通用载荷校验入口：按 `kind` 分派。
 *
 * 未知 `kind` → `null`，调用方跳过。**已知 `kind` 但载荷坏了也 → `null`** ——
 * 两者都"渲染不了"，但在日志/测试里可以通过 `kind` 分开。
 */
export const parseNotificationPayload = (
  kind: unknown,
  payload: unknown,
): ReferralActivatedPayload | null => {
  if (kind === 'referral-activated') {
    return parseReferralActivatedPayload(payload);
  }
  return null;
};
