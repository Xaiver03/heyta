# 滴答清单（DIDA / TickTick）帮助中心与官网信息架构调研

- 调研日期：**2026-09-28**（本机系统时间；页面页脚亦显示 © 2026）
- 调研方式：`web_fetch` + 直接 `curl` 抓取 HTML，并解析 Next.js `__NEXT_DATA__` 内嵌 JSON 与前端 JS chunk（i18n 文案、下载/定价逻辑）。
- **所有条目均来自真实抓取**。凡抓不到的，一律标注「未核实」并列出尝试过的 URL。
- 关键发现：`help.dida365.com` 是 Next.js 应用，**每个页面都内嵌同一份"站点索引"数组**（`__NEXT_DATA__.query.articles`，97 篇，含完整正文），
  这比它自己的 `sitemap.xml` 权威得多（后者停留在 2024-03-28，只有 18 条 URL）。

## 0. 抓取来源清单

| 用途 | URL | 结果 |
|---|---|---|
| 帮助中心首页 | https://help.dida365.com/ | 200，内嵌 97 篇索引 |
| 帮助中心 sitemap | https://help.dida365.com/sitemap.xml | 200，**仅 18 条 URL，lastmod 2024-03-28（陈旧）** |
| 帮助中心文章（通配） | https://help.dida365.com/articles/{postId} | 200，每页内嵌同一份 97 篇数组 + 当前文章正文 |
| 帮助中心外部文章 | https://help.dida365.com/external/articles/{id} | 200，**不在 97 篇索引内**，另一套命名空间 |
| 官网首页 | https://www.dida365.com/home | 200 |
| 功能介绍 | https://www.dida365.com/features | 200 |
| 下载 | https://www.dida365.com/download | 200 |
| 定价 | https://www.dida365.com/upgrade （`?language=zh_cn` / `en_us` 均可） | 200，`pageProps.priceInfo` 含价格 |
| 教育优惠 | https://www.dida365.com/education | 200 |
| 礼品卡 | https://www.dida365.com/card | 200（正文客户端渲染，文案在 JS chunk `pages/card-*.js`） |
| 登录 / 注册 | https://www.dida365.com/signin、`/signup`、`/signon` | 200，**SPA 空壳（5.5 KB HTML）**，文案在前端 bundle |
| Windows 客户端页 | https://www.dida365.com/windows | 200 |
| macOS 客户端页 | https://www.dida365.com/about/mac、https://www.dida365.com/mac | 200 |
| 使用条款 | https://www.dida365.com/about/tos | 200（《使用条款》，主体 杭州随笔记网络技术有限公司） |
| 隐私声明 | https://www.dida365.com/about/privacy | 200（更新日期 2026-07-09，生效 2021-06-24） |
| 开源协议 | https://www.dida365.com/about/license/web | 200（24 万字符，codemirror MIT 等） |
| 国际版（对照） | https://ticktick.com/upgrade | 200，US$49.99/年 |
| 前端 bundle | `https://cncdn.dida365.com/sites/_next/static/chunks/...` | 32 个 chunk 全量下载分析 |

> 说明：`https://www.dida365.com/upgrade` 与 `https://dida365.com/upgrade` 在我的网络出口（countryCode=US）下**均返回英文界面**，
> 但价格与条目与中文页完全一致（同一份 `priceInfo`）。中文界面文案通过 `?language=zh_cn` 与 JS bundle 内的 `zh_cn` i18n 块核实。

---

## 1. 帮助中心完整目录树

帮助中心的**真实结构**由三部分组成，而不是只看首页卡片：

- `topicConfigData`（5 个主题入口）→ 首页顶部 5 张大卡
- `featureConfigData`（6 个功能栏目）→ 首页「功能指南」
- `specialConfigData`（6 个特色功能磁贴）→ 首页「特色功能」
- `query.articles`（97 篇索引）→ **完整目录树**，按 `sectionId` 分三区：`feature` 81 篇、`special` 11 篇、`faq` 5 篇

### 1.1 主题分类（首页 5 张大卡）— 来源：https://help.dida365.com/

| # | 卡片标题 | 卡片图 | postId | 备注 |
|---|---|---|---|---|
| 1 | 新手指南 | `beginner.png` | 6950689598586486784 | |
| 2 | 最佳实践 | `best-practice.png` | 6950689216619610112 | |
| 3 | 常见问题 | `faq.png` | 6950670128287580160 | 页脚 FAQ 也指向此 ID |
| 4 | **AI 功能** | `design.png` | 7444671678778441728 | 卡片 id 是 `design`、图是 `design.png`，但标题与指向都是「🤖️ AI 功能」 |
| 5 | 更新动态 | `new.png` | 6950689674532749312 | |

另有一篇 **💎 设计理念**（postId `6950689775275737088`，section=`faq`）**不在首页卡片上**，但存在于索引数组中，可直接访问
https://help.dida365.com/articles/6950689775275737088 。

### 1.2 「功能指南」— feature 区（81 篇）

首页只展示每个栏目下 **5 条精选**（由 `featureConfigData` 指定），**索引树里其实更多**。下表给的是**完整树**。

