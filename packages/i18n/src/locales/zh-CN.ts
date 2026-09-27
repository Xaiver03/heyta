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
  'common.brand': 'heyta',
  'common.a11y.toLightTheme': '切换到亮色主题',
  'common.a11y.toDarkTheme': '切换到暗色主题',

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
  'common.sync.error.notConfigured': '还没配置同步服务',
  'common.sync.error.notSignedIn': '还没登录，无法同步',
  'common.sync.error.noPassword': '还没设置端到端加密口令，同步已停止 —— heyta 不会以明文上传',
  'common.sync.error.localOpMissing': '那条本地改动已经不在队列里了，请重新同步',
  'common.sync.error.remoteVersionUnavailable': '取不到对端版本，没法保留远端 —— 请选择保留本地',
  'common.sync.error.undecryptableOps': '有部分历史数据用当前口令解不开（可能是在另一个口令下写入的），已跳过 —— 其余数据已同步',
  'common.sync.error.uploadRejected': '有改动被服务端拒绝了，它们不在云端 —— 已停止重传，请查看同步详情',

  // ── 落地页 · 通用 ─────────────────────────────────────────
  'landing.skipLink': '跳到主要内容',

  // ── 落地页 · 导航 ─────────────────────────────────────────
  'landing.nav.ariaLabel': '页面导航',
  'landing.nav.capabilities': '能力',
  'landing.nav.showcase': '界面',
  'landing.nav.sync': '同步',
  'landing.nav.pricing': '定价',
  'landing.nav.selfhost': '自建',
  'landing.nav.switchLanguage': '切换到{language}',

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
  'landing.capabilities.breakdown.title': '智能拆解',
  'landing.capabilities.breakdown.body': '一句话拆成可执行清单。可用自己的密钥，也可整条关掉。',
  'landing.capabilities.repeat.title': '重复任务',
  'landing.capabilities.repeat.body': '按规则顺延：勾掉这一轮，下一轮自动出现，跨设备结果一致。',
  'landing.capabilities.offline.title': '离线可用',
  'landing.capabilities.offline.body': '断网照常读写。恢复连接后自动补传，冲突交给你判断而不是替你选。',

  // ── 落地页 · 展厅 ─────────────────────────────────────────
  'landing.showcase.title': '这就是它现在的样子',
  'landing.showcase.lede': '下面这三块不是效果图，是用真实界面的结构与取值复现出来的。',
  'landing.showcase.hint': '当前显示：{label}',
  'landing.showcase.quadrant.title': '不用自己想「先做哪个」',
  'landing.showcase.quadrant.body': '重要与紧急是两个独立的轴。紧急程度由截止时间推导，你只回答“这件事重要吗”，剩下的交给矩阵。',
  'landing.showcase.habits.title': '连续天数比打卡次数更值得看',
  'landing.showcase.habits.body': '热力图用同一色阶的深浅表示强度，不靠颜色区分档位，色觉差异下一样读得出来。',
  'landing.showcase.focus.title': '专注记录和任务长在一起',
  'landing.showcase.focus.body': '每段专注都关联到具体任务并落进本地日志，所以“这周时间花在哪”是查得出来的。',

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

  // ── 落地页 · 自建 ─────────────────────────────────────────
  'landing.selfhost.title': '自己的服务器，一条命令的事',
  'landing.selfhost.lede': '不需要注册账号，不需要订阅。服务端只负责转发密文与判并发，换掉它、关掉它、搬到别的机器上，你的数据都不受影响。',
  'landing.selfhost.terminal': '终端',
  'landing.selfhost.step1.title': '拉代码并构建',
  'landing.selfhost.step1.body': '需要 Node 22 以上、pnpm 11.8.0。装完依赖跑一次全量构建。',
  'landing.selfhost.step2.title': '起服务端',
  'landing.selfhost.step2.body': '一条命令拉起同步服务与数据库。服务端只存密文，它没有解密的钥匙。',
  'landing.selfhost.step3.title': '在客户端填地址',
  'landing.selfhost.step3.body': '首次启动时二选一：填自己的服务器地址，或者用托管。选了随时能换。',
  'landing.selfhost.warnStrong': '数据库迁移不要直接调 Prisma。',
  'landing.selfhost.warnBody': '项目里有 9 个并发建索引的迁移，Prisma 会把迁移包进事务，而 PostgreSQL 不允许在事务里建并发索引，跑到第一个这样的迁移就会失败。请用仓库里的',
  // 句末的「。」并进代码词条里：单独立一条纯标点词条会被
  // catalog.spec.ts 的"中文词条必须含汉字"判定为违规（它是对的 ——
  // 一条只有标点的词条没有办法自查语言）。
  'landing.selfhost.warnCode': '迁移脚本 scripts/migrate-deploy.sh。',
  // 仓库当前是私有的，上面那条 `git clone` 对访客无效。这一条是**诚实说明**，
  // 不是营销文案 —— 仓库公开后连同它一起删掉，并把链接恢复（见 ADR-0017 的收尾）。
  'landing.selfhost.sourcePending': '源码尚未公开，所以第一行的仓库地址先留成占位符。公开之后那一行原样就能执行，照后两条走完即可自建。',

  // ── 落地页 · 价格 ─────────────────────────────────────────
  // 🔴 这里的价格必须与 server 的价目表、两份法务文本一致 ——
  // `scripts/check-pricing-consistency.mjs` 会读这些词条并断言三方一致。
  // 改价时先读 docs/reference/pricing-and-entitlements.md（三层唯一事实源）。
  'landing.pricing.ariaLabel': '价格与权益',
  'landing.pricing.title': '软件永久免费，只对托管和 AI 收费',
  'landing.pricing.lede': '应用本体的全部功能免费：自建自托管永久免费、不校验、不限设备。收费的只有两件事 —— 我们替你运维那台服务器，以及我们的云端 AI。',
  'landing.pricing.noFeatureGate': '两个付费档的功能完全一样 —— 你付的是我们替你运维服务器，不是解锁功能。',
  'landing.pricing.free.name': '自建',
  'landing.pricing.free.price': '免费',
  'landing.pricing.free.period': '永久',
  'landing.pricing.free.body': '跑在你自己的服务器上。不需要注册账号，也没人校验你用了多久。AI 也可以用自己的端点。',
  'landing.pricing.free.feature1': '全部功能，一个不少',
  'landing.pricing.free.feature2': '设备数不限',
  'landing.pricing.free.feature3': '数据与密钥都留在你手里',
  'landing.pricing.free.cta': '开始自建',
  'landing.pricing.hosted.name': '官方托管',
  'landing.pricing.hosted.priceCny': '¥5 / 月',
  'landing.pricing.hosted.priceUsd': '$5 / 月',
  'landing.pricing.hosted.regionCny': '大陆',
  'landing.pricing.hosted.regionUsd': '海外',
  'landing.pricing.hosted.body': '我们替你运维那台中继。数据照旧是密文，我们仍然打不开。',
  'landing.pricing.hosted.feature1': '全部功能，与自建完全一致',
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
  'landing.cta.lede': '自建永久免费：源码公开后，一条命令就能起自己的服务端，把数据搬回自己的机器。',
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
  'landing.footer.disclaimer': '个人项目，与滴答清单 / TickTick 及其关联公司无任何关系。',
  'landing.footer.licenseNote': 'heyta 采用 MIT 许可证；第三方代码归属逐项登记在 THIRD_PARTY_LICENSES.md。',

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
  'web.shell.nav.aria': '主导航',
  'web.shell.nav.quadrantSection': '四象限',
  'web.shell.nav.inbox': '收集箱',
  'web.shell.nav.today': '今天',
  'web.shell.nav.completed': '已完成',
  'web.shell.nav.quadrant': '四象限',
  'web.shell.nav.project': '清单',
  'web.shell.nav.tasks': '任务',
  'web.shell.nav.q1': '重要且紧急',
  'web.shell.nav.q2': '重要不紧急',
  'web.shell.nav.q3': '紧急不重要',
  'web.shell.nav.q4': '不重要不紧急',
  'web.shell.views.aria': '视图',
  'web.shell.views.habits': '习惯',
  'web.shell.views.focus': '番茄钟',
  'web.shell.views.timeline': '时间线',
  // 成长页（激励体系 L3）。⚠️ 它必须在词条表里**真实存在**：
  // `App.tsx` 的 `VIEW_TABS` 用 `labelKey` 渲染标签，而 `t()` 查不到词条是**抛错**，
  // 不是回退 —— 少一条就是整个外壳白屏（真浏览器验收抓到过）。
  'web.shell.views.growth': '成长',
  'web.shell.views.settings': '设置',
  'web.shell.dueMode.aria': '截止时间显示方式',
  'web.shell.dueMode.date': '日期',
  'web.shell.dueMode.countdown': '倒计时',
  // 任务行上那几个**纯图标**按钮：名字里必须带上任务标题，
  // 否则屏幕阅读器听到的是一串没有区别的"按钮"。
  'web.shell.tasks.complete': '完成：{title}',
  'web.shell.tasks.uncomplete': '取消完成：{title}',
  'web.shell.tasks.delete': '删除：{title}',
  // ── 回收站 ──
  // 入口是外壳的视图 tab（`App.tsx` 的 `VIEW_TABS`），视图本体在
  // `apps/web/src/features/trash/TrashView.tsx`。删除仍然只是软删除，
  // 这里让用户能看见并且**恢复**；彻底删除是二次确认后的不可逆动作。
  'web.trash.nav': '回收站',
  'web.trash.intro': '这里放着已删除的任务。恢复后它会回到原来的位置。',
  'web.trash.empty.title': '回收站是空的',
  'web.trash.empty.hint': '在任务页删除的任务会先放到这里',
  'web.trash.deletedAt': '删除于 {date}',
  'web.trash.restore': '恢复：{title}',
  'web.trash.purge': '彻底删除：{title}',
  'web.trash.confirm.title': '彻底删除「{title}」？',
  'web.trash.confirm.body': '彻底删除后它不会再出现在回收站里，也无法恢复。',
  'web.trash.confirm.submit': '彻底删除',
  'web.trash.confirm.cancel': '取消',
  // 空状态：任何列表都必须有空状态，而且要说**下一步做什么** ——
  // 留白屏会让用户以为应用坏了。`all` 同时是兜底（新的 filter.kind 不留白）。
  'web.shell.empty.all.title': '收集箱是空的',
  'web.shell.empty.all.hint': '在上面输入框添加第一个任务',
  'web.shell.empty.today.title': '今天没有到期任务',
  'web.shell.empty.today.hint': '给任务设个截止时间，它会出现在这里',
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
  'web.sync.settings.title': '同步设置',
  'web.sync.settings.close': '关闭同步设置',
  'web.sync.serverUrl.label': '服务端地址',
  'web.sync.token.label': '访问令牌',
  'web.sync.password.label': '端到端加密口令',
  // `<strong>不会</strong>` 的三段拆分，与落地页 ledeLead/ledeStrong/ledeTail 同一做法：
  // 强调标记的边界不能靠翻译字符串里的符号去猜。
  'web.sync.password.lead': '口令',
  'web.sync.password.strong': '不会',
  'web.sync.password.tail': '被保存到磁盘，只存在于本次会话的内存中。它一旦丢失，已同步的数据将无法解密 —— 请自行妥善保管。没有口令时同步会被拒绝，服务端只接受端到端加密的载荷。',
  'web.sync.clearCredentials': '清除凭据',
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
  'web.auth.open': '登录 / 注册以获取令牌',
  // 同步设置里令牌字段下面的指路句 —— 它回答的正是"令牌从哪来"。
  'web.auth.tokenHint': '访问令牌由服务端签发。点上面的按钮登录或注册，令牌会自动填进来；已经有令牌的可以直接粘贴填写。',
  'web.auth.empty.title': '还没有凭据',
  'web.auth.empty.body': '同步需要服务端签发的访问令牌。用邮箱登录或注册即可获得，令牌会自动写入下面的同步设置。',
  'web.auth.email.label': '邮箱',
  'web.auth.email.placeholder': '你的邮箱地址',
  'web.auth.sendLoginLink': '发送登录链接',
  'web.auth.register': '注册新账号',
  'web.auth.terms.label': '我同意该服务端提供的服务条款与隐私政策',
  'web.auth.paste.label': '或者粘贴登录链接 / 令牌',
  'web.auth.paste.placeholder': '粘贴邮件里的链接，或那串令牌本身',
  'web.auth.verify': '完成登录',
  'web.auth.sent.login': '如果这个邮箱有账号，登录链接已经发出。打开邮件里的链接，或把链接粘贴回上面的输入框。',
  'web.auth.sent.register': '注册申请已提交。请查收邮件并点开验证链接；验证完成后回到这里登录。',
  'web.auth.signedIn.title': '已登录',
  'web.auth.signedIn.body': '令牌已写入同步设置（{email}）。填好端到端加密口令后即可同步。',
  'web.auth.error.unconfigured': '先在上面填好服务端地址。',
  'web.auth.error.invalidEmail': '这个邮箱地址或令牌看起来不对，检查后重试。',
  'web.auth.error.notAllowed': '这个服务端不允许用该邮箱注册。',
  'web.auth.error.unauthorized': '链接无效或已过期，请重新发送一封。',
  'web.auth.error.rateLimited': '请求太频繁了，请过一会儿再试。',
  'web.auth.error.network': '连不上服务端，检查地址与网络后重试。',
  'web.auth.error.server': '服务端暂时不可用，请稍后重试。',
  'web.auth.error.unknown': '登录没有完成，请重试。',
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

  // ── Web · 习惯 ────────────────────────────────────────────
  'web.habits.addPlaceholder': '新习惯，例如「喝水」',
  'web.habits.addLabel': '新习惯名称',
  'web.habits.add': '添加习惯',
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
  'web.habits.freshStart': '已经 {days} 天没打卡了。最长 {longest} 天、累计 {total} 次都还在，重新开始不会清掉它们。',
  'web.habits.freshStartAction': '今天重新开始',
  'web.habits.a11y.freshStart': '今天为「{name}」重新打卡',
  // 三个指标里的第三个：**只增不减**的那个（累计）。
  // 中文无单复数，两句刻意逐字相同（en 侧才会不同）。
  'web.habits.streak.total': '累计 {count} 次',
  'web.habits.streak.totalOne': '累计 {count} 次',
  // 热力图文案由**我们**传给 react-activity-calendar —— 它的默认文案是英文，
  // 而 `{{count}}` 是**库自己的**占位符，必须原样留着（不是我们的 `{name}` 形状）。
  'web.habits.heatmap': '最近 90 天共 {{count}} 次打卡',

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
  'web.growth.year.heatmap': '最近一年共 {{count}} 次记录',
  'web.growth.milestones.title': '里程碑',
  'web.growth.milestones.note': '只增不减。中断不会让这些数字变小。',
  'web.growth.milestone.allReached': '{name}的里程碑已全部达成',
  // 可访问名里必须同时有**目标**和**差距** —— 只说"距离下一档"读屏用户不知道下一档是多少。
  'web.growth.milestone.nextLabel': '{name}：下一个里程碑是 {threshold} {unit}，还差 {gap} {unit}',
  'web.growth.milestone.next': '下一个里程碑是 {threshold} {unit}，还差 {gap} {unit}',
  'web.growth.milestone.dimensionDone': '这个维度已经全部达成',
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
  'web.categories.note': '按清单与习惯各自统计近 12 周的专注与打卡时间。颜色由你自己赋义，这一页不做任何评价。',
  'web.categories.empty': '还没有可以归类的时间记录。用清单组织任务、或用习惯记下时长，这里就会长出内容。',
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

  // ── Web · 清单与标签 ──────────────────────────────────────
  'web.projects.ariaLabel': '清单与标签',
  'web.projects.heading': '清单',
  'web.projects.newPlaceholder': '新清单',
  'web.projects.newLabel': '新清单名称',
  'web.projects.add': '添加清单',
  'web.projects.delete': '删除清单「{name}」',
  'web.tags.heading': '标签',
  'web.tags.newPlaceholder': '新标签',
  'web.tags.newLabel': '新标签名称',
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
  // 🔴 原文是"拖拽**只改**「重要」**并**把截止时间推入/移出 2 天窗口" ——
  //    它同时说了"不改"和"改"，自相矛盾。紧急是**推导**出来的：
  //    要让任务真的落在你放下的那一格，就必须动截止时间。
  //    写清楚"会动"比写得含蓄重要 —— 那是**用户数据的删除**。
  'web.quadrant.footnote': '紧急程度由截止时间推导。要让任务真的落在你放下的那一格，拖拽在改「重要」之外还会动截止时间：放进紧急侧会推进到 1 小时内，放进非紧急侧会清除它。',

  // ── Web · 时间线 ──────────────────────────────────────────
  // 时间线把「任务的清单 + AI 估时」排成甘特图。没有可排期内容**也不静默跳过**：
  // 留白会让用户以为视图坏了，所以每一块都要说清楚"为什么这里没有条"。
  'web.timeline.aria.empty': '时间线',
  'web.timeline.aria.group': '时间线：共 {count} 条任务',
  // 中文无单复数，刻意与复数版逐字相同（词条表没有 ICU，调用方按 count===1 分支）。
  'web.timeline.aria.groupOne': '时间线：共 {count} 条任务',
  'web.timeline.empty': '还没有任务可以排 —— 先在收集箱建一个任务，再给它写几条清单（或让 AI 拆解一次），时间线就有东西可排了。',
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
  // 是判别式（`not-applicable` / `third-party-decides` / `undecided`），
  // 界面按它取词条，**不再渲染 `packages/ai` 的中文兼容句 `retentionText`**。
  // 那两句兼容句仍然留在 `packages/ai`（零依赖的包，CLI 与 check-ai-coverage 在用），
  // 只是 web 壳里没有生产消费者了。
  'web.ai.disclosure.retentionNotApplicable': '未离开设备，不涉及服务端保留。',
  'web.ai.disclosure.retentionThirdParty': '保留策略由你自己的端点决定，heyta 无从知晓。',
  // 端点没有给出保留策略时的**面板兜底句**。它归 web 壳所有；
  // `packages/ai` 那条真正的披露链（来自跨包函数）仍由另一批单独处理（计划 §9）。
  'web.ai.disclosure.retentionUndecided': '未定案 —— 在 heyta 说明清楚之前，这个端点不允许启用。',
  // 端点健康状态。⚠️ 英文刻意避开 `{n} times` / `{n} seconds` 这种句式：
  // 词条表没有复数规则，而英文里 `1 times` 是错的。改写句式（`Recent failures: 1`）
  // 比加一串 `…One` 兄弟词条更不容易漏 —— 中文不受影响，逐字沿用兼容句。
  'web.ai.health.ok': '正常',
  'web.ai.health.failing': '最近失败过 {failures} 次',
  'web.ai.health.circuitOpen': '暂时停止使用（连续失败 {failures} 次，{retryInSeconds} 秒后重试）',
  'web.ai.disclosure.fieldsLead': '将发送这些字段：',
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

  // ── Web · AI · 功能名 / 能力名 ────────────────────────────
  'web.ai.feature.capture': '一句话捕获',
  'web.ai.feature.breakdown': '拆解任务',
  'web.ai.feature.prioritize': '优先级建议',
  'web.ai.feature.duration': '预估耗时',
  // 能力勾选框旁的"哪些功能需要它"——原文是另一套更短的用法名。
  'web.ai.needs.capture': '快速捕获',
  'web.ai.needs.breakdown': '拆解任务',
  'web.ai.needs.prioritize': '排序建议',
  'web.ai.needs.duration': '耗时估计',
  'web.ai.capability.structuredOutput': '结构化输出',
  'web.ai.capability.longContext': '长上下文',
  'web.ai.capability.vision': '图片理解',
  'web.ai.capability.toolCalling': '工具调用',

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
  // 首词 `heyta` 走 `common.brand`，所以这里从"即将提供"开始。
  'web.ai.settings.managed.offer': '即将提供',
  'web.ai.settings.managed.rest': '云端 AI 服务（仍在开发中，暂时无法启用）。在那之前，需要你自己接一个端点（本机或远端）。托管模式的性质不一样：用它的请求，你的任务内容会',
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
  'web.ai.settings.consentLead': '「{feature}」有远端端点，需要你授权数据出境。',
  'web.ai.settings.grant': '授权',
  'web.ai.settings.gapLead': '⚠️ 「{feature}」需要',
  'web.ai.settings.gapMid': '，但',
  'web.ai.settings.gapTail': '没有声明它 —— 这个功能会一直不工作。',
  'web.ai.settings.gapFix': '给「{name}」补上',
  'web.ai.settings.granted': '已授权数据出境',
  'web.ai.settings.revoke': '撤销',
  'web.ai.settings.localApi.title': '本机 API',
  'web.ai.settings.localApi.hintLead': '让本机的其他程序（编辑器、脚本、AI 助手）读写你的任务。',
  'web.ai.settings.localApi.hintStrong': '默认关闭，且每个工具要单独打开。',
  // ⚠️ 原文里的 `**粗体**` 标记**逐字保留**（它们会原样渲染出星号）。
  // 那是一处既有的显示缺陷，本轮只做迁移，不顺手改渲染 —— 见迁移报告。
  'web.ai.settings.localApi.source.part1': '下面这些只存在**浏览器**里。真正让 MCP 服务生效的是配置文件',
  'web.ai.settings.localApi.source.file': '文件 ~/.heyta/local-api.json',
  'web.ai.settings.localApi.source.part2': '，要用命令行生成：',
  'web.ai.settings.localApi.source.command': '命令 heyta-ai local-api init',
  'web.ai.settings.localApi.source.part3': '（它会生成 token 并打印客户端配置片段）。两边目前**不会自动同步**。',
  'web.ai.settings.localApi.enabled.label': '启用本机 API',
  'web.ai.settings.localApi.enabled.note': '只监听 {address}，不会暴露到局域网。',
  'web.ai.settings.localApi.token.label': '访问 token',
  'web.ai.settings.localApi.token.aria': '本机 API 访问 token',
  'web.ai.settings.localApi.token.hint': 'token 防的是这台机器上的其他程序，不是网络攻击 —— 没有它，任何程序都能读走你的全部任务。',
  'web.ai.settings.localApi.kind.write': '会改数据',
  'web.ai.settings.localApi.kind.read': '只读',
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
  'web.ai.failure.cause.egressNotAuthorized': '该功能需要你先授权数据出境。',
  'web.ai.failure.cause.noRoute': '没有可用端点能处理这个功能。检查端点是否启用、地址是否合法。',
  'web.ai.failure.cause.fallbackNeedsConsent': '首选端点失败了，而备用端点会把数据发到别处，所以没有自动切换。需要你重新授权。',
  'web.ai.failure.cause.network': '连不上端点。检查网络，以及端点地址是否可达。',
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
  // 那条规则是**对的**（一条只有标点的词条没办法自查语言，
  // 同一个判断见上面 `landing.selfhost.warnCode` 的注释）。
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
  'mobile.tasks.mode.countdown': '倒计时',
  // 同一页上的两种视图。**不是两个 tab** —— 见 ADR-0015 §4。
  'mobile.tasks.view.list': '列表',
  'mobile.tasks.view.quadrant': '四象限',
  // 四象限分组。与 `web.quadrant.q1..q4` 同义，但按壳分命名空间 ——
  // 与 `landing.quadrant.q1..q4` 的存在是同一个理由：文案各壳可独立演进。
  'mobile.quadrant.q1': '重要且紧急',
  'mobile.quadrant.q2': '重要不紧急',
  'mobile.quadrant.q3': '紧急不重要',
  'mobile.quadrant.q4': '不重要不紧急',
  'mobile.tasks.quadrant.empty': '这里还没有任务',
  'mobile.tasks.group.overdue': '已过期',
  'mobile.tasks.group.inbox': '收集箱',
  'mobile.tasks.group.completed': '已完成',
  'mobile.tasks.a11y.complete': '完成：{title}',
  'mobile.tasks.a11y.uncomplete': '取消完成：{title}',
  'mobile.tasks.a11y.open': '打开任务：{title}',
  'mobile.tasks.a11y.openRepeat': '打开任务：{title}，重复：{repeat}',
  'mobile.tasks.a11y.delete': '删除任务：{title}',

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
  'mobile.detail.field.dueDate': '截止日期',
  'mobile.detail.field.repeat': '重复',
  'mobile.detail.repeat.none': '不重复',
  'mobile.detail.repeat.current': '当前：{rule}',
  'mobile.detail.repeat.daily': '每天',
  'mobile.detail.repeat.weekly': '每周',
  'mobile.detail.repeat.weekdays': '工作日',
  'mobile.detail.repeat.monthly': '每月',
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
  'mobile.detail.project.inbox': '收集箱',
  'mobile.detail.project.create': '新建清单',
  'mobile.detail.project.newPlaceholder': '清单名称',
  'mobile.lists.empty': '还没有清单',
  'mobile.lists.empty.hint': '还没归类的任务都在「收集箱」里，不会丢。',
  'mobile.lists.nameLabel': '清单名称',
  'mobile.lists.newPlaceholder': '给新清单起个名字',
  'mobile.lists.add': '新建清单',
  // 删除清单**不删里面的任务**（见 `project-actions.ts` 文件头第 2 条）。
  // 这句话必须写在界面上：不说的话，用户会以为删除等于连任务一起删掉，
  // 于是**不敢删**——一个不敢用的功能等于没有。
  'mobile.lists.removeHint': '删除清单不会删掉里面的任务，它们会回到「收集箱」。',
  'mobile.lists.remove': '删除清单「{name}」',

  // ── 标签 ───────────────────────────────────────────────────
  // 清单和标签在数据上是两个实体，在产品上是同一件事的两个面（组织任务）：
  // 清单回答"它属于哪个容器"（一个），标签回答"它还跟什么有关"（多个）。
  'mobile.profile.section.tags': '标签',
  'mobile.tags.empty': '还没有标签',
  'mobile.tags.empty.hint': '标签可以跨清单给任务归类，比如「紧急」「等回复」。',
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

  // ── 移动端 · 「我的」屏 ───────────────────────────────────
  'mobile.profile.title': '我的',
  'mobile.profile.section.sync': '同步',
  'mobile.profile.section.status': '状态',
  'mobile.profile.section.language': '语言',
  'mobile.profile.section.lists': '清单',
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
  'mobile.profile.sync.notConfigured': '填好服务器地址与访问令牌后才能同步。',
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
  'mobile.entity.NOTE': '笔记',
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
  'mobile.growth.today.tasks': '任务 {done}/{planned}',
  'mobile.growth.today.bonus': '计划外 {count} 件',
  'mobile.growth.today.focus': '专注 {minutes} 分钟',

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
  'mobile.growth.streak.empty': '还没有习惯。在网页端建好习惯后会自动同步到这里。',
  'mobile.growth.streak.current': '当前连续（天）',
  'mobile.growth.streak.longest': '最长 {days} 天',
  'mobile.growth.streak.total': '累计 {count} 次',
  'mobile.growth.streak.repair': '昨天还能补回来——补完是 {days} 天',
  'mobile.growth.streak.freshStart': '距上次 {days} 天。最长 {longest} 天、累计 {total} 次都还在。',
  'mobile.growth.streak.a11y': '{name}：当前连续 {current} 天，最长 {longest} 天，累计 {total} 次',

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
  'mobile.trash.entry.hint': '已删除的任务可以在这里恢复',
  'mobile.trash.intro': '这里放着已删除的任务。恢复后它会回到原来的位置。',
  'mobile.trash.empty.title': '回收站是空的',
  'mobile.trash.empty.hint': '在任务页删除的任务会先放到这里',
  'mobile.trash.deletedAt': '删除于 {date}',
  'mobile.trash.restore': '恢复',
  'mobile.trash.restoreA11y': '恢复：{title}',
  'mobile.trash.purge': '彻底删除',
  'mobile.trash.purgeA11y': '彻底删除：{title}',
  'mobile.trash.confirm.title': '彻底删除「{title}」？',
  'mobile.trash.confirm.body': '它会从回收站里消失，也无法再恢复。',
  'mobile.trash.confirm.notErasure': '这不是物理擦除：操作日志里仍然留着这条记录，只是界面不再提供恢复。',
  'mobile.trash.confirm.submit': '彻底删除',
  'mobile.trash.confirm.cancel': '取消',

  // ── 导出（移动端第二层，入口在「我的」）──────────────────
  // 🔴 导出文档本身的措辞、以及「不能导回来」这条诚实条款，**复用 Web 端
  // `web.export.*` 词条** —— 它们是「导出这件事」的措辞，不是 Web 壳的措辞。
  // 两端读同一批 key，就不可能出现「网页说不能导回来、手机没说」这种分歧。
  // 这里只新增移动端**独有**的：入口、按钮动词（分享而非下载）、分享提示。
  'mobile.export.entry': '导出数据',
  'mobile.export.entry.hint': '把数据带走（目前还不能导回来）',
  'mobile.export.json.button': '分享 JSON',
  'mobile.export.markdown.button': '分享任务清单',
  'mobile.export.shareHint': '导出内容会交给系统分享面板，由你选择保存或发送到哪里。',
  'mobile.export.shareTitle': 'heyta 导出',
  'mobile.export.shareFailed': '系统分享面板没有打开，导出内容没有送出。',
} as const;

/**
 * 所有合法词条 key 的联合类型。
 *
 * 组件里写 `t('landing.hero.titel')`（拼错）会直接是类型错误 ——
 * 这比任何运行时的"找不到 key 就返回 key 本身"都可靠：
 * 那种兜底会把拼写错误**原样渲染给用户**，而编译期不会。
 */
export type MessageKey = keyof typeof zhCN;