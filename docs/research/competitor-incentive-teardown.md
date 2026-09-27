# 竞品激励与留存机制拆解（任务 / 习惯 / 专注类 App）

> 调研日期：**2026**（工具：AnySearch 实时检索 + 官方帮助中心 / MediaWiki 原始 wikitext；结果附 URL）。
> 本文是 [`motivation-psychology.md` §6 竞品机制事实（逐个产品）](motivation-psychology.md) 的展开版：**只给规则、数值与来源**。
> 对 heyta 的可迁移性判断放在每节末尾与 §9 汇总表——它是判断不是事实，改产品方向时以设计文档为准。
>
> 证据标记：✅ 官方页面 / 官方帮助中心 / 原始 wikitext；🟡 社区逆向、媒体报道或多来源互相矛盾；🔴 未找到可靠来源。

---

## 1. Forest 专注森林

### 机制（规则 + 数值）

| 机制 | 规则与数值 | 证据 |
|---|---|---|
| 种树计时 | 选树种 + 时长（常见 10–120 分钟，默认 25）开始专注；期间离开 App / 使用其他 App → 树**枯萎**（当场变枯枝，且枯树会留在森林里无法删除） | ✅ 官网 / App Store |
| 严格模式 | iOS 上开启后屏蔽其他 App（白名单），离开即枯死 | ✅ App Store |
| 手机工作模式 | 允许用手机、不枯树，但**最终奖励减半，且该次不进排行榜** | ✅ 开发者回复 |
| 金币获取 | 社区逆向的时长公式：`t ≤ 20 分钟 → 1 + ⌊t/5⌋`；`t ≥ 25 分钟 → 4 + t/5 + 5·(t−30)/30`。分界点在 **30 分钟**：≥30 分钟每分钟额外约 1/6 金币；设计意图是"一次长专注"比分段刷更划算 | 🟡 |
| 树种经济 | 灌木/树价格只有 4 档：**300 / 600 / 1200 / 2000 金币**（Flower Tree 300、Ginkgo 2000、Cherry Blossom 2000、Candy Tree 2000…）。累计约 **820 分钟专注 ≈ 300 金币**（约 13.6 小时解锁第一个新树种） | ✅ Forest Wiki / 🟡 逆向估算 |
| Forest Plus | **3 倍金币**、专属树种、真树权益 | ✅ App Store |
| 真树捐赠 | 累计 **2,500 金币**（≈7,500 分钟专注）兑换 1 棵真树；Forest 用 App 收入出资，通过 **Trees for the Future** 在非洲等地种植；官网计数 **2,102,946 棵**，trees.org 页面 **2,153,829 棵** | ✅ 官网 / trees.org / 台糖 / Mashable |
| 好友 / 一起种 | 与好友同步种树，中途退出会连累对方树枯萎；限时"一起种"挑战：好友合计 **750 分钟**专注解锁限定西瓜树屋 | ✅ App Store 活动页 |
| 排行榜 | 全球用户专注时长榜（手机工作模式不进榜） | ✅ |
| 成就 / 月挑战 | 达成专注里程碑解锁新树种与环境音；每月 Focus Challenge：完成每日挑战解锁**限定月树**（过期不补） | ✅ Forest Wiki |

### 心理原理
损失厌恶（树会死、枯树永久可见）｜目标梯度 + 收集（树种图鉴从 300 到 2000 的阶梯）｜变动奖励（月树、成就宝箱）｜沉没成本（森林越大越舍不得删）｜归属 / 社会压力（一起种连坐）｜胜任感（可视化森林）。

### 它让用户做了什么 / 是否伤害内在动机
- 做：在约定时长内不碰手机；为"更划算"而拉长单次专注；每天为解锁树苗开 App；为真树而积累金币。
- 伤害：金币 + 树种是典型的**完成即得的外部奖励**（completion-contingent），对本来就爱专注的人有过理由效应风险；枯树 + 连坐制造 guilt，把"我的专注"变成"我对朋友的义务"，直接压缩自主感。

### heyta 可迁移性
- **可直接做（本地）**：专注计时 → 本地虚拟森林；枯树 / 严格模式；树种图鉴 4 档价格；里程碑解锁；月挑战（本地日期触发）；专注时长写入 Apple 健康。
- **改造后可做**：真树捐赠 → 本地攒够"树券"后由用户**自愿付费/自行捐赠**，heyta 不做"服务端看到你的专注数据再代捐"；"一起种" → 对等邀请 + 双方各自本地判定 + 自愿分享结果，不做实时同步。
- **不可做**：全球排行榜、进榜判定（需要可信的服务端聚合防作弊）。

---

## 2. Duolingo 多邻国

### 机制（规则 + 数值）