```
✅ 任务  [6950361599374786560]
   ├─ 添加任务                       [6950658877373284352]   ← 首页精选
   ├─ 任务详情                       [6950661731483910144]
   ├─ 编辑与排版                     [7506636172735545344]
   ├─ 超强大的提醒功能                [6950660229746917376]   ← 首页精选
   ├─ 持续提醒                       [7374016921986924544]
   ├─ 推荐任务                       [7401559568137846784]
   ├─ 固定时间与固定时区              [7082246235360329728]
   ├─ 不同的视图查看任务              [6950656395750408192]
   │    ├─ 列表视图                  [6950656708259610624]
   │    ├─ 看板视图：分类管理任务      [6950656501543337984]   ← 首页精选
   │    └─ 时间线视图：项目管理的必备神器 [6950656549178048512] ← 首页精选
   ├─ 如何管理海量任务                [6950652964327391232]
   │    ├─ 用文件夹管理任务           [6957521286893404160]
   │    ├─ 用清单管理任务             [6950654234933067776]
   │    ├─ 用分组和排序管理任务        [7054273336087412736]   ← 首页精选
   │    ├─ 用标签管理任务             [6950656299306582016]
   │    ├─ 过滤器：随心所欲筛选你想看的任务 [6950655961044353024]
   │    ├─ 多级任务                  [6950660746367729664]
   │    └─ 搜索任务                  [7473271683613196288]
   └─ 设置重复任务                    [6950660365923385344]

📆 日历  [6950361611617959936]
   ├─ 周视图：轻松安排周计划          [6950641140068515840]   ← 首页精选
   ├─ 月视图：每月总结复盘            [6950640298334617600]   ← 首页精选
   ├─ 年视图：查看年度任务完成情况     [7397517843383713792]   ← 首页精选
   ├─ 列表视图：按天查看任务          [6950643979079647232]   ← 首页精选
   ├─ 日程视图：以时间串联任务        [7213438708429619200]
   ├─ 日历显示设置                    [6950647988939128832]
   ├─ 任务与日历同时显示              [7358382716586295296]
   └─ 常见问题                        [6950648670899404800]

🎯 四象限  [6950361734683033600]
   ├─ 如何使用四象限                  [6950398710203285504]   ← 首页精选
   └─ 如何编辑四象限规则              [6950381682822217728]   ← 首页精选

🍅 番茄专注  [6950361797429821440]
   ├─ 如何开始专注                    [6950408124297641984]   ← 首页精选
   ├─ 如何保持专注状态                [6950412778679042048]   ← 首页精选
   ├─ 常用专注                        [7031082644146225152]   ← 首页精选
   ├─ 专注数据统计                    [6950408300395495424]   ← 首页精选
   └─ 常见问题                        [6950411584711688192]

⏰ 习惯打卡  [6950361641582067712]
   ├─ 开始坚持一个习惯                [6950379455722291200]   ← 首页精选
   ├─ 更好地完成习惯                  [6950379816176582656]   ← 首页精选
   └─ 习惯数据统计                    [7005344825801179136]

⏳ 倒数纪念日  [7322192298849075200]
   ├─ 添加倒数纪念日                  [7321447466803396608]   ← 首页精选
   ├─ 打造专属纪念页                  [7322503597483098112]   ← 首页精选
   └─ 管理倒数纪念日                  [7322147514604322816]   ← 首页精选

🤝 共享与协作  [6950648827183366144]
   ├─ 如何共享清单                    [6950649257581871104]
   └─ 团队如何协作                    [6950652002518958080]

🔗 导入与关联  [6949998557218734080]
   ├─ 日历订阅                        [6949998599191134208]   ← 首页「日历」精选第 5 条
   │    ├─ 本地日历                  [7193075395720118272]
   │    ├─ Google 日历               [6950000554735042560]
   │    ├─ iCloud 日历               [7190959639616290816]
   │    ├─ Outlook 日历              [7190959706343473152]
   │    ├─ Exchange 日历             [7193074856341012480]
   │    ├─ 企业微信、钉钉、飞书等日历  [7190959806838996992]
   │    ├─ URL                       [7190979764138541056]
   │    └─ 在第三方日历中订阅滴答清单  [6950000444106080256]
   ├─ 玩转微信                        [6949994885164302336]
   ├─ 关联 Notion                     [7263009022960205824]
   ├─ Siri                            [6950042073403752448]
   ├─ 从其他应用导入                  [6950042319731032064]
   └─ 导入 Apple 健康数据             [7309849895597244416]

👑 成就值与勋章  [7223896922350682112]
   ├─ 成就值                          [7223931708330999808]
   └─ 勋章                            [7223931722771988480]

🔑 账号与安全  [6950657111692935168]
   ├─ 注册与登录                      [6950691508324401152]
   ├─ 付费与升级                      [6990517106034868224]
   │    └─ 教育优惠申请               [7208410033590108160]
   ├─ 数据备份与迁移                  [6950691573587771392]
   └─ 双重验证                        [7305780125377757184]

🤖️ AI 功能  [7444671678778441728]   ← 首页 5 大卡之一
   ├─ AI 助手                         [7502990612036059136]
   ├─ AI 语音添加任务                 [7444666114547646464]
   ├─ AI 录音总结                     [7444668968427585536]
   ├─ 滴答清单 MCP                    [7438132116019216384]
   ├─ DIDA CLI                        [7464976698707017728]
   └─ 滴答清单 × AI 使用案例          [7475108284236562432]
```

### 1.3 「特色功能」— special 区（11 篇）

首页「特色功能」磁贴只展示 **6 个**（`specialConfigData`），索引里 actually 有 **11 篇**。

| # | 标题 | postId | 首页磁贴文案 | 首页是否展示 |
|---|---|---|---|---|
| 1 | 💻 全平台支持 | 6950366447398813696 | 支持全网全平台下载使用，轻松同步全部平台。 | ✅ |
| 2 | 🌮 小组件 | 6950366960659988480 | 提供丰富多样的小组件，直接从桌面上获取所需的一切信息。 | ✅ |
| 3 | 🌍 玩转微信 | 6950366347985420288 | 轻松创建任务，即时任务提醒。 | ✅ |
| 4 | 📝 桌面便签 | 6986508444417130496 | 将待办放入便签，直接在桌面上显示。 | ✅ |
| 5 | 🌻 课表导入 | 6950372717036044288 | 开启课表视图，轻松创建课程，直观查看每日课程安排。 | ✅ |
| 6 | ⌨️ 桌面快捷键 | 6950372467189743616 | 使用快捷键和指令菜单来完成应用内操作，无需鼠标，效率更高。 | ✅ |
| 7 | ⏳ 时间线视图 | 7019123502271692800 | —（无磁贴文案） | ❌（树中为顶层独立条目） |
| 8 | 🕑 智能识别 | 7081931977951019008 | — | ❌ |
| 9 | 🔜 快捷指令 | 7119949066221387776 | — | ❌ |
| 10 | 🖱️ 桌面快捷操作 | 7351502985995747328 | — | ❌ |
| 11 | 📔 笔记与摘要 | 6950671600370843648 | — | ❌ |

### 1.4 索引之外的「外部文章」命名空间（/external/articles/）

这是**第二套内容池**，不进入 97 篇索引，因此**无法枚举完整集合**。从索引文章的正文里一共反解出 **14 个被引用的 external 文章 ID**：

| ID | 标题 | 来源引用位置 |
|---|---|---|
| 7065212931289382912 | 🗂 实用模板 | 最佳实践 → 其他实用场景安利 |
| 7069931247773941760 | ⌚️ 手表 | 添加任务 → 用手表添加任务 |
| 7254741588264353792 | 🎨 外观 | 常见问题 → 如何自定义主题 |
| 7505894191243722752 | 2025年更新 | 更新动态 → 更多 |
| 7301066376716746752 | 2024年更新 | 更新动态 → 更多 |
| 7155122706650759168 | 2023年更新 | 更新动态 → 更多 |
| 7391652139233181696 | 如何告别拖延症？ | 最佳实践 → 时间管理方法论 |
| 7391681213968154624 | 如何科学提升专注力？ | 同上 |
| 7391682353191452672 | 我想为任务分类，有哪些方法呢？ | 同上 |
| 7391684111305277440 | 别让伪自律毁了你 | 同上 |
| 7389547077631475712 | 用GTD清空大脑，把事情都做完！ | 同上 |
| 7389581797023023104 | 时间分块法助你提高生产力！ | 同上 |
| 7389565749754331136 | 用番茄工作法高效工作！ | 同上 |
| 7389587837546397696 | 吃掉那只青蛙！ | 同上 |

> ⚠️ **未核实**：是否还存在「没有任何被索引文章引用」的 external 文章。
> 尝试过：`/sitemap.xml`（仅 18 条，2024 年）、帮助中心首页/全部分类页的 `__NEXT_DATA__`（只给 97 篇）、
> 帮助中心搜索框（未找到公开 JSON 搜索 API）。**结论：该命名空间不可完整枚举。**

---

## 2. 每个一级分类的文章数量

