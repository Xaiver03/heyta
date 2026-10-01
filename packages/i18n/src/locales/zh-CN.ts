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

  // ── 落地页 · 自建 ─────────────────────────────────────────
  'landing.selfhost.title': '自己的服务器，一条命令的事',
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
  'landing.selfhost.guide.title': '完整步骤在仓库里',
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
  'landing.footer.disclaimer': '个人项目，与滴答清单 / TickTick 及其关联公司无任何关系。',
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
  'web.shell.search.placeholder': '搜索任务',
  'web.shell.search.aria': '搜索任务（标题与备注）',
  'web.shell.search.clear': '清除搜索',
  'web.shell.nav.tasks': '任务',
  'web.shell.nav.q1': '重要且紧急',
  'web.shell.nav.q2': '重要不紧急',
  'web.shell.nav.q3': '紧急不重要',
  'web.shell.nav.q4': '不重要不紧急',
  'web.shell.sidebar.resize': '调整侧栏宽度',
  'web.shell.views.aria': '视图',
  'web.shell.views.groupMain': '主要',
  'web.shell.modules.title': '功能模块',
  'web.shell.account.aria': '账号',
  'web.shell.account.ariaAs': '账号：{email}',
  'web.shell.account.settings': '设置',
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
  // 设置浮层的退出口（Esc / ✕ 共用一个可访问名）。见 App.tsx 的 sheet 段：
  // 浮层的**标准出口**是"看得见的关闭 + Esc"，缺一个都会让人以为要按浏览器后退。
  'web.shell.settings.close': '关闭设置',
  'web.shell.dueMode.aria': '截止时间显示方式',
  'web.shell.dueMode.date': '日期',

  'web.settings.display.title': '显示',
  'web.settings.display.dueNote': '任务行上的截止时间显示为日期，还是距离截止时间的倒计时。',
  'web.shell.dueMode.countdown': '倒计时',
  // 任务行上那几个**纯图标**按钮：名字里必须带上任务标题，
  // 否则屏幕阅读器听到的是一串没有区别的"按钮"。
  'web.shell.tasks.complete': '完成：{title}',
  'web.shell.tasks.uncomplete': '取消完成：{title}',
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
  'web.sync.settings.title': '同步设置',
  'web.sync.settings.close': '关闭同步设置',
  'web.sync.serverUrl.label': '服务端地址',
  'web.sync.serverUrl.placeholder': 'https://你的同步服务端地址',
  'web.sync.token.label': '访问令牌',
  'web.sync.password.label': '端到端加密口令',
  // `<strong>不会</strong>` 的三段拆分，与落地页 ledeLead/ledeStrong/ledeTail 同一做法：
  // 强调标记的边界不能靠翻译字符串里的符号去猜。
  'web.sync.password.lead': '口令',
  'web.sync.password.strong': '不会',
  'web.sync.password.tail': '被保存到磁盘，只存在于本次会话的内存中。它一旦丢失，已同步的数据将无法解密 —— 请自行妥善保管。没有口令时同步会被拒绝，服务端只接受端到端加密的载荷。',
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
  'web.auth.invite.label': '邀请码（选填）',
  'web.auth.invite.placeholder': '好友的邀请码',
  'web.auth.invite.invalid': '邀请码是 {length} 位字母或数字，请检查一下。',
  'web.auth.email.label': '邮箱',
  'web.auth.email.placeholder': '你的邮箱地址',
  'web.auth.sendLoginLink': '发送登录链接',
  'web.auth.register': '注册新账号',
  'web.auth.passkey.register': '用通行密钥注册',
  'web.auth.passkey.login': '用通行密钥登录',
  'web.auth.passkey.unavailable': '这个浏览器或设备不支持通行密钥，用上面的邮箱方式即可。',
  'web.auth.passkey.waiting': '请在系统弹窗里完成通行密钥操作…',
  'web.auth.recovery.request': '丢失了通行密钥？发一封找回链接',
  'web.auth.terms.label': '我同意该服务端提供的服务条款与隐私政策',
  'web.auth.paste.label': '或者粘贴登录链接 / 令牌',
  'web.auth.paste.placeholder': '粘贴邮件里的链接，或那串令牌本身',
  'web.auth.verify': '完成登录',
  'web.auth.sent.login': '如果这个邮箱有账号，登录链接已经发出。打开邮件里的链接，或把链接粘贴回上面的输入框。',
  'web.auth.sent.register': '注册申请已提交。请查收邮件并点开验证链接；验证完成后回到这里登录。',
  'web.auth.sent.recovery': '如果这个邮箱有账号，找回通行密钥的链接已经发出。点开邮件里的链接即可为这个账号注册一个新通行密钥（会替换掉旧的）。',
  'web.auth.signedIn.title': '已登录',
  'web.auth.signedIn.body': '令牌已写入同步设置（{email}）。填好端到端加密口令后即可同步。',
  'common.auth.error.unconfigured': '先在上面填好服务端地址。',
  'common.auth.error.invalidInput': '这个邮箱地址或令牌看起来不对，检查后重试。',
  'common.auth.error.notAllowed': '这个服务端不允许用该邮箱注册。',
  'common.auth.error.unauthorized': '链接无效或已过期，请重新发送一封。',
  'common.auth.error.rateLimited': '请求太频繁了，请过一会儿再试。',
  'common.auth.error.network': '连不上服务端，检查地址与网络后重试。',
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
  'common.auth.error.noPasswordSet': '这个账号还没有设置登录密码（也许一直用通行密钥登录）。走「忘记密码」可以为它设一个。',
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
  'common.auth.form.switchToRegister': '还没有这个邮箱的账号？创建一个',
  'common.auth.form.switchToSignIn': '已经有账号了？直接登录',
  'common.auth.form.otherWays': '或者用别的方式',
  'common.auth.sent.reset': '如果我们认得这个邮箱，重置密码的链接已经发过去了。',
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
  'web.passkeys.error.lastPasskey': '这是账号上最后一条通行密钥，账号也没有能用的登录口令，所以不能删除。先添加一条新的，或设一个登录口令（邮箱得先验证过）。',
  'web.passkeys.error.unauthorized': '登录状态已失效，请重新登录。',
  'web.passkeys.error.network': '连不上服务端，请稍后重试。',

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
  'web.widgetJourney.sectionTitle': '桌面小组件',
  'web.widgetJourney.intro': 'heyta 可以变成桌面上的应用，今日任务、四象限、习惯、专注四张卡片会出现在系统的小组件面板里。',
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

  // ── Web · 习惯的「列表 + 窗格」─────────────────────────────
  'web.habits.list.aria': '习惯清单',
  'web.habits.pane.aria': '「{name}」的打卡记录',
  // 行首的 7 个点：日期本身已经在 `aria-label` 里，这里只说"打没打"。
  'web.habits.week.aria': '最近 7 天',
  'web.habits.week.done': '{date} 已打卡',
  'web.habits.week.missed': '{date} 没打卡',
  // 整行的读法：**三个数字一次说完**，屏幕阅读器不必逐 chip 猜。
  'web.habits.row.aria': '「{name}」连续 {current} 天，最长 {longest} 天，累计 {total} 次',
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
  'web.ai.noTarget.toolCalling': '还没有给「AI 工具调用」配置端点。去「设置」里添加端点、勾上「工具调用」能力并指定路由。',

  // ── Web · AI · 功能名 / 能力名 ────────────────────────────
  'web.ai.feature.capture': '一句话捕获',
  'web.ai.feature.breakdown': '拆解任务',
  'web.ai.feature.prioritize': '优先级建议',
  'web.ai.feature.duration': '预估耗时',
  'web.ai.feature.toolCalling': 'AI 工具调用',
  // 能力勾选框旁的"哪些功能需要它"——原文是另一套更短的用法名。
  'web.ai.needs.capture': '快速捕获',
  'web.ai.needs.breakdown': '拆解任务',
  'web.ai.needs.prioritize': '排序建议',
  'web.ai.needs.duration': '耗时估计',
  'web.ai.needs.toolCalling': '工具调用',
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
  // 🔴 「添加到哪儿」必须出现在占位符里。当下面板停在某个清单时，
  // 「添加任务」这句话只说了一半 —— 用户按回车后任务落进收集箱、
  // 从眼前这条列表里消失，而界面上没有任何一处说过这件事。
  'web.capture.placeholderTo': '添加任务到「{list}」，回车确认（可写「明天」「下周三」「!1」）',
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
  'web.ticktick.intro': '选一份滴答清单导出的 CSV 备份。**先看预览，确认后才写入** —— 预览里的数字与真的写进去的是同一次解析。',
  'web.ticktick.fileLabel': '滴答清单 CSV 备份',
  'web.ticktick.picked': '已选择：{name}',
  'web.ticktick.ticktickOnly': '目前只认滴答清单导出的 CSV。Todoist 的解析还没做，界面上不写"支持"两个字。',
  'web.ticktick.coexist': '导入走普通操作，可以与现有数据共存；同一份文件导第二次不会重复（按稳定 id 判定）。',
  'web.ticktick.busy': '处理中…',
  'web.ticktick.readFailed': '读取文件失败，请重试。',
  'web.ticktick.importFailed': '导入过程中出错了 —— 可能有部分内容已经写入；再导一次同一份文件不会重复。',
  'web.ticktick.previewTitle': '预览',
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
  'common.date.monthTitle': '{year}年{month}月',
  'common.date.dayTitle': '{month}月{day}日 星期{weekday}',
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
  'web.reminder.notify.limit': '⚠️ 通知只在 heyta 开着的时候发得出来。应用关掉后不会响 —— 后台唤醒需要另一套协议，目前还没有。',
  'web.reminder.notify.body': '该做「{title}」了',
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
  'web.calendar.weekShort': '{n}周',
  'web.calendar.backToToday': '回到今天',
  'web.calendar.monthTitle': '{year}年{month}月',
  'web.calendar.dayTitle': '{month}月{day}日 星期{weekday}',
  'web.calendar.dayEmpty': '这一天没有到期的任务。',
  'web.calendar.footnote': '未设截止时间的任务不在日历上，它们在「任务」页的收集箱里。',
  'web.calendar.a11y.dayWithTasks': '{date}，{count} 个任务',
  'web.calendar.a11y.dayWithTasksOne': '{date}，{count} 个任务',
  'web.calendar.a11y.dayNoTasks': '{date}，没有任务',
  'web.calendar.side.aria': '日历侧栏',
  'web.calendar.mini.aria': '迷你月历',
  'web.calendar.scope.all': '所有',
  'web.calendar.scope.allAria': '显示全部任务',
  'web.calendar.scope.groupProject': '全选或清空清单',
  'web.calendar.scope.groupTag': '全选或清空标签',
  'web.calendar.scope.project': '在日历上显示清单「{name}」的任务',
  'web.calendar.scope.tag': '在日历上显示标签「{name}」的任务',

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
  'common.organizer.lists.empty.hint': '还没归类的任务都在「收集箱」里，不会丢。',
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
  'common.organizer.tags.empty': '还没有标签',
  'common.organizer.tags.empty.hint': '标签可以跨清单给任务归类，比如「紧急」「等回复」。',
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
  'mobile.welcome.tagline': '本地优先的任务管理：离线照常可用，数据端到端加密，服务器可以是你自己的。',
  'mobile.welcome.signIn': '注册 / 登录',
  'mobile.welcome.offline': '先离线使用',
  'mobile.welcome.offlineHint': '不登录也能建任务、打卡、专注；以后随时可以在「我的」页登录。',

  // ── 移动端 · 注册 / 登录面板（规范 §3.2）────────────────────
  'mobile.auth.title': '注册 / 登录',
  'mobile.auth.intro': '用邮箱或通行密钥登录。登录成功后，服务器地址、访问令牌与端到端加密口令会自动接上同步。',
  'mobile.auth.email.label': '邮箱',
  'mobile.auth.email.placeholder': '你的邮箱地址',
  'mobile.auth.terms.label': '我同意该服务端提供的服务条款与隐私政策',
  // 🔴 服务端对 `termsAccepted` 用的是 `z.literal(true)`（规范 §2-A4）——
  //    "同意"这件事只能由用户做出。这句话是给用户的交代，不是客套。
  'mobile.auth.terms.hint': '这一项必须由你自己勾选——我们不会替你同意。',
  // 两条并列的路，不是同一条的快捷方式：邮件链接要多一步"去邮箱"。
  'mobile.auth.magicLink.login': '用邮件链接登录',
  'mobile.auth.magicLink.register': '注册新账号',
  'mobile.auth.passkey.register': '用通行密钥注册',
  'mobile.auth.passkey.login': '用通行密钥登录',
  'mobile.auth.passkey.unavailable': '这台设备暂不支持通行密钥（React Native 里还没有 WebAuthn 实现），用邮件链接即可。',
  'mobile.auth.passkey.waiting': '请在系统弹窗里完成通行密钥操作…',
  'mobile.auth.paste.label': '粘贴邮件里的链接或令牌',
  'mobile.auth.paste.placeholder': '邮件里的完整链接，或那串令牌本身',
  'mobile.auth.verify': '验证并登录',
  // 🔴 **中性文案**（规范 §2-A2）：注册端点对"邮箱已属已验证账号"会**故意**回成功
  //    而不写凭据（防枚举）。所以这两句**不得**出现"账号已创建"这类断言 ——
  //    出现就是应用在对用户说假话。
  'mobile.auth.sent.login': '如果这个邮箱有账号，登录链接已经发出。打开邮件里的链接，或把链接粘回上面的输入框。',
  'mobile.auth.sent.register': '如果这个邮箱可用，我们会发送一封验证邮件。请查收邮件、点开验证链接，然后回到这里登录。',
  // 验证令牌**不产出会话**（规范 §2-A1），所以验证成功后还要再走一次登录。
  // 这句话要说得像"下一步做什么"，而不是像"失败了"。
  'mobile.auth.emailVerified': '邮箱已验证，但这一步还不发令牌。请再点一次「用邮件链接登录」，把新邮件里的登录链接粘回上面的输入框。',
  'mobile.auth.signedIn.title': '已登录',
  'mobile.auth.signedIn.body': '当前账号：{email}',
  'mobile.auth.passwordNeeded': '还差端到端加密口令。它只存在本机内存里、服务端看不到明文；不填的话同步会在加密那一步明确失败，不会降级成明文。',
  'mobile.auth.enableSync': '保存并启用同步',
  'mobile.auth.saveFailed': '口令没能写进本机的同步配置，请重试。',
  'mobile.auth.back': '返回',
  // 本地输入问题，不是协议失败 —— 见 `AuthScreen.failWithKey` 的注释。
  'common.auth.error.termsRequired': '注册前请先勾选同意项——这一项必须由你自己做出，我们不会替你同意。',

  // ── 移动端 · 「我的」屏 ───────────────────────────────────
  'mobile.profile.title': '我的',
  // 🔴 设置是**独立的第二层表面**（RN Modal），不是「我的」滚动流里的一段 ——
  //    对标 §11.5 的规律（次级表面独立成面）。入口行在「我的」上，内容在设置面里。
  'mobile.settings.title': '设置',
  'mobile.settings.close': '关闭',
  'mobile.profile.entry.settings': '设置',
  'mobile.profile.entry.settings.hint': '同步凭据、桌面小组件与语言',
  'mobile.profile.section.sync': '同步',
  'mobile.profile.section.status': '状态',
  'mobile.profile.section.language': '语言',
  'mobile.profile.section.lists': '清单',
  // 🔴 认证入口在这一屏的**顶部卡片**（一级可见）—— 规范 §3.1 的「前置」落点。
  //    底部标签必须保持 5 个（规范 §2-A8），所以它是入口卡片，不是第 6 个 tab。
  'mobile.profile.section.account': '账号',
  'mobile.profile.account.signIn': '注册 / 登录',
  'mobile.profile.account.signInHint': '用邮箱或通行密钥登录；登录后自动接上同步，不必手抄令牌。',
  'mobile.profile.account.signedInLabel': '当前账号',
  'mobile.profile.account.signedInHint': '已拿到访问令牌。要换账号或补一条凭据，重新登录一次即可。',
  'mobile.profile.account.offline': '还没登录',
  // ⚠️ 表单搬进设置面之后，"下面那一段"不再成立 —— 指路要说**现在**的位置，
  // 否则用户在「我的」上找一圈找不到表单，会以为功能没了。
  'mobile.profile.account.offlineHint': '不登录也可以继续用；手动填写凭据的兜底路径在「设置」里。',
  // 手动路径是**兜底**，不是主路径：从别的设备复制令牌过来时才用它。
  'mobile.profile.sync.manualHint': '下面是手动填写凭据的兜底路径：已经有令牌（比如从别的设备复制过来）时才需要用它。',
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
  'mobile.import.pasteLabel': '粘贴 CSV 文本',
  'mobile.import.pastePlaceholder': '在这里长按粘贴滴答清单导出的 CSV',
  'mobile.import.preview': '预览',
  'mobile.import.pasteNotFile': '手机上这一格贴的是**文本**，不是选文件——要选文件得先接一个原生依赖，还没做。',
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
  'site.features.item.task.trash': '回收站：删掉的内容先留着，随时恢复，也可以彻底清空',
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
  'site.platforms.web.body': '完整产品，不是演示。可安装、可离线用，数据就存在你的浏览器里。',
  'site.platforms.android.name': 'Android',
  'site.platforms.android.body': '真机可用：建任务、改期、优先级、清单、标签、重复、专注、冲突解决、回收站都能用。桌面小组件与发布签名还在路上。',
  'site.platforms.ios.name': 'iOS',
  'site.platforms.ios.body': '在模拟器上完整跑通：安装、建库、同步到另一台设备。还差真机测试与开发者签名。',
  'site.platforms.desktop.name': '桌面（Windows / macOS / Linux）',
  'site.platforms.desktop.body': '三个平台都能打包出应用。尚未签名与公证 —— macOS 上首次打开需要右键，界面也还在打磨。',
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
  'site.integrations.e2ee.item.keys': '密钥只在你手里。忘了口令，连我们也帮不了你 —— 这正是它真的加密的意思',
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
  'site.help.lede': '按**你在做什么**组织，不按文档类型 —— 每一条都写清"点哪里、点完看到什么"。',
  'site.help.topics.title': '从这里开始',
  'site.help.module.start': '开始使用',
  'site.help.module.sync': '同步与账号',
  'site.help.module.organize': '组织与节奏',
  'site.help.module.data': '数据与自建',
  'site.help.module.trust': '隐私',
  'site.help.q.create': '怎么建一条任务？',
  'site.help.a.create': '打开应用顶部的捕获框，写一句话回车即可。日期与优先级可以直接写在句子里（例如"明天下午三点交周报"），识别出来的部分会显示成可以撤销的芯片；也可以只写标题，之后在任务行上补备注。',
  'site.help.q.sync': '换设备了，数据怎么过去？',
  'site.help.a.sync': '在设置里填同步服务器地址与访问令牌即可。数据是加密后上传的，所以**口令必须填对** —— 换了口令的旧数据解不开（这是端到端加密的代价，不是 bug）。',
  'site.help.q.passphrase': '忘了加密口令怎么办？',
  'site.help.a.passphrase': '**没有找回途径，这是设计而不是疏漏。** 端到端加密意味着服务端只有密文、没有能解开它的口令 —— 任何"找回"都等于服务端能读你的数据。能做的是：在还能解锁的旧设备上把数据导出，然后在新设备上设一个新口令重新开始。所以口令请自己存好。',
  'site.help.q.passkey': '通行密钥怎么用？',
  'site.help.a.passkey': '登录时选「通行密钥」，用设备本身的人脸 / 指纹 / 系统 PIN 确认即可，没有密码可记，也没有密码可撞库。丢了的话，登录页有「丢失了通行密钥？」，会发一封找回邮件，点进去可以注册一条新的。⚠️ **最后一条凭据不允许被删除** —— 删掉就进不去了。',
  'site.help.q.quadrant': '四象限是怎么归类的？',
  'site.help.a.quadrant': '象限是**当场算出来的**，不是给任务打的标签：紧迫与否看截止日期是否落在近期窗口内，重要与否看你自己标的重要标记（没标过就按优先级推导）。所以改截止日期或优先级，任务会自动换格 —— 不会出现"象限和任务对不上"。',
  'site.help.q.repeat': '重复任务怎么设？',
  'site.help.a.repeat': '在 **Web 与移动端**都能设：打开任务详情选常用预设（每天 / 每周 / 工作日 / 每月），也可以直接写一条自定义规则。勾掉一条重复任务时，下一次到期日按规则顺延，基准是**原本的到期日**而不是"你几点勾的"。顺延的算法与各端差别见「重复任务：勾掉之后，下一次怎么算」。',
  'site.help.q.focus': '专注（番茄钟）怎么用？',
  'site.help.a.focus': '在专注页选一条任务开始计时，结束后这一次专注会记入成长统计。时长可以自己改（默认 25 分钟专注 / 5 分钟休息），改完会记住 —— 刷新页面后仍是新值。',
  'site.help.q.export': '怎么把数据带走？',
  'site.help.a.export': '三端都能**导出**：Web 在设置页、移动端在「我的」里走系统分享面板、命令行用 `export`。但**只有 Web 与命令行能导回**，而且只能还原到一个空库 —— 移动端没有导入入口。详见「把数据带走、带回来」。',
  'site.help.q.selfhost': '怎么自己搭一套？',
  'site.help.a.selfhost': '可以，但它是「自己运维一套服务」，不是一个命令就完事：目前**没有发布任何现成镜像**（要自己构建），**把服务起来不等于部署完成**（数据表结构的变更要显式执行一次），而且**不配邮件服务就注册不了**。详见「自建一套同步服务器」。',
  'site.help.q.privacy': '数据到底放在哪？',
  'site.help.a.privacy': '先落在你自己的设备上；开了同步之后，云端也只存密文 —— 服务端收到明文会直接拒绝。但**元数据不是密的**：同步时间、设备标识、以及"有一个任务被改过"这件事服务端能看到。我们不会把"什么都看不到"拿来宣传。',

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
  // 文档中心顶栏的搜索。它匹配的**只有**文章标题与小节标题（不搜正文），
  // 命中之后跳那一节的锚点 —— 所以占位文案不许承诺"搜内容"。
  'site.docs.search.label': '搜索文档',
  'site.docs.search.placeholder': '搜标题里的关键词，多个词之间是「都要包含」',
  'site.docs.search.clear': '清除搜索',
  'site.docs.search.none': '没有命中的标题。试试更短的关键词，或者换个说法。',
  // 条数是代码里的常量，不写进文案 —— 写进去就会和那个常量分叉。
  'site.docs.search.truncated': '只显示前 {count} 条，关键词再具体一点。',
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
  'site.docs.how.title': '同步是怎么工作的',
  'site.docs.how.seo.title': '同步是怎么工作的 —— heyta',
  'site.docs.how.sum': '数据先落在你自己的设备上，云端只是一条加密的传输通道 —— 以及各端分别在什么时候会真的动它。',
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
  'site.docs.how.s3p1': '上传的载荷是**端到端加密**的：加密与解密都发生在你的设备上，服务端收到（也只收得到）密文。某个客户端尝试上传明文时，服务端会直接拒绝而不写入。',
  'site.docs.how.s3p2': '但**外围信息不是密的**：同步时间、你用的是哪几台设备、动的是哪类东西与先后顺序，服务端都看得到。被保护的是内容本身（任务标题、备注这些），不是"你在用 heyta 的哪些功能"。我们不会把"什么都看不到"拿来宣传。',

  // 账号、令牌与登录方式
  'site.docs.account.title': '账号、令牌与登录方式',
  'site.docs.account.seo.title': '账号、令牌与登录方式 —— heyta',
  'site.docs.account.sum': 'heyta 没有密码可记、也没有密码可撞 —— 那同步要用的访问令牌是从哪来的。',
  'site.docs.account.s1': '同步设置里就三个框',
  'site.docs.account.s1p1': '同步设置只有三个输入项：服务端地址、访问令牌、端到端加密口令。',
  'site.docs.account.s1i1': '服务端地址：你要连的那台同步服务器。什么都不填就是纯本地使用，数据只留在这台设备上。',
  'site.docs.account.s1i2': '访问令牌：由服务端签发，代表「这个账号在这台服务器上的那块空间」。已经有令牌的可以直接粘贴。',
  'site.docs.account.s1i3': '加密口令：**不会存盘**，只存在于这次会话的内存里。它单独写一篇，见「端到端加密口令」。',
  'site.docs.account.s2': '没有邮箱+密码这条路',
  'site.docs.account.s2p1': '登录方式只有两种：邮箱链接与通行密钥。设置里没有"密码"这一栏，那个找回入口也不是密码重置 —— 这是刻意的：能被撞库的那类凭据，我们不提供。',
  'site.docs.account.s2i1': '邮箱链接：填邮箱、收邮件、点里面的链接，登录就完成了。',
  'site.docs.account.s2i2': '通行密钥：用设备本身的人脸 / 指纹 / 系统 PIN 确认，没有可记的东西，也就没有可泄露的东西。',
  'site.docs.account.s2i3': '丢了通行密钥：登录页有「丢失了通行密钥？」，会发一封找回邮件。那一步必须在真实浏览器里完成，所以它打开的是一个独立页面，而不是应用里的浮层。',
  'site.docs.account.s3': '桌面壳里为什么要跳到浏览器',
  'site.docs.account.s3p1': 'macOS 与 Windows 的桌面壳里通行密钥不可用（实测：内嵌 WebView 不提供平台认证器）。所以壳会把你送到**系统浏览器**里完成登录，成功后再自动回到壳里；万一系统没有把地址交回来，那个页面上另有一条可以直接点的回跳链接。',
  'site.docs.account.s4': '条款是「该服务端」的',
  'site.docs.account.s4p1': '注册时勾选的同意书写的是「**该服务端**提供的服务条款与隐私政策」。因为 heyta 的部署方可以是任何人 —— 你连的那台服务器由谁运营、适用哪套条款，由那台服务器决定。',

  // 端到端加密口令
  'site.docs.passphrase.title': '端到端加密口令',
  'site.docs.passphrase.seo.title': '端到端加密口令 —— heyta',
  'site.docs.passphrase.sum': '它是整套设计里唯一的一把钥匙，而它丢了真的没有找回途径 —— 这是端到端加密的定义，不是我们没做。',
  'site.docs.passphrase.s1': '口令是什么',
  'site.docs.passphrase.s1p1': '口令用来在你的设备上把数据加密后再上传。它**不发给服务端**，服务端也没有它的任何副本。',
  'site.docs.passphrase.s1p2': '它不会被写到磁盘上：只存在于当前这次会话的内存里，所以每开一个新会话都要再填一次。这不是麻烦你，是它不落盘才叫端到端。',
  'site.docs.passphrase.s2': '为什么没有「忘记密码」',
  'site.docs.passphrase.s2p1': '任何能"找回"口令的机制，都意味着某处存着一份能解开你全部数据的凭据，而那份凭据要么在服务端、要么在第三方 —— 那端到端加密就没有了。所以这里没有客服通道，也没有后台开关。**丢了口令 = 那些已同步的数据解不开。**',
  'site.docs.passphrase.s2i1': '在还能解锁的旧设备上：先把数据导出留底。',
  'site.docs.passphrase.s2i2': '然后在新设备上设一个新口令，从头开始写。',
  'site.docs.passphrase.s2i3': '把口令存进你自己的密码管理器 —— 那是它该待的地方。',
  'site.docs.passphrase.s3': '填错口令会怎样',
  'site.docs.passphrase.s3p1': '换过口令之后，旧口令写的那批记录解不开。heyta 不会因此崩掉，也不会拿明文去凑：它会把解不开的那些**跳过**，或在明显是配错的时候**暂停同步**并告诉你属于哪一种。',
  'site.docs.passphrase.s3w1': '看到"口令可能不对"就是后一种 —— 它不是网络问题，重连不会变好。',

  // 冲突
  'site.docs.conflict.title': '当两台设备改了同一条',
  'site.docs.conflict.seo.title': '当两台设备改了同一条 —— heyta',
  'site.docs.conflict.sum': '各自改过再碰头，是本地优先一定会遇到的事 —— 这里说明它凭什么算冲突，以及你怎么裁决。',
  'site.docs.conflict.s1': '为什么会有冲突',
  'site.docs.conflict.s1p1': 'heyta 不是"所有设备实时共享一个数据库"，而是每台设备先写自己的流水，再把流水递给对方。所以两台设备各自离线改了同一条任务时，**两边都合法** —— 没有一台中心机器在场当场说谁不算。',
  'site.docs.conflict.s2': '怎么判断这算不算冲突',
  'site.docs.conflict.s2p1': '每条记录都带着"我见过哪些改动"的版本信息。只有两边互相都不领先时才算真的撞上；如果 B 是在看过 A 之后写的，那只是普通的先后关系，不会被当成冲突。真的撞上时，谁胜出用"最后写入 + 设备标识"确定性地裁决，所以两台设备会挑出**同一个**答案，不会各裁一半然后越差越远。',
  'site.docs.conflict.s3': '你会看到什么',
  'site.docs.conflict.s3p1': '冲突会弹一个对话框，把本地与远端两边的内容都摆出来给你比，你选保留哪一边。选完之后两端会收敛成同一份 —— 这条"双端收敛"是端到端跑过验收的，不是推理想象出来的。',

  // 自建
  'site.docs.selfhost.title': '自建一套同步服务器',
  'site.docs.selfhost.seo.title': '自建一套同步服务器 —— heyta',
  'site.docs.selfhost.sum': '可以，而且这是 heyta 存在的理由之一 —— 但它是"自己运维一套服务"，不是一个命令就完事。',
  'site.docs.selfhost.s1': '先把难度说清楚',
  'site.docs.selfhost.s1p1': '这四条会让人中途放弃，所以放在最前面：',
  'site.docs.selfhost.s1i1': '目前**没有发布任何现成镜像**，你要在自己的机器上把它构建出来。',
  'site.docs.selfhost.s1i2': '把服务**起来**不等于部署完成：表结构变更由部署流程里的迁移步骤显式应用，服务自己不在启动时动表结构。',
  'site.docs.selfhost.s1i3': '它需要的是一台长期开着的机器、一个你自己的域名，以及"会看服务日志、能让证书按时续期"这类基本运维能力。',
  'site.docs.selfhost.s1i4': '密钥、数据库口令、对外域名都要自己配，**没有默认值** —— 缺任何一项服务会拒绝启动。这是刻意的，它不给"用默认密钥上线"留活路。',
  'site.docs.selfhost.s2': '要配的东西',
  'site.docs.selfhost.s2i1': '邮件服务：不开通就**注册不了**。heyta 没有邮箱+密码这条路，注册与登录都得点邮件里的链接。',
  'site.docs.selfhost.s2i2': '对外地址：生产环境下把它填成非加密地址，服务会拒绝启动。局域网内用明文地址是自建的正当场景，公网不是。',
  'site.docs.selfhost.s2i3': '通行密钥：需要真实域名。纯 IP 地址会被浏览器拒掉，所以用 IP 访问时只剩邮箱链接这一条路。',
  'site.docs.selfhost.s2i4': '谁能注册：可以用邮箱白名单把注册关上。关上之后别人看到的提示是「这个服务端不允许用该邮箱注册」。',
  'site.docs.selfhost.s3': '完整步骤在哪',
  'site.docs.selfhost.s3p1': '仓库里有给运维看的部署手册和本地起服务手册（导航栏那个图标就是仓库入口），那是给要动手的人写的，跟这一页讲的每句都对得上。这一页的职责是让你在决定要不要自建**之前**，先知道它长什么样。',
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
  'site.docs.selfhost.s7p1': '上游不发布带版本号的镜像，只发布跟随主干的 `latest` 与 `master-〈提交号〉` 两种标签。想把版本钉住，就把 `SUPERSYNC_IMAGE` 显式指到某个 `master-〈提交号〉`—— 不钉的话，每次拉镜像都等于升到最新主干。',
  'site.docs.selfhost.s7p2': '部署脚本是唯一被支持的入口：它把整套栈（应用、PostgreSQL 数据库、Caddy 网关）一起拉起来，换上新容器**之前**先跑一次数据迁移，起来之后还会验一次健康检查。注意 `docker compose up` 本身**不是**部署：容器启动时的自动迁移默认是关的（防止重启和迁移互相踩），所以"只把容器拉起来"会跑在没迁移过的表结构上。',
  'site.docs.selfhost.s7p3': '加 `--build` 可以在部署机上自己构建镜像，但那是把整个仓库在部署机上完整编译一遍：峰值内存要额外 1.5 GB 以上（容器本身已占约 2.5 GB），构建缓存每构建一次涨约 1.4 GB 且**不会自动清理**。小机器的正确姿势是在别处构建好再推过去，或者直接钉住现成标签。`--build` 还会拒绝在源码不干净时构建 —— 构建产物必须能对回到某一份确切的源码。',
  'site.docs.selfhost.s7i1': '三个必填项（签名密钥、数据库口令、对外域名）不配好，服务**拒绝启动**，这是故意的：没有"用默认密钥上线"这条路的活口。',
  'site.docs.selfhost.s7i2': '部署脚本会核对镜像的源码版本标签，防止"拿旧镜像跑新迁移"。自建自定义镜像时要传入同样的版本标识；确信要跳过这份核对也有显式开关，但那是给你的故意，不是给你的疏忽。',
  'site.docs.selfhost.s8': '要配的环境变量，逐个说',
  'site.docs.selfhost.s8p1': '配置全在部署目录的 `.env` 一个文件里（从仓库的 env.example 复制来改）。改完重启容器生效。下面按"配错了会发生什么"来讲：',
  'site.docs.selfhost.s8i1': '`DOMAIN` / `PUBLIC_URL`：对外域名与完整对外地址。邮件里的链接就按它生成 —— 填错的症状是"邮件里的链接打不开"。',
  'site.docs.selfhost.s8i2': '`JWT_SECRET`：登录令牌的签名密钥。空着拒绝启动；**部署定好之后不要再换** —— 换掉它，所有已登录设备立刻全部登出，在途的邮件链接一并作废。',
  'site.docs.selfhost.s8i3': '`POSTGRES_PASSWORD`：数据库口令。同样没有默认值。用栈里自带的数据库时不用另配连接串，默认连本栈的 PostgreSQL 16。',
  'site.docs.selfhost.s8i4': '`WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN`：通行密钥绑定的域名。它只能取**一个**值，所以换域名 = 这台服务器上注册过的通行密钥全部作废（账号不丢，用邮件链接重新登入再注册一把即可）。必须是真实域名，纯 IP 浏览器不收。',
  'site.docs.selfhost.s8i5': '`CORS_ORIGINS`：允许哪些前端来源调接口，逗号分隔，支持 `https://*.example.com` 这种通配。默认值指向上游的演示站 —— **自建必须改成自己的**，不改的症状就是前面那节说的"界面一直离线"。',
  'site.docs.selfhost.s8i6': '`SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM`：发信配置。heyta 注册与登录全靠邮件链接，这一组不配好，别人根本注册不进来。',
  'site.docs.selfhost.s8i7': '`HOST`：服务自己监听的地址，默认所有网卡。放在网关后面时可以收紧到本机。',
  'site.docs.selfhost.s9': '数据库与表结构变更',
  'site.docs.selfhost.s9p1': '数据库用 PostgreSQL。表结构的变更**只向前发**：已经应用过的变更文件永不被改动，要修就再发一份新的 —— 所以升级出问题时，退路是回备份，不是去改历史。',
  'site.docs.selfhost.s9p2': '迁移由部署脚本在换容器前跑一次；个别变更用了"后台建索引"的方式，在繁忙的大库上可能等锁 —— 挑低峰期做升级，给迁移留足超时时间（默认 15 分钟，可调）。超时退出有专门的退出码，清掉堵住的事务重跑即可。',
  'site.docs.selfhost.s9p3': '备份的最小口径：定期备份数据库。备份里是密文载荷加上外围信息 —— 它是恢复服务的完整来源，但不是能直接翻看内容的相册（见下面「备份是密文」一节）。',
  'site.docs.selfhost.s10': '你的服务器上到底存了什么',
  'site.docs.selfhost.s10p1': '每一笔改动是一条**加密的操作记录**：客户端从用户的加密口令派生密钥（Argon2id），载荷用 AES-GCM 加密后才上传。服务端收到明文会**直接拒收**，所以库里不存在"忘了加密"的明文载荷。',
  'site.docs.selfhost.s10p2': '外围信息是明的：动作类型、涉及的实体类型与编号、时间戳、各设备的版本先后、密文大小。这些是同步协议工作的必需品，躲不掉 —— 但自建的意义之一正是：它们落在**你**手里，不落在第三方手里。',
  'site.docs.selfhost.s10p3': '推论：能解开数据的只有持有各账号加密口令的那些设备。服务端帮不了"忘了口令"的用户 —— 这是"备份是密文"的另一面。',
  'site.docs.selfhost.s11': '命令行宿主：不开浏览器也能用',
  'site.docs.selfhost.s11p1': '除了 Web 与手机，仓库里还有一个**命令行宿主**：它连一个真实的本地数据库文件，在终端里建任务、列任务、同步。它走的是和其它端完全相同的同步协议 —— 配上同一个服务端，它就是又一台"设备"。',
  'site.docs.selfhost.s11i1': '配置走参数或环境变量：`--db` 本地数据库文件（必填）、`--server` 服务端地址、`--token` 访问令牌、`--password` 端到端加密口令；也可以用大写环境变量（`HEYTA_DB` / `HEYTA_SERVER_URL` / `HEYTA_TOKEN` / `HEYTA_PASSWORD`）。',
  'site.docs.selfhost.s11i2': '常用命令：`add` 建任务、`list` / `rename` / `complete` / `reopen` 管任务、`projects` / `tags` 看清单与标签、`sync` 同步一次、`pending` 看待上传队列长度。',
  'site.docs.selfhost.s11i3': '`export --out` 导出全部数据（含已删除记录与完整操作流水）；`import --in` 还原 —— 与其它端同一条规矩：**只进空库**，非空拒绝且不动现有数据。',
  'site.docs.selfhost.s11i4': '边界要知道：建任务只有一个日期参数（`--due`），目前**设不了重复规则**（读得到、设不了）；它是给脚本和重度终端用户用的，不是管重复任务的界面。',

  // 导出与导入
  'site.docs.transfer.title': '把数据带走、带回来',
  'site.docs.transfer.seo.title': '把数据带走、带回来 —— heyta',
  'site.docs.transfer.sum': '三端都能导出，但不是三端都能导回 —— 这是现在最该提前知道的一条差别。',
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
  'site.docs.first-run.title': '装完第一步，先弄清三件事',
  'site.docs.first-run.seo.title': '装完第一步，先弄清三件事 —— heyta',
  'site.docs.first-run.sum': '不注册也能直接用；同步是要你亲手开的一扇门；界面上那几个开关只属于这台设备。',
  'site.docs.first-run.s1': '一、不开账号也能用',
  'site.docs.first-run.s1p1': '打开 heyta 什么都不填，你可以直接建任务 —— 数据写进**这台设备自己的数据库**：Web 在浏览器的本地存储里，手机应用在自己的应用数据里。',
  'site.docs.first-run.s1p2': '移动端冷启动那一屏给的是**两个同等分量的出口**：「注册 / 登录」和「先离线使用」，不是一定要你留邮箱。',
  'site.docs.first-run.s1p3': '⚠️ 但本地使用也不是"暂时凑合"的降级态：没有账号时换设备、或清掉浏览器数据，就是**另一份数据**，两边不会自己合起来。',
  'site.docs.first-run.s2': '二、同步是要你亲手开的那扇门',
  'site.docs.first-run.s2p1': '只有把服务器地址与账号接上，这台设备才开始往外递改动。在那之前，同步入口显示的是"还没配置"。',
  'site.docs.first-run.s2p2': 'heyta 没有"邮箱 + 密码"这条路：注册与登录要么用**通行密钥**（设备的人脸 / 指纹 / 系统 PIN），要么点**邮件里的一次性链接**。',
  'site.docs.first-run.s2p3': '接上之后，另一台设备的改动会自己出现在这边；但**你这边的写入什么时候上传，各端不一样** —— Web 等下一次同步，移动端跟着写入自己出去。细节在「同步是怎么工作的」。',
  'site.docs.first-run.s2p4': '注册与登录的面板就开在**同步设置里面**，不是导航上一个独立的按钮 —— 认证要用的服务器地址，就是那里填的那个地址。分开放会出现"对着 A 登录、令牌存到 B"。',
  'site.docs.first-run.s3': '三、侧栏里那几个开关只属于这台设备',
  'site.docs.first-run.s3p1': '日历、四象限、习惯、时间线、专注、成长、便签这七个模块可以随时关掉。**关掉**的意思是：它不进页面，不是灰着不能用。',
  'site.docs.first-run.s3p2': '⚠️ 这个开关是**这台设备的本地偏好**：不写进操作日志、也不跨设备同步。在手机上关掉专注，电脑上的专注还在。',
  'site.docs.first-run.s3i1': '默认开着：日历、四象限、习惯、时间线。',
  'site.docs.first-run.s3i2': '默认关着：专注、成长、便签 —— 第一次进来不会看见全部界面。',
  'site.docs.first-run.s3i3': '关不掉的只有任务与搜索。',
  'site.docs.first-run.s4': '四、第一屏该做什么',
  'site.docs.first-run.s4p1': 'Web 打开落在任务视图，输入框就在列表上方：写下标题、回车，一条任务就落进了本地库。',
  'site.docs.first-run.s4p2': '要给它加截止时间、优先级、清单、标签、重复规则，就在任务行上展开那些入口；移动端在任务详情面板里做同样的事。',
  'site.docs.first-run.s4p3': '没有新手引导，也没有一段"欢迎使用"的动画 —— 第一屏就是能用的界面。这一页存在的理由正是：有几处区别，界面上看不出来，只能有人告诉你。',
  'site.docs.first-run.fig.tasks': 'Web 的第一屏：输入框就在列表上方，侧栏常驻收集箱、今天、已完成',
  'site.docs.first-run.fig.tasks.alt': 'Web 任务视图，收集箱为空，列表上方是添加任务的输入框',

  // 概念模型
  'site.docs.concepts.title': '任务、清单、标签、习惯：四个词各指什么',
  'site.docs.concepts.seo.title': '任务、清单、标签、习惯各指什么 —— heyta',
  'site.docs.concepts.sum': '界面上这四个词背后是四类数据，以及一个常被误会的事：视图不是第五类。',
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
  'site.docs.repeat.title': '重复任务：勾掉之后，下一次怎么算',
  'site.docs.repeat.seo.title': '重复任务勾掉之后下一次怎么算 —— heyta',
  'site.docs.repeat.sum': '顺延的基准是"原本的到期日"而不是"你几点勾的"，规则用的是日历产品通用的标准格式 —— 这两条解释了几乎所有看起来像 bug 的行为。',
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
  'site.docs.views.title': '四象限、日历、时间线、搜索：各解决什么',
  'site.docs.views.seo.title': '四象限、日历、时间线、搜索各解决什么 —— heyta',
  'site.docs.views.sum': '四个视图看着像四种功能，其实回答的是四个不同的问题；顺便把它们的平台差别说清楚。',
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
  'site.docs.reminders.title': '提醒与通知：什么时候会响、什么时候不会',
  'site.docs.reminders.seo.title': '提醒与通知什么时候会响 —— heyta',
  'site.docs.reminders.sum': '提醒是一条独立的数据，投递却受平台限制 —— 这一页把条件说全，不给你留一个哑掉的期望。',
  'site.docs.reminders.s1': '提醒不是任务上的一个开关',
  'site.docs.reminders.s1p1': '每条提醒是**独立的一条数据**：属于哪条任务、什么时候触发、可选一个提前量，另外还有已触发、稍后提醒到什么时候、已忽略这些状态。',
  'site.docs.reminders.s1p2': '一条任务上最多 **5 条**生效中的提醒。超出会被挡住并明确拒绝，不是静默吃掉。',
  'site.docs.reminders.s1p3': '做成独立数据而不是一堆字段，是因为它要单独被改：稍后提醒、忽略、随重复规则顺延，都不该重写任务本体。',
  'site.docs.reminders.s2': '什么时候会响 —— 以及为什么有时候不会',
  'site.docs.reminders.s2p1': 'Web：**应用开着**才响。到点之后由浏览器把通知弹出来，而前提是你先在界面上授权过通知权限 —— 授权必须由你那一下点击触发，这是浏览器的规则，不是我们的选择。',
  'site.docs.reminders.s2p2': '⚠️ 页面关了就什么都不会响：触发时间在本地早就算好了，但**没人在读它**。这条限制写在代码注释里，是一个已知的边界，不是临时状态。',
  'site.docs.reminders.s2p3': '移动端：目前**没有接入系统本地通知**，所以不会在应用外弹通知。手机上的到期与提醒，现在是"在界面里看得见"，不是"会响"。',
  'site.docs.reminders.s2p4': '时间上有几条边界：触发时刻最多排在**一年**以内；「稍后提醒」默认 **10 分钟**、最多 **7 天**，超出上限是**钳到上限并显示实际值**，而不是让你的点击失败；比当下早一点点是允许的（一分钟的窗口），因为算出时刻与真正落库之间本来就要过几百毫秒。',
  'site.docs.reminders.s2i1': '会响的三个前提：时间到了、应用开着、你已经授权过通知 —— 少一个都安静。',
  'site.docs.reminders.s2i2': '静音与"稍后提醒"是两条不同的路：前者只是这一条不再弹，后者会把触发时间整体推后。',
  'site.docs.reminders.s2i3': '想让提醒在后台跑，现在唯一的办法是自建一个服务端的推送通道 —— 这一版没有，也不假装它有。',
  'site.docs.reminders.s3': '重复任务的提醒会跟着挪',
  'site.docs.reminders.s3p1': '勾掉一条重复任务时，**按提前量算出来**的那些提醒会重新排到下一次到期；写死某个时刻的提醒不动。',
  'site.docs.reminders.s3p2': '所以"每天 9 点、提前 10 分钟"会自己顺延，而"就定在 3 月 5 日 14:00"不会 —— 它不知道自己挂着哪条任务的下一次。',
  'site.docs.reminders.s3p3': '顺延是**把同一条提醒重排**，不是新建一条。新建的话每个周期都会留下一个永不过期的提醒，几个周期就撞上"一条任务 5 条"的上限。',
  'site.docs.reminders.s4': '界面上那个铃铛不是提醒',
  'site.docs.reminders.s4p1': '铃铛是**账号收件箱**：服务端的账号级通知（订阅、配额这类）与邀请进度落在里面。',
  'site.docs.reminders.s4p2': '它装的是"关于这个账号发生了什么"，不是"你的任务到期了"—— 任务内容不会出现在这条通道里，服务端也解不开它。',

  // 回收站
  'site.docs.trash.title': '回收站与"彻底删除"为什么删不掉历史',
  'site.docs.trash.seo.title': '回收站与彻底删除为什么删不掉历史 —— heyta',
  'site.docs.trash.sum': '还原与彻底删除都在界面里，但后者删的是可见性，不是那一条记录 —— 这背后是一个刻意的同步协议决定。',
  'site.docs.trash.s1': '回收站里只有任务',
  'site.docs.trash.s1p1': '清单、标签、便签目前不进回收站 —— 它们被删掉之后没有还原入口。这不是遗漏：它们的删除语义和任务不一样。',
  'site.docs.trash.s1p2': '回收站也不是一个单独的"箱子"、更没有另一张表：它就是同一批任务里"已删除且还没彻底删除"的那部分，**最近删掉的排最前面**。',
  'site.docs.trash.s1i1': 'Web：左侧栏的「回收站」，常驻可见。',
  'site.docs.trash.s1i2': '移动端：「我的」页面里的回收站入口。',
  'site.docs.trash.s1i3': '两个动作都在同一块面板上：还原、彻底删除 —— 后者要你确认第二次。',
  'site.docs.trash.fig.trash': '回收站：说明文字点明这里只有任务，空着的时候也写清条目从哪儿来',
  'site.docs.trash.fig.trash.alt': 'Web 回收站面板，含一句说明文字与空状态提示',
  'site.docs.trash.s2': '还原改的是什么',
  'site.docs.trash.s2p1': '还原 = 把任务的删除标志位**清回空**，写成一条普通的更新。它不是"从备份里搬回来"：同一条任务、同一段历史继续往下长。',
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
  'site.docs.privacy.title': '数据离开这台设备的所有路径',
  'site.docs.privacy.seo.title': '数据离开这台设备的所有路径 —— heyta',
  'site.docs.privacy.sum': '一共四条，每一条都要你主动开。除此之外没有第五处 —— 这句话我们是逐条对着代码核过才敢写。',
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
  'site.docs.privacy.s3p3': '写入只能走应用自己的那条写入口，绕不过用户确认；这条路产生不了操作记录。',
  'site.docs.privacy.s4': '三、出站 AI',
  'site.docs.privacy.s4p1': 'AI 是**输入法**，不是业务规则：它只产出建议，落地必须你确认。这条不是口头承诺 —— 那条路径在类型上就构造不出写入。',
  'site.docs.privacy.s4p2': '🔴 如果你用的是托管 / 云端 AI，那条路上送出的内容**不是端到端加密的**：同步服务器解不开，但你授权发出去的那一份是明文给了模型提供方。三道闸（总开关、是否允许出境、逐功能授权）都在设置里。',
  'site.docs.privacy.s4p3': '本机端点挂了**不会**悄悄改发云端：那需要重新征得你同意，拿不到同意就一次请求都不发。',
  'site.docs.privacy.s5': '四、邮件',
  'site.docs.privacy.s5p1': '产品只发三种邮件：验证邮箱、找回通行密钥、登录链接。没有营销邮件，没有"给你推荐了几篇文章"。',
  'site.docs.privacy.s5p2': '邮件由你配的那台服务器发出（托管时是我们的），而它是自建栈的**必填项** —— 不配邮件服务就注册不了，因为 heyta 没有邮箱 + 密码这条路。',
  'site.docs.privacy.s6': '开源不等于你可以省事地相信',
  'site.docs.privacy.s6p1': 'heyta 是 MIT 许可，代码公开。上面这四条路**各有自己的开关，默认都关着**：同步要你亲手配了服务器才开，出站 AI 有总开关加逐项授权，本机接口整个默认关闭。这一页的职责是告诉你**每条路由谁开关**，而不是替它们背书。',

  // 丢了东西
  'site.docs.loss.title': '丢了三样东西：哪样找得回、哪样找不回',
  'site.docs.loss.seo.title': '丢了设备、通行密钥、加密口令会怎样 —— heyta',
  'site.docs.loss.sum': '设备、通行密钥、端到端加密口令 —— 三件事的后果完全不同，提前知道比事后聪明便宜。',
  'site.docs.loss.s1': '一、丢了设备',
  'site.docs.loss.s1p1': '换一台设备重新登录，数据会从服务器**回放**回来 —— 这正是同步该做的事，"本地优先"的意思不是"只在这一台"。',
  'site.docs.loss.s1p2': '但没开同步的那台设备，数据只在那台机器的本地库里。设备没了就是没了，这条路上没有任何服务端备份兜底。',
  'site.docs.loss.s2': '二、丢了通行密钥（找得回）',
  'site.docs.loss.s2p1': '在应用里点「丢失了通行密钥？」会发一封找回邮件；那个页面由服务端渲染，点进去可以注册一把新的。',
  'site.docs.loss.s2p2': '前提是**邮箱还能收信**。能证明这个邮箱属于你，凭据本身不需要旧密钥还在场。',
  'site.docs.loss.s2p3': '另一件你能做的事：在设置页列出**你自己**的通行密钥，改名或删掉。这是唯一的凭据管理入口。',
  'site.docs.loss.s2w1': '⚠️ 界面上**没有**"一键退出所有设备"这颗按钮，也没有"吊销所有会话"这类动作。要把旧设备的访问收回来，只能在还登得进去的时候，把不认识的每一把密钥逐个删掉。',
  'site.docs.loss.s3': '三、丢了端到端加密口令（找不回）',
  'site.docs.loss.s3p1': '这把口令是在服务器之外用来加解密的钥匙。它**没有存在服务器上**，所以服务器没有"给你重置一下"这个能力 —— 不是不想做，是做了就等于加密不存在。',
  'site.docs.loss.s3p2': '忘记口令不等于失去登录：你可能仍然登得进去、仍然看得见明文那部分字段，但那些加密内容解不开，界面上会老实告诉你解不开。',
  'site.docs.loss.s3p3': '唯一的自救是**导出**：在还解得开的时候导出一份完整 JSON。还原只能导进一个空库，所以它是搬服务器与灾后重建的工具，不是日常那个"备份"按钮。',
  'site.docs.loss.s4': '所以顺序应该是这样',
  'site.docs.loss.s4p1': '把口令写在你**不会一起丢掉**的地方。放在同一台设备的备忘录里，等于把钥匙挂在门把上。',
  'site.docs.loss.s4p2': '开同步之前先确认你登得进去、邮箱还收得到；开同步之后偶尔导出一份，并真的验一次它能还原 —— 没验过的备份不叫备份。',
  'site.docs.loss.s4p3': '这些不是吓唬人：端到端加密的收益（服务器看不到内容）和它的代价（没人能替你找回密码）是同一件事的两面。想要其中一面，就得管住另一面。',

  // ── 更新动态 ──
  'site.changelog.seo.title': '更新动态 —— heyta',
  'site.changelog.seo.description': 'heyta 的更新动态：按日期记录实际发生了什么，含实测证据与被明确判定「不做」的条目。',
  'site.changelog.title': '更新动态',
  'site.changelog.lede': '按日期倒序，只记**真的发生了什么**。包含被判定「不做」的条目 —— 一个只长功能不做减法的路线图不值得相信。',
  'site.changelog.20261005.title': '便签与提醒在两端都可用了',
  'site.changelog.20261005.body': '便签与提醒这两个此前"建了模型、没有入口"的实体，补齐了领域规则、动作层与**两个宿主**的真实入口。同一批把「已建模但零调用点」的可达性门禁从长期红转为全绿 —— 它抓的正是这种"零件齐、最后一米没接"的形状。',
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
  'site.signin.seo.title': '登录 —— heyta',
  'site.signin.seo.description': '登录 heyta：支持通行密钥（Passkey）与邮件登录链接两种方式。',
  'site.signin.title': '登录',
  'site.signin.lede': 'heyta 的账号只有两种进入方式，没有密码。',
  'site.signin.method.passkey.title': '通行密钥（推荐）',
  'site.signin.method.passkey.body': '用设备本身的人脸 / 指纹 / 系统 PIN 登录。密钥永不离开你的设备，也没有可以被撞库的密码。',
  'site.signin.method.magic.title': '邮件登录链接',
  'site.signin.method.magic.body': '填邮箱，收一封含一次性链接的邮件，点开即登录。适合还没配好通行密钥的设备。',
  'site.signin.noPassword': '⚠️ 为什么没有「邮箱 + 密码」：一个可被撞库、可被钓鱼、需要在服务端存哈希的凭据，在我们这个"服务端看不到明文"的产品里是唯一的薄弱环节。',
  // R2：`site.signin.cta`（"去应用登录"）曾在这里，源码里 0 引用，已删
  // —— 这一页的 CTA 用的是 `site.signin.recover.link` 与导航里的登录入口。
  'site.signin.recover.title': '通行密钥丢了？',
  'site.signin.recover.body': '在应用里点「丢失了通行密钥？」会发一封找回邮件，点进去可以注册新的。',
  'site.signin.why.title': '为什么登录在应用里、不在这一页',
  'site.signin.why.body': '通行密钥必须绑定**一个确定的域名**，而登录要用的服务器地址就是应用同步设置里那个地址。把认证界面复制到这一页，会出现"对着 A 服务器登录、令牌却存到 B"的问题 —— 所以这一页是入口，不是第二个登录框。',

  // ── 应用内的「帮助与关于」（指向站点，见 apps/web/src/lib/site-url.ts）──
  //    站点的三块内容在这里只做**入口**，不复制正文：正文复制过去就是第二份
  //    会漂移的副本，而漂移的那一半恰恰是搜索引擎收不到的那一半。
  'web.about.title': '帮助与关于',
  'web.about.lead': '帮助中心、更新动态与价格都在站点上 —— 它们要能被搜索引擎收录、被单独分享，所以内容只有一份。',
  'web.about.help.label': '帮助中心',
  'web.about.help.hint': '怎么建任务、怎么同步、忘了口令怎么办、怎么把数据带走',
  'web.about.changelog.label': '更新动态',
  'web.about.changelog.hint': '最近改了什么，以及被判定「不做」的条目',
  'web.about.pricing.label': '价格与订阅',
  'web.about.pricing.hint': '自建免费与官方托管各是什么，收费的只有两件事',
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
  'common.entity.NOTE': '笔记',
  'common.entity.TASK_REPEAT_CFG': '重复规则',
  'common.entity.REMINDER': '提醒',
  'common.entity.HABIT': '习惯',
  'common.entity.HABIT_LOG': '打卡记录',
  'common.entity.FOCUS_SESSION': '专注记录',
  'common.entity.AI_FEEDBACK': 'AI 使用记录',
  'common.entity.PREFERENCE_CORRECTION': '偏好纠正',
  'common.entity.GLOBAL_CONFIG': '全局设置',
  'common.entity.MIGRATION': '数据迁移',
  'common.entity.RECOVERY': '灾难恢复',
  'common.entity.ALL': '全量数据',

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

  // ── 运营管理后台（ADR-0038）──────────────────────────────────────────
  // ⚠️ 这一层**只给运营者看**，但仍然走词条表：`apps/web/src` 已在
  // `check:ui-language` 的 MIGRATED 名单里，用户可见字面量必须走 `t()`。
  'web.admin.title': '管理后台',
  'web.admin.lead': '只读为主：用户、订阅、订单、优惠码、邀请。',
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
} as const;

/**
 * 所有合法词条 key 的联合类型。
 *
 * 组件里写 `t('landing.hero.titel')`（拼错）会直接是类型错误 ——
 * 这比任何运行时的"找不到 key 就返回 key 本身"都可靠：
 * 那种兜底会把拼写错误**原样渲染给用户**，而编译期不会。
 */
export type MessageKey = keyof typeof zhCN;