| 机制 | 规则与数值 | 证据 |
|---|---|---|
| Streak | 每天完成任意一次得 XP 的活动 +1；跨天以账号时区为准；断一天归零。官方数据：**streak 到 7 天的用户完成课程的概率是 3.6 倍**；2022 年时 **600 万+** 用户 streak ≥7 天 | ✅ 官方 blog |
| Streak Freeze | 商店购买、**必须提前装备**（不可事后补救）；一次只保一天；可同时装备 **2 个**；官方称放开双 freeze 后日活 **+0.38%**；达 **100 天**里程碑额外赠 3 个不可购买的 freeze，200/300 天自动续 | ✅ 官方 blog / Wiki |
| Freeze 价格 | Wiki 商店表：**200 Gems**（或 10 Lingots）；同 Wiki 另一处 Storeinfobox 写 **425** —— 存在版本/AB 差异 | 🟡 冲突 |
| 夺回连胜（Streak Repair） | 断签后可在商店用 **Gems 购买 repair**；价格随 streak 长度上升（社区记录：58 天要 **500 gems**，另有用户报 **3,000 gems**）；Super 订阅用户曾可在 48 小时内恢复；2026-06 曾做"30 天以上断签免费复活 = 完成 3 节课"活动 | ✅ 官方帮助 / 🟡 社区 |
| Gems | 完成课程 / 任务 / 宝箱获得；成就、邀请好友各 +1 lingot；联赛前 3 名有宝石奖励；不够可直接内购 | ✅ |
| 联赛 Leagues | **10 段位**：Bronze, Silver, Gold, Sapphire, Ruby, Emerald, Amethyst, Pearl, Obsidian, Diamond。**每周一 4:00 GMT** 刷新；每组 **30 人**同段位随机分组（按本周首次获得 XP 的时间入组）；按本周 XP 排名 | ✅ Wiki |
| 晋级 / 降级 | 晋级线：Bronze 前 15、Silver 12、Gold 10、Sapphire 8、Ruby/Emerald/Amethyst 前 5、Pearl 4、Obsidian 3、Diamond 前 10（进 Diamond Tournament）。降级：16–20 名降一级，Diamond 为 26–30 名。Tournament 每组 15 人，1–10 晋级 | ✅ Wiki |
| 名次宝石 | 1st/2nd/3rd：Bronze **20/10/5** → Diamond **75/60/50**（逐段递增） | ✅ Wiki |
| XP 数值 | 完成一课 **20 XP**；连对奖励最多 **+5**；复习旧关 **5**；练习 **10+（0–5）**；跳级测试 **50**；故事 **14–28**；完成一个 unit 送 **15 分钟 2× XP** | ✅ Wiki |
| 好友榜 / Friends Quest | 与好友组队完成任务（20 或 75 节课，或 1,000/2,000 XP），奖励宝箱 = **30 分钟双倍 XP + 100 Gems** | ✅ Wiki |
| Double or Nothing | **5 Gems** 押注：坚持 7 天连胜则奖励翻倍（部分用户被挑战到 14/30 天） | ✅ Wiki / 商店 |

### 心理原理
损失厌恶（官方自己点名的核心，见 blog）｜目标梯度（官方原话：2→3 天是 +50%，200→201 天只有 +0.5%）｜变动奖励（宝箱）｜社会认同 + 竞争（30 人联赛、晋级/降级）｜承诺一致性｜弹性目标（官方引用 UPenn/UCLA 研究说明"给一点 slack 反而更坚持"）。

### 它让用户做了什么 / 是否伤害内在动机
- 做：每天哪怕 5 分钟也开一次 App（一节课即可保命）；周日晚上为了保级/晋级刷 XP；为 freeze/repair 花宝石或付费。
- 伤害：官方 blog **自己承认**断签会 demotivating、并且会让人"不敢开始一条 streak"；联赛把"学语言"重定义为"刷 XP"（低价值行为被激励）；freeze/repair 是把损失厌恶**直接变现**，也是"多邻国焦虑"讨论的主要来源。

### heyta 可迁移性
- **可直接做（本地）**：streak + 完美周 + 里程碑（7/30/100/365）；streak freeze（本地"冻结券"，提前装备才有意义，规则可完全照搬）；夺回连胜（本地 repair 券或 IAP 购买，不发行可交易货币）；XP / 等级 / 连击奖励。
- **改造后可做**：联赛 → 本地"和自己的历史比"的段位（如百分位分位晋升），保留目标梯度与晋级快感，摘掉社会比较。
- **不可做**：10 段联赛 + 30 人分组 + 晋级降级（需要服务端可信聚合与跨用户排名）；Friends Quest（需要共享任务状态）；Double or Nothing（押注，且需要货币体系）。

---

## 3. Habitica（RPG 化）

### 机制（规则 + 数值）