| 一级分类 | 类型 | 篇数 | 依据 |
|---|---|---|---|
| 新手指南 | 单篇长文 | **1** | postId 6950689598586486784，正文 3,983 字符，4 个一级章节 |
| 最佳实践 | 单篇长文（链接聚合页） | **1**（页内 **57 条外链**） | 正文 6,322 字符，10 个分组 |
| 常见问题 | 单篇长文（Q&A 聚合页） | **1**（页内 **67 个问答**） | 正文 22,177 字符，8 个分组 |
| AI 功能 | 单篇长文（导航页） | **1**（指向站内 6 篇） | 正文 616 字符 |
| 更新动态 | 单篇长文（changelog 聚合页） | **1**（近期 5 条 + 链到 3 个年度归档） | 正文 4,702 字符 |
| 💎 设计理念（隐藏） | 单篇长文 | **1** | 正文 1,310 字符 |
| **功能指南（feature 区）** | 目录树 | **81** | `sectionId='feature'` 计数 |
| **特色功能（special 区）** | 目录树 | **11** | `sectionId='special'` 计数 |
| **帮助中心索引总计** | — | **97** | `query.articles.length` |
| 外部文章（/external/） | 独立命名空间 | **≥14（不可完整枚举）** | 见 §1.4 |

### 功能指南 6 个栏目的篇数（含子级）

| 栏目 | 直接子项 | 含孙级总计 |
|---|---|---|
| ✅ 任务 | 10 | **21** |
| 📆 日历 | 8 | **9** |
| 🎯 四象限 | 2 | **3** |
| 🍅 番茄专注 | 5 | **6** |
| ⏰ 习惯打卡 | 3 | **4** |
| ⏳ 倒数纪念日 | 3 | **4** |

### 其他 feature 区栏目（首页未列为「功能指南」，但属 feature 区）

| 栏目 | 总计 |
|---|---|
| 🔗 导入与关联 | **15** |
| 🤖️ AI 功能 | **7** |
| 🔑 账号与安全 | **6** |
| 🤝 共享与协作 | **3** |
| 👑 成就值与勋章 | **3** |

### 最佳实践的 57 条外链分布

| 分组 | 条数 |
|---|---|
| ⏰ 时间管理方法论 | 8 |
| 🎬 操作视频来袭，直观教学 | 7 |
| 🙇🏻‍♀️ 让学习事半功倍 | 7 |
| 🤖 AI 助力高效生活 | 6 |
| 💻 提升职场竞争力 | 6 |
| 🌼 记录美好生活 | 6 |
| 🚀 构建个人管理系统 | 6 |
| 🤔 滴答清单的隐藏玩法 | 6 |
| 🌞 搭配其他APP，效果更好 | 5 |
| ✨ 其他实用场景安利 | 1（🗂 实用模板） |

外链域名分布：`mp.weixin.qq.com` **42**、`help.dida365.com`（external 文章）**8**、`www.bilibili.com` **7**。
→ **判断：最佳实践 是"公众号/视频号内容外链聚合"，不是站内文章集合。**

---

## 3. 常见问题（FAQ）完整清单

来源：https://help.dida365.com/articles/6950670128287580160
（该 URL 同时是页脚 `FAQ` 的指向，页面最后修改时间 2026-09-17）
结构：8 个分组，共 **67 个问答**（正文用 `::: spoiler 标题` 折叠块承载）。

### 🔥 热点问题（15）
1. 如何备份数据？
2. 如何合并账号数据？
3. 如何在任务中添加图片或附件？
4. 如何将手表连接滴答清单？
5. 如何在日历中查看打卡、专注记录？
6. 滴答清单是否有教育优惠？
7. 如何在使用微信创建任务？
8. 任务到期不提醒?
9. 如何设置一周开始于？
10. 如果被滴答小助手删除好友怎么办？
11. 如何关闭拼写检查？
12. 为什么在滴答清单中订阅企业微信日程失败了？
13. 如何自定义主题？以及进行字体大小等外观设置？
14. 为什么 Markdown 语法输入后没有触发对应格式？
15. 为什么详情突然显示很多符号？

### 🔑 账户&数据（11）
1. 如何修改密码？
2. 如何绑定手机号、邮箱？
3. 如何解绑微信或 QQ?
4. 如何注销账户？
5. 如何清空账号中的所有内容和记录？
6. 成就值是如何计算的？
7. 如何开具发票？
8. 如何购买和使用滴答清单礼品卡？
9. iOS 如何取消自动续费或订阅？
10. 如何为整个团队购买高级会员？
11. 高级会员和普通用户的清单/任务数量限制分别是多少？

### ✅ 清单&任务（12）
1. 如何设置农历生日？
2. 如何查看任务动态？
3. 为什么看不到某些智能清单？
4. 怎么恢复删除的任务？
5. 如何快速进入侧边栏？
6. 如何添加任务模板和创建模板？
7. 管理任务总共有哪些层级？
8. 可以批量编辑或删除任务吗？
9. 如何在任务中添加图片或附件？
10. 如何跳过重复任务的当前周期吗？
11. 如何开启倒数日？
12. 如果出现"任务已隐藏，因为日历中未显示所属清单"，该如何恢复？

### 🔔 任务提醒（5）
1. 如何开启位置提醒？
2. 任务到期不提醒怎么办？
3. 如何在应用图标上显示任务数量？
4. 如何开启持续提醒？
5. 如何设置提醒常驻栏状态？

### 📆 日历（6）
1. 如何调整日历视图中的时间轴？
2. 为什么在日历视图中会遇到不能给重复任务打勾的情况？
3. 滴答清单支持订阅哪些日历？
4. 如何让日历视图上的任务显示为不同的颜色？
5. 如何在日历中显示特定的清单内容？
6. 如何在日历视图中安排任务?

### 🍅 番茄专注（6）
1. 桌面端如何开启专注计时？
2. 如何补记/删除专注记录？
3. 如何设置番茄结束提醒铃声？
4. 如何设置预计番茄/预计时长？
5. 番茄专注如何开启屏幕常亮?
6. 如何设置应用白名单？

### ⏰ 习惯打卡（6）
1. 如何在日历中显示打卡？
2. 如何查看习惯统计？
3. 如何补记打卡日志？
4. 如何设置打卡提醒？
5. 如何在"今天"、"最近7天"中显示打卡习惯？
6. 如何专注打卡习惯？

### 🤝 共享协作（6）
1. 如何与他人共享清单？
2. 为什么我找不到共享协作功能？
3. 共享成员都要高级会员吗？
4. 如何为他人指派、分配任务？
5. 不想收到共享清单中指派给别人的任务提醒怎么办?
6. 如何评论任务？

### FAQ 折射出的用户痛点（我的归纳，非页面原文）

- **容量/付费边界**：附件大小与数量、清单/任务上限、共享成员数、团队购买 → 出现在「热点问题 + 账户&数据」两处。
- **移动端提醒不可靠**：Android 省电/自启动/第三方安全软件白名单、iOS 通知权限、任务到期不提醒 → 独立成组（🔔 任务提醒）。
- **第三方日历订阅踩坑**：企业微信必须用 CalDAV + `caldav.wecom.work`（不是 `wecom.work`）→ 这是典型的一线支持成本。
- **Markdown / 编辑器兼容**：格式符号不触发、详情页"突然出现很多符号"（版本兼容 bug）。
- **数据迁移焦虑**：备份/还原、合并账号、注销后如何保留数据 → 3 个问题。
- **丢失/隐藏任务**：恢复删除的任务、"任务已隐藏，因为日历中未显示所属清单"。
- **跨端一致性**：手表（iOS/华为/小米）、一周起始日（mobile/macOS/Windows/Web 四端分别写步骤）。

---

## 4. 更新动态（changelog）

来源：https://help.dida365.com/articles/6950689674532749312 （最后修改 2026-09-16）

