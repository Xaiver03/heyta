/**
 * 中文词条表 —— **整个仓库文案的唯一事实源**。
 *
 * 🔴 这个对象决定了 `MessageKey` 的类型，而 `en.ts` 被约束成
 * `Record<MessageKey, string>`。所以：
 *   - 在这里加一条词条 → `en.ts` **少一条就编译报错**；
 *   - 在 `en.ts` 里写一个这里没有的 key → 触发多余属性检查，也报错。
 * 换句话说，**漏翻译不是运行时兜底，是编译失败**。
 *
 * ⚠️ 因此这个对象**不要用 `...spread` 拼装**。展开会丢掉多余属性检查，
 * `en.ts` 里多出来的 key 就会静默通过。要拆文件的话，
 * 得改成显式的双向类型断言（见 tests/catalog.spec.ts 里的对账测试）。
 *
 * 命名规则：`<应用>.<区块>.<用途>`，全小写点分。
 *   landing.*  ← apps/landing
 *   web.*      ← apps/web
 *   mobile.*   ← apps/mobile
 *   common.*   ← 三端共用（品牌名、通用动作）
 *
 * 占位符用 `{name}`，由 translate() 替换。
 *
 * ⚠️ 落地页的条目全部挤在一个 `landing.*` 命名空间下，所以按**区块**而不是
 * 按文件分段（`landing.mock.*` 是"界面复现件"那一整组静态示例数据）。
 * `landing.feature.*` 与 `landing.quadrant.*` 是**跨区块复用**的：
 * 导航、能力卡、展厅、复现件的侧栏说的是同一个东西时，共用一条词条 ——
 * 各写一遍迟早在某处改了一个而漏了另一个。
 */
export const zhCN = {
  // ── 三端共用 ──────────────────────────────────────────────
  'mobile.tasks.feedback.dismiss': '知道了',
  'common.sync.signIn': '登录以同步',
  'common.sync.hosted.title': 'heyta 云同步',
  'common.sync.hosted.hint': '登录后，你的任务会在设备间自动同步。无需填写服务器地址。',
  'common.sync.advanced': '高级：自托管与手动连接',
  'common.sync.account.connected': '已登录',
  'common.brand': 'heyta',
  'common.a11y.toLightTheme': '切换到亮色主题',
  'common.a11y.toDarkTheme': '切换到暗色主题',
  'common.ai.generatedLabel': 'AI 生成合成内容',

  /**
   * 两份对外文本的**名字**（注册勾选框旁边那两条链接用它）。
   *
   * 🔴 为什么不复用 `site.footer.legal.*`：那两条是 `gen-site-copy.mjs` 从
   * `@heyta/legal` **投影**出来的站点词条，由 `check:legal-copy` 逐字钉住内容 ——
   * 应用去消费它们，等于让应用界面依赖一次站点构建的投影，而投影改动的原因
   * 与界面无关。名字这里是界面自己的事。
   */
  'common.legal.termsDoc': '《服务条款》',
  'common.legal.privacyDoc': '《隐私政策》',

  /**
   * 语言**自称**（endonym）：中英两表里**刻意是同一个词**。
   *
   * 语言切换器显示的是**目标语言自己的文字**，而不是把"英文"翻译成当前语言 ——
   * 看不懂当前语言的用户，恰恰是最需要找到这个入口的人；
   * 把入口的名字写成他看不懂的另一种文字，等于没给入口。
   *
   * 🔴 这是"中英两表取值相同"的**唯一**正当例外，所以门禁与对账测试
   * 各开了一个**按 key 的白名单**，而不是放宽整条规则 ——
   * 放宽会让"把中文复制过去当英文交差"也一起溜过去。
   */
  'common.lang.zh': '中文',
  'common.lang.en': 'English',

  // 同步失败的**已知原因**。两个壳共用同一句 —— 移动端 `status-text.ts` 的文件头
  // 记着这个项目吃过两次"同一个状态两处说法不同"的亏。
  // ⚠️ 意外异常（`reason === 'unexpected'`）不在这里：那种情况只有诊断文本有意义，
  // 两个壳各自处理（web 把它当参数插进 `web.sync.status.errorRetryable`）。
  'common.sync.error.notConfigured': '登录后即可开始同步',
  'common.sync.error.notSignedIn': '还没登录，无法同步',
  'common.sync.error.noPassword': '还没设置端到端加密口令，同步已停止 —— heyta 不会以明文上传',
  'common.sync.error.localOpMissing': '那条本地改动已经不在队列里了，请重新同步',
  'common.sync.error.remoteVersionUnavailable': '取不到对端版本，没法保留远端 —— 请选择保留本地',
  'common.sync.error.undecryptableOps': '有部分历史数据用当前口令解不开（可能是在另一个口令下写入的），已跳过 —— 其余数据已同步',
  'common.sync.error.undecryptablePage': '这一页数据全部用当前口令解不开，同步已暂停，没有跳过任何历史 —— 多半是端到端加密口令与服务器上的数据不匹配，请核对口令后重新同步',
  'common.sync.error.uploadRejected': '有改动被服务端拒绝了，它们不在云端 —— 已停止重传，请查看同步详情',
  /**
   * `reason === 'unauthorized'`：这枚访问令牌被服务端拒了（401/403）。
   *
   * 🔴 这句必须同时说清三件事，少一件都会把人引向错误的动作：
   * ① **为什么**（凭据失效，而不是"网不好"）；② **本地数据没事**
   * （否则用户第一反应是"我是不是丢数据了"，进而去删库重装）；
   * ③ **动作是重新登录**，不是重试同步。
   * ⚠️ 不许写成"账号已注销"或"登录过期，请重新登录"就完事 —— 前者是假话，
   * 后者漏掉②，而②是这台设备最容易被误操作的地方。
   */
  'common.sync.error.unauthorized': '这台设备的登录凭据已失效（可能是在别的设备上退出了登录，或改过口令），同步已停止 —— 本地数据完好、仍可读写，重新登录后会继续同步',
  /**
   * 🔴 `reason === 'account-closed'`：账号**注销**了（稳定码 `ACCOUNT_CLOSED`）。
   *
   * 这一句与上面那句 `unauthorized` 是**一对必须分开的防线**：两句对本机数据许的是
   * **相反**的承诺（完好 / 清除），合成一句就在两个方向上说谎 ——
   * 把"口令打错"读成"注销"会当场毁掉用户的数据，把"注销"读成"重新登录就好"
   * 会让明文永远留着。
   *
   * ⚠️ 措辞边界（ADR-0048）：这里说的是**规则**（注销后本机会清除这份副本），
   * 不是这一次的**结果** —— 清除失败时状态里的 `message` 与 console 会另行说明，
   * 这句不许替它承诺成功。其它设备与备份各有边界，那句话在隐私政策里。
   */
  'common.sync.error.accountClosed': '这个账号已经注销，无法再次登录，同步已停止 —— 注销后这台设备上的本地副本会被清除。如果这不是你的操作，请联系服务端运营者',
  /**
   * 🔴 `reason === 'consent-required'`：**还没同意，所以一个请求都没发**（计划 G-12）。
   *
   * 这句不许写成"还没配置同步服务"或"当前离线"：那两种的用户动作是"填地址"和"查网络"，
   * 而这里的动作是"去同意"。写错的那一侧会让用户改一遍地址、回来还是不同步。
   */
  'common.sync.error.consentRequired': '还没有同意隐私规则，heyta 不会向任何服务器发出请求 —— 在设置里作出选择后，同步才会开始',
  'common.sync.error.legalReconfirmRequired': '条款文本已经更新，而这个账号还没有重新确认，所以数据没有同步出去 —— 它完整地留在本机，读完确认后即可恢复',
  'common.legal.reconfirm.title': '条款文本已经更新',
  'common.legal.reconfirm.intro': '这套对外文本在你上次确认之后有了新版本。请读完再确认 —— 服务端会记下你确认的正是现在这一版。',
  'common.legal.reconfirm.readFirst': '请先读完：',
  'common.legal.reconfirm.localDataSafe': '你的数据完整地留在这台设备上，没有被改动，也没有被删。只是在你确认之前不会同步出去 —— 一个字节都不发。',
  'common.legal.reconfirm.later': '稍后再说（继续不同步）',
  'common.legal.reconfirm.action': '我已读完并确认',
  'common.legal.reconfirm.pending': '正在记下你的确认…',
  'common.legal.reconfirm.failNetwork': '确认没有提交成功（服务端没有回应）。在你确认之前，数据仍然不会同步。',
  'common.legal.reconfirm.failUnauthorized': '登录状态已经过期，确认没有提交。请重新登录后再确认一次。',
  'common.legal.reconfirm.failRejected': '服务端没有接受这次确认，数据仍然只留在本机。可以重试一次。',

  // ── 隐私同意（首启面板 + 设置页） ─────────────────────────
  // 🔴 这一组词条**两端共用**（web 与移动端说的是同一件事），理由与上面那组相同：
  // 同一个法律决定在两个壳里说成两句不同的话，早晚要有人回答"哪一句才是我们承诺的"。
  //
  // ⚠️ 措辞纪律：这里不许出现"为了给你更好的体验"这类**没有信息量**的句子，
  // 也不许出现"我们将收集……"这类**只声明不解释**的清单。每一条都要回答
  // "发出去的是什么、发给谁、不同意会少掉什么"—— 那是 PIPL 第 14 条
  // "充分知情"的最小要求，不是文案风格。
  'common.privacy.consent.title': '在使用联网功能之前',
  'common.privacy.consent.intro': 'heyta 是本地优先的：你的任务、清单、笔记与历史先写在这台设备上。这个选择只决定一件事 —— 这台设备能不能与服务器通信。',
  'common.privacy.consent.localOnlyGuarantee': '选「只用本机」时，所有功能照常可用：新建、编辑、日历、四象限、番茄钟、习惯、导出，一个都不少。不会同步、不会登录，也不会接收服务器推送；移动端本地提醒仍可在授予系统通知权限后使用。',
  'common.privacy.consent.acceptedGuarantee': '选「同意并联网」后，可以登录 heyta 并跨设备同步。任务数据经端到端加密后才上传，服务器看不到任务明文。',
  'common.privacy.consent.termsLink': '服务条款',
  'common.privacy.consent.privacyLink': '隐私政策',
  'common.privacy.consent.readFirst': '作出选择前，可以先读完整文本：',
  /**
   * 面板被**再次**打开时的说明。两种原因说的是两件不同的事，不许合成一句：
   * 一种是"你刚点了个要联网的功能"，另一种是"你刚撤回过"。
   * 少了这句，面板看起来就像每次点按钮都弹一下的广告。
   */
  'common.privacy.consent.whyRequiredForAction': '刚才那一步需要与服务器通信，而还没有同意隐私规则，所以 heyta 一个请求都没有发。',
  'common.privacy.consent.whyRevoked': '已撤回同意。现在这台设备不会对外发出任何请求 —— 包括刚才建立的实时连接。',
  'common.privacy.consent.accept': '同意并联网',
  'common.privacy.consent.localOnly': '只用本机',
  /**
   * 面板右上角那个关闭动作的名字。
   *
   * 🔴 不能写成「关闭」，也不能省：移动端用系统返回手势关掉这块面板时，
   * 用户读到的必须是「现在还没决定」，而不是「我把它拒了」。关掉**不等于同意**，
   * 闸门保持关闭 —— 所以这句话要自己说清它不是决定。
   */
  'common.privacy.consent.close': '以后再说',
  /**
   * ⚠️ 这句**必须**能在界面上出现：`localStorage` 在隐私模式下会静默不落地，
   * 而"点了同意、下次启动又问一遍"如果不说出口，用户只会认为这个应用在骗他。
   */
  'common.privacy.consent.notPersisted': '这台设备的本地存储不可用：你的选择只在本次打开有效，下次启动会再问一次。',
  /**
   * 决定**没能落盘**时面板不收起来 —— 那句警告必须出现在用户正看着的这一块上。
   * 于是需要一条明确的出口，而不是让他再点一次「同意」。
   */
  'common.privacy.consent.acknowledge': '知道了，继续',

  // 设置页里的那一个入口 —— PIPL 第 15 条要的是"便捷的撤回方式"，
  // 而一个找不到、看不懂的入口不算便捷。
  'common.privacy.settings.title': '隐私同意',
  'common.privacy.settings.statusTitle': '联网权限状态',
  'common.privacy.settings.statusHint': '这项选择只控制本机是否允许 heyta 与服务器通信，不会删除或改变本地数据。',
  'common.privacy.settings.actionTitle': '更改选择',
  'common.privacy.settings.accepted': '已同意与服务器通信',
  'common.privacy.settings.localOnly': '只用本机（未同意联网）',
  'common.privacy.settings.undecided': '还没有作出选择',
  'common.privacy.settings.decidedAt': '决定于 {time}（UTC）',
  'common.privacy.settings.revoke': '撤回同意',
  'common.privacy.settings.revokeHint': '撤回后这台设备立刻停止对外请求（包括已经建立的实时连接），并重新询问一次。本地数据不受影响。',
  // 撤回之后（或从没决定过）界面必须留一条**能重新决定**的路，否则 PIPL 第 15 条
  // 只做到"能撤回"、没做到"撤回后还能方便地再同意"。
  'common.privacy.settings.chooseAgain': '重新作出选择',
  'common.privacy.settings.chooseHint': '需要同步或登录时，可以在这里重新选择是否联网。打开选择面板不会改变当前权限。',

  // ── 落地页 · 通用 ─────────────────────────────────────────
  'landing.skipLink': '跳到主要内容',

  // ── 落地页 · 导航 ─────────────────────────────────────────
  'landing.nav.ariaLabel': '页面导航',
  'landing.nav.github': 'GitHub 仓库',
  'landing.nav.languageMenu': '选择语言',
  'landing.nav.capabilities': '能力',
  'landing.nav.showcase': '界面',
  'landing.nav.sync': '同步',
  'landing.nav.pricing': '定价',
  'landing.nav.selfhost': '自建',

  // ── 落地页 · 功能名（导航 / 能力卡 / 展厅 / 复现件共用）───
  'landing.feature.tasks': '任务',
  'landing.feature.quadrant': '四象限',
  'landing.feature.habits': '习惯',
  'landing.feature.focus': '番茄钟',

  // ── 落地页 · 四象限（行动名与定义名是两套，刻意都保留）───
  'landing.quadrant.do': '马上做',
  'landing.quadrant.plan': '计划做',
  'landing.quadrant.delegate': '交给别人',
  'landing.quadrant.drop': '先不做',
  'landing.quadrant.q1': '重要且紧急',
  'landing.quadrant.q2': '重要不紧急',
  'landing.quadrant.q3': '紧急不重要',
  'landing.quadrant.q4': '不重要不紧急',
  'landing.quadrant.dropHere': '拖任务到这里',

  // ── 落地页 · 英雄区 ───────────────────────────────────────
  // 🔴 首屏只讲**大众能感知的结果**。端到端加密 / 自建 / 本地优先这些
  // 是开发者的决策依据，不是大众的购买理由 —— 它们归 Privacy 与 SelfHost 两节
  // （那是愿意往下读的人才会到的地方）。首屏讲错话，大众看不到第二节。
  'landing.hero.eyebrow': '任务 · 清单 · 习惯 · 专注',
  // 标题里的强调部分是独立词条：`<em>` 的边界不能靠翻译字符串里的标记来猜。
  'landing.hero.titleLead': '今天该做什么，',
  'landing.hero.titleEmphasis': '一眼看见',
  'landing.hero.lede': '想到什么先记下来，它替你理清先后。任务、清单、习惯、专注打卡都在一处；手机上记一句，电脑上接着做。',
  'landing.hero.ctaShowcase': '看看它长什么样',
  // 主 CTA 指向界面、次 CTA 指向价格 —— 大众先想「好不好用」「多少钱」，
  // 而不是「我怎么自建」。自建的入口留在 SelfHost 一节和底部。
  'landing.hero.ctaPricing': '看价格',
  'landing.hero.floatSynced': '已同步到 3 台设备',
  'landing.hero.floatOffline': '离线照常可用',

  // ── 落地页 · 事实条 ───────────────────────────────────────
  'landing.facts.ariaLabel': '产品事实',
  // 事实条紧跟在首屏后面，所以它也必须先是**大众能用的理由**。
  // MIT 许可与「一条命令自建」挪进了 Footer 与 SelfHost —— 那里的读者才关心。
  // ⚠️ 加密那条**只承诺同步通道**：一旦开了云端 AI，内容是要明文出境的，
  // 所以这里不能写成笼统的「只有你能看」。
  'landing.facts.offline.value': '离线',
  'landing.facts.offline.label': '断网照常记，连上自动补传',
  'landing.facts.devices.value': '不限设备',
  'landing.facts.devices.label': '自建永久免费，设备数不封顶、不校验时长',
  'landing.facts.encrypted.value': '加密同步',
  'landing.facts.encrypted.label': '任务加密后才上传，同步通道读不出内容',
  'landing.facts.oneData.value': '一套数据',
  'landing.facts.oneData.label': '清单、四象限、习惯、专注共用同一份数据，不是几个 App 拼起来',

  // ── 落地页 · 能力（bento）─────────────────────────────────
  'landing.capabilities.title': '订阅制把六件事打包卖，我们把它拆开重做',
  'landing.capabilities.lede': '清单、日历、四象限、习惯打卡、番茄钟、重复任务。每一块都有成熟做法，难的是让它们共用同一份数据、同一套同步规则。',
  'landing.capabilities.quadrant.body': '重要与紧急拆成两轴，任务拖进哪一格就归哪一类。紧急程度由截止时间推导，不由你手填。',
  'landing.capabilities.habits.title': '习惯打卡',
  'landing.capabilities.habits.body': '热力图只用一个色阶的深浅表达强度，不靠颜色区分档位，色觉差异下一样读得出来。',
  'landing.capabilities.focus.body': '专注会话记进本地日志，和任务关联。',
  'landing.capabilities.breakdown.title': 'AI 助手',
  'landing.capabilities.breakdown.body': '只用一个对话入口：说清想做什么，Agent 先给出任务提案，确认后再写入清单。可用自己的密钥，也可整条关掉。',
  'landing.capabilities.repeat.title': '重复任务',
  'landing.capabilities.repeat.body': '按规则顺延：勾掉这一轮，下一轮自动出现，跨设备结果一致。',
  'landing.capabilities.offline.title': '离线可用',
  'landing.capabilities.offline.body': '断网照常读写。恢复连接后自动补传，冲突交给你判断而不是替你选。',

  // ── 落地页 · 展厅 ─────────────────────────────────────────
  'landing.showcase.title': '这就是它现在的样子',
  'landing.showcase.lede': '直接点击预览里的侧栏切换页面，点选任务查看详情，也可以试试勾选完成。这里使用演示数据，不会影响你的账号。',
  'landing.showcase.hint': '当前显示：{label}',
  'landing.showcase.quadrant.title': '不用自己想「先做哪个」',
  'landing.showcase.quadrant.body': '重要与紧急是两个独立的轴。紧急程度由截止时间推导，你只回答“这件事重要吗”，剩下的交给矩阵。',
  'landing.showcase.habits.title': '连续天数比打卡次数更值得看',
  'landing.showcase.habits.body': '热力图用同一色阶的深浅表示强度，不靠颜色区分档位，色觉差异下一样读得出来。',
  'landing.showcase.focus.title': '专注记录和任务长在一起',
  'landing.showcase.focus.body': '每段专注都关联到具体任务并落进本地日志，所以“这周时间花在哪”是查得出来的。',
  // 展厅第四块：时间线（`timeline` 整刀第 4 步）。
  'landing.showcase.timeline.title': '先看清这一周塞不塞得下',
  'landing.showcase.timeline.body': '每条任务按估时排进日程：清单能一条条摊开就摊开，摊不了就说「摊不了」—— 不给你一个看起来很整齐的假象。',

  // ── 落地页 · 隐私 ─────────────────────────────────────────
  'landing.privacy.title': '服务端从头到尾没见过你的明文',
  'landing.privacy.ledeLead': '加密在你的设备上完成，密钥不出设备。服务端拿到的是一段它打不开的东西，而且',
  'landing.privacy.ledeStrong': '没有任何开关能让它看到明文',
  'landing.privacy.ledeTail': ' —— 不是“我们承诺不看”，是“看不到”。',
  'landing.privacy.plaintext': '给妈妈买生日礼物',
  'landing.privacy.yourDevice': '你的设备',
  'landing.privacy.server': '服务端',
  'landing.privacy.keyNote': '密钥在这里，也留在这里',
  'landing.privacy.noteIdle': '往下滚，看看它到底收到了什么',
  'landing.privacy.noteProgress': '已加密 {done} / {total} 个字',
  'landing.privacy.noteReduced': '静态对照：明文留在你的设备上，服务端收到的只有密文。',

  // ── 落地页 · 自建 ─────────────────────────────────────────
  'landing.selfhost.title': '自己的服务器，一条命令起全套',
  'landing.selfhost.lede': '不需要注册账号，不需要订阅。服务端只负责转发密文与判并发，换掉它、关掉它、搬到别的机器上，你的数据都不受影响。',
  // 🔴 这一节**不许**出现命令行、内部路径或数据库机制（判据与理由见
  // `apps/landing/tests/public-copy-register.spec.tsx`）。需要逐条执行的东西
  // 住在下面 `guide.*` 指向的那份 runbook 里 —— 它会随构建一起更新。
  'landing.selfhost.step1.title': '起服务端',
  'landing.selfhost.step1.body': '一条 docker compose 把同步服务与数据库跑在自己的机器上。服务端只存密文，它没有解密的钥匙。',
  'landing.selfhost.step2.title': '在客户端填地址',
  'landing.selfhost.step2.body': '首次启动时二选一：填自己的服务器地址，或者用托管。选了随时能换。',
  'landing.selfhost.step3.title': '密钥与口令自己配',
  'landing.selfhost.step3.body': '没有默认值，要自己设 —— 不是零思考的一键安装，但每一步都有指南。',
  'landing.selfhost.guide.title': '完整步骤在自建指南里',
  'landing.selfhost.guide.body': '要逐条执行的命令、依赖与配置文件都写在自建指南里，跟着跑一遍就能起来。',
  'landing.selfhost.guide.link': '打开自建指南',

  // ── 落地页 · 价格 ─────────────────────────────────────────
  // 🔴 这里的价格必须与 server 的价目表、两份法务文本一致 ——
  // `scripts/check-pricing-consistency.mjs` 会读这些词条并断言三方一致。
  // 改价时先读 docs/reference/pricing-and-entitlements.md（三层唯一事实源）。
  'landing.pricing.ariaLabel': '价格与权益',
  'landing.pricing.title': '软件永久免费，只对托管和 AI 收费',
  'landing.pricing.lede': '应用本体的全部功能免费：自建自托管永久免费、不校验、不限设备。收费的只有两件事 —— 我们替你运维那台服务器，以及我们的云端 AI。',
  'landing.pricing.noFeatureGate': '两个付费档都不阉割功能 —— 第二档贵出来的钱买的是我们的云端 AI，不是解锁功能。',
  'landing.pricing.free.name': '开源自建',
  'landing.pricing.free.price': '免费',
  'landing.pricing.free.period': '永久',
  'landing.pricing.free.body': '代码在 GitHub 上，MIT 许可。除云端 AI 之外的功能全部永久免费 —— 不用注册账号，也没人校验你用了多久。AI 接你自己的端点也一样免费、不限次。',
  'landing.pricing.free.feature1': '除云端 AI 外的全部功能，永久免费',
  'landing.pricing.free.feature2': '设备数不限',
  'landing.pricing.free.feature3': '数据与密钥都留在你手里',
  'landing.pricing.free.cta': '开始自建',
  'landing.pricing.hosted.name': '官方托管',
  'landing.pricing.hosted.priceCny': '¥5 / 月',
  'landing.pricing.hosted.priceUsd': '$5 / 月',
  'landing.pricing.hosted.regionCny': '大陆',
  'landing.pricing.hosted.regionUsd': '海外',
  'landing.pricing.hosted.body': '我们替你运维那台中继。数据照旧是密文，我们仍然打不开。',
  'landing.pricing.hosted.feature1': '除云端 AI 外的全部功能，与自建一致',
  'landing.pricing.hosted.feature2': '多设备之间自动同步',
  'landing.pricing.hosted.feature3': '服务端记录完整保留，到期也不删',
  'landing.pricing.hosted.cta': '即将开放',
  'landing.pricing.hostedAi.name': '官方托管 + 云端 AI',
  'landing.pricing.hostedAi.priceCny': '¥12 / 月',
  'landing.pricing.hostedAi.priceUsd': '$12 / 月',
  'landing.pricing.hostedAi.regionCny': '大陆',
  'landing.pricing.hostedAi.regionUsd': '海外',
  'landing.pricing.hostedAi.body': '上面这一档的全部，加上我们的云端 AI。注意：这一步会把内容发到我们的服务器，它不受端到端加密保护。',
  'landing.pricing.hostedAi.feature1': '上面这一档的全部',
  'landing.pricing.hostedAi.feature2': '云端 AI，每月 300 次',
  'landing.pricing.hostedAi.feature3': '自带端点的 AI 不受影响，仍然免费、不限次',
  'landing.pricing.hostedAi.cta': '即将开放',
  'landing.pricing.statusNote': '收银台已经接通，但大陆与海外的支付通道都还在等支付商资质 —— 现在还不能下单。',

  // ── 落地页 · 收尾 CTA ─────────────────────────────────────
  'landing.cta.title': '你的清单，不该是别人的资产',
  'landing.cta.lede': '代码是开放的：自建永久免费，一条命令就能起自己的服务端，把数据搬回自己的机器。',
  // 与英雄区同一个意图，共用一条词条 —— 换标签会让人以为它们是两件事。
  'landing.cta.selfHost': '开始自建',
  // 「开始使用」这一个意图的**上层**说法。应用真的部署起来之后，
  // 构建时给 `VITE_APP_URL` 一个值，CTA 就换成这一条并指向应用（见 lib/app-url.ts）。
  // 两条词条不是两个功能，是同一个意图的两种状态：还没得用 / 已经能用。
  'landing.cta.useApp': '立即使用',

  // ── 落地页 · 页脚 ─────────────────────────────────────────
  'landing.footer.tagline': '本地优先的任务管理。数据先落本地，云端只是同步通道。',
  'landing.footer.group.product': '产品',
  'landing.footer.group.gettingStarted': '上手',
  'landing.footer.pricing': '价格',
  'landing.footer.syncHow': '同步怎么工作',
  'landing.footer.privacy': '隐私',
  'landing.footer.selfHostServer': '自建服务端',
  'landing.footer.licenseNote': 'heyta 采用 MIT 许可证；所用第三方代码的授权要求已逐项履行。',
  'landing.cta.viewCode': '在 GitHub 看源码',
  'landing.footer.viewOnGithub': '在 GitHub 上查看',
  'landing.footer.group.docs': '文档',
  'landing.footer.source': '源码仓库',
  'landing.footer.contributing': '参与贡献',
  'landing.footer.deployGuide': '自建部署指南',
  'landing.footer.roadmap': '路线图',
  'landing.footer.adr': '架构决策',
  'landing.footer.licenses': '第三方许可证',
  'landing.footer.docsIndex': '文档索引',

  // ── 落地页 · 同步 ─────────────────────────────────────────
  'landing.sync.title': '每台设备各写各的，碰上了也不会打架',
  'landing.sync.ledeLead': '每次改动都是一条独立记录，带着“我见过哪些改动”的版本信息。两端同时改同一条任务时，服务端会判成并发冲突并',
  'landing.sync.ledeStrong': '交给你决定',
  'landing.sync.ledeTail': '，而不是悄悄用后写的覆盖先写的。',
  'landing.sync.canvasLabel': '三台设备之间流动着加密的变更记录，其中一条被判为并发冲突',
  'landing.sync.legendChange': '一次改动',
  'landing.sync.legendDevice': '一台设备',

  // ── 落地页 · 界面复现件的静态示例数据 ─────────────────────
  // ⚠️ 这些是**展示品里的假数据**，不是产品文案。但它们会被渲染到屏幕上，
  // 所以照样进词条表 —— 否则切到英文时整个界面复现件会是一片中文。
  'landing.mock.inbox': '收集箱',
  'landing.mock.today': '今天',
  'landing.mock.projectsSection': '清单',
  'landing.mock.project.work': '工作',
  'landing.mock.project.personal': '个人',
  'landing.mock.project.reading': '读书',
  'landing.mock.tag.deepWork': '深度工作',
  'landing.mock.tag.waiting': '等待中',
  'landing.mock.date': '日期',
  'landing.mock.countdown': '倒计时',
  'landing.mock.synced': '已同步',
  'landing.mock.composeHint': '添加任务，回车确认（可写「明天」「下周三」「!1」）',
  'landing.mock.add': '添加',

  // 任务示例（四象限网格与番茄钟的"关联任务"复用同几条）
  'landing.mock.task.quote': '回复客户关于报价的邮件',
  'landing.mock.task.weeklyReport': '整理本周周报，发给团队',
  'landing.mock.task.q4Draft': '写 Q4 目标拆解初稿',
  'landing.mock.task.bookChapter': '读完《高效能人士的七个习惯》第 3 章',
  'landing.mock.task.dentist': '预约牙医，确认下周三上午',
  'landing.mock.task.photoBackup': '整理上个月的照片备份',
  'landing.mock.task.expense': '提交 9 月报销单',
  'landing.mock.task.quarterlyReview': '准备季度复盘的材料',
  'landing.mock.due.overdue2': '已逾期 2 天',
  'landing.mock.due.today1800': '今天 18:00',
  'landing.mock.due.in3Days': '还剩 3 天',
  'landing.mock.due.in5Days': '还剩 5 天',
  'landing.mock.due.tomorrow': '明天',
  // 时间线展厅件的日刻度后两格（前两格复用「今天 / 明天」）与那条图例。
  'landing.mock.timeline.axis3': '后天',
  'landing.mock.timeline.axis4': '第 4 天',
  'landing.mock.timeline.legend': '实线是按你填的估时排的，虚线是 AI 估的；摊不到子条目上时它会直说，不硬凑。',
  'landing.mock.due.done': '已完成',

  // 习惯示例
  'landing.mock.habit.earlyRise': '早起',
  'landing.mock.habit.earlyRise.streak': '连续 12 天',
  'landing.mock.habit.reading': '阅读 30 分钟',
  'landing.mock.habit.reading.streak': '连续 5 天',
  'landing.mock.habit.running': '跑步',
  'landing.mock.habit.running.streak': '连续 3 天',
  'landing.mock.heat.less': '少',
  'landing.mock.heat.more': '多',

  // 番茄钟示例
  'landing.mock.focus.phase': '专注',
  'landing.mock.focus.pause': '暂停',
  'landing.mock.focus.stop': '中止',
  'landing.mock.focus.linkedTask': '关联任务：{task}',
  'landing.mock.focus.completedToday': '今日已完成 3 个专注',
  'landing.mock.focus.break5': '休息 5 分钟',
  'landing.mock.focus.startNext': '开始下一段',

  // ═══════════════════════════════════════════════════════════
  // Web（apps/web）
  // ═══════════════════════════════════════════════════════════

  // ── Web · 外壳与导航 ──────────────────────────────────────
  // 外壳（`App.tsx`）是**第一次进入就看见**的东西：侧栏、视图 tab、空状态。
  // 🔴 导航标签在源码里存的是**键**（`NavEntry.labelKey`）而不是句子，
  // 渲染时才 `t(...)` —— 语言一换它们自动跟着换，不需要重建数组。
  'web.auth.desktop.return': '返回 heyta',
  'web.shell.nav.aria': '主导航',
  'web.shell.nav.quadrantSection': '四象限',
  'web.shell.nav.scopeAria': '当前视图的范围',
  'web.shell.nav.inbox': '收集箱',
  'web.shell.nav.today': '今天',
  /**
   * 「最近 7 天」—— 滴答那三个智能清单里的中间一个。
   *
   * 🔴 天数**不写在这里**以外的地方：窗口的 7 住在 `@heyta/domain` 的
   * `NEXT_SEVEN_DAYS`，侧栏标签上的这个数必须与它同源（`task-filter.spec.ts`
   * 钉边界，`task-groups.spec.tsx` 钉"标签上的数 == 那个常数"）。
   * ⚠️ 「7 天」= 含今天的**七个日历日**，不含逾期 —— 与领域的窗口定义一致。
   */
  'web.shell.nav.next7Days': '最近 7 天',
  'web.shell.nav.completed': '已完成',
  'web.shell.nav.quadrant': '四象限',
  'web.shell.nav.project': '清单',
  'web.shell.nav.tag': '标签',
  /**
   * 任务列表的排序口径。档位名与领域的 `TASK_SORT_KEYS` 一一对应
   * （`apps/web/src/App.tsx` 的 `SORT_LABEL: Record<TaskSortKey, MessageKey>` 是
   * 穷尽映射：加一档却没有这条词条 ⇒ 那边编译报错，而不是界面上少一个选项）。
   *
   * ⚠️ `display` 不叫「无排序」而叫「默认（按截止时间）」：这一档**是有规则的**
   * （未完成在前 + 截止升序 + 无截止垫底），说"不排序"会让人以为另外两档是
   * "把顺序弄乱了"。
   */
  'web.shell.sort.aria': '排序方式',
  'web.shell.sort.display': '默认（按截止时间）',
  'web.shell.sort.addedAt': '按添加时间',
  'web.shell.sort.priority': '按优先级',
  'web.shell.bulk.select': '选择任务',
  'web.shell.bulk.cancel': '退出选择',
  'web.shell.bulk.selected': '已选 {count} 项',
  'web.shell.bulk.complete': '批量完成',
  'web.shell.bulk.repeatNotice': '包含重复任务，请逐条完成',
  'web.shell.bulk.delete': '批量删除',
  'web.shell.bulk.move': '移动到清单',
  'web.shell.bulk.moveInbox': '收集箱',
  'web.shell.bulk.undo': '撤销本次批量操作',
  'web.shell.bulk.error': '批量操作未完成：{message}',
  'web.shell.search.placeholder': '搜索任务',
  'web.shell.search.aria': '搜索任务（标题与备注）',
  'web.shell.search.clear': '清除搜索',
  'web.shell.nav.tasks': '任务',
  'web.shell.nav.q1': '重要且紧急',
  'web.shell.nav.q2': '重要不紧急',
  'web.shell.nav.q3': '紧急不重要',
  'web.shell.nav.q4': '不重要不紧急',
  'web.shell.sidebar.resize': '调整侧栏宽度',
  // 详情列（最右那一栏）左边缘那枚拖拽把手（`ColumnResizer.tsx` 的 `DetailColumnResizer`）。
  'web.shell.detail.resize': '调整详情栏宽度',
  // 顶栏语言分组的**可见**标签（`LanguageSwitcher.tsx`）。它必须看得见而不是只挂在
  // `aria-label` 上：同一个位置已经判过两次"用户根本不知道它们是什么"
  // （`App.tsx` 排序下拉那段、`main-area.css` 的 `.ht-header__view`）。
  // 选项本身**不翻**（永远是 `中文` / `English` 的自称，见上面 `common.lang.*` 那段）。
  'web.shell.lang.label': '语言',
  'web.shell.views.aria': '视图',
  'web.shell.views.groupMain': '主要',
  'web.shell.modules.title': '功能模块',
  'web.shell.account.aria': '账号',
  'web.shell.account.ariaAs': '账号：{email}',
  'web.shell.account.signIn': '登录账号',
  // R10：身份区之后、设置之前。**六家一致**的"头像 → 菜单 → 二级页"形态，
  // 所以它是菜单的一项而不是一个常驻 tab（见 docs/plans/ui-review-fill-zh-timeline.md §8.2）。
  'web.shell.account.profile': '编辑个人信息',
  'web.shell.account.profileCenter': '个人中心',
  'web.shell.account.settings': '应用设置',
  'web.shell.account.signOut': '退出登录',
  'web.shell.nav.help': '帮助',

  // ── 通知中心 + 活动（福利中心）─────────────────────────────────────────
  // 入口是 rail 底部的铃铛（与「帮助」并列，**不是**一个视图 tab），面板里两个 Tab。
  // 服务端只下发 kind + 参数，措辞全部在这里 —— 所以改文案不需要动服务端。
  'web.inbox.aria': '通知与活动',
  'web.inbox.trigger': '通知',
  'web.inbox.badge.aria': '{count} 条未读通知',
  'web.inbox.tabs.aria': '通知与活动',
  'web.inbox.tab.notifications': '通知',
  'web.inbox.tab.activity': '活动',
  'web.inbox.close': '关闭',
  'web.inbox.markAllRead': '全部已读',
  'web.inbox.loading': '加载中…',
  'web.inbox.error': '读不到内容，请稍后重试',
  'web.inbox.retry': '重试',
  'web.inbox.unconfigured': '配置同步服务器之后，这里才会收到通知。',
  'web.inbox.notifications.empty': '还没有通知',
  'web.inbox.activity.empty': '暂时没有活动',
  'web.inbox.notification.referral.title': '邀请奖励已发放',
  'web.inbox.notification.referral.body': '{name} 成功激活，{days} 天会员奖励已自动发放到你的账户。',
  'web.inbox.notification.referral.bodyUnknownActor': '一位好友成功激活，{days} 天会员奖励已自动发放到你的账户。',
  'web.inbox.activity.invite.title': '邀请好友得会员',
  'web.inbox.activity.invite.body': '把邀请码或链接发给好友。对方完成注册并验证邮箱后，你会获得 {days} 天会员。',
  'web.inbox.activity.invite.codeLabel': '我的邀请码',
  'web.inbox.activity.invite.copyCode': '复制邀请码',
  'web.inbox.activity.invite.copyLink': '复制邀请链接',
  'web.inbox.activity.invite.copied': '已复制',
  'web.inbox.activity.invite.copyFailed': '复制失败，请手动选中',
  'web.inbox.activity.invite.stats': '已邀请 {invited} 人，已激活 {activated} 人，累计获得 {days} 天',
  'web.inbox.activity.invite.remaining': '本窗口还可邀请 {remaining} 人',
  'web.inbox.activity.invite.listTitle': '邀请记录',
  'web.inbox.activity.invite.status.activated': '已激活 +{days} 天',
  'web.inbox.activity.invite.status.pending': '等待对方验证邮箱',
  'web.inbox.activity.invite.unknownName': '一位好友',
  'web.inbox.activity.invite.empty': '还没有邀请记录',
  'web.shell.modules.intro': '关掉不用的模块，它就从左侧导航里消失。只影响这台设备。',
  'web.shell.modules.calendar.label': '日历',
  'web.shell.modules.calendar.note': '按日期看哪天有什么事。',
  'web.shell.modules.quadrant.label': '四象限',
  'web.shell.modules.quadrant.note': '按重要与紧急把任务分到四格。',
  'web.shell.modules.habits.label': '习惯打卡',
  'web.shell.modules.habits.note': '养成习惯，让自律成为日常。',
  'web.shell.modules.timeline.label': '时间线',
  'web.shell.modules.timeline.note': '按日期把任务铺在一条时间轴上。',
  'web.shell.modules.focus.label': '番茄钟',
  'web.shell.modules.focus.note': '用番茄计时保持专注。',
  'web.shell.modules.growth.label': '成长',
  'web.shell.modules.growth.note': '看长期趋势与累计，而不是今天。',
  'web.shell.modules.notes.label': '便签',
  'web.shell.modules.notes.note': '随时记一笔，不必先变成一条任务。',
  'web.shell.modules.savedHint': '已保存 —— 左侧导航已经跟着变了。',
  'web.shell.views.groupMore': '更多',
  'web.shell.rail.customize': '自定义侧栏',
  'web.shell.rail.customizeDone': '完成自定义',
  'web.shell.rail.pin': '固定到侧栏',
  'web.shell.rail.moveMore': '移至更多',
  'web.shell.rail.moveUp': '上移',
  'web.shell.rail.moveDown': '下移',
  'web.shell.rail.reset': '恢复默认顺序',
  'web.shell.views.habits': '习惯',
  'web.shell.views.focus': '番茄钟',
  'web.shell.views.timeline': '时间线',
  // 成长页（激励体系 L3）。⚠️ 它必须在词条表里**真实存在**：
  // `App.tsx` 的 `VIEW_TABS` 用 `labelKey` 渲染标签，而 `t()` 查不到词条是**抛错**，
  // 不是回退 —— 少一条就是整个外壳白屏（真浏览器验收抓到过）。
  'web.shell.views.growth': '成长',
  // 便签（幻觉 #12「笔记模块」）。放在回收站/设置之前 ——
  // 它与习惯/成长同属"日常会翻一下"的内容视图。
  'web.shell.views.notes': '便签',
  'web.shell.views.settings': '设置',
  'web.shell.profile.close': '关闭个人中心',
  // 设置浮层的退出口（Esc / ✕ 共用一个可访问名）。见 App.tsx 的 sheet 段：
  // 浮层的**标准出口**是"看得见的关闭 + Esc"，缺一个都会让人以为要按浏览器后退。
  'web.shell.settings.close': '关闭设置',
  'web.settings.nav.profile': '个人资料',
  'web.settings.nav.appearance': '任务与显示',
  'web.settings.nav.syncPrivacy': '同步与隐私',
  'web.settings.nav.aiIntegrations': 'AI 与集成',
  'web.settings.nav.data': '数据管理',
  'web.settings.nav.account': '账号与安全',
  'web.settings.nav.help': '关于与帮助',
  'web.settings.dataUx.backupTitle': '备份与还原',
  'web.settings.dataUx.backupLead': '保留一份完整的本地备份，也可以将它还原到一台空设备。',
  'web.settings.dataUx.migrationTitle': '从其他应用迁移',
  'web.settings.dataUx.migrationLead': '先查看预览，再把滴答清单 CSV 合并到现有的 heyta 数据中。',
  'web.profile.overview.title': '个人中心',
  'web.profile.overview.back': '返回个人中心',
  'web.profile.overview.lead': '查看你的身份、近期状态和成长进度。',
  'web.profile.overview.identity': '我的身份',
  'web.profile.overview.localOnly': '数据先保存在本机，服务器只负责同步加密内容。',
  'web.profile.overview.signedIn': '同步账号',
  'web.profile.overview.local': '仅在本机使用',
  'web.profile.overview.edit': '编辑个人资料',
  'web.profile.overview.settings': '打开设置',
  'web.profile.overview.growth': '查看完整成长',
  'web.profile.overview.recent': '近期状态',
  'web.profile.overview.tasks': '本周完成任务',
  'web.profile.overview.focus': '本周专注分钟',
  'web.profile.overview.checkIns': '本周习惯打卡',
  'web.profile.overview.achievements': '成就进度',
  'web.profile.overview.achievementsHint': '只和过去的自己比较，达成不会因中断而消失。',
  'web.profile.overview.identityLoading': '正在读取个人资料…',
  'web.profile.overview.identityUnavailable': '暂时读不到个人资料；本地回顾仍可用。',
  'web.profile.overview.identityRetry': '重新读取',
  'web.shell.dueMode.aria': '截止时间显示方式',
  'web.shell.dueMode.date': '日期',

  // ── 个人信息（R10，2026-10-03）─────────────────────────────────────────
  // 昵称与头像。**这一页只给你自己看**：heyta 没有共享与协作，服务端也没有
  // "按别人身份查资料"的端点，所以措辞里不许出现"其他用户会看到"。
  // 规格（32 个码点 / 图片格式与原图上限）的唯一来源是
  // `packages/shared-schema/src/account-profile-contract.ts`，措辞在这里。
  'common.profile.title': '个人信息',
  'common.profile.nickname.label': '昵称',
  'common.profile.nickname.placeholder': '留空则显示邮箱',
  'common.profile.nickname.hint': '最多 {max} 个字。昵称只是显示名，不是你的真实姓名；登录标识始终是邮箱。',
  'common.profile.nickname.toolong': '昵称最多 {max} 个字，现在有 {count} 个。',
  'common.profile.nickname.save': '保存昵称',
  'common.profile.nickname.saved': '昵称已保存',
  'common.profile.nickname.cleared': '已清除昵称',
  // 🔴 这一句**只说昵称**。它曾经复用头像那句失败提示（『头像没有传上去』），
  //    于是昵称没存上时界面在说另一件事 —— 判据钉在 `apps/web/tests/profile-panel.spec.tsx`。
  'common.profile.nickname.failed': '昵称没有保存成功，请稍后再试。',
  'common.profile.avatar.label': '头像',
  'common.profile.avatar.change': '换一张',
  'common.profile.avatar.remove': '移除头像',
  'common.profile.avatar.removed': '头像已移除',
  'common.profile.avatar.uploading': '正在上传…',
  // 🔴 这条不是错误提示，是**产品事实**：口令从不落盘（`credential-storage.ts`），
  // 所以刷新之后内存里没有它，而头像是用它加密的。没有它谁也解不开，包括我们自己。
  'common.profile.avatar.needPassword': '头像是用你的端到端加密口令保护的，本机没有保存这个口令 —— 请先在「同步设置」里填写一次，再更换或查看头像。',
  'common.profile.avatar.badType': '只支持 {types} 格式的图片。',
  'common.profile.avatar.tooBig': '图片压缩后仍超过 {max}，换一张小一点的。',
  'common.profile.avatar.failed': '头像没有传上去，请稍后再试。',
  // 🔴 读侧的三句（已上传 / 解不开 / 暂时取不到）与写侧那句**不能合并**：
  // 用户动作分别是"等着""去核对口令""稍后重试"。以前读侧只有 `failed` 一句，
  // 于是"这台设备解不开"被说成"头像没有传上去"——界面在讲一件没发生过的事。
  'common.profile.avatar.uploaded': '头像已更新',
  'common.profile.avatar.undecryptable': '这台设备解不开你的头像 —— 端到端加密口令不对。在「同步设置」里重新填一次口令即可。',
  'common.profile.avatar.unreadable': '暂时读不到头像，请稍后再试。',
  'common.profile.loadFailed': '个人信息没有读到，请稍后再试。',
  'common.profile.signInToEdit': '登录后可以编辑昵称和头像；本地任务与回顾无需登录。',
  'common.profile.email.label': '邮箱',
  // 🔴 这句原本写的是"不能在这里修改"。换绑流程落地之后它就是一句谎 ——
  // 留着一句假指引，比留着空白更糟（用户会去别处找那个"不能"的理由）。
  'common.profile.email.hint': '邮箱是登录标识，也是找回账号的唯一凭据。要换成别的地址，请用下面的「更换登录邮箱」。',
  // ── 换绑登录邮箱（ADR-0063）。两个壳共用这一组。──
  // 🔴 措辞必须把"两边各点一次"说出来：只写"已发送确认邮件"，用户点了自己那封
  // 就会以为已经改成了，于是另一边永远不会去点，那张请求在库里静静过期。
  'common.emailChange.title': '更换登录邮箱',
  'common.emailChange.intro': '这次更换需要你在新旧两个邮箱里各点一次，两边都点完才会生效。',
  'common.emailChange.currentLabel': '当前邮箱',
  'common.emailChange.newLabel': '新邮箱地址',
  // 🔴 这一句不是装饰：这台应用里的输入框按现行控件风格**没有边框**（`controls.css` 的
  // `.ht-input { border: 0 }`），空着的时候界面只剩一个标签和一个按钮 —— 看图时确实
  // 认不出那里能输入。占位文字是那一格里唯一"这是个框"的线索。
  'common.emailChange.newPlaceholder': '输入要换到的新邮箱地址',
  'common.emailChange.submit': '发起更换',
  'common.emailChange.busy': '正在发起…',
  'common.emailChange.sent': '两封信已经发出，请在新旧两个邮箱里各点一次。',
  'common.emailChange.awaitingBoth': '还在等两个邮箱各点一次。',
  'common.emailChange.awaitingOld': '新邮箱那一边已经确认，还在等当前邮箱这一边。',
  'common.emailChange.awaitingNew': '当前邮箱那一边已经确认，还在等新邮箱这一边。',
  'common.emailChange.pendingLabel': '待绑邮箱',
  'common.emailChange.cancel': '取消这次更换',
  'common.emailChange.cancelled': '这次更换已经取消，邮箱地址没有改动。',
  'common.emailChange.cooldown': '上一封信还在有效期内，{seconds} 秒后可以重新发起。',
  'common.emailChange.unchanged': '这个地址就是这个账号现在用的邮箱。',
  'common.emailChange.taken': '另一个账号已经在用这个邮箱地址。',
  'common.emailChange.notVerified': '请先验证当前邮箱，再来更换。',
  'common.emailChange.invalidLink': '这个链接无效或已经过期，请重新发起一次。',
  'common.emailChange.network': '网络不可用，这次没有发起成功，邮箱地址没有改动。',
  'common.emailChange.error': '更换没有成功，请重试。',
  // 🔴 读侧失败**不许**说成"更换没有成功"：那一次谁也没发起过任何东西。
  // 这一句只说两件实话：状态没读到、地址没有任何改动。
  'common.emailChange.loadFailed': '没能读到当前的换绑状态。邮箱地址没有任何改动，可以稍后再刷新一次。',
  // ── 登录设备（一枚访问令牌 = 一台设备）。两个壳共用这一组。──
  'common.sessions.title': '登录设备',
  'common.sessions.intro': '这里列出当前还能用你的账号登录的设备。退出哪一台，它的下一次请求就要重新登录。',
  'common.sessions.empty': '除了这台，没有别的设备登录着。',
  'common.sessions.thisDevice': '这台设备',
  'common.sessions.currentHint': '这一台就是你正在用的设备，退出请用「退出登录」。',
  'common.sessions.revoke': '退出这一台',
  'common.sessions.revoked': '已经退出那一台。',
  'common.sessions.logoutAll': '退出所有设备',
  'common.sessions.logoutAllDone': '所有设备都已退出，包括这台。请重新登录。',
  'common.sessions.busy': '正在处理…',
  'common.sessions.failed': '没有做成，请重试。',
  'common.sessions.lastSeen': '上次用到',
  'common.sessions.signedInSince': '这次登录开始于',
  // 本轮之前签的令牌没有 `jti`，按枚撤销撤不动它们 —— 这句是实话，不是故障。
  'common.sessions.legacyHint': '有些设备上的登录早于这个功能，只能用「退出所有设备」一起登出。',
  // 🔴 断网时点了"退出登录"该说什么：本机凭据照样清（把那枚令牌留在本机是更坏的结果），
  // 但服务器上的那一枚还活着必须说出来，并给一个重试入口 —— 吞掉它等于让"退出"看起来成功了。
  'common.signOut.pending': '这台设备已经退出，但服务器上的那一枚登录暂时没能撤销。',
  'common.signOut.retry': '重新尝试撤销',

  'web.settings.display.title': '显示',
  'web.settings.display.dueNote': '任务行上的截止时间显示为日期，还是距离截止时间的倒计时。',
  // 工单 W4：详情列（右侧那一栏）的出现与收起。
  // 🔴 说明句里必须把"它自己不出来的两种情况"和"收起来之后怎么叫回来"都说完 ——
  // 一个只写「常驻 / 收起」的开关，用户收起后在窗口变窄时看到它没了，
  // 会以为自己按坏了。
  'web.shell.detailPane.collapse': '收起详情面',
  'web.shell.detailPane.expand': '展开详情面',
  'web.settings.display.detail.title': '详情面',
  'web.settings.display.detail.modeOpen': '常驻',
  'web.settings.display.detail.modeCollapsed': '收起',
  'web.settings.display.detailNote': '窄窗时自动收起，可从页头随时打开。',
  // ── 设置 → 显示：语言与主题（H9 第三刀，2026-10-06 从页头搬进来）────────
  // 两条说明都不是装饰：搬进设置之后，"这一格管什么"只能靠界面自己说清楚。
  // 尤其语言那一格 —— 它过去在页头，靠"永远看得见"来免解释。
  'web.settings.display.langNote': '界面用哪一种语言显示。只改这个应用，不改系统的语言。',
  'web.settings.display.themeTitle': '外观',
  'web.settings.display.themeLight': '浅色',
  'web.settings.display.themeDark': '深色',
  'web.settings.display.themeNote': '这台设备上的偏好。在这里选过之前，界面跟随系统的深/浅色设置。',
  'web.shell.dueMode.countdown': '倒计时',
  // 任务行上那几个**纯图标**按钮：名字里必须带上任务标题，
  // 否则屏幕阅读器听到的是一串没有区别的"按钮"。
  'web.shell.tasks.complete': '完成：{title}',
  'web.shell.tasks.uncomplete': '取消完成：{title}',
  'web.shell.tasks.select': '选择：{title}',
  'web.shell.tasks.unselect': '取消选择：{title}',
  'web.shell.tasks.more': '更多操作：{title}',
  'web.shell.tasks.moreLabel': '更多',
  'web.shell.tasks.delete': '删除：{title}',
  // ── 任务页的日期分组头（滴答同款，2026-09-30）────────────────
  // 组序与归属规则在 `@heyta/domain` 的 `groupTasksByDate`；这里只管措辞。
  // ⚠️ `{weekday}` 用的是 `common.weekday.*`（zh 是裸「三」，所以模板里带「周」；
  //    en 是「Wed」，模板里不带）—— 两端各拼一次的漂移就在这类细节里。
  'web.tasks.group.overdue': '已过期',
  'web.tasks.group.today': '今天, 周{weekday}',
  'web.tasks.group.tomorrow': '明天, 周{weekday}',
  'web.tasks.group.date': '{month}月{day}日, 周{weekday}',
  'web.tasks.group.undated': '无截止时间',
  'web.tasks.group.postpone': '顺延',
  'web.tasks.group.postponeAria': '把这 {count} 条逾期任务顺延到今天',
  // ── 任务详情列的四分组（审计 §4.6：「详情列功能太全、层级不够」）──────────
  // 固定四组：基本信息（标题/备注）→ 时间（截止/提醒）→ 组织（清单/标签/子任务/优先级）
  // → 自动化（重复）。优先级归「组织」而非「时间」的裁决理由写在 `TaskDetailCard` 里。
  'web.tasks.detail.section.basic': '基本信息',
  'web.tasks.detail.section.time': '时间',
  'web.tasks.detail.section.organize': '组织',
  'web.tasks.detail.section.automation': '自动化',
  // 重复面板里收起自定义 RRULE 的那枚 summary（审计 §4.6：先展示自然语言选项，
  // 原始 RRULE 收进「高级」）。与登录面板「高级」指的是同一档交互，成对词条。
  'web.tasks.detail.advanced': '高级',
  // ── 任务备注 ──
  // 🔴 在它之前，Web 上**没有任何备注输入框**：`Task.note` 存在、`setNote` 存在，
  // 但唯一调用点是 AI 拆解与 AI 估时。数据层是通的（备注会被导出、会同步），
  // 缺的只是"用户自己能不能写"这一米。见 `features/tasks/NoteEditor.tsx` 文件头。
  'web.note.toggle': '备注',
  'web.note.placeholder': '写点什么（支持 Markdown）',
  'web.note.a11y.edit': '编辑「{title}」的备注',
  'web.note.hint': '离开输入框时自动保存',
  // ── 回收站 ──
  // 入口是外壳的视图 tab（`App.tsx` 的 `VIEW_TABS`），视图本体在
  // `apps/web/src/features/trash/TrashView.tsx`。删除仍然只是软删除，
  // 这里让用户能看见并且**恢复**；彻底删除是二次确认后的不可逆动作。
  'web.trash.nav': '回收站',
  'web.trash.intro': '这里放着已删除的任务、便签、清单和习惯。恢复后它会回到原来的位置。',
  'web.trash.empty.title': '回收站是空的',
  'web.trash.empty.hint': '有内容后，可以在这里恢复或彻底删除。',
  'web.trash.deletedAt': '删除于 {date}',
  'web.trash.restore': '恢复：{title}',
  'web.trash.purge': '彻底删除：{title}',
  'web.trash.confirm.title': '彻底删除「{title}」？',
  'web.trash.confirm.body': '彻底删除后它不会再出现在回收站里，也无法恢复。',
  // 🔴 与移动端 mobile.trash.confirm.notErasure 同一句话：彻底删除只是不再提供恢复，没有把历史抹掉。
  'web.trash.confirm.notErasure': '这不是物理擦除：操作日志里仍然留着这条记录，只是界面不再提供恢复。',
  // 与 mobile.trash.confirm.projectTasks 同一句：删清单不级联删任务（`project-actions.ts` 文件头第 2 条）。
  'web.trash.confirm.projectTasks': '里面还有 {count} 条任务，它们不会被删除。',
  'web.trash.confirm.habitLogs': '它已有的打卡记录不会被删除，恢复后连续天数照旧。',
  'web.trash.confirm.submit': '彻底删除',
  'web.trash.confirm.cancel': '取消',
  // 动作层拒绝时必须说出来（例如"已被彻底删除，无法恢复"）—— 咽掉它就是"点了没反应"。
  'web.trash.error': '这次操作没有成功：{reason}',
  // 空状态：任何列表都必须有空状态，而且要说**下一步做什么** ——
  // 留白屏会让用户以为应用坏了。`all` 同时是兜底（新的 filter.kind 不留白）。
  'web.shell.empty.all.title': '收集箱是空的',
  'web.shell.empty.all.hint': '在上面输入框添加第一个任务',
  'web.shell.empty.today.title': '今天没有到期任务',
  'web.shell.empty.today.hint': '给任务设个截止时间，它会出现在这里',
  'web.shell.empty.next7Days.title': '未来 7 天没有安排',
  'web.shell.empty.next7Days.hint': '给任务设一个这几天内的截止时间，它会出现在这里',
  'web.shell.empty.completed.title': '还没有完成的任务',
  'web.shell.empty.completed.hint': '完成一个任务试试',
  'web.shell.empty.quadrant.title': '这个象限是空的',
  'web.shell.empty.quadrant.hint': '给任务标记重要程度与截止时间',

  // ── Web · 崩溃屏（ErrorScreen）────────────────────────────
  'web.error.storage.title': '无法初始化本地存储',
  'web.error.storage.hint': '浏览器可能禁用了本地数据库（无痕模式常见）。关掉无痕模式或换一个浏览器再试。',
  // 🔴 按**失败原因**给建议，而不是一句通用的"存储不可用"：
  // 下面两种的用户动作完全不同（一种能自己解决，一种只能反馈给我们），
  // 而来源给的结构化原因就在 `StorageError.failure.kind` 里（见 packages/storage/src/errors.ts）。
  'web.error.storage.blockedHint': '被其它标签页挡住了：关掉这个应用的其它窗口或标签页，再刷新重试。',
  'web.error.storage.bugHint': '这看起来是 heyta 自己的问题，不是你操作错了。重启应用再试；一直这样的话，请把下面的详情发给我们。',
  'web.error.details': '技术详情',

  // ── Web · 同步条 ──────────────────────────────────────────
  'web.sync.resolveConflicts': '处理冲突',
  'web.sync.a11y.syncNow': '立即同步',
  // rail 底部那一枚同步按钮的完整标签：动作 + 当前状态一句话。
  // 🔴 状态必须进标签：图标加一个状态点在色觉障碍下不可分辨，而这一枚没有可见文字。
  'web.sync.rail.aria': '同步，当前状态：{status}',
  'web.sync.settings.title': '同步设置',
  // H9 第 3 刀：这一节说明"同步到底把什么送出去"。原来的「关闭同步设置」随着
  // 那层同级浮层一起删掉了 —— 一节设置没有"关闭"这个动作，退出设置就有出口。
  'web.settings.sync.note': '任务先保存在本机。登录 heyta 后可在设备间自动同步，服务端只接收加密的任务数据。',
  'web.sync.serverUrl.label': '服务端地址',
  'web.sync.token.label': '访问令牌',
  'web.sync.password.label': '端到端加密口令',
  // `<strong>不会</strong>` 的三段拆分，与落地页 ledeLead/ledeStrong/ledeTail 同一做法：
  // 强调标记的边界不能靠翻译字符串里的符号去猜。
  'web.sync.password.lead': '旧格式的加密口令',
  'web.sync.password.strong': '不会',
  'web.sync.password.tail': '被保存到磁盘，只存在于本次会话。已设置加密数据钥匙的数据，可在下方使用口令或已保存的恢复码解锁；尚未迁移的旧格式数据仍需要原口令。重置登录密码不能解密数据。',
  'web.settings.syncUx.statusTitle': '同步状态',
  'web.settings.syncUx.statusHint': '先确认连接状态，再修改服务端或账号凭据。',
  'web.settings.syncUx.errorTitle': '同步需要处理',
  'web.settings.syncUx.accountTitle': '服务端与账号',
  'web.settings.syncUx.accountHint': '服务端地址决定数据发往哪里；登录或手动令牌只负责证明你可以访问它。未保存前，草稿不会改变当前连接。',
  'web.settings.syncUx.encryptionTitle': '端到端加密',
  'web.settings.syncUx.encryptionHint': '登录密码只用于账号认证。下面的加密口令或数据钥匙，才用于解锁任务内容；服务端看不到它们的明文。',
  'web.sync.vault.title': '加密数据钥匙',
  'web.sync.vault.description': '这把钥匙用于解锁已同步的数据。它与登录密码分开，绝不会保存在浏览器里。',
  'web.sync.devices.title': '已连接设备',
  'web.sync.devices.description': '撤销会让这个账号的所有设备（包括当前设备）退出登录。设备离线时不会被远程擦除；重新登录后，请在可信设备上轮换数据密钥并迁移保留的密文。',
  'web.sync.devices.loading': '正在加载设备…',
  'web.sync.devices.empty': '暂时没有可管理的设备。',
  'web.sync.devices.lastSeen': '最近活动：{date}',
  'web.sync.devices.revoke': '撤销设备',
  'web.sync.devices.revoking': '正在撤销…',
  'web.sync.devices.confirm': '撤销后所有设备都必须重新登录。离线设备上的本地数据不会被远程擦除。确定继续吗？',
  'web.sync.devices.revoked': '设备已撤销，所有设备都必须重新登录。请在可信设备重新登录后轮换数据密钥并迁移保留的密文。',
  'web.sync.devices.revocationUncertain': '撤销请求的响应丢失了。本机已先退出登录；重新登录后请核对设备列表，再轮换数据密钥。',
  'web.sync.devices.unauthorized': '会话已失效，请重新登录后再管理设备。',
  'web.sync.devices.sessionChanged': '确认期间账号或服务器发生了变化，没有撤销任何设备。',
  'web.sync.devices.error': '设备列表或撤销请求失败，请检查网络后重试。',
  'web.sync.vault.accountRequired': '请先登录，再管理这个账号的加密数据钥匙。',
  'web.sync.vault.createTitle': '创建加密数据钥匙',
  'web.sync.vault.passphrase': '加密口令',
  'web.sync.vault.create': '创建钥匙',
  'web.sync.vault.recoveryLabel': '恢复码',
  'web.sync.vault.recoveryHint': '请把这串恢复码保存到密码管理器或离线记录中。它只显示这一次，服务端无法替你找回。',
  'web.sync.vault.recoveryResume': '这次轮换已经在之前准备好了。请输入你保存的恢复码以继续。',
  'web.sync.vault.recoveryConfirm': '输入恢复码以确认',
  'web.sync.vault.confirm': '确认并发布',
  'web.sync.vault.cancel': '取消',
  'web.sync.vault.unlockTitle': '解锁加密数据',
  'web.sync.vault.unlock': '用口令解锁',
  'web.sync.vault.recoveryCode': '恢复码',
  'web.sync.vault.unlockRecovery': '用恢复码解锁',
  'web.sync.vault.ready': '这台设备上的加密数据已经解锁。',
  'web.sync.vault.recoveryRotationRequired': '恢复码解锁成功。请先设置新口令并保存新的恢复码，才能使用加密数据。',
  'web.sync.vault.lock': '锁定数据钥匙',
  'web.sync.vault.changeTitle': '新的口令与恢复码',
  'web.sync.vault.newPassphrase': '新的加密口令',
  'web.sync.vault.change': '更换口令',
  'web.sync.vault.rotateRoot': '轮换数据密钥并迁移数据',
  'web.sync.vault.rootRotationHint': '这会生成新的数据密钥，完成所有保留加密记录的迁移后才发布。',
  'web.sync.vault.rootRotationProgress': '正在迁移加密数据：{completed}/{total}',
  'web.sync.vault.legacyPassphrase': '旧版加密口令（仅用于迁移）',
  'web.sync.vault.legacyPassphraseHint': '如果所有保留记录都已经使用数据钥匙加密，请留空。只有这个账号仍有旧版口令加密记录时，才输入旧口令。',
  'web.sync.vault.busy': '正在加载加密数据钥匙…',
  'web.sync.vault.error': '加密数据钥匙加载或使用失败。本地数据没有变化，请检查服务端后重试。',
  'web.sync.vault.errorMismatch': '恢复码不匹配，请准确输入刚刚显示的恢复码。',
  'web.sync.vault.errorConflict': '另一台设备已经更换了钥匙。请重新加载后再试。',
  'web.sync.vault.errorRotation': '服务端要求先完成全部加密数据迁移，才能更换这把钥匙。',
  'web.sync.saveAndSync': '保存并同步',
  // 状态文案原先由 `features/sync/store.ts` 的 `describeStatus` 返回中文。
  // 句子现在搬到 SyncBar 里拼（state 只带数据），否则英文界面永远显示中文。
  'web.sync.status.idle': '未同步',
  'web.sync.status.uploading': '正在上传…',
  'web.sync.status.downloading': '正在下载…',
  'web.sync.status.synced': '已同步',
  'web.sync.status.offline': '离线 · 改动已排队，联网后自动重试',
  'web.sync.status.conflict': '{count} 处改动需要你确认',
  // 同 `mobile.common.badge.countOne`：中文无单复数，刻意与复数版逐字相同。
  'web.sync.status.conflictOne': '{count} 处改动需要你确认',
  'web.sync.status.errorRetryable': '同步出错：{message}',
  // ── 认证 ──
  // 服务端早就有完整认证，此前没有任何客户端调用它：用户只能在同步设置里
  // 手填令牌，而没人告诉他令牌从哪来。这一组就是那个缺失的入口。
  // ⚠️ 电子邮件地址的**格式校验在服务端**（唯一事实源），这里的占位符只示范形状。
  'web.auth.title': '登录 / 注册',
  'web.auth.close': '关闭',
  'web.auth.open': '登录 / 注册',
  // 同步设置里令牌字段下面的指路句 —— 它回答的正是"令牌从哪来"。
  'web.auth.tokenHint': '访问令牌由服务端签发。点上面的按钮登录或注册，令牌会自动填进来；已经有令牌的可以直接粘贴填写。',
  /*
    🔴 这两句在 2026-10-02 被产品负责人判过一次：
    「为什么还是默认就是要什么粘贴服务器地址和令牌之类的东西？……
    这不是把那些普通用户给拒之门外了吗？」
    原话是「还没有凭据」+「同步需要服务端签发的访问令牌。用邮箱注册或登录即可获得…」。
    那两句话**没有一句是错的**，但它们把**实现细节当成了对用户的目标**：
    用户要的是"把任务记下来、换个设备还在"，"访问令牌"是他不需要理解的中间产物。
    一个刚打开应用的访客在第一屏读到"凭据""服务端签发""令牌"，
    得到的判断是"这不是给我用的"。
    ⇒ 现在说的是他要做的事和会发生的事，"令牌"这个词从第一屏消失。
      （它仍然留在同步设置里 —— 那里它是对的东西，见 `web.auth.tokenHint`。）
  */
  'web.auth.empty.title': '用邮箱注册或登录',
  'web.auth.empty.body': '下一步会让你设置密码。还没有账号就填一个密码注册，已有账号就输密码登录 —— 数据先记在这台设备上，登录后自动接上同步。',
  // Web 认证弹窗的轻量计划主题。它描述流程，不伪造任务、进度或成就。
  'web.auth.plan.title': '开始自己的自律计划',
  'web.auth.plan.kicker': '我的计划',
  'web.auth.plan.lead': '从一件小事开始，让每一天有自己的节奏。',
  'web.auth.plan.previewTitle': '今日计划',
  'web.auth.plan.previewFirst': '读几页喜欢的书',
  'web.auth.plan.previewSecond': '专注完成一件小事',
  'web.auth.plan.previewThird': '留一点时间给自己',
  'web.auth.plan.local': '今天开始，按自己的节奏完成一件事。',
  // ── 旅程重构（2026-10-01；2026-10-02 换成共享表单后又收窄了一次）──
  // 🔴 面板原来是六个并列按钮，而且第一个必填项是**服务端地址**（等于把
  // "你知道自己的同步域名吗"当成注册的前置条件）。现在第一屏只问邮箱，
  // 注册与登录是同一个表单的两档，通行密钥与邮件链接降到二级链。
  // ⚠️ 降级只发生在**视觉层级**：那些动作在 DOM 里一个都没少，键盘与屏幕阅读器照样找得到。
  // 原来那三句（「已经有账号了？」「或用通行密钥」「高级」）随折叠分组一起没了 ——
  // 分组不存在，句子就没有指代对象；词表里不留无主文案。
  // 这条是"预填不是让你填"的说明。⚠️ 2026-10-02 起地址栏默认**收起来了**，
  // 所以这句改成交代替址：它现在指的是"下面那个入口"，不是"这个框"。
  'web.auth.server.prefilled': '默认连的是 heyta 官方服务，不用你填地址。自己部署的话，展开下面的「我自己部署」。',
  // 🔴 自建与"已有令牌"两条路各自一个展开入口 —— 它们面向的是**不同的人**，
  // 合成一个开关会让自建用户以为"粘贴令牌"也是自建的必要步骤。
  'web.auth.selfHost.open': '我自己部署（填服务端地址）',
  'web.auth.selfHost.close': '收起服务端地址',
  'web.auth.haveToken.open': '已经有登录链接或令牌？',
  'web.auth.haveToken.close': '收起登录链接 / 令牌',
  'web.auth.advanced.open': '高级选项',
  'web.auth.advanced.close': '收起高级选项',
  // 服务端地址那一栏自己的标签与占位（自建用户要能看清自己在改什么）。
  'web.auth.server.label': '服务端地址',
  'web.auth.server.placeholder': '例如 https://sync.example.com',
  // 透明性：认证动作真的发去哪台服务端，得看得见（尤其自建与官方托管并存时）。
  'web.auth.server.official': 'heyta 官方服务',
  'web.auth.server.custom': '自定义服务端',
  'web.auth.server.address': '地址：{baseUrl}',
  'web.auth.server.at': '这次会连到 {baseUrl}',
  'web.auth.invite.label': '邀请码（选填）',
  'web.auth.invite.placeholder': '好友的邀请码',
  'web.auth.invite.invalid': '邀请码是 {length} 位字母或数字，请检查一下。',
  'web.auth.email.label': '邮箱',
  'web.auth.email.placeholder': '你的邮箱地址',
  'web.auth.sendLoginLink': '发送登录链接',
  'web.auth.register': '发送验证码',
  'web.auth.registrationCode.title': '验证邮箱',
  'web.auth.registrationCode.sent': '验证码已发送到 {email}，输入邮件中的 6 位数字完成注册。',
  'web.auth.registrationCode.label': '邮箱验证码',
  'web.auth.registrationCode.placeholder': '输入 6 位验证码',
  'web.auth.registrationCode.verify': '完成注册',
  'web.auth.registrationCode.resend': '重新发送验证码',
  'web.auth.registrationCode.resendIn': '{seconds} 秒后可重新发送',
  'web.auth.registrationCode.changeEmail': '更改邮箱',
  'web.auth.registrationCode.expired': '验证码已过期，请重新发送。',
  'web.auth.passkey.register': '用通行密钥注册',
  'web.auth.passkey.login': '用通行密钥登录',
  'web.auth.passkey.unavailable': '这个浏览器或设备不支持通行密钥，用上面的邮箱方式即可。',
  'web.auth.passkey.waiting': '请在系统弹窗里完成通行密钥操作…',
  'web.auth.recovery.request': '丢失了通行密钥？发一封找回链接',
  'web.auth.terms.label': '我同意服务条款与隐私政策，并允许本机联网',
  // ⚠️ 「或者」去掉了：这一栏现在住在自己的展开区里，前面没有并列项，
  // "或者"指向的是上一版把它放在表单末尾当兜底的形态。
  'web.auth.paste.label': '粘贴登录链接 / 令牌',
  'web.auth.paste.placeholder': '粘贴邮件里的链接，或那串令牌本身',
  'web.auth.verify': '完成登录',
  // 🔴 这两句在 2026-10-01 跟着**机制**改过：邮件里那条链接点开后是**直接回到应用并且已经登录**
  // （服务端 `/verify-email` → 确认页 → `/app/#sessionToken=…`，ADR-0039 §2.2）。
  // 原话"验证完成后回到这里登录"教的是一条已经不存在的路 —— 而它正是用户抱怨的
  // "还得回来把令牌粘一遍"。粘贴只作为**兜底**留在「高级」里。
  // ⚠️ 两句仍不许断言"邮箱存在"或"账号已创建"（服务端用中性文案防邮箱枚举）。
  'web.auth.sent.login': '如果这个邮箱有账号，登录链接已经发出。点开邮件里那条链接就会回到应用并登录好；邮件不在手边时，可以把链接粘贴到下面「高级」里。',
  'web.auth.sent.register': '注册申请已提交。去邮箱点开那条验证链接 —— 点完回到这里，就已经登录好了。',
  // 🔴 这一句只在服务端**亲口说**"信没发出去"时才出现（`emailDelivered: false`）。
  // 它必须给出下一步，而不是"请稍后再试"：一台没配 SMTP 的服务器重试一万次
  // 也发不出那封信。两个出口都是真的：配 SMTP，或自托管显式关掉这一步。
  'web.auth.sent.mailNotSent': '这台服务器没能把验证邮件发出去（多半是没配邮件服务）。账号已经建好，但还没有激活：请让服务器管理员配好 SMTP 后重新提交一次注册；这台服务器只给自己人用时，也可以设 REQUIRE_EMAIL_VERIFICATION=false 跳过这一步。',
  'web.auth.sent.recovery': '如果这个邮箱有账号，找回通行密钥的链接已经发出。点开邮件里的链接即可为这个账号注册一个新通行密钥（会替换掉旧的）。',
  'web.auth.signedIn.title': '已登录',
  'web.auth.signedIn.body': '令牌已写入同步设置（{email}）。填好端到端加密口令后即可同步。',
  'common.auth.error.unconfigured': '先在上面填好服务端地址。',
  'common.auth.error.invalidInput': '这个邮箱地址或令牌看起来不对，检查后重试。',
  'common.auth.error.notAllowed': '这个服务端不允许用该邮箱注册。',
  'common.auth.error.unauthorized': '链接无效或已过期，请重新发送一封。',
  'common.auth.error.rateLimited': '请求太频繁了，请过一会儿再试。',
  'common.auth.error.network': '连不上服务端，检查地址与网络后重试。',
  // 🔴 这句**不许**与上面那条共用：请求从未离开这台设备，"检查网络"是把一个隐私
  // 决定伪装成线路故障 —— 用户会去重连 WiFi，而那永远做不对。
  'common.auth.error.consentRequired': '还没有同意隐私规则，这次操作没有发出任何数据。请先在弹出的面板里作出选择。',
  'common.auth.error.server': '服务端暂时不可用，请稍后重试。',
  'common.auth.error.unknown': '登录没有完成，请重试。',
  // ── 邮箱 + 登录密码这条路（ADR-0040）：失败句子 ──
  // 🔴 下面每一条都对应一个**动作**，不是同一种失败的四种说法。
  'common.auth.error.invalidCredentials': '登录失败：邮箱或密码不正确。',
  'common.auth.error.emailNotVerified': '密码是对的，只差最后一步：打开我们发到你邮箱的验证链接。',
  'common.auth.error.passwordLocked': '密码登录被临时锁住了（账号本身没有被锁）。可以先用邮箱登录链接或通行密钥进来。',
  'common.auth.error.passwordLockedWithWait': '密码登录被临时锁住了（账号本身没有被锁）。可以先用邮箱登录链接或通行密钥进来，或者等 {seconds} 秒后再试密码。',
  'common.auth.error.passwordBackendBusy': '服务器这会儿正忙，这一次没能验证。你写的内容还在，过几秒再试一次。',
  'common.auth.error.invalidResetLink': '这个重置链接已经用过或过期了。回到登录那一步重新申请一封。',
  'common.auth.error.noPasswordSet': '这个账号还没有登录密码（也许一直用通行密钥或邮件链接登录）。就在这里设一个：设好之后也能用邮箱和密码登录。',
  'common.auth.error.passwordAlreadySet': '这个账号已经有登录密码了，所以不能再设一个。要换密码请走「修改密码」，那里会先验一次当前密码。',
  'common.auth.error.passwordPolicy': '这个密码不符合要求，请按下面的提示改一下。',
  'common.auth.error.requestRejected': '这个请求没有被接受，请检查一下填写的内容。',
  'common.auth.error.passkeyNameTooLong': '名字最多 {max} 个字，请短一些。',
  // 四种拒绝 = 四种动作。只说"不符合要求"而不给动作，等于没说。
  'common.auth.policy.tooShort': '密码至少要 {min} 个字符。长一句比加符号有用。',
  'common.auth.policy.tooLong': '密码最多 {max} 个字符，请短一些。',
  'common.auth.policy.tooCommon': '这是最常见的那批密码之一，换一句更长、更属于你自己的。',
  'common.auth.policy.breached': '这句出现在已泄露的密码库里（别的网站泄出来的）。请换一句没有用过的。',
  // 🔴 两个秘密各有各的名字 —— 绝不共用一个"密码"字样（理由见 ADR-0040 §D1）。
  'common.auth.signInPassword.label': '登录密码',
  'common.auth.e2eePassphrase.label': '加密口令',
  // 表单的两步与 autofill（一个邮箱框 +「继续」，密码紧随其后）
  'common.auth.form.continue': '继续',
  'common.auth.form.accountSummary': '登录到：{email}',
  'common.auth.form.changeEmail': '改邮箱',
  'common.auth.form.signIn': '登录',
  'common.auth.form.showPassword': '显示密码',
  'common.auth.form.hidePassword': '隐藏密码',
  'common.auth.form.forgotPassword': '忘记密码？',
  'common.auth.form.passwordHint': '长一句比加符号有用 —— 我们只看长度，以及它有没有出现在泄露库里。',
  'common.auth.form.confirmPassword': '再次输入密码',
  'common.auth.form.passwordConfirmationRequired': '请再次输入密码。',
  'common.auth.form.passwordMismatch': '两次输入的密码不一致。',
  'common.auth.form.passwordStrength.tooShort': '当前 {current} 个字符，至少需要 {min} 个。',
  'common.auth.form.passwordStrength.tooLong': '当前 {current} 个字符，超过上限 {max} 个，请换短一些。',
  'common.auth.form.passwordStrength.weak': '密码强度较弱，建议换一句更长的表达。',
  'common.auth.form.passwordStrength.fair': '密码强度一般，再加长一些会更稳妥。',
  'common.auth.form.passwordStrength.strong': '密码强度较强。',
  'common.auth.form.switchToRegister': '还没有这个邮箱的账号？创建一个',
  'common.auth.form.switchToSignIn': '已经有账号了？直接登录',
  'common.auth.form.otherWays': '或者用别的方式',
  'common.auth.form.otherWaysOpen': '其他登录方式',
  'common.auth.form.otherWaysClose': '收起其他登录方式',
  'common.auth.sent.reset': '如果我们认得这个邮箱，重置密码的链接已经发过去了。',
  // 🔴 **每个动作各有一句"正在…"**，不是一句通用的"正在处理"：
  // 用户停在表单前最想知道的就是"这一步到底在做什么"，而口令登录要验证 Argon2id、
  // 可能要等一两秒 —— 一句与动作无关的话会让人以为界面坏了，于是去点第二次。
  // （重复提交在口令这条路上有真实代价：它会计进失败次数。）
  'common.auth.busy.signIn': '正在验证密码…',
  'common.auth.busy.register': '正在创建账号…',
  'common.auth.busy.forgot': '正在发送重置邮件…',
  'common.auth.busy.link': '正在发送登录链接…',
  'common.auth.busy.recovery': '正在发送找回链接…',
  'common.auth.busy.verify': '正在确认这条链接…',
  'common.auth.busy.change': '正在修改密码…（其余设备需要重新认证）',
  // 本地校验的两句话（提交时才算，不逐键算 —— 逐键报错是最劝退的表单形态）。
  'common.auth.form.emailRequired': '要先填邮箱地址。',
  'common.auth.form.passwordRequired': '还没有填密码。',
  // 🔴 这句不许复用 `common.auth.error.unconfigured`（那句写的是"先在上面填好"）：
  // 服务端地址这一栏现在在表单**最后一栏**，指向上面是在把人往错的地方领。
  'common.auth.form.serverUrlRequired': '还没有填服务端地址。',
  'common.subtask.reject.taskNotFound': '找不到这个任务（可能已在别的设备上删除）。',
  'common.subtask.reject.parentNotFound': '找不到要移入的那个任务（可能已在别的设备上删除）。',
  'common.subtask.reject.self': '不能把任务移到它自己下面。',
  'common.subtask.reject.cycle': '不能移到它自己的子任务下面——那会形成一个环。',
  'common.subtask.reject.depthExceeded': '子任务最多三层。移过去会让这段层级超过上限。',
  'common.subtask.reject.childrenExceeded': '这个任务的子任务已经到上限了，先整理一些再移。',
  'common.subtask.reject.unknown': '没能移过去，请重试。',
  // 🔴 这三条是**专注记录写入校验**失败时的句子，两个壳共用（`packages/ui`
  //    的 `focusLogFailureMessageKey` 按码查这里）。以前这三处直接把中文
  //    异常消息插进「保存失败：{reason}」，英文界面就会露出半句中文。
  'common.focus.error.unknownKind': '这条专注记录没有记下来：它的类型不认识。',
  'common.focus.error.nonPositivePlanned': '这条专注记录没有记下来：计划时长必须大于 0。',
  'common.focus.error.missingCreatedAt': '这条专注记录没有记下来：缺少这条记录的产生时间。',
  'web.subtask.none': '子任务',
  'web.subtask.under': '属于「{title}」',
  'web.subtask.trigger.aria': '把「{title}」移到别的任务下面',
  'web.subtask.pick.label': '移到…',
  'web.subtask.pick.aria': '选一个父任务：{title}',
  'web.subtask.option.topLevel': '（顶级任务）',
  'dev.shellHost.source': 'M2-B：数据来自原生壳（Jint + SQLite），不是种子数据 —— {note}',
  'dev.shellHost.waiting': '等宿主推数据…',
  'dev.shellHost.received': '已收到 {count} 条（原始 {bytes} 字节）',
  'dev.shellHost.noTasksField': '宿主给的没有 tasks 字段',
  'dev.shellHost.tasksNotArray': 'tasks 不是一个数组',
  'dev.shellHost.parseFailed': '宿主数据解析失败',
  'dev.shellHost.noHostChannel': '没有宿主通道（不在 WebView 里），这次点击没有写下去。',
  'common.auth.error.passkeyUnsupported': '这个浏览器或设备不支持通行密钥，改用邮箱登录链接即可。',
  'common.auth.error.passkeyCancelled': '通行密钥操作被取消或超时了，可以重试。',
  'common.auth.error.passkeyAlreadyRegistered': '这台设备上已经有这个账号的通行密钥了，改用「用通行密钥登录」。',
  // 服务端给出 `code: 'passkey_not_found'` 时才用这条：设备上这条旧凭据
  // 服务端已经不认了（多半在别处删过）。它和"验签失败"是**两句不同的话**，
  // 因为用户该做的动作不同：这里是"重新注册 / 换登录方式"。
  'common.auth.error.passkeyNotFound': '这条通行密钥在服务端已经不存在了（可能已在别的设备上删除）。请重新注册一条，或改用邮箱登录链接。',
  // 服务端给出 `code: 'passkey_verification_failed'`：凭据还在，但这次断言
  // 没通过。重试是有意义的，所以句子与上面那条刻意不同。
  'common.auth.error.passkeyRejected': '通行密钥验证没有通过，可以再试一次；一直失败就重新注册一条。',
  'common.auth.error.lastPasskey': '这是账号上最后一条通行密钥，而这个账号还没有能用的登录口令，删掉就再也登不进来了。先添加一条新的通行密钥，或者设一个登录口令（邮箱得先验证过）。',
  // ── Web · 通行密钥自助管理 ─────────────────────────────────
  // 服务端此前只有注册 / 登录 / 恢复，用户没有任何"看我自己的凭据 / 删一条"的入口。
  'web.passkeys.title': '通行密钥',
  'web.passkeys.lead': '这里列出你这个账号在服务端注册的通行密钥。删除一条不会影响其它设备上的凭据。',
  'web.passkeys.add': '添加一条通行密钥',
  'web.passkeys.adding': '正在添加…',
  'web.passkeys.waitingForPrompt': '请在弹出的系统窗口中完成通行密钥的创建。',
  'web.passkeys.added': '已添加这条通行密钥。',
  'web.passkeys.refresh': '刷新列表',
  'web.passkeys.loading': '正在加载…',
  'web.passkeys.needsSignIn': '先登录，才能管理这个账号的通行密钥。',
  'web.passkeys.empty': '这个账号还没有注册通行密钥。',
  'web.passkeys.createdAt': '创建于 {date}',
  'web.passkeys.lastUsedAt': '上次使用 {date}',
  'web.passkeys.neverUsed': '从未使用',
  'web.passkeys.delete': '删除',
  'web.passkeys.confirmDelete': '确认删除',
  'web.passkeys.cancel': '取消',
  'web.passkeys.deleting': '正在删除…',
  'web.passkeys.deleted': '已删除这条通行密钥。',
  'web.passkeys.rename': '改名',
  'web.passkeys.renamePlaceholder': '给这条通行密钥起个名字',
  'web.passkeys.save': '保存',
  'web.passkeys.renamed': '已保存这个名字。',
  'web.passkeys.error.rename': '没能改名，请重试。',
  'web.passkeys.error.nameTooLong': '名字太长了（最多 {max} 个字）。',
  'web.passkeys.error.load': '没能加载通行密钥列表。',
  'web.passkeys.error.passkeyNotFound': '这条通行密钥已经不在服务器上了，列表已刷新。',
  'web.passkeys.error.lastPasskey': '这是账号上最后一条通行密钥，而删掉它就没有任何登录方式了，所以不能删除。先添加一条新的，或者去设置页设一个登录密码，再删这条。',
  'web.passkeys.error.unauthorized': '登录状态已失效，请重新登录。',
  'web.passkeys.error.network': '连不上服务端，请稍后重试。',
  // ── 注销账号（批次 E3）────────────────────────────────────────
  // 🔴 失败那几句必须**同时**说"账号还在"和"本机没动"。这条路的下游是不可逆删除：
  // 用户如果在一次 5xx 之后以为"已经注销了"，他会接着做下一步（比如把设备转卖），
  // 而那一步此时是不安全的。
  // 成功那句也划清作用域：这次动作只覆盖服务端 + **这台设备**，
  // 备份与其它设备有各自的边界（ADR-0048 的分层实话，不写"彻底销毁"）。
  'common.accountClosure.title': '注销账号',
  'common.accountClosure.lead': '注销会永久删除这个账号在服务端的全部数据（同步历史与设备记录），而且不可撤销。',
  'common.accountClosure.exportHint': '如果还想留着这些数据，先去「导出数据」存一份备份再回来。注销之后服务端就再也读不出来了。',
  'common.accountClosure.confirmLocal': '我确认：这台设备上还没同步出去的数据，连同本机明文存储，也会一起被清除。',
  'common.accountClosure.action': '注销这个账号',
  'common.accountClosure.busy': '正在注销…',
  // 🔴 `{count}` 是**现量**，不是修辞：这一句的存在理由就是把"这台设备上还有多少
  // 东西没出去"变成一个具体的数，让用户在按下去之前看得见它。写成"可能有未同步数据"
  // 等于没说。
  'common.accountClosure.pending': '这台设备上还有 {count} 条改动没同步出去。注销会把它们一起清掉 —— 云端没有它们，之后也拿不回来。',
  'common.accountClosure.cancel': '先不注销',
  'common.accountClosure.confirmTitle': '确认注销这个账号？',
  'common.accountClosure.entryHint': '删除云端账号，并清除这台设备上的数据',
  'common.accountClosure.needLogin': '这台设备还没有登录，也没有可注销的账号。',
  'common.accountClosure.done.erased': '账号已注销，这台设备上的本地副本也已清除。备份和你其它设备上的数据不在这次操作的范围里。',
  'common.accountClosure.done.partial': '账号已注销，但这台设备上的本地数据只清掉了一部分，剩下的需要你手动处理。',
  'common.accountClosure.done.eraseFailed': '账号已注销，但这台设备上的本地数据没能清干净，需要你手动处理。',
  'common.accountClosure.failed.unconfigured': '还没有配置服务端地址，所以一个请求都没发 —— 账号还在，本机数据也没动。',
  'common.accountClosure.failed.consentRequired': '你还没有同意这台设备的隐私规则，所以一个请求都没发 —— 账号还在，本机数据也没动。',
  'common.accountClosure.failed.unauthorized': '登录状态已经失效，所以没有执行注销 —— 账号还在，本机数据也没动。请重新登录再来一次。',
  'common.accountClosure.failed.rateLimited': '注销请求太频繁，暂时被拒绝了。账号还在，本机数据也没动，请过一会儿再试。',
  'common.accountClosure.failed.serverError': '服务端没有完成注销。账号还在，本机数据也没动，请稍后重试。',
  'common.accountClosure.failed.network': '连不上服务端，所以没有执行注销。账号还在，本机数据也没动。',
  'common.accountClosure.failed.malformedResponse': '服务端回的内容我们认不出来，所以不算注销成功。账号可能还在 —— 确认之后再重试一次。本机数据也没动。',
  'common.accountClosure.failed.other': '注销没有完成。账号还在，本机数据也没动。',

  // ── 设置页「修改登录密码」：两个秘密的界线在这里划一次 ──────────────
  //
  // 🔴 这批句子唯一的职责是把两件事**分开**：这里的密码只回答"谁能登录这个账号"，
  // 而"能不能解开数据"是另一样东西（加密口令）。改这里既不碰它，也救不了它 ——
  // 依据 ADR-0040 §3.2 D1：登录口令点一封邮件就能重置，加密口令**不可恢复**。
  // 只写一句"修改密码"而不划这条界，会让人以为忘了加密口令也能在这儿找回来。
  //
  // ⚠️ 句子里不出现"8"：`{min}` 由调用处从 `AUTH_PASSWORD_MIN_CODE_POINTS` 传入
  //（唯一真源在 `@heyta/shared-schema`）。把上限写进词条就是第二套取值。
  'web.settings.password.title': '登录密码',
  'web.settings.password.lead': '这里改的只是登录这个账号用的密码。你的加密口令是另一样东西：不在这里改，这个密码也代替不了它解开数据。',
  'web.settings.password.current': '当前密码',
  'web.settings.password.new': '新密码',
  'web.settings.password.minLength': '至少 {min} 个字符。',
  'web.settings.password.submit': '修改密码',
  'web.settings.password.changed': '登录密码已修改。',
  'web.settings.password.otherDevices': '其它设备上的登录都会失效，要用新密码重新登录；数据不受影响。这个标签页会自动接着用新密码。',
  'web.settings.password.needsSignIn': '先登录，才能修改这个账号的登录密码。',
  'web.settings.password.resetTo': '重置链接会发到 {email}。',
  'web.settings.password.noPassword': '这个账号还没有登录密码。在下面设一个：设好之后也可以用邮箱和密码登录，通行密钥和邮件链接照旧能用。',
  // ── "设第一个密码"这一张表（与上面「修改密码」是两条路，措辞必须不同）────
  //
  // 🔴 不复用 `lead` / `submit` / `changed`：那三句说的都是"改"，而这里没有旧密码
  // 被换掉 —— 界面把"加一个认证器"说成"改密码"，用户就会去找那个并不存在的
  // "当前密码"框，或者以为别处的登录会被踢掉（这条恰恰不会）。
  'web.settings.password.setLead': '这个账号现在靠通行密钥或邮件链接登录。设一个登录密码，就多一条路 —— 你的加密口令是另一样东西：不在这里改，这个密码也代替不了它解开数据。',
  'web.settings.password.setField': '登录密码',
  'web.settings.password.setSubmit': '设置登录密码',
  'web.settings.password.setBusy': '正在设置登录密码…',
  'web.settings.password.setDone': '登录密码已设置。',
  'web.settings.password.setConsequence': '这不会影响其它设备：加一个密码不会把任何地方踢下线，这个标签页也不用重新登录。',
  // 服务端在这条路上回 `email_not_verified`。通用那句（"密码是对的，只差最后一步"）
  // 在这里是假的 —— 这一次没有任何密码被验过，所以这里给一句说得通的。
  'web.settings.password.setNeedsVerified': '这个邮箱还没有验证，所以密码先设不上（设了也登不进）。先去点那封验证邮件里的链接，再回来设。',
  // 两张表互指的入口：界面**不知道**这个账号有没有口令（服务端不许界面猜），
  // 所以这两句都是向用户提问，不是断言。
  'web.settings.password.switchToSet': '从来没设过登录密码？在这里设一个。',
  'web.settings.password.switchToChange': '这个密码已经设过了？去改密码。',

  // ── 应用内的小组件旅程（把卡片加到桌面）──────────────────────────
  'mobile.widgetJourney.sectionTitle': '桌面小组件',
  'mobile.widgetJourney.card.today': '今日任务',
  'mobile.widgetJourney.card.quadrant': '四象限',
  'mobile.widgetJourney.card.habits': '今日习惯',
  'mobile.widgetJourney.card.focus': '今日专注',
  'mobile.widgetJourney.intro': '今日任务、四象限、习惯、专注 —— 四张卡片可以把它们放在桌面上。',
  'mobile.widgetJourney.howTo': '如何添加',
  'mobile.widgetJourney.openOnce': '添加后如果卡片显示「打开 Heyta 以显示小组件」，打开一次 Heyta 就会填充内容。',
  'mobile.widgetJourney.cannotAutoAdd': '系统不允许应用替你把小组件放上桌面，所以只能按下面的步骤自己加一次。',
  'mobile.widgetJourney.ios.step1': '长按桌面空白处，直到图标开始抖动',
  'mobile.widgetJourney.ios.step2': '点左上角的「+」',
  'mobile.widgetJourney.ios.step3': '搜索「Heyta」，选一种尺寸',
  'mobile.widgetJourney.ios.step4': '点「添加小组件」',
  'mobile.widgetJourney.android.step1': '长按桌面空白处',
  'mobile.widgetJourney.android.step2': '选「小部件」（部分机型叫「微件」）',
  'mobile.widgetJourney.android.step3': '找到 Heyta，长按并拖到桌面上',
  'mobile.widgetJourney.other.step1': '长按桌面空白处，从小组件列表里找到 Heyta',
  'mobile.widgetJourney.other.step2': '把它拖到桌面上',
  'mobile.widgetJourney.privacyTitle': '锁屏时不显示任务标题',
  'mobile.widgetJourney.privacyHint': '开启后，锁屏与锁屏相关的小组件只显示任务数量，不显示标题。',
  'mobile.widgetJourney.privacyFailed': '没能保存这个设置，请重试。',

  // PWA 安装面板里那一句（manifest 的 `description`）。
  // 🔴 manifest 是**构建期单语言产物** —— 打包时按 `DEFAULT_LOCALE` 渲染一次，
  //    运行时没有换语言的通道（浏览器只在安装时读它）。所以这里的值只能是默认语言，
  //    但**必须来自词条表**，不许在生成脚本里再抄一份中文。
  'web.pwa.description': '本地优先、端到端加密的待办与习惯应用',

  // ── 小组件卡片上的文案（iOS / Android / Windows 三端同一份）──────────
  // 🔴 这一组是**卡片内容**，不是"怎么装小组件"的说明（那是上面两组）。
  //    Windows 的 Adaptive Card 模板是**静态文件**，宿主自己去取，不经过我们的 JS
  //    —— 所以模板里不许有一个字的文案，全部由数据绑定（`${titleText}`…）。
  //    判据在 `packages/widget-core/tests/adaptive-card.spec.ts`："模板里不许出现汉字"。
  'widget.placeholder.openApp': '打开 Heyta 以显示小组件',
  'widget.preview.more': '另有 {count} 项',
  'widget.task.pending': '待办',
  'widget.task.completed': '完成',
  'widget.task.completeAction': '完成任务：{title}',
  'widget.task.reopenAction': '重新打开任务：{title}',
  'widget.today.title': '今日任务',
  'widget.today.count': '{count} 项',
  'widget.today.empty': '今天没有任务',
  'widget.quadrant.title': '四象限',
  'widget.quadrant.slotHeading': '{label}（{count} 项）',
  'widget.quadrant.hint1': '立即做',
  'widget.quadrant.hint2': '计划做',
  'widget.quadrant.hint3': '委托或快速处理',
  'widget.quadrant.hint4': '减少或删除',
  'widget.habits.title': '习惯',
  'widget.habits.empty': '还没有习惯',
  'widget.habits.doneToday': '今天已完成',
  'widget.focus.title': '专注',
  'widget.focus.stale': '数据已过期，打开 Heyta 刷新',
  'widget.focus.idle': '没有进行中的专注',
  'widget.focus.target': '目标 {duration}',
  'widget.focus.minutes': '{minutes} 分钟',
  // 小组件在系统面板/安装列表里露出的那一句（manifest 的 `description`）。
  'widget.card.desc.today': '今天要做的事，点一下就能完成',
  'widget.card.desc.quadrant': '按重要与紧急分组的任务',
  'widget.card.desc.habits': '今天的习惯与连续天数',
  'widget.card.desc.focus': '正在进行的专注会话',

  // ── Windows 小组件的后台刷新（Web Push）────────────────────────────
  // ⚠️ 这些词条只在**能力真的可用**时才会被画出来（`probeWidgetPush`）。
  //    http:// 上、没配 VAPID 的自托管实例上，整个面板都不画 ——
  //    一个点了必然失败的开关比没有开关更糟。
  'web.widgetPush.title': '小组件后台刷新',

  // ── Web/Windows 的小组件旅程（先装成应用，卡片才会出现在面板里）──────
  'web.widgetJourney.intro.nativeAvailable': '把今日任务、四象限、习惯与专注放进系统小组件。',
  'web.widgetJourney.note.nativeAvailable': '从系统的小组件列表中添加 Heyta。添加后打开一次应用，即可刷新本机数据。',
  'web.widgetJourney.native.macos.step1': '右键点按桌面空白处，选择「编辑小组件」；也可以在通知中心底部编辑小组件。',
  'web.widgetJourney.native.windows.step1': '按 Win+W 打开小组件面板，进入添加小组件。',
  'web.widgetJourney.native.choose': '搜索 Heyta，选择需要的卡片与尺寸后添加。',
  'web.widgetJourney.sectionTitle': '桌面小组件',
  'web.widgetJourney.intro': '在 Windows 上通过 Edge 安装网页版后，可在系统小组件面板中检查是否支持添加 heyta。',
  'web.widgetJourney.intro.native': '查看此桌面应用的小组件支持情况。',
  'web.widgetJourney.intro.unsupported': '在桌面或主屏幕快速查看任务与进度。',
  'web.widgetJourney.status.native': '正在原生桌面应用中运行',
  'web.widgetJourney.status.standalone': '已作为应用运行',
  'web.widgetJourney.status.browser': '正在浏览器标签页里运行',
  'web.widgetJourney.howToInstall': '如何装成应用',
  'web.widgetJourney.windows.step1': '在地址栏右侧点「…」或应用图标',
  'web.widgetJourney.windows.step2': '选「应用」→「将此站点作为应用安装」',
  'web.widgetJourney.windows.step3': '装好后，四张卡片会出现在 Windows 的小组件面板里（按 Win+W 打开）',
  'web.widgetJourney.macos.step1': '在地址栏右侧点「安装 heyta」图标',
  'web.widgetJourney.macos.step2': '装好后从「应用程序」里打开它',
  'web.widgetJourney.other.step1': '在浏览器菜单里找「安装应用」或「添加到主屏幕」',
  'web.widgetJourney.other.step2': '装好后从应用列表里打开它',
  'web.widgetJourney.note.widgetSource': '卡片只来自已安装的应用 —— 一个没安装的网页不会出现在小组件面板里。',
  'web.widgetJourney.note.nativeShell': '当前桌面应用暂不支持系统小组件。你仍可在应用内查看任务、习惯与专注进度。',
  'web.widgetJourney.note.unsupportedPlatform': '浏览器页面不能直接添加系统小组件。请安装对应平台的 heyta 客户端，再从系统小组件列表添加。',
  'web.widgetPush.description': '开启后，任务在别的设备上发生变化时，Windows 上 pin 的 heyta 小组件会自动更新；关闭时只有打开 Heyta 才会刷新。',
  'web.widgetPush.rowLabel': '允许后台刷新小组件',
  'web.widgetPush.status.subscribed': '已开启',
  'web.widgetPush.status.off': '未开启',
  'web.widgetPush.status.working': '处理中…',
  'web.widgetPush.status.denied': '浏览器已拒绝通知权限。请到浏览器的网站设置里允许通知后重试。',
  'web.widgetPush.status.disabled': '这台服务器没有配置 Web Push，小组件只会在打开 Heyta 时刷新。',
  'web.widgetPush.status.failed': '开启失败：{reason}',
  'web.widgetPush.status.failedOff': '关闭失败：{reason}',
  // 🔴 下面这组是**原因码**，不是"开启失败"后面那半句的拼接素材 ——
  //    `apps/web/src/pwa/push-subscribe.ts` 只产出码，句子住在这里。
  //    新增一个码必须同时补两份词条，否则 `PUSH_REASON_MESSAGE_KEY`
  //    那份穷尽 Record 编译不过。
  'web.widgetPush.reason.insecureContext': '当前页面不是安全连接，请用 https 或本机地址打开。',
  'web.widgetPush.reason.noServiceWorker': '这个浏览器不支持后台推送。',
  'web.widgetPush.reason.noNotificationApi': '这个浏览器没有通知能力。',
  'web.widgetPush.reason.permissionDenied': '浏览器已拒绝通知权限。',
  'web.widgetPush.reason.serverNotConfigured': '这台服务器没有开启推送服务。',
  'web.widgetPush.reason.needsLogin': '需要先登录。',
  'web.widgetPush.reason.pushKeyHttp': '向服务器索取推送凭据失败（服务器返回 {status}）。',
  'web.widgetPush.reason.pushKeyMalformed': '服务器给的推送凭据格式不对。',
  'web.widgetPush.reason.pushKeyLength': '服务器给的推送凭据长度不对（应为 65 字节，收到 {length}）。',
  'web.widgetPush.reason.noSubscription': '浏览器没有完成订阅。',
  'web.widgetPush.reason.incompleteSubscription': '浏览器返回的订阅信息不完整。',
  'web.widgetPush.reason.registerHttp': '服务器没有收下这条订阅（服务器返回 {status}）。',
  'web.widgetPush.reason.unregisterHttp': '服务器没有注销这条订阅（服务器返回 {status}）。',
  'web.widgetPush.reason.probeHttp': '没能问出这台服务器开没开推送（服务器返回 {status}）。',
  'web.widgetPush.reason.unexpected': '出了没预料到的问题：{detail}',
  'web.widgetPush.note.privacy': '推送内容只有一句“有更新了”，不含你的任何任务内容 —— 服务端没有你的密钥，解密只在这台设备上发生。',
  'web.widgetPush.note.windowsOnly': '这个开关只影响 Windows 上的小组件。手机端的小组件由系统自己按计划刷新。',
  'web.passkeys.error.add': '没能添加这条通行密钥，请重试。',
  'web.passkeys.error.passkeyUnsupported': '这台设备或浏览器不支持通行密钥。',
  'web.passkeys.error.passkeyCancelled': '通行密钥的创建被取消或超时了，可以再试一次。',
  'web.passkeys.error.passkeyAlreadyRegistered': '这台设备上已经有这个账号的通行密钥了。',
  'web.passkeys.error.other': '操作没有完成，请重试。',
  // ── Web · 冲突解决界面 ────────────────────────────────────
  // 载荷摘要：`text` 是用户自己的字（不翻译），`fields` 只报数量 ——
  // 字段名（completedAt 那种）是内部标识符，不能出现在用户可见文案里。
  // 判断在 `@heyta/sync-client` 的 `summarizeConflictPayload`，这里只管措辞。
  'web.conflict.payload.empty': '（空）',
  'web.conflict.payload.fields': '{count} 个字段有改动',
  // 中文无单复数，刻意与复数版逐字相同（en 侧才会不同）。
  'web.conflict.payload.fieldsOne': '{count} 个字段有改动',
  'web.conflict.title': '这 {count} 处改动两边都改过',
  // 中文无单复数，刻意与复数版逐字相同（en 侧才会不同）。
  'web.conflict.titleOne': '这 {count} 处改动两边都改过',
  'web.conflict.bodyLead': 'heyta 不会替你决定保留哪一版 —— 自动挑一个会',
  'web.conflict.bodyStrong': '悄悄丢掉',
  'web.conflict.bodyTail': '另一边的改动。每一处都请你看一眼再选。没选的那些会一直留在本地，不会丢。',
  'web.conflict.newer': '较新',
  'web.conflict.remoteUnavailable': '取不到这一侧的版本',
  'web.conflict.keepThis': '保留这一版',
  'web.conflict.side.local': '本机',
  'web.conflict.side.remote': '其他设备',
  'web.conflict.close': '稍后再处理',

  // ── Web · 番茄钟 ──────────────────────────────────────────
  'web.focus.a11y.progress': '进度 {percent}%',
  'web.focus.phase.work': '专注',
  'web.focus.phase.break': '休息',
  'web.focus.a11y.start': '开始专注',
  'web.focus.start': '开始',
  'web.focus.a11y.pause': '暂停专注',
  'web.focus.pause': '暂停',
  // M3 第二刀：主按钮的"暂停 → 继续"映射搬进了 `@heyta/ui` 的共享面板，
  // 所以 web 也需要"继续"这一条（原来 web 的暂停之后只有"开始"，
  // 而那个走的是 `start()`，会把已走过的进度清掉）。
  'web.focus.a11y.resume': '继续专注',
  'web.focus.resume': '继续',
  'web.focus.a11y.stop': '中止专注',
  'web.focus.stop': '中止',
  'web.focus.task.label': '关联任务（可选）',
  'web.focus.task.none': '不关联',
  'web.focus.completedToday': '今日已完成 {count} 个专注',
  // 中文无单复数，刻意与复数版逐字相同（en 侧才会不同）。
  'web.focus.completedTodayOne': '今日已完成 {count} 个专注',
  // 落盘失败时 store 只带 `{ reason }`（底层实现的原始文本，是数据），
  // 句子在这里拼 —— 否则英文界面会漏出一句中文。
  'web.focus.error.saveFailed': '专注记录保存失败：{reason}',
  // 时长设置。**只在 idle 时可改**（进行中改会让本轮的计划时长含义不明），
  // 所以有一条专门的说明解释为什么现在是灰的 —— 灰掉而不解释是最坏的做法。
  'web.focus.config.title': '时长设置',
  'web.focus.config.work': '专注',
  'web.focus.config.shortBreak': '短休息',
  'web.focus.config.longBreak': '长休息',
  'web.focus.config.longBreakEvery': '长休息间隔',
  'web.focus.config.minutes': '{minutes} 分钟',
  'web.focus.config.sessions': '{count} 个专注',
  'web.focus.config.locked': '计时进行中不能改时长 —— 先中止本轮，改完再开始。',
  'web.focus.config.a11y.minutes': '{label}时长，单位分钟',
  'web.focus.config.a11y.sessions': '{label}，单位个数',
  // 工单 W7：专注详情面（四张概览卡 + 专注记录列表）。
  // ⚠️ 卡上的标签**不带数量**，数字单独一格 —— 那样英文不需要为「1 session / 3 sessions」
  // 再开一对兄弟词条，而 `web.focus.completedTodayOne` 那种成对词条的存在理由在这里不成立。
  'web.focus.detail.title': '专注概览',
  'web.focus.detail.todayCount': '今日番茄',
  'web.focus.detail.todayDuration': '今日专注时长',
  'web.focus.detail.totalCount': '总番茄',
  'web.focus.detail.totalDuration': '总专注时长',
  'web.focus.detail.records': '专注记录',
  'web.focus.detail.recordsEmpty': '还没有专注记录。完成一轮就会出现在这里。',
  'web.focus.detail.unlinked': '未关联任务',
  'web.focus.detail.aborted': '中途放弃',

  // ── Web · 习惯 ────────────────────────────────────────────
  'web.habits.addPlaceholder': '新习惯，例如「喝水」',
  'web.habits.goal.aria': '编辑「{name}」的目标',
  'web.habits.goal.summaryAtLeast': '至少 {target}{unit}',
  'web.habits.goal.summaryAtMost': '最多 {target}{unit}',
  'web.habits.goal.summaryExactly': '恰好 {target}{unit}',
  'web.habits.goal.target': '数值',
  'web.habits.goal.unit': '单位',
  'web.habits.goal.unitPlaceholder': '杯 / 页 / 分钟',
  'web.habits.goal.atLeast': '至少',
  'web.habits.goal.atMost': '最多',
  'web.habits.goal.exactly': '恰好',
  'web.habits.goal.defaultUnit': '次',
  'web.habits.goal.invalid': '目标必须是不小于 0 的数字（0 是合法的，表示「一次都不」）。',
  'web.habits.addLabel': '新习惯名称',
  'web.habits.add': '添加习惯',
  'web.habits.add.failed': '习惯添加失败，请检查填写内容后重试。',
  'web.habits.create.title': '添加习惯',
  'web.habits.create.close': '关闭添加习惯',
  'web.habits.create.cancel': '取消',
  'web.habits.create.submit': '添加习惯',
  'web.habits.menu.label': '习惯操作',
  'web.habits.export.action': '导出打卡记录',
  'web.habits.export.date': '日期',
  'web.habits.export.habit': '习惯',
  'web.habits.export.value': '数值',
  'web.habits.export.unit': '单位',
  'web.habits.export.completed': '完成状态',
  'web.habits.export.completedValue': '已完成',
  'web.habits.export.incompleteValue': '未完成',
  'web.habits.export.note': '记录',
  'web.habits.backfill.invalid': '可补打卡天数必须是 1 或更大的整数。',
  'web.habits.freq.weeklyRequired': '至少选择一个星期几。',
  'web.habits.empty.title': '还没有习惯',
  'web.habits.empty.hint': '添加一个习惯，从今天开始记录。',
  'web.habits.empty': '还没有习惯。添加一个开始打卡。',
  'web.habits.streak.current': '连续 {count} 天',
  // 中文无单复数，刻意与复数版逐字相同（en 侧才会不同）。
  'web.habits.streak.currentOne': '连续 {count} 天',
  'web.habits.streak.longest': '最长 {count} 天',
  // 同上：连续天数为 1 时英文要用单数，中文两句刻意相同。
  'web.habits.streak.longestOne': '最长 {count} 天',
  'web.habits.a11y.checkIn': '为「{name}」打卡',
  'web.habits.a11y.undo': '撤销「{name}」今日打卡',
  'web.habits.checkedIn': '已打卡',
  'web.habits.checkIn': '打卡',
  // 冻结与续接：**先给数字，再给按钮** —— 说的是"补上之后你会得到什么"。
  'web.habits.freeze': '这段连续里有 {count} 天是冻结保住的',
  'web.habits.repair': '{date} 那天漏了。现在补上，就是连续 {count} 天。',
  'web.habits.repairAction': '补上',
  'web.habits.a11y.repair': '把 {date} 的「{name}」补上',
  // 新鲜开始：**不出现"你已经落后了"** —— 只陈述"过去的没有被清掉"。
  'web.habits.freshStart': '已经 {days} 天没打卡了。最长 {longest} 天、累计 {total} 天都还在，重新开始不会清掉它们。',
  'web.habits.freshStartAction': '今天重新开始',
  'web.habits.a11y.freshStart': '今天为「{name}」重新打卡',
  // 三个指标里的第三个：**只增不减**的那个（累计）。
  // 中文无单复数，两句刻意逐字相同（en 侧才会不同）。
  'web.habits.streak.total': '累计 {count} 天',
  'web.habits.streak.totalOne': '累计 {count} 天',
  // ── 工单 W8：习惯统计的读侧（本月四格）。口径全在
  //   `@heyta/domain#computeHabitPeriodStats`，这些句子只是它的投影：
  //   「打卡」量的是**天**（不是次），完成率的分母是**已到期计划日**
  //   （分母为 0 时没有率可言 ⇒ 界面上是占位句，不是 0%）。
  //   ⚠️ 英文侧刻意用"名词在前、数字在后"的形状（`Check-in days…: {count}`），
  //   与 `catalog.spec.ts` 的 `1 <复数名词>` HAZARD 同族 —— 词条表没有 ICU，
  //   这些句子必须对 1 和 N 都成立，不配 `…One` 兄弟键。
  'web.habits.stats.monthDays': '本月打卡 {count} 天',
  // 🔴 率那一格必须自己说清"按天"：计数型习惯同屏会出现「完成率 0%」与「完成量 3 杯」
  //   （目标 8 杯、今天 3 杯 ⇒ 今天不算达成），两个数都对、读起来自相矛盾（工单 §8.121 看图照出，
  //   #39 的拍板：在率格里点明口径，而不是改算式或藏掉其中一个）。
  'web.habits.stats.monthRate': '本月完成率（按天） {percent}%',
  'web.habits.stats.monthRatePending': '本月完成率（按天） —',
  'web.habits.stats.monthValue': '本月完成量 {value}',
  'web.habits.stats.monthValueUnit': '本月完成量 {value} {unit}',
  'web.habits.stats.totalValue': '总完成量 {value}',
  'web.habits.stats.totalValueUnit': '总完成量 {value} {unit}',
  // 热力图文案由**我们**传给 react-activity-calendar —— 它的默认文案是英文，
  // 而 `{{count}}` 是**库自己的**占位符，必须原样留着（不是我们的 `{name}` 形状）。
  // ── M3 第七刀（habits）：共享热力图的两条文案 ──────────────
  // 🔴 上面那条是**库的形状**（`{{count}}` 是 react-activity-calendar 自己的
  // 占位符），所以自绘热力图**不能复用它** —— 复用会渲染出字面的 `{5}`
  // （我们的插值器只认单层 `{count}`，两层会剩下外层钩）。下面两条是我们自己的形状。
  'web.habits.heatmap.a11y': '「{name}」最近 {days} 天共 {count} 次打卡',
  'web.habits.heatmap.cell': '{date}：{count} 次',

  // ── Web · 习惯的图标词表（列表行首 + 选择器）────────────────
  // 🔴 存的是 `drop` / `moon` 这类**闭集 key**，界面上的字形由 `apps/web` 映射到 Lucide。
  //    这八个词**没有一个是负面活动**（烟/酒/熬夜/刷手机都不在）—— 图标不像颜色，
  //    它会把这一格**点名**，所以词表本身就是那条「App 永不判断活动健康/不健康」红线的边界。
  'web.habits.backfill.label': '补打卡范围',
  'web.habits.backfill.placeholder': '可补打的天数',
  'web.habits.backfill.default': '默认 1 天',
  'web.habits.create.options': '更多设置',
  'web.habits.create.options.hide': '收起设置',
  'web.habits.icon.heart': '爱心',
  'web.habits.icon.strength': '力量',
  'web.habits.icon.meditation': '冥想',
  'web.habits.icon.tea': '茶饮',
  'web.habits.icon.fruit': '水果',
  'web.habits.icon.cycling': '骑行',
  'web.habits.icon.camera': '摄影',
  'web.habits.icon.art': '绘画',
  'web.habits.icon.code': '编程',
  'web.habits.icon.dental': '口腔护理',
  'web.habits.icon.pet': '宠物',
  'web.habits.icon.savings': '储蓄',
  'web.habits.icon.home': '家务',
  'web.habits.icon.language': '语言',
  'web.habits.icon.journal': '日记',
  'web.habits.icon.walking': '步行',
  'web.habits.icon.drop': '水滴',
  'web.habits.icon.activity': '运动',
  'web.habits.icon.book': '阅读',
  'web.habits.icon.moon': '早睡',
  'web.habits.icon.leaf': '饮食',
  'web.habits.icon.pencil': '书写',
  'web.habits.icon.sun': '晨间',
  'web.habits.icon.music': '音乐',
  'web.habits.icon.toggle': '图标',
  'web.habits.icon.group': '选一个图标',
  // 「默认」不是"没有图标"：不选的时候界面按习惯 id 派生一个稳定的（见 `deriveHabitIcon`）。
  'web.habits.icon.default': '默认',
  'web.habits.icon.a11y': '为「{name}」选图标',
  'web.habits.icon.a11yDefault': '「{name}」用默认图标',

  // ── Web · 习惯的频次（工单 H5）────────────────────────────
  // 🔴 判定侧**一直**是按频次数"计划日"的（`isScheduledOn` → `computeStreak`，
  //    `habit-streak.ts:131/158/227/360`），这一批词条接上的是**写入口**那半米。
  //    键名沿用 `web.habits.*`：移动端复用同一批（与新建 / 图标 / 目标那几处同一条决定 ——
  //    端间同词，不各起一套）。
  // ⚠️ `summary.interval` 里的 `{n}` **只会出现 ≥2**：`interval` 且 `everyNDays === 1`
  //    在写入侧就被归一成 `daily`（`normalizeHabitFrequency`）。这条不是巧合，
  //    英文因此不需要复数变形 —— 把归一拿掉，这里就会读出 "Every 1 days"。
  'web.habits.freq.aria': '「{name}」的频次',
  'web.habits.freq.toggle': '频次',
  'web.habits.freq.daily': '每天一次',
  'web.habits.freq.weekly': '每周挑几天',
  'web.habits.freq.interval': '每隔几天',
  'web.habits.freq.summary.daily': '每天',
  'web.habits.freq.summary.weekly': '每周 {days}',
  'web.habits.freq.summary.interval': '每 {n} 天',
  // 中文没有单复数变化，这一条与上面逐字相同；它存在的理由是**词表形状**：
  // 英文侧要靠 `…One` 兄弟条躲开 "Every 1 days"，调用方按 key 分支，两侧必须同键集。
  'web.habits.freq.summary.intervalOne': '每 {n} 天',
  'web.habits.freq.nDays': '每隔几天做一次',
  'web.habits.freq.invalid': '「每隔几天」的天数要是一个 1 或更大的整数',
  'web.habits.freq.intervalHint': '按日历固定隔 {n} 天排一次，起点不随建立习惯那天挪。',
  'web.habits.freq.default': '回到每天',

  // ── 习惯月历 + 补打卡（工单 H4）───────────────────────────
  // 🔴 六档一句：档位词表是 `@heyta/domain#HabitDayState`，界面只负责把它念出来。
  //    「不可点」也要有句子 —— 只画灰而不说原因，用户读到的是"应用坏了"。
  'web.habits.month.grid': '{name} 在 {month} 的打卡月历',
  'web.habits.month.window': '补打卡可以往回 {n} 天',
  // 🔴 每句**自带 `{date}`**，不设 `{date}，{state}` 那种拼装模板：
  //    那条模板除了一个全角逗号没有汉字，会被 `check:ui-language` 判成"拿别的语言占位"
  //    （它抓的正是"整条只剩标点和占位符"这种假词条 —— 与工单 H5 那条 `separator = 、` 同一道闸）。
  'web.habits.month.logged': '{date} 已打卡',
  'web.habits.month.today': '{date}，今天还没打卡',
  'web.habits.month.backfillable': '{date}，可以补打卡',
  'web.habits.month.notScheduled': '{date}，这天本来不用打卡',
  'web.habits.month.future': '{date}，还没到这天',
  'web.habits.month.tooOld': '{date}，已超过补打卡窗口',
  // 补白格**必须有自己的一句话**：上一月视图里的"今天"是一格尾随补白，
  // 只按状态词表它会说「今天还没打卡」却点不动（= "点了没反应"那一族）。
  'web.habits.month.outOfMonth': '{date}，邻月的日子，不在这个月里',

  // ── 习惯年视图（工单 H7）─────────────────────────────────
  // 年那一档只说"这一月过成什么样"，数全部来自领域层（逐月调用那一份月度裁决）。
  // 🔴 「还没到这个月」与「这个月还没有可算的日」是**两句话**：前者分母为零因为未来，
  //    后者因为这天都不归这条习惯管。合成一句就会把"没做"说成"还没到"。
  'web.habits.year.grid': '{name} 在 {year} 年的打卡年视图',
  'web.habits.year.achieved': '达成 {n} 天',
  'web.habits.year.rate': '完成率 {n}%',
  'web.habits.year.none': '这个月还没有可算的日',
  'web.habits.year.future': '还没到这个月',
  'web.habits.year.card': '{month}：{state}，达成 {achieved} 天',
  'web.habits.year.summary': '全年达成 {achieved} 天，{state}',

  // ── Web · 习惯的「列表 + 窗格」─────────────────────────────
  'web.habits.list.aria': '习惯清单',
  'web.habits.pane.aria': '「{name}」的打卡记录',
  'web.habits.pane.pickOne': '选一条习惯，这里看它的打卡与统计。',
  // 行首的 7 个点：日期本身已经在 `aria-label` 里，这里只说"打没打"。
  'web.habits.week.aria': '最近 7 天',
  'web.habits.week.done': '{date} 已打卡',
  'web.habits.week.missed': '{date} 没打卡',
  // 整行的读法：**三个数字一次说完**，屏幕阅读器不必逐 chip 猜。
  'web.habits.row.aria': '「{name}」连续 {current} 天，最长 {longest} 天，累计 {total} 天',
  'web.habits.row.selectA11y': '查看「{name}」的打卡记录',

  // ── Web · 热力图共用文案（习惯页与成长页）─────────────────
  // 月份与图例同样是画在界面上的字，所以同样要走词条表 ——
  // 英文界面上写着「1月」与「少 / 多」是漏翻，不是"库只能这样"。
  'web.heatmap.month.1': '1月',
  'web.heatmap.month.2': '2月',
  'web.heatmap.month.3': '3月',
  'web.heatmap.month.4': '4月',
  'web.heatmap.month.5': '5月',
  'web.heatmap.month.6': '6月',
  'web.heatmap.month.7': '7月',
  'web.heatmap.month.8': '8月',
  'web.heatmap.month.9': '9月',
  'web.heatmap.month.10': '10月',
  'web.heatmap.month.11': '11月',
  'web.heatmap.month.12': '12月',
  'web.heatmap.less': '少',
  'web.heatmap.more': '多',

  // ── Web · 今日进度（激励体系 L1）──────────────────────────
  'web.progress.aria': '今日进度',
  'web.progress.today': '今天',
  // `done > total` 时说的是"计划外完成" —— 那个负数就是这样被结构性地消掉的。
  'web.progress.hint.unplanned': '计划外完成 {count} 件',
  'web.progress.hint.idle': '今天还没有安排',
  'web.progress.hint.allDone': '计划内都做完了',
  'web.progress.hint.remaining': '还有 {count} 件没做',
  // 进度条的可访问名：`done > total` 时必须说清分母是什么。
  'web.progress.label.noPlan': '今日完成 {count} 件，没有计划内事项',
  'web.progress.label.bonus': '今日完成 {done} 件，计划内 {total} 件，另有 {bonus} 件计划外',
  'web.progress.label.plain': '今日完成 {done} 件，共 {total} 件',
  // 数字在 JSX 里单独成 span（`.tabular-nums`），所以标签与单位分成两条。
  'web.progress.focus': '专注',
  'web.progress.focusUnit': '分钟',
  'web.progress.closed': '今天的都做完了',
  'web.progress.breakdown.habits': '习惯',
  'web.progress.breakdown.tasks': '任务',
  'web.progress.breakdown.bonus': '计划外',

  // ── Web · 成长（激励体系 L3）──────────────────────────────
  'web.growth.week.title': '本周',
  'web.growth.week.range': '{start} 至 {end}',
  'web.growth.week.empty': '这一周还没有记录。从今天的一件小事开始就好。',
  // 三句主标题各自成条：句尾带数字，英文的语序与量词都在句子里。
  'web.growth.headline.checkIns': '这周打卡最多：{count} 次',
  'web.growth.headline.tasksCompleted': '这周完成最多：{count} 件',
  'web.growth.headline.focusMinutes': '这周专注最多：{count} 分钟',
  'web.growth.week.bestDay': '最专注的一天是 {date}，专注了 {minutes} 分钟。',
  'web.growth.stat.previous': '上周 {count}',
  'web.growth.stat.checkIns': '打卡',
  'web.growth.stat.checkIns.unit': '次',
  'web.growth.stat.tasks': '完成任务',
  'web.growth.stat.tasks.unit': '件',
  'web.growth.stat.focus': '专注',
  'web.growth.stat.focus.unit': '分钟',
  'web.growth.year.title': '这一年',
  'web.growth.year.note': '一格是一天。有记录的日子才会亮起来 —— 打卡、完成任务、跑完一轮专注都算。',
  'web.growth.year.heatmap': '最近一年共 {count} 次记录',
  'web.growth.year.scrollHint': '左右滑动查看最近日期。',
  'web.growth.milestones.title': '里程碑',
  'web.growth.milestones.note': '只增不减。中断不会让这些数字变小。',
  'web.growth.milestone.allReached': '{name}的里程碑已全部达成',
  // 可访问名里必须同时有**目标**和**差距** —— 只说"距离下一档"读屏用户不知道下一档是多少。
  'web.growth.milestone.nextLabel': '{name}：下一个里程碑是 {threshold} {unit}，还差 {gap} {unit}',
  'web.growth.milestone.next': '下一个里程碑是 {threshold} {unit}，还差 {gap} {unit}',
  'web.growth.milestone.dimensionDone': '这个维度已经全部达成',
  'web.growth.milestone.tierReached': '{threshold}{unit}：已达成',
  'web.growth.milestone.tierPending': '{threshold}{unit}：尚未达成',
  // 四个累计维度。里程碑用这一组（专注按**小时**计），周复盘用下面那一组（按分钟）。
  'web.growth.kind.checkIns': '打卡',
  'web.growth.kind.checkIns.unit': '次',
  'web.growth.kind.focusHours': '专注',
  'web.growth.kind.focusHours.unit': '小时',
  'web.growth.kind.tasks': '完成任务',
  'web.growth.kind.tasks.unit': '件',
  'web.growth.kind.activeDays': '活跃天数',
  'web.growth.kind.activeDays.unit': '天',
  'web.growth.unit.streakDays': '天连续',
  'web.growth.tags.title': '你的标签',
  'web.growth.tags.empty': '还没有标签。继续记录，这里会自己长出来。',
  'web.growth.tags.near': '距离「{name}」还差 {gap} {unit}',
  'web.growth.tags.nearNote': '上面这些是离你最近的两个。到了就会出现在这里。',
  // 身份标签：全部是**描述做过什么**，没有一句人格评价。
  'web.growth.tag.started': '起步的人',
  'web.growth.tag.routine': '有节奏的人',
  'web.growth.tag.steady': '长期主义',
  'web.growth.tag.checkin-hundred': '百次打卡',
  'web.growth.tag.deep-fifty': '深度工作 50 小时',
  'web.growth.tag.deep-two-hundred': '深度工作 200 小时',
  'web.growth.tag.finisher-five-hundred': '完成 500 件',
  'web.growth.tag.streak-thirty': '连续 30 天',
  'web.growth.share.title': '带走这一周',
  'web.growth.share.note': '复制成一段纯文字，粘到哪都行。它不含你的账号、设备或任何标识。',
  'web.growth.share.copy': '复制本周小结',
  'web.growth.share.copied': '已复制',
  'web.growth.share.failed': '当前环境不允许复制，可以手动选中上面的数字。',
  // 复制出去的那段纯文本 —— 它同样会被人读到，所以同样要翻。
  'web.growth.summary.title': '本周小结（{start} 至 {end}）',
  'web.growth.summary.line': '打卡 {checkIns} 次 · 完成 {tasks} 件 · 专注 {minutes} 分钟',
  'web.growth.summary.bestDay': '最专注的一天：{date}（{minutes} 分钟）',
  'web.growth.summary.totals': '累计：打卡 {checkIns} 次 · 专注 {hours} 小时 · 完成 {tasks} 件 · 活跃 {activeDays} 天',

  // ── Web · 分类时长（成长视图） ─────────────────────────────
  // 🔴 这一组里**只许有事实句**：某类做了多久、这些时间怎么算出来的。
  //    没有"最多/最少/失衡/超标"，也没有排名与占比（见计划 §2 反需求）。
  'web.categories.title': '分类时长',
  'web.categories.note': '统计近 12 周的专注与打卡时间。',
  'web.categories.empty': '还没有可展示的记录。先给任务归类或记录一次习惯时长。',
  'web.categories.empty.title': '还没有可展示的记录',
  'web.categories.empty.hint': '先给任务归类，或记录一次习惯时长。',
  'web.categories.range': '{start} 至 {end}',
  'web.categories.kind.project': '清单',
  'web.categories.kind.habit': '习惯',
  'web.categories.slot.none': '无',
  'web.categories.duration.minutes': '{minutes} 分钟',
  'web.categories.duration.hours': '{hours} 小时',
  'web.categories.duration.hoursMinutes': '{hours} 小时 {minutes} 分',
  'web.categories.lane.aria': '{name}（{kind}），共 {duration}',
  'web.categories.segment.aria': '{name}，共 {duration}',
  'web.categories.unassigned': '另有 {duration}没有归到任何清单或习惯 —— 给任务指定清单，它就会归位。',
  'web.categories.hint.unset': '行首的色块可以在清单和习惯旁边设置：点调色板图标，选 1–8 任意一个。',
  'web.categories.cell.none': '这一周没有记录',
  'web.categories.bars.aria': '近 12 周每周总时长的堆叠柱状图，每一段对应上面的一个分类。',
  'web.categories.picker.toggle': '给「{name}」设置分类颜色',
  'web.categories.picker.group': '「{name}」的分类颜色',
  'web.categories.picker.slot': '色槽 {slot}',

  // ── Web · 新建清单或标签 ────────────────────────────────────
  'web.categories.create.project.title': '新建清单',
  'web.categories.create.tag.title': '新建标签',
  'web.categories.create.name': '名称',
  'web.categories.create.namePlaceholder': '取一个清晰的名称',
  'web.categories.create.color': '颜色',
  'web.categories.create.colorSlot': '色槽 {slot}',
  'web.categories.create.colorNone': '无颜色',
  'web.categories.create.colorNoneShort': '无',
  'web.categories.create.cancel': '取消',
  'web.categories.create.close': '关闭',
  'web.categories.create.creating': '创建中…',
  'web.categories.create.empty': '先输入名称。',
  'web.categories.create.duplicate': '「{name}」已经存在。',
  'web.categories.create.failed': '创建失败，请重试。',
  'web.categories.create.project.submit': '创建清单',
  'web.categories.create.tag.submit': '创建标签',

  // ── Web · 清单与标签 ──────────────────────────────────────
  'web.projects.ariaLabel': '清单与标签',
  'web.projects.heading': '清单',
  'web.projects.newPlaceholder': '新清单',
  'web.projects.newLabel': '新清单名称',
  'web.projects.addNew': '新建清单',
  'web.projects.add': '添加清单',
  'web.projects.delete': '删除清单「{name}」',
  'web.tags.heading': '标签',
  'web.tags.newPlaceholder': '新标签',
  'web.tags.newLabel': '新标签名称',
  'web.tags.addNew': '新建标签',
  'web.tags.add': '添加标签',
  'web.tags.delete': '删除标签「{name}」',

  // ── Web · 任务行上的「整理」（清单归属 + 标签）──────────────
  // ⚠️ 与面板里的「新清单名称」「新标签名称」**刻意不同名**：同名会让无障碍树里
  //    出现多个同名节点，按名字取节点只能靠 role 去猜，而猜错就是静默设错元素。
  //    这几条都带上任务标题，读屏用户才知道正在给**哪一条**任务归类。
  'web.organize.summary': '整理任务「{title}」',
  'web.organize.projectLabel': '清单',
  'web.organize.projectSelect': '任务「{title}」所属清单',
  'web.organize.inbox': '收集箱',
  'web.organize.tagsLegend': '标签',
  'web.organize.tagToggle': '给任务「{title}」加上或去掉标签「{name}」',
  'web.organize.noTags': '还没有标签 —— 在左侧「标签」里新建一个。',
  // ── Web · 行尾「截止」控件（批一，多端入口覆盖 goal §2）──────────────
  //    日期措辞本身复用 common.date.* / common.weekday.*（共享 DatePicker
  //    的 monthTitle/dayLabel 由宿主拼），这里只有控件自己的话。
  'web.due.trigger': '截止',
  'web.due.summaryAria': '设置任务「{title}」的截止日期',
  // today / tomorrow 已有（上面 DueBadge 的剩余天数词组），直接复用不重定义。
  'web.due.weekend': '本周末',
  'web.due.nextWeek': '下周一',
  'web.due.clear': '清除',
  'web.due.prevMonth': '上个月',
  'web.due.nextMonth': '下个月',
  'web.due.dayLabel': '{month}月{day}日',
  // 🔴 时刻与日期是**同一个 `dueDate` 数字**的两种精度，不是第二个字段：
  //    留空 = 本地零点 = "只到日"，填了 = 那天几点几分。
  //    「全天」这个词与时间线那条带同源 —— 两处说不同话就会被读成两件事。
  // 🔴 命名空间是 `common.` 而不是 `web.`：这四句说的是**这条截止有没有时刻**
  //    这件事，两端共读一份（R15a 把 profile 那 19 键从 `web.` 搬进 `common.` 是
  //    同一条裁决）。键名写"哪个壳画的"，下一端要复用时就只能再抄一份值。
  'common.due.timeLabel': '时刻',
  'common.due.allDay': '全天',
  // 占位写"时:分"而不是照抄英文的 HH:MM —— 它是给人看的形状提示，不是格式代码。
  'common.due.timePlaceholder': '时:分',
  'common.due.timeAria': '任务「{title}」的截止时刻（留空表示全天）',

  // ── Web · 重复（B2-3）───────────────────────────────────────
  //    🔴 这一族补的是**两端不一致**：移动端任务详情早就能设重复，Web 一个入口都没有。
  //    预设语义（"每周"是哪一天、"工作日"含哪几天）在 app-host 的 `repeat-presets.ts`，
  //    这里只有文案。
  'web.repeat.summary': '设置任务「{title}」的重复规则',
  'web.repeat.legend': '重复',
  'web.repeat.none': '不重复',
  'web.repeat.daily': '每天',
  'web.repeat.weekly': '每周',
  'web.repeat.weekdays': '工作日',
  'web.repeat.monthly': '每月',
  'web.repeat.yearly': '每年',
  'web.repeat.optionAria': '把任务「{title}」设为「{label}」',
  'web.repeat.customChip': '自定义：{rule}',
  'web.repeat.customLabel': '自定义规则（RFC 5545 RRULE）',
  'web.repeat.customPlaceholder': '例如 FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
  'web.repeat.customAria': '给任务「{title}」输入自定义重复规则',
  'web.repeat.apply': '应用',
  'web.repeat.error.empty': '请先输入一条规则。',
  'web.repeat.error.invalid': '这不是一条合法的 RRULE（需要 FREQ=…）。',

  // ── Web · 四象限 ──────────────────────────────────────────
  'web.quadrant.do': '马上做',
  'web.quadrant.q1': '重要且紧急',
  'web.quadrant.plan': '计划做',
  'web.quadrant.q2': '重要不紧急',
  'web.quadrant.delegate': '交给别人',
  'web.quadrant.q3': '紧急不重要',
  'web.quadrant.drop': '先不做',
  'web.quadrant.q4': '不重要不紧急',
  'web.quadrant.a11y.cell': '象限：{title}，{hint}',
  'web.quadrant.dropHere': '拖任务到这里',
  'web.quadrant.dragging': '正在拖拽任务',
  'web.quadrant.a11y.handle': '移动任务到另一个象限',
  'web.quadrant.drop.success': '任务已移动到「{quadrant}」',
  'web.quadrant.drop.changedDue': '任务已移动到「{quadrant}」，截止时间已调整',
  'web.quadrant.drop.error': '任务移动失败，请重试',
  'web.quadrant.drop.undo': '撤销移动',
  // 🔴 原文是"拖拽**只改**「重要」**并**把截止时间推入/移出 2 天窗口" ——
  //    它同时说了"不改"和"改"，自相矛盾。紧急是**推导**出来的：
  //    要让任务真的落在你放下的那一格，就必须动截止时间。
  //    写清楚"会动"比写得含蓄重要 —— 那是**用户数据的删除**。
  'web.settings.file.choose': '选择文件',
  'web.settings.file.replace': '重新选择',
  'web.settings.dataUx.emptyTitle': '需要一台空设备',
  'web.settings.dataUx.localTitle': '仅还原到当前设备',
  'web.settings.dataUx.formatsTitle': '选择适合用途的格式',
  'web.settings.accountSignIn': '登录后管理订阅、登录方式与账号安全。',
  'web.quadrant.move': '移动',
  'web.quadrant.moveTask': '移动「{title}」到其他象限',
  'web.quadrant.interactionHelp': '拖动手柄或使用「移动」调整象限',
  'web.quadrant.footnote': '紧急程度由截止时间推导。要让任务真的落在你放下的那一格，拖拽在改「重要」之外还会动截止时间：放进紧急侧会推进到 1 小时内，放进非紧急侧会清除它。',

  // ── Web · 时间线 ──────────────────────────────────────────
  // 时间线把「任务的清单 + AI 估时」排成甘特图。没有可排期内容**也不静默跳过**：
  // 留白会让用户以为视图坏了，所以每一块都要说清楚"为什么这里没有条"。
  'web.timeline.aria.empty': '时间线',
  'web.timeline.aria.group': '时间线：共 {count} 条任务',
  // 中文无单复数，刻意与复数版逐字相同（词条表没有 ICU，调用方按 count===1 分支）。
  'web.timeline.aria.groupOne': '时间线：共 {count} 条任务',
  'web.timeline.empty': '还没有可排期的任务',
  'web.timeline.empty.hint': '先在收集箱创建任务，再添加清单或让 AI 拆解，时间线就能开始安排。',
  'web.timeline.aiEstimate': 'AI 估时：{duration}（整条任务）',
  'web.timeline.noChecklist': '这条任务还没有可排期的清单 —— 先在备注里写几条待办，或让 AI 拆解一次；下面先按整条任务排一条。',
  // {count} 在这里恒 ≥ 2（"摊不下去"只在多个子条目时才存在），所以没有单数兄弟。
  'web.timeline.unattributable': 'AI 估的 {duration} 是整条任务的估计，摊不到 {count} 个子条目上 —— 子条目按默认时长排，不替你猜每一步占多少。',

  // ── Web · 甘特图 ──────────────────────────────────────────
  // 三个**单位**词条：`formatMinutes` 是分钟数的唯一实现（时间条、轴刻度、
  // 区间文字全走它），所以单位也必须由它取，否则英文界面上会出现「90 分钟」。
  // 英文用缩写（`min` / `h`）而不是 `minutes`/`hours`：缩写不随数量变化，
  // 一个词条就够，不需要单复数兄弟。
  'web.gantt.minutes': '{count} 分钟',
  'web.gantt.hours': '{count} 小时',
  'web.gantt.hoursMinutes': '{hours} 小时 {minutes} 分',
  'web.gantt.title': '时间线',
  'web.gantt.empty': '这份计划还是空的 —— 清单里还没有可排的条目。先在备注里写几条待办，再回来看时间线。',
  'web.gantt.aria.group': '时间线：共 {count} 条，总时长 {total}',
  // 中文无单复数，刻意逐字相同。
  'web.gantt.aria.groupOne': '时间线：共 {count} 条，总时长 {total}',
  'web.gantt.span': '共 {count} 条 · 总时长 {total}',
  // 中文无单复数，刻意逐字相同。
  'web.gantt.spanOne': '共 {count} 条 · 总时长 {total}',
  'web.gantt.rangeFrom': '{when} 起',
  'web.gantt.today': '今天 · 第 {day} 天',
  'web.gantt.dayBand': '第 {day} 天',
  'web.gantt.unestimatedSummary': '其中 {count} 条未估时，按 {duration}排',
  // 中文无单复数，刻意逐字相同。
  'web.gantt.unestimatedSummaryOne': '其中 {count} 条未估时，按 {duration}排',
  'web.gantt.aiSummary': '其中 {count} 条按 AI 估时排',
  // 中文无单复数，刻意逐字相同。
  'web.gantt.aiSummaryOne': '其中 {count} 条按 AI 估时排',
  'web.gantt.durationDefault': '未估时（按 {duration}排）',
  'web.gantt.durationAi': '约 {duration} · AI 估时',
  'web.gantt.durationManual': '约 {duration}',
  'web.gantt.dependsOn': '依赖：{title}',
  'web.gantt.overlap': '与前置重叠',

  // ── Web · 时间线板（2026-10-01 重画，goal：docs/plans/goal-timeline-rework.md）──
  // 一根共轴、行=任务、三态降级（条/菱形/未排期泳道）。上面 `web.timeline.*` 的
  // empty/aria 三条**继续被板复用**；aiEstimate/noChecklist/unattributable 归
  // 任务详情的清单排程预览。措辞全部由宿主装进 `TimelineBoardLabels`。
  'web.board.weekday.1': '一',
  'web.board.weekday.2': '二',
  'web.board.weekday.3': '三',
  'web.board.weekday.4': '四',
  'web.board.weekday.5': '五',
  'web.board.weekday.6': '六',
  'web.board.weekday.7': '日',
  'web.board.month.1': '1月',
  'web.board.month.2': '2月',
  'web.board.month.3': '3月',
  'web.board.month.4': '4月',
  'web.board.month.5': '5月',
  'web.board.month.6': '6月',
  'web.board.month.7': '7月',
  'web.board.month.8': '8月',
  'web.board.month.9': '9月',
  'web.board.month.10': '10月',
  'web.board.month.11': '11月',
  'web.board.month.12': '12月',
  'web.board.today': '今天',
  // 有名字的泳道（R4 判据 5）：没排期的任务**可见但不落图**——
  // 静默消失用户会以为视图坏了，画成条就是在编长度。
  'web.board.unscheduledLane': '未排期（{count}）',
  // 行头的估时 badge：是**文字**，绝不画成长度（R4 判据 3）。
  'web.board.aiBadge': 'AI 估 {duration}',
  // 逾期是文字 + 警示色，不是只有颜色（WCAG 1.4.1）。
  'web.board.overdue': '逾期',
  // 详情预览的区块说明：任务内部坐标系与板**必须标明**不是同一个坐标系
  // （goal §2.1；不标明用户就会拿它和板对位置）。
  'web.board.planCaption': '这是这条任务内部的清单排程（先后与估时），与时间线板不是同一个坐标系。',
  // 「点空白建任务」（goal §3.2 手势 4）的默认标题：这是**数据**（一条任务的名字），
  // 但它来自产品而不是用户 —— 所以仍然走词条表，不硬编码。
  'web.board.untitledTask': '未命名任务',
  'web.board.createTask': '添加任务',
  'web.board.editSchedule': '调整「{title}」的排期；点按编辑详情，拖拽调整时长',

  // ── Mobile · 详情面排期段（时间线 P2 的触屏入口；web 载荷用拖拽）──
  'mobile.detail.field.schedule': '排期',
  'mobile.detail.schedule.hint': '开始 + 时长决定这条任务在时间线板上的条；截止（上一段）是另一件事。没有开始时，只有时长不会上板。',
  'mobile.detail.schedule.start': '开始',
  'mobile.detail.schedule.duration': '时长',
  'mobile.detail.schedule.none': '无时长',

  // ═══════════════════════════════════════════════════════════
  // Web · AI（拆解 / 捕获 / 估时 / 排序 / 设置 / 记忆）
  // ═══════════════════════════════════════════════════════════
  //
  // 四个面板共用一批"披露"文案：发给谁 / 发什么 / 留多久。
  // 🔴 共用是刻意的 —— 各写一份，措辞迟早分叉，而"这个端点能看到什么"
  // 在两个地方说两套是不可接受的（见计划 §9）。
  //
  // ⚠️ `web.ai.feature.*` 与 `web.ai.needs.*` 是**刻意不同的两套**功能名：
  // 设置页的功能名与能力提示里的用法名在原文里就不同（`一句话捕获` vs `快速捕获`），
  // 本轮只做迁移、不改产品措辞，所以两套都留着（与落地页"行动名 / 定义名都保留"同处理）。
  //
  // ⚠️ 纯标点（`、` 与成对括号）**不进词条表**：zh 词条必须含汉字是硬规则，
  // 它们放在 `apps/web/src/features/ai/locale-punctuation.ts`，
  // 与 `apps/mobile/src/lib/recurrence-display.ts` 的 `LIST_SEPARATOR` 同一处置。

  'web.ai.action.cancel': '取消',
  'web.ai.action.send': '发送',
  'web.ai.action.close': '关闭',
  'web.ai.action.retry': '重试',
  'web.ai.action.discard': '不要了',
  'web.ai.loading.waiting': '正在等待端点返回…',

  // ── Web · AI · 发送前的披露（四个面板共用）───────────────
  'web.ai.disclosure.heading': '发送前确认',
  'web.ai.disclosure.destinationLead': '将发往：',
  'web.ai.disclosure.model': '模型 {model}',
  'web.ai.disclosure.local': '数据不出设备',
  'web.ai.disclosure.remote': '数据会离开设备',
  'web.ai.disclosure.fallbackLead': '如果它失败，会接着依次尝试：',
  'web.ai.disclosure.retentionLead': '保留：',
  // 「留多久」的**结构化披露** → 词条。`disclosure.retentionDisclosure.kind`
  // 是判别式（`not-applicable` / `third-party-decides` / `metadata-only`），
  // 界面按它取词条，**不再渲染 `packages/ai` 的中文兼容句 `retentionText`**。
  // 那两句兼容句仍然留在 `packages/ai`（零依赖的包，CLI 与 check-ai-coverage 在用），
  // 只是 web 壳里没有生产消费者了。
  'web.ai.disclosure.retentionNotApplicable': '未离开设备，不涉及服务端保留。',
  'web.ai.disclosure.retentionThirdParty': '保留策略由你自己的端点决定，heyta 无从知晓。',
  // 托管档（ADR-0054 定案）。🔴 `{metadataDays}` 的取值**只能来自 `packages/ai` 的常量**
  // （`MANAGED_AI_METADATA_RETENTION_DAYS`，壳从披露对象里取）—— 词条表里不许写死天数，
  // 否则改了常量而这里没改，界面就会报出一个不存在的保留期。
  // 🔴 这句必须点到**两个载体**（计数表 + 每次调用一行的运维日志）。少写一个就不是
  // "保守"而是少说了一样真存在的数据，而没人会发现 —— `check:ai-coverage` 有一条臂拦它。
  // ⚠️ 天数只给计数表；日志那一侧的上限是**容量不是时间**，所以绝不给它写一个天数
  //（写了就是关于一个不存在的定时删除的承诺）。
  // ⚠️ "该计费周期结束后删除"是**策略**，删除作业在代码里（`purgeExpiredAiUsageCounters`）；
  // 这句话**不许先于该作业的部署上线** —— 顺序记在 ADR-0054 §8。
  'web.ai.disclosure.retentionMetadataOnly': '正文不留存，只在一次调用的内存里存在；服务端只留两类元数据，都不含正文：一张计数表（账号、计费周期、次数、最后使用时间），自最后一次使用起保留 {metadataDays} 天，且该计费周期结束后删除；以及每次调用一行的运维日志（时间、功能名、结果、字节数、耗时），按日志容量滚动清除，没有定时删除。',
  // 端点健康状态。⚠️ 英文刻意避开 `{n} times` / `{n} seconds` 这种句式：
  // 词条表没有复数规则，而英文里 `1 times` 是错的。改写句式（`Recent failures: 1`）
  // 比加一串 `…One` 兄弟词条更不容易漏 —— 中文不受影响，逐字沿用兼容句。
  'web.ai.health.ok': '正常',
  'web.ai.health.failing': '最近失败过 {failures} 次',
  'web.ai.health.circuitOpen': '暂时停止使用（连续失败 {failures} 次，{retryInSeconds} 秒后重试）',
  'web.ai.disclosure.fieldsLead': '将发送这些字段：',
  'web.ai.disclosure.group.task': '任务内容（含备注）',
  'web.ai.disclosure.group.project': '清单',
  'web.ai.disclosure.group.tag': '标签',
  'web.ai.disclosure.group.note': '便签内容',
  'web.ai.disclosure.group.habit': '习惯设置',
  'web.ai.disclosure.group.habit_log': '打卡记录',
  'web.ai.disclosure.group.focus_session': '专注记录',
  'web.ai.disclosure.group.reminder': '提醒',
  'web.ai.disclosure.group.event': '纪念日',
  'web.ai.disclosure.group.text': '你的消息',
  'web.ai.disclosure.group.today': '当前日期',
  'web.ai.disclosure.group.tools': '可用操作',
  'web.ai.disclosure.group.tool': '操作结果与错误',
  'web.ai.disclosure.technicalDetails': '查看技术详情',
  'web.ai.disclosure.showFields': '查看具体字段',
  'web.ai.disclosure.hideFields': '收起具体字段',
  // 围绕 `<strong>` 的两截：强调边界不靠翻译字符串里的标记来猜。
  // 句末的 `。` 落在 strong 内（zh 词条必须含汉字，纯标点单独成条会被词条测试拒绝）。
  'web.ai.disclosure.e2eeLead': '这台设备上的任务内容是端到端加密的，而发出去的这一份',
  'web.ai.disclosure.e2eeStrong': '不受端到端加密保护。',
  'web.ai.source.local': '来自本机',
  'web.ai.source.remote': '来自云端',

  // 没配端点时的整句（每个功能名字不同，所以按功能各一条，不做拼接）。
  'web.ai.noTarget.capture': '还没有给「一句话捕获」配置端点。去「设置」里添加端点并指定路由。',
  'web.ai.noTarget.breakdown': '还没有给「拆解任务」配置端点。去「设置」里添加端点并指定路由。',
  'web.ai.noTarget.duration': '还没有给「耗时估计」配置端点。去「设置」里添加端点并指定路由。',
  'web.ai.noTarget.prioritize': '还没有给「优先级排序」配置端点。去「设置」里添加端点并指定路由。',
  'web.ai.noTarget.toolCalling': '还没有给「AI 工具调用」配置端点。去「设置」里添加端点、勾上「工具调用」能力并指定路由。',
  'web.ai.noTarget.inboundAutomation': '还没有给「自动收集」配置端点。去「设置」里添加端点并指定路由。',

  // ── Web · AI · 功能名 / 能力名 ────────────────────────────
  'web.ai.feature.capture': '一句话捕获',
  'web.ai.feature.breakdown': '拆解任务',
  'web.ai.feature.prioritize': '优先级建议',
  'web.ai.feature.duration': '预估耗时',
  'web.ai.feature.toolCalling': 'AI 工具调用',
  'web.ai.feature.inboundAutomation': '自动收集',
  // 能力勾选框旁的"哪些功能需要它"——原文是另一套更短的用法名。
  'web.ai.needs.capture': '快速捕获',
  'web.ai.needs.breakdown': '拆解任务',
  'web.ai.needs.prioritize': '排序建议',
  'web.ai.needs.duration': '耗时估计',
  'web.ai.needs.toolCalling': '工具调用',
  'web.ai.needs.inboundAutomation': '自动收集',
  'web.ai.capability.structuredOutput': '结构化输出',
  'web.ai.capability.longContext': '长上下文',
  'web.ai.capability.vision': '图片理解',
  'web.ai.capability.toolCalling': '工具调用',

  // ── Web · AI · 工具调用面板 ────────────────────────────────
  //
  // 🔴 "规则命中不出境"这句话必须让用户看见：规则路径**一个字节都不发**，
  // 而模型路径会把这句话 + 工具目录发出去。两条路的隐私后果完全不同。
  'web.ai.tools.title': 'AI 工具调用',
  'web.ai.tools.hint': '用一句话让 AI 调一个工具。规则能处理的不会离开这台设备。',
  'web.ai.tools.placeholder': '例如：列出所有任务',
  'web.ai.tools.inputAria': 'AI 工具调用的输入',
  'web.ai.tools.run': '运行',
  // 工具调用面板的无障碍名。🔴 这两个面板此前**没有** role/aria ——
  // 四个 AI 面板的失败/提案屏都有，唯独第 5 个入口漏了（同一个漂移形状）。
  'web.ai.tools.failureAria': '工具调用失败',
  'web.ai.tools.resultAria': '工具调用结果',
  'web.ai.tools.viaRule': '本机规则命中 —— 没有联网',
  'web.ai.tools.viaModel': '由模型选择',
  'web.ai.tools.disclosureAria': 'AI 工具调用 —— 发送前确认',
  'web.ai.tools.observationLead': '读取结果',
  'web.ai.tools.proposalLead': '将要执行（需要你确认）',
  'web.ai.tools.confirm': '确认执行',
  'web.ai.tools.confirmAria': '确认执行这个工具',
  'web.ai.tools.confirmedOk': '已执行',
  'web.ai.tools.confirmedFail': '执行失败：{message}',
  'web.ai.tools.modelTextLead': '模型说：',
  'web.ai.tools.ambiguousLead': '这句话可能指好几件事，请说得更具体一些。可以试试：',
  'web.ai.tools.empty': '没听懂这句话。换一种说法，或直接手动操作。',
  'web.ai.tools.deniedLead': '这个工具还没有授权，需要先在设置里打开。',
  'web.ai.tools.failedLead': '没能完成：',
  // 工具调用失败时的**主句**（按 `reason` 取）。🔴 在这一刀之前这一屏直接
  // 渲染 `packages/app-host` 拼的中文原句 —— 英文界面下整句是中文。
  // `ai-unavailable` 不在这里：它走共享的 `web.ai.failure.cause.*`（更具体）。
  'web.ai.tools.failure.emptyText': '先写一句要让 AI 做什么。',
  'web.ai.tools.failure.textTooLong': '这句话太长了，拆短一点再试。',
  'web.ai.tools.failure.noGrantedTools': '还没有授权任何工具 —— 去设置里勾选允许 AI 调用的工具。',
  'web.ai.tools.failure.modelReturnedText': '模型只回了一句话，没有要求调用工具 —— 可以把要求说得更明确。',
  'web.ai.tools.failure.multipleToolCalls': '模型一次要调多个工具；这一步只做一件事，请拆成两次。',
  'web.ai.tools.failure.toolCallMalformed': '模型给出的参数不是合法 JSON —— 再说一次，或换一个更明确的说法。',
  'web.ai.tools.intentCreate': '新建任务「{title}」',
  'web.ai.tools.intentUpdate': '修改任务 {id}',
  'web.ai.tools.intentComplete': '把任务 {id} 标记完成',
  'web.ai.tools.intentCompleteBatch': '把这 {count} 个任务标记完成',
  'web.ai.tools.intentAppendTaskChecklist': '给任务 {id} 追加清单：{items}',
  'web.ai.tools.intentCreateProject': '新建清单「{name}」',
  'web.ai.tools.intentCreateHabit': '新建习惯「{name}」',
  'web.ai.tools.intentCreateTag': '新建标签「{name}」',
  'web.ai.tools.intentSetTaskTags': '把任务 {id} 的标签整组换成 {count} 个',
  'web.ai.tools.intentSetTaskPriorities': '把这些任务的优先级改为：{items}',
  'web.ai.tools.intentSetTaskEstimate': '把任务 {id} 的预计耗时设为 {minutes} 分钟',
  'web.ai.tools.intentCreateNote': '新建便签：{content}',
  'web.ai.tools.intentUpdateNote': '改写便签 {id} 的正文：{content}',
  'web.ai.tools.intentRecordCheckin': '给习惯 {habitId} 在 {date} 记一次打卡',
  'web.ai.tools.todayLabel': '今天',
  'web.ai.tools.intentLogFocus': '记一段{kind}：计划 {planned} 分钟',
  'web.ai.tools.intentLogFocusWithActual': '记一段{kind}：计划 {planned} 分钟，实际 {actual} 分钟',
  'web.ai.tools.focusKindWork': '工作',
  'web.ai.tools.focusKindShortBreak': '短休息',
  'web.ai.tools.focusKindLongBreak': '长休息',
  'web.ai.tools.intentCreateReminderAt': '给任务 {id} 加一条提醒：{when}',
  'web.ai.tools.intentCreateReminderBeforeDue': '给任务 {id} 加一条提醒：比截止早 {minutes} 分钟',
  'web.ai.tools.intentCreateReminderIncomplete': '给任务 {id} 加提醒，但没说清时刻 —— 要选一个时间或填"提前几分钟"',
  // 🔴 W10：`LocalApiWriteIntent` 每加一个封闭变体，这里就**必须**同时长出一句 ——
  // 提案卡不许出现"未知操作"，那是让用户对着没读过的东西点确认。
  // 谁来拦：两道**编译期**的闸，都比测试硬 ——
  //   ① `apps/web/src/features/ai/AiToolRun.tsx` 的 `intentText()` 是对
  //      `intent.action` 的**穷尽 switch**，漏一个变体 `tsc` 报 TS2366（缺返回值）；
  //   ② key 拼错 / 只加中文不加英文 ⇒ `MessageKey` 与 `en: Record<MessageKey, string>`
  //      当场报错（见本文件头"漏翻译是编译失败"那条）。
  // 实测：本轮先加 case 不加词条，`pnpm --filter @heyta/web typecheck` 立刻两条 TS2345。
  'web.ai.tools.intentCreateEvent': '新建倒数纪念日「{title}」（{date}）',
  'web.ai.tools.intentUpdateEvent': '修改倒数纪念日 {id}',

  // ── Web · AI · 拆解面板 ───────────────────────────────────
  'web.ai.breakdown.button': 'AI 拆解',
  'web.ai.breakdown.runAria': '用 AI 拆解：{title}',
  'web.ai.breakdown.applied': '已写入备注',
  'web.ai.breakdown.disclosureAria': 'AI 拆解 —— 发送前确认',
  'web.ai.breakdown.proposalAria': 'AI 拆解结果',
  'web.ai.breakdown.proposalHead': '拆解结果（{count} 项）',
  'web.ai.breakdown.truncated': '结果太多，只保留了前 {count} 项。',
  'web.ai.breakdown.noteLead': '确认后会作为',
  'web.ai.breakdown.noteStrong': 'Markdown 清单追加',
  'web.ai.breakdown.noteMid': '到这条任务的备注里，原来的备注不会被动。已选',
  'web.ai.breakdown.noteCount': '/ {count} 项。',
  'web.ai.breakdown.apply': '写入备注',
  'web.ai.breakdown.failedAria': 'AI 拆解失败',
  'web.ai.breakdown.failedHead': '没能拆解',
  'web.ai.breakdown.manual': '手动写一份空清单',

  // ── Web · AI · 捕获面板 ───────────────────────────────────
  'web.ai.capture.button': 'AI 捕获',
  'web.ai.capture.runAria': '用 AI 解析这句话',
  'web.ai.capture.applied': '已填入候选字段',
  'web.ai.capture.disclosureAria': 'AI 捕获 —— 发送前确认',
  'web.ai.capture.textPreviewLead': '将解析：',
  'web.ai.capture.proposalAria': 'AI 捕获结果',
  'web.ai.capture.proposalHead': '捕获结果（可以改）',
  'web.ai.capture.droppedLead': '模型给的',
  'web.ai.capture.droppedTail': '没法用，已经留空 —— 需要的话自己填。',
  'web.ai.capture.field.title': '标题',
  'web.ai.capture.field.titleAria': '任务标题',
  'web.ai.capture.field.dueDate': '截止日期',
  'web.ai.capture.field.dueTime': '截止时间',
  'web.ai.capture.field.priority': '优先级',
  'web.ai.capture.priority.none': '不设置',
  'web.ai.capture.priority.low': '低',
  'web.ai.capture.priority.medium': '中',
  'web.ai.capture.priority.high': '高',
  'web.ai.capture.noteLead': '确认后会按上面的字段写入。截止时间是',
  'web.ai.capture.noteStrong': '模型的推算',
  'web.ai.capture.noteTail': '，请核对后再填。',
  'web.ai.capture.apply': '填入任务',
  'web.ai.capture.failedAria': 'AI 捕获失败',
  'web.ai.capture.failedHead': '没能捕获',

  // ── Web · AI · 估时面板 ───────────────────────────────────
  'web.ai.duration.button': 'AI 估时',
  'web.ai.duration.runAria': '用 AI 估计耗时：{title}',
  'web.ai.duration.applied': '已写入耗时',
  'web.ai.duration.disclosureAria': 'AI 估时 —— 发送前确认',
  'web.ai.duration.proposalAria': 'AI 估时结果',
  'web.ai.duration.proposalLead': '估计需要',
  'web.ai.duration.proposalRest': '分钟（{humanized}）',
  'web.ai.duration.minutes': '{minutes} 分钟',
  'web.ai.duration.hours': '{hours} 小时',
  'web.ai.duration.hoursMinutes': '{hours} 小时 {minutes} 分钟',
  // 静默夹取等于让用户以为模型说的就是这个数，所以必须说出来。
  'web.ai.duration.clamped': '模型给的数超出了 {min}–{max} 分钟的范围，已经夹到 {minutes} 分钟。',
  // 「我凭什么估这个数」：三档如实区分，不许用含混话糊过去。
  'web.ai.duration.basis.none': '这次没有可用的历史数据，只有模型自己的通用判断 —— 它可能不准。',
  'web.ai.duration.basis.historyLead': '基于你过去',
  'web.ai.duration.basis.historyMid': '次的实际/计划比值',
  'web.ai.duration.basis.historyOverflow': '（你共有 {total} 次记录，为控制出境只发送最近 {max} 次）',
  'web.ai.duration.note': '确认后会把这个分钟数写进这条任务的耗时。已写入的耗时可以随时改。',
  'web.ai.duration.apply': '用这个数',
  'web.ai.duration.manualLead': '自己填一个：',
  'web.ai.duration.manualAria': '手动输入耗时（分钟）',
  'web.ai.duration.manualUnit': '分钟',
  'web.ai.duration.retry': '再试一次',
  'web.ai.duration.failedAria': 'AI 估时失败',
  'web.ai.duration.failedHead': '没能估时',

  // ── Web · AI · 排序面板 ───────────────────────────────────
  'web.ai.prioritize.button': 'AI 排优先级',
  'web.ai.prioritize.runAria': '用 AI 给这些任务排优先级',
  'web.ai.prioritize.applied': '已应用',
  'web.ai.prioritize.disclosureAria': 'AI 排优先级 —— 发送前确认',
  'web.ai.prioritize.proposalAria': 'AI 优先级建议',
  'web.ai.prioritize.proposalHead': '优先级建议（{count} 条）',
  'web.ai.prioritize.truncated': '任务太多，只送出了前 {max} 条，其余这次没有参与排序。',
  'web.ai.prioritize.countLead': '这次会送出',
  'web.ai.prioritize.countTail': '条任务（不含备注、标签、清单）。',
  'web.ai.prioritize.noteLead': '确认后会写入这些任务的',
  'web.ai.prioritize.noteStrong': '优先级字段',
  'web.ai.prioritize.noteMid': '，备注、标签、清单都不会被动。已选',
  'web.ai.prioritize.noteCount': '/ {count} 条。',
  'web.ai.prioritize.apply': '应用优先级',
  'web.ai.prioritize.failedAria': 'AI 排优先级失败',
  'web.ai.prioritize.failedHead': '没能排序',
  'web.ai.prioritize.priority.high': '高',
  'web.ai.prioritize.priority.medium': '中',
  'web.ai.prioritize.priority.low': '低',
  'web.ai.prioritize.priority.none': '无',

  // ── Web · AI · 设置面板 ───────────────────────────────────
  // ⚠️ 标题从纯拉丁的 `AI` 改成 `AI 设置`：zh 词条必须含汉字，
  // 而门禁要求已迁移文件里的裸文本必须走 `t()` —— 纯拉丁字面量没有
  // 可以承载它的词条形态（`common.brand` 那种白名单是按 key 开的，不给新词条）。
  'web.ai.settings.title': 'AI 设置',
  'web.ai.settings.enabled.label': '启用 AI 功能',
  'web.ai.settings.enabled.note': '关着的时候 heyta 不会向任何地方发送数据。',
  'web.ai.settings.memory.label': '让 AI 记住我的偏好',
  'web.ai.settings.memory.note': '从你自己的历史里推断（任务拆解粒度、表达习惯、估时偏差等）。推断只在本机进行、不上传；关掉后 AI 照常工作，只是它不认识你。',
  'web.ai.settings.allowRemote.label': '允许远程端点',
  'web.ai.settings.allowRemote.note': '关着时只会使用本机端点（数据不离开这台设备）。',
  'web.ai.settings.remote.lead': '远端端点能看到你的任务内容明文。这条路径',
  'web.ai.settings.remote.strong': '不受端到端加密保护',
  'web.ai.settings.remote.tail': '，与任务同步是不同的通道。每个功能需要单独授权。',
  'web.ai.settings.endpoints.title': '端点',
  // 首词 `heyta` 走 `common.brand`，所以这里从动词起。
  // 🔴 2026-10-05（ADR-0054）把理由从"仍在开发中"换成"界面还没那个开关"：
  //    服务端那一半（额度计量 / 境内白名单 / 保留策略 / 解除禁售）**已经落地**，
  //    再说"还在开发"就是把做完的事说成没做完 —— 而结论（这里点不动）仍然为真。
  // ⚠️ 这句里不许出现 `**`（JSX 不解析 markdown，`ai-settings.spec.tsx` 有一条测试专门钉它），
  //    也不许出现「没有」（同文件用 `not.toContain('没有')` 挡"我们不提供托管 AI"的回潮 ——
  //    那条判据粗，所以文案绕开它；想动文案先弄清那条测试为什么在那）。
  'web.ai.settings.managed.offer': '暂不在这里开放',
  'web.ai.settings.managed.rest': '云端 AI 服务（服务端那一半已经做完：额度计量、境内供应商白名单、保留策略、解除禁售，见 ADR-0054；但这个版本的界面还没挂上那个开关，所以这里点不动）。在那之前，需要你自己接一个端点（本机或远端）。托管模式的性质不一样：用它的请求，你的任务内容会',
  'web.ai.settings.managed.strongPlain': '以明文到达 heyta 的服务器',
  'web.ai.settings.managed.mid': '，所以它',
  'web.ai.settings.managed.strongNot': '不是',
  'web.ai.settings.managed.tail': '端到端加密 —— 我们会把它当例外单独标注。',
  'web.ai.settings.endpoints.empty': '还没有端点。可以加一个本机端点 —— 它不需要授权，数据也不出设备。',
  'web.ai.settings.field.name': '名称',
  'web.ai.settings.field.url': '地址',
  'web.ai.settings.field.model': '模型',
  'web.ai.settings.field.capability': '能力',
  'web.ai.settings.nameAria': '{name} 的名称',
  'web.ai.settings.urlAria': '{name} 的地址',
  'web.ai.settings.modelAria': '{name} 的模型',
  'web.ai.settings.capabilityAria': '{name} 的能力 {capability}',
  'web.ai.settings.keyAria': '{name} 的密钥',
  'web.ai.settings.keyKnown': '已在本次会话中',
  'web.ai.settings.keyPlaceholder': '输入密钥',
  'web.ai.settings.keyRemember': '记住（本次会话）',
  'web.ai.settings.deleteAria': '删除端点 {name}',
  'web.ai.settings.tag.local': '本机，数据不出设备',
  'web.ai.settings.tag.remote': '远端，数据会离开设备',
  'web.ai.settings.presetAdd': '添加 {name}',
  'web.ai.settings.presetAdded': '已添加 {name}',
  'web.ai.settings.addCustom': '添加自定义端点',
  'web.ai.settings.customLabel': '自定义端点 {n}',
  // 预设的名字与前置条件。原值在 `packages/ai/src/presets.ts` 的
  // `AI_ENDPOINT_PRESETS` 里，是**跨包数据**，门禁看不见（渲染的是变量）。
  // zh 值与原值逐字相同；en 是新增的，否则英文界面会直接显示中文。
  // ⚠️ 未知预设 id 会回退到跨包原值（那份目前只有这两个本机预设）。
  'web.ai.settings.preset.ollama.label': '本机 Ollama',
  'web.ai.settings.preset.ollama.prerequisite': '需要先装好 Ollama 并 pull 一个模型（例如 ollama pull qwen3:8b）。',
  'web.ai.settings.preset.lmStudio.label': '本机 LM Studio',
  'web.ai.settings.preset.lmStudio.prerequisite': '需要在 LM Studio 里打开本地服务器（默认端口 1234）。',
  'web.ai.settings.features.title': '功能',
  'web.ai.settings.features.hintLead': '勾选哪个端点给哪个功能用。',
  'web.ai.settings.features.hintStrong': '列表顺序就是尝试顺序',
  'web.ai.settings.features.hintTail': '（靠前的先试）。',
  'web.ai.settings.features.empty': '先添加端点',
  'web.ai.settings.consentLead': '「{feature}」的端点不在这台设备上，需要你批准后内容才会离开本机。',
  'web.ai.settings.grant': '授权',
  'web.ai.settings.gapLead': '⚠️ 「{feature}」需要',
  'web.ai.settings.gapMid': '，但',
  'web.ai.settings.gapTail': '没有声明它 —— 这个功能会一直不工作。',
  'web.ai.settings.gapFix': '给「{name}」补上',
  'web.ai.settings.granted': '已批准内容离开本机',
  'web.ai.settings.revoke': '撤销',
  // ── 对话助手（ADR-0045）：第二个授权前端 ──────────────────────────
  // 🔴 这一块的存在理由：`localApi.grants` 管的是"**外部程序**能不能调这个工具"
  // （MCP / 本机 HTTP，逐工具默认关，ADR-0011）。内置助手如果共用那张表，
  // 用户为了"让 AI 帮我看看今天有什么"就得去开一个他并不想给别的进程的口子。
  // 两档都汇到同一个判据 `isToolGranted()` —— 授权只有一份，变的是谁来勾。
  'web.ai.assistant.title': '对话助手',
  'web.ai.assistant.hint': '只读档只查询不写入；执行档会自动完成低风险写入，高风险改动仍会先请你确认。',
  'web.ai.assistant.tier.readOnly.label': '只读',
  'web.ai.assistant.tier.readOnly.note': '只查询和回答，不会写入数据。',
  'web.ai.assistant.tier.readAndPropose.label': '执行',
  'web.ai.assistant.tier.readAndPropose.note': '可以新建、修改或完成任务；低风险写入会自动完成，高风险改动会先请你确认。',
  'web.ai.assistant.egressTitle': '这一档最多会送出这些字段：',
  'web.ai.assistant.toolsTitle': '模型这一次能看见这些工具：',
  'web.ai.assistant.maxRequests': '最多 {n} 次模型调用',
  'web.ai.assistant.maxMessages': '单次请求最多 {n} 条消息',
  'web.ai.assistant.maxBytes': '单次请求最多 {n} 字节',
  'web.ai.assistant.mcpSplit': '这里只管内置助手。「本机 API」下面那些开关管的是外部程序能不能调用工具，两边互不影响。',
  // ── 对话助手界面（W12 / ADR-0045）──────────────────────────────────
  'web.ai.chat.title': '对话助手',
  'web.ai.chat.hint': '用一句话使唤它：查任务、建任务、改任务。执行档会自动完成低风险写入，高风险改动会先请你确认。',
  'web.ai.chat.tierLabel': '助手权限',
  'web.ai.chat.suggestion.today': '看看今天有什么任务',
  'web.ai.chat.suggestion.today.label': '今天有什么',
  'web.ai.chat.suggestion.capture': '帮我记下一件任务',
  'web.ai.chat.suggestion.capture.label': '记一件任务',
  'web.ai.chat.suggestion.summary': '总结一下我的待办',
  'web.ai.chat.suggestion.summary.label': '总结待办',
  'web.ai.chat.suggestion.plan': '帮我安排一下今天',
  'web.ai.chat.suggestion.plan.label': '安排今天',
  'web.ai.chat.inputAria': '要对助手说的话',
  'web.ai.chat.placeholder': '描述一件任务，或问点什么…',
  'web.ai.chat.send': '发送',
  'web.ai.chat.newSession': '新会话',
  'web.ai.chat.history.title': '会话',
  'web.ai.chat.history.today': '今天',
  'web.ai.chat.history.current': '当前会话',
  'web.ai.chat.history.empty': '还没有会话',
  'web.ai.chat.history.open': '历史',
  'web.ai.chat.history.close': '收起历史',
  'web.ai.chat.expand': '展开对话',
  'web.ai.chat.collapse': '收起对话',
  'web.ai.chat.greeting': '今天想先完成什么？',
  'web.ai.chat.greetingHint': '把想法变成下一步。',
  'web.ai.chat.tier.readOnly': '只读',
  'web.ai.chat.tier.readAndPropose': '执行',
  'web.ai.chat.disclosureHeading': '这段会话会把这些内容送到端点',
  'web.ai.chat.disclosureLead': '多步循环中途不再逐步征求同意，所以这里说的是这一次最多会送出的全部：',
  'web.ai.chat.fieldsTitle': '字段：',
  'web.ai.chat.limits': '一轮最多 {requests} 次模型调用，单次请求最多 {messages} 条消息、{bytes} 字节。',
  'web.ai.chat.trace': '用了 {n} 步工具',
  'web.ai.chat.noTrace': '没有调用工具',
  'web.ai.chat.local.empty': '没有符合条件的内容。',
  'web.ai.chat.local.found': '我找到 {count} 项：',
  'web.ai.chat.local.untitled': '（未命名）',
  'web.ai.chat.local.more': '还有 {count} 项未列出。',
  'web.ai.chat.stoppedLead': '在上界处停下了：',
  'web.ai.chat.disclaimer': 'AI 可能出错，请核对重要信息。',
  'web.ai.chat.historyLocalOnly': '这段对话只保存在这台设备上：不同步到其他设备，也不会发送到任何地方。',
  'web.ai.chat.expiredProposal': '这段对话是从本机恢复的。其中那条你还没确认的改动已经失效 —— 要改请重新说一次。',
  'web.ai.chat.resultAria': '助手的回答',
  'web.ai.assistant.failure.emptyText': '还没有输入内容。',
  'web.ai.assistant.failure.textTooLong': '这句话太长了，助手只处理短命令。',
  'web.ai.assistant.failure.noToolsAvailable': '没有可用的工具，助手什么也做不了。',
  'web.ai.assistant.failure.multipleToolCalls': '助手一次要求做太多件事，请说得更具体一点。',
  'web.ai.assistant.failure.argumentsMalformed': '助手没能把参数读出来，请换个说法再试。',
  'web.ai.assistant.failure.writeFailed': '这次执行没有完成，数据没有按预期写入，请重试。',
  'web.ai.assistant.failure.egressOutsideDisclosedSet': '某一步要送出你没有批准过出境的字段，助手已经停下，那一步一个字节都没发。',
  'web.ai.settings.localApi.title': '本机 API',
  'web.ai.settings.localApi.hintLead': '让本机的其他程序（编辑器、脚本、AI 助手）读写你的任务。',
  'web.ai.settings.localApi.hintStrong': '默认关闭，且每个工具要单独打开。',
  'web.ai.settings.localApi.browserOnly': '只保存偏好，不启动 MCP',
  'web.ai.settings.localApi.source.title': '连接 MCP 需要额外一步',
  'web.ai.settings.localApi.source.summary': '本页只保存浏览器里的偏好，不会启动 MCP 服务。',
  'web.ai.settings.localApi.source.details': '查看连接方式',
  'web.ai.settings.localApi.source.part1': '本页的这些开关只保存在',
  'web.ai.settings.localApi.source.browser': '浏览器',
  'web.ai.settings.localApi.source.file': '~/.heyta/local-api.json',
  'web.ai.settings.localApi.source.part2': '。真正生效的 MCP 服务读取这个文件，由命令行',
  'web.ai.settings.localApi.source.command': 'heyta-ai local-api init',
  'web.ai.settings.localApi.source.part3': '生成。',
  'web.ai.settings.localApi.source.part4': '两边目前不会自动同步。',
  'web.ai.settings.localApi.enabled.label': '启用本机 API',
  'web.ai.settings.localApi.enabled.note': '只监听 {address}，不会暴露到局域网。',
  'web.ai.settings.localApi.token.label': '访问 token',
  'web.ai.settings.localApi.token.aria': '本机 API 访问 token',
  'web.ai.settings.localApi.token.hint': 'token 防的是这台机器上的其他程序，不是网络攻击 —— 没有它，任何程序都能读走你的全部任务。',
  'web.ai.settings.localApi.token.set': '已设置',
  'web.ai.settings.localApi.token.unset': '尚未设置',
  'web.ai.settings.localApi.token.show': '显示 token',
  'web.ai.settings.localApi.token.hide': '隐藏 token',
  'web.ai.settings.localApi.token.copy': '复制 token',
  'web.ai.settings.localApi.token.copied': '已复制',
  'web.ai.settings.localApi.kind.write': '会改数据',
  'web.ai.settings.localApi.kind.read': '只读',
  'web.ai.settings.localApi.toolTechnical': '查看技术名称：{name}',
  'web.ai.settings.localApi.tool.listTasks': '查看任务列表',
  'web.ai.settings.localApi.tool.getTask': '查看单条任务',
  'web.ai.settings.localApi.tool.listProjects': '查看清单列表',
  'web.ai.settings.localApi.tool.listHabits': '查看习惯列表',
  'web.ai.settings.localApi.tool.listTags': '查看标签列表',
  'web.ai.settings.localApi.tool.listNotes': '查看便签列表',
  'web.ai.settings.localApi.tool.getNote': '查看单条便签',
  'web.ai.settings.localApi.tool.listCheckins': '查看打卡记录',
  'web.ai.settings.localApi.tool.listFocuses': '查看专注记录',
  'web.ai.settings.localApi.tool.listReminders': '查看提醒列表',
  'web.ai.settings.localApi.tool.listEvents': '查看倒数日列表',
  'web.ai.settings.localApi.tool.getEvent': '查看单个倒数日',
  'web.ai.settings.localApi.tool.createTask': '新建任务',
  'web.ai.settings.localApi.tool.updateTask': '修改任务',
  'web.ai.settings.localApi.tool.completeTask': '完成任务',
  'web.ai.settings.localApi.tool.createProject': '新建清单',
  'web.ai.settings.localApi.tool.createHabit': '新建习惯',
  'web.ai.settings.localApi.tool.createTag': '新建标签',
  'web.ai.settings.localApi.tool.setTaskTags': '修改任务标签',
  'web.ai.settings.localApi.tool.createNote': '新建便签',
  'web.ai.settings.localApi.tool.updateNote': '修改便签',
  'web.ai.settings.localApi.tool.recordCheckin': '记录打卡',
  'web.ai.settings.localApi.tool.logFocus': '记录专注',
  'web.ai.settings.localApi.tool.createReminder': '新建提醒',
  'web.ai.settings.localApi.tool.createEvent': '新建倒数日',
  'web.ai.settings.localApi.tool.updateEvent': '修改倒数日',
  // 从 `features/settings/aiStore.ts` 的 `WEB_KEY_STORAGE_NOTICE` 搬来。
  // 🔴 它必须显示在密钥输入框旁边：不说明的话，"下次打开要重输"会被当成 bug。
  'web.ai.settings.keyNotice': '浏览器里没有系统钥匙串，密钥只保存在这个标签页的内存中。关掉或刷新页面后需要重新输入。桌面端会把密钥存进系统钥匙串。',
  'web.ai.settings.reset': '恢复默认（全部关闭）',
  // 拒绝原因 → 主文案。**按 `reason` 码取词条，不渲染跨包的中文 `message`**：
  // 门禁看不见 `{r.message}`（那是变量，不是字面量），但用户看得见。
  // 这些句子来自 `@heyta/ai` 的 `validateEndpointUrl()`（`reason` 四种）。
  'web.ai.settings.endpointError.unparseable': '端点地址无法解析：{url}',
  'web.ai.settings.endpointError.badScheme': '端点必须是 http 或 https，当前是 {protocol}',
  'web.ai.settings.endpointError.credentialsInUrl': '端点地址里不要写用户名/密码，请用独立的凭据字段。',
  'web.ai.settings.endpointError.plaintextRemote': '远端端点必须是 https。用明文 http 发到远端，意味着你的任务内容会以明文经过网络 —— 这与 heyta 的端到端加密承诺冲突。（本机端点不受此限制：http://localhost:11434/v1 是允许的。）',
  // 同上，来自 `@heyta/local-api` 的 `validateLocalApiConfig()`（`reason` 三种）。
  'web.ai.settings.localApi.error.badPort': '端口必须是 1–65535 的整数，当前是 {port}。',
  'web.ai.settings.localApi.error.tokenRequired': '打开本机 API 必须设置一个访问 token。没有 token 的话，这台机器上的任何程序都能读走你的全部任务。',
  'web.ai.settings.localApi.error.notLoopback': '只允许监听回环地址（127.0.0.1 / ::1 / localhost），拒绝了「{address}」。监听其他地址会把你的任务暴露给同一网络里的其他人 —— 如果你确实想这样，正确的做法是用你自己的反向代理，而不是让 heyta 直接对外监听。',

  // ── Web · AI · 记忆面板 ───────────────────────────────────
  // ── Web · 偏好（我了解到的你）──────────────────────────────
  // 🔴 这 7 个名字和下面这些句子，**逐字等于** `packages/domain` 里
  // `preferenceEvidenceText()` 生成的投影 —— 那个函数仍是中文的真源
  // （领域测试钉着它）。这里再写一份是为了让**英文界面**说同一件事。
  // 两处漂移会被两边的测试各抓一次：`apps/web/tests/preference-copy.spec.tsx`
  // 逐条比对「词条渲染结果 === 领域投影」。
  'web.memory.pref.estimateBias': '估时偏差',
  'web.memory.pref.deepWorkWindow': '高效时段',
  'web.memory.pref.leadTime': '完成提前量',
  'web.memory.pref.granularity': '任务拆解粒度',
  'web.memory.pref.titleStyle': '表达习惯',
  'web.memory.pref.feedbackGranularity': '采纳的拆解粒度',
  'web.memory.pref.feedbackKeepRatio': '建议保留比例',

  // 依据（事实 → 句子）。分档判据在代码里，句子在这里。
  'web.memory.evidence.estimateBiasAccurate': '基于 {samples} 次专注，你的时间估计很准（实际约为计划的 {multiplier} 倍）',
  'web.memory.evidence.estimateBiasUnder': '基于 {samples} 次专注，你倾向低估任务耗时 —— 实际用时约为计划的 {multiplier} 倍',
  'web.memory.evidence.estimateBiasOver': '基于 {samples} 次专注，你倾向高估任务耗时 —— 实际用时约为计划的 {multiplier} 倍',
  'web.memory.evidence.deepWorkWindow': '基于 {samples} 次专注，{percent}% 集中在 {from}–{to}',
  'web.memory.evidence.leadTimeAhead': '基于 {samples} 个已完成任务，你平均提前 {days} 天完成',
  'web.memory.evidence.leadTimeLate': '基于 {samples} 个已完成任务，你平均逾期 {days} 天完成',
  'web.memory.evidence.leadTimeOnTime': '基于 {samples} 个已完成任务，你通常在截止当天完成',
  'web.memory.evidence.granularity': '你的 {samples} 条带清单任务，中位数是 {items} 项',
  'web.memory.evidence.titleStyle': '基于 {samples} 条任务，你的标题{lang}，平均 {median} 个字{emoji}',
  'web.memory.evidence.titleStyleLangZh': '以中文为主',
  'web.memory.evidence.titleStyleLangEn': '以英文为主',
  'web.memory.evidence.titleStyleLangMixed': '中英混用',
  'web.memory.evidence.titleStyleEmoji': '，常用 emoji',
  'web.memory.evidence.feedbackGranularity': '基于你采纳的 {adopted} 次拆解，通常是 {items} 项',
  'web.memory.evidence.feedbackKeepRatioAlmostAll': '基于 {adopted} 次采纳，你几乎总是全部保留 AI 的拆解',
  'web.memory.evidence.feedbackKeepRatioTrimmed': '基于 {adopted} 次采纳，你通常只留下 {percent}% —— AI 给得太多了',
  'web.memory.evidence.feedbackKeepRatioPartial': '基于 {adopted} 次采纳，你通常留下约 {percent}% 的拆解项',

  'web.memory.off': '记忆已关闭 —— heyta 不会推断你的偏好，AI 也收不到任何与「你是谁」有关的信息。 AI 功能本身照常可用。',
  'web.memory.known.title': '我了解到的你',
  'web.memory.known.empty': '我还不太了解你。用一段时间之后，这里会出现我从你自己数据里总结出的习惯。',
  'web.memory.withheld.title': '还不了解',
  // ── 「还不了解」的原因（第 15 轮）───────────────────────────
  // 🔴 这 21 句**原来住在 `packages/domain` 里**（`WithheldPreference.detail`），
  // 而它只有一个消费者（记忆面板）—— 纯界面文案住在领域层，于是英文界面露中文。
  // 现在领域层只给**结构化原因**（`reason` + `id` + `remaining`），句子在这里。
  //
  // ⚠️ 这 21 句的中文与搬走之前**逐字一致** —— 记忆面板的测试
  //（`还需要 5 次专注`）会正面钉住这一点。
  'web.memory.withheld.noData.estimateBias': '还没有完成过的专注记录',
  'web.memory.withheld.noData.deepWorkWindow': '还没有专注记录',
  'web.memory.withheld.noData.leadTime': '还没有「有截止日期且已完成」的任务',
  'web.memory.withheld.noData.granularity': '还没有带清单的任务备注',
  'web.memory.withheld.noData.titleStyle': '还没有任务标题',
  'web.memory.withheld.noData.feedbackGranularity': '还没有采纳过 AI 的拆解建议',
  'web.memory.withheld.noData.feedbackKeepRatio': '还没有可以对比的拆解建议',
  'web.memory.withheld.notEnoughSamples.estimateBias': '还需要 {remaining} 次专注',
  'web.memory.withheld.notEnoughSamples.deepWorkWindow': '还需要 {remaining} 次专注',
  'web.memory.withheld.notEnoughSamples.leadTime': '还需要 {remaining} 个已完成的有截止日期任务',
  'web.memory.withheld.notEnoughSamples.granularity': '还需要 {remaining} 条带清单的任务',
  'web.memory.withheld.notEnoughSamples.titleStyle': '还需要 {remaining} 条任务',
  'web.memory.withheld.notEnoughSamples.feedbackGranularity': '还需要 {remaining} 次采纳',
  'web.memory.withheld.notEnoughSamples.feedbackKeepRatio': '还需要 {remaining} 次采纳',
  'web.memory.withheld.notStableEnough.estimateBias': '你的用时波动太大，暂时算不出稳定的偏差系数',
  'web.memory.withheld.notStableEnough.deepWorkWindow': '你的专注时间比较分散，暂时看不出固定的高效时段',
  'web.memory.withheld.notStableEnough.leadTime': '你完成任务的提前量波动太大，暂时看不出固定习惯',
  'web.memory.withheld.notStableEnough.granularity': '你的清单长度差异很大，暂时算不出固定的粒度偏好',
  'web.memory.withheld.notStableEnough.titleStyle': '你的标题长度差异很大，暂时算不出固定的表达习惯',
  'web.memory.withheld.notStableEnough.feedbackGranularity': '你采纳的拆解项数差异很大，暂时看不出固定喜好',
  'web.memory.withheld.notStableEnough.feedbackKeepRatio': '你保留建议的比例波动太大，暂时看不出固定习惯',
  'web.memory.withheld.disabled': '这条偏好当前是关闭的',
  // ── 订阅提示（第 16 轮从 web 壳的本地表收编）─────────────────
  // 🔴 这 7 条原来是 `apps/web/src/features/subscription/copy.ts` 里的**本地词条表**：
  // 另一条工作流为了不和本工作流抢 `packages/i18n` 而临时自建了一份，
  // 并在文件头写明"一旦词条表空出来就该平移过来"。现在平移到这儿了。
  // 为什么它必须收编：本地表长着词条的形状，却**在门禁视野之外**
  //（JT 只在 JSX 属性 / JSX 文本节点里找候选，而它是被变量渲染的），
  // 于是 en 漏翻、中文抄进英文都不会有人发现。
  'web.subscription.notice.expired.title': '官方托管同步已到期',
  'web.subscription.notice.expired.body': '这台设备不再通过 heyta 官方托管服务同步。你的任务、清单和设置都还在，没有被改动 —— 你随时可以改用你自己的服务器，同步会立刻恢复。',
  'web.subscription.notice.refused.title': '官方托管同步暂不可用',
  'web.subscription.notice.refused.body': '服务端没有放行这台设备的托管同步。你的任务、清单和设置都还在，没有被改动。',
  'web.subscription.notice.localData': '这台设备上的全部数据仍然可以正常查看、编辑和导出，不需要续费。',
  'web.subscription.notice.selfHost': '改用你自己的服务器',
  'web.subscription.notice.a11y': '托管同步状态提示',
  // ── 托管同步续费入口（临时方案：再次下单 = 在当前到期日之后叠加 30 天）────
  // 🔴 措辞里不许出现"自动续费"：全仓库没有任何签约/代扣（ADR-0017 的通道选型
  // 与 `wechat.adapter.ts` 都只有单次 Native 支付）。承诺了就是假话。
  'web.subscription.renew.title': '托管同步续费',
  'web.subscription.renew.intro': '一次性购买 30 天，直接叠加在你当前的到期日之后；不会自动扣款，到期了数据也一个字都不动。',
  'web.subscription.renew.couponPlaceholder': '促销码（可选）',
  'web.subscription.renew.action': '下单续费',
  'web.subscription.renew.busy': '正在下单…',
  'web.subscription.renew.amount': '应付金额 {amount}',
  'web.subscription.renew.validUntil': '这一单在 {time} 之前有效',
  'web.subscription.renew.payLinkLabel': '支付链接',
  'web.subscription.renew.payHint': '用手机微信打开这个链接就能完成付款。桌面端的二维码渲染还没接入（零新依赖约束），先用链接这条路。',
  'web.subscription.renew.copy': '复制链接',
  'web.subscription.renew.copied': '已复制',
  'web.subscription.renew.rejected': '这个码没有生效：{code}',
  'web.subscription.renew.fail.provider': '这台实例没有配置收款通道，现在买不了。',
  'web.subscription.renew.fail.unauthorized': '先登录你的 heyta 账号，才能下单。',
  'web.subscription.renew.fail.unconfigured': '还没有填写同步服务器地址，先在同步设置里配好。',
  'web.subscription.renew.fail.sellable': '这一档现在还不能卖，服务端拒绝了这笔下单。',
  'web.subscription.renew.fail.network': '连不上服务端，这一单没有下成。',
  'web.subscription.renew.fail.unknown': '下单失败（{code}）。',
  'mobile.entitlement.renew.action': '下单续费',
  'mobile.entitlement.renew.busy': '正在下单…',
  'mobile.entitlement.renew.opened': '已为你打开付款页',
  'mobile.entitlement.renew.payHint': '如果微信没有自动打开，复制这条链接后用手机浏览器打开它。',
  'mobile.entitlement.renew.payLinkLabel': '支付链接',
  'mobile.entitlement.renew.copy': '复制',
  'mobile.entitlement.renew.copied': '已复制',
  'mobile.entitlement.renew.fail.provider': '这台实例没有配置收款通道，现在买不了。',
  'mobile.entitlement.renew.fail.unauthorized': '先登录你的 heyta 账号，才能下单。',
  'mobile.entitlement.renew.fail.network': '连不上服务端，这一单没有下成。',
  'mobile.entitlement.renew.fail.unknown': '下单失败（{code}）。',
  // ── AI 面板的失败态（第 18 轮）───────────────────────────────
  // 🔴 这 11 条原来住在 `packages/app-host` 里（`*Outcome.message`），
  // 四个面板整句渲染它 → 英文界面露中文。现在壳**按 `reason` 取词条**，
  // `message` 降级为技术详情（只在它带额外信息时才显示，例如端点返回的原文）。
  //
  // ⚠️ 带 `emptyTitle` 的两条**刻意不同**：拆解说「没什么可拆的」、
  // 估时说「估不出耗时」—— 同一个 reason 在两个功能里对用户是两件事。
  'web.ai.failure.breakdown.emptyTitle': '任务没有标题，没什么可拆的。',
  'web.ai.failure.breakdown.unparseable': '模型返回的内容里没有能识别的子项清单。可以再试一次，或者手动写。',
  'web.ai.failure.capture.emptyText': '还没有输入内容。',
  'web.ai.failure.capture.unparseable': '模型返回的内容没法读成任务字段。可以再试一次，或者手动填。',
  'web.ai.failure.duration.emptyTitle': '任务没有标题，估不出耗时。',
  'web.ai.failure.duration.unparseable': '模型返回的内容里没有能识别的分钟数（比如「约两小时」这种写法）。可以再试一次，或者自己填一个。',
  'web.ai.failure.prioritize.emptyTasks': '没有可排序的任务。',
  'web.ai.failure.prioritize.unparseable': '模型返回的内容里没有能识别的优先级建议。可以再试一次，或者手动调整。',
  // 缺少输入 / 太长这类**本地就能判定**的拒绝 —— 不消耗网络调用。
  'web.ai.failure.capture.textTooLong': '这句话太长了（{length} 个字，上限 {max}）。一句话捕获只处理短句。',
  // 路由层没给出结果（未开启 / 没路由 / 未授权 / 网络失败……）。
  // ⚠️ 这条**只是主文案**：此时 `outcome.message` 里可能带着端点返回的原文，
  // 壳会把它降级成「技术详情」（见 `web.ai.failure.details`）。
  'web.ai.failure.aiUnavailable': 'AI 服务暂时不可用。',
  // 路由层的 7 个失败原因码（`AiFailureReason`）。**第一行**与 `packages/ai`
  // 给的句子逐字一致 —— 那边才是"为什么没有候选端点"的权威来源。
  // ⚠️ 别在这里重新概括：同一句用户可见文案有两个来源就一定会漂移（见 §7.10 通道 #5）。
  // ⚠️ 引号照抄 `packages/ai`（ASCII 双引号）—— 有测试逐字比对，别改成「」。
  'web.ai.failure.cause.notConfigured': 'AI 未启用。在设置里选择"使用自己的 AI 端点"即可开启。',
  'web.ai.failure.cause.egressNotAuthorized': '该功能需要你先批准内容离开本机。',
  'web.ai.failure.cause.noRoute': '没有可用端点能处理这个功能。检查端点是否启用、地址是否合法。',
  'web.ai.failure.cause.fallbackNeedsConsent': '首选端点失败了，而备用端点会把数据发到别处，所以没有自动切换。需要你重新授权。',
  'web.ai.failure.cause.network': '连不上端点。检查网络，以及端点地址是否可达。',
  // 🔴 这一条与上面那句**共用同一个传输层原因码**（`network`），分开靠的是诊断：
  // 端点在你自己机器上、而它拒绝了当前页面所在的来源。浏览器在这一步只会给
  // `Failed to fetch`，**状态码根本看不见**，所以这句话是推出来的、不是读到的。
  // 要放行的那个值走 `web.ai.failure.originToAllow` 那块**数据**，不进文案 ——
  // 多一个斜杠、少一个端口都对不上白名单。
  'web.ai.failure.cause.networkOriginRejected': '端点在你自己的机器上，但它拒绝了当前页面的来源。这通常不是网络故障：需要你把下面这个来源加进该端点的允许列表（Ollama 对应 OLLAMA_ORIGINS）。',
  'web.ai.failure.originToAllow': '要放行的来源',
  'web.ai.failure.originToAllowNote': '这个值是浏览器实际发出去的 Origin，请原样复制。heyta 不会替你改本机端点的设置。',
  'web.ai.failure.cause.httpError': '端点返回了错误状态。检查 API key、余额与模型名。',
  'web.ai.failure.cause.emptyResponse': '端点返回了空内容。可以换一个模型再试。',
  'web.ai.failure.details': '技术详情',

  // ── 模块 2：路由解释 + 端点停用开关 ───────────────────────
  // 🔴 这七条补的是同一件事：**候选一个都不剩时，界面必须说出真实原因**。
  // 在此之前四个面板只渲染 `web.ai.noTarget.*`（"还没配置端点"），
  // 而真实原因可能是下面六种里的任意一种 —— 用户照着那句话去添加端点
  // 是解决不了问题的。每一条都必须同时说清「为什么」和「下一步」。
  'web.ai.routeExplain.remoteNotAllowed': '端点都在设备之外，而「允许远程端点」没有打开。打开它，这个功能才有可用的端点。',
  'web.ai.routeExplain.capabilityMissing': '端点没有声明这个功能需要的能力。到设置里补勾能力，否则它永远不会被选中。',
  'web.ai.routeExplain.endpointDisabled': '路由指向的端点已被停用。在设置里重新启用它，或者改指另一个端点。',
  'web.ai.routeExplain.endpointUrlRejected': '端点地址没有通过校验（必须是可达的 http/https 地址）。到设置里把它改对。',
  'web.ai.routeExplain.circuitOpen': '端点连续失败，已被暂时熔断。等冷却结束，或者去设置检查它的地址与密钥。',
  'web.ai.routeExplain.endpointMissing': '路由指向了一个已经不存在的端点，配置已经对不上。到设置里重新指定端点。',
  'web.ai.routeExplain.unknown': '没有可用端点，但原因没法从当前配置判定。到设置里检查端点和路由。',
  'web.ai.action.openSettings': '去设置',

  // 端点停用开关（`AiEndpointConfig.disabled` 的**生产者**）。
  // ⚠️ 这个字段此前全仓只有"读"没有"写"：引擎真的会跳过停用端点，
  // 而界面上没有任何地方能停用它 —— 用户只能把端点删掉。
  'web.ai.settings.endpointDisabled.label': '停用',
  'web.ai.settings.endpointDisabled.aria': '停用端点：{name}',
  'web.ai.settings.endpointDisabled.note': '停用后路由不会再选它，配置和密钥都保留。',
  'web.ai.settings.endpointDisabled.tag': '已停用',
  'web.memory.forgotten.title': '你已忘记',
  'web.memory.forgotten.note': '我不会再用这一条。',
  'web.memory.forget': '忘掉',
  'web.memory.forgetAria': '忘掉「{name}」',
  'web.memory.restore': '恢复',
  'web.memory.footer': '这些推断只在本机进行，不上传。 发给 AI 的只是当前那次决定需要的那一条摘要，并且会在发送前告诉你。',

  // ── Web · 记忆面板 · 「说的 vs 做的」落差 ─────────────────
  // 🔴 这里刻意**不**渲染领域层 `describeFocusGaps()` 拼好的中文句子，
  //    而是用 `FocusGap` 的结构化字段 + 这些词条现拼（同 evidence 那一套）。
  'web.memory.gap.title': '说的 vs 做的',
  'web.memory.gap.note': '下面这些任务你标了优先级、重要或截止日期，但几乎没有专注投入。',
  'web.memory.gap.empty': '目前没有发现明显的落差 —— 你在重要的事上花了时间。',
  // store 还没就绪 / 读事件流失败时的诚实降级：**不说**"推迟 0 次"。
  'web.memory.gap.unavailable': '暂时算不出推迟次数（读不到事件流），这里先不展示落差。',
  'web.memory.gap.declared': '你声明的重要性：{declared}',
  'web.memory.gap.focusMinutes': '实际专注：{minutes} 分钟',
  'web.memory.gap.postponed': '推迟过 {count} 次',
  // 中文不分单复数，单数版与复数版**刻意逐字相同**（见 plural-keys 测试的约定）。
  'web.memory.gap.postponedOne': '推迟过 {count} 次',
  'web.memory.gap.overdue': '已逾期 {days} 天',
  'web.memory.gap.overdueOne': '已逾期 {days} 天',

  // ── Web · 捕获输入框 ──────────────────────────────────────
  // ✅ 日期那一条里**不再**嵌 `formatRemainingUntil()` 的中文了 ——
  // 剩余天数现在由壳按当前语言说（`web.due.*`，见下）。
  'web.capture.placeholder': '添加任务，回车确认（可写「明天」「下周三」「!1」）',
  // 🔴 「添加到哪儿」必须出现在占位符里。当下面板停在某个清单时，
  // 「添加任务」这句话只说了一半 —— 用户按回车后任务落进收集箱、
  // 从眼前这条列表里消失，而界面上没有任何一处说过这件事。
  'web.capture.placeholderTo': '添加任务到「{list}」，回车确认（可写「明天」「下周三」「!1」）',
  // R11 批五：日历里选中了某一天时，捕获框要**说出落点**。
  // 悄悄改变一条任务的落点属于『界面没说谎、但用户以为没说』那一类，
  // 所以这句提示是功能的一部分，不是装饰。
  'web.capture.placeholderToDay': '添加到 {day}，回车确认（写了「明天」就以「明天」为准）',
  'web.calendar.capture.add': '往选中那天加一条',
  'web.calendar.capture.close': '收起输入框',
  'web.capture.addLabel': '新任务标题',
  'web.capture.add': '添加',
  'web.capture.matches.aria': '识别出的字段',
  'web.capture.priority.high': '高优先级',
  'web.capture.priority.medium': '中优先级',
  'web.capture.priority.low': '低优先级',
  'web.capture.priority.none': '无优先级',
  'web.capture.rejected': '已忽略（当作标题文字）',
  'web.capture.restoreAria': '恢复识别：{raw}',
  'web.capture.ignoreAria': '忽略识别：{raw}',
  'web.capture.unused': '未采用，仍在标题中',
  'web.capture.previewLead': '实际标题：',
  'web.capture.previewEmpty': '（空）',

  // ── Web · 截止时间怎么说（不是怎么算）──────────────────────
  //
  // 🔴 领域层保留**怎么算天数**（`computeCountdown` / `diffDays`），这里只负责
  // **怎么说**。分家的理由不是"顺手"：`packages/domain` 是纯函数层、依赖不了
  // 词条表，它的 `formatRemaining()` 返回的是一句**写死的中文** ——
  // 直接渲染就是"英文界面里冒出中文"（这正是本组词条要修的那个 bug）。
  //
  // 🔴 阈值语义**照搬** `@heyta/domain` 的 `formatRemaining`（今天 / 明天 /
  // 后天 / 还剩 N 天 / 已逾期 N 天），因为那是**产品语义**而不是措辞：
  // 自己发明一套"几天算后天"，同一个任务在两个端上就会显示成两句话。
  // 与移动端 `apps/mobile/src/lib/due-display.ts` 同构 —— 措辞各写各的
  // （两端可以合法地不同），但**分档必须相同**，且由
  // `apps/web/tests/due-display.spec.ts` 逐日与领域层对账。
  'web.due.today': '今天',
  'web.due.tomorrow': '明天',
  'web.due.dayAfterTomorrow': '后天',
  'web.due.remaining': '还剩 {days} 天',
  'web.due.overdue': '已逾期 {days} 天',
  // ⚠️ 英文有单复数、中文没有 —— 词条表刻意不支持 ICU，所以按数量在**调用方**
  // 分支到单数兄弟词条。中文这两条**刻意逐字相同**（不相同才是漏翻）。
  'web.due.overdueOne': '已逾期 {days} 天',

  // ── Web · 导出（设计原则第 5 条「导出自由」）─────────────────
  //
  // 🔴 这些词条兑现两句已经对用户说过的话：README 的「任何时刻都能一键带走
  //    全部数据」，以及订阅到期提示里的「本地数据仍然可以正常查看、编辑和导出」。
  //    在此之前全仓没有任何用户可见的导出入口 —— 那两句话是不实的。
  'web.export.title': '导出数据',
  'web.export.intro': '把这台设备上的数据一次性带走。导出在本机完成，不经过任何服务器。',
  'web.export.json.label': 'JSON（完整保真）',
  'web.export.json.note': '包含全部实体、完整操作日志，以及已删除的记录。适合备份或迁移，机器可读。',
  'web.export.json.button': '下载 JSON',
  'web.export.markdown.label': '任务清单（Markdown）',
  'web.export.markdown.note': '人能直接打开看的任务列表。它不含已删除的记录，也不含操作日志。',
  'web.export.markdown.button': '下载任务清单',
  // 🔴 诚实条款。JSON 已经有还原路径了，所以这句不再是"不能导回来"，
  //    而是如实说出**这一轮的边界**：只支持还原到空库。
  //    Markdown 清单**真的**不能导回来 —— 它没有 op-log。
  'web.export.notRestorePoint': 'JSON 导出可以导回来（目前只支持还原到空库）；任务清单只是给人看的，不能导回来。',
  'web.export.counts': '这次的导出里有 {entities} 条记录（其中已删除 {deleted} 条）、{ops} 条操作日志。',
  'web.export.failed': '导出失败，请重试。',
  // Markdown 文件内部的结构文字。**格式由 `packages/app-host` 决定，措辞由这里决定** ——
  // 与 AI 失败态「返回 reason、壳取词条」是同一条纪律。
  'web.export.markdown.heading': '# heyta 任务清单',
  'web.export.markdown.generatedAt': '导出时间：{at}',
  'web.export.markdown.empty': '（没有任务）',
  'web.export.markdown.open': '未完成',
  'web.export.markdown.done': '已完成',
  'web.export.markdown.colTitle': '标题',
  'web.export.markdown.colStatus': '状态',
  'web.export.markdown.colDue': '截止',
  'web.export.markdown.colPriority': '优先级',
  'web.export.markdown.colProject': '清单',
  'web.export.markdown.colTags': '标签',
  'web.export.markdown.none': '（无）',
  'web.export.markdown.footer': '这是导出文件，还不能导回来，请不要把它当成还原点。',

  // ── Web · 导入 / 还原（导出自由的另一半）───────────────────
  //
  // 🔴 本轮**只支持"还原到空库"**，不做"合并到已有数据的库"——
  //    理由见 `packages/app-host/src/import-dump.ts` 文件头。
  //    界面必须直说这件事：一句看起来万能的"导入"会让用户以为它能合并两份数据，
  //    而合并会在 id 冲突与时钟顺序上**静默丢数据**。
  'web.import.title': '导入 / 还原',
  'web.import.intro': '从一份 heyta 导出的 JSON 还原数据。还原在本机完成，不经过任何服务器。',
  'web.import.emptyOnly': '只支持还原到空库：本机已经有数据时会直接拒绝，不会清空或覆盖任何现有数据。',
  'web.import.fileLabel': '选择导出的 JSON 文件',
  'web.import.button': '读取并还原',
  'web.import.busy': '正在还原…',
  'web.import.success': '已还原 {entities} 条记录（其中已删除 {deleted} 条）、{ops} 条操作日志。',
  'web.import.skipped': '另有 {skipped} 条操作日志本机已经有了，已跳过。',
  'web.import.localOnly': '还原只作用在本机：导入的操作日志带着原设备的标识，服务端不会因此收到这些数据。',
  'web.import.failed': '还原没有完成，请重试。',
  // 拒绝原因。结构化 `reason` → 词条，与 AI 失败态同一条纪律
  //（packages 只回 reason，壳取词条；不把文案写进 packages）。
  'web.import.reason.invalidJson': '这个文件不是合法 JSON。',
  'web.import.reason.invalidDocument': '这个文件不是一份完整的 heyta 导出。',
  'web.import.reason.wrongApplication': '这个文件不是 heyta 导出的。',
  'web.import.reason.unsupportedFormatVersion': '导出格式版本不认识 —— 文件可能来自更新的版本。',
  'web.import.reason.unsupportedSchemaVersion': '这份导出与本机的 op 版本不同，暂不支持跨版本还原。',
  'web.import.reason.inconsistentDocument': '文件自相矛盾：重放它的操作日志得不到它自己声称的数据。没有写入任何内容。',
  'web.import.reason.targetNotEmpty': '本机已经有数据 —— 还原只支持空库，现有数据一个字节都没动。',
  'web.import.reason.verificationFailed': '写入后的结果与导出不一致，请检查本机数据。',

  // ── 从滴答清单导入（B2-1）──────────────────────────────────
  //    🔴 与上面那组「导入 / 还原」**不是一件事**：那个是还原 heyta 自己的导出、
  //    只支持空库；这个是从另一个产品迁进来、走普通 op、可与既有数据共存。
  //    两套承诺必须在界面上分开说，所以是两组词条。
  'web.ticktick.title': '从滴答清单导入',
  'web.ticktick.intro': '选一份滴答清单导出的 CSV 备份。先看预览，确认后才写入 —— 预览里的数字与真的写进去的是同一次解析。',
  'web.ticktick.fileLabel': '滴答清单 CSV 备份',
  'web.ticktick.picked': '已选择：{name}',
  'web.ticktick.ticktickOnly': '请选择从滴答清单导出的 CSV 文件。暂不支持其他应用的备份格式。',
  'web.ticktick.coexist': '导入走普通操作，可以与现有数据共存；同一份文件导第二次不会重复（按稳定 id 判定）。',
  'web.ticktick.busy': '处理中…',
  'web.ticktick.readFailed': '读取文件失败，请重试。',
  'web.ticktick.importFailed': '导入过程中出错了 —— 可能有部分内容已经写入；再导一次同一份文件不会重复。',
  'web.ticktick.previewTitle': '预览',
  'web.ticktick.preview.projectCount': '将新建 {count} 个清单',
  'web.ticktick.preview.tagCount': '将新建 {count} 个标签',
  'web.ticktick.preview.taskCount': '将新建 {count} 条任务',
  'web.ticktick.preview.operationCount': '将写入 {count} 条操作',
  'web.ticktick.previewNoop': '这份文件里的内容**都已经在本机了**，本次不会写入任何数据。',
  'web.ticktick.previewCounts': '将新建 {projects} 个清单、{tags} 个标签、{tasks} 条任务（{ops} 条操作）。',
  'web.ticktick.previewRows': '文件里有 {rows} 行数据：{checklist} 条清单项、{recurring} 条重复任务、{completed} 条已完成。',
  'web.ticktick.skippedTitle': '这些行没有导入：',
  'web.ticktick.unmappedTitle': '这些内容 heyta 目前带不进来（原值保留在导入报告里，不会静默丢掉）：',
  'web.ticktick.confirm': '确认导入',
  'web.ticktick.doneNoop': '导入完成：没有写入任何数据 —— 这份文件已经导过了。',
  'web.ticktick.done': '导入完成：新增 {projects} 个清单、{tags} 个标签、{tasks} 条任务（写了 {ops} 条操作）。',
  'web.ticktick.failure.noHeader': '没找到表头行 —— 这看起来不是滴答清单导出的 CSV。',
  'web.ticktick.failure.noTasks': '表头找到了，但里面没有可导入的任务。',
  'web.ticktick.skip.emptyTitle': '标题为空（{count} 行）',
  'web.ticktick.skip.duplicateSourceId': '同一份文件里重复的 taskId（{count} 行）',
  'web.ticktick.unmapped.reminder': '提醒（{count} 处）',
  'web.ticktick.unmapped.startDate': '开始时间（{count} 处）',
  'web.ticktick.unmapped.parentId': '父子关系（{count} 处）',
  'web.ticktick.unmapped.isFloating': '浮动时间（{count} 处）',
  'web.ticktick.unmapped.columnName': '看板分组名（{count} 处）',
  'web.ticktick.unmapped.columnOrder': '看板分组顺序（{count} 处）',
  'web.ticktick.unmapped.viewMode': '视图模式（{count} 处）',
  'web.ticktick.unmapped.timezone': '时区（{count} 处）',
  'web.ticktick.unmapped.archiveStatus': '归档状态（{count} 处）',
  'web.ticktick.unmapped.priority': '优先级取值（{count} 处）',
  'web.ticktick.unmapped.status': '状态取值（{count} 处）',
  'web.ticktick.unmapped.kind': '条目类型（{count} 处）',
  'web.ticktick.unmapped.repeat': '重复规则（{count} 处）',
  'web.ticktick.unmapped.missingSourceId': '缺少 taskId（{count} 行）',

  // ═══════════════════════════════════════════════════════════
  // 移动端（apps/mobile）
  // ═══════════════════════════════════════════════════════════

  // ── 移动端 · 跨屏共用 ─────────────────────────────────────
  'mobile.common.today': '今天',
  'mobile.common.cancel': '取消',
  'mobile.common.add': '添加',
  'mobile.common.prevMonth': '上个月',
  'mobile.common.nextMonth': '下个月',
  'mobile.common.sync': '同步',
  // `Checkbox` 与 `Badge` 的**兜底**无障碍名（调用方传了 label 就用调用方的）。
  // 两者是通用控件，所以用 `common.*` 而不是 `tasks.*`。
  'mobile.common.complete': '标记完成',
  'mobile.common.uncomplete': '取消完成',
  'mobile.common.badge.new': '有新内容',
  'mobile.common.badge.count': '{count} 项',
  // 🔴 中文不分单复数，所以 `…One` 与复数版**逐字相同**（en 侧才会不同）。
  // 这不是漏翻：调用方按数量分支是为了英文语法，中文两个分支理应给同一句话。
  'mobile.common.badge.countOne': '{count} 项',

  // 一周列头，下标 0 = 周一（与 domain 的 monthGrid / isoWeekday 对齐）。
  // 七个单字各占一行：词条表是**逐行**解析的，写成数组会直接破坏门禁。
  // ── 中性的日期措辞（四端共用，见 packages/ui/src/calendar/date-text.ts）──
  // ⚠️ 与下面 `mobile.weekday.*` 的**取值必须逐字相同**：两套 key 存在只是因为
  //    `mobile.*` 是历史命名，而日历现在四端共用一份实现。这里刻意**不删** mobile 那套
  //    （移动端其余地方仍在用），但日历走这一套。
  'common.weekday.mon': '一',
  'common.weekday.tue': '二',
  'common.weekday.wed': '三',
  'common.weekday.thu': '四',
  'common.weekday.fri': '五',
  'common.weekday.sat': '六',
  'common.weekday.sun': '日',
  // R13 年档的标题。🔴 它必须**单独有一条**，不能拿 `monthTitle` 顶：
  // 年档摊开的是整年 12 个月，标题说「2026年10月」会把人指回某一个格子。
  // 英文那边就是裸年份 —— 中文需要一个「年」字才读得出这是个年份而不是编号。
  'common.date.yearTitle': '{year}年',
  'common.date.monthTitle': '{year}年{month}月',
  'common.date.dayTitle': '{month}月{day}日 星期{weekday}',
  // R11 批三：周视图的标题。**措辞按 locale 各排一次序**（中文把年份放在最前，
  // 英文把它放在最后），所以这里给的是**整条区间**的图案，不是两截日期。
  // ⚠️ 不带年份的"10月26日 – 11月1日"在跨年那一周（12/29 – 1/4）会读不出是哪一年。
  'common.date.weekRangeTitle': '{year}年{startMonth}月{startDay}日 – {endMonth}月{endDay}日',
  // ── 日历（Web）── 取值与 `mobile.calendar.*` **逐字相同**（同一块共享 UI，
  //    两端说法必须一致；key 分两套只是因为命名空间按端划分）。
  // ── 全局搜索（任务 + 便签 + 快速跳转）── 2026-10-01 起它是**唯一**的搜索入口
  //    （顶栏那个"当前列表筛选"输入框已删），形态与边界见
  //    packages/ui/src/search/SearchPanel.tsx 文件头。
  // ── 提醒通知（#2）──
  'web.reminder.notify.title': '提醒通知',
  'web.reminder.notify.intro': '开启后，提醒到点时会发一条系统通知。',
  'web.reminder.notify.request': '开启通知',
  'web.reminder.notify.granted': '已开启 —— 提醒到点会通知你。',
  'web.reminder.notify.denied': '通知已被浏览器拒绝。要重新开启，请在浏览器的站点设置里改。',
  'web.reminder.notify.unsupported': '当前浏览器或连接不支持系统通知。',
  'web.reminder.notify.requestFailed': '浏览器没有完成通知权限申请。请重试，或检查站点设置。',
  'web.reminder.notify.limit': '通知只在 heyta 开着的时候发得出来。应用关掉后不会响 —— 后台唤醒需要另一套协议，目前还没有。',
  'web.reminder.notify.body': '该做「{title}」了',
  // ── 提醒的**长提前量档位**（W9 ①，2026-10-03）──
  // 🔴 这四条**必须与 `REMINDER_LONG_OFFSET_PRESETS_MS` 一一对应**，映射写在
  //    `apps/web/src/features/reminders/reminder-tiers.ts` 的 `longOffsetMessageKey`
  //    （`default` 分支直接抛，就是防"领域层加了一档、这里忘了补 key"）。
  // ⚠️ 键名里的 `2d/3d/1w/30d` 是契约的一部分：文案说"提前 3 天"，宿主就必须建
  //    "截止前 3 个**日历日**"（不是 72 小时 —— 跨夏令时会漂一小时，见 W9 ③）。
  // 为什么单独一组、不并进上面的 `reminder.offset.*`：那一组是共享组件
  // `ReminderList` 的下标契约（web 与 mobile 各有一份 key 数组），移动端还没有
  // 这几档的词条，硬并进去会让移动端一打开提醒面板就抛。
  'web.reminder.offset.groupLabel': '更早（按天）',
  'web.reminder.offset.2d': '提前 2 天',
  'web.reminder.offset.3d': '提前 3 天',
  'web.reminder.offset.1w': '提前 1 周',
  'web.reminder.offset.30d': '提前 30 天',
  'web.search.title': '搜索',
  'web.search.placeholder': '搜任务标题、备注、便签正文',
  'web.search.tasksSection': '任务',
  'web.search.notesSection': '便签',
  'web.search.quickSection': '快速跳转',
  'web.search.hint.view': '视图',
  'web.search.hint.project': '清单',
  'web.search.hint.tag': '标签',
  'web.search.prompt': '输入关键词。多个词之间是「都要包含」。',
  'web.search.noResults': '没有找到匹配的任务、便签或入口。',
  'web.search.count': '{count} 条',
  // 🔴 键位符号与词**一条写完**：拆成"符号 + 词"两段再拼，英文侧就会出现
  // "Navigate ↑↓" 那种倒装 —— 符号在词前还是词后正是语言差异，不是排版差异。
  'web.search.keys.navigate': '↑↓ 选择',
  'web.search.keys.open': '↵ 打开',
  'web.search.keys.close': 'esc 关闭',
  'web.calendar.title': '日历',
  'web.calendar.prevMonth': '上个月',
  'web.calendar.nextMonth': '下个月',
  // 🔴 轴整列空白时必须说这一句：不说，"这天没定到具体时刻"与"日视图没接上数据"
  //    在界面上长得一模一样（后者本仓为它记过一整页账）。
  'web.calendar.weekShort': '{n}周',
  'web.calendar.backToToday': '回到今天',
  'web.calendar.monthTitle': '{year}年{month}月',
  'web.calendar.dayTitle': '{month}月{day}日 星期{weekday}',
  'web.calendar.dayEmpty': '这一天没有到期的任务。',
  'web.calendar.footnote': '未设截止时间的任务不在日历上，它们在「任务」页的收集箱里。',
  'web.calendar.a11y.dayWithTasks': '{date}，{count} 个任务',
  'web.calendar.a11y.dayWithTasksOne': '{date}，{count} 个任务',
  'web.calendar.a11y.dayNoTasks': '{date}，没有任务',
  'web.calendar.a11y.moreTasks': '还有 {count} 项',
  'web.calendar.side.aria': '日历侧栏',
  'web.calendar.sidebar.show': '显示日历侧栏',
  'web.calendar.sidebar.hide': '隐藏日历侧栏',
  'web.calendar.mini.aria': '迷你月历',
  'web.calendar.scope.all': '所有',
  'web.calendar.scope.allAria': '显示全部任务',
  'web.calendar.scope.groupProject': '全选或清空清单',
  'web.calendar.scope.groupTag': '全选或清空标签',
  'web.calendar.scope.project': '在日历上显示清单「{name}」的任务',
  'web.calendar.scope.tag': '在日历上显示标签「{name}」的任务',
  'web.calendar.scope.active': '筛选中：{names}',
  'web.calendar.scope.activeCount': '已筛选 {count} 项',
  'web.calendar.scope.projectSummary': '清单：{name}',
  'web.calendar.scope.tagSummary': '标签：{name}',
  'web.calendar.scope.separator': '、以及 ',
  'web.calendar.scope.reset': '清除筛选',

  'mobile.weekday.mon': '一',
  'mobile.weekday.tue': '二',
  'mobile.weekday.wed': '三',
  'mobile.weekday.thu': '四',
  'mobile.weekday.fri': '五',
  'mobile.weekday.sat': '六',
  'mobile.weekday.sun': '日',

  // ── 移动端 · 底部标签栏 ───────────────────────────────────
  'mobile.tab.tasks': '任务',
  'mobile.tab.calendar': '日历',
  'mobile.tab.focus': '专注',
  'mobile.tab.profile': '我的',
  'mobile.tab.categories': '分类',

  // ── 移动端 · 分类时长 ──────────────────────────────────────
  // 🔴 这一组里**只许有事实句**：某类做了多久、这些时间怎么算出来的。
  //    没有"最多/最少/失衡/超标"，也没有排名与占比（见计划 §2 反需求）。
  // ⚠️ 文案与 `web.categories.*` **逐字相同**（移动端交互不同处除外）：
  //    两端说同一件事就不该有两种说法，将来合并命名空间时这是一次纯改名。
  'mobile.categories.title': '分类时长',
  'mobile.categories.note': '按清单与习惯各自统计近 12 周的专注与打卡时间。颜色由你自己赋义，这一页不做任何评价。',
  'mobile.categories.empty': '还没有可以归类的时间记录。用清单组织任务、或用习惯记下时长，这里就会长出内容。',
  'mobile.categories.range': '{start} 至 {end}',
  'mobile.categories.kind.project': '清单',
  'mobile.categories.kind.habit': '习惯',
  'mobile.categories.slot.none': '无',
  'mobile.categories.duration.minutes': '{minutes} 分钟',
  'mobile.categories.duration.hours': '{hours} 小时',
  'mobile.categories.duration.hoursMinutes': '{hours} 小时 {minutes} 分',
  'mobile.categories.lane.a11y': '{name}（{kind}），共 {duration}',
  'mobile.categories.unassigned': '另有 {duration}没有归到任何清单或习惯 —— 给任务指定清单，它就会归位。',
  'mobile.categories.hint.unset': '点行首的色块可以给这一类挑颜色（1–8 任意一个）。颜色只是标记，方便你认出它。',
  'mobile.categories.cell.none': '这一周没有记录',
  'mobile.categories.picker.toggle': '给「{name}」设置分类颜色',
  'mobile.categories.picker.group': '「{name}」的分类颜色',
  'mobile.categories.picker.slot': '色槽 {slot}',


  // ── 移动端 · 截止时间 ─────────────────────────────────────
  // 阈值照搬 domain 的 formatRemaining：今天 / 明天 / 后天 / 还剩 N 天。
  'mobile.due.overdue': '已逾期 {days} 天',
  // 同 `mobile.common.badge.countOne`：中文无单复数，刻意逐字相同。
  'mobile.due.overdueOne': '已逾期 {days} 天',
  'mobile.due.tomorrow': '明天',
  'mobile.due.dayAfterTomorrow': '后天',
  'mobile.due.remaining': '还剩 {days} 天',

  // ── 移动端 · 重复规则 ─────────────────────────────────────
  //
  // 这一段是**照抄** `packages/domain/src/recurrence.ts` 里 `describeRecurrence`
  // 的中文输出。域层继续回答"这条规则是什么意思"（`recurrenceParts` 给出结构化的
  // freq/interval/日期），措辞搬到这里 —— 否则英文界面上会直接漏出中文句子
  // （「每周一、三」），而它是跨包的返回值，界面语言门禁扫不到。
  //
  // 🔴 `apps/mobile/tests/recurrence-display.spec.ts` 拿 `describeRecurrence`
  // 当**独立参照**逐条比对：这里改错一个字，测试就红（而不是"看起来没问题"）。
  //
  // ⚠️ 有些片段带**前导空格**（如 `monthDay.n` = ' {n} 日'）：它们是被拼进句子的
  // 构件，不是能独立成立的句子。旧实现在"数字日"与"最后一天"之间做了一次
  // 「首字符是不是数字」的条件判断来决定要不要空格，把空格放进片段里就完全
  // 不需要那个判断了。
  // 列举分隔符（「、」/「, 」）**刻意不在词条表里** —— 它在
  // `apps/mobile/src/lib/recurrence-display.ts` 的一张 `Record<Locale, string>` 里。
  // 理由：它是**正字法**，不是文案；而中文侧的值只有一个标点，
  // 会让 `catalog.spec.ts` 的"中文词条必须含汉字"判为违规 ——
  // 那条规则是**对的**（一条只有标点的词条没办法自查语言）。
  'mobile.recurrence.daily': '每天',
  'mobile.recurrence.dailyEvery': '每 {n} 天',
  'mobile.recurrence.weekly': '每周',
  'mobile.recurrence.weeklyEvery': '每 {n} 周',
  'mobile.recurrence.weeklyOn': '每周{days}',
  'mobile.recurrence.weeklyOnEvery': '每 {n} 周{days}',
  'mobile.recurrence.monthly': '每月',
  'mobile.recurrence.monthlyEvery': '每 {n} 月',
  // 「按月第几天」与「按月第几个星期几」用的是同一个句子形状，共用一条词条。
  'mobile.recurrence.monthlyOn': '每月{days}',
  'mobile.recurrence.monthlyOnEvery': '每 {n} 月{days}',
  'mobile.recurrence.yearly': '每年',
  'mobile.recurrence.yearlyEvery': '每 {n} 年',
  'mobile.recurrence.yearlyInMonths': '每年 {months}',
  'mobile.recurrence.yearlyInMonthsEvery': '每 {n} 年 {months}',
  'mobile.recurrence.yearlyOnMonthDays': '每年 {months} {days}',
  'mobile.recurrence.yearlyOnMonthDaysEvery': '每 {n} 年 {months} {days}',
  // 「按月」里的那个日：带前导空格，与 `每月` 拼出「每月 14 日」，
  // 而与「最后一天」拼出「每月最后一天」——两者都是旧输出，逐字一致。
  'mobile.recurrence.monthDay.n': ' {n} 日',
  // 「按年」里那个日不带前导空格，空格由 `yearlyOnMonthDays` 的模板给。
  'mobile.recurrence.yearDay.n': '{n} 日',
  'mobile.recurrence.day.last': '最后一天',
  'mobile.recurrence.day.beforeEnd': '倒数第 {n} 天',
  'mobile.recurrence.byDay.plain': '周{weekday}',
  'mobile.recurrence.byDay.nth': '{ordinal} 个周{weekday}',
  'mobile.recurrence.byDay.last': '最后一个周{weekday}',
  'mobile.recurrence.byDay.beforeLast': '倒数{ordinal} 个周{weekday}',
  // 序数词条自带「第」：中文句子由 `{ordinal} 个周{weekday}` 拼成
  // 「第 2 个周三」，英文则要 `second`。数字只用得到 1–5（一个月里最多五个同星期几），
  // 更大的一律走 `ordinal.n` 兜底。
  'mobile.recurrence.ordinal.1': '第 1',
  'mobile.recurrence.ordinal.2': '第 2',
  'mobile.recurrence.ordinal.3': '第 3',
  'mobile.recurrence.ordinal.4': '第 4',
  'mobile.recurrence.ordinal.5': '第 5',
  'mobile.recurrence.ordinal.n': '第 {n}',
  // 星期只给一个汉字：旧输出是「每周一、三」，不是「每周一、周三」。
  'mobile.recurrence.weekday.mo': '一',
  'mobile.recurrence.weekday.tu': '二',
  'mobile.recurrence.weekday.we': '三',
  'mobile.recurrence.weekday.th': '四',
  'mobile.recurrence.weekday.fr': '五',
  'mobile.recurrence.weekday.sa': '六',
  'mobile.recurrence.weekday.su': '日',
  // 月份是「数字 + 月」，与旧输出一致（英文侧才是 September）。
  'mobile.recurrence.month.1': '1 月',
  'mobile.recurrence.month.2': '2 月',
  'mobile.recurrence.month.3': '3 月',
  'mobile.recurrence.month.4': '4 月',
  'mobile.recurrence.month.5': '5 月',
  'mobile.recurrence.month.6': '6 月',
  'mobile.recurrence.month.7': '7 月',
  'mobile.recurrence.month.8': '8 月',
  'mobile.recurrence.month.9': '9 月',
  'mobile.recurrence.month.10': '10 月',
  'mobile.recurrence.month.11': '11 月',
  'mobile.recurrence.month.12': '12 月',

  // ── 移动端 · 优先级 ───────────────────────────────────────
  'mobile.priority.none': '无',
  'mobile.priority.low': '低',
  'mobile.priority.medium': '中',
  'mobile.priority.high': '高',
  'mobile.priority.badge': '{level}优先级',

  // ── 移动端 · 任务屏 ───────────────────────────────────────
  'mobile.tasks.title': '任务',
  'mobile.tasks.new': '新建任务',
  'mobile.tasks.composer.placeholder': '要做什么？',
  'mobile.tasks.composer.close': '关闭新建面板',

  // ── 移动端 · 全局搜索（共享 `SearchPanel` 的第二宿主）───────
  //    面板本体的文案仍走 `web.search.*`（同一块界面，不另抄一份词条）。
  //    🔴 这里只放**移动端独有**的三条：入口与出口的无障碍名，以及
  //    `web.search.noResults` 那句"没有找到匹配的任务、便签或**入口**"——
  //    移动端没有「快速跳转」那一组（手机上没有可跳转的侧栏目的地），
  //    沿用那句就是对着用户许诺一个点不出来的东西。
  'mobile.search.open': '打开搜索',
  'mobile.search.close': '关闭搜索',
  'mobile.search.noResults': '没有找到匹配的任务或便签。',

  // ── 移动端 · 一句话捕获（`capture` 整刀的尾巴）──────────────
  //    🔴 这些键补的是**两端不一致**：web 的捕获框能认「明天」「!1」并显示
  //    识别芯片，而移动端一直以来只是一个纯标题输入框 —— 同一句话在两端
  //    建出不同的任务。现在两端共用同一个 `@heyta/ui` 的 `CaptureComposer`，
  //    差别只剩措辞。
  'mobile.capture.placeholder': '添加任务（可写「明天」「下周三」「!1」）',
  'mobile.capture.addLabel': '新任务标题',
  'mobile.capture.add': '添加',
  'mobile.capture.matchesAria': '识别出的字段',
  'mobile.capture.rejected': '已忽略（当作标题文字）',
  'mobile.capture.restoreAria': '恢复识别：{raw}',
  'mobile.capture.ignoreAria': '忽略识别：{raw}',
  'mobile.capture.unused': '未采用，仍在标题中',
  'mobile.capture.previewLead': '实际标题：',
  'mobile.capture.previewEmpty': '（空）',
  'mobile.capture.valueWithRemaining': '截止 {date}（{remaining}）',
  'mobile.tasks.loadError.title': '打开本地数据库失败',
  'mobile.tasks.loadError.hint': '数据在本地，不会丢。重开应用通常能恢复。',
  'mobile.tasks.loadError.detail': '技术细节：{detail}',
  'mobile.tasks.loading.title': '正在打开本地数据',
  'mobile.tasks.loading.hint': '正在恢复到上次关闭前的状态，稍等片刻。',
  'mobile.tasks.summary.empty': '还没有任务',
  'mobile.tasks.summary.counts': '{pending} 项待办，{completed} 项已完成',
  'mobile.tasks.empty.title': '今天还没有安排',
  'mobile.tasks.empty.hint': '点右下角的加号，写下第一件事。',
  'mobile.tasks.mode.date': '日期',
  'mobile.tasks.tagFilter.all': '全部',
  'mobile.tasks.mode.countdown': '倒计时',
  // 同一页上的两种视图。**不是两个 tab** —— 见 ADR-0015 §4。
  'mobile.tasks.viewOptions.title': '视图选项',
  'mobile.tasks.viewOptions.open': '视图选项：{view}',
  'mobile.tasks.viewOptions.close': '关闭视图选项',
  'mobile.tasks.viewOptions.dueMode': '日期显示',
  'mobile.detail.schedule.open': '展开排期',
  'mobile.detail.schedule.close': '收起排期',
  'mobile.tasks.view.list': '列表',
  'mobile.tasks.view.quadrant': '四象限',
  // 时间线那一档（`timeline` 整刀第 3 步）。**只加这一条**：
  // 时间线自己的文案（`web.gantt.*` / `web.timeline.*`，共 20 余条）全部**复用**
  // web 的 —— 与 `lib/quadrant-display.ts` 复用 `web.quadrant.*` 同一先例。
  'mobile.tasks.view.timeline': '时间线',
  // 四象限分组。与 `web.quadrant.q1..q4` 同义，但按壳分命名空间 ——
  // 与 `landing.quadrant.q1..q4` 的存在是同一个理由：文案各壳可独立演进。
  'mobile.tasks.quadrant.empty': '这里还没有任务',
  'mobile.tasks.group.overdue': '已过期',
  'mobile.tasks.group.inbox': '收集箱',
  'mobile.tasks.group.completed': '已完成',
  // 排序控件。**档位名复用 `web.shell.sort.*`**（四端同义，不新增同义键 ——
  // 与 `lib/quadrant-display.ts` 复用 `web.quadrant.*` 是同一个先例）。
  // 这里只补移动端独有的两句：chip 上"当前是哪一档"的模板，与选择面板的标题/关闭。
  'mobile.tasks.sort.label': '排序：{sort}',
  'mobile.tasks.sort.choose': '选择排序方式',
  'mobile.tasks.sort.close': '关闭排序选择',
  'mobile.tasks.a11y.complete': '完成：{title}',
  'mobile.tasks.a11y.uncomplete': '取消完成：{title}',
  'mobile.tasks.a11y.open': '打开任务：{title}',
  'mobile.tasks.a11y.openRepeat': '打开任务：{title}，重复：{repeat}',
  'mobile.tasks.a11y.delete': '删除任务：{title}',
  'mobile.tasks.gestureHint': '长按任务可多选；在四象限里点「更多」即可移动任务。',

  // ── 移动端 · 日历 ─────────────────────────────────────────
  'mobile.calendar.title': '日历',
  'mobile.calendar.monthTitle': '{year}年{month}月',
  'mobile.calendar.dayTitle': '{month}月{day}日 星期{weekday}',
  'mobile.calendar.dayEmpty': '这一天没有到期的任务。',
  'mobile.calendar.backToToday': '回到今天',
  'mobile.calendar.footnote': '未设截止时间的任务不在日历上，它们在「任务」页的收集箱里。',
  'mobile.calendar.a11y.dayWithTasks': '{date}，{count} 个任务',
  // 同 `mobile.common.badge.countOne`：中文无单复数，刻意逐字相同。
  'mobile.calendar.a11y.dayWithTasksOne': '{date}，{count} 个任务',
  'mobile.calendar.a11y.dayNoTasks': '{date}，没有任务',
  'mobile.calendar.a11y.moreTasks': '还有 {count} 项',
  'mobile.calendar.a11y.markDone': '标记完成：{title}',
  'mobile.calendar.a11y.unmarkDone': '取消完成：{title}',

  // ── 移动端 · 日期选择器 ───────────────────────────────────
  'mobile.datePicker.clear': '清除',
  'mobile.datePicker.dayLabel': '{month}月{day}日',
  'mobile.quickDate.tomorrow': '明天',
  'mobile.quickDate.weekend': '本周末',
  'mobile.quickDate.nextWeek': '下周一',

  // ── 移动端 · 专注屏 ───────────────────────────────────────
  'mobile.focus.title': '专注',
  'mobile.focus.kind.work': '专注',
  'mobile.focus.kind.shortBreak': '短休息',
  'mobile.focus.kind.longBreak': '长休息',
  'mobile.focus.phase.paused': '已暂停',
  'mobile.focus.phase.idle': '准备好了就开始',
  'mobile.focus.phase.working': '专注中',
  'mobile.focus.phase.breaking': '休息中',
  // 进度环的无障碍名。手机端原来是一条水平进度条（没有这条），
  // M3 第二刀把进度环收进共享层后，两端都需要它。
  'mobile.focus.a11y.progress': '进度 {percent}%',
  'mobile.focus.action.pause': '暂停',
  'mobile.focus.action.resume': '继续',
  'mobile.focus.action.startWork': '开始专注',
  'mobile.focus.action.startBreak': '开始休息',
  'mobile.focus.abort': '放弃这一轮',
  // 落盘/打开失败时给用户看的句子。`{reason}` 是底层实现的原始文本（数据，不翻译），
  // 所以句子本身必须在壳里拼 —— `lib/focus-timer.ts` 是纯 store，拿不到 `t`。
  'mobile.focus.error.saveFailed': '专注记录保存失败：{reason}',
  'mobile.focus.error.openFailed': '打不开本地数据库：{reason}',
  'mobile.focus.roundLength': '本轮 {duration}',
  'mobile.focus.linkedTask': '关联任务',
  'mobile.focus.changeTask': '换一个任务',
  'mobile.focus.noPending': '还没有待办任务。去「任务」页建一个，就能把它和专注关联起来。',
  'mobile.focus.a11y.linkTask': '关联任务：{title}',
  'mobile.focus.stats.completed': '完成专注',
  'mobile.focus.stats.focusDuration': '专注时长',
  'mobile.focus.stats.aborted': '中途放弃',
  'mobile.focus.stats.completedValue': '{count} 个',
  'mobile.focus.stats.abortedValue': '{count} 次',
  'mobile.focus.duration.minutes': '{minutes} 分钟',
  'mobile.focus.duration.hours': '{hours} 小时',
  'mobile.focus.duration.hoursMinutes': '{hours} 小时 {minutes} 分钟',

  // ── 移动端 · 任务详情面板 ─────────────────────────────────
  'mobile.detail.title': '任务详情',
  'mobile.detail.close': '关闭任务详情',
  'mobile.detail.field.title': '标题',
  // 🔴 在它之前移动端**没有备注输入框**：`Task.note` 与 `setNote` 都在，
  // 但唯一调用点是 AI（拆解 checklist / 估时写时长）—— 用户自己写不了。
  'mobile.detail.field.note': '备注',
  'mobile.detail.note.placeholder': '写点什么（支持 Markdown）',
  'mobile.detail.note.hint': '离开输入框或关闭面板时保存',
  'mobile.detail.field.dueDate': '截止日期',
  'mobile.detail.field.repeat': '重复',
  'mobile.detail.repeat.none': '不重复',
  'mobile.detail.repeat.current': '当前：{rule}',
  'mobile.detail.repeat.daily': '每天',
  'mobile.detail.repeat.weekly': '每周',
  'mobile.detail.repeat.weekdays': '工作日',
  'mobile.detail.repeat.monthly': '每月',
  'mobile.detail.repeat.yearly': '每年',
  // 自定义 RRULE（B2-3 的移动端尾巴）。在此之前手机只能选预设：
  // 想要"每两周"得去网页上设。错误文案存的是 **key**（见 `TaskDetailSheet`
  // 的 `customError`），所以这里是三条独立词条、不是拼好的句子。
  'mobile.detail.repeat.customLabel': '自定义规则',
  // ⚠️ 例子串必须**带上汉字**（`catalog.spec` 有一条"中文表每一条都含汉字"）——
  //    纯 ASCII 的规则例子会被判成"用英文占位中文"。所以写成「例如 …」。
  'mobile.detail.repeat.customPlaceholder': '例如 FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
  'mobile.detail.repeat.customHint': '按 iCalendar RRULE 写；不确定就先按上面的预设选。',
  'mobile.detail.repeat.customApply': '应用规则',
  'mobile.detail.repeat.error.empty': '规则不能为空。',
  'mobile.detail.repeat.error.invalid': '这不是一条合法的重复规则（需要 FREQ=DAILY / WEEKLY / MONTHLY …）。',
  'mobile.detail.field.priority': '优先级',
  // 四象限的第一个轴。**第二个轴（紧急）没有对应的开关** ——
  // 它由截止时间推导，不该让人填两遍（ADR-0015 §3）。
  'mobile.detail.field.important': '重要',
  'mobile.detail.important.hint': '紧急程度由截止时间推导，不由你填。',
  // ── 清单归属 ──────────────────────────────────────────────────────────
  // 「收集箱」是**未归类**的显示名，不是一条真的清单：`Task.projectId`
  // 为 `undefined` 时它不存在于任何 PROJECT 实体里。所以这里它是选项之一，
  // 但**不能**出现在「我的」页的清单管理列表里（那里列的是真实体）。
  'mobile.detail.field.project': '清单',
  'mobile.detail.field.parent': '上级任务',
  'mobile.detail.parent.topLevel': '（顶级任务）',
  'mobile.detail.project.inbox': '收集箱',
  'mobile.detail.project.create': '新建清单',
  'mobile.detail.project.newPlaceholder': '清单名称',
  // 🔴 这一族是 `common.`：清单/标签的**空态**在 web 侧栏与移动端清单页是
  // 同一句话（共享实现 `OrganizerList` 的 `labels.empty/emptyHint`）。
  // 它原来叫 `mobile.lists.*`，于是 web 那边要么另写一份、要么不接线 ——
  // 两个结果都不对（web 侧栏空清单时**什么都不显示**就是后者）。
  'common.organizer.lists.empty': '还没有清单',
  'common.organizer.lists.empty.hint': '点右侧 + 新建清单。',
  'mobile.lists.nameLabel': '清单名称',
  'mobile.lists.newPlaceholder': '给新清单起个名字',
  'mobile.lists.add': '新建清单',
  // 删除清单**不删里面的任务**（见 `project-actions.ts` 文件头第 2 条）。
  // 这句话必须写在界面上：不说的话，用户会以为删除等于连任务一起删掉，
  // 于是**不敢删**——一个不敢用的功能等于没有。
  'mobile.lists.removeHint': '删除清单不会删掉里面的任务，它们会回到「收集箱」。',
  'mobile.lists.remove': '删除清单「{name}」',
  // ── 行内改名 / 归档（2026-10-03 多端第二批）─────────────────
  // 这几句由共享组件 `OrganizerList` 的 `labels.rename` / `labels.archive` 消费，
  // 两端同一套 —— 同一句话不许两个端各写一份。
  // 🔴 无障碍名必须带上是哪一条：读屏用户听到一串「重命名」而无从分辨改哪个。
  'common.organizer.rename.button': '重命名「{name}」',
  'common.organizer.rename.save': '保存名称',
  'common.organizer.rename.cancel': '取消改名',
  // 归档 = 隐藏但保留数据。「归档」和「取消归档」必须是两句话术 ——
  // 两个状态都叫同一个名字的按钮，用户按第二下时不知道自己在做什么。
  'common.organizer.archive.button': '归档「{name}」',
  'common.organizer.archive.unarchive': '取消归档「{name}」',
  'common.organizer.folder.button': '把「{name}」移入文件夹',
  'common.organizer.folder.title': '移入文件夹',
  'common.organizer.folder.none': '不放进文件夹（顶级）',
  'common.organizer.folder.current': '（当前位置）',
  'common.organizer.folder.reject.projectNotFound': '这条清单已经不在了（可能刚被删除，或同步还没到）',
  'common.organizer.folder.reject.parentNotFound': '目标文件夹不存在',
  'common.organizer.folder.reject.self': '清单不能放进它自己里面',
  'common.organizer.folder.reject.cycle': '这样会形成循环：清单不能放进自己的子清单里',
  'common.organizer.folder.reject.parentNotTopLevel': '文件夹里只能放清单，不能再放一个文件夹',
  'common.organizer.folder.reject.hasChildren': '这条清单里面有别的清单，文件夹不能再放进文件夹',
  'common.organizer.folder.reject.unknown': '移动失败，请稍后重试',
  'common.organizer.showArchived': '显示已归档',
  'common.organizer.hideArchived': '收起已归档',
  // ── 删除确认（2026-10-03 回收站与归档 W4b）────────────────────
  // 由共享组件 `OrganizerList` 的 `labels.confirmRemove` 消费，两端同一套。
  // 🔴 `impactTags` 这一句是这一档存在的全部理由，两个方向的误判都要堵上：
  // 「它挂在 8 条任务上」会被读成"删它会动那 8 条任务"（于是不敢删）；
  // 而"标签随时可以再建一个"也不成立 —— 新建的同名标签是**新 id**，
  // 那 8 条任务的归属不会自己回来。
  'common.organizer.confirm.ask': '确定要删除「{name}」吗？',
  'common.organizer.confirm.impactTags': '它挂在 {count} 条任务上。这些任务不会被删除，只是不再带这个标签。',
  'common.organizer.confirm.delete': '确认删除',
  'common.organizer.confirm.cancel': '取消删除',
  // 习惯的改名与删除入口（保存/取消复用上面那两句，不另立一份同义词条）。
  'common.habits.rename.button': '重命名习惯「{name}」',
  'common.habits.rename.label': '习惯名称',
  'common.habits.delete.button': '删除习惯「{name}」',
  // 工单 W6：计数型习惯"今天记了几格"。句子写成 `{value}/{target}{unit}` 而不是
  // 三个占位符裸串 —— 纯占位符的 zh 词条在 `check:ui-language` 眼里与"忘了翻译"同一件事。
  'common.habits.amount.today': '今天 {value}/{target} {unit}',
  'common.habits.amount.plus': '给「{name}」加 1',
  'common.habits.amount.minus': '给「{name}」减 1',

  // ── 标签 ───────────────────────────────────────────────────
  // 清单和标签在数据上是两个实体，在产品上是同一件事的两个面（组织任务）：
  // 清单回答"它属于哪个容器"（一个），标签回答"它还跟什么有关"（多个）。
  'mobile.profile.section.tags': '标签',
  'common.organizer.tags.empty': '还没有标签',
  'common.organizer.tags.empty.hint': '点右侧 + 新建标签。',
  'mobile.tags.nameLabel': '标签名称',
  'mobile.tags.newPlaceholder': '给新标签起个名字',
  'mobile.tags.add': '新建标签',
  // 与清单那条同理，但这里更微妙：用户看到"这个标签在 5 个任务上用着"时，
  // 会以为删除等于动那 5 个任务。不说清楚就会**不敢删**。
  'mobile.tags.removeHint': '删除标签不会删掉任何任务，只是把它们身上的这个标签摘掉。',
  'mobile.tags.remove': '删除标签「{name}」',
  'mobile.detail.field.tags': '标签',
  // 一个标签都没有时的提示。指向「我的」页 —— 那里是唯一能新建标签的地方，
  // 不指路的话用户会以为"这里应该有东西可点，只是坏了"。
  'mobile.detail.tags.empty': '还没有标签，先到「我的」页新建一个。',
  'mobile.detail.important.on': '标记为重要',
  'mobile.detail.important.off': '取消重要',
  'mobile.detail.markIncomplete': '标记为未完成',
  'mobile.detail.markComplete': '标记为完成',
  'mobile.detail.delete': '删除',

  // ── 移动端 · 欢迎页（规范 §3.1）─────────────────────────────
  // 🔴 「前置」= 冷启动第一屏**一眼看到**、**一步可达**，不是把本地功能锁在登录后面
  //    （规范 §0）。所以这里必须**同时**有主按钮（注册 / 登录）与出口（先离线使用）——
  //    少了出口，应用就从「本地优先」变成「必须联网才能开始用」。
  'mobile.welcome.title': '开始安排今天',
  'mobile.welcome.tagline': '本地优先的任务管理：离线照常可用，数据端到端加密，服务器可以是你自己的。',
  'mobile.welcome.signIn': '注册 / 登录',
  'mobile.welcome.offline': '先离线使用',
  'mobile.welcome.offlineHint': '不登录也能建任务、打卡、专注；以后随时可以在「我的」页登录。',

  // ── 移动端 · 注册 / 登录面板（规范 §3.2）────────────────────
  'mobile.auth.title': '注册 / 登录',
  'mobile.auth.intro': '用邮箱和密码注册或登录。登录成功后，服务器地址、访问令牌与端到端加密口令会自动接上同步。',
  'mobile.auth.email.label': '邮箱',
  'mobile.auth.email.placeholder': '你的邮箱地址',
  'mobile.auth.selfHost.open': '使用自建服务端',
  'mobile.auth.selfHost.close': '收起自建服务端设置',
  'mobile.auth.terms.label': '我同意服务条款与隐私政策，并允许本机联网',
  // 🔴 服务端对 `termsAccepted` 用的是 `z.literal(true)`（规范 §2-A4）——
  //    "同意"这件事只能由用户做出。这句话是给用户的交代，不是客套。
  'mobile.auth.terms.hint': '这一项必须由你自己勾选——我们不会替你同意。',
  // 条款链接**点不开**时说的话。设备上没有能打开网页的应用是真会发生的
  // （桌面 Linux、无浏览器的测试镜像），而"点了没反应"是最容易被当成界面坏了的一种坏法。
  'mobile.auth.link.unopenable': '这台设备上打不开网页，所以条款没能显示出来。',
  // 🔴 口令这条路是**主路**，摆在"别的方式"之上。两句不许写成「注册成功」/
  //    「登录成功」—— 点击只是**发出请求**，结果由状态区那一句说。
  'mobile.auth.password.register': '发送验证码',
  'mobile.auth.password.login': '用邮箱和密码登录',
  // 两条并列的路，不是同一条的快捷方式：邮件链接要多一步"去邮箱"。
  'mobile.auth.magicLink.login': '用邮件链接登录',
  'mobile.auth.magicLink.register': '注册新账号',
  'mobile.auth.passkey.register': '用通行密钥注册',
  'mobile.auth.passkey.login': '用通行密钥登录',
  'mobile.auth.passkey.unavailable': '这台设备暂不支持通行密钥，请使用账号密码或邮件链接登录。',
  'mobile.auth.passkey.waiting': '请在系统弹窗里完成通行密钥操作…',
  'mobile.auth.paste.label': '粘贴邮件里的链接或令牌',
  'mobile.auth.paste.placeholder': '邮件里的完整链接，或那串令牌本身',
  'mobile.auth.verify': '验证并登录',
  // 🔴 **中性文案**（规范 §2-A2）：注册端点对"邮箱已属已验证账号"会**故意**回成功
  //    而不写凭据（防枚举）。所以这两句**不得**出现"账号已创建"这类断言 ——
  //    出现就是应用在对用户说假话。
  'mobile.auth.sent.login': '如果这个邮箱有账号，登录链接已经发出。打开邮件里的链接，或把链接粘回上面的输入框。',
  'mobile.auth.sent.register': '如果这个邮箱可用，我们会发送一封验证邮件。请查收邮件、点开验证链接，然后回到这里登录。',
  // 与 `web.auth.sent.mailNotSent` 同一件事、同一个触发条件（服务端说信没发出去）。
  // 两条不合并成一条是因为移动端那句原本带"如果这个邮箱可用"的中性前缀，
  // 而这一句要说的不是邮箱，是**服务器**。
  'mobile.auth.sent.mailNotSent': '这台服务器没能把验证邮件发出去（多半是没配邮件服务）。账号已经建好，但还没有激活：请让服务器管理员配好 SMTP 后重新提交一次注册；这台服务器只给自己人用时，也可以设 REQUIRE_EMAIL_VERIFICATION=false 跳过这一步。',
  // 验证令牌**不产出会话**（规范 §2-A1），所以验证成功后还要再走一次登录。
  // 这句话要说得像"下一步做什么"，而不是像"失败了"。
  'mobile.auth.emailVerified': '邮箱已验证，但这一步还不发令牌。请再点一次「用邮件链接登录」，把新邮件里的登录链接粘回上面的输入框。',
  'mobile.auth.signedIn.title': '已登录',
  'mobile.auth.signedIn.body': '当前账号：{email}',
  'mobile.auth.passwordNeeded': '还差端到端加密口令。它只存在本机内存里、服务端看不到明文；不填的话同步会在加密那一步明确失败，不会降级成明文。',
  'mobile.auth.registrationCode.title': '验证邮箱',
  'mobile.auth.registrationCode.sent': '验证码已发送到 {email}，输入邮件中的 6 位数字完成注册。',
  'mobile.auth.registrationCode.label': '邮箱验证码',
  'mobile.auth.registrationCode.placeholder': '输入 6 位验证码',
  'mobile.auth.registrationCode.verify': '完成注册',
  'mobile.auth.registrationCode.resend': '重新发送验证码',
  'mobile.auth.registrationCode.resendIn': '{seconds} 秒后可重新发送',
  'mobile.auth.registrationCode.changeEmail': '更改邮箱',
  'mobile.auth.registrationCode.expired': '验证码已过期，请重新发送。',
  'mobile.auth.registrationCode.invalid': '请输入 6 位验证码。',
  'mobile.auth.enableSync': '保存并启用同步',
  'mobile.auth.saveFailed': '口令没能写进本机的同步配置，请重试。',
  'mobile.auth.back': '返回',
  // 本地输入问题，不是协议失败 —— 见 `AuthScreen.failWithKey` 的注释。
  'common.auth.error.termsRequired': '注册前请先勾选同意项——这一项必须由你自己做出，我们不会替你同意。',

  // ── 移动端 · 「我的」屏 ───────────────────────────────────
  'mobile.profile.tools': '整理与记录',
  'mobile.profile.edit': '编辑个人资料',
  'mobile.profile.loading': '正在读取个人资料…',
  'mobile.profile.localOnly': '当前只用本机。可在设置的“同步与隐私”中允许联网后编辑个人资料。',
  'mobile.profile.retry': '重新读取',
  'mobile.profile.title': '我的',
  // 🔴 设置是**独立的第二层表面**（RN Modal），不是「我的」滚动流里的一段 ——
  //    对标 §11.5 的规律（次级表面独立成面）。入口行在「我的」上，内容在设置面里。
  'mobile.settings.section.profile': '个人资料',
  'mobile.settings.section.general': '常规',
  'mobile.settings.section.sync': '同步与隐私',
  'mobile.settings.section.ai': 'AI 与集成',
  'mobile.settings.section.data': '数据管理',
  'mobile.settings.section.security': '账号安全',
  'mobile.settings.directory.title': '偏好与账号',
  'mobile.settings.directory.hint': '选择要调整的内容。',
  'mobile.settings.title': '设置',
  'mobile.settings.close': '关闭',
  'mobile.profile.entry.settings': '设置',
  'mobile.profile.entry.settings.hint': '个人资料、偏好、同步与安全',
  'mobile.profile.section.sync': '同步',
  'mobile.profile.section.status': '状态',
  // 「我的」里那条托管同步权益。只有服务端**明确说**有才显示这一行
  // （`entitled` / `denied`），未配置与探测失败一律不显示 —— 见 `EntitlementSection.tsx`。
  'mobile.profile.entitlement.entitled': '官方托管同步已开启',
  'mobile.profile.section.language': '语言',
  'mobile.profile.section.lists': '清单',
  // 🔴 认证入口在这一屏的**顶部卡片**（一级可见）—— 规范 §3.1 的「前置」落点。
  //    底部标签必须保持 5 个（规范 §2-A8），所以它是入口卡片，不是第 6 个 tab。
  'mobile.profile.section.account': '账号',
  'mobile.profile.section.progress': '近期状态',
  'mobile.profile.progress.tasks': '本周完成任务',
  'mobile.profile.progress.focus': '本周专注分钟',
  'mobile.profile.progress.achievements': '已达成成就',
  'mobile.profile.progress.openGrowth': '查看完整成长',
  'mobile.profile.progress.openGrowthHint': '查看里程碑、习惯连续性和年度趋势。',
  'mobile.profile.progress.loading': '正在读取近期状态…',
  'mobile.profile.progress.error': '近期状态暂时读不到。',
  'mobile.profile.progress.stale': '暂时无法更新，显示上次读取的结果。',
  'mobile.profile.progress.retry': '重新读取',
  'mobile.profile.account.signIn': '注册 / 登录',
  'mobile.profile.account.switchAccount': '切换账号',
  'mobile.profile.account.signInHint': '用邮箱或通行密钥登录；登录后自动接上同步，不必手抄令牌。',
  'mobile.profile.account.signedInLabel': '当前账号',
  'mobile.profile.account.signedInHint': '已拿到访问令牌。要换账号或补一条凭据，重新登录一次即可。',
  'mobile.profile.nickname.hint': '点按这一行即可修改昵称。',
  // 🔴 这一句必须与"图不行"分开：iOS 侧还没有读图通道，说"这张图解不开"会把人
  // 支去换照片，而换多少张都一样。真相是这台设备暂时没有这条通道。
  'mobile.profile.avatar.noChannel': '这台设备还不能读取本机里的图片，请先在网页版更换头像；换好之后这里会显示同一张。',
  'mobile.profile.account.offline': '还没登录',
  // ⚠️ 表单搬进设置面之后，"下面那一段"不再成立 —— 指路要说**现在**的位置，
  // 否则用户在「我的」上找一圈找不到表单，会以为功能没了。
  'mobile.profile.account.offlineHint': '不登录也能使用任务、专注和本地回顾。',
  // 手动路径是**兜底**，不是主路径：从别的设备复制令牌过来时才用它。
  'mobile.profile.sync.manualHint': '下面是手动填写凭据的兜底路径：已经有令牌（比如从别的设备复制过来）时才需要用它。',
  'mobile.profile.sync.officialTitle': 'heyta 官方同步',
  'mobile.profile.sync.officialHint': '登录 heyta 后，任务会自动在设备间同步，不需要填写服务器地址或手抄令牌。',
  'mobile.profile.sync.advancedTitle': '自托管同步',
  'mobile.profile.sync.advancedHint': '只有在你运行自己的 heyta 服务端并已有访问令牌时，才使用这条路径。',
  'mobile.profile.sync.advancedOpen': '使用自托管服务器',
  'mobile.profile.sync.advancedClose': '返回 heyta 官方同步',
  // ⚠️ 必须明说"重开会回到设备语言"：不说的话用户会以为选择被记住了，
  // 下次打开发现变回英文/中文时，会以为是自己点错了。
  'mobile.profile.language.hint': '选择只在本会话内生效，重开应用会回到设备的语言。',
  'mobile.profile.serverUrl.label': '服务器地址',
  'mobile.profile.serverUrl.hint': '模拟器填 10.0.2.2（指向这台电脑）；真机填局域网地址。',
  'mobile.profile.transport.plaintext': '明文连接，且目标不像是本机网段。访问令牌会以明文经过网络、可能被截获。任务内容仍是端到端加密的，但公网请务必改用 https://。',
  'mobile.profile.transport.plaintextLocal': '明文连接（本机/局域网）。任务内容是端到端加密的，但访问令牌会以明文经过网络，只建议在可信网络里这样用。',
  'mobile.profile.token.label': '访问令牌',
  'mobile.profile.token.placeholder': '登录服务端后获得',
  'mobile.profile.password.label': '端到端加密口令',
  'mobile.profile.password.hint': '只存在内存里，应用重启后需要重新输入。服务端看不到明文。',
  'mobile.profile.sync.busy': '正在同步…',
  'mobile.profile.sync.now': '立即同步',
  'mobile.profile.sync.notConfigured': '登录 heyta，让任务在设备间自动同步。',
  'mobile.profile.sync.slowKdf': '这台设备没有 WebAssembly，密钥派生要用纯 JS 逐批计算：首次同步可能要等数十秒到数分钟（历史数据越多越久）。同一会话内之后的同步就会很快。任务内容不受影响，照常可离线使用。',
  'mobile.profile.pending.label': '待上传',
  'mobile.profile.pending.loading': '读取中…',
  'mobile.profile.pending.allUploaded': '已全部上传',
  'mobile.profile.pending.count': '{count} 项',
  // 同 `mobile.common.badge.countOne`：中文无单复数，刻意逐字相同。
  'mobile.profile.pending.countOne': '{count} 项',
  'mobile.profile.lastSync.label': '上次成功同步',
  'mobile.profile.lastSync.never': '从未',
  'mobile.profile.clearCredentials': '清除本机保存的凭据',
  'mobile.vault.title': '加密数据钥匙',
  'mobile.vault.description': '这把钥匙用于解锁已同步的数据。它与登录密码分开，口令和恢复码只留在这台设备上。',
  'mobile.vault.devicesTitle': '已连接设备',
  'mobile.vault.devicesDescription': '撤销会让这个账号的所有设备（包括当前设备）退出登录。设备离线时不会被远程擦除；重新登录后，请在可信设备上轮换数据密钥并迁移保留的密文。',
  'mobile.vault.devicesLoading': '正在加载设备…',
  'mobile.vault.devicesEmpty': '暂时没有可管理的设备。',
  'mobile.vault.devicesLastSeen': '最近活动：{date}',
  'mobile.vault.devicesRevoke': '撤销设备',
  'mobile.vault.devicesRevoking': '正在撤销…',
  'mobile.vault.devicesConfirmTitle': '撤销设备',
  'mobile.vault.devicesConfirm': '撤销后所有设备都必须重新登录。离线设备上的本地数据不会被远程擦除。确定继续吗？',
  'mobile.vault.devicesRevoked': '设备已撤销，所有设备都必须重新登录。请在可信设备重新登录后轮换数据密钥并迁移保留的密文。',
  'mobile.vault.devicesRevocationUncertain': '撤销请求的响应丢失了。本机已先退出登录；重新登录后请核对设备列表，再轮换数据密钥。',
  'mobile.vault.devicesUnauthorized': '会话已失效，请重新登录后再管理设备。',
  'mobile.vault.devicesSessionChanged': '确认期间账号或服务器发生了变化，没有撤销任何设备。',
  'mobile.vault.devicesCleanupFailed': '本机已退出登录，但安全本地清理需要重试后才能再次信任这台设备。',
  'mobile.vault.devicesError': '设备列表或撤销请求失败，请检查网络后重试。',
  'mobile.vault.accountRequired': '请先登录，再管理这个账号的加密数据钥匙。',
  'mobile.vault.createTitle': '创建加密数据钥匙',
  'mobile.vault.passphrase': '加密口令',
  'mobile.vault.create': '创建钥匙',
  'mobile.vault.recoveryLabel': '恢复码',
  'mobile.vault.recoveryHint': '请把这串恢复码保存到密码管理器或离线记录中。它只显示这一次，服务端无法替你找回。',
  'mobile.vault.recoveryResume': '这次轮换已经在之前准备好了。请输入你保存的恢复码以继续。',
  'mobile.vault.recoveryConfirm': '输入恢复码以确认',
  'mobile.vault.confirm': '确认并发布',
  'mobile.vault.cancel': '取消',
  'mobile.vault.unlockTitle': '解锁加密数据',
  'mobile.vault.unlock': '用口令解锁',
  'mobile.vault.recoveryCode': '恢复码',
  'mobile.vault.unlockRecovery': '用恢复码解锁',
  'mobile.vault.ready': '这台设备上的加密数据已经解锁。',
  'mobile.vault.recoveryRotationRequired': '恢复码解锁成功。请先设置新口令并保存新的恢复码，才能使用加密数据。',
  'mobile.vault.legacyMigrationRequired': '旧版加密数据尚未迁移。请使用原加密口令完成数据密钥轮换后，才能同步或写入加密数据。',
  'mobile.vault.lock': '锁定数据钥匙',
  'mobile.vault.remember': '在这台设备上记住解锁状态',
  'mobile.vault.changeTitle': '新的口令与恢复码',
  'mobile.vault.newPassphrase': '新的加密口令',
  'mobile.vault.change': '更换口令',
  'mobile.vault.rotateRoot': '轮换数据密钥并迁移数据',
  'mobile.vault.rootRotationHint': '只有所有保留的加密记录迁移完成后，才会发布新的数据密钥。',
  'mobile.vault.rootRotationProgress': '正在迁移加密数据：{completed}/{total}',
  'mobile.vault.busy': '正在加载加密数据钥匙…',
  'mobile.vault.error': '加密数据钥匙加载或使用失败。本地数据没有变化，请检查服务端后重试。',
  'mobile.vault.errorMismatch': '恢复码不匹配，请准确输入。',
  'mobile.vault.errorRememberedKey': '记住的钥匙不属于这个账号，请用口令或恢复码解锁。',
  'mobile.vault.errorConflict': '另一台设备已经更换了钥匙。请重新加载后再试。',
  'mobile.vault.errorRotation': '服务端要求先完成全部加密数据迁移，才能更换这把钥匙。',
  'mobile.vault.logoutCleanupFailed': '加密钥匙未能从这台设备清除。凭据已清掉；请先重试清理，再使用这个账号。',
  'mobile.vault.retryCleanup': '重试清除加密钥匙',
  'mobile.widgetCleanup.failed': '已退出登录，但这台设备上的小组件还没有清除。请重试。',
  'mobile.widgetCleanup.retry': '重试清除小组件',
  'mobile.widgetCleanup.retrying': '正在重试…',
  // 🔴 这句是**面向用户的陈述**，说错了就是应用在骗人 —— 迁移时可以"只搬不改"，
  // 但每做完一个功能就必须回来改它。原句是"日历、专注、清单与标签管理尚未实现"：
  //   日历（`CalendarScreen`）、专注（`FocusScreen`）先做完 → 去掉；
  //   清单（`ListsSection` + 详情页归属）本轮做完 → 去掉；
  // 现在只剩**标签**还没有管理界面（`createTag` 在 app-host 里有，
  // 但移动端没有入口，而且 `tagIds` 连"指派"的动作都还没有）。
  'mobile.profile.footnote': '凭据只保留在内存中，应用完全退出后需要重新输入。',
  'mobile.profile.conflict.body': '这几处两边都改过，heyta 不会替你挑——自动挑一个会悄悄丢掉另一边的改动。数据没有丢，但选完之前它们不会上传。',
  'mobile.profile.conflict.open': '逐条处理',

  // ── 移动端 · 冲突面板 ─────────────────────────────────────
  'mobile.conflict.title': '这 {count} 处改动两边都改过',
  // 同 `mobile.common.badge.countOne`：中文无单复数，刻意逐字相同。
  'mobile.conflict.titleOne': '这 {count} 处改动两边都改过',
  'mobile.conflict.body': 'heyta 不会替你决定保留哪一版——自动挑一个会悄悄丢掉另一边的改动。每一处都请你看一眼再选；没选的那些会一直留在本地，不会丢。',
  'mobile.conflict.close': '稍后再处理',
  'mobile.conflict.newer': '较新',
  'mobile.conflict.remoteUnavailable': '取不到这一侧的版本',
  'mobile.conflict.keepThis': '保留这一版',
  'mobile.conflict.side.local': '本机',
  'mobile.conflict.side.remote': '其他设备',
  'mobile.conflict.position': '第 {index} 处，共 {total} 处',
  'mobile.conflict.blocked.remoteMissing': '取不到对方那一版，只能先保留本机的',
  'mobile.conflict.choice.local': '已保留本机这一版',
  'mobile.conflict.choice.remote': '已保留其他设备那一版',
  'mobile.conflict.reason.concurrent': '两台设备在对方不知情的时候都改了它',
  'mobile.conflict.reason.superseded': '这条改动基于的版本已经不是最新的了',
  'mobile.conflict.reason.timestampOrTie': '两边的改动时间很接近，分不出先后',
  'mobile.conflict.reason.localTimestamp': '本机的改动更新一些',
  'mobile.conflict.reason.remoteDeleteWins': '另一台设备删除了它',
  'mobile.conflict.reason.localDeleteWins': '本机删除了它',
  'mobile.conflict.reason.remoteArchive': '另一台设备把它归档了',
  'mobile.conflict.reason.localArchive': '本机把它归档了',
  'mobile.conflict.reason.fallback': '两边对同一处做了不同的改动',
  // 载荷摘要：`text` 是用户自己的字（不翻译），`fields` 只报数量 ——
  // 字段名（completedAt 那种）是内部标识符，不能出现在用户可见文案里。
  'mobile.conflict.payload.empty': '（空）',
  'mobile.conflict.payload.fields': '{count} 个字段有改动',
  // 中文无单复数，刻意与复数版逐字相同（en 侧才会不同）。
  'mobile.conflict.payload.fieldsOne': '{count} 个字段有改动',

  // 实体类型 → 名称。键集合必须与 shared-schema 的 ENTITY_TYPES 一致（有测试钉住）。
  'mobile.entity.TASK': '任务',
  'mobile.entity.PROJECT': '清单',
  'mobile.entity.TAG': '标签',
  'mobile.entity.NOTE': '便签',
  'mobile.entity.TASK_REPEAT_CFG': '重复规则',
  'mobile.entity.REMINDER': '提醒',
  'mobile.entity.HABIT': '习惯',
  'mobile.entity.HABIT_LOG': '打卡记录',
  'mobile.entity.FOCUS_SESSION': '专注记录',
  'mobile.entity.AI_FEEDBACK': 'AI 使用记录',
  'mobile.entity.PREFERENCE_CORRECTION': '偏好纠正',
  'mobile.entity.GLOBAL_CONFIG': '全局设置',
  'mobile.entity.MIGRATION': '数据迁移',
  'mobile.entity.RECOVERY': '灾难恢复',
  'mobile.entity.ALL': '全量数据',

  // ── 移动端 · 同步状态 ─────────────────────────────────────
  'mobile.sync.idle': '尚未同步',
  'mobile.sync.downloading': '正在下载…',
  'mobile.sync.uploading': '正在上传…',
  'mobile.sync.synced': '已是最新',
  'mobile.sync.offline': '当前离线',
  'mobile.sync.conflict': '有 {count} 处冲突待你选择',
  // 同 `mobile.common.badge.countOne`：中文无单复数，刻意逐字相同。
  'mobile.sync.conflictOne': '有 {count} 处冲突待你选择',
  'mobile.sync.error': '同步失败',

  // ── 激励 ──
  // 移动端成长屏。数字与 Web 端同源（`@heyta/app-host#motivation`），
  // 所以两端不会各算一套。三条产品红线同时写进文案与界面：
  // 不发行货币、只与自己比、从不制造愧疚。
  'mobile.growth.title': '我的成长',
  'mobile.growth.back': '返回',
  'mobile.growth.entry': '我的成长',
  'mobile.growth.entry.hint': '今日进度、连续天数与里程碑',
  // ── M3 第七刀（habits）：移动端「我的 → 习惯」入口 ──────────
  // 移动端此前**没有**习惯屏（成长屏只读连续数字，连打卡都做不到），
  // 所以标签用「习惯」而不是「我的成长」—— 后者是回顾，这里是操作。
  // ⚠️ 入口放在「我的」的第二层、不加 tab（ADR-0015 §4 与 P10 的连带有判决）。
  'mobile.habits.entry': '习惯',
  'mobile.habits.entry.hint': '打卡、连续天数与热力图',
  'mobile.growth.compare.note': '这里的数字只和过去的自己比，没有排行榜。',

  // 今日进度（L1）
  'mobile.growth.today.title': '今天',
  'mobile.growth.today.a11y': '今天完成 {done} 件，共 {total} 件',
  'mobile.growth.today.hint.idle': '今天还没有记录',
  'mobile.growth.today.hint.unplanned': '计划之外还完成了 {count} 件',
  'mobile.growth.today.hint.allDone': '今天的都完成了',
  'mobile.growth.today.hint.remaining': '还剩 {count} 件',
  'mobile.growth.today.closed': '今天闭环了',
  'mobile.growth.today.habits': '习惯 {done}/{planned}',
  'web.growth.today.habits': '习惯 {done}/{planned}',
  'mobile.growth.today.tasks': '任务 {done}/{planned}',
  'web.growth.today.tasks': '任务 {done}/{planned}',
  'mobile.growth.today.bonus': '计划外 {count} 件',
  'web.growth.today.bonus': '计划外 {count} 件',
  'mobile.growth.today.focus': '专注 {minutes} 分钟',
  'web.growth.today.focus': '专注 {minutes} 分钟',

  // 本周复盘（L3）。差值只用中性表述，不给下降配红色。
  'mobile.growth.week.title': '本周',
  'mobile.growth.week.range': '{start} 至 {end}',
  'mobile.growth.week.empty': '这一周还没有记录',
  'mobile.growth.week.headline.checkIns': '这周打卡 {count} 次',
  'mobile.growth.week.headline.tasksCompleted': '这周完成 {count} 件',
  'mobile.growth.week.headline.focusMinutes': '这周专注 {count} 分钟',
  'mobile.growth.week.stat.checkIns': '打卡',
  'mobile.growth.week.stat.tasks': '完成',
  'mobile.growth.week.stat.focus': '专注',
  'mobile.growth.week.stat.previous': '上周 {count}',
  'mobile.growth.week.bestDay': '最专注的一天：{date}，{minutes} 分钟',

  // 连续性（L2）。最长与累计只增不减，中断之后屏幕上一定有数字没变小。
  'mobile.growth.streak.title': '连续',
  'mobile.growth.streak.note': '最长与累计只增不减——中断不等于失去。',
  'mobile.growth.streak.empty': '还没有习惯。到「我的 → 习惯」创建一个，开始记录。',
  'mobile.growth.streak.current': '当前连续（天）',
  'mobile.growth.streak.longest': '最长 {days} 天',
  'mobile.growth.streak.total': '累计 {count} 天',
  'mobile.growth.streak.repair': '昨天还能补回来——补完是 {days} 天',
  'mobile.growth.streak.freshStart': '距上次 {days} 天。最长 {longest} 天、累计 {total} 天都还在。',
  'mobile.growth.streak.a11y': '{name}：当前连续 {current} 天，最长 {longest} 天，累计 {total} 天',

  // 里程碑（L3）。累计只加不减，没有扣分项。
  'mobile.growth.milestones.title': '里程碑',
  'mobile.growth.milestones.note': '累计只加不减，没有扣分项。',
  'mobile.growth.milestones.maxed': '已到最高一档',
  'mobile.growth.milestones.next': '下一档 {next}',
  'mobile.growth.milestones.a11y': '{name}：当前 {value}，已达成 {reached} 档，共 {total} 档',
  'mobile.growth.kind.checkIns': '打卡',
  'mobile.growth.kind.focusHours': '专注小时',
  'mobile.growth.kind.tasks': '完成任务',
  'mobile.growth.kind.activeDays': '活跃天数',

  // 身份标签（L3）。给的是身份不是奖励，所以没有金币也没有可兑换物。
  'mobile.growth.tags.title': '身份',
  'mobile.growth.tags.note': '身份不是奖励，是你已经做过的事。',
  'mobile.growth.tags.empty': '还没有达成的身份。慢慢来。',
  'mobile.growth.tags.near': '距「{name}」还差 {gap}',
  'mobile.growth.tags.reachedA11y': '已达成：{name}',
  'mobile.growth.tag.started': '坚持一周',
  'mobile.growth.tag.routine': '成为日常',
  'mobile.growth.tag.steady': '稳定百日',
  'mobile.growth.tag.checkin-hundred': '百次打卡',
  'mobile.growth.tag.deep-fifty': '深度五十小时',
  'mobile.growth.tag.deep-two-hundred': '深度两百小时',
  'mobile.growth.tag.finisher-five-hundred': '完成五百件事',
  'mobile.growth.tag.streak-thirty': '连续三十天',

  // ── 回收站（移动端第二层，入口在「我的」）──────────────────
  // ⚠️ 与 Web 的 `web.trash.*` **刻意分开**：移动端的确认文案多一句
  // 「这不是物理擦除」。purge 只写 `purgedAt` 标记，op-log 里的历史载荷
  // （本地与云端）都还在 —— Web 的措辞没有这一句，照抄会漏掉这个事实。
  'mobile.trash.title': '回收站',
  'mobile.trash.entry': '回收站',
  'mobile.trash.entry.hint': '已删除的任务、便签、清单和习惯可以在这里恢复',
  // ── 通知中心 / 活动（批二，多端覆盖审计 P0-2）────────────────────
  //    通知 kind 是封闭词表（referral-activated），措辞与 web 的
  //    web.inbox.* 同口径；服务端只存 kind + payload，话在这里说。
  'mobile.inbox.title': '通知中心',
  'mobile.inbox.back': '返回',
  'mobile.inbox.trigger': '通知',
  'mobile.inbox.entry.hint': '系统消息与邀请好友活动',
  'mobile.inbox.badge.aria': '{count} 条未读',
  'mobile.inbox.tab.notifications': '通知',
  'mobile.inbox.tab.activity': '活动',
  'mobile.inbox.unconfigured': '配置服务器并登录后，这里会显示账号通知。',
  'mobile.inbox.error': '读不到通知 —— 检查网络后重试。',
  'mobile.inbox.retry': '重试',
  'mobile.inbox.loading': '正在加载…',
  'mobile.inbox.empty': '还没有通知',
  'mobile.inbox.notification.referral.title': '邀请奖励已发放',
  'mobile.inbox.notification.referral.body': '{name} 用你的邀请码成功激活，你的会员延长 {days} 天。',
  'mobile.inbox.notification.referral.bodyUnknownActor': '有好友用你的邀请码成功激活，你的会员延长 {days} 天。',
  'mobile.inbox.activity.empty': '还没有进行中的活动',
  'mobile.inbox.invite.title': '邀请好友',
  'mobile.inbox.invite.body': '好友用你的邀请码注册并验证邮箱，你们都得 {days} 天会员。',
  'mobile.inbox.invite.codeLabel': '邀请码',
  'mobile.inbox.invite.codeAria': '邀请码 {code}',
  'mobile.inbox.invite.share': '分享邀请码',
  'mobile.inbox.invite.shareMessage': '我的 heyta 邀请码：{code}',
  'mobile.inbox.invite.shareFailed': '分享不可用 —— 邀请码就在上方，可以手动复制。',
  'mobile.inbox.invite.stats': '已邀请 {invited} · 已激活 {activated} · 已得 {days} 天',
  'mobile.inbox.invite.remaining': '本窗口还可邀请 {count} 人',
  'mobile.inbox.invite.listTitle': '邀请记录',
  'mobile.inbox.invite.status.activated': '已激活',
  'mobile.inbox.invite.status.pending': '待验证',
    'mobile.inbox.invite.unknownName': '好友',
  // ── 从备份还原（批五，多端覆盖审计 P1-2）────────────────────────
  //    失败原因来自 app-host 的封闭集合，措辞在本文件；成功判据里
  //    stateMatchesDocument 由 restoreIntoEmptyTarget 内部两次执行。
  'mobile.restore.title': '从备份还原',
  'mobile.restore.lead': '只支持还原到空库：本机已有任何数据时会被拒绝，不会清空或覆盖现有数据。',
  'mobile.restore.pickFile': '选择备份文件',
  'mobile.restore.pasteLabel': '粘贴备份内容（JSON）',
  'mobile.restore.pasteHint': '也可以把备份 JSON 直接粘贴到这里，与选文件等价。',
  'mobile.restore.preview': '预检备份',
  'mobile.restore.confirm': '确认还原',
  'mobile.restore.previewCounts': '任务 {tasks} · 清单 {projects} · 标签 {tags} —— 共 {entities} 条（含墓碑 {deleted}），{ops} 条操作日志',
  'mobile.restore.done': '还原成功：写入 {ops} 条操作，共 {entities} 条数据。这批数据只在这台设备上 —— 备份里的操作带着原设备的身份，服务端不认第二个设备的署名，所以它们不会同步到你的其他设备；你之后在这台上新写的照常同步。',
  'mobile.restore.error.invalidJson': '这不是有效的 JSON 文本',
  'mobile.restore.error.invalidDocument': '这不是 heyta 的备份文件',
  'mobile.restore.error.formatVersion': '备份版本不受支持：{detail}',
  'mobile.restore.error.wrongApp': '这不是 heyta 导出的文件',
  'mobile.restore.error.schemaVersion': '备份的数据版本与当前应用不同：{detail}。请使用与备份版本兼容的应用还原。',
  'mobile.restore.error.targetNotEmpty': '本机已有数据 —— 还原只支持空库，不会清空或覆盖现有数据',
  'mobile.restore.error.inconsistent': '备份文件自洽校验失败（文件可能已损坏或被改动），未写入任何数据',
  'mobile.restore.error.verification': '还原后核对不一致：{detail}',
  'mobile.restore.error.readFailed': '读不到这个文件的内容：{detail}',
  'mobile.restore.error.hostNotReady': '本机数据还没打开 —— 请退回上一页再试一次',
  'mobile.restore.error.emptyFile': '读到的内容是空的，没有可还原的东西',
  // ── 账号与安全（批四，多端覆盖审计 P1-1）────────────────────────
  //    错误措辞零新增：走 @heyta/ui 的 authFailureMessageKey /
  //    passwordPolicyMessageKey（common.auth.*），与 web 同一个词表。
  'mobile.security.title': '账号与安全',
  'mobile.security.back': '返回',
  'mobile.security.trigger': '账号与安全',
  'mobile.security.entry.hint': '登录密码、通行密钥、登录设备与退出登录',
  'mobile.security.password.title': '登录密码',
  'mobile.security.password.lead': '这里改的只是登录密码；解开数据的加密口令是另一样东西，不在这里改。',
  'mobile.security.password.current': '当前密码',
  'mobile.security.password.new': '新密码',
  'mobile.security.password.submit': '修改密码',
  'mobile.security.password.busy': '正在修改…',
  'mobile.security.password.done': '登录密码已修改。',
  'mobile.security.password.doneDetail': '其它设备上的登录已失效，要用新密码重新登录；这台设备已自动换用新凭据。',
  // ── 设置**第一个**登录密码（ADR-0063 那一族）。──
  // 🔴 这是**另一张表单**，不是「修改密码」的单字段版本：`setInitialPassword`
  // 不 bump `tokenVersion`、也不返回新会话，所以成功之后这台设备的令牌**没换**。
  // 说成"已换用新凭据"会误导，说成"其它设备要重新登录"则是一句假话。
  // 服务端用两个**相反**的原因区分两条路：`no_password_set` / `password_already_set`
  // （句子在 `common.auth.error.noPasswordSet` / `…passwordAlreadySet`，共享词表那一份）。
  'mobile.security.password.setFirst': '设置第一个登录密码',
  'mobile.security.password.setFirstHint': '这个账号一直只用通行密钥或邮件链接登录时用这里。设好之后也能用邮箱加密码登录；这一步不会换掉你这台设备正在用的登录，也不会让别的设备重新登录。',
  'mobile.security.password.setSubmit': '设置登录密码',
  'mobile.security.password.setBusy': '正在设置…',
  'mobile.security.password.setDone': '登录密码已经设上了。',
  'mobile.security.password.setDoneDetail': '这一步不轮换令牌：这台设备继续用现在这一枚登录，其它设备也不会因此被登出。',
  'mobile.security.password.switchToChange': '这个账号已经有登录密码了，请改用上面那张「修改密码」（它会先验一次当前密码）。',
  'mobile.security.passkeys.title': '通行密钥',
  // ⚠️ 这句旧版写的是"这台手机暂不支持注册通行密钥；在电脑上注册后……" ——
  // 入口补上之后它就不成立了：这里**有**添加按钮，它会不会成由这台设备的
  // 平台能力决定（`auth/passkey-host.ts`），不支持时界面直接说明、一个请求都不发。
  'mobile.security.passkeys.hint': '通行密钥可以在这里添加、改名或删除。添加要由这台设备的系统弹窗确认；设备没有这个能力时界面会明说，不会假装已经加上。',
  'mobile.security.passkeys.loading': '正在读取…',
  'mobile.security.passkeys.empty': '还没有通行密钥',
  'mobile.security.passkeys.unnamed': '未命名密钥',
  'mobile.security.passkeys.rename': '改名',
  'mobile.security.passkeys.renameSave': '保存',
  'mobile.security.passkeys.renameCancel': '取消',
  'mobile.security.passkeys.renameHint': '给这条密钥起个名字（比如「MacBook」）',
  'mobile.security.passkeys.delete': '删除',
  'mobile.security.passkeys.deleteConfirm': '再点一次确认删除',
  'mobile.security.passkeys.deleteTitle': '删除这条通行密钥？',
  // ── 已登录**添加一条**通行密钥。──
  // 🔴 走的是 `/api/passkeys/registration/{options,complete}` 那两条（要 Bearer），
  // 不是注册新账号那两条：后者对"邮箱已属于已验证账号"**故意返回成功而不写凭据**，
  // 用它做设置页的"添加一条"= 界面说成功、账号上什么都没有。
  'mobile.security.passkeys.enroll': '添加一条通行密钥',
  'mobile.security.passkeys.enrollBusy': '请在系统弹窗里完成…',
  'mobile.security.passkeys.enrollDone': '这条通行密钥已经加到账号上了。',
  // ── 找回通行密钥：服务端渲染的凭据页才是完成的地方。──
  // 🔴 服务端对"这个邮箱有没有账号"回的是同一句中性话（防枚举），所以这句
  // 既不能说"已发送给你"、也不能说"已经登录好了"。
  'mobile.security.passkeys.recover': '丢失了通行密钥？发一封找回链接',
  'mobile.security.passkeys.recoverHint': '恢复链接会按邮箱发出；打开邮件里那条链接，在那一页完成重设。这一步不会让你现在就登录。',
  'mobile.security.passkeys.recoverEmail': '接收恢复链接的邮箱',
  'mobile.security.passkeys.recoverSubmit': '发送恢复链接',
  'mobile.security.passkeys.recoverBusy': '正在发送…',
  'mobile.security.passkeys.recoverDone': '请求已经发出。如果那个邮箱上有账号，恢复链接就在里面；打开它，在那一页完成重设。这一步还不算登录。',
  // ── 移动端补的那几格（换绑 / 登录设备 / 退出登录）。──
  //    句子主体在 `common.emailChange.*` 与 `common.sessions.*`（两个壳共用一份）；
  //    这里只放**共享词表装不下**的那些：本屏独有的状态、按钮的忙碌态、
  //    以及"服务端没给数字"时那句不需要 `{seconds}` 的冷却。
  'mobile.emailChange.loading': '正在读取这张更换的状态…',
  'mobile.emailChange.statusFailed': '没读到这张更换现在等到哪一边。邮箱地址**没有被改动**，可以重试。',
  'mobile.emailChange.refresh': '重新读取状态',
  'mobile.emailChange.busy': '正在取消…',
  'mobile.emailChange.inboxHint': '发起之后，请在**新旧两个收件箱**里各点一次那两条链接。这一步只负责发起。',
  'mobile.emailChange.needSession': '要先登录才能更换登录邮箱。',
  // 🔴 `emailChangeStage()` 返回 `invalid` 的那一档：服务端说这张请求还活着，
  // 却两边都不等。说"等另一边"与说"已经改好了"**都是假话**，只能老实报状态不对。
  'mobile.emailChange.stage.invalid': '这张更换请求的状态对不上：系统说它还在进行，却不再等任何一边点。请取消它，再重新发起一次。',
  // 服务端没回 `Retry-After` 时的第二句。⚠️ 不能复用带 `{seconds}` 的那条 ——
  // 缺变量时 i18n **原样保留占位符**，界面上会印出"再等 {seconds} 秒"。
  'mobile.emailChange.cooldownNoSeconds': '上一张更换请求还在有效期内，暂时还不能重新发起。',
  'mobile.sessions.loading': '正在读取登录设备…',
  'mobile.sessions.needSession': '要先登录才能看到登录设备这一列表。',
  'mobile.sessions.refresh': '重新读取列表',
  'mobile.sessions.revoke.title': '退出这一台设备？',
  'mobile.sessions.revoke.aria': '退出这一台：{device}',
  'mobile.sessions.logoutAll.title': '退出所有设备？',
  'mobile.sessions.logoutAll.message': '这会登出包括这台在内的每一台设备，并且让当前这套登录凭据全部失效。做完之后需要重新登录。',
  // 🔴 与设置面那颗「清除本机保存的凭据」**不是同一件事**：这一条会真的去服务端
  // 撤销手上这一枚令牌，而那一条只删本机。两句必须长得不一样。
  'mobile.signOut.button': '退出登录',
  'mobile.trash.intro': '这里放着已删除的任务、便签、清单和习惯。恢复后它会回到原来的位置。',
  'mobile.trash.empty.title': '回收站是空的',
  'mobile.trash.empty.hint': '删掉的任务、便签、清单和习惯会先放到这里',
  'mobile.trash.deletedAt': '删除于 {date}',
  'mobile.trash.restore': '恢复',
  'mobile.trash.restoreA11y': '恢复：{title}',
  'mobile.trash.purge': '彻底删除',
  'mobile.trash.purgeA11y': '彻底删除：{title}',
  'mobile.trash.confirm.title': '彻底删除「{title}」？',
  'mobile.trash.confirm.body': '它会从回收站里消失，也无法再恢复。',
  'mobile.trash.confirm.notErasure': '这不是物理擦除：操作日志里仍然留着这条记录，只是界面不再提供恢复。',
  'mobile.trash.confirm.projectTasks': '里面还有 {count} 条任务，它们不会被删除。',
  'mobile.trash.confirm.habitLogs': '它已有的打卡记录不会被删除，恢复后连续天数照旧。',
  'mobile.trash.confirm.submit': '彻底删除',
  'mobile.trash.confirm.cancel': '取消',

  // ── 备份与迁移（移动端第二层，入口在「我的」）──────────────
  // 🔴 导出文档本身的措辞、以及「不能导回来」这条诚实条款，**复用 Web 端
  // `web.export.*` 词条** —— 它们是「导出这件事」的措辞，不是 Web 壳的措辞。
  // 两端读同一批 key，就不可能出现「网页说不能导回来、手机没说」这种分歧。
  // 这里只新增移动端**独有**的：入口、按钮动词（分享而非下载）、分享提示。
  'mobile.export.entry': '备份与迁移',
  'mobile.export.entry.hint': '导出备份、恢复数据，或导入滴答清单',
  'mobile.export.title': '备份与迁移',
  'mobile.export.intro': '在这台设备上导出、恢复或迁移数据。导出在本机完成，不经过服务器。',
  'mobile.export.json.button': '分享 JSON',
  'mobile.export.markdown.button': '分享任务清单',
  'mobile.export.shareHint': '导出内容会交给系统分享面板，由你选择保存或发送到哪里。',
  'mobile.import.pasteLabel': '粘贴 CSV 文本',
  'mobile.import.label': '导入滴答清单',
  'mobile.import.pastePlaceholder': '在这里长按粘贴滴答清单导出的 CSV',
  'mobile.import.preview': '预览',
  'mobile.import.pasteNotFile': '粘贴滴答清单导出的 CSV；先预览，确认后才会添加到任务清单。',
  'mobile.export.shareTitle': 'heyta 导出',
  'mobile.export.shareFailed': '系统分享面板没有打开，导出内容没有送出。',

  // ══════════════════════════════════════════════════════════════════
  // 站点（多页）—— 见 docs/adr/0033-multi-page-site-and-bidirectional-reachability.md
  //
  // 🔴 这一段的 key 全部由 `apps/landing/src/site/pages.ts` 的**注册表**驱动：
  //    导航、页脚、每页的 <title>/<meta>、sitemap 都由它派生。
  //    **加页面只改注册表 + 这里 + 一个组件**，不要再去改导航或 sitemap。
  //
  // 🔴 产品负责人的硬约束（同一个产品的两张皮）：
  //    · 禁止孤立路由 —— 每条路由都必须出现在导航或页脚（或由可达页面链接指向）；
  //    · 禁止产品孤岛 —— 站点与应用必须**双向**可达；
  //    · 不新建第二套导航语汇 —— 站点与应用用同一批 footer key。
  // ══════════════════════════════════════════════════════════════════
  'site.nav.home': '首页',
  'site.nav.features': '功能',
  'site.nav.platforms': '平台',
  'site.nav.pricing': '价格',
  'site.nav.integrations': '优势',
  'site.nav.help': '帮助',
  'site.nav.changelog': '更新动态',
  'site.nav.signin': '登录',
  'site.nav.aria': '站点导航',
  'site.footer.group.product': '产品',
  'site.footer.group.support': '支持',
  'site.footer.group.legal': '法律',
  // 页脚 legal 组的九条链接。**这九条是界面文案，所以手写在这里**：
  // 它们是"导航里那几个字"，要短、要服从站点 IA，不是文档自己的标题
  //（文档标题与摘要由 `packages/legal/scripts/gen-site-copy.mjs` 投影到本表末尾，
  // 那一份是对外承诺，改它只能改事实源）。
  // ⚠️ 顺序跟着 `LEGAL_DOCUMENTS`（协议/隐私 → 三份清单 → 特定功能与人群 → 权利）。
  'site.footer.legal.terms': '服务条款',
  'site.footer.legal.privacy': '隐私政策',
  'site.footer.legal.personal-info-list': '个人信息收集清单',
  'site.footer.legal.permissions': '应用权限清单',
  'site.footer.legal.third-parties': '第三方与共享清单',
  'site.footer.legal.ai-and-transfer': 'AI 功能与数据流向',
  'site.footer.legal.minors': '未成年人保护',
  'site.footer.legal.subscription-refund': '订阅与退款',
  'site.footer.legal.data-rights': '行使你的权利',
  // 未命中地址时答的那一页（生产 nginx 用 `error_page 404` 内部跳过来取它）。
  // 🔴 它的消费者不是组件、是 `apps/landing/scripts/gen-entries.mjs`（构建期取数、
  //   输出静态 HTML），所以全仓库搜不到 `t('site.notfound.…')`。这不是孤儿词条：
  //   这一页在正常浏览里根本不出现，它出现的那一次正是有人转错了地址。
  // ⚠️ `otherLanguage` 是**按当前语言写的另一语言**的链接文字（中文表里指英文站、
  //   英文表里指中文站），所以它只在"恰好两种语言"时成立 —— 生成器对此有硬检查。
  'site.notfound.seo.title': '页面未找到 —— heyta',
  'site.notfound.heading': '这个地址下没有页面',
  'site.notfound.body': '它可能改过名字、已经下线，或者链接里多了一个字符。可以从下面的入口接着走。',
  'site.notfound.home': '回首页',
  'site.notfound.otherLanguage': '切换到英文站点',
  // 法律页自己的界面件（不是文本内容，所以不进 `@heyta/legal`）。
  'site.legal.draft.banner': '这一版还在法务复核中，**尚未对用户生效**。正式版本确定后会在应用内公告。',
  'site.legal.meta': '版本 {version} · 更新于 {date}',
  'site.legal.toc': '目录',
  // 🔴 R2（2026-10-05）：这里曾有 9 条**零引用**的词条，已删：
  //   `site.footer.{terms,privacy,license,aria}`、`site.backHome`、
  //   `site.appLink.{label,pending,pendingCta}`、`site.signin.cta`。
  //
  // 判据不是"看着像没用"，而是**实测**：把 `dist/` 与词条表本身排除后，
  // 全仓（含 `.mjs` / `.html`）对这 9 个 key 的引用是 **0 处**
  // （`grep` 原始命中 4 处，全部是 `packages/i18n/dist/**` 的构建产物 ——
  // **不过滤 dist 会得到"它们还在用"的假象**，这一点已踩过）。
  //
  // 为什么删而不是留：计划 §欠账 R2 的原话是「**要么接上，要么删** ——
  // 留着就是"设计了没实现"的味道」。页脚 legal 组（A6-1）尚未开工，
  // 留着这 4 条只会让下一个人以为"法律页已经有了"。
  //
  // ⚠️ **重新加回来时不要只加词条**：`MessageKey` 是从本表派生的，
  // 只加词条不会有任何东西渲染它们 —— 那正是这次删掉的那 9 条的来历。
  // 加词条必须和接上它的界面同时发生。

  // ── 首页 SEO（原写在 index.html 里，现在进词条表以便逐页生成）──
  'site.home.seo.title': 'heyta：本地优先的任务管理，可自建自托管',
  'site.home.seo.description': 'heyta 是一个本地优先的任务管理应用：任务、清单、习惯与专注。数据先存在你自己的设备上，端到端加密同步，还能用自己的服务器。',

  // ── 功能介绍 ──
  'site.features.seo.title': '功能介绍 —— heyta',
  'site.features.seo.description': 'heyta 能做什么：任务与清单、四象限、习惯打卡、番茄专注、时间线、成长体系、加密同步、AI 助手接入。只列已经上线的功能。',
  'site.features.title': '功能介绍',
  'site.features.lede': 'heyta **已经上线**的功能，按模块一览。想看最新进展与下一步，去「更新动态」。',
  'site.features.section.tasks': '任务与清单',
  'site.features.section.views': '视图',
  'site.features.section.habits': '习惯打卡',
  'site.features.section.focus': '番茄专注',
  'site.features.section.growth': '激励与成长',
  'site.features.section.sync': '同步与隐私',
  'site.features.section.ai': 'AI（自带端点）',
  'site.features.section.api': 'AI 助手接入',
  'site.features.item.task.fields': '标题、备注（Markdown）、优先级、截止时间、所属清单、标签',
  'site.features.item.task.repeat': '重复任务：每天 / 每周 / 工作日 / 每月，四种预设一键选',
  'site.features.item.task.projects': '清单支持一层文件夹嵌套；清单与标签都有独立管理面板',
  'site.features.item.task.trash': '回收站：删掉的内容先留着，随时恢复，也可以逐条彻底删除',
  'site.features.item.task.export': '一键导出：完整 JSON 备份（连删除过的记录都在，条数可核对）+ 好读的 Markdown',
  'site.features.item.view.quadrant': '四象限：按重要程度与截止时间自动归类，拖动即可调整',
  'site.features.item.view.timeline': '时间线：按预估时长排布，用于个人项目排期',
  'site.features.item.view.today': '今天 / 收集箱 / 已完成 / 回收站：智能清单',
  'site.features.item.habit.model': '每日打卡与撤销打卡（打卡记录跨设备同步）',
  'site.features.item.habit.streak': '连续天数与最长记录，含**冻结 / 续接 / 修复**的韧性机制',
  'site.features.item.habit.heat': '热力图与年度视图',
  'site.features.item.focus.timer': '番茄钟与长休息，时长可自定义（1–180 分钟）',
  'site.features.item.focus.link': '专注可关联到具体任务，记录进统计',
  'site.features.item.growth.feedback': '今日进度卡：真实口径，含计划外完成',
  'site.features.item.growth.narrative': '周复盘信、里程碑地图、身份标签',
  'site.features.item.growth.colors': '活动分类着色：颜色由**你自己赋义**，App 永不判断某项活动「健康」与否',
  'site.features.item.sync.e2ee': '端到端加密：任务在**你的设备上**加密后才上传，服务端只中转密文',
  'site.features.item.sync.offline': '离线优先：断网照常记，连上自动补传',
  'site.features.item.sync.conflict': '冲突可见：并发修改不会静默丢数据，会让你选保留哪个',
  'site.features.item.sync.selfhost': '自建服务器：一条命令在自己机器上跑起来，数据只落在你手里',
  'site.features.item.ai.byok': 'AI 用**你自己的**推理端点（本地 Ollama / LM Studio 或任何 OpenAI 兼容地址）',
  'site.features.item.ai.gate': 'AI 默认关闭；开启后逐功能授权，你允许了什么才发什么',
  'site.features.item.ai.features': '四个功能：一句话捕获、任务拆解、象限与优先级建议、时长估算',
  'site.features.item.api.mcp': '接入 AI 助手（MCP）：让 Claude 这类助手直接读任务、建任务、完成任务，共 6 个动作',
  'site.features.item.api.local': '本机接口：默认关闭；开启后也只接受你这台电脑的连接，每个工具单独授权',
  'site.features.note': '以上是**当前版本**已经上线的功能。最新进展与下一步计划见「更新动态」。',
  'site.features.pending.title': '还没做的',
  'site.features.pending.body': '习惯的频率目标（每周 N 次 —— 目标值与单位现在就能设，还没做的是"一周要够几次"）、移动端的系统通知投递（提醒本身两端都设得了，但真正会弹出通知的只有 Web，而且要应用开着）、自定义筛选器、看板视图、批量操作 —— 这些还在路上，做好了会第一时间出现在「更新动态」。',
  'site.features.notdoing.title': '明确不做的',
  'site.features.notdoing.body': '排行榜与社交（端到端加密下没有可信的汇总方）、金币与积分商店、按功能收费、微信提醒（需要服务端读明文）。',

  // ── 平台状态 ──
  'site.platforms.seo.title': '平台状态 —— heyta',
  'site.platforms.seo.description': 'heyta 各平台的真实进度：Web 已上线；Android 实机可用；iOS 到模拟器级；桌面可打包但未签名；鸿蒙能出包但还跑不起来。',
  'site.platforms.title': '平台状态',
  'site.platforms.lede': '每个平台现在到哪了，如实说：能用就说能用，没好就说没好。',
  'site.platforms.status.available': '可用',
  'site.platforms.status.partial': '进行中',
  'site.platforms.status.blocked': '阻塞',
  'site.platforms.legend.available': '能用，且有端到端验收',
  'site.platforms.legend.partial': '能跑起来，但还缺发布所必需的东西',
  'site.platforms.legend.blocked': '有明确的外部依赖没解决',
  'site.platforms.web.name': 'Web',
  'site.platforms.web.body': '完整产品，不是演示。断网也能照常记，恢复后自动补传；数据就存在你自己的浏览器里。',
  'site.platforms.android.name': 'Android',
  'site.platforms.android.body': '当前版本已在真机运行，主要任务流程和 Android 小组件路径已有验证。已有签名测试安装包可供下载；跨平台小组件覆盖和完整交互验收仍在继续。',
  'site.platforms.ios.name': 'iOS',
  'site.platforms.ios.body': '主要任务与同步流程已在模拟器跑通。测试版本已关联现有内部测试组；目前没有公开邀请，实体 iPhone 验收仍待完成。',
  'site.platforms.desktop.name': '桌面（Windows / macOS / Linux）',
  'site.platforms.desktop.body': 'Windows 应用已可安装运行；macOS 有已签名并完成公证的版本；Linux 也已有测试安装包。桌面交互和小组件覆盖仍按平台分别验收。',
  'site.platforms.harmony.name': '鸿蒙',
  'site.platforms.harmony.body': '构建链已经打通，能打出安装包，但应用还跑不起来 —— 卡在模拟器镜像与签名。',
  'site.platforms.selfhost.name': '自建服务器',
  'site.platforms.selfhost.body': '一条 docker compose 把全套服务跑在你自己的机器上。密钥与数据库口令要自己配 —— 不是零思考的一键安装，但每一步都有指南。',
  'site.platforms.note': '⚠️ 「未签名」为什么值得单独说：macOS 上未签名、未公证的应用**双击会被系统拦下**，需要右键打开。把这句省掉，用户会以为包坏了。',

  // ── 价格 ──
  'site.pricing.seo.title': '价格 —— heyta',
  'site.pricing.seo.description': 'heyta 的价格：自建永久免费，官方托管 ¥5 / 月，官方托管加云端 AI ¥12 / 月。不按功能收费 —— 免费档就是全部功能。',
  'site.pricing.title': '价格',
  'site.pricing.lede': '只有两件事收费：**我们替你运维那台同步服务器**，以及**我们的云端 AI**。功能不收费 —— 免费那一栏就是全部功能。',
  'site.pricing.compare.title': '自建 vs 我们托管',
  'site.pricing.compare.diy': '自己运维（免费）',
  'site.pricing.compare.hosted': '我们托管（付费）',
  'site.pricing.compare.row.function': '功能',
  'site.pricing.compare.function.same': '完全相同',
  'site.pricing.compare.row.server': '服务器',
  'site.pricing.compare.server.diy': '你的机器，你来升级与备份',
  'site.pricing.compare.server.hosted': '我们的机器，我们运维',
  'site.pricing.compare.row.data': '数据位置',
  'site.pricing.compare.data.diy': '完全在你手里',
  'site.pricing.compare.data.hosted': '你的设备上；我们的服务器只有密文',
  'site.pricing.compare.row.ai': 'AI',
  'site.pricing.compare.ai.diy': '自带端点，永久免费且不计量',
  'site.pricing.compare.ai.hosted': '自带端点免费；用我们的云端 AI 需 ¥12 档',
  'site.pricing.compare.row.lockin': '锁定',
  'site.pricing.compare.lockin.same': '两边都能随时导出全部数据（JSON 含完整操作日志 + Markdown）',
  'site.pricing.faq.title': '常见问题',
  'site.pricing.faq.expire.q': '订阅到期后数据会丢吗？',
  'site.pricing.faq.expire.a': '不会。数据一直在你自己的设备上，到期只是停掉我们这边的托管同步与云端 AI，本地数据一条都不动，也随时可以导出。',
  'site.pricing.faq.where.q': '我的数据放在哪？',
  'site.pricing.faq.where.a': '先落在你的设备上。云端只是同步通道，而且**只有密文** —— 密钥只在你手里，服务端读不出内容。',
  'site.pricing.faq.export.q': '不续费了，怎么把数据带走？',
  'site.pricing.faq.export.a': '设置页有「导出数据」，产出 JSON（含完整操作日志与已删除记录，可核对条数）与 Markdown。不需要经过我们同意，也不需要联网。',
  'site.pricing.faq.buy.q': '现在能买吗？',
  'site.pricing.faq.buy.a': '**还不能。** 收银台的服务端已经通了，但支付通道（微信支付商户资质）尚未接通，所以页面上刻意**没有购买按钮** —— 一个点了没反应的购买按钮比没有按钮更坏。',

  // ── 独有能力（数据主权 + 对照滴答清单，A7）──
  //    素材来自 dida365-feature-benchmark §5 的九条，按 A7 的三条判据重组：
  //    数据主权 / 对照滴答 / 其余两条。每条都要给可复现的验证方式。
  'site.integrations.seo.title': '数据在你手里 —— heyta',
  'site.integrations.seo.description': 'heyta 与众不同的地方：端到端加密同步、可自建服务器、AI 助手接入、自带 AI 端点、完整导出，以及不按功能收费。',
  'site.integrations.title': '数据在你手里',
  'site.integrations.lede': '多数工具默认把你的数据存在他们的服务器上。heyta 反过来：**数据在你手里**，我们只在你允许时碰它。这一页讲这种差别具体落在哪。',
  'site.integrations.e2ee.title': '端到端加密同步',
  'site.integrations.e2ee.body': '任务在你的设备上加密之后才上传，服务器只经手密文。所以服务器上**不存在**一份可读的任务库 —— 就算有人拿到，也只是一串乱码。',
  'site.integrations.e2ee.item.ingress': '服务器只收密文 —— 明文一律拒绝。这不是设置项，是写死的',
  'site.integrations.e2ee.item.keys': '解密钥匙留在你的设备上。设置数据钥匙后可用保存的恢复码解锁；口令与恢复码都丢失时，服务端无法替你解密',
  'site.integrations.selfhost.title': '自建服务器，永久免费',
  'site.integrations.selfhost.body': '同步服务器可以完整跑在你自己的机器上：一条 docker compose 起全套，数据落在你自己的磁盘。不产生费用，也不需要经过我们同意。',
  'site.integrations.selfhost.item.compose': '一条命令起全套服务，数据落在你自己的磁盘上',
  'site.integrations.selfhost.item.free': '不按用量收费，也没有"自建版少一个功能"这回事',
  'site.integrations.localApi.title': 'AI 助手接入：默认关，逐工具授权',
  'site.integrations.localApi.body': 'heyta 内置一个只接受本机连接的接口，Claude 这类 AI 助手可以通过它读任务、建任务、改任务。默认关闭；开启后每个工具都要你单独授权 —— 不想要的功能，助手就拿不到。',
  'site.integrations.localApi.item.tools': '六个动作：列任务、看任务、列清单、建任务、改任务、完成任务',
  'site.integrations.localApi.item.gate': '默认关闭，只接受本机连接；每个工具由你逐个授权',
  'site.integrations.byok.title': 'AI 用你自己的端点',
  'site.integrations.byok.body': 'AI 功能不绑定任何厂商：你填自己的推理端点与模型名，请求直连你指定的地址。内置预设只有**本机**的 Ollama 与 LM Studio —— 没有"只能用我们的云"这一条路。',
  'site.integrations.byok.item.presets': '预设只有本机 Ollama 与 LM Studio，云端端点由你自己填',
  'site.integrations.byok.item.nosdk': '不装任何厂商 SDK，请求就是普通 HTTP，随时可换',
  'site.integrations.export.title': '导出是完整备份，不是导出个大概',
  'site.integrations.export.body': '导出的不只是当前列表：完整历史、连删除过的记录都在，文件里自带一份条数清单 —— 「导全了没有」可以自己核对，不用信我们的说法。',
  'site.integrations.export.item.json': 'JSON：完整历史 + 已删除记录 + 可核对的条数清单',
  'site.integrations.export.item.markdown': '另有一份给人读的 Markdown',
  'site.integrations.pricing.title': '不按功能收费',
  'site.integrations.pricing.body': '免费档就是**全部功能**，没有「清单 9 个、任务 99 条」这类数量闸门。收费的只有两件事：我们替你运维服务器，以及我们的云端 AI。',
  'site.integrations.pricing.item.nogate': '没有功能闸门：收费项只有托管与云端 AI 两类',
  'site.integrations.pricing.item.onlytwo': '价格口径由一致性检查强制，不靠自觉',
  'site.integrations.quadrant.title': '四象限是视图，不是又一份要维护的数据',
  'site.integrations.quadrant.body': '四象限不是给任务多加一个字段，而是**从截止日期与优先级当场算出来**的视图。所以它不会和你的任务数据对不上 —— 改一处，处处都跟着对。',
  'site.integrations.quadrant.item.derived': '象限由截止日期与优先级算出来，任务上没有多余的字段',
  'site.integrations.quadrant.item.nodrift': '因此不存在"看起来有、其实没同步上"的第二份状态',
  'site.integrations.resilience.title': '习惯韧性：冻结、续接、修复',
  'site.integrations.resilience.body': '连续打卡总会断，而断一次就清零几周记录是最伤人的设计。heyta 允许你**冻结**缺口、**续接**被打断的连续，数据出问题时还能**修复** —— 三件事都不发行积分，也不卖"后悔药"。',
  'site.integrations.resilience.item.states': '冻结有上限：它是保险，不是免打卡通行证',
  'site.integrations.resilience.item.nocurrency': '全部状态由你的打卡记录算出来 —— 没有可以拿去卖的虚拟货币',
  'site.integrations.conflict.title': '冲突看得见，选哪个由你定',
  'site.integrations.conflict.body': '两台设备同时改一条任务时，冲突**不会被悄悄丢掉一边**：界面把两个版本摆出来，由你选。判定规则两端一致，而且过程你**看得见**。',
  'site.integrations.conflict.item.visible': '两个版本并排摆出来，选择权在你手里',
  'site.integrations.conflict.item.lww': '两端用同一套判定规则与同一套文案',
  'site.integrations.note': '这一页只讲已经做到的事。还没做的，在「功能介绍」的「还没做的」那一条里如实列着。',

  // ── 帮助 ──
  'site.help.seo.title': '帮助中心 —— heyta',
  'site.help.seo.description': 'heyta 帮助中心：怎么建任务、怎么同步、忘了加密口令怎么办、通行密钥怎么用、四象限怎么归类、重复任务怎么设、专注怎么用、怎么导出数据、怎么自建服务器、数据到底放在哪。',
  'site.help.title': '帮助中心',
  'site.help.lede': '从第一条任务开始，找到日常使用、账号同步与数据管理的答案。',
  'site.help.topics.title': '从这里开始',
  'site.help.module.start': '开始使用',
  'site.help.module.sync': '同步与账号',
  'site.help.module.organize': '组织与节奏',
  'site.help.module.data': '数据与自建',
  'site.help.module.trust': '隐私',
  'site.help.q.create': '怎么建一条任务？',
  'site.help.a.create': '在任务列表上方输入标题，按回车添加。也可以写“明天下午三点交周报”，检查识别出的日期后提交。点击任务即可在详情中补充备注、清单和标签。',
  'site.help.q.sync': '换设备了，数据怎么过去？',
  'site.help.a.sync': '开启联网并登录 heyta，默认使用官方服务同步，无需填写服务器地址或令牌。在“应用设置 → 账号同步”查看连接状态。首次配置加密时，请妥善保存恢复信息；其他设备需要使用相同的加密凭据。',
  'site.help.q.passphrase': '忘了加密口令怎么办？',
  'site.help.a.passphrase': '如果已经设置加密数据钥匙并保存了恢复码，可以在同步设置中**用恢复码解锁**，随后设置新口令并保存新的恢复码。登录密码重置不能解锁数据。若口令和恢复码都丢失，服务端无法替你恢复；仍能读取数据的旧设备可以先导出留底。尚未迁移的旧口令密文仍需要原口令。',
  'site.help.q.passkey': '通行密钥怎么用？',
  'site.help.a.passkey': '登录时选「通行密钥」，用设备本身的人脸 / 指纹 / 系统 PIN 确认即可，没有密码可记，也没有密码可撞库。丢了的话，应用里的登录面板有「丢失了通行密钥？」，会发一封找回邮件，点进去可以注册一条新的。⚠️ **最后一条凭据不允许被删除** —— 删掉就进不去了。',
  'site.help.q.rebind': '怎么换绑登录邮箱？',
  'site.help.a.rebind': '在设置页的「账号」里点「换绑邮箱」并填新地址。heyta 会同时给**当前邮箱**和**新邮箱**各发一封信，**两边各点一次**才生效 —— 任何一边没点，什么都不会变。链接 24 小时内有效，生效时其他设备上的登录会一起失效，你要用新邮箱重新登录。如果当前邮箱已经收不到信（注册时填错、停用），这条路走不通：双侧确认正是这件事安全的地方，那种情况只能联系那台服务器的运营方。',
  'site.help.q.sessions': '怎么退出某一台设备？',
  'site.help.a.sessions': '设置页的「账号」里有一张「登录设备」列表：每条会话写着什么时候登录、最近一次使用、来自哪个浏览器标识，每条都能单独登出。**「退出这一台」只撤销那一枚令牌**，别的设备继续用；要一次清掉就点「退出所有设备」。修改口令与换绑邮箱也会把其它设备的登录一并作废。',
  'site.help.q.quadrant': '四象限是怎么归类的？',
  'site.help.a.quadrant': '象限是**当场算出来的**，不是给任务打的标签：紧迫与否看截止日期是否落在近期窗口内，重要与否看你自己标的重要标记（没标过就按优先级推导）。所以改截止日期或优先级，任务会自动换格 —— 不会出现"象限和任务对不上"。',
  'site.help.q.repeat': '重复任务怎么设？',
  'site.help.a.repeat': '在 **Web 与移动端**都能设：打开任务详情选常用预设（每天 / 每周 / 工作日 / 每月），也可以直接写一条自定义规则。勾掉一条重复任务时，下一次到期日按规则顺延，基准是**原本的到期日**而不是"你几点勾的"。顺延的算法与各端差别见「重复任务：勾掉之后，下一次怎么算」。',
  'site.help.q.focus': '专注（番茄钟）怎么用？',
  'site.help.a.focus': '在专注页选一条任务开始计时，结束后这一次专注会记入成长统计。时长可以自己改（默认 25 分钟专注 / 5 分钟休息），改完会记住 —— 刷新页面后仍是新值。',
  'site.help.q.export': '怎么把数据带走？',
  'site.help.a.export': '三端都能**导出**：Web 在设置页、移动端在「我的」里走系统分享面板、命令行用 `export`。但**只有 Web 与命令行能导回**，而且只能还原到一个空库 —— 移动端没有导入入口。详见「把数据带走、带回来」。',
  'site.help.q.selfhost': '怎么自己搭一套？',
  'site.help.a.selfhost': '可以使用自己的同步服务器。部署、升级与备份步骤请查看“自托管同步服务”；连接入口位于应用同步设置的高级选项。',
  'site.help.q.privacy': '数据到底放在哪？',
  'site.help.a.privacy': '任务先保存在本机。开启同步后，任务内容以端到端加密形式上传；服务端仍可看到同步时间和设备标识等元数据。AI 使用独立的数据授权，具体发送内容请查看“AI 功能与数据流向”。',

  // ── 文档中心（帮助中心的文章层）──────────────────────────
  // 组织方式沿用上面五个模块的标题（`site.help.module.*`），不另起一套词表：
  // 帮助中心与文档中心是**同一个 IA 的两层深度**，不是两个中心。

  'site.docs.nav.title': '文档中心',
  'site.docs.nav.back': '帮助中心首页',
  'site.docs.hub.articles': '深入阅读',
  'site.docs.hub.faq': '速答',
  // 侧栏分组的折叠与移动端抽屉 —— 它们是按钮的无障碍名称，界面上不显示这两个词。
  'site.docs.nav.toggle': '收起或展开这一组',
  'site.docs.nav.open': '打开文档目录',
  'site.docs.nav.close': '关闭文档目录',
  'site.docs.nav.home': '返回首页',
  // 文档中心顶栏的搜索。它匹配 FAQ 的问题与答案，以及文章/小节标题；
  // 命中之后跳到原有落点，所以占位文案要说清楚这里搜的是帮助内容。
  'site.docs.shell.title': '帮助中心',
  'site.docs.search.label': '搜索文档',
  'site.docs.search.placeholder': '搜索问题与使用指南',
  'site.docs.search.clear': '清除搜索',
  'site.docs.search.results': '找到 {count} 条相关内容',
  'site.docs.search.none': '没有找到相关内容。试试更短的关键词，或者换个说法。',
  // 条数是代码里的常量，不写进文案 —— 写进去就会和那个常量分叉。
  'site.docs.search.truncated': '只显示前 {count} 条，关键词再具体一点。',
  'site.help.search.title': '在帮助内容里找答案',
  'site.help.search.placeholder': '例如：同步失败、导出、AI',
  'site.help.search.clear': '清除帮助搜索',
  'site.help.search.results': '找到 {count} 条相关内容',
  'site.help.search.none': '没有找到相关内容，试试更短的关键词。',
  // 文章页顶部的小标题（目录条目从渲染出的分区取，不在此处另列一份）。
  'site.docs.toc.title': '这一页的内容',
  // 配图编号里的**前缀**。数字（「20-1」）由渲染层从注册表顺序算出来，人只写这一句 ——
  // 把「图」拼进编号字符串，英文页就会显示一个中文「图」字。
  'site.docs.figure': '图',
  // 分类页（`/help/<分类>`）：标题复用 `site.help.module.*`，这里只补引言与 SEO 标题 ——
  // 同一件事在两处各起一个名字，就成了两个中心。
  // ⚠️ **只有建了分类页的分类才需要这一对词条**：没文章的分类不该出现入口，也就不该有引言。
  'site.docs.cat.start.seo.title': '文档中心 · 开始使用 —— heyta',
  'site.docs.cat.start.sum': '这一组回答两件事：装完不注册能不能直接用，以及任务·清单·标签·习惯这几个词在数据上各指什么。',
  'site.docs.cat.sync.seo.title': '文档中心 · 同步与账号 —— heyta',
  'site.docs.cat.sync.sum': '这一组回答三件事：数据在各端之间到底怎么过去、登录凭据从哪来、端到端加密的口令丢了会发生什么。',
  'site.docs.cat.organize.seo.title': '文档中心 · 组织与节奏 —— heyta',
  'site.docs.cat.organize.sum': '这一组回答三件事：重复任务勾掉之后下一次怎么算、四个视图各解决什么问题、提醒在什么条件下才会真的响。',
  'site.docs.cat.data.seo.title': '文档中心 · 数据与自建 —— heyta',
  'site.docs.cat.data.sum': '这一组回答两件事：自己搭一套要准备什么、数据怎么带走和带回来 —— 后者目前不是每个端都能做。',
  'site.docs.cat.trust.seo.title': '文档中心 · 隐私 —— heyta',
  'site.docs.cat.trust.sum': '这一组回答两件事：数据到底有哪些路子会离开这台设备，以及丢了三样东西时哪样找得回、哪样找不回。',

  // 同步是怎么工作的
  'site.docs.how.title': '设置与检查同步',
  'site.docs.how.seo.title': '同步是怎么工作的 —— heyta',
  'site.docs.how.sum': '连接设备，查看同步状态，并处理离线后的改动。',
  'site.docs.how.s1': '本地优先：云端不是事实源',
  'site.docs.how.s1p1': '你在 heyta 里写的每一条任务，**先写进这台设备自己的数据库**，然后才谈上传。断网、服务端停机，应用照常读写。',
  'site.docs.how.s1p2': '同步服务器的角色是**通道 + 密文存放处**：它负责把 A 设备写出的东西递给 B 设备，它自己不决定哪条数据算数。',
  'site.docs.how.s1p3': '所以"同步失败"不会让你丢数据 —— 那些写入仍然在你本机，等下一次同步成功再出去。',
  'site.docs.how.s2': '什么时候会真的同步（各端不一样）',
  'site.docs.how.s2p1': '这一条是**目前各端最实在的差别**，我们照实写：',
  'site.docs.how.s2i1': 'Web 与桌面：写完**不会自动出去**。要么点顶栏的「立即同步」，要么在同步设置里点「保存并同步」。',
  'site.docs.how.s2i2': '移动端：写入后约两秒自动出去；回到前台时补一次；失败会退避重试，不会反复打服务器。',
  'site.docs.how.s2i3': '任意一端：**别人写的东西会自动进来**。服务端在有新记录时推一个信号，收到信号的那一端自己去拉。',
  'site.docs.how.s3': '服务端到底看不到什么',
  'site.docs.how.s3p1': '**这一节讲的是同步那条通道**：它上传的载荷是端到端加密的，加密与解密都发生在你的设备上，同步服务端收到（也只收得到）密文。某个客户端尝试上传明文时，服务端会直接拒绝而不写入。🔴 这句话**不覆盖 AI 那条路径** —— 模型要读到明文才能给出建议，所以那一格是你逐项授权后交出去的原文，逐功能的字段清单见页脚的《AI 功能与数据流向》。',
  'site.docs.how.s3p2': '但**外围信息不是密的**：同步时间、你用的是哪几台设备、动的是哪类东西与先后顺序，服务端都看得到。被保护的是内容本身（任务标题、备注这些），不是"你在用 heyta 的哪些功能"。我们不会把"什么都看不到"拿来宣传。',
  'site.docs.how.s4': '同步失败时，先守住仍有数据的那台设备',
  'site.docs.how.s4p1': '同步失败不会擦掉本地数据库。排查时先继续使用还能读出任务的那台设备，不要在问题没定位前删除或重装它。',
  'site.docs.how.s4p2': '如果提示登录凭据失效，重新登录；如果提示加密口令不正确，核对当前账号、服务端和加密口令。重新连网络不能修复解锁失败。',
  'site.docs.how.s4p3': '如果是服务端没有回应，先检查服务端地址和网络，再点一次「立即同步」。Web 与桌面端的本地写入会留在队列里，等下一次成功同步。',
  'site.docs.how.s4p4': '如果另一台设备离线时改过同一条任务，打开冲突视图，选择要保留的版本；选择记录下来后，两端会收敛到同一份。',

  // 账号、令牌与登录方式
  'site.docs.account.title': '账号与登录',
  'site.docs.account.seo.title': '账号、令牌与登录方式 —— heyta',
  'site.docs.account.sum': '注册账号，选择登录方式，管理访问凭据。',
  'site.docs.account.s1': '同步设置与数据解锁',
  'site.docs.account.s1p1': '同步设置包含服务端连接信息，以及独立的加密数据钥匙管理。登录后可以创建钥匙、保存恢复码或解锁已有数据。',
  'site.docs.account.s1i1': '服务端地址：你要连的那台同步服务器。什么都不填就是纯本地使用，数据只留在这台设备上。',
  'site.docs.account.s1i2': '访问令牌：由服务端签发，代表「这个账号在这台服务器上的那块空间」。已经有令牌的可以直接粘贴。',
  'site.docs.account.s1i3': '加密口令：不发给服务端，与登录密码分开。恢复码与设备记住解锁的边界见「端到端加密口令」。',
  'site.docs.account.s2': '三条登录方式，邮箱 + 口令是主路',
  'site.docs.account.s2p1': '注册与登录走的是**邮箱 + 口令**，另外邮箱链接与通行密钥也一直在。服务器上存的口令不是能读回来的样子，也没有任何人能把它交还给你 —— 忘了就走「忘记密码」，它会发一封带一次性重置链接的信，那是真重置，不是绕过口令的后门。',
  'site.docs.account.s2i1': '邮箱 + 口令：填邮箱、设一个口令（至少 8 个字符）、点验证邮件里的链接激活，之后每次输口令登录。',
  'site.docs.account.s2i2': '邮箱链接（不想记口令时）：填邮箱、收邮件、点里面的链接，登录就完成了。',
  'site.docs.account.s2i3': '通行密钥：用设备本身的人脸 / 指纹 / 系统 PIN 确认，没有可记的东西，也就没有可泄露的东西。丢了就走应用里登录面板上的「丢失了通行密钥？」，那一步必须在真实浏览器里完成，所以它打开的是一个独立页面。',
  'site.docs.account.s3': '桌面壳里为什么要跳到浏览器',
  'site.docs.account.s3p1': 'macOS 与 Windows 的桌面壳里通行密钥不可用（实测：内嵌 WebView 不提供平台认证器）。所以壳会把你送到**系统浏览器**里完成登录，成功后再自动回到壳里；万一系统没有把地址交回来，那个页面上另有一条可以直接点的回跳链接。',
  'site.docs.account.s4': '条款是「该服务端」的',
  'site.docs.account.s4p1': '注册时勾选的同意书写的是「**该服务端**提供的服务条款与隐私政策」。因为 heyta 的部署方可以是任何人 —— 你连的那台服务器由谁运营、适用哪套条款，由那台服务器决定。',
  'site.docs.account.s5': '为什么登录发生在应用里，不在网站上',
  'site.docs.account.s5p1': '登录要用的服务器地址，**就是**同步设置里那个地址 —— 两者必须是同一个，否则会出现「对着 A 服务器登录、令牌却存进 B」这种极难排查的错位。所以网站上那个登录页只做一件事：把你送进应用里的登录面板，它自己不复制一套表单。通行密钥还多一条限制：它必须绑定一个确定的域名，那一步只能在真实浏览器里完成。',
  'site.docs.account.s6': '换绑登录邮箱：两边都点才生效',
  'site.docs.account.s6p1': '设置页「账号」里点「换绑邮箱」，填上新地址。heyta 会**同时**给当前邮箱与新邮箱各发一封信，**两边各点一次**换绑才生效 —— 先后无关，任何一边没点就什么都不变。链接 24 小时内有效；同一时间只允许一张在途请求，要重发得等那张过期或先撤销它。',
  'site.docs.account.s6i1': '生效的那一刻：所有设备上的登录同时失效，在途的重置口令与魔法登录链接一并作废，你要用**新邮箱**重新登录。',
  'site.docs.account.s6i2': '两个地址各收到一封完成通知。旧邮箱那一封是给你的安全网 —— 如果那不是本人，那是你唯一能知道的方式。',
  'site.docs.account.s6i3': '旧邮箱已经收不到信（注册时填错、停用）就没有自助通道：双侧确认正是这件事安全的地方，那种情况只能联系那台服务器的运营方。',
  'site.docs.account.s6i4': '库里不保留历史地址。唯一的明文时刻，是新地址在那张在途请求里待着的这 24 小时。',
  'site.docs.account.s7': '登录设备与「退出这一台」',
  'site.docs.account.s7p1': '设置页「账号」里的「登录设备」列出这个账号当前的会话：什么时候登录、最近一次使用是什么时候、来自哪个浏览器标识。每一条都可以单独登出。',
  'site.docs.account.s7i1': '「退出这一台」撤销的是**那一枚**令牌，其余设备继续用；「退出所有设备」才是把整账号的登录一次清掉。',
  'site.docs.account.s7i2': '修改口令与换绑邮箱都会顺带把其它设备的登录作废 —— 它们改的都是登录凭据本身。',
  'site.docs.account.s7i3': '「设备名」那一列目前还没有客户端上报，所以列表里只有时间与浏览器标识。我们不给它编一个名字。',

  // 端到端加密口令
  'site.docs.passphrase.title': '加密与恢复码',
  'site.docs.passphrase.seo.title': '端到端加密口令 —— heyta',
  'site.docs.passphrase.sum': '了解加密口令与登录密码的区别，妥善保存恢复码。',
  'site.docs.passphrase.s1': '口令是什么',
  'site.docs.passphrase.s1p1': '加密口令在你的设备上解锁数据钥匙，数据在上传前加密。口令、恢复码和解锁后的钥匙**不发给服务端**；服务器保存的是加密的钥匙包与数据。',
  'site.docs.passphrase.s1p2': '浏览器重新打开后需要再次解锁。移动端可主动选择「记住解锁」，将数据钥匙保存在系统安全存储中；默认不启用，也不会保存口令。锁定数据钥匙仅停止使用同步密钥，不会加密或隐藏设备上已有的本地数据。',
  'site.docs.passphrase.s2': '忘记加密口令时如何恢复',
  'site.docs.passphrase.s2p1': '设置数据钥匙时会显示一次恢复码，并要求再次输入确认。保存了这串码，就可以在同步设置中选择「用恢复码解锁」。恢复后必须设置新口令并保存新的恢复码，才能继续使用加密数据。服务端和客服都无法替你找回口令或恢复码；重置登录密码也不能代替这一步。',
  'site.docs.passphrase.s2i1': '把恢复码保存到自己的密码管理器或离线记录中，不要只存放在可能丢失的那台设备上。',
  'site.docs.passphrase.s2i2': '如果口令和恢复码都丢失，先在仍能读取数据的旧设备上导出留底；服务器没有解密副本。',
  'site.docs.passphrase.s2i3': '创建恢复码不会自动迁移旧口令密文。已有旧数据需要使用原加密口令完成迁移，之后才由新的数据钥匙保护。',
  'site.docs.passphrase.s3': '填错口令会怎样',
  'site.docs.passphrase.s3p1': '填错口令或恢复码会解锁失败，不会覆盖原有数据。更换加密口令会更新钥匙的保护方式；「轮换数据钥匙并迁移数据」则会重新加密同步历史，必须完成迁移并确认新的恢复码。迁移中断时按界面提示继续或取消，不要另建一份钥匙来覆盖它。',
  'site.docs.passphrase.s3w1': '提示口令不正确时，请核对当前账号、服务端与加密口令。重新连接网络不能修复解锁失败。',

  // 冲突
  'site.docs.conflict.title': '处理同步冲突',
  'site.docs.conflict.seo.title': '当两台设备改了同一条 —— heyta',
  'site.docs.conflict.sum': '两台设备修改同一条任务时，选择保留的内容。',
  'site.docs.conflict.s1': '为什么会有冲突',
  'site.docs.conflict.s1p1': 'heyta 不是"所有设备实时共享一个数据库"，而是每台设备先写自己的流水，再把流水递给对方。所以两台设备各自离线改了同一条任务时，**两边都合法** —— 没有一台中心机器在场当场说谁不算。',
  'site.docs.conflict.s2': '怎么判断这算不算冲突',
  'site.docs.conflict.s2p1': '每条记录都带着"我见过哪些改动"的版本信息。只有两边互相都不领先时才算真的撞上；如果 B 是在看过 A 之后写的，那只是普通的先后关系，不会被当成冲突。真的撞上时，谁胜出用"最后写入 + 设备标识"确定性地裁决，所以两台设备会挑出**同一个**答案，不会各裁一半然后越差越远。',
  'site.docs.conflict.s3': '你会看到什么',
  'site.docs.conflict.s3p1': '冲突会弹一个对话框，把本地与远端两边的内容都摆出来给你比，你选保留哪一边。选完之后两端会收敛成同一份 —— 这条"双端收敛"是端到端跑过验收的，不是推理想象出来的。',

  // 自建
  'site.docs.selfhost.title': '自托管同步服务',
  'site.docs.selfhost.seo.title': '自建一套同步服务器 —— heyta',
  'site.docs.selfhost.sum': '部署自己的服务，配置连接，并维护备份与升级。',
  'site.docs.selfhost.s1': '先把难度说清楚',
  'site.docs.selfhost.s1p1': '这四条会让人中途放弃，所以放在最前面：',
  'site.docs.selfhost.s1i1': '目前**没有发布任何现成镜像**，你要在自己的机器上把它构建出来。',
  'site.docs.selfhost.s1i2': '服务**起来**不等于以后都不用管：首次开机由那份一次性迁移服务把表结构建好，不用你手动跑；但 `docker compose` 不会重跑一个已经退出的服务，**改了表结构之后的升级要再点名执行它一次**（见下面「数据库与表结构变更」）。',
  'site.docs.selfhost.s1i3': '它需要的是一台长期开着的机器、一个你自己的域名，以及"会看服务日志、能让证书按时续期"这类基本运维能力。',
  'site.docs.selfhost.s1i4': '三个必填项**没有默认值**，要自己生成：`JWT_SECRET`、`PASSWORD_PEPPER` 不给或短于 32 个字符，服务**拒绝启动**；`POSTGRES_PASSWORD` 不给，数据库容器直接退出。这是刻意的，它不给"用默认密钥上线"留活路。对外域名是另一档，它坏的形态不一样：`DOMAIN` 只给网关当站点地址（服务端本体不读它，空着是网关自己起不来），`PUBLIC_URL` 有默认值 `http://localhost:1900` —— 留着不改不会报错，坏得很安静：邮件里的链接指向 localhost。',
  'site.docs.selfhost.s2': '要配的东西',
  'site.docs.selfhost.s2i1': '邮件服务：只管**激活账号**那一步（发验证邮件）。注册与登录本身走**邮箱 + 口令**，不配 SMTP 也建得了号 —— 只是那封信发不出去，而界面会明说这件事：要么让管理员配好再提交一次，要么设 `REQUIRE_EMAIL_VERIFICATION=false` 跳过这一步。',
  'site.docs.selfhost.s2i2': '对外地址：生产环境下把它填成非加密地址，服务会拒绝启动。局域网内用明文地址是自建的正当场景，公网不是。',
  'site.docs.selfhost.s2i3': '通行密钥：需要真实域名。纯 IP 地址会被浏览器拒掉，所以用 IP 访问时只剩邮箱链接这一条路。',
  'site.docs.selfhost.s2i4': '谁能注册：可以用邮箱白名单把注册关上。关上之后别人看到的提示是「这个服务端不允许用该邮箱注册」。',
  'site.docs.selfhost.s3': '完整步骤在哪',
  'site.docs.selfhost.s3p1': '仓库里有给运维看的部署手册和本地起服务手册（导航栏那个图标就是仓库入口），那是给要动手的人写的；这一页那条起服务的命令与它们**逐字是同一条**，仓库里有一枚门禁盯着这条命令的每一份抄件，改任何一边都会让它红。这一页的职责是让你在决定要不要自建**之前**，先知道它长什么样。',
  'site.docs.selfhost.s3w1': '自建之后，你就是那个"能看到元数据的人" —— 加密边界与前面那篇讲的是同一套。',
  'site.docs.selfhost.s4': '起来之后，你的日常是这三件事',
  'site.docs.selfhost.s4p1': '升版本。你得自己决定什么时候上新代码，而上之前先备份数据库 —— 表结构的变更按"只向前"的方式发：已经上过的那一份不会被改动，要修就再发一次新的。所以升级出了问题，退路是回到备份，不是去改历史。',
  'site.docs.selfhost.s4p2': '续证书。域名和证书都得续。证书过期时最先坏的是邮件里的链接与客户端的 HTTPS 握手，而这两个症状看上去都像"账号没了"。',
  'site.docs.selfhost.s4p3': '看日志。上面每一条症状 —— 拒绝启动、注册收不到邮件、界面一直离线 —— 真正的原因只在服务日志里；界面上能看到的永远是最后那句转述。',
  'site.docs.selfhost.s5': '你备份出来的是密文，这是设计',
  'site.docs.selfhost.s5p1': '服务端库里存的是加密之后的操作流水，加上必要的元数据。拿这份备份把服务恢复回去完全可行，但在库里直接读出某条任务的标题是读不出来的 —— 这不是备份坏了，这就是端到端加密的定义。',
  'site.docs.selfhost.s5p2': '想要一份**能读**的备份，走客户端的导出（见「把数据带走、带回来」）。导出解开的是这一台设备本地物化好的状态，所以导出的东西和你看得见的一致。',
  'site.docs.selfhost.s5w1': '别把"库里读不出明文"当成"这份备份没用"：它是服务恢复的完整来源。"给人读"不是它的职责。',
  'site.docs.selfhost.s6': '界面显示离线，先看这一条',
  'site.docs.selfhost.s6p1': '最常见的不是服务挂了，而是**请求根本没发出去**。服务端只放行它在配置里明确列出的那几个前端来源；你的页面来源不在那份清单里时，浏览器会在本地就把请求拦下 —— 于是界面显示"离线"，而服务日志一条都不会有。',
  'site.docs.selfhost.s6p2': '所以排查的顺序是反的：先看浏览器控制台的跨域报错，再看服务端日志。日志安静不等于服务正常，也可能只是没有人问到它。',
  'site.docs.selfhost.s6i1': '放行哪些前端来源由服务端的 `CORS_ORIGINS` 决定，多个来源用逗号分开写；生产环境下"全都放行"会被直接拒绝启动。',
  'site.docs.selfhost.s7': '怎么装：没有现成镜像，两条路自己选',
  'site.docs.selfhost.s7p1': '目前**没有发布任何 heyta 镜像**，所以这里没有可钉的版本号。不要把 `SUPERSYNC_IMAGE` 指向上游的 `master-〈提交号〉`：那是另一个项目的服务端，它的数据表结构与加密要求早已和 heyta 分开——照做只会得到一台**能正常启动、健康检查也通过、跑的却是陌生的表结构**的服务器。要钉版本，就从本仓库源码构建，并把那份源码的提交号作为版本标识传进构建。',
  'site.docs.selfhost.s7p2': '两条路都受支持，差别在升级时。`./scripts/deploy.sh --build` 把整套栈（应用、PostgreSQL 数据库、Caddy 网关）一起拉起来，在**旧容器还在服务**的时候先把迁移跑完，迁移不成就**不换容器**，起来之后还会验一次健康检查。另一条是一条 `docker compose` 起全套：`docker compose -f docker-compose.yml -f docker-compose.build.yml -f docker-compose.migrate-once.yml up -d --build`。构建与一次性迁移那两份 override 都不能省，`--build` 也不能省 —— 少掉 `docker-compose.build.yml` 它就会去拉一个根本不存在的镜像，而少了 `--build` 它也不会自己把镜像打出来，两种省法最后都停在同一个"起不来"上。而它**只在第一次开机时迁移**：升级要么回到部署脚本，要么显式把那个一次性迁移服务再跑一遍。注意裸的 `docker compose up` **不是**部署：容器启动时的自动迁移默认是关的（防止重启和迁移互相踩），所以"只把容器拉起来"会跑在没迁移过的表结构上。',
  'site.docs.selfhost.s7p3': '加 `--build` 可以在部署机上自己构建镜像，但那是把整个仓库在部署机上完整编译一遍：峰值内存要额外 1.5 GB 以上（容器本身已占约 2.5 GB），构建缓存每构建一次涨约 1.4 GB 且**不会自动清理**。小机器的正确姿势是在别处构建好再推过去，或者直接钉住现成标签。`--build` 还会拒绝在源码不干净时构建 —— 构建产物必须能对回到某一份确切的源码。',
  'site.docs.selfhost.s7i1': '三个必填项（`JWT_SECRET`、`PASSWORD_PEPPER`、`POSTGRES_PASSWORD`）不给齐，这套栈起不来：前两个是服务自己抛、**拒绝启动**，第三个是数据库容器直接退出。没有"用默认密钥上线"这条路的活口，这是故意的。对外域名不在必填里，它坏的形态也不一样：`DOMAIN` 只给网关当站点地址（服务端本体不读它，空着是网关自己起不来），`PUBLIC_URL` 有默认值 `http://localhost:1900` —— 留着不改不会报错，坏得很安静：邮件里的链接指向 localhost。',
  'site.docs.selfhost.s7i2': '部署脚本会核对镜像的源码版本标签，防止"拿旧镜像跑新迁移"。自建自定义镜像时要传入同样的版本标识；确信要跳过这份核对也有显式开关，但那是给你的故意，不是给你的疏忽。',
  'site.docs.selfhost.s8': '要配的环境变量，逐个说',
  'site.docs.selfhost.s8p1': '配置全在部署目录的 `.env` 一个文件里（从仓库的 env.example 复制来改）。改完重启容器生效。下面按"配错了会发生什么"来讲：',
  'site.docs.selfhost.s8i1': '`DOMAIN` / `PUBLIC_URL`：前者**只给 Caddy 当站点地址**（服务端本体不读它），后者才是**邮件里那些链接的来源**。`PUBLIC_URL` 填错的症状是"邮件里的链接打不开"；而它留着默认值（`http://localhost:1900`）时**不会有任何报错** —— 服务照常起、邮件照常发，只是链接指向你自己的笔记本。',
  'site.docs.selfhost.s8i2': '`JWT_SECRET`：登录令牌的签名密钥。空着拒绝启动；**部署定好之后不要再换** —— 换掉它，所有已登录设备立刻全部登出，在途的邮件链接一并作废。',
  'site.docs.selfhost.s8i3': '`POSTGRES_PASSWORD`：数据库口令。同样没有默认值。用栈里自带的数据库时不用另配连接串，默认连本栈的 PostgreSQL 16。',
  'site.docs.selfhost.s8i4': '`WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN`：通行密钥绑定的域名。它只能取**一个**值，所以换域名 = 这台服务器上注册过的通行密钥全部作废（账号不丢，用邮件链接重新登入再注册一把即可）。必须是真实域名，纯 IP 浏览器不收。',
  'site.docs.selfhost.s8i5': '`CORS_ORIGINS`：允许哪些前端来源调接口，逗号分隔，支持 `https://*.example.com` 这种通配。默认值指向上游的演示站 —— **自建必须改成自己的**，不改的症状就是前面那节说的"界面一直离线"。',
  'site.docs.selfhost.s8i6': '`SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM`：发信配置。它决定**验证邮件**发不发得出去（也就是账号能不能自助激活），**不**决定能不能注册 —— 不配也建得了号，界面会明说信没发出去，而不是假装发了。',
  'site.docs.selfhost.s8i7': '`HOST`：服务自己监听的地址，默认所有网卡。放在网关后面时可以收紧到本机。',
  'site.docs.selfhost.s9': '数据库与表结构变更',
  'site.docs.selfhost.s9p1': '数据库用 PostgreSQL。表结构的变更**只向前发**：已经应用过的变更文件永不被改动，要修就再发一份新的 —— 所以升级出问题时，退路是回备份，不是去改历史。',
  'site.docs.selfhost.s9p2': '两条路的时机不一样：走 `./scripts/deploy.sh` 时，迁移由部署脚本在换容器前跑一次；走 `docker compose` 时，它由那份一次性迁移服务（服务名 `supersync-migrate`）在第一次开机跑完就退出 —— 而 compose 不会重跑一个已退出的服务，**所以改过表结构之后的升级要再点名执行它一次**。个别变更用了"后台建索引"的方式，在繁忙的大库上可能等锁 —— 挑低峰期做升级，给迁移留足超时时间（默认 15 分钟，可调）。超时退出有专门的退出码，清掉堵住的事务重跑即可。',
  'site.docs.selfhost.s9p3': '备份的最小口径：定期备份数据库。备份里是密文载荷加上外围信息 —— 它是恢复服务的完整来源，但不是能直接翻看内容的相册（见下面「备份是密文」一节）。',
  'site.docs.selfhost.s10': '你的服务器上到底存了什么',
  'site.docs.selfhost.s10p1': '每一笔改动是一条**加密的操作记录**。设置数据钥匙后，口令或恢复码在设备上解锁钥匙，操作载荷加密后才上传；尚未迁移的旧格式记录仍使用原加密口令。服务端只保存密文，不能解密内容。',
  'site.docs.selfhost.s10p2': '外围信息是明的：动作类型、涉及的实体类型与编号、时间戳、各设备的版本先后、密文大小。这些是同步协议工作的必需品，躲不掉 —— 但自建的意义之一正是：它们落在**你**手里，不落在第三方手里。',
  'site.docs.selfhost.s10p3': '恢复同步数据需要设备上的解密钥匙，或用于解锁钥匙的口令、恢复码。登录密码重置和服务端备份都不能替代这些凭据；口令与恢复码都丢失时，先从仍能读取数据的旧设备导出留底。尚未迁移的旧格式密文仍需要原口令。',
  'site.docs.selfhost.s11': '命令行宿主：不开浏览器也能用',
  'site.docs.selfhost.s11p1': '除了 Web 与手机，仓库里还有一个**命令行宿主**：它连一个真实的本地数据库文件，在终端里建任务、列任务、同步。它走的是和其它端完全相同的同步协议 —— 配上同一个服务端，它就是又一台"设备"。',
  'site.docs.selfhost.s11i1': '配置走参数或环境变量：`--db` 本地数据库文件（必填）、`--server` 服务端地址、`--token` 访问令牌、`--password` 端到端加密口令；也可以用大写环境变量（`HEYTA_DB` / `HEYTA_SERVER_URL` / `HEYTA_TOKEN` / `HEYTA_PASSWORD`）。',
  'site.docs.selfhost.s11i2': '常用命令：`add` 建任务、`list` / `rename` / `complete` / `reopen` 管任务、`projects` / `tags` 看清单与标签、`sync` 同步一次、`pending` 看待上传队列长度。',
  'site.docs.selfhost.s11i3': '`export --out` 导出全部数据（含已删除记录与完整操作流水）；`import --in` 还原 —— 与其它端同一条规矩：**只进空库**，非空拒绝且不动现有数据。',
  'site.docs.selfhost.s11i4': '边界要知道：建任务只有一个日期参数（`--due`），目前**设不了重复规则**（读得到、设不了）；它是给脚本和重度终端用户用的，不是管重复任务的界面。',

  // 自动化与外部数据接入

  // 导出与导入
  "site.docs.automation.title": "自动化与外部数据接入",
  "site.docs.automation.seo.title": "JSON 与 AI 自动收集 —— heyta",
  "site.docs.automation.sum": "了解现有本机 API、MCP 与 JSON 导入；查看规划中的付费回调、AI 自动收集与适用场景。",
  "site.docs.automation.s1": "应用内 AI：从描述到待办",
  "site.docs.automation.s1p1": "可以在助手中描述任务、日期和优先级。执行模式下，已授权的普通创建会直接保存；高风险改动需要确认。只读模式不会改动任务。",
  "site.docs.automation.s1p2": "客户端负责解析流程和提交任务；选择远程模型时，获准的数据会发送给所选提供商，并非全部计算都在本机完成。自带端点与官方托管 AI 按各自配置使用。",
  "site.docs.automation.s2": "JSON 接入：本机 API 与 MCP",
  "site.docs.automation.s2p1": "仓库中的 Node 宿主提供回环 HTTP JSON-RPC 2.0 和 MCP stdio。脚本可按工具契约提交 JSON，例如用 create_task 创建任务；这不是接收任意内容后自动理解的公网地址。",
  "site.docs.automation.s2p2": "需要运行对应宿主、启用入口、配置访问令牌并授权工具。授权范围内的本机写工具可直接执行，共用应用的任务写入路径。浏览器设置开关本身不会启动监听。",
  "site.docs.automation.s2p3": "JSON 备份导入是另一种能力：只接受 heyta 的固定备份格式，并要求目标库为空。任意 JSON、邮件和 CSV 不能直接当备份导入。",
  "site.docs.automation.s3": "付费自动收集（规划中）",
  "site.docs.automation.s3p1": "计划从“设置 → AI 与集成 → 自动收集”创建规则：外部服务提交 JSON 或文本，获授权设备领取后调用 AI 提取任务、时间和目标清单，再按规则保存。首版只接收 JSON 与文本；附件、OCR 与任意网页抓取不在首版范围。此功能尚未上线，目前没有可用回调地址。",
  "site.docs.automation.s3p2": "规则默认只创建任务。时间明确的进入日历，没有日期的进入收集箱，有歧义的等待确认。设备离线时显示“等待设备处理”；接收成功不等于任务已创建。来源事件编号用于防止重复添加。",
  "site.docs.automation.s3p3": "这项高级自动收集要求有效付费权益，官方托管和自托管均需验证；自带模型也不绕过该功能的权益校验。额度与计费以上线说明为准，现有本地导入、同步和本机工具不因此追溯改成付费。",
  "site.docs.automation.s4": "适用场景（回调接入均待上线）",
  "site.docs.automation.s4i1": "**构建与发布**：流水线失败后发送摘要，生成带来源链接的修复任务；不能凭空推断截止时间。",
  "site.docs.automation.s4i2": "**监控告警**：证书即将到期、磁盘不足或服务异常，生成可追踪的处理事项。",
  "site.docs.automation.s4i3": "**表单与工单**：将提交和分配转成跟进待办；明确的服务期限可作为截止时间。",
  "site.docs.automation.s4i4": "**会议与邮件**：从纪要或正文提取行动项，按规则写入对应清单。",
  "site.docs.automation.s4i5": "**语音与快捷指令**：上游先把语音转成文字，再发送给回调；首版不直接接收音频。",
  "site.docs.automation.s4i6": "**家庭设备**：缺墨、耗材到期等事件，形成采购或维护待办。",
  "site.docs.automation.s4i7": "**课程与预约**：提取确定的日期、时间和时区，形成日历上的待办；缺失或冲突时请求确认。",
  "site.docs.automation.s4i8": "**研发与稍后读**：issue 指派或 RSS 摘要转成任务，保留编号与链接；发送链接不代表系统会抓取网页。",
  "site.docs.automation.s5": "数据与隐私",
  "site.docs.automation.s5p1": "普通回调在服务端接收时会短暂暴露本次载荷的明文，之后计划加密暂存；不能把它称为全程端到端加密。使用远程 AI 时获准内容会发往所选提供商。接收外部资料不赋予服务端解密现有任务库的能力。",
  "site.docs.automation.s5p2": "规划包含可撤销凭据、轮换密钥、暂停规则和可查看的失败状态。外部内容只作为数据解析，不能指挥助手扩大权限。保留期、额度、删除与隐私条款将在功能上线前明确。",

  'site.docs.transfer.title': '导出与恢复数据',
  'site.docs.transfer.seo.title': '把数据带走、带回来 —— heyta',
  'site.docs.transfer.sum': '备份与恢复、JSON 与本机 API 接入的边界；把外部数据自动变成任务的规划见「自动化与外部数据接入」一篇。',
  "site.docs.transfer.diyTitle": "JSON 与 DIY 接入：当前能力",
  "site.docs.transfer.diyCurrent": "当前导入支持符合 heyta 导出格式的 JSON 备份，并要求目标库为空；不能把任意 JSON、CSV 或一封邮件当作备份文件直接导入。导入前先导出一份当前数据。",
  "site.docs.transfer.diyApi": "开发者可使用仓库里的 Node 宿主接入本机 HTTP API 或 MCP，将数据按工具契约转换为任务。它需要运行对应宿主、启用入口并授权工具；只在浏览器设置中打开开关不会启动监听服务。不要把本机接口直接暴露到公网。",
  'site.docs.transfer.s1': '导出',
  'site.docs.transfer.s1p1': 'Web：设置页 →「导出数据」。移动端：我的 →「导出数据」，走系统的分享面板。另外还有一个命令行入口也能导出导入，写法见「自建一套同步服务器」里的命令行一节。',
  'site.docs.transfer.s1i1': 'JSON 是**完整**备份：含已删除记录与完整的操作流水，所以你能核对"到底导全了没有"。丢掉已删除记录的备份在回放时会让老数据复活。',
  'site.docs.transfer.s1i2': '另有一份给人直接读的 Markdown。',
  'site.docs.transfer.s1i3': '文件里带着可对账的计数，不用靠感觉判断导全了。',
  'site.docs.transfer.s2': '导入',
  'site.docs.transfer.s2p1': '目前**只有 Web 与命令行有导入入口**，而且**只支持还原到一个空库** —— 它不是往一份已有数据里做合并。',
  'site.docs.transfer.s2w1': '**移动端没有导入入口。**手机上拿到的备份，确实要在手机上导不回去 —— 要么用 Web，要么用命令行。',
  'site.docs.transfer.s3': '这不只是"备份"',
  'site.docs.transfer.s3p1': '导出与导入同时是"把自己的数据从一台服务器搬到另一台"的路，也是前面那篇「口令丢了」之后唯一的自救手段。所以它是自建叙事的一部分，不是一个可选的附属功能。',
  'site.docs.transfer.s4': '先分清两条路：同步与搬文件',
  'site.docs.transfer.s4p1': '换一台设备、换一个浏览器，最省事的一条**不是**导入，而是把同步配回来：填同一个服务端地址、回到同一个账号，历史会自己下来，不需要你手上正好有备份文件。',
  'site.docs.transfer.s4p2': '导出与导入是另一条路，用在服务给不了你的时候 —— 自建迁移、准备下线、或者只想留一份在自己手里。两条路的产物不一样：同步回来的是完整历史，导入回来的是导出那一刻的状态。',
  'site.docs.transfer.s5': '为什么它只肯导进空库',
  'site.docs.transfer.s5p1': '这不是没做完，是刻意拒绝。往一份已有数据里合并时，同一个东西在两边都可能被改过，而应用没有任何可靠的依据判断该信哪一边 —— 只能去比"谁改得更晚"，而那正是丢数据的方式，不是合并的方式。',
  'site.docs.transfer.s5p2': '所以你看到的规则很硬：目标必须是空库。它在写任何东西之前先读一遍本地流水，判断这算不算空；被拒绝的时候，你已有的数据一个字都不会变。',
  'site.docs.transfer.s5w1': '"空库"指的是**这台设备还没有操作流水**，不是"应用刚装上"。一台已经同步过的设备早就有历史了，对它点导入会被拒。',
  'site.docs.transfer.s6': '导进去之后核对什么',
  'site.docs.transfer.s6p1': '文件自己带着计数，导入会先校验再写：不是 heyta 导出的、格式版本不认、计数自己对不上，都会整份拒绝 —— 它不会"能导多少算多少"。',
  'site.docs.transfer.s6p2': '收尾动作是拿导出时那份计数对一遍，再在界面上扫一眼：清单、标签、回收站。回收站里应当还能看见你删掉的那些条目 —— 它们在备份里是内容，不是可以被顺手清理掉的噪声。',
  'site.docs.transfer.s6i1': '这份 JSON 不是一条同步通道：它只代表导出它的那一台设备。要让别的设备也变成这样，走同步。',

  // 装完第一步
  'site.docs.first-run.title': '开始使用 heyta',
  'site.docs.first-run.seo.title': '装完第一步，先弄清三件事 —— heyta',
  'site.docs.first-run.sum': '添加第一条任务，了解本地使用与账号同步。',
  'site.docs.first-run.s1': '一、不开账号也能用',
  'site.docs.first-run.s1p1': '打开 heyta 什么都不填，你可以直接建任务 —— 数据写进**这台设备自己的数据库**：Web 在浏览器的本地存储里，手机应用在自己的应用数据里。',
  'site.docs.first-run.s1p2': '移动端冷启动那一屏给的是**两个同等分量的出口**：「注册 / 登录」和「先离线使用」，不是一定要你留邮箱。',
  'site.docs.first-run.s1p3': '⚠️ 但本地使用也不是"暂时凑合"的降级态：没有账号时换设备、或清掉浏览器数据，就是**另一份数据**，两边不会自己合起来。',
  'site.docs.first-run.s2': '二、同步是要你亲手开的那扇门',
  'site.docs.first-run.s2p1': '登录 heyta 后即可在设备间自动同步，无需填写服务器地址。你也可以继续只用本机；自托管连接位于同步设置的高级选项。',
  'site.docs.first-run.s2p2': '注册与登录走**邮箱 + 口令**：填邮箱、设一个口令、点验证邮件里的链接激活。不想用口令也还有两条路 —— 点**邮件里的一次性链接**，或者用**通行密钥**（设备的人脸 / 指纹 / 系统 PIN）。',
  'site.docs.first-run.s2p3': '登录后，在“应用设置 → 账号同步”确认连接和加密状态。保持联网时，应用会自动同步改动；离线修改会先保存在本机，恢复连接后继续同步。',
  'site.docs.first-run.s2p4': '桌面端从头像菜单进入登录；移动端从“我的”进入账号。官方服务无需配置地址，自托管连接保留在高级选项中。',
  'site.docs.first-run.s3': '三、侧栏里那几个开关只属于这台设备',
  'site.docs.first-run.s3p1': '日历、四象限、习惯、时间线、专注、成长、便签这七个模块可以随时关掉。**关掉**的意思是：它不进页面，不是灰着不能用。',
  'site.docs.first-run.s3p2': '⚠️ 这个开关是**这台设备的本地偏好**：不写进操作日志、也不跨设备同步。在手机上关掉专注，电脑上的专注还在。',
  'site.docs.first-run.s3i1': '默认开着：日历、四象限、习惯、时间线。',
  'site.docs.first-run.s3i2': '默认关着：专注、成长、便签 —— 第一次进来不会看见全部界面。',
  'site.docs.first-run.s3i3': '关不掉的只有任务与搜索。',
  'site.docs.first-run.s4': '四、第一屏该做什么',
  'site.docs.first-run.s4p1': 'Web 打开落在任务视图，输入框就在列表上方：写下标题、回车，一条任务就落进了本地库。',
  'site.docs.first-run.s4p2': '点击任务打开详情，设置日期、优先级、清单、标签和重复规则。移动端也使用任务详情编辑这些信息。',
  'site.docs.first-run.s4p3': '先添加一条任务，再试着设置日期、完成任务。需要了解更多操作时，随时从设置打开帮助中心。',
  'site.docs.first-run.fig.tasks': 'Web 的第一屏：输入框就在列表上方，侧栏常驻收集箱、今天、已完成',
  'site.docs.first-run.fig.tasks.alt': 'Web 任务视图，收集箱为空，列表上方是添加任务的输入框',

  // 概念模型
  'site.docs.concepts.title': '任务、清单与标签',
  'site.docs.concepts.seo.title': '任务、清单、标签、习惯各指什么 —— heyta',
  'site.docs.concepts.sum': '了解任务的组织方式，以及习惯与任务的区别。',
  'site.docs.concepts.s1': '任务：一条记录上有哪些字段',
  'site.docs.concepts.s1p1': '一条任务带着标题、备注、截止时间、优先级、是否"重要"、所属清单、标签、重复规则。',
  'site.docs.concepts.s1p2': '优先级是四档：无 / 低 / 中 / 高。它和"重要"是**两个字段** —— 四象限用的是"重要 × 紧急"，只有在你没手动标过重要时，它才拿高优先级顶上。',
  'site.docs.concepts.s1p3': '收集箱不是一个清单，它是**还没归清单的任务**显示出来的名字。所以"把任务移进收集箱"这件事在数据上不存在，只有"从清单里移出来"。',
  'site.docs.concepts.s2': '清单：只能套一层',
  'site.docs.concepts.s2p1': '清单可以有一个当作文件夹的上级清单。⚠️ **只有这一层** —— 它不是无限嵌套的目录树，这是刻意的限制而不是没做完。',
  'site.docs.concepts.s2p2': '一条任务只属于**一个**清单（或不属于任何清单）。所以"这条任务同时出现在两个清单里"做不到，能重叠的维度是标签。',
  'site.docs.concepts.s3': '标签：一条任务的多个横切面',
  'site.docs.concepts.s3p1': '标签与任务是**多对多**：一条任务可以挂几个标签，同一个标签可以出现在任意多条任务上。',
  'site.docs.concepts.s3p2': '改标签是"整组覆盖"：这次写入的是这条任务最终应该有哪些标签的**完整集合**，而不是"加一个"或"删一个"的增量 —— 悬空的标签 id 会在写入时被挡掉。',
  'site.docs.concepts.s3p3': '标签不决定排序、也不带颜色层级。它是筛选用的横切面，清单才是归属。',
  'site.docs.concepts.s4': '习惯：定义与打卡是分开的两样东西',
  'site.docs.concepts.s4p1': '习惯是**目标、单位、频率、连续天数规则**这套定义；每天那一下记录是另一条独立数据（哪天、值多少、可选一句备注）。',
  'site.docs.concepts.s4p2': '连续天数**不存在**习惯这条记录里，它是从打卡记录**算出来的**。所以补打或删掉某一天，连续天数会跟着变，而不是"记了个数字再也不动"。',
  'site.docs.concepts.s4p3': '这也是"只与自己的过去比"那套成长统计的基础：统计是派生结果，不是另存的一份真相。',
  'site.docs.concepts.fig.habits': '习惯面板：新建框在顶部，一次只填一个名字',
  'site.docs.concepts.fig.habits.alt': 'Web 习惯面板，顶部是新建习惯的输入框，下面写着还没有习惯',
  'site.docs.concepts.s5': '视图不是第五种数据',
  'site.docs.concepts.s5p1': '四象限、日历、时间线、今日视图，都是从任务字段**算出来的显示方式**。数据里没有"四象限的一条记录"这种东西。',
  'site.docs.concepts.s5p2': '这个决定挡掉一类经典 bug：视图与任务各存一份、然后两边对不上。在这里它们不可能对不上，因为只有一份。',
  'site.docs.concepts.s5p3': '有一条实际影响：把任务从象限这头拖到那头，改的是它的**重要与截止时间字段**，不是"把它放进一个叫象限的容器"。',

  // 重复任务
  'site.docs.repeat.title': '设置重复任务',
  'site.docs.repeat.seo.title': '重复任务勾掉之后下一次怎么算 —— heyta',
  'site.docs.repeat.sum': '设置重复规则，了解完成后的日期顺延方式。',
  'site.docs.repeat.s1': '规则是一条通用的标准格式',
  'site.docs.repeat.s1p1': '重复规则用的是日历领域通用的 **RRULE** 文本格式（就是界面上"自定义规则"里直接写的那种），另记录了规则从哪天开始算。不是我们自己发明的一套"每 N 天"。',
  'site.docs.repeat.s1p2': '界面上给你常用预设（不重复 / 每天 / 每周 / 工作日 / 每月），也让你**直接写自定义规则**。写进去之前会先校验，不合法的规则会当场报错而不是静默保存。',
  'site.docs.repeat.s1p3': '为什么值得用标准：同一条规则将来能被别的日历产品读懂，也能被导出成别的格式；自己一套方言做不到这件事。',
  'site.docs.repeat.s2': '顺延的基准：原本的到期日',
  'site.docs.repeat.s2p1': '勾掉一条重复任务，应用把**同一条任务**的截止时间往后推一个周期，起点是它**当前那个到期日**，不是"你几点勾的"。',
  'site.docs.repeat.s2p2': '这条有两个不那么直观的后果：任务已经过期几天时，一次勾选只是把它推到"过期的下一格"，可能要连勾几次才回到将来；而推进后**一天里的具体时刻不保留**。',
  'site.docs.repeat.s2p3': '⚠️ 它也不是"每天生成一条新任务"那种模型：到期后仍然是同一条任务在被更新，所以它的历史、备注、清单归属都是连续的。',
  'site.docs.repeat.s2p4': '原因是重复规则算的是**日历日期**，不是时间点，也不绑任何时区。绑上时区的话，跨夏令时或跨零点会整体偏移一天 —— "每周一重复"会在某些周变成周二。代价是"几点到期"这条信息不进这套算法，所以推进后只保留日期。',
  'site.docs.repeat.s3': '规则到尽头怎么办',
  'site.docs.repeat.s3p1': '规则写了 `UNTIL` 或 `COUNT` 且已经用尽，这一次勾掉就是**普通完成** —— 不会再往后推。',
  'site.docs.repeat.s3p2': '下一次永远**严格晚于**当前截止时间（不含"今天同一格"）：今天到期的"每天重复"，勾掉之后落在明天。',
  'site.docs.repeat.s4': '哪一端能设',
  'site.docs.repeat.s4p1': 'Web 与移动端都能设：两端都是同一组预设 + 自定义 RRULE，写进去的是同一条字段，所以在一端设的规则在另一端读得见、也改得动。',
  'site.docs.repeat.s4w1': '⚠️ 设了重复规则但任务原本没有截止时间，应用会补一个 —— 没有"几点到期"这条锚，"每两周"这类规则根本无从算起。',

  // 视图
  'site.docs.views.title': '选择任务视图',
  'site.docs.views.seo.title': '四象限、日历、时间线、搜索各解决什么 —— heyta',
  'site.docs.views.sum': '用日历安排日期，用四象限判断优先级，再用时间线与搜索回看。',
  'site.docs.views.s1': '四象限回答"现在该做哪条"',
  'site.docs.views.s1p1': '两条轴：**重要**（任务上单独的字段）与**紧急**（有截止时间、落在两天以内、或已经过期）。已完成与已删除的不进图。',
  'site.docs.views.s1p2': '把任务从一格里拖到另一格，改的是它的"重要"与截止时间 —— 拖完它还是同一条任务、同一段历史，不是复制了一份。',
  'site.docs.views.s1p3': '⚠️ "紧急"的窗口是**两天**，这是产品决定，不是行业标准：明天的任务在图里，下周的不在。',
  'site.docs.views.fig.quadrant': '四象限：四格各自标着重要与紧急的组合，空着的那格提示把任务拖进来',
  'site.docs.views.fig.quadrant.alt': 'Web 四象限视图的四张象限卡与拖任务进来的提示',
  'site.docs.views.s2': '日历回答"哪天有东西"',
  'site.docs.views.s2p1': '日历把有截止时间的任务按天摆出来。Web 与移动端用的是**同一块板**（同一个组件），不是两套各画一遍各自漂移。',
  'site.docs.views.s2p2': '重复任务在日历上出现的是**当下这一条**的下一次到期，不是一眼铺开一年的副本 —— 数据里也从来没有那些副本。',
  'site.docs.views.s3': '时间线回答"这几天塞不塞得下"',
  'site.docs.views.s3p1': '时间线是**排期视图**：把任务按预估时长铺在一条时间轴上，看的是接下来几天排不排得开。它读的是任务与估时，不是"已经做过什么"—— 回看做过什么在成长里。',
  'site.docs.views.s3p2': '任务备注里写了清单，就按清单逐条排；没写清单就把整条任务算一条 —— 否则这条任务会在时间线上完全不出现，而它恰恰是最需要知道要花多久的那一类。',
  'site.docs.views.s3p3': '⚠️ 估时是整条任务的、清单却有好几条时，**它不按比例分摊**：界面明说摊不到子条目上，子条目按默认时长排。每条块上都直接写着时长来路 —— 「约 1 小时」是你填的，「约 1 小时 · AI 估时」是 AI 估的，「未估时」就是真没估过。',
  'site.docs.views.fig.timeline': '时间线没有条目可排时，它把"先去建任务、再写清单"这句话直接写在界面上',
  'site.docs.views.fig.timeline.alt': 'Web 时间线视图的空状态，顶部是当天完成数，下方是解释下一步做什么的提示',
  'site.docs.views.s4': '搜索回答"那条叫什么来着"',
  'site.docs.views.s4p1': 'Web 有一个跨内容的搜索面板，任务与便签都能搜。⚠️ 移动端目前是任务列表**内部的过滤输入框** —— 两端都叫搜索，能搜的范围不一样。',
  'site.docs.views.s4p2': '端到端加密不挡搜索：搜的是**你这台设备上本地解密后的内容**。服务器从来没拿到明文，也轮不到它来回答这个查询。',
  'site.docs.views.s4p3': '已删除的内容不会被搜出来，但它们在导出备份里仍然在 —— 见「回收站与"彻底删除"」。',
  'site.docs.views.s5': '关掉的模块，是真的不在页面上',
  'site.docs.views.s5p1': '日历、四象限、时间线都能从设置里关掉；关掉之后它**不进 DOM**，不是灰着不能用。',
  'site.docs.views.s5p2': '这个开关只属于这台设备，不跨设备同步 —— 所以"我这边怎么没有四象限"是个设备本地问题，别去查同步。',

  // 提醒
  'site.docs.reminders.title': '提醒与通知',
  'site.docs.reminders.seo.title': '提醒与通知什么时候会响 —— heyta',
  'site.docs.reminders.sum': '开启提醒，并检查系统权限与各端通知限制。',
  'site.docs.reminders.s1': '提醒不是任务上的一个开关',
  'site.docs.reminders.s1p1': '每条提醒是**独立的一条数据**：属于哪条任务、什么时候触发、可选一个提前量，另外还有已触发、稍后提醒到什么时候、已忽略这些状态。',
  'site.docs.reminders.s1p2': '一条任务上最多 **5 条**生效中的提醒。超出会被挡住并明确拒绝，不是静默吃掉。',
  'site.docs.reminders.s1p3': '做成独立数据而不是一堆字段，是因为它要单独被改：稍后提醒、忽略、随重复规则顺延，都不该重写任务本体。',
  'site.docs.reminders.s2': '什么时候会响 —— 以及为什么有时候不会',
  'site.docs.reminders.s2p1': 'Web：**应用开着**才响。到点之后由浏览器把通知弹出来，而前提是你先在界面上授权过通知权限 —— 授权必须由你那一下点击触发，这是浏览器的规则，不是我们的选择。',
  'site.docs.reminders.s2p2': '⚠️ 页面关了就什么都不会响：触发时间在本地早就算好了，但**没人在读它**。这条限制写在代码注释里，是一个已知的边界，不是临时状态。',
  'site.docs.reminders.s2p3': '移动端：Android 与 iOS 都使用系统本地通知中心。投递仍受平台权限和系统调度限制；没有权限或回执不确定时，提醒保持为到期，不伪造已投递事实。',
  'site.docs.reminders.s2p4': '时间上有几条边界：触发时刻最多排在**一年**以内；「稍后提醒」默认 **10 分钟**、最多 **7 天**，超出上限是**钳到上限并显示实际值**，而不是让你的点击失败；比当下早一点点是允许的（一分钟的窗口），因为算出时刻与真正落库之间本来就要过几百毫秒。',
  'site.docs.reminders.s2i1': 'Web 需要页面开着并已授权通知。Android/iOS 已排入系统的提醒可在应用进程退出后由系统投递，但仍受权限、系统调度和设备状态限制。',
  'site.docs.reminders.s2i2': '静音与"稍后提醒"是两条不同的路：前者只是这一条不再弹，后者会把触发时间整体推后。',
  'site.docs.reminders.s2i3': '移动端本地通知不需要服务端推送。Android 强行停止后要重新打开应用才能补算；iOS 只排最早的 64 个提醒，之后的提醒在启动或回前台时补排。多台设备离线时可能各自提醒，不能保证全局只响一次。',
  'site.docs.reminders.s3': '重复任务的提醒会跟着挪',
  'site.docs.reminders.s3p1': '勾掉一条重复任务时，**按提前量算出来**的那些提醒会重新排到下一次到期；写死某个时刻的提醒不动。',
  'site.docs.reminders.s3p2': '所以"每天 9 点、提前 10 分钟"会自己顺延，而"就定在 3 月 5 日 14:00"不会 —— 它不知道自己挂着哪条任务的下一次。',
  'site.docs.reminders.s3p3': '顺延是**把同一条提醒重排**，不是新建一条。新建的话每个周期都会留下一个永不过期的提醒，几个周期就撞上"一条任务 5 条"的上限。',
  'site.docs.reminders.s4': '界面上那个铃铛不是提醒',
  'site.docs.reminders.s4p1': '铃铛是**账号收件箱**：服务端的账号级通知（订阅、配额这类）与邀请进度落在里面。',
  'site.docs.reminders.s4p2': '它装的是"关于这个账号发生了什么"，不是"你的任务到期了"—— 任务内容不会出现在这条通道里，服务端也解不开它。',

  // 回收站
  'site.docs.trash.title': '回收站与删除',
  'site.docs.trash.seo.title': '回收站与彻底删除为什么删不掉历史 —— heyta',
  'site.docs.trash.sum': '恢复误删任务，了解彻底删除与历史记录的边界。',
  'site.docs.trash.s1': '回收站里有什么',
  'site.docs.trash.s1p1': '任务、便签、清单、习惯删掉之后都会先进回收站，还原与彻底删除的入口都在同一块面板上。标签、提醒和专注记录**不进**回收站，这不是遗漏：标签随时可以重新建一个，提醒的删除语义是「取消」，跟「这条东西我不要了」不是同一件事，而专注记录是统计的事实源 —— 能删它就等于允许改写成长历史。',
  'site.docs.trash.s1p3': '删一条清单不会连带删掉里面的任务 —— 它们只是变成「没有清单」，还原那条清单之后归属又回来了。删一个习惯也不会抹掉它的打卡记录：还原之后连续天数照旧。',
  'site.docs.trash.s1p2': '回收站也不是一个单独的"箱子"、更没有另一张表：它就是同一批记录里"已删除且还没彻底删除"的那部分，**最近删掉的排最前面**。',
  'site.docs.trash.s1i1': 'Web：左侧栏的「回收站」，常驻可见。',
  'site.docs.trash.s1i2': '移动端：「我的」页面里的回收站入口。',
  'site.docs.trash.s1i3': '两个动作都在同一块面板上：还原、彻底删除 —— 后者要你确认第二次。',
  'site.docs.trash.fig.trash': '回收站：说明文字点名这里放着哪几类，空着的时候也写清条目从哪儿来',
  'site.docs.trash.fig.trash.alt': 'Web 回收站面板，含一句说明文字与空状态提示',
  'site.docs.trash.s2': '还原改的是什么',
  'site.docs.trash.s2p1': '还原 = 把删除标志**清回空**，写成一条普通的更新。它不是"从备份里搬回来"：同一条记录、同一段历史继续往下长。',
  'site.docs.trash.s2p2': '已经被你"彻底删除"过的条目不再出现在回收站里，因此也还原不了 —— 界面对这两件事分开处理，是设计而不是漏的一步。',
  'site.docs.trash.s2p3': '就算绕过界面直接调用，对一条已彻底删除的任务点还原也会被**当场拒绝**。这是有意的一去不回，不是还没做完的那一步。',
  'site.docs.trash.s3': '为什么"彻底删除"不真的删',
  'site.docs.trash.s3p1': '它只做一件事：给这条记录打一个「已清除」的标记。删除标志本身**故意保留**。',
  'site.docs.trash.s3p2': '理由是同步走的是**操作流水**，不是快照对比。另一台设备如果还离线没同步，你把标志清掉，它那一份就会在下一次同步时把这条任务**复活**回来。保留删除标志，才让"我已经决定不要它了"在所有设备上说得一致。',
  'site.docs.trash.s3p3': '所以"彻底删除"的准确含义是：**从我能看见的所有地方移除，并让这个决定对后续同步生效**。它不是加密擦除，也不回收磁盘空间。',
  'site.docs.trash.s3w1': '⚠️ 那份 JSON 备份里，被彻底删除的任务**仍然在**：导出连墓碑一起导，因为它必须能完整回放。',
  'site.docs.trash.s4': '这对你的备份意味着什么',
  'site.docs.trash.s4p1': '导出的 JSON 是完整流水，含已删除与被标记清除的记录，所以你能核对"到底导全了没有"；给人直接读的那份 Markdown 会把这些滤掉。',
  'site.docs.trash.s4p2': '反过来说：把备份当成"我已经删干净了"的证据是错的。它是一份**账本**，而账本里连冲销记录都留着。',
  'site.docs.trash.s4p3': '这个标记是**无害的**：就算另一台设备还跑着旧版本的应用、不认识它，也只是把它当成一条不认识的信息带过 —— 一台设备上做了「彻底删除」，不会把另一台设备弄坏。',

  // 数据出境路径
  'site.docs.privacy.title': '隐私与数据流向',
  'site.docs.privacy.seo.title': '数据离开这台设备的所有路径 —— heyta',
  'site.docs.privacy.sum': '了解同步、AI 与外部服务各自使用哪些数据。',
  'site.docs.privacy.s1': '先说清楚"本地优先"管到哪一段',
  'site.docs.privacy.s1p1': '写入先落本地，这是一条**顺序**，不是"数据永远不出去"的保证。真正决定它去哪的，是你有没有开下面这几条路。',
  'site.docs.privacy.s1p2': '这四条是：同步上行、本机 API / MCP、出站 AI、以及邮件。除此之外，产品里**没有埋点、没有崩溃上报、没有第三方分析脚本** —— 你的一次点击不会因为"顺手加个统计"而发给别人。',
  'site.docs.privacy.s2': '一、同步上行',
  'site.docs.privacy.s2p1': '开了同步，改动以**密文**上传到你配置的那台服务器。密文只是载荷那一部分。',
  'site.docs.privacy.s2p2': '服务器看得见的是外围信息：每一次操作的动作类型、动的是哪类条目、发生的时间、各设备之间的先后关系、密文有多大。也就是说它知道"这台设备在什么时候动了哪类东西、多大"，不知道内容。',
  'site.docs.privacy.s2p3': '我们不把"服务端什么都看不到"拿来宣传：**它看不到内容，看得见形状**。这一条对自建同样成立 —— 那时那个能看到形状的人是你自己。',
  'site.docs.privacy.s3': '二、本机 API / MCP',
  'site.docs.privacy.s3p1': '这是给**同一台机器上的其它程序**（含 MCP 客户端）开的口子：默认关，而且**每个工具单独默认关**，只监听回环地址。',
  'site.docs.privacy.s3p2': '被加密保护的条目在这里**可以列举、不可读内容** —— 工具会明确回一个"读不了"，而不是给你一个看起来正常的空值。',
  'site.docs.privacy.s3p3': '写入只能走应用自己的那条写入口：只读档不能写，执行档的低风险改动由应用按风险自动提交，高风险改动仍绕不过用户确认。',
  'site.docs.privacy.s4': '三、出站 AI',
  'site.docs.privacy.s4p1': 'AI 是**输入法**，不是业务规则：它只能通过应用的风险闸门提出或执行改动；低风险写入可在执行档自动落地，高风险改动必须你确认。',
  'site.docs.privacy.s4p2': '🔴 如果你用的是托管 / 云端 AI，那条路上送出的内容**不是端到端加密的**：同步服务器解不开，但你授权发出去的那一份是明文给了模型提供方。三道闸（总开关、是否允许出境、逐功能授权）都在设置里。',
  'site.docs.privacy.s4p3': '本机端点挂了**不会**悄悄改发云端：那需要重新征得你同意，拿不到同意就一次请求都不发。',
  'site.docs.privacy.s5': '四、邮件',
  'site.docs.privacy.s5p1': '产品只发五种邮件，而且每一种都是**你刚才那个动作**触发的：验证邮箱、登录链接、重置口令、口令已被改的通知、找回通行密钥。没有营销邮件，没有"给你推荐了几篇文章"。',
  'site.docs.privacy.s5p2': '邮件由你配的那台服务器发出（托管时是我们的）。自建时它是**该配**的一项 —— 但不配也不会把人锁在门外：账号照样建得起来，界面会明说那封信没发出去，而不是假装发了。',
  'site.docs.privacy.s6': '开源不等于你可以省事地相信',
  'site.docs.privacy.s6p1': 'heyta 是 MIT 许可，代码公开。上面这四条路**各有自己的开关，默认都关着**：同步要你亲手配了服务器才开，出站 AI 有总开关加逐项授权，本机接口整个默认关闭。这一页的职责是告诉你**每条路由谁开关**，而不是替它们背书。',

  // 丢了东西
  'site.docs.loss.title': '账号与数据恢复',
  'site.docs.loss.seo.title': '丢了设备、通行密钥、加密口令会怎样 —— heyta',
  'site.docs.loss.sum': '设备、登录凭据或加密口令丢失时，找到相应的恢复方式。',
  'site.docs.loss.s1': '一、丢了设备',
  'site.docs.loss.s1p1': '换一台设备重新登录，再用加密口令或已保存的恢复码解锁，已同步的数据才能从服务器**回放**回来。登录本身不提供解密能力；没有上传的数据也不在服务器上。',
  'site.docs.loss.s1p2': '但没开同步的那台设备，数据只在那台机器的本地库里。设备没了就是没了，这条路上没有任何服务端备份兜底。',
  'site.docs.loss.s2': '二、丢了通行密钥（找得回）',
  'site.docs.loss.s2p1': '在应用里点「丢失了通行密钥？」会发一封找回邮件；那个页面由服务端渲染，点进去可以注册一把新的。',
  'site.docs.loss.s2p2': '前提是**邮箱还能收信**。能证明这个邮箱属于你，凭据本身不需要旧密钥还在场。',
  'site.docs.loss.s2p3': '可以在设置里管理自己的通行密钥，改名或删除不再使用的凭据。删除通行密钥与撤销已经签发的登录会话不是同一件事。',
  'site.docs.loss.s2w1': '丢失设备可能仍保有本地明文和旧钥匙。撤销登录访问不能擦除离线副本；保护后续同步还需要由受信任设备轮换数据钥匙并迁移数据。',
  'site.docs.loss.s3': '三、丢了加密口令：先找恢复码',
  'site.docs.loss.s3p1': '加密口令不会交给服务器。如果已经设置数据钥匙并保存恢复码，可以用恢复码在设备上解锁，再设置新口令和新的恢复码。',
  'site.docs.loss.s3p2': '忘记加密口令不等于失去登录；反过来，重置登录密码也不会恢复解密能力。口令和恢复码都丢失时，服务器无法替你解开同步数据。',
  'site.docs.loss.s3p3': '仍能读取数据的旧设备可以**导出完整 JSON**留底，再按导入流程恢复。尚未迁移的旧口令密文需要原口令；新建恢复码不能跳过旧数据的解密步骤。',
  'site.docs.loss.s4': '所以顺序应该是这样',
  'site.docs.loss.s4p1': '把口令与恢复码保存在不会随设备一起丢失的地方，例如自己的密码管理器或离线记录。',
  'site.docs.loss.s4p2': '开同步之前先确认你登得进去、邮箱还收得到；开同步之后偶尔导出一份，并真的验一次它能还原 —— 没验过的备份不叫备份。',
  'site.docs.loss.s4p3': '恢复码由你自己保管，它提供另一条端上解锁路径，不会让服务端获得解密能力。口令和恢复码都无法取得时，仍需依靠可读的本地副本或之前的导出。',

  // ── 更新动态 ──
  'site.changelog.seo.title': '更新动态 —— heyta',
  'site.changelog.seo.description': 'heyta 的更新动态：按日期记录实际发生了什么，含实测证据与被明确判定「不做」的条目。',
  'site.changelog.title': '更新动态',
  'site.changelog.lede': '按日期倒序，只记**真的发生了什么**。包含被判定「不做」的条目 —— 一个只长功能不做减法的路线图不值得相信。',
  'site.changelog.20261005.title': '便签与提醒在两端都可用了',
  'site.changelog.20261005.body': '便签与提醒此前在界面上点不到 —— 东西做了，入口没接上。这一批把 Web 与移动端的入口都补齐了：现在能新建、能查看、能改。',
  'site.changelog.20261002.title': '任务提醒从数据模型做到动作层',
  'site.changelog.20261002.body': '提醒作为**独立实体**落地（而不是任务上的一个数组字段）：调度规则、提前量、顺延与稍后提醒进领域层，增删改查进动作层。此前提醒只是路线图上的一句话。',
  'site.changelog.20260928.title': '站点与应用接成同一个产品',
  'site.changelog.20260928.body': '新增功能介绍、平台状态、价格、帮助、更新动态、登录六个页面，并把导航、页脚与站点地图改成由一份页面注册表派生 —— 从此加页面不可能忘记挂入口。应用侧新增「帮助与关于」入口，站点与应用第一次**双向可达**。',
  'site.changelog.20260928b.title': '任务备注可以自己写了',
  'site.changelog.20260928b.body': '在此之前，备注字段只有 AI 会写（拆解出的清单、估时结果），用户自己写不了。现在 Web 任务行与移动端详情面板都能写，并真的落进操作日志、跨设备同步。',
  'site.changelog.20260928c.title': '「已完成」终于有入口了',
  'site.changelog.20260928c.body': '筛选类型、列表逻辑、标题、空态文案全都写好了，唯独没有任何按钮能把筛选切过去 —— 于是 Web 上已完成的任务永远看不见。顺手修掉一个同形状的问题：在别的视图点侧栏筛选，此前什么都不会发生。',
  'site.changelog.20260927.title': '第一段用户旅程闭环',
  'site.changelog.20260927.body': '落地页有了指向应用的入口、Web 有了注册与登录界面、应用本体第一次被真正部署、数据导出兑现。同一批还关了回收站、移动端成长体系、服务端品牌漂移三个断点。',
  'site.changelog.20260926.title': '四象限从落地页承诺变成真的能用',
  'site.changelog.20260926.body': '在此之前，落地页把四象限当产品支柱讲，而应用里没有它 —— 这是最不该出现的一类不一致：承诺在页面上、功能不在产品里。',
  'site.changelog.note': '更早的更新记录已归档。',

  // ── 登录 ──
  //   🔴 这一页是**跳板**，不是登录表单的说明页（依据 D5）。它过去写着
  //   "只有两种进入方式，没有密码"，还配了三段解释 —— 而产品的主路恰恰是
  //   **邮箱 + 口令**（`site.docs.account.s2` 与应用里的口令接口都是这么做的）。
  //   那是**对外说错话**，不是措辞风格问题，所以 2026-10-03 整段撤掉：
  //   解释搬进文档中心「账号、令牌与登录方式」的 s5，这一页只留能点的两个出口。
  'site.signin.seo.title': '登录 —— heyta',
  'site.signin.seo.description': '登录 heyta：邮箱 + 口令、通行密钥、邮件链接三种方式，都在应用里完成。',
  'site.signin.title': '登录',
  'site.signin.lede': '登录在应用里完成：邮箱 + 口令、通行密钥、邮件链接三种方式都支持。',
  'site.signin.cta': '去应用登录',
  'site.signin.helpLink': '登录方式与令牌的来龙去脉，写在文档中心「账号、令牌与登录方式」',
  // R2 曾把 `site.signin.cta` 当 0 引用删掉（那时这一页的 CTA 只有找回通行密钥
  // 一条）。上面那句撤掉解释之后它重新有了消费者 —— 记着这条键的保质期取决于
  // 页面结构，不取决于字典。

  // ── 应用内的「帮助与关于」（指向站点，见 apps/web/src/lib/site-url.ts）──
  //    站点的三块内容在这里只做**入口**，不复制正文：正文复制过去就是第二份
  //    会漂移的副本，而漂移的那一半恰恰是搜索引擎收不到的那一半。
  'web.about.title': '帮助与关于',
  'web.about.lead': '在浏览器中打开官网。',
  'web.about.help.label': '帮助中心',
  'web.about.help.hint': '使用指南与常见问题',
  'web.about.changelog.label': '更新动态',
  'web.about.changelog.hint': '了解新功能与近期改进',
  'web.about.pricing.label': '价格与订阅',
  'web.about.pricing.hint': '查看方案与服务权益',
  'web.about.updateNote': '这里没有「检查更新」按钮：应用是 PWA，更新由浏览器在后台决定 —— 一个点了不会生效的按钮比没有按钮更坏。',
  'web.sync.help.link': '查看帮助',

  // ── 能力清单的「验证方式」（A1-3）──
  //    🔴 每条都是**命令或路径**，刻意不是链接：仓库当前是私有的，
  //    做成链接就是 404（"看起来能点、点了是 404"比没有更坏）。
  //    也刻意不是形容词 —— 一句"强大"没有任何人能去核对。
  //    这几条的值在中英两表里**逐字相同**：命令与文件路径不该被翻译，
  //    翻译一份命令等于让它跑不起来。它们靠 `site.evidence.label` 带上语义。
  'site.signin.recover.link': '去应用找回通行密钥',

  // ── 分享卡片（og:image）的替代文字 ──
  //    🔴 它不是装饰：图加载不出来时（弱网、平台不抓图）这就是卡片上唯一的说明，
  //    而读屏软件读的也是它。
  'site.og.imageAlt': 'heyta 分享卡片：本地优先的任务管理，数据先落你自己的设备；端到端加密同步、可自建自托管、不按功能收费。',
  // 🔴 R16：卡片**分语言生成**（`og-card.png` / `og-card-en.png`），
  //    所以这三条是**卡片上真的印着的字**，不是译给 alt 看的描述。
  //    它们与 `site.og.imageAlt` 必须描述同一张图 —— 否则英文页的无障碍文本
  //    会描述一张不存在的中文卡（或反过来）。
  'site.og.card.title1': '本地优先的任务管理',
  'site.og.card.title2': '数据先落你自己的设备',
  'site.og.card.lede': '端到端加密同步 · 可自建自托管 · 不按功能收费',

  // ═══════════════════════════════════════════════════════════════════════
  // M3 第四刀（sync）收尾 —— 实体名 / 冲突原因改为两端共用（追加块）
  //
  // 🔴 这一块是**追加**的（词条表是多写者共享文件，只许追加）。
  // 为什么必须有它：web `ConflictDialog.tsx` 与 mobile `conflict-view.ts`
  // 各有一张"实体类型 → 名字"的表，会漂移的是**集合**而不是句子 ——
  // 加一个新实体只改一端，另一端会静默显示 `AI_FEEDBACK` 这种内部标识符。
  // 现在两张表都收进 `@heyta/ui` 的 `sync/model.ts`，key 落在这里一份。
  //
  // ⚠️ `mobile.entity.*` / `mobile.conflict.reason.*` 是**旧命名空间**，
  // 已被本块取代（两端都切过来了）。它们今天无调用点 ——
  // 本表只许追加，删旧键属于别人的改动，留作一笔已登记的死词条债。
  // ═══════════════════════════════════════════════════════════════════════

  // 实体类型 → 名称。键集合与 shared-schema 的 `ENTITY_TYPES` 对齐（有测试钉住）。
  'common.entity.TASK': '任务',
  'common.entity.PROJECT': '清单',
  'common.entity.TAG': '标签',
  'common.entity.NOTE': '便签',
  'common.entity.TASK_REPEAT_CFG': '重复规则',
  'common.entity.REMINDER': '提醒',
  'common.entity.EVENT': '倒数纪念日',
  'common.entity.HABIT': '习惯',
  'common.entity.HABIT_LOG': '打卡记录',
  'common.entity.FOCUS_SESSION': '专注记录',
  'common.entity.AI_FEEDBACK': 'AI 使用记录',
  'common.entity.PREFERENCE_CORRECTION': '偏好纠正',
  'common.entity.ASSISTANT_TURN': '助手消息',
  'common.entity.COMMENT': '评论',
  'common.entity.GLOBAL_CONFIG': '全局设置',
  'common.entity.MIGRATION': '数据迁移',
  'common.entity.RECOVERY': '灾难恢复',
  'common.entity.ALL': '全量数据',

  // 共享清单（ADR-0062，W4）。键集合与 packages/ui/src/sync/share-model.ts 对齐。
  'common.share.member.slotsLeft': '还可邀请 {n} 人',
  'common.share.member.limitReached': '已达共享人数上限',
  'common.share.member.role.owner': '所有者',
  'common.share.member.role.editor': '可编辑',
  'common.share.member.role.commenter': '可评论',
  'common.share.member.role.viewer': '只读',
  'common.share.member.waitingForEnvelope': '等待所有者授权',
  'common.share.comment.empty': '评论内容不能为空',
  'common.share.comment.tooLong': '评论过长（上限 {max} 字）',
  'common.share.comment.fallbackAuthor': '成员 {id}',
  'common.share.consent.title': '共享清单',
  'common.share.consent.body': '把清单设为共享前，请确认以下事项：',
  'common.share.consent.scope.content': '任务标题、备注、日期与清单名对成员可见',
  'common.share.consent.scope.metadata': '服务端会记录成员关系与角色（内容仍加密，服务端不可读）',
  'common.share.consent.scope.notAffected': '你的其它清单不受影响',
  'common.share.consent.accept': '确认共享',
  'common.share.consent.cancel': '取消',
  'common.share.consent.dontAskAgain': '不再提示',
  'common.share.notif.sectionTitle': '共享通知',
  'common.share.notif.activitiesTitle': '活动通知',
  'common.share.notif.activityCompleted': '完成/取消完成了任务',
  'common.share.notif.activityAdded': '添加了任务/笔记',
  'common.share.notif.activityDeleted': '删除/移走了任务/笔记',
  'common.share.notif.taskScopeTitle': '任务提醒',
  'common.share.notif.taskScope.all': '所有任务',
  'common.share.notif.taskScope.allExceptAssignedToOthers': '所有任务（指派给他人的除外）',
  'common.share.notif.taskScope.assignedToMe': '指派给我的',
  'common.share.notif.taskScope.none': '不提醒',
  'common.share.notif.autoAcceptTitle': '自动接受已知合作者的共享邀请',

  // 冲突原因。`reason` 的来源有两处：服务端 `errorCode`（`CONFLICT_*`）与
  // `sync-core` 的 LWW 判定编码（`remote-archive` 等），两者共用这一张表。
  'common.conflict.reason.concurrent': '两台设备在对方不知情的时候都改了它',
  'common.conflict.reason.superseded': '这条改动基于的版本已经不是最新的了',
  'common.conflict.reason.timestampOrTie': '两边的改动时间很接近，分不出先后',
  'common.conflict.reason.localTimestamp': '本机的改动更新一些',
  'common.conflict.reason.remoteDeleteWins': '另一台设备删除了它',
  'common.conflict.reason.localDeleteWins': '本机删除了它',
  'common.conflict.reason.remoteArchive': '另一台设备把它归档了',
  'common.conflict.reason.localArchive': '本机把它归档了',
  // 认不出来时的兜底：不能回落成服务端那句英文诊断，也不能什么都不说。
  'common.conflict.reason.fallback': '两边对同一处做了不同的改动',
  // 日历格子里的「休 / 班」（W4b 公共事实）。同一份词表既当可见字符也当读屏名 ——
  // `calendarDayMarkerView` 里 `spoken` 直接取它，所以英文侧必须是能念出来的词，不能是符号。
  'common.calendar.dayMarker.off': '休',
  'common.calendar.dayMarker.work': '班',
  'common.calendar.festival.newYear': '元旦',
  'common.calendar.festival.springFestival': '春节',
  'common.calendar.festival.qingming': '清明',
  'common.calendar.festival.labourDay': '劳动节',
  'common.calendar.festival.dragonBoat': '端午节',
  'common.calendar.festival.midAutumn': '中秋节',
  'common.calendar.festival.nationalDay': '国庆节',
  // 日历格子里倒数日那一行（W6 第二个数据源）。住 `common.*` 因为共享板两端同一份；
  // 措辞与倒数日面板那条逐字相同 —— 同一个数在两处两种说法是漂移的开始。
  'common.calendar.event.today': '就是今天',
  'common.calendar.event.until': '还有 {days} 天',
  'common.calendar.event.since': '已经 {days} 天',

  // 🔴 这一组住在 `common.*` 而不是 `web.*`：**两端都要用**（档位每批会加一档，
  //    所以这里刻意**不写条数** —— 写过数字的注释一定会漂）。
  //    原来它们是 `web.calendar.view.*`，而移动端补上档位入口时要读同一组词 ——
  //    另抄一份就是「同一个词两种说法」的开始（AGENTS §3.5 那条同形状的第二次）。
  'common.calendar.view.aria': '视图',
  'common.calendar.view.month': '月',
  'common.calendar.view.week': '周',
  'common.calendar.view.day': '日',
  // R13：年档。🔴 它与「时间线」是**两种不同的东西**：时间线不是日历档位，
  //   而是外壳视图的跳转（见 `calendar-view-family.spec.tsx` 钉的那条），
  //   所以它不进 `CalendarViewKind`，这一条也不该和它混成一句。
  'common.calendar.view.year': '年',
  // 🔴 这六条也在 `common.*`：它们是**共享板**在周/日两档要的词，
  //    而共享板两端同一份 ⇒ 移动端补上档位入口后必须给得出同样的词。
  //    留在 `web.*` 里的下场就是移动端再抄一份（AGENTS §3.5 同形状的第二次）。
  'common.calendar.prevWeek': '上一周',
  'common.calendar.nextWeek': '下一周',
  'common.calendar.prevDay': '上一天',
  'common.calendar.nextDay': '下一天',
  // R13 年档的两个箭头（读屏名）。住在 `common.*` 的理由与上面几条同一条：
  // 共享板两端同一份 ⇒ 两端都给得出同样的词（新标签一律可选，§9.1）。
  'common.calendar.prevYear': '上一年',
  'common.calendar.nextYear': '下一年',
  'common.calendar.dayAllDay': '全天',
  'common.calendar.dayNoTimed': '这一天没有定到具体时刻的任务，它们都在上面那条「全天」里。',
  // 🔴 「全天」那条带**自己**的空态，不能说"这一天没有到期的任务" ——
  //   当天完全可以在 16:00 挂一条（R14 之后这是常态），那句话就成了谎话，
  //   而它下面 20 行就是那条任务。两条句子各说各的范围。
  'common.calendar.dayAllDayEmpty': '「全天」里还没有任务；定到具体时刻的在下面那条轴上。',
  // 日历格子里的「休 / 班」（W4b 公共事实）。同一份词表既当可见字符也当读屏名 ——
  // `calendarDayMarkerView` 里 `spoken` 直接取它，所以英文侧必须是能念出来的词，不能是符号。

  // ─────────────────────────────────────────────────────────────
  // 提醒（B1-1 的界面层；web 与 mobile 共用同一批词条）
  // ─────────────────────────────────────────────────────────────
  // 🔴 `reminder.offset.*` **必须与 `REMINDER_OFFSET_PRESETS_MS` 一一对应、同序**：
  //    共享组件按下标取文案（`labels.offsets[i]` ↔ `presets[i]`）。
  //    加一个预设却忘了加词条 → 下标错位，界面会画出**张冠李戴的时间**；
  //    这条对应关系由 `apps/web/src/features/reminders/*` 的宿主测试钉住
  //    （`packages/ui` 只跑纯 `model.ts` 单测，不挂渲染）。
  'reminder.title': '提醒',
  'reminder.empty': '还没有提醒',
  'reminder.add': '添加提醒',
  'reminder.offset.0': '截止时',
  'reminder.offset.5m': '提前 5 分钟',
  'reminder.offset.15m': '提前 15 分钟',
  'reminder.offset.30m': '提前 30 分钟',
  'reminder.offset.1h': '提前 1 小时',
  'reminder.offset.1d': '提前 1 天',
  // 没有截止时间时的**绝对时刻**入口。⚠️ 键名里的 `1h` 是**契约的一部分**：
  // 文案写"1 小时后"，宿主就必须用它建提醒（`now + 1h`）——
  // 文案与默认值分居两处，键名是唯一能把它们绑在一起的地方。
  'reminder.absolute.1h': '1 小时后提醒',
  'reminder.snooze': '稍后提醒',
  'reminder.dismiss': '关闭提醒',
  'reminder.remove': '删除提醒',
  // 状态徽标。与 `ReminderPhase` 一一对应（五个）。
  'reminder.phase.scheduled': '待触发',
  'reminder.phase.snoozed': '已推迟',
  'reminder.phase.due': '已到点',
  'reminder.delivery.uncertain': '无法确认本机是否已提醒。可点“稍后提醒”重新安排。',
  'reminder.phase.fired': '已提醒',
  'reminder.phase.dismissed': '已关闭',
  // 没有截止时间时不能建"提前提醒"——说清原因，不要让按钮静默消失。
  'reminder.hint.noDueDate': '这个任务没有截止时间，只能按绝对时刻提醒',
  'reminder.a11y.list': '「{title}」的提醒',
  'reminder.a11y.remove': '删除 {when} 的提醒',
  'reminder.a11y.snooze': '把 {when} 的提醒推迟 10 分钟',
  'reminder.a11y.dismiss': '关闭 {when} 的提醒',

  // ─────────────────────────────────────────────────────────────
  // 便签（幻觉 #12「笔记模块」的界面层；web 与 mobile 共用）
  // ─────────────────────────────────────────────────────────────
  // ⚠️ 与任务上的「备注」(`web.note.*` / `mobile.detail.field.note`) 是**两件事**：
  //    那是任务正文，这是独立的一条记录（可不挂清单、可钉到「今天」）。
  //    文案上刻意不叫「备注」，否则用户会以为它就是任务里那个。
  'notes.title': '便签',
  'notes.empty': '还没有便签',
  'notes.empty.hint': '把不想变成任务的事记在这里',
  'notes.composer.placeholder': '写点什么…',
  'notes.add': '添加便签',
  'notes.pin': '钉到今天',
  'notes.unpin': '取消钉选',
  'notes.remove': '删除便签',
  'notes.badge.today': '今天',
  'notes.a11y.edit': '编辑便签「{excerpt}」',
  'notes.a11y.remove': '删除便签「{excerpt}」',
  'notes.a11y.pin': '把便签「{excerpt}」钉到今天',
  'notes.a11y.unpin': '取消便签「{excerpt}」的钉选',
  'notes.error.empty': '便签不能是空的',
  // 提交失败时共享 NotesBoard 在 composer 下方的那句（W8a 保草稿 + W8b 宿主接线）。
  // 🔴 这句话的承重承诺是「内容还在输入框里」—— 共享层失败时**保留草稿**；
  // 若哪天改回"失败清草稿"，这句话就在撒谎（mobile 的 labels 契约测试钉了「输入框」三个字）。
  'notes.error.saveFailed': '没存上，内容还在输入框里，请重试',
  // 便签编辑屏（多端第二批）。正文没改动时不写 op，那条闸门在 app-host 的 updateNoteContent。
  'notes.edit.title': '编辑便签',
  'notes.save': '保存',
  'notes.cancel': '取消',
  'notes.edit.notFound': '这条便签已经不在了（可能是在另一台设备上删除的）',

  // ── 运营管理后台（ADR-0038）──────────────────────────────────────────
  // ⚠️ 这一层**只给运营者看**，但仍然走词条表：`apps/web/src` 已在
  // `check:ui-language` 的 MIGRATED 名单里，用户可见字面量必须走 `t()`。
  'web.admin.title': '管理后台',
  'web.admin.lead': '只读为主：用户、订阅、订单、优惠码、邀请。会动数据的是三处：用户详情里的解锁/配额/强制登出、调休补班、退款审批。',
  'web.admin.tab.overview': '概览',
  'web.admin.tab.users': '用户',
  'web.admin.tab.subscriptions': '订阅',
  'web.admin.tab.orders': '订单',
  'web.admin.tab.coupons': '优惠码',
  'web.admin.tab.invites': '邀请',
  'web.admin.loading': '正在加载…',
  'web.admin.retry': '重试',
  'web.admin.error.unconfigured': '没有配置服务器地址，管理后台不可用。',
  'web.admin.error.no-token': '尚未登录，管理后台不可用。',
  'web.admin.error.network': '连不上服务器，请检查网络后重试。',
  'web.admin.error.unauthorized': '登录状态已过期，请重新登录。',
  'web.admin.error.forbidden': '当前账号没有管理后台权限。',
  'web.admin.error.not-found': '目标不存在，可能已被删除。',
  'web.admin.error.invalid': '请求参数不合法。',
  'web.admin.error.conflict': '这一条当前的状态不允许这个动作，具体原因见下方提示。',
  'web.admin.error.server': '服务端出错了，详情见服务端日志。',
  'web.admin.overview.users.total': '用户总数',
  'web.admin.overview.users.verified': '已验证',
  'web.admin.overview.users.admins': '管理员',
  'web.admin.overview.users.locked': '当前锁定',
  'web.admin.overview.subs.total': '订阅总数',
  'web.admin.overview.subs.active': '有效订阅',
  'web.admin.overview.orders.total': '订单总数',
  'web.admin.overview.orders.revenue': '已付金额',
  'web.admin.overview.coupons.total': '优惠码',
  'web.admin.overview.coupons.enabled': '启用中',
  'web.admin.overview.coupons.used': '已核销',
  'web.admin.overview.invites.codes': '邀请码',
  'web.admin.overview.invites.referrals': '推荐关系',
  'web.admin.overview.invites.activated': '已激活',
  'web.admin.overview.byStatus': '按状态',
  'web.admin.overview.paidByCurrency': '已付金额（按币种）',
  'web.admin.users.search': '按邮箱搜索',
  'web.admin.users.total': '共 {total} 人',
  'web.admin.users.noneFound': '没有匹配的用户。',
  'web.admin.badge.admin': '管理员',
  'web.admin.badge.locked': '已锁定',
  'web.admin.badge.unverified': '未验证',
  'web.admin.user.created': '注册于',
  'web.admin.user.storage': '存储用量',
  'web.admin.user.devices': '同步设备',
  'web.admin.user.passkeys': '通行密钥',
  'web.admin.user.operations': '操作数',
  'web.admin.user.failedLogins': '失败登录',
  // 同意留痕：对外文本承诺"记下当时那一套的版本指纹"，后台必须能把这句话说实。
  'web.admin.user.consent': '同意留痕',
  'web.admin.user.consentNone': '没有同意记录',
  'web.admin.user.consentNoVersion': '版本无法证明（老账号，或该实例发布的是运营者自己的文本）',
  'web.admin.user.subscriptions': '订阅',
  'web.admin.user.orders': '订单',
  'web.admin.user.none': '无',
  'web.admin.close': '关闭',
  'web.admin.action.unlock': '解锁账号',
  'web.admin.action.quota': '调整配额',
  'web.admin.action.logout': '强制登出',
  'web.admin.action.done': '已完成。',
  'web.admin.action.failed': '操作失败。',
  'web.admin.quota.label': '新配额（MiB）',
  'web.admin.quota.submit': '保存',
  'web.admin.table.item': '项目',
  'web.admin.table.status': '状态',
  'web.admin.table.amount': '金额',
  'web.admin.table.created': '创建时间',
  'web.admin.table.expires': '到期',
  'web.admin.table.inviter': '邀请人',
  'web.admin.table.invitee': '被邀请人',
  'web.admin.table.reward': '奖励',
  'web.admin.invites.codes': '邀请码',
  'web.admin.invites.referrals': '推荐关系',
  'web.admin.table.owner': '归属人',
  'web.admin.list.none': '暂无数据。',
  'web.admin.prev': '上一页',
  'web.admin.next': '下一页',

  // ── 服务端（邮件 / 凭据页）—— 见 server/src/email.ts 与 pages.ts ──
  'server.email.common.autoNote': '这封邮件由系统自动发送，请勿直接回复。',
  'server.email.common.fallbackIntro': '如果按钮点不动，请把下面的链接复制到浏览器打开：',
  'server.email.common.tagline': '本地优先的任务与习惯管理',
  'server.email.verify.subject': '验证你的 heyta 账号',
  'server.email.verify.title': '欢迎使用 heyta',
  'server.email.verify.body': '请点击下面的按钮验证你的邮箱，完成账号注册。',
  'server.email.verify.button': '验证邮箱',
  'server.email.verify.expiry': '这个链接 24 小时内有效。',
  'server.email.registerCode.subject': '你的 heyta 注册验证码',
  'server.email.registerCode.title': '完成 heyta 注册',
  'server.email.registerCode.body': '请输入下面的验证码，完成邮箱验证并激活你的账号。',
  'server.email.registerCode.codeLabel': '注册验证码',
  'server.email.registerCode.expiry': '验证码 10 分钟内有效，最多可尝试 5 次。',
  'server.email.registerCode.ignore': '如果这不是你本人发起的，忽略这封邮件即可。',
  'server.email.recover.subject': '恢复你的 heyta 通行密钥',
  'server.email.recover.title': '通行密钥恢复',
  'server.email.recover.body': '你申请了恢复通行密钥。点击下面的按钮，为账号注册一个新的通行密钥——它会替换掉原来那一个。',
  'server.email.recover.button': '注册新通行密钥',
  'server.email.recover.ignore': '如果这不是你本人发起的，忽略这封邮件即可，你的账号不会有任何变化。',
  'server.email.recover.expiry': '这个链接 1 小时内有效。',
  'server.email.login.subject': '你的 heyta 登录链接',
  'server.email.login.title': '登录 heyta',
  'server.email.login.body': '点击下面的按钮完成登录。',
  'server.email.login.button': '登录',
  'server.email.login.ignore': '如果这不是你本人发起的，忽略这封邮件即可。',
  'server.email.login.expiry': '这个链接 15 分钟内有效。',
  // 🔴 这里一律说「密码」（登录口令），不说「口令」—— 后者在本项目里专指
  // 端到端加密那把钥匙（见 `web.sync.password.*`）。两件事在同一种语言里只差一个字，
  // 混了会让人以为忘了加密密码也能靠这封邮件找回来 —— 那是不成立的承诺。
  'server.email.reset.subject': '重置你的 heyta 登录密码',
  'server.email.reset.title': '重置登录密码',
  'server.email.reset.body': '你申请了重置登录密码。点击下面的按钮设置一个新密码 —— 设置成功后，其他设备上的登录都会失效。',
  'server.email.reset.button': '设置新密码',
  'server.email.reset.ignore': '如果这不是你本人发起的，忽略这封邮件即可，你的密码不会有任何变化。',
  'server.email.reset.expiry': '这个链接 15 分钟内有效，且只能使用一次。',
  'server.email.passwordChanged.subject': '你的 heyta 登录密码已被更改',
  'server.email.passwordChanged.title': '登录密码已更改',
  'server.email.passwordChanged.body': '你的 heyta 账号刚刚设置了新的登录密码，其他设备上的登录都已失效。',
  'server.email.passwordChanged.button': '打开 heyta',
  'server.email.passwordChanged.notYou': '如果这不是你本人操作的，请立刻用「忘记密码」重新拿回账号，并确认你的邮箱有没有被别人读到。',
  // ── 换绑登录邮箱（ADR-0063）：两半确认 + 一封完成通知 ──
  'server.email.changeConfirm.subject': '确认这个邮箱要成为你的 heyta 登录标识',
  'server.email.changeConfirm.title': '确认新的登录邮箱',
  'server.email.changeConfirm.body': '有人正在把这个邮箱设为 heyta 账号的登录标识。只有你本人点了这里的链接，这一步才算完成。',
  'server.email.changeConfirm.button': '确认这个邮箱',
  'server.email.changeConfirm.expiry': '这个链接 24 小时后失效。如果你没有发起过这件事，不用理会这封信。',
  'server.email.changeAuthorize.subject': '有人请求更改你 heyta 账号的登录邮箱',
  'server.email.changeAuthorize.title': '要换成这个邮箱吗',
  'server.email.changeAuthorize.body': '你的 heyta 账号请求把登录邮箱改成 {email}。登录邮箱是你找回这个账号的唯一凭据，所以需要你在这一封信里也点一次。',
  'server.email.changeAuthorize.button': '同意这次更改',
  'server.email.changeAuthorize.warning': '如果你没有发起过这次更改，请不要点上面的链接，并立刻修改你的登录密码。',
  'server.email.changed.subject': '你的 heyta 登录邮箱已经更改',
  'server.email.changed.title': '登录邮箱已更改',
  'server.email.changed.body': '你的 heyta 账号现在用这个邮箱登录。其他设备上的登录都已失效，要用新的邮箱重新登录一次。',
  'server.email.changed.button': '打开 heyta',
  'server.email.changed.notYou': '如果这不是你本人操作的，说明有人同时读到了你的两个邮箱，请立刻用「忘记密码」拿回账号。',
  // ── 账号新增了一种登录方式（兑现 email-password-auth.md 缺口 13）──
  'server.email.authenticatorAdded.title': '你的 heyta 账号多了一种登录方式',
  'server.email.authenticatorAdded.password.subject': '你的 heyta 账号设置了登录密码',
  'server.email.authenticatorAdded.password.body': '你的 heyta 账号刚刚设置了一个登录密码。在此之前它只能靠通行密钥或邮件链接登录。',
  'server.email.authenticatorAdded.passkey.subject': '你的 heyta 账号新增了一条通行密钥',
  'server.email.authenticatorAdded.passkey.body': '你的 heyta 账号刚刚添加了一条通行密钥。多一条登录方式意味着多一个能进到这个账号的入口。',
  'server.email.authenticatorAdded.button': '打开 heyta',
  'server.email.authenticatorAdded.notYou': '如果这不是你本人添加的，请到设置里的「登录方式」把它删掉，并修改你的登录密码。',
  // 🔴 第四张凭据页：**设置新密码**那一页。这一页只设密码、**不发登录态** ——
  //    能走到这里只说明他持有收件箱，而收件箱是可以被旁观的（共享电脑、被转发的邮件）。
  'server.page.reset.title': '设置新登录密码',
  'server.page.reset.heading': '设置新登录密码',
  'server.page.reset.body': '为你的账号设置一个新密码。设置成功后，其他设备上的登录都会失效，你需要用新密码重新登录。',
  'server.page.reset.newLabel': '新密码',
  'server.page.reset.confirmLabel': '再输一次新密码',
  'server.page.reset.hint': '至少 8 个字符。用一句只有你记得住的话，比加符号更难猜。',
  'server.page.reset.reveal': '显示',
  'server.page.reset.hide': '隐藏',
  'server.page.reset.button': '保存新密码',
  'server.page.reset.busy': '正在保存…',
  'server.page.reset.success': '密码已重置。请用新密码登录。',
  'server.page.reset.mismatch': '两次输入的密码不一致。',
  'server.page.reset.invalidLink': '这个链接无效、已过期，或者已经被用过了。请重新申请一封邮件。',
  'server.page.reset.tooShort': '密码至少要有 8 个字符。',
  'server.page.reset.tooLong': '密码太长了，最多 256 个字符。',
  'server.page.reset.tooCommon': '这个密码太常见了，请换一个与你不相关的。',
  'server.page.reset.breached': '这个密码出现在已泄露的密码库里，请换一个。',
  'server.page.reset.locked': '尝试次数太多了，请稍后再试。',
  'server.page.reset.unavailable': '服务器正忙，请稍后重试。',
  // 成功后这一页的下一步入口（指向应用，不自动跳转）。
  'server.page.reset.goLogin': '去登录',
  'server.page.tokenRequired': '链接不完整：缺少必要的令牌。',
  // 第五张凭据页：换绑登录邮箱。两边各点一次，所以「这一边确认了」与「整个换绑生效了」
  // 是两句不同的话 —— 合成一句就会让人在只点了一边时以为已经改成了。
  'server.page.changeEmail.title': '确认更换登录邮箱',
  'server.page.changeEmail.heading': '确认更换登录邮箱',
  'server.page.changeEmail.body': '这次更换需要新旧两个邮箱各点一次，都点完之后登录邮箱才会改过去。你正在确认其中一边。',
  'server.page.changeEmail.button': '确认这个邮箱地址',
  'server.page.changeEmail.busy': '正在确认…',
  'server.page.changeEmail.awaitingOther': '这一边已经确认，还在等另一个邮箱也点一次。',
  'server.page.changeEmail.applied': '登录邮箱已经换成新地址。请用新地址重新登录。',
  'server.page.changeEmail.invalidLink': '这个链接无效、已过期，或者已经被用过了。请回到应用重新发起一次。',
  'server.page.changeEmail.goLogin': '去登录',
  'server.page.error.unknown': '出了点问题，请稍后重试。',
  'server.page.verify.title': '邮箱已验证',
  'server.page.verify.heading': '邮箱验证成功',
  'server.page.verify.body': '你的账号已经可以正常使用了。',
  'server.page.verify.action': '返回并登录',
  // 🔴 邮箱链接的**确认页**（点之前那一页）—— 与"已验证"那一页**必须分开**：
  //    在用户点之前就写"验证成功"是在说假话（2026-09-30 实测踩过）。
  'server.page.confirm.title': '完成邮箱验证',
  'server.page.confirm.heading': '完成邮箱验证',
  'server.page.confirm.body': '点击下面的按钮完成验证。',
  'server.page.confirm.button': '完成验证',
  // 通行密钥注册那条链接：验证成功但**不发会话**（该用你的通行密钥登录）。
  'server.page.confirm.verifiedOnly': '邮箱已验证。请用你的通行密钥登录。',
  'server.page.verify.failedTitle': '验证失败',
  'server.page.verify.failedBody': '这个验证链接无效或已经过期。请重新注册，或申请一封新的验证邮件。',
  'server.page.recover.title': '恢复通行密钥',
  'server.page.recover.heading': '恢复你的通行密钥',
  'server.page.recover.body': '点击下面的按钮，为你的账号注册一个新的通行密钥。它会替换掉原来那一个。',
  'server.page.recover.button': '注册新通行密钥',
  'server.page.recover.busy': '正在准备…',
  'server.page.recover.waiting': '请在系统弹窗中完成验证…',
  'server.page.recover.verifying': '正在验证…',
  'server.page.recover.success': '通行密钥已重新注册，现在可以回到应用登录了。',
  'server.page.recover.error': '操作失败，请重试。',
  'server.page.login.title': '完成登录',
  'server.page.login.heading': '完成登录',
  'server.page.login.body': '点击下面的按钮，完成这次登录。',
  'server.page.login.button': '登录',
  'server.page.login.busy': '正在登录…',
  'server.page.login.success': '登录成功，正在跳转…',
  'server.page.login.error': '登录失败，请重新申请一个登录链接。',
  'server.page.login.again': '重新申请登录链接',

  // <<<generated:packages/legal/scripts/gen-site-copy.mjs>>>
  // Generated by packages/legal/scripts/gen-site-copy.mjs - do not edit by hand.
  // Source of truth: the titles and summaries in src/documents/*.ts.
  "site.legal.terms.title": "heyta 服务条款",
  "site.legal.terms.lede": "本条款界定托管同步服务的适用范围、MIT 许可证授予的权利、服务器处理的操作元数据、订阅到期后的影响及责任边界；本文件不载明具体价格或服务期限。",
  "site.legal.terms.seo.title": "heyta 服务条款 —— heyta",
  "site.legal.terms.seo.description": "本条款界定托管同步服务的适用范围、MIT 许可证授予的权利、服务器处理的操作元数据、订阅到期后的影响及责任边界；本文件不载明具体价格或服务期限。",
  "site.legal.privacy.title": "隐私政策",
  "site.legal.privacy.lede": "heyta 官方托管服务（账号、同步、订阅）处理哪些个人信息、存在哪里、谁能看到、留多久，以及你怎么行使自己的权利。端到端加密只覆盖同步通道、不覆盖你的设备磁盘，也不覆盖那 11 项明文元数据 —— 这一点本政策写得比多数产品更直白。",
  "site.legal.privacy.seo.title": "隐私政策 —— heyta",
  "site.legal.privacy.seo.description": "heyta 官方托管服务（账号、同步、订阅）处理哪些个人信息、存在哪里、谁能看到、留多久，以及你怎么行使自己的权利。端到端加密只覆盖同步通道、不覆盖你的设备磁盘，也不覆盖那 11 项明文元数据 —— 这一点本政策写得比多数产品更直白。",
  "site.legal.personal-info-list.title": "个人信息收集清单",
  "site.legal.personal-info-list.lede": "heyta 逐项收集哪些与你有关的信息、每项的目的与方式、存在哪里（仅本机明文／服务器密文／服务器明文）、存多久 —— 按数据类别拆成五张表，包含服务端以明文保存的全部 11 项同步元数据。",
  "site.legal.personal-info-list.seo.title": "个人信息收集清单 —— heyta",
  "site.legal.personal-info-list.seo.description": "heyta 逐项收集哪些与你有关的信息、每项的目的与方式、存在哪里（仅本机明文／服务器密文／服务器明文）、存多久 —— 按数据类别拆成五张表，包含服务端以明文保存的全部 11 项同步元数据。",
  "site.legal.permissions.title": "应用权限清单",
  "site.legal.permissions.lede": "heyta 在各端系统里申请了哪些权限、每项对应什么功能、拒绝之后哪些还能用 —— 逐项对照清单文件写成，没有一项是提前占位。",
  "site.legal.permissions.seo.title": "应用权限清单 —— heyta",
  "site.legal.permissions.seo.description": "heyta 在各端系统里申请了哪些权限、每项对应什么功能、拒绝之后哪些还能用 —— 逐项对照清单文件写成，没有一项是提前占位。",
  "site.legal.third-parties.title": "第三方与共享清单",
  "site.legal.third-parties.lede": "数据离开 heyta 的全部去向：由我们服务器发出的四类对外请求与承载它们的云基础设施，由你的设备直接发出的四条，以及逐项列明为「否」的未接入清单 —— 按目的地写，不按服务商名单写。",
  "site.legal.third-parties.seo.title": "第三方与共享清单 —— heyta",
  "site.legal.third-parties.seo.description": "数据离开 heyta 的全部去向：由我们服务器发出的四类对外请求与承载它们的云基础设施，由你的设备直接发出的四条，以及逐项列明为「否」的未接入清单 —— 按目的地写，不按服务商名单写。",
  "site.legal.ai-and-transfer.title": "AI 功能与数据流向",
  "site.legal.ai-and-transfer.lede": "AI 功能默认全部关闭；每个功能出境哪些字段、发出去的是原文而不是摘要、目的地由你自己填且 heyta 服务器不中转；由我们提供的云端 AI 当前不可用。",
  "site.legal.ai-and-transfer.seo.title": "AI 功能与数据流向 —— heyta",
  "site.legal.ai-and-transfer.seo.description": "AI 功能默认全部关闭；每个功能出境哪些字段、发出去的是原文而不是摘要、目的地由你自己填且 heyta 服务器不中转；由我们提供的云端 AI 当前不可用。",
  "site.legal.minors.title": "未成年人保护",
  "site.legal.minors.lede": "面向成年人的效率工具如何处理未成年人：我们不核验年龄、依赖监护人声明；不满十四周岁信息的专门规则、条例义务逐条判定适用性，以及监护人的行使渠道与退款入口。",
  "site.legal.minors.seo.title": "未成年人保护 —— heyta",
  "site.legal.minors.seo.description": "面向成年人的效率工具如何处理未成年人：我们不核验年龄、依赖监护人声明；不满十四周岁信息的专门规则、条例义务逐条判定适用性，以及监护人的行使渠道与退款入口。",
  "site.legal.subscription-refund.title": "订阅、计费与退款规则",
  "site.legal.subscription-refund.lede": "托管同步与云端 AI 两件**各有各的条款**的收费服务（今天能买到云端 AI 的那一档同时含托管同步）各自怎么计价、怎么到期、怎么退、怎么开票 —— 包括一条刻意的不做：我们没有任何自动扣款。",
  "site.legal.subscription-refund.seo.title": "订阅、计费与退款规则 —— heyta",
  "site.legal.subscription-refund.seo.description": "托管同步与云端 AI 两件各有各的条款的收费服务（今天能买到云端 AI 的那一档同时含托管同步）各自怎么计价、怎么到期、怎么退、怎么开票 —— 包括一条刻意的不做：我们没有任何自动扣款。",
  "site.legal.data-rights.title": "个人权利行使与请求响应",
  "site.legal.data-rights.lede": "查阅、复制、更正、删除、注销、撤回同意逐项在 heyta 里怎么做；哪些能自助、哪些只能走邮件、答复时限 15 个工作日，以及\"删除\"在这个架构里到底意味着什么。",
  "site.legal.data-rights.seo.title": "个人权利行使与请求响应 —— heyta",
  "site.legal.data-rights.seo.description": "查阅、复制、更正、删除、注销、撤回同意逐项在 heyta 里怎么做；哪些能自助、哪些只能走邮件、答复时限 15 个工作日，以及\"删除\"在这个架构里到底意味着什么。",
  // <<<end:generated:packages/legal/scripts/gen-site-copy.mjs>>>
  // ── 倒数日/纪念日（批次二 W5；文案唯一事实源在这里，界面里不许出现硬编码串）──
  'web.countdown.title': '倒数纪念日',
  'web.countdown.empty': '还没有倒数日',
  'web.countdown.empty.hint': '添加一个重要的日子，随时知道还有多久。',
  'web.countdown.archived.empty': '没有已归档的倒数日',
  'web.countdown.archived.empty.hint': '归档是把不再盯的日子收起来，不是删除，随时能还原。',
  'web.countdown.composer.placeholder': '给这一天起个名字',
  'web.countdown.add': '添加',
  'web.countdown.pickDate': '选日期',
  'web.countdown.filter.all': '全部',
  'web.countdown.kind.countdown': '倒数日',
  'web.countdown.kind.anniversary': '纪念日',
  'web.countdown.kind.birthday': '生日',
  'web.countdown.kind.festival': '节日',
  'web.countdown.kind.unset': '不选',
  'web.countdown.view.active': '在用',
  'web.countdown.view.archived': '已归档',
  'web.countdown.face.until': '还有 {days} 天',
  'web.countdown.face.today': '就是今天',
  'web.countdown.since': '已经 {days} 天',
  'web.countdown.badge.pinned': '置顶',
  'web.countdown.pin': '置顶',
  'web.countdown.unpin': '取消置顶',
  'web.countdown.edit': '编辑',
  'web.countdown.save': '保存',
  'web.countdown.cancel': '取消',
  'web.countdown.archive': '归档',
  'web.countdown.unarchive': '还原',
  'web.countdown.remove': '删除',
  'web.countdown.field.title': '名称',
  'web.countdown.field.date': '日期',
  'web.countdown.field.kind': '类型',
  'web.countdown.field.template': '样式',
  'web.countdown.yearly': '每年',
  'web.countdown.lunar': '农历',
  'web.countdown.template.none': '默认',
  'web.countdown.template.slot': '模板 {slot}',
  'web.countdown.a11y.menu': '「{title}」的操作',
  'web.countdown.a11y.menuClose': '收起「{title}」的操作',
  'web.countdown.export': '导出成品图',
  'web.countdown.export.failed': '导出失败：这台设备给不了画布。倒数日没有丢，也没有发出任何请求。',
  'web.countdown.error': '没能保存：',
  'web.shell.modules.countdown.label': '倒数纪念日',
  'web.shell.modules.countdown.note': '把要盯的日子排在最前面；过去的那天不算失败。',
  'web.shell.views.countdown': '倒数纪念日',
  // W8（三端接线）：移动端「我的」页的功能域入口行。**只追加在表尾** ——
  // 这两个文件此刻在别的会话里也是脏的，重排/格式化会造出一场没人能解的三方冲突。
  'mobile.countdown.entry': '倒数纪念日',
  'mobile.countdown.entry.hint': '记下要盯的日子，看它还有几天',
  // ── W4b：后台「调休 / 补班」录入面板（公共事实的唯一写入口）─────────
  // ⚠️ 两条措辞约束，都是产品语义不是修辞：
  //   1. 撤销那一年**不等于**"那一年没有任何安排" —— 未覆盖的年份各端读的是
  //      App 随包的国务院公告数据（`packages/domain` 的 holiday-cn 生成物），
  //      所以界面必须说"退回随包数据"，说成"清空"会让运营以为撤销完日历上什么都不标。
  //   2. 这一层**不判日期合法性**（判据在 `holidayYearPutSchema`），
  //      所以文案不许出现"格式正确才能保存"这类承诺 —— 失败了界面只会转述服务端的拒绝。
  'web.admin.tab.holidays': '调休/补班',
  'web.admin.holiday.lead': '这里录入的是覆盖表：某一年一旦被整年替换，各端就用它，不再用随包的公告数据。',
  'web.admin.holiday.list': '已录入的年度',
  'web.admin.holiday.version': '内容版本：{version}',
  'web.admin.holiday.dayCount': '{count} 天安排',
  'web.admin.holiday.list.none': '还没有录入过任何一年，各端读的都是随包数据。',
  'web.admin.holiday.revoke': '撤销这一年',
  'web.admin.holiday.revoke.confirm': '撤销之后，那一年退回随包的公告数据，日历仍按那份数据标注休与班。',
  'web.admin.holiday.revoke.yes': '确认撤销',
  'web.admin.holiday.form.title': '录入一整年',
  'web.admin.holiday.form.lead': '一次提交替换整年：这里写的就是那一年的全部安排，没有列到的日期一律按"正常上班"处理。',
  'web.admin.holiday.form.year': '年份',
  'web.admin.holiday.form.papers': '公告原文链接（一行一条，必须至少一条）',
  'web.admin.holiday.form.offDays': '放假日期（一行一个 YYYY-MM-DD）',
  'web.admin.holiday.form.workDays': '补班日期（一行一个 YYYY-MM-DD）',
  'web.admin.holiday.form.note': '运营备注（只给后台看，不下发给客户端）',
  'web.admin.holiday.save': '保存这一年',
  'web.admin.holiday.notice.saved': '{year} 年已保存，共 {count} 天安排。',
  'web.admin.holiday.notice.deleted': '{year} 年的录入已撤销，那一年退回随包的公告数据。',
  'web.admin.holiday.notice.failed': '没有保存：服务端拒绝了这次录入，原因见上面的提示。',
  'web.admin.tab.refunds': '退款',
  'web.admin.refund.lead': '这里做的是「申请 → 批准 → 通道 → 回调」这条链的前两层。批准会把这笔退款交给支付通道，钱一旦发出就收不回来；而「已经退到账」只由微信的签名回调确认，不由这里点出来。',
  'web.admin.refund.list': '退款申请',
  'web.admin.refund.list.none': '还没有过任何一条退款申请。',
  'web.admin.refund.filter': '按用户编号筛选',
  'web.admin.refund.filter.submit': '筛选',
  'web.admin.refund.order': '订单 #{order}',
  'web.admin.refund.user': '用户 #{user}',
  'web.admin.refund.period': '{days} 天',
  'web.admin.refund.note': '理由（批准与驳回都要求非空）',
  'web.admin.refund.approve': '批准',
  'web.admin.refund.approve.confirm': '批准会立刻向支付通道发起这笔退款，钱发出去就收不回来。确认要这样做吗？',
  'web.admin.refund.approve.yes': '确认发起退款',
  'web.admin.refund.reject': '驳回',
  'web.admin.refund.form.title': '开一张新的申请',
  'web.admin.refund.form.lead': '按订单号开申请：金额只能是那一单结算时冻下的实付，天数只能是那一单买的那一段，两者都不许在这里手填。',
  'web.admin.refund.form.orderId': '订单编号',
  'web.admin.refund.form.note': '备注（进审计，只给后台看）',
  'web.admin.refund.form.exception': '超出时间窗仍要批准（服务端要求这句理由非空）',
  'web.admin.refund.form.submit': '提交申请',
  'web.admin.refund.notice.requested': '已受理：退款 #{id}（订单 #{order}）现在是 {status}，批准之前不会动钱。',
  'web.admin.refund.notice.submitted': '退款 #{id} 的决定已落库，并已交给支付通道（{status}）。是否真的到账以微信回调为准。',
  'web.admin.refund.notice.channelFailed': '退款 #{id} 的批准已经落库，但通道这一跳失败了（原因码 {code}）。钱没动，可以再批一次。',
  'web.admin.refund.notice.notSubmittable': '这一条现在的状态（{status}）不允许提交给通道，界面没有替它改状态。',
  'web.admin.refund.notice.rejected': '退款 #{id} 已驳回：钱和权益都不动，这一条不再是待处理。',
  'web.admin.refund.notice.denied': '服务端拒绝了这次操作，原因码：{code}',
  'web.admin.refund.notice.conflict': '这一条当前的状态不允许这个动作，而服务端没有给出原因码。',
  'web.admin.refund.notice.unknown': '服务端回了一个这台界面不认识的结果码：{code}。界面没有猜它的意思，请查服务端。',
  'web.admin.refund.code.windowPassed': '这一单已经超出当前退款政策的时间窗，而且没有以例外方式批准。',
  'web.admin.refund.code.alreadyRefunded': '这一单已经是「已退款」状态：同一笔钱不能退第二次。',
  'web.admin.refund.code.alreadyOpen': '这一单已经有一条没走完的退款，不许再开第二条。',
  'web.admin.refund.code.notPayable': '这一单不存在，或者还没有走到「付过钱」。',
  'web.admin.refund.code.amountUnverified': '这一单在结算时没有记下可比的实付金额，退款金额算不出来，所以不退。',
  'web.admin.refund.code.notCheckoutOrder': '这一单不是收银台那一路下的，库里没有可对账的那一段，所以不退。',
  'web.admin.refund.code.notDecidable': '这一条已经决定过或者已经走完了，决定只能做一次。',
  'web.admin.refund.code.providerNotRegistered': '批准已经落库，但这台实例没有注册这一单当初的那条通道，钱一分都没发；要等通道接回来或改走人工。',
  'mobile.countdown.export.noModule': '这台设备上的 heyta 没有带导出组件 —— 不是数据问题，重装这个版本就能用。',
  'mobile.countdown.export.rasterize': '系统没能把卡片画成图。倒数日没有丢，也没有发出任何请求。',
  'mobile.countdown.export.write': '图已经画好了，但没能写进这台设备的存储。',
  'mobile.countdown.export.share': '分享面板拒绝了这张图。',

  // ── AI Agent（移动端只有一个入口，能力隐藏在同一助手体验里）──────────────
  //    🔴 口径：全文只说"离开本机"，不写监管定性词（见 check:ui-language 规则 7）。
  //    数字（字数上限、条数）一律由代码插值进来，不写进词条 —— 那是第二套取值。
  'mobile.ai.entry': 'AI 助手',
  'mobile.ai.entry.hint': '让一个助手帮你记录、安排、拆解或回顾任务',
  'mobile.ai.title': 'AI 助手',
  'mobile.ai.back': '返回',
  'mobile.ai.section.mode': '快捷开始',
  'mobile.ai.hostFailed.title': '读不到这台设备上的数据',
  'mobile.ai.hostFailed.hint': '没有发出任何请求。退回上一页再进来一次；还是不行就重启 heyta。',
  'mobile.ai.notConfigured.title': '先从本机任务开始',
  'mobile.ai.notConfigured': '可以直接查询本机任务。配置 AI 后，还能整理想法和安排计划。',
  'mobile.ai.needsSetup': '这条请求需要 AI。先完成配置，再继续发送。',
  'mobile.ai.privacyBlocked.title': '当前只使用本机',
  'mobile.ai.privacyBlocked.hint': '开启联网后，才能连接你配置的 AI 服务。可前往同步与隐私重新选择；本机任务查询仍可使用。',
  'mobile.ai.privacyBlocked.action': '前往同步与隐私',
  'mobile.ai.goSettings': '配置 AI',
  'mobile.ai.proposalNeverAuto': '只读档不会写入；执行档会自动完成低风险写入，高风险改动会先请你确认。',
  'mobile.ai.task.label': '选一条任务',
  'mobile.ai.task.none': '这台设备上还没有任务。',
  'mobile.ai.task.more': '还有 {count} 条没有列出来。',
  'mobile.ai.input.capture': '要记的那句话',
  'mobile.ai.input.capture.placeholder': '例：明天下午三点去看牙，回来顺路买猫粮',
  'mobile.ai.input.limit': '这句话最长处理 {max} 个字。',
  'mobile.ai.input.tool': '想让它怎么帮你',
  'mobile.ai.tools.grantsHint': '一次工具调用最长 {max} 个字，而且只有你勾过的工具才会被调用。',
  'mobile.ai.prioritize.scope': '排序只在你自己的任务之间比较 —— 没有别人，也没有排行榜。',
  'mobile.ai.keyNotice': '密钥只留在这一台设备上：不进备份、不同步、退出登录即清除。',
  'mobile.ai.saveFailed': '这台设备没能保存这次改动（本机存储拒绝了写入）。',
  'mobile.ai.tier.defaultNote': '新配的端点默认按「{tier}」跑，随时可以改。',
  "web.ai.inbound.draft.open": "查看并编辑草稿",
  "web.ai.inbound.draft.cancelEvent": "取消此事件",
  "web.ai.inbound.draft.confirm": "确认创建这些任务",
  "web.ai.inbound.draft.close": "关闭草稿",
  "web.ai.inbound.draft.item": "任务 {index}",
  "web.ai.inbound.draft.disclosure": "草稿在本机解密。修改日期可填写 YYYY-MM-DD（按规则时区 {timezone}），或带时区偏移的完整日期时间；留空表示不排期。确认使用已解析结果，不再调用模型；任务将等待获授权设备创建。",
  "web.ai.inbound.error.draft": "无法读取或取消草稿。请检查登录、密钥和事件是否仍有效。",
  "web.ai.inbound.error.draftConfirm": "无法确认。请修正无效字段；事件、规则或密钥变更后需重新打开草稿。",
  "web.ai.inbound.draft.priority.0": "无优先级",
  "web.ai.inbound.draft.priority.1": "低优先级",
  "web.ai.inbound.draft.priority.2": "中优先级",
  "web.ai.inbound.draft.priority.3": "高优先级",
  "web.ai.inbound.events.title": "最近接收",
  "web.ai.inbound.events.empty": "还没有接收记录。",
  "web.ai.inbound.events.event": "事件 {id}",
  "web.ai.inbound.events.queued": "等待处理设备",
  "web.ai.inbound.events.leased": "正在解析",
  "web.ai.inbound.events.prepared": "等待创建或同步",
  "web.ai.inbound.events.completed": "已同步",
  "web.ai.inbound.events.needs-confirmation": "需要确认",
  "web.ai.inbound.events.expired": "已过期",
  "web.ai.inbound.events.cancelled": "已取消",
  "web.ai.inbound.events.waiting": "等待核实",
  "web.ai.inbound.events.retry": "重新解析",
  "web.ai.inbound.events.confirmRetry": "确认重新解析",
  "web.ai.inbound.events.cancelRetry": "取消",
  "web.ai.inbound.events.retryDisclosure": "上一次模型请求可能已计费。重新解析会再次调用模型并使用额度。确认后将等待可执行设备。",
  "web.ai.inbound.error.retry": "暂时无法重新解析。记录或规则可能已变更，请刷新后重试。",
  'web.ai.inbound.title': '自动收集规则',
  'web.ai.inbound.disclosure': '外部回调会先在服务端接收，再加密排队；获授权设备领取后才会调用 AI。发送方只能看到不透明的事件状态，不会收到任务正文。',
  'web.ai.inbound.status.signIn': '等待登录同步服务。',
  'web.ai.inbound.status.key': '等待准备收件密钥；队列事件不会在密钥不可用时处理。',
  'web.ai.inbound.status.worker': '等待把这台已解锁设备注册为处理设备。',
  'web.ai.inbound.status.routing': '等待开启自动收集的 AI 路由和出境同意；不会静默调用模型。',
  'web.ai.inbound.status.ready': '处理设备已就绪；页面保持前台时会定期领取一条事件。',
  'web.ai.inbound.signIn': '先登录同步服务，才能管理自动收集规则。',
  'web.ai.inbound.formHint': '规则只允许创建新任务。字段白名单、目标清单、时区和条数上限会随规则版本冻结。',
  'web.ai.inbound.keyId': '回调密钥编号',
  'web.ai.inbound.fields': '允许交给解析器的字段',
  'web.ai.inbound.target': '目标清单编号（可选）',
  'web.ai.inbound.timezone': '规则时区（IANA，可选）',
  'web.ai.inbound.timezonePlaceholder': '例如 Asia/Shanghai',
  'web.ai.inbound.maxItems': '每个事件最多创建几条任务',
  'web.ai.inbound.create': '创建规则',
  'web.ai.inbound.edit': '编辑规则',
  'web.ai.inbound.saveEdit': '保存规则',
  'web.ai.inbound.cancelEdit': '取消编辑',
  'web.ai.inbound.loading': '正在读取规则……',
  'web.ai.inbound.enabled': '已启用',
  'web.ai.inbound.disabled': '已暂停',
  'web.ai.inbound.deleted': '已删除（规则编号永久停用）',
  'web.ai.inbound.version': '版本 {version}',
  'web.ai.inbound.pause': '暂停',
  'web.ai.inbound.enable': '启用',
  'web.ai.inbound.remove': '删除规则',
  'web.ai.inbound.empty': '还没有自动收集规则。',
  'web.ai.inbound.error.load': '规则读取失败，请检查登录状态和服务端地址。',
  'web.ai.inbound.error.save': '规则保存失败，服务端没有接受这次改动。',
  'web.ai.inbound.error.remove': '规则删除失败，服务端没有接受这次改动。',
  'web.ai.inbound.error.key': '收件密钥没有完成注册或轮换，请先解锁密钥库后重试。',
  'web.ai.inbound.error.worker': '处理设备注册失败，请先解锁密钥库并检查自动收集权益。',
  'web.ai.inbound.error.process': '自动收集处理失败，事件会保留在服务端等待恢复。',
  'web.ai.inbound.keyMissing': '还没有为这台设备准备收件密钥。',
  'web.ai.inbound.keyReady': '收件密钥已就绪（第 {epoch} 代）。旧队列仍可用旧代密钥解密。',
  'web.ai.inbound.keySetup': '准备收件密钥',
  'web.ai.inbound.keyRotate': '轮换收件密钥',
  'web.ai.inbound.workerReady': '处理设备已注册',
  'web.ai.inbound.workerSetup': '注册为处理设备',
  'web.ai.inbound.processOne': '处理一条待收件',
  'web.ai.inbound.process.submitted': '已提交任务。',
  'web.ai.inbound.process.empty': '当前没有待处理事件。',
  'web.ai.inbound.process.needs-confirmation': '加密草稿等待您确认，尚未创建任务。',
  'web.ai.inbound.process.failed': '处理失败，事件会保留在服务端等待恢复。',
  'web.ai.inbound.field.title': '标题',
  'web.ai.inbound.field.note': '备注',
  'web.ai.inbound.field.priority': '优先级',
  'web.ai.inbound.field.projectId': '目标清单',
  'web.ai.inbound.field.dueDate': '截止时间',
  'web.ai.inbound.field.startDate': '开始时间',
  'web.ai.inbound.field.durationMinutes': '时长',
  'web.ai.inbound.credential.disclosure': '发送方凭据只在生成时显示一次；服务端只保存部署密钥包裹后的密文。轮换会立即撤销同一规则的旧凭据。',
  'web.ai.inbound.credential.active': '当前凭据：{keyId}',
  'web.ai.inbound.credential.rotate': '生成或轮换发送方凭据',
  'web.ai.inbound.credential.revoke': '撤销',
  'web.ai.inbound.credential.secretOnce': '请立即复制发送方密钥（{keyId}）。关闭后不会再次显示。',
  'web.ai.inbound.credential.copy': '复制密钥',
  'web.ai.inbound.credential.copied': '已复制',
  'web.ai.inbound.error.credential': '发送方凭据操作失败，请检查自动收集权益后重试。',
  'web.ai.inbound.credential.testSend': '发送测试事件',
  'web.ai.inbound.error.testSend': '测试事件发送失败，请检查凭据和服务端状态。',
  'web.ai.inbound.credential.testSendResult': '测试事件已受理，当前状态：{state}。发送方只会看到这个不透明状态。',
} as const;

/**
 * 所有合法词条 key 的联合类型。
 *
 * 组件里写 `t('landing.hero.titel')`（拼错）会直接是类型错误 ——
 * 这比任何运行时的"找不到 key 就返回 key 本身"都可靠：
 * 那种兜底会把拼写错误**原样渲染给用户**，而编译期不会。
 */
export type MessageKey = keyof typeof zhCN;