| 机制 | 规则与数值 | 证据 |
|---|---|---|
| HP 与掉血 | HP **上限固定 50**（不随等级上涨）。掉血来源：点"坏习惯"、漏掉 Daily、Boss 攻击。基础伤害按难度：**easy 2 / medium 3 / hard 4 HP**；随任务"变红"（价值下降）而增加；CON 可减伤，但 **CON 不防 Boss 伤害** | ✅ Wiki |
| 死亡惩罚 | HP≤0 且登录时死亡：掉 **1 级** + 该级全部 XP + 1 个随机属性点 + **全部金币** + **1 件随机装备**（可用金币回购）。Level 1 死亡不掉级但清空 XP | ✅ Wiki |
| Pause Damage | 设置里可开"暂停伤害"，度假/生病时不会因漏做 Daily 掉血 | ✅ 官方 FAQ |
| Streak | 每个 Daily / Habit 各自有 streak；Mage 技能 Chilling Frost 保一天不丢 streak；Rogue 技能 Stealth 随机免除若干 Daily 的掉血与丢 streak | ✅ Wiki |
| 宠物 / 坐骑 | **1 个蛋 + 1 瓶孵化药水 → 1 只宠物**；喂食（偏好食物效率最高）攒够 **90 食** → 坐骑（社区换算：90 只宠物 → 坐骑至少需要 **810 份食物**）。完成第 2 个任务后解锁随机掉落（蛋 / 药水 / 食物） | ✅ Wiki / 🟡 GitHub issue |
| 组队副本 Quests | party 上限 **30 人**（官方建议 ≥4 人）；用卷轴开 Boss 战或收集任务；全队完成任务削 Boss 血量；**任何队员漏掉 Daily，全队掉血**（包括正在 Inn 休息的人）；奖励全队相同、与个人贡献无关；掉落专属装备 / 宠物 / 坐骑 | ✅ Wiki |
| Enchanted Armoire | **每次 100 金币**开箱：**60%** 随机特殊装备 / **20%** 食物 / **20%** XP（10–50 XP，随机）；共 346 件（2023-02） | ✅ Wiki |
| 累计签到奖励 | 计数**永不重置、不要求连续**；30 天后每 5 天、150 后每 10 天、200 后每 20 天、400 后每 25 天发一次奖；**500 天**为最后一枚（Royally Loyal）；奖励含专属装备、副本卷轴、稀有孵化药水 | ✅ Wiki |
| 自定义奖励 | 金币可购买玩家自建的真实奖励（如"看一集剧"）；订阅者可用 **20 金币 = 1 宝石** | ✅ Wiki |

### 心理原理
损失厌恶（HP / 掉级 / 掉装备）｜沉没成本（等级 + 装备积累）｜归属 + 责任转移（队友因我掉血）｜变动奖励（掉落、开箱）｜自主（自定义奖励是 SDT 少见的正例）｜能力数值化（类 RPG 的胜任感）。

### 它让用户做了什么 / 是否伤害内在动机
- 做：在 cron 结算前补打卡；为避免"连累队友"而坚持；为回购掉落的装备继续用；为开箱攒金币。
- 伤害：**guilt / 责任压力最重**——"我漏做 Daily，队友掉血"是把行为动机从"我想做"换成"我不能害别人"；死亡惩罚对低动机用户是退出按钮；RPG 数值把任务完成变成刷数值。

### heyta 可迁移性
- **可直接做（本地）**：难度 → 掉血映射（2/3/4）、HP 上限 50、streak、变异惩罚、宠物 / 坐骑 / 装备（**建议纯装饰，不做能力数值**）、Armoire 式开箱（用本地随机数、明示概率，避免赌博化）、累计签到奖励、自定义奖励。
- **改造后可做**：掉血 / 死亡惩罚 → 本地、可关闭、默认温和（Pause Damage 可做成一等公民）；组队副本 → 异步团队目标（各端本地判定进度，用户自愿汇总，防作弊不保证）。
- **不可做**：Boss 战里"队友漏做 → 全队掉血"（需要服务端共享任务状态与实时结算）。

---

## 4. Streaks / Way of Life（极简打卡）

| 机制 | 规则与数值 | 证据 |
|---|---|---|
| Streaks 上限 | **最多 24 个任务**；每天完成即 streak +1；官方原文："Don't break the chain, or your streak will reset to zero days" | ✅ 官网 |
| 排程豁免 | 任务可设"周一到周五""每周 3 天""每周三"等；**未排期的日子不算断链**（这是极简系里最重要的一条细节） | ✅ 官网 |
| 自动判定 | 接 Apple Health：步数 5,000、心率、血压、跑步 5 英里等可由健康数据自动完成 | ✅ 官网 |
| 平台 | iPhone / Watch / iPad / Mac / Vision Pro；Watch 复杂功能显示今日剩余任务 | ✅ 官网 |
| 无社交无账号 | 没有好友、没有排行榜、没有公开数据 | ✅ |
| Way of Life | 颜色编码日历链（绿 / 红 / 黄）+ 日记记录触发原因 + 周 / 月 / 年趋势图；官网用户证言：**"I end up trying to beat my numbers from last month, which really builds intrinsic motivation"** | ✅ 官网 |