### 4.1 「更新动态」页上的近期条目（5 条，均为 2026 年）

| 日期 | 标题 | 要点 |
|---|---|---|
| **2026-09-15** | ✨ 编辑与任务管理体验优化 | ① **编辑体验**：Markdown 编辑时自动隐藏格式符号；新增更多高亮颜色；长内容支持标题折叠/展开。② **分组与排序**：新增按**创建时间分组**，按**创建时间/修改时间排序**（可正序倒序）。③ **其他**：Android/Web 支持**视图多端独立配置**；iOS/Android 支持更小字号（设置→外观→显示→字体大小）。 |
| **2026-06-03** | ✨ 体验升级｜持续提醒、搜索等功能升级 | ① 任务/习惯/纪念日**可分别开启持续提醒**，未处理即持续重复。② **搜索支持按任务/清单/标签筛选**。③ **年视图支持每日任务预览**。④ 模板支持搜索、拖动排序、新增「从模板添加」入口。⑤ **浏览器标签页显示专注时长**（网页端）。 |
| **2026-04-29** | 滴答清单✖️AI｜让任务管理更智能 🚀 | ① **滴答清单 MCP**：可连接 ChatGPT、Claude 等 AI 工具直接管任务。② **AI 语音添加**（新增「AI 模式」，自动识别时间/清单/标签/优先级并拆分多任务，**仅移动端**）。③ **AI 录音总结**：录音转写原文 + 一键结构化总结。 |
| **2026-03-09** | 倒数纪念日体验优化｜记录更加灵活 ✨ | ① 新增**天数计算方式**（标准 / 标准+1 天）。② 新增**自定义重复**（每年 X 月第 X 个星期几、每月 X 日）。③ 新增**备注**。④ PC 端新增习惯桌面小部件。⑤ 日历支持自定义图标显示。⑥ iOS 与电脑端支持**暗色主题**。 |
| **2026-01-08** | **8.0 重磅更新**｜任务与日历体验全面升级 🚀 | ① 全新**推荐任务**（「今天」清单）。② **个性化清单背景**（仅手机端）。③ 全新**年视图 + 热力图**。④ **月视图双指缩放**（仅移动端）。⑤ 日历显示设置优化（颜色集中配置、习惯/纪念日配色；新增「现代」样式）。⑥ 电脑端新增**卡片样式**界面。 |

### 4.2 年度归档（「更新动态」页底部「更多」）

| 归档 | URL | 条数 | 覆盖区间 |
|---|---|---|---|
| 2025年更新 | https://help.dida365.com/external/articles/7505894191243722752 | 7 | 2025-01-15 → 2025-10-30 |
| 2024年更新 | https://help.dida365.com/external/articles/7301066376716746752 | 13 | 2024-01-10 → 2024-10-30 |
| 2023年更新 | https://help.dida365.com/external/articles/7155122706650759168 | 14 | 2023-01-10 → 2023-12-05 |

**2025 年条目一览**（标题 + 日期）：

| 日期 | 标题 | 要点 |
|---|---|---|
| 2025-10-30 | 界面焕新 🆕 更通透、更顺眼 | iOS 26 视觉焕新；Android 自定义暗色主题；番茄专注时间记录体验优化 |
| 2025-09-15 | 适配 iOS 26 ✨ 全新持续提醒 ⏰ | iOS 26 适配 + 持续提醒 |
| 2025-07-31 | 🍅 专注记录更灵活，操作体验再进阶！✨ | 专注记录体验升级；电脑端 Alt 功能；取消关联主任务；链接编辑更顺手 |
| 2025-06-30 | ⏳ 倒数纪念日｜体验再升级！ | 支持设置计时方式（倒计时/正计时）；生日显示岁数；切换天/周/年显示；支持显示分组 |
| 2025-05-14 | 🎉 倒数纪念日｜全新模块，重磅上线！ | 倒数纪念日模块从 0 上线（天数显示/准时提醒/丰富样式/同步展示） |
| 2025-03-25 | 多维升级！📅日历更全面，🔒安全更强 | Apple 健康数据导入日历；桌面端日历批量操作；**支持双重验证**；关联 Notion 新增标签/优先级同步 |
| 2025-02-28 | 重磅新体验💣跨平台工作更加无缝 | **关联 Notion**（双向同步）；其他更新 |
| 2025-01-15 | 高效新细节！提醒与重复更加强大！⏰ | 时间段任务支持结束时提醒；支持农历每月重复；默认时间段增加自定义选项 |

**2024 年条目一览**（13 条）：
2024-10-30 新的颜色主题/日历显示完成框/日历辅助时区｜2024-10-15 全新周视图（格子样式）｜2024-09-16 适配 iOS 18（控制中心控件、色调模式、watchOS 11）｜2024-08-31 任务全流程优化（添加任务、自定义重复、删除分组、评论、日历拖动）｜2024-07-02 **桌面端 6.0**（任务与日历并列、日程视图、输入体验升级：Shift+回车添加描述、编辑菜单、斜杠菜单；习惯模块全新视觉/日期筛选）｜2024-05-28 **任务与 Google 日历双向同步**｜2024-04-22 iOS 实时活动、Windows Mini 日历、Android 平板看板多栏、Mac ⌘+K 指令菜单｜2024-03-05 平板 UI 优化、Apple Watch 升级、日历长按操作、移动整个分组、Android 通知自定义｜2024-01-25 指派人分组、过滤器支持"下月"、时间线优先级分组；任务右键"清除日期"、Windows 便签支持开始专注｜2024-01-10 看板视图支持调整尺寸、支持自定义颜色

**2023 年条目一览**（14 条）：
2023-12-05 Windows 新体验（专注 mini 窗口、独立窗口、自定义字体）｜2023-11-15 **桌面端 5.0**（全新多日/多周视图、日历浏览、添加清单体验）｜2023-11-08 **移动端 7.0**（任务弹窗样式、详情菜单自定义、日历列表视图时间轴、月视图上下滑动、提醒弹窗、番茄专注）｜2023-09-28 macOS 14.0 桌面小组件、watchOS 10 智能堆栈｜2023-09-19 iOS 17（可交互小组件、StandBy、iPad 锁屏小组件）｜2023-07-24 专注多端同步（白噪音优化、木鱼）｜2023-07-04 小组件追踪单个习惯周进度｜2023-06-28 **看板视图重新设计**｜2023-06-05 专注悬浮窗（12/24 小时制、iOS 分享背景样式、Windows 通知详情开关）｜2023-04-18 排序大升级｜2023-04-01 移动端添加任务直接输入描述、移动任务到分组、实时搜索｜2023-02-15 桌面便签升级｜2023-02-08 常用专注上线｜2023-01-28 已完成任务划线样式、隐藏侧边栏数字｜2023-01-10 专注体验升级（桌面端专注模块、移动端像素时钟、tab 排序、习惯在时间轴中显示）

### 4.3 迭代节奏判断

| 年份 | 公开的更新条目数 | 节奏 |
|---|---|---|
| 2023 | 14 | 约每月 1.2 次 |
| 2024 | 13 | 约每月 1.1 次 |
| 2025（1–10 月） | 7 | 约每月 0.7 次 |
| 2026（1–9 月） | 5 | 约每月 0.55 次 |