### 心理原理
承诺一致性 + 损失厌恶（链条）｜胜任感（趋势图、和上月自己比）｜自主（无社会比较、无外部货币）｜Streaks 的排程豁免还顺带规避了"全或无"崩塌。

### 它让用户做了什么 / 是否伤害内在动机
- 做：每天花几秒打卡；主动设"每周 3 天"这类现实目标；看趋势图调行为。
- 伤害：这一档**最干净**——没有外部奖励挤占内在动机，也没有排行榜焦虑。唯一风险是链条一旦断掉的放弃效应（Streaks 自身不提供 freeze，是它的弱点）。

### heyta 可迁移性
几乎 **1:1 可直接做**（本地优先天然契合）：24 任务心智、链条、排程豁免、HealthKit 自动判定、趋势图、零社交。建议补上 Streaks 缺的 freeze/grace，并保留"不公开"作为默认值。

---

## 5. 番茄 Todo（国内）

| 机制 | 规则与数值 | 证据 |
|---|---|---|
| 番茄钟 | 25 分钟专注 + 5 分钟休息（可自定义），支持正计时 / 倒计时 / 横屏翻页时钟；白噪音 | ✅ App Store |
| 学霸模式 / 严格模式 | 专注期间锁机、拦截其他 App、可设白名单（文档里明确"把微信排除在白名单之外"）；强制提醒：不断提醒直到完成待办 | ✅ 官方 / 🟡 产品分析 |
| 习惯量化 | 用计时器量化每日习惯，主打"**一万小时计划**" | ✅ App Store |
| 数据统计 | 详尽统计图表（一天结束看扇形图的成就感是评论里反复提到的点）；可把专注时长写入 Apple Health「正念训练」 | ✅ App Store |
| 自习室 | 加入 / 创建自习室，**查看好友与他人专注时长并用排名榜比较**；可看"全球排行榜"；自习室**没有交流功能**，靠"看到别人一天 10+ 小时"产生压力 | 🟡 知乎/woshipm/腾讯新闻 |
| 无货币经济 | 与 Forest 的关键差异：**没有金币 / 商品经济**，激励 = 可视化统计 + 社会比较 + 强制约束 | ✅ |

### 心理原理
社会认同 / 社会比较（自习室与全球榜）｜损失厌恶（中途退出 = 这段白学）｜承诺 + 沉没成本（锁机让退出成本变高）｜胜任（统计与一万小时）。

### 它让用户做了什么 / 是否伤害内在动机
- 做：进自习室和陌生人比时长；开锁机模式防止分心；每天看统计。
- 伤害：**排行榜焦虑最典型的一档**——"别人 10+ 小时"对低产出日是羞耻来源；锁机把自主感换成强制，长期是外部控制而非自我调节。

### heyta 可迁移性
- **可直接做（本地）**：番茄钟 / 休息节奏、专注模式与 App 屏蔽（macOS 可用专注模式 + 应用屏蔽、iOS 可用 Screen Time / 快捷指令，全部本地）、统计与热力图、一万小时累计目标、写入 Apple Health 正念。
- **不可做**：自习室、全球专注榜（需要他人实时数据与可信聚合）。
- **改造后可做**：自习室 → "好友目标约定 + 各自本地判定 + 每周自愿分享一次周报"。

---

## 6. 滴答清单 TickTick

| 机制 | 规则与数值 | 证据 |
|---|---|---|
| 习惯打卡 | 习惯库、灵活打卡方式（每天几次 / 每周几天 / 目标量）、连续天数、完成率、热力图 | ✅ 官网 |
| 成就值 Achievement Value | 完成 / 按时完成任务加分；任务逾期或未处理**扣分**；按时完成有额外加成；**每天 00:00 更新，不实时**；官方把等级简化为 **12 级**；共享清单里他人的行为不影响你的分数 | ✅ 官方帮助中心 |
| 徽章 Badges | 6 类，阈值完全公开（见下） | ✅ 官方帮助中心 |
| 专注统计 | 趋势图（年/月/周）、时间轴、最专注时段、**年视图色块**（GitHub 贡献图风格）、按清单/标签/任务的时间分布；可显示在日历；多端同步 | ✅ 官方帮助中心 |
| 心理 | 目标梯度（成就值 + 12 级）｜损失厌恶（掉分）｜收集（徽章）｜社会认同（邀请徽章）｜自主（习惯自定义） | — |
| 行为 / 伤害 | 做：清任务维持成就值、为徽章拉人注册。伤害：成就值掉分会让用户**不愿打开 App**（打开就看到扣分）；官方给 GDD 设每天 50 上限、打卡设每天 10 上限，说明自身预期会被刷 | — |