**近期重点（2026）**：**AI 化（MCP / AI 语音 / AI 录音总结）**、**提醒可靠性（持续提醒）**、**编辑与整理体验（Markdown、分组排序、模板）**、**倒数纪念日模块补齐**、**8.0 大版本的结构与视觉升级**。
→ **推断**：功能从"广度铺开"转向"AI 能力 + 编辑/整理细节打磨"，大版本（8.0）承担结构性升级，小版本做体验微调。

---

## 5. 下载页：完整平台清单与分发方式

来源：https://www.dida365.com/download （页面文案来自 JS chunk `chunks/6370-*.js` 的 `zh_cn`/`en_us` i18n 与平台配置数组 `V`）

### 5.1 `/download` 页面上展示的 7 个平台

| # | 平台 | 展示标题（中文 / 英文） | 分发方式 | 实际目标 / 动作 |
|---|---|---|---|---|
| 1 | iOS / iPadOS | iOS & iPadOS | **扫码下载**（`scan_to_download`） | `https://apps.apple.com/cn/app/id626144601`（非 CN：`https://apps.apple.com/app/id626144601`），带 `ct`/`pt=544309` 归因参数 |
| 2 | Android | Android | **扫码下载** | CN 站：站内 `/static/getApp`；非 CN：`https://play.google.com/store/apps/details?id=com.ticktick.task` |
| 3 | HarmonyOS | HarmonyOS | **扫码下载**（仅 CN 站有此项） | `https://appgallery.huawei.com/app/detail?id=cn.ticktick.task.hm`（华为应用市场） |
| 4 | Windows | Windows | **直接下载** + 「了解更多」 | 弹窗二选一：`/static/getApp/download?type=win`（32-Bit）/ `?type=win64`（64-Bit）；另有 UA 自动探测走 `?type=win_arm64`；「了解更多」→ `/windows`；文案标注 **"15天免费试用"** |
| 5 | macOS | macOS | **弹窗二选一** + 「了解更多」 | `Mac App Store` → `https://apps.apple.com/cn/app/id966085870`；`下载安装包` → `/static/getApp/download?type=mac`；「了解更多」→ `/about/mac` |
| 6 | Linux | Linux | **弹窗选择格式 × CPU 架构** | 格式 `deb` / `rpm` / `AppImage` × 架构 `x64` / `arm64` → 六个下载地址：`/static/getApp/download?type=linux_{deb,rpm,appimage}_{x64,arm64}`；按钮文案 **"下载 Beta 版本"**；deb 适用于麒麟/UOS/Ubuntu/Deepin，rpm 适用于 CentOS/Fedora |
| 7 | Extension（插件） | 插件 / Extension | **弹窗商店 + 安装文件** | Chrome：CN 站先弹二级菜单（`Chrome 扩展商店` → `chrome.google.com/webstore/detail/ticktick-todo-task-list/diankknpkndanachmlckaikddgcehkod`；`下载安装文件` → `https://cdn.dida365.cn/download/chrome_extension/dida.zip`）；非 CN 直接跳商店。Edge：`https://microsoftedge.microsoft.com/addons/detail/ticktick-todo-task-li/mdkekgdakdomdpefbfibhjimhinfgfkb`。Firefox：`https://addons.mozilla.org/firefox/addon/ticktick-todo/`。Gmail：`https://gsuite.google.com/marketplace/app/appname/1046514147108`。**安装指南** → https://help.dida365.com/articles/7351502985995747328#安装 |
| — | Web 应用 | Web / 网页版 | **直接打开** | 页面首行文案里的链接：`/webapp`（已登录）或 `/signin`；i18n `download_to_web` = "打开网页版" |
| — | 移动端底部 | 「立即下载 / 更多平台」 | 按 UA 自动分发 | 底部按钮按 UA 判定 iOS/Android/HarmonyOS/macOS/Windows/Linux 后跳对应下载；「更多平台」弹窗把上面 7 个平台纵向再列一次 |

### 5.2 站内 i18n 里存在、但 `/download` 页面**未列出**的平台（常见于首页下载区块 / 其他入口）

| 平台 | i18n key | 说明 |
|---|---|---|
| Android 智能手表 | `download_android_wear_title` | "在腕间添加与查看任务" |
| Apple Watch | `download_ios_wear_title` | "在腕间添加与查看任务" |
| Outlook 邮箱插件 | `download_outlook_title` | "一键将任意邮件变成任务" |
| Gmail 邮箱插件 | `download_gmail_title` | "将任意邮件保存到收集箱" |
| Mac App Store | `mac_app_store` | 见上表 macOS |
| Linux Snap Store | `linux_snap_store` | i18n 有文案，但当前 config 只给 deb/rpm/AppImage，**Snap 未在下载弹窗中提供**（未核实是否为历史遗留） |

### 5.3 版本号 / 系统要求

- **未核实**：`/download`、`/windows`、`/about/mac` 三个页面**均未标注任何版本号、构建号、最低系统版本或架构要求**。
  - `/download` 只写 "15天免费试用"（Windows）。
  - `/windows` 只列 64-bit / ARM64 / 32-bit 三个下载按钮与功能卖点。
  - `/about/mac` 只列 Mac App Store / Download for Mac 与功能卖点。
- 尝试过的 URL：`/download`、`/windows`、`/mac`、`/about/mac`、`/features`、`/home` —— 均无版本号字段。
- 可间接推断：Windows 提供 32-bit / 64-bit / ARM64；macOS 走 App Store（id966085870）+ dmg；Linux 明确 `deb`/`rpm`/`AppImage` × `x64`/`arm64`。

---

## 6. 定价页：完整逐项对比表

来源：https://www.dida365.com/upgrade （**对比表是服务端渲染在 HTML 里的**，中英文内容完全一致；价格来自 `pageProps.priceInfo`）

### 6.1 价格档位（中国大陆站 dida365.com）

| 档位 | 价格 | 来源 |
|---|---|---|
| 免费 | **￥0** | 页面 Free 卡片 |
| 高级会员 · 年付 | **￥139 / 年**（页面脚注：「一年高级会员只需￥139（每月仅￥11.6）」） | `priceInfo.orderSpec[0] = {count:1, unit:"year", amount:139}` |
| 高级会员 · 月付 | **￥16 / 月** | `priceInfo.orderSpec[1] = {count:1, unit:"month", amount:16}` |
| 高级会员 · **连续包月（订阅）** | **￥13.9 / 月**，渠道：`alipay`（支付宝）、`wxpay`（微信支付） | `priceInfo.subscribeSpec = [{type:"alipay",price:"13.9",freq:"monthly"},{type:"wxpay",price:"13.9",freq:"monthly"}]` |
| 教育优惠 | **高级会员 七五折（75 折）**；需 `edu.cn` / `csss.cn` / `ucas.ac.cn` 教育邮箱 | https://www.dida365.com/education |
| 礼品卡 | **电子卡**，按 `%s年会员电子卡` 售卖；单次最多购买 **50** 张；每张**仅可兑换一次、购买后 1 年内有效、不支持退款和交换** | https://www.dida365.com/card |

> 你提到的"英文页显示 ￥139/Year"——**属实，且中文页也是 ￥139/年**。两个语言版本共用同一 `orderSpec`，差异只在文案。

### 6.2 国际版对照（TickTick）