**徽章阈值（官方原文数值）**

| 类别 | 阈值 |
|---|---|
| VIP | 累计付费 **1 / 12 / 24 / 36 / 72 / 144 个月** |
| Perseverance（坚持） | 累计使用 **3 / 7 / 21 / 50 / 200 / 1000 天**（当天打开即算） |
| Get Things Done | 累计完成 **5 / 10 / 50 / 200 / 1000 / 5000** 个任务（**每天上限 50**） |
| Mindfulness（专注） | 累计专注 **25 / 100 / 500 / 2000 / 10000 / 50000 分钟**（Pomo 与正计时都算） |
| Warm Heart（邀请） | 成功邀请 **1 / 5 / 20 / 100 / 500 / 1000** 人（好友注册才计数） |
| Self-Discipline（打卡） | 累计打卡 **3 / 7 / 21 / 100 / 500 / 2000** 次（**每天上限 10**） |

### heyta 可迁移性
- **可直接做（本地）**：成就值与 12 级（改成"只加分不扣分"即可去掉掉分反效果）、全部徽章阈值（"累计使用天数"在设备上算即可，不需要服务端）、热力图 / 年视图 / 专注统计。
- **改造后可做**：Warm Heart → 本地"分享次数"（不可信，仅自我满足），不做注册事件校验。
- **不可做**：任何需要服务端好友关系或注册事件的邀请奖励。

---

## 7. 小日常 / 小打卡 / 时光序

| 产品 | 机制（规则 + 数值） | 证据 |
|---|---|---|
| **小日常** | 极简打卡（点一下翻牌 + "Click" 音效即时反馈）；**零社交、零广告**；离线可用 + iCloud 同步；**当日全部习惯完成 → 解锁一张「成就卡片」，卡片背面可写心得**；统计含连续打卡天数、完成率、日历热力图；桌面 / 锁屏小组件；VIP 3 / 6 / 12 个月订阅 | ✅ App Store / 官网 |
| **小打卡** | 社群互动学习平台（微信小程序 + App + PC）；官方称服务 **800 万+ 社群/机构、1 亿用户**；排行榜提供**积分、打卡天数、连续打卡天数、邀请**等榜，可看**总榜 / 本月 / 本周 / 今日**；圈主可按日/周/月/自定义区间统计成员数据、作业管理、活动统计；官方主打"社群化、游戏化学习系统" | ✅ 官网 / 🟡 百度百科 |
| **时光序** | All-in-one：日程 / 待办 / **习惯打卡（进度追踪 + 数据分析）** / 番茄专注（正计时、倒计时、番茄钟、多种锁机模式）/ 倒数日 / 日记 / 记账 | ✅ App Store |

### 心理原理
小日常 = 胜任 + 自主（无社会比较，"每日全清"是仪式性收尾奖赏，收集卡片是温和收集欲）｜小打卡 = 社会认同 + 归属 + 圈主监督（外部问责，核心资产是用户生产的打卡内容）｜时光序 = 工具整合带来的沉没成本与切换成本。

### 它让用户做了什么 / 是否伤害内在动机
- 做：小日常 → 每天清空今日清单、写卡片背面；小打卡 → 为了不丢榜/不丢面子每天产出打卡内容；时光序 → 把所有时间数据搬到一个 App。
- 伤害：小打卡的外部问责最强（打卡变成社交表演）；小日常几乎不伤害（它是"私密 + 自我比较"的模板）；时光序的伤害是集成锁定。

### heyta 可迁移性
- **可直接做（本地）**：小日常式 1:1 复刻（翻牌反馈、每日全清解锁卡片、连续天数 / 完成率 / 热力图、小组件、离线 + 自有同步）——heyta 的隐私定位甚至比小日常更强；时光序式 All-in-one（日历 / 任务 / 习惯 / 专注本来就在 heyta 范围内）。
- **不可做**：小打卡的圈子、社群排行榜、圈主数据统计（中心化社群平台，商业模式建立在社群数据之上）。

---

## 8. Apple Watch 健身记录

| 机制 | 规则与数值 | 证据 |
|---|---|---|
| 三环 | 红色 Move = 活动卡路里（目标个性化、可随时调）；绿色 Exercise = 达到快走及以上强度的分钟数（**标准目标 30 分钟/天**）；蓝色 Stand = 一天中每小时至少站立活动 1 分钟的小时数（**标准 12 小时**；轮椅用户变 Roll 环） | ✅ Apple 官方 |
| 连续记录 | Move 目标连续达成天数；**Longest Move Streak**：streak 结束时若破了个人纪录才发奖 | ✅ Macworld 汇总 |
| 完美周 Perfect Week | Move / Exercise / Stand 各自或"三环全合"；一周固定**周一至周日**；可重复获得（只显示一枚） | ✅ |
| 完美月 Perfect Month | 只认红环（Move 每天合上）；每月一枚、**可年年重拿** | ✅ |
| 累计里程碑 | 合上 Move 环 **100 / 365 / 500 / 1000** 次各一枚（**不要求连续**） | ✅ |
| 月挑战 Monthly Challenge | 每月专属、**个性化生成**：常见的挑战形式是"这个月消耗 X 卡路里 / 完成 N 次训练 / 走或跑 Y 公里"，通常基于你上个月的记录；Apple 未公开算法，官方只确认存在"每月挑战"奖章 | ✅ 官方存在 / 🟡 生成规则 |
| 限时挑战 | 全民健身日、地球日、跑步日、国家公园日等，条件明确且**当天内完成**（如：某日完成 ≥20 分钟任意训练 / 跑步 ≥5 公里 / 当天合上圆环） | ✅ Apple newsroom / Macworld |
| 奖章分类 | 个人记录（每次破单次纪录）、连续记录、里程碑、竞赛奖章 | ✅ |
| 与朋友竞赛 | 1v1、**7 天**，按圆环完成百分比计分，**每天上限 600 分**（一周上限 4,200），有竞赛奖章 | 🟡 第三方汇总（功能官方存在） |
| 趋势 | iPhone 端把最近 **90 天**与过去 **365 天**对比；箭头向下时给具体建议（如"一天多走四分之一公里"） | ✅ Apple 官方 |

### 心理原理
目标梯度 + 进度可见化（圆环是最干净的"离目标还有多远"）｜损失厌恶（连续记录、完美月）｜胜任感（个人记录、90 天 vs 365 天趋势——**和昨天的自己比**）｜个性化目标梯度（月挑战）｜稀缺 / FOMO（限时挑战）。

**关键设计事实**：这一档**没有公开排行榜、没有积分榜**；比较默认是私密的，社交只做 1v1 对等竞赛。这是所有调研对象里对 heyta 最友好的一档。

### 它让用户做了什么 / 是否伤害内在动机
- 做：为合上圆环每天多走一段；月末为月挑战补量；破个人纪录。
- 伤害：相对最小。但"合环"可能异化（睡前甩手刷 Move 环）；完美月一断容易触发"反正破了"的放弃。

### heyta 可迁移性
- **可直接做（本地）**——**最强的先例**：Apple 的三环、连续记录、完美周 / 完美月、100/365/500/1000 里程碑、以及**个性化月挑战全都是设备本地算的**，证明"个性化 + 激励"不需要云端。
- **改造后可做**：1v1 竞赛 → 对等挑战 + 本地生成的可分享成绩卡（可自证来源设备，但**不可证真**，必须按"身份表达"而非"竞技排名"定位）。

---

## 9. 汇总表：机制 → 出处 → 心理原理 → 对 heyta 的可用性