| 项 | DIDA（dida365.com，中国大陆） | TickTick（ticktick.com，国际） |
|---|---|---|
| 免费 | ￥0 | US$0 |
| 年付 | **￥139 / 年** | **US$49.99 / 年**（约 US$4.17/月） |
| 月付 | ￥16 / 月 | **US$4.99 / 月** |
| 连续订阅渠道 | 支付宝、微信支付 | **PayPal、Stripe** |
| 退款政策 | 微信/支付宝购买可 14 天内退款；App Store 需联系 Apple | **Google Play / PayPal / Stripe 均可 14 天内退款**；App Store 联系 Apple |
| 订阅取消 | 页面 FAQ 中**无「如何取消订阅」问题**（仅退款/发票/到期） | **有**「How do I cancel my subscription?」 |
| Premium 卖点措辞 | **微信提醒**（WeChat Reminder） | **邮件提醒**（Email Reminder） |
| 页脚 | Products / Support / Resources / About / Legal | 多出 **Resources → Productivity Guides、Referral Program、Integrations**，**About → About Us**，**Legal → Security** |

### 6.3 逐项对比表（免费 vs 高级会员）

来源：`/upgrade` 服务端渲染的 `comparisonRow_*` DOM；中英文行数与数值**逐项一致**。

#### Essentials（基础额度）

| 项目（中文 / 英文） | 免费 | 高级会员 |
|---|---|---|
| 清单数量 / List Count | **9** | **299** |
| 任务&笔记数量 / Task & Note Count | **99 个/清单** | **999 个/清单** |
| 附件数量 / Attachment Count | **1 个/天** | **199 个/天** |
| 检查事项数量 / Checklist Item Count | **19 个/任务** | **199 个/任务** |
| 任务提醒数量 / Task Reminders | **2** | **5** |
| 共享成员数量 / Member Count | **2** | **29** |
| 习惯数量 / Habit Count | **5** | **299** |
| 纪念日数量 / Countdown Count | **5** | **299** |

> 注：表格 tooltip 明确「清单数量」不含已归档清单、「任务&笔记数量」不含已完成任务。
> 另注口径冲突：**免费额度在官方 FAQ 里写作「附件每个 10 MB / 高级 20 MB」**（帮助中心常见问题正文），
> 而定价页只给"每天个数"。共享成员数同理：定价页写免费 2 人，**FAQ 正文写"免费用户的共享清单只可加入 1 位共享成员"** —— 两处不一致。

#### Task（任务能力）组

| 项目（中文 / 英文） | 免费 | 高级会员 |
|---|---|---|
| 优先级 / Priority | ✅ | ✅ |
| 标签 / Tag | ✅ | ✅ |
| 子任务 / Subtask | ✅ | ✅ |
| 重复任务 / Recurring Task | ✅ | ✅ |
| 评论 / Comment | ✅ | ✅ |
| 模板 / Template | ✅ | ✅ |
| 时间段 / Duration | ❌ | ✅ |
| 持续提醒 / Constant Reminder | ❌ | ✅ |
| 检查事项提醒 / Checklist Item Reminder | ❌ | ✅ |
| 清单/任务动态 / List/Task Activities | ❌ | ✅ |
| 过滤器 / Filter | ❌ | ✅ |
| AI 功能 / AI Features | ❌ | ✅ |

#### Features（功能）组

| 项目（中文 / 英文） | 免费 | 高级会员 |
|---|---|---|
| 日历视图 / Calendar View | **基础** | **无限制** |
| 时间线视图 / Timeline View | ❌ | ✅ |
| 第三方关联 / Integrations | ❌ | ✅ |
| 四象限 / Eisenhower Matrix | **基础** | **无限制** |
| 小组件 / Widgets | **基础** | **无限制** |
| 外观主题 / Themes | **基础** | **无限制** |
| 数据统计 / Statistics | **基础** | **无限制** |
| 更多功能 / And more | ❌ | ✅（带锚点链接） |

### 6.4 定价页 FAQ（中英文不同的那部分）

| 问题 | 中文页 | 英文页（dida365.com/upgrade） |
|---|---|---|
| 退款 | 微信/支付宝 14 天内；App Store 联系 Apple | 同左（英文文案），但 **i18n 里另有 `upgrade_faq_refund_tick`**："Google Play、PayPal 或 Stripe 购买可 14 天内退款" |
| 发票 | 微信/支付宝支付，可申请/查看/下载近一年电子发票 | Invoice 问题同样存在（中文页保留） |
| 取消订阅 | **无此条** | **`upgrade_faq_cancel_question` 存在于 i18n，但 dida365 页面未渲染该条**（ticktick.com 有） |
| 到期后数据 | 数据完整保留，可继续作免费用户 | 同左 |

### 6.5 套餐卡片卖点文案（中英对照）

| 位置 | 中文 | 英文 |
|---|---|---|
| Free 卡片 | 9 个清单，每个清单 99 条任务 / 列表&看板视图 / 智能识别 / 任务提醒 / 多端同步 | 9 Lists, 99 Tasks per list / List & Kanban Views / NLP / Task Reminders / Cross-Platform Sync |
| Premium 卡片 | 299 个清单，每个清单 999 个任务 / 任务时间段 / **微信提醒** / 丰富的外观主题 / 更多功能 | 299 Lists, 999 Tasks per list / Task Duration / **WeChat Reminder** / Themes / And more |
| 顶部三个卖点 | 全平台 / 多重日历视图 / 10 倍扩容 | All Platforms / Multiple Calendar Views / Enjoy 10x Capacity |

---

## 7. 站点导航与页脚结构

来源：https://www.dida365.com/home、`/features`、`/download`、`/upgrade`、`/education`、`/card`、https://help.dida365.com/
（每页顶部/页脚 HTML 完全一致）

### 7.1 顶部导航

| 中文站（dida365.com） | 英文站（dida365.com） | 目标 URL |
|---|---|---|
| 功能介绍 | Features | `/features` |
| 下载应用 | Download | `/download` |
| 高级会员 | Pricing | `/upgrade` |
| 帮助中心 | Help Center | `https://help.dida365.com` |
| 登录 | Sign In | `/signin` |
| **创建免费账号** | **Sign Up for Free** | `/signup` |

> 帮助中心页面自身的顶部导航**多了「帮助中心」**（指向 `/`）且顺序为：创建免费账号 / 登录 / 帮助中心 / 高级会员 / 下载应用 / 功能介绍。
> TickTick 国际站顶部导航多一个 **`Resources` 下拉**：Help Center（`https://help.ticktick.com`）+ Productivity Guides（`/resources`）。

### 7.2 页脚（中文站）

| 分组 | 条目 | URL |
|---|---|---|
| **产品** | 功能介绍 | `/features` |
| | 下载应用 | `/download` |
| | 高级会员 | `/upgrade` |
| | 教育优惠 | `/education` |
| | 礼品卡 | `/card` |
| **帮助** | 帮助中心 | `https://help.dida365.com` |
| | FAQ | `https://help.dida365.com/articles/6950670128287580160` |
| | 联系我们 | **无 href**（`<a>` 无链接，由 JS 处理；帮助中心页脚里出现过 `https://dida365.com/v3/tickets/?lang=zh_cn`，HTTP 200） |
| **资源** | URL Scheme | `https://help.dida365.com/articles/7119949066221387776` |
| **团队** | 媒体素材 | `https://cdn.dida365.cn/download/press.zip`（**直接下 zip，无 HTML Press 页**） |
| **法律** | 使用条款 | `/about/tos` |
| | 隐私声明 | `/about/privacy` |
| | 开源协议 | `/about/license/web` |