| 机制 | 出处产品 | 心理原理 | 对 heyta 的可用性 |
|---|---|---|---|
| streak 连续天数 | Duolingo / Streaks / Habitica / Apple / 全部国产 | 损失厌恶 + 承诺一致性 | **可直接做**（本地日期计算） |
| streak freeze / grace day | Duolingo | 损失厌恶 + 弹性目标 | **可直接做**（本地冻结券，"提前装备"规则照搬） |
| 断签修复 / 夺回连胜 | Duolingo | 损失厌恶变现 | **改造后可做**（本地 repair 券或 IAP；不发行可交易货币） |
| 虚拟货币 + 可解锁内容 | Forest / Habitica | 目标梯度 + 收集 | **改造后可做**（本地记账；不要把打卡本身货币化） |
| 真树捐赠 | Forest | 意义感 + 归属 | **改造后可做**（本地攒够 → 用户自愿付费/捐赠，不做数据上报代捐） |
| 枯树 + 严格模式 | Forest | 损失厌恶 | **可直接做** |
| 好友一起专注 / 一起种 | Forest | 归属 + 社会压力 | **改造后可做**（对等邀请、各自本地判定、自愿分享；无实时同步） |
| 全球专注排行榜 | Forest / 番茄Todo | 社会比较 | **不可做**（缺少可信聚合） |
| 10 段联赛 + 晋级降级 | Duolingo | 社会比较 + 损失厌恶 | **不可做**（可改造为"和上月自己比"的本地段位） |
| XP / 等级 | Duolingo / Habitica / TickTick | 目标梯度 + 胜任 | **可直接做** |
| 宝石经济 / 内购 | Duolingo | 变动奖励 + 损失厌恶变现 | **改造后可做**（StoreKit IAP 可用；不做可交易货币） |
| 好友榜 / Friends Quest | Duolingo | 归属 | **不可做**（异步团队目标可改造） |
| Double or Nothing 押注 | Duolingo | 损失厌恶（赌博化） | **不可做** |
| 掉血 / 死亡惩罚 | Habitica | 损失厌恶 + 沉没成本 | **改造后可做**（本地、默认温和、可关闭；绝无"队友连坐"） |
| 组队 Boss 副本 | Habitica | 归属 + 责任 | **不可做**（可改造为异步团队目标） |
| 宠物 / 坐骑 / 装备收集 | Habitica | 收集 + 沉没成本 | **改造后可做**（纯装饰，不做能力数值） |
| Enchanted Armoire 开箱（60/20/20） | Habitica | 变动奖励 | **改造后可做**（本地随机 + 明示概率，避免赌博化） |
| 自定义奖励（金币换真实奖励） | Habitica | 自主（SDT） | **可直接做**（本地更私密，反而更强） |
| 累计签到奖励（永不重置） | Habitica | 目标梯度 + 反放弃 | **可直接做** |
| 极简链条 + 排程豁免（24 任务） | Streaks | 承诺一致性 | **可直接做**（务必保留"非排期日不算断链"） |
| 颜色链 + 与上月自己比 | Way of Life | 胜任（自我比较） | **可直接做** |
| HealthKit 自动判定 | Streaks / Apple | 降低摩擦 | **可直接做** |
| 番茄钟 + 锁机 / 专注模式 | 番茄Todo / 时光序 | 承诺 + 沉没成本 | **可直接做**（本地系统能力） |
| 自习室（他人时长可见） | 番茄Todo | 社会比较 | **不可做** |
| 一万小时累计目标 | 番茄Todo | 目标梯度 | **可直接做** |
| 成就值 + 12 级 | TickTick | 目标梯度 + 损失厌恶 | **可直接做**（去掉扣分项） |
| 徽章阈值体系（6 类） | TickTick | 收集 + 胜任 | **可直接做**（邀请类除外） |
| 年度热力图 / 年视图 | TickTick | 进度可见化 | **可直接做** |
| 邀请徽章（Warm Heart） | TickTick | 社会认同 | **不可做**（降级为本地分享计数） |
| 成就卡片 / 每日全清奖赏 | 小日常 | 收尾奖赏 + 胜任 | **可直接做** |
| 圈子 + 社群排行榜 + 圈主统计 | 小打卡 | 社会认同 + 外部问责 | **不可做** |
| 三环 + 完美周 / 完美月 | Apple | 目标梯度 + 损失厌恶 | **可直接做** |
| 个性化月挑战 | Apple | 个性化目标梯度 | **可直接做**（本地算法，Apple 已证先例） |
| 累计里程碑 100/365/500/1000 | Apple | 目标梯度 + 胜任 | **可直接做** |
| 1v1 7 天竞赛（600 分/天） | Apple | 竞争 + 归属 | **改造后可做**（对等、自愿；防作弊不可保证） |
| 限时活动徽章 | Apple / Forest | 稀缺 + FOMO | **改造后可做**（本地日期触发，无需服务端） |

---

## 10. 对 heyta 的硬约束推论

1. **需要"跨用户可信聚合"的机制全部不可做**：排行榜、联赛、自习室、组队 Boss、邀请奖励。本地数据由客户端掌握，一个"本地排行榜"在单机上没有意义，多机汇总又无法防作弊。
2. **社交只能退化为两条路**：(a) 对等邀请（用户自己交换密钥 / 链接，不需要用户目录）；(b) 用户自愿导出/分享的**签名成绩卡**——可自证来源设备，但**不可证真**。产品定位必须是"身份表达"，不能是"竞争排名"。
3. **不要把打卡本身货币化**：Deci/Koestner/Ryan 1999 元分析（128 项研究）显示 engagement-contingent / completion-contingent / performance-contingent 奖励显著削弱自由选择下的内在动机（d = −0.40 / −0.36 / −0.28）。更安全的模板是 Apple 档（进度可见 + 自我比较 + 个性化挑战）与小日常档（每日全清的仪式感）。
4. **中断必须不等于归零**：freeze / grace / repair 是唯一"既提升留存又不坑用户"的机制，Duolingo 官方 blog 自己也承认断签会 demotivating。
5. **一切奖励要能离线判定**；需要联网的（真树、邀请、竞赛）必须显式标注"用户自愿分享"或"由用户自己的自托管实例判定"，并接受不可防作弊。

---

## 来源