语言切换：**中文 / English**（按钮，非链接）。
其他页脚元素：微博 `https://weibo.com/ticktickteam`、微信二维码「搜索"滴答清单"公众号」、备案信息
「© 2026 杭州随笔记网络技术有限公司 浙ICP备12005180号-3」「浙公网安备 33010602005056号」。

### 7.3 页脚（英文站，dida365.com）

| 分组 | 条目 | URL |
|---|---|---|
| **Products** | Get Started | `/features` |
| | Download | `/download` |
| | Pricing | `/upgrade` |
| | Education | `/education` |
| | Gift Cards | `/card` |
| **Support** | Help Center | `https://help.dida365.com` |
| | FAQ | `https://help.dida365.com/articles/6950670128287580160` |
| | Contact Us | 无 href |
| **Resources** | URL Scheme | `https://help.dida365.com/articles/7119949066221387776` |
| **About** | Press | `https://cdn.dida365.cn/download/press.zip` |
| **Legal** | Terms | `/about/tos` |
| | Privacy | `/about/privacy` |
| | License | `/about/license/web` |

> ⚠️ 注意英文字面差异：中文分组叫「**团队**」、条目叫「媒体素材」；英文分组叫「**About**」、条目叫「Press」——**指向同一个 press.zip**。

### 7.4 页脚（TickTick 国际站，ticktick.com）— 更完整的对照

| 分组 | 条目 | URL |
|---|---|---|
| Products | Get Started / Download / Pricing / Education / Gift Cards | `/features` `/download` `/upgrade` `/education` `/card` |
| Support | Help Center / FAQ / Contact Us | `https://help.ticktick.com`、`https://help.ticktick.com/articles/7055792921664028672` |
| Resources | URL Scheme | `https://help.ticktick.com/articles/7055781515422072832` |
| | **Referral Program** | `/refer` |
| | **Integrations** | `/integrations` |
| About | **About Us** | `/about` |
| | Press | `https://download.ticktick.app/download/press.zip` |
| Legal | Terms / Privacy / License / **Security** | `/about/tos` `/about/privacy` `/about/license/web` **`/about/security`** |

社交：X `https://x.com/intent/user?screen_name=ticktickteam`、Reddit `https://www.reddit.com/r/ticktick/`、
YouTube `https://www.youtube.com/@GetTickTick`、Instagram `https://www.instagram.com/ticktickapp`。
语言：简体中文 / 日本語 / Français / 한국어 / Pусский / 繁体中文 / Português (Brasil) / English（**8 种**，而 dida365 只有中英 2 种）。

### 7.5 你点名的几个页面，逐一核实

| 页面 | 是否存在 | URL | 备注 |
|---|---|---|---|
| 登录 | ✅ | `/signin`（重定向入口还有 `/signon`） | SPA |
| 注册 | ✅ | `/signup` | SPA |
| 教育优惠页 | ✅ | `https://www.dida365.com/education` | 75 折，教育邮箱 `edu.cn`/`csss.cn`/`ucas.ac.cn`；三步流程：教育邮箱注册登录 → 申请并验证 → 通过验证邮件专属链接购买 |
| 礼品卡页 | ✅ | `https://www.dida365.com/card` | 正文客户端渲染；支持"送给自己/企业团购"或"送给他人"，可填接收人姓名/邮箱/留言，含标准/节日/圣诞/生日/新年卡片种类 |
| Press 页 | ❌（无 HTML 页） | — | 只有 `https://cdn.dida365.cn/download/press.zip` 一个压缩包；国际版为 `https://download.ticktick.app/download/press.zip` |
| URL Scheme 文档 | ✅ | `https://help.dida365.com/articles/7119949066221387776` | 同时是「🔜 快捷指令」文章；**同一页里既有 iOS 快捷指令教程，也有 URL Scheme 参考** |
| 服务条款 | ✅ | `/about/tos` | 标题《使用条款》 |
| 隐私政策 | ✅ | `/about/privacy` | 标题《隐私声明》，更新日期 **2026-07-09** |
| 开源许可 | ✅ | `/about/license/web` | 标题《开源协议》，约 24 万字符 |
| Security 页 | ❌（dida365 无） | — | 仅国际版有 `/about/security`（登录页文案里也引用了 `/about/security`） |
| About Us 页 | ❌（dida365 无） | — | 仅国际版有 `/about` |

### 7.6 URL Scheme 文档摘要（供做兼容/互操作参考）

来源：https://help.dida365.com/articles/7119949066221387776

- 通用格式：`ticktick://v1/{command}?p1=v1&p2=v2`
- **添加任务**：`ticktick://x-callback-url/v1/add_task?...&x-success={{scheme}}`，支持 `x-success` / `x-error` / `x-cancel` 回调
  - 参数：`title`（必填）、`startDate`、`endDate`（`2018-05-07T18:00:00.000+0000` 带时区 / `...T18:00:00.000` 不带时区按设备时区解析）、
    `allDay`（true/false，startDate 或 endDate 有值时必填）、`priority`（0/1/3/5）、`content`、`list`（默认 `inbox`）、`subtasks`
  - 成功后回调参数：`title`、`taskID`
- **显示**：`ticktick://v1/show?smartlist=today`，`smartlist` 取值 `all` / `today` / `tomorrow` / `next_7_days` / `assign_to_me`
- **搜索**：`ticktick://v1/search?keyword=...`

---

## 8. 登录 / 注册页：可用的登录方式

**抓取限制说明**：`https://www.dida365.com/signin` 与 `/signup` 返回的是**旧版 SPA 空壳**（HTML 仅 5,513 字节，正文完全由 JS 渲染），
`web_fetch` 只拿到 `<title>登录 - 滴答清单</title>`。因此下面的结论来自两个**可核实的替代来源**：

1. 帮助中心《注册与登录》文章：https://help.dida365.com/articles/6950691508324401152
2. 登录页真实加载的前端 bundle 内的 i18n 文案：
   `https://cncdn.dida365.com/web/static/build/sites/userSign/bundle.ap-7736874496760f7ec4d3.js`
   （以及 `.../9956/bundle.ap-e98e5ec3416bdef4e57e.js` 中的 `zh_cn` 模块 83596）

### 8.1 注册方式（3 种）

| 方式 | 说明 |
|---|---|
| **手机号** | 填写短信验证码完成注册（i18n：`phone_signup`「手机号注册」、`verification_code`「手机验证码」、`toast_code_sent`「验证码已发至手机 %s」） |
| **邮箱** | 点击邮件链接验证完成注册（i18n：`email_signup`「邮箱注册」、`email_verifiy`「Email Verify」、`sign_invalid_email`「邮箱格式不正确」） |
| **第三方账号** | **微信、微博、QQ、Apple ID**（帮助中心原文：「你可以使用通过微信、微博、QQ、Apple ID 快捷注册进行登录。」） |

### 8.2 登录页实际出现的入口（bundle 文案核实）