- Forest：[官网](https://forestapp.cc/)｜[Trees for the Future](https://trees.org/support/corporate-sponsors/forest-app)｜[App Store CN](https://apps.apple.com/cn/app/id866450515)｜[Forest Wiki: Classic Trees](https://forestapp.fandom.com/wiki/Classic_Trees)｜[Mashable 2019](https://mashable.com/article/forest-app-productivity-focus-review)｜[台糖月刊](https://www.taisugar.com.tw/monthly/CPN.aspx?ms=1512&p=13389782&s=13389805)｜[金币公式逆向](https://sutianshan2008.wixsite.com/tianshan-su-blog/post/blog-entry-3-11-13-forsest-coin-systems)
- Duolingo：[官方 blog：streak 的习性研究](https://blog.duolingo.com/how-duolingo-streak-builds-habit/)｜[官方帮助：What is a streak](https://www.duolingo.com/help/what-is-a-streak)｜[Wiki: League](https://duolingo.fandom.com/wiki/League)｜[Wiki: Streak](https://duolingo.fandom.com/wiki/Streak)｜[Wiki: Shop/Streak freeze](https://duolingo.fandom.com/wiki/Shop/Streak_freeze)｜[Wiki: Gem](https://duolingo.fandom.com/wiki/Gem)｜[Wiki: XP](https://duolingo.fandom.com/wiki/XP)｜[Wiki: Friends Quest](https://duolingo.fandom.com/wiki/Friends_Quest)
- Habitica：[Wiki: Health Points](https://habitica.fandom.com/wiki/Health_Points)｜[Wiki: Death Mechanics](https://habitica.fandom.com/wiki/Death_Mechanics)｜[Wiki: Boss](https://habitica.fandom.com/wiki/Boss)｜[Wiki: Quests](https://habitica.fandom.com/wiki/Quests)｜[Wiki: Enchanted Armoire](https://habitica.fandom.com/wiki/Enchanted_Armoire)｜[Wiki: Daily Check-In Incentives](https://habitica.fandom.com/wiki/Daily_Check-In_Incentives)｜[Wiki: Streaks](https://habitica.fandom.com/wiki/Streaks)｜[官方 FAQ](https://habitica.com/static/faq)
- Streaks / Way of Life：[streaksapp.com](https://streaksapp.com/)｜[wayoflifeapp.com](https://wayoflifeapp.com/)
- 番茄 Todo：[App Store CN](https://apps.apple.com/cn/app/id1242689729)｜[官网](https://www.tomatodo.cn/)｜[知乎产品分析](https://zhuanlan.zhihu.com/p/112409287)｜[人人都是产品经理](https://www.woshipm.com/evaluating/3069778.html)｜[腾讯新闻竞品分析](https://news.qq.com/rain/a/20210828A06IF200)
- TickTick：[Achievements and Statistics](https://help.ticktick.com/articles/7082302534169133056)｜[Badges](https://help.ticktick.com/articles/7082279841969471488)｜[Focus Statistics](https://help.ticktick.com/articles/7055781966800486400)
- 小日常 / 小打卡 / 时光序：[小日常 App Store](https://apps.apple.com/cn/app/id1263789061)｜[小日常官网](https://myshineday.github.io/)｜[小打卡官网](https://www.xiaodaka.com/)｜[小打卡 App Store](https://apps.apple.com/cn/app/id1484047180)｜[百度百科：小打卡](https://baike.baidu.com/item/%E5%B0%8F%E6%89%93%E5%8D%A1/60321951)｜[时光序 App Store](https://apps.apple.com/sg/app/id1343731648)
- Apple：[官方：追踪每日健身记录](https://support.apple.com/zh-cn/guide/watch/apd3bf6d85a6/watchos)｜[Macworld 奖章全表](https://www.macworld.com/article/231140/how-to-get-all-of-the-apple-watch-activity-challenge-badges.html)｜[Apple newsroom 全民健身日](https://www.apple.com.cn/newsroom/2021/08/apple-celebrates-national-fitness-day-with-apple-watch-activity-challenge/)｜[竞赛计分（第三方）](https://www.competoapp.com/en/apple-watch-competition/rules)
- 心理学：[Deci, Koestner & Ryan 1999 元分析](https://selfdeterminationtheory.org/wp-content/uploads/2014/04/1999_DeciKoestnerRyan_Meta.pdf)｜[Lepper, Greene & Nisbett 1973](https://www.heartofcharacter.org/wp-content/uploads/Undermining_Childrens_Intrinsic_Interest_with_Ext-1.pdf)｜[Nunes & Drèze 2006 禀赋进度效应](https://www.jstor.org/stable/10.1086/500480)｜[Kivetz, Urminsky & Zheng 2006 目标梯度](https://www.columbia.edu/~rk566/Session4/Goal-Gradient_Illusionary_Goal_Progress.pdf)