| 按钮 / 字段 | 中文文案 | 英文文案 | 备注 |
|---|---|---|---|
| 主输入框 | 手机号或邮箱 | Phone Number / Email | `phone_email` |
| 获取验证码 | 发送验证码 / %d秒后重发 | Send / Resend %ds | `send` / `resend` |
| 图形验证码 | 图形验证码 | Captcha Code | `captcha_code`；另有 `turnstile_load_failed_hint` → 使用 **Cloudflare Turnstile** |
| 手机验证码 | 手机验证码 | Verification code | `verification_code` |
| 密码 | 密码 / 密码确认 | Password / Confirm Password | `password` / `confirm_password`；规则 6–64 字符 |
| 登录 | 登录 | Sign in | `login_login` |
| 注册账号 | 注册账号 / 创建免费账号 | Sign up | `login_signup` / `sign_up_free` |
| **忘记密码** | **忘记密码** | **Forgot Password** | ✅ 存在；重置入口 `/sign/requestRestPassword`，支持邮箱重置链接或手机短信验证码 |
| **其他方式登录** | **其他方式登录 / 使用第三方账户登录** | Sign in with / Sign up with | `sign_in_with_others` |
| 微信 | **微信** | WeChat | `sign_in_with_wechat`；还支持「Switch to WeChat Verification」/「Use WeChat to scan the QR code」扫码登录 |
| 微博 | **微博** | Weibo | `sign_in_with_weibo`（有 enable 开关 `getIsWeiboEnable`） |
| QQ | **QQ** | QQ | `sign_in_with_qq` |
| **Apple** | **Apple 登录** | **Sign in with Apple** / Sign up with Apple | `continue_with_apple` ✅ |
| **Google** | **Google 登录** | **Continue with Google** | `continue_with_google` ✅ |
| 更多 | 更多登录方式 / 更多注册方式 | More | `more_signin` / `more_signup`（Apple/Google 收在"更多"里） |
| 双重验证 | 双重验证 / 2-Step Verification | 2-Step Verification | `two_factor_authentication` |
| 协议 | 我已了解 TickTick 的隐私申明、安全性、使用条款 | I agree to ToS and Privacy Policy | 链接 `/about/privacy`、`/about/security`、`/about/tos` |
| 跨站提示 | 「切换到 TickTick」 | Switch to TickTick | `switch_to_brother_site` → `https://www.{0}/signin{1}`（dida365 ↔ ticktick 账号体系互通/迁移提示） |
| 安全限制提示 | 密码或用户名错误，今日仅剩 {0} 次尝试 / 账号已被限制登录，24 小时后重试 | Incorrect username or password... / account restricted | 有登录风控 |

其他字段（注册用）：`sign_set_nickname`「昵称（可选）」、`sign_have_an_account_already`「已有账号？」、
`wunderlist_signup_hint`「你需要创建一个 %s 账号，才可导入奇妙清单」（Wunderlist 导入入口仍在）。

### 8.3 登录方式小结

| 登录方式 | 是否支持 | 证据强度 |
|---|---|---|
| 手机号 + 短信验证码 | ✅ | 帮助中心原文 + bundle 文案 |
| 邮箱 + 密码 / 邮件验证 | ✅ | 同上 |
| 微信 | ✅ | 帮助中心原文 + bundle（含扫码） |
| 微博 | ✅ | 帮助中心原文 + bundle（带 enable 开关） |
| QQ | ✅ | 帮助中心原文 + bundle |
| Apple ID | ✅ | 帮助中心原文 + bundle（`Apple 登录`） |
| Google | ✅（bundle 里有 `Google 登录`） | bundle 文案；**但帮助中心《注册与登录》未提及 Google**，且 CN 站是否实际启用未在渲染 DOM 中核实 → **"疑似启用，未在真实页面 DOM 确认"** |
| 找回密码 | ✅ | 帮助中心「忘记密码怎么办？」+ bundle `login_forget_password` |
| 第三方登录解绑 | ✅ | 帮助中心「如何解绑微信或 QQ?」 |
| 设备管理 / 双重验证 | ✅ | 帮助中心「如何管理登录设备？」「双重验证」文章 |

> **未核实**：`/signin` 与 `/signup` 页面的**真实渲染 DOM**（按钮的实际数量与顺序）——需要带 JS 执行的浏览器才能确认；
> 我尝试了 `curl` 抓 HTML、`web_fetch`（无 JS 渲染）、`/signin` 与 `/signup` 两个路径，均只能拿到 SPA 空壳。
> **未核实**：Google 登录在 CN 站是否真的对普通用户开放（bundle 里有文案，但未见渲染结果）。

---

## 9. 汇总：未核实项与尝试过的 URL

| # | 未核实内容 | 尝试过的 URL / 方法 | 原因 |
|---|---|---|---|
| 1 | 帮助中心 `/external/articles/` 命名空间的**完整文章数** | `/sitemap.xml`（仅 18 条，2024-03-28）、首页与 6 个分类页的 `__NEXT_DATA__`（只有 97 篇索引）、搜索框（无公开 JSON API） | 该命名空间没有索引页，只能靠正文反解引用；已反解出 14 个 |
| 2 | 下载页的**版本号 / 系统要求** | `/download`、`/windows`、`/mac`、`/about/mac`、`/features`、`/home` | 页面压根没有这些字段 |
| 3 | 登录/注册页的**真实渲染 DOM** | `curl` + `web_fetch` 抓 `/signin`、`/signup`、`/signon` | SPA 空壳，正文由 JS 渲染；结论改由 bundle i18n + 帮助中心文章交叉验证 |
| 4 | **Google 登录**在 CN 站是否启用 | `/signin` bundle 文案（有 `Google 登录`） | 有文案 ≠ 已开放；需真实渲染确认 |
| 5 | 价格页**英中差异**是否包括币种差异 | `https://www.dida365.com/upgrade`（zh/en 各抓一次）、`?language=zh_cn` / `?language=en_us` | **中英同价 ￥139/年**（同一 `priceInfo`）；真正的币种差异在 **ticktick.com（US$49.99/年）** |
| 6 | Linux Snap 包是否仍提供 | `/download` 的 `linux_snap_store` i18n vs 平台配置数组 | i18n 有文案，但下载弹窗只实现 deb/rpm/AppImage |
| 7 | 帮助中心是否有**独立搜索 JSON API** | 在首页 HTML 与 30+ 个 chunk 中检索 `search`/`api` 端点 | 未找到；首页搜索框行为未核实 |

## 10. 对做竞品/IA 参考最有价值的三点

1. **帮助中心是"两套内容池"**：97 篇可枚举索引（`/articles/`）+ 不可枚举的外部池（`/external/articles/`）。
   后者装的是长尾用例、年度归档、历史功能页（外观、手表、实用模板），**且大量"最佳实践"直接外链到微信公众号与 B 站**——
   说明其社区内容运营与产品文档是**分离**的，产品文档只负责"能不能用"，方法论内容外包给 UGC/自媒体。
2. **FAQ 是最诚实的痛点地图**：67 问里，容量/付费边界、移动端提醒可靠性、日历订阅踩坑、编辑器兼容、数据迁移反复出现；
   并且**定价页与 FAQ 的额度口径不一致**（共享成员 2 vs 1；附件只给个数不给大小）。
3. **更新节奏在放缓但方向明确**：2023→2026 公开条目从 14 降到 5（半年口径），
   2026 的重点是 **AI（MCP / AI 语音 / AI 录音）** 和 **编辑整理细节**，8.0 承担结构性升级。
   向下兼容资产是 **URL Scheme（ticktick://）** 与 **MCP/CLI** 两条自动化通道。
