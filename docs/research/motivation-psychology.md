# 习惯养成与激励机制的心理学依据（调研）

> 调研日期：**2026-09-26**。检索工具：AnySearch 实时检索（结果附 URL）。
> **本文只给证据，不下设计结论。** 设计结论应落在 `docs/plans/` 下一份独立的设计文档里
> （⚠️ **该文档尚未撰写** —— 截至 2026-09-26，`docs/plans/` 只有
> [`roadmap.md`](../plans/roadmap.md)、AI 线与两个阶段计划，没有激励/留存的设计文档。
> 本文的证据目前**没有对应的设计落点**，这是一个真实的缺口，不是链接写错了）。
> 竞品机制事实见本文 §6；若 §6 与结论层冲突，**以 §6 的事实与来源为准**。

## 证据强度标记

| 标记 | 含义 |
|---|---|
| ✅ | 有同行评审的实证或元分析支撑 |
| 🟡 | 业界广泛采用 / 二手转述，**原始出处未逐条核实** |
| 🔴 | 未能找到可靠来源，或存在互相矛盾的证据 |

---

## 0. 结论速览（7 条）

1. **打卡动作本身不产生动机。** 行为要发生需要 `动机 × 能力 × 提示` 三者同时到位（Fogg B=MAP）；
   而"做完一件事之后看见自己前进了一格"才是让人明天还回来的东西。今天的 heyta 有动作（打卡），
   缺的是**提示**与**做完之后的反馈**。
2. **连续性（streak）是现有最强的留存杠杆，也是最容易反噬的。** 它的驱动来自损失厌恶；
   而它的悬崖来自**全或无思维**——一次中断会让用户产生"反正已经废了"的放弃效应
   （abstinence violation effect）。修法不是取消 streak，而是**让中断不等于归零**。
3. **外部奖励会挤掉内在动机**（过度理由效应）。所以做"胜任 / 自主 / 归属"，**不做金币经济**。
4. **进度必须被看见，而且越快接近终点越要显得快**（目标梯度效应）；
   新习惯要给"你已经起步了"的感觉（禀赋进度）。
5. **"在什么时间、什么地点、做完什么之后做这件事"（if-then 计划）是被反复验证的高杠杆动作**，
   平均效应量 Cohen's d ≈ 0.65。它几乎不需要新功能，只需要在打卡流程里问一句话。
6. **正反馈的最小单位是"我推进了什么"，不是"我拿到了什么"**（小胜原则）。
   复盘应当是**关于工作本身的叙事**，不是关于积分的账本。
7. **排行榜与 heyta 的定位冲突，且证据不站在它那边。** 排行榜会触发"能力型社会比较"，
   与感知压力正相关；这与 [`feature-matrix.md` §11 明确不做的（反需求）](feature-matrix.md) 的判断一致。

---

## 1. 行为模型层：一次行为为什么会 / 不会发生

### 1.1 Fogg 行为模型（B = MAP）✅

**内容**：任何行为（B）的发生，需要动机（Motivation）、能力（Ability）、提示（Prompt）
**在同一时刻**同时到位。动机高但提示缺失，行为依然不发生；提示在但能力门槛太高（操作复杂），也不发生。

来源：[behaviormodel.org](https://www.behaviormodel.org/)、
[Stanford Behavior Design Lab](https://behaviordesign.stanford.edu/resources/fogg-behavior-model)、
[The Fogg Model](https://www.habitweekly.com/models-frameworks/the-fogg-model)

**对本产品的含义**：用户"没坚持"的归因通常是错的。真实原因经常是**提示没到**，
而不是意志力不够。产品能做的是把 prompt 做对（在对的时刻、以对的形式出现），
以及把能力门槛压到最低（一次点击完成打卡，而不是"打开 App → 找到习惯 → 点进详情 → 选择日期 → 提交"）。

### 1.2 Hooked 模型（触发 → 行动 → 变动奖励 → 投入）🟡

**内容**：形成习惯回路的产品都跑通四步——外部触发逐渐内化成内部触发；
把行为简化到极致；给予**变动**的奖励；让用户投入（投入本身又成为下一次触发的资产）。

来源：[Nir Eyal — How to Manufacture Desire](https://www.nirandfar.com/how-to-manufacture-desire/)、
[Amplitude — The Hook Model](https://amplitude.com/blog/the-hook-model)

**对本产品的含义**：heyta 目前只跑通了第二步（行动：打卡）。
第一步（触发）弱、第三步（奖励）缺失、第四步（投入）没有回报——用户投入的打卡数据
只是为了留档，没有变成任何"属于他的东西"。这是"感觉像个同步工具"的结构性原因。

### 1.3 实施意图 / if-then 计划 ✅

**内容**：把"我要多做 X"这类**目标意图**，转写成"如果情境 Y 出现，我就执行行为 Z"的
**实施意图**，能显著提升目标达成率。Gollwitzer & Sheeran 的元分析给出的平均效应量
**Cohen's d ≈ 0.65**（中到大效应）。效应在**自控资源紧张时更强**，也更强于有明确情境线索时。

来源：[Gollwitzer, *Implementation Intentions*（PDF）](https://cancercontrol.cancer.gov/sites/default/files/2020-06/goal_intent_attain.pdf)、
[Bieleke et al., *If-then planning*（2021）](https://www.tandfonline.com/doi/full/10.1080/10463283.2020.1808936)、
[效应量 d≈0.65 的二手汇总](https://yukaichou.com/gamification-analysis/implementation-intentions-if-then-planning-gollwitzer/)

> ⚠️ 效应量数值来自二手汇总页；元分析原文可及但未逐页核对 → 数值可靠性 **🟡**，机制方向性 **✅**。

---

## 2. 持续性层：为什么坚持不下去，以及断了之后怎么办

### 2.1 习惯形成需要多久 ✅

**内容**：Lally et al. (2010) 的经典结论是**平均约 66 天**接近自动化，个体差异极大，
区间约 **18–254 天**。2024 年系统综述与元分析给出**达到 95% 自动化程度的时长中位数 66 天**，
并指出习惯形成通常需要 **2–5 个月**。

来源：[Time to Form a Habit: 系统综述与元分析（PMC, 2024）](https://pmc.ncbi.nlm.nih.gov/articles/PMC11641623/)、
[Spring.org.uk — 66 Days Is A Rough Average](https://www.spring.org.uk/2024/11/form-habit-66.php)

**含义**：以"天"为单位的进度是**看不到头的**。产品需要时间尺度更短的完成感（今日 / 本周），
以及跨月的长线叙事。同时，"21 天养成习惯"是错的常见说法，不要写进任何文案。

### 2.2 损失厌恶：streak 的动力来源 🟡

**内容**：损失带来的痛苦大于等额收益带来的快乐（常被引用的量级是**约 2 倍**）。
Duolingo 官方博客明确说明其连胜机制正是建立在 **loss aversion** 上。

来源：[Duolingo Blog — The habit-building research behind your Duolingo streak](https://blog.duolingo.com/how-duolingo-streak-builds-habit/)、
[The Psychology Behind Duolingo's Streak Feature](https://www.justanotherpm.com/blog/the-psychology-behind-duolingos-streak-feature)

> "2 倍"是业界对 Kahneman & Tversky 前景理论的常见转述口径，**原始论文中的系数依情境而异** → 🟡。
> 但"损失比收益更重"的方向性结论 ✅。

### 2.3 反噬：全或无思维与"破功后放弃"✅🟡

**内容**：成瘾研究中被称为 **abstinence violation effect**（ abstinence violation effect，Marlatt & Gordon, 1985）——
一次失手会触发"我已经毁了"的认知，进而导致彻底放弃。习惯类产品里同样的机制表现为
**断签即弃用**。业界对应的对策是 **"never miss twice"（绝不错过两次）**：
错过一次几乎不伤害习惯，**连续错过两次才是习惯真正死亡的地方**。

来源：[All-or-Nothing Thinking and Broken Streaks](https://www.myhabitsync.com/guides/all-or-nothing-thinking-broken-streak)、
[Heala — The 2-day rule](https://heala.fit/articles/never-miss-twice)、
[The 2-day rule 引用的 Lally 研究](https://catalystoutsourcing.com/blog/how-to-build-habits-that-stick)

**含义**：这是本设计里**最重要的一条约束**。任何"归零"式的连续计数，都在用户最脆弱的那一天
把他往外推。必须存在"历史最长 / 累计总量"这种**不会被清空**的指标，
以及"今天补回来"的补救路径。

> ⚠️ "连续错过两次"的具体阈值来自业界实践总结（James Clear 等），不是严格实验结论 → 🟡。

### 2.4 目标梯度效应与禀赋进度 ✅

**内容**：
- **目标梯度效应**（Kivetz, Urminsky & Zheng 2006）：动机随"距离目标的感知差距缩小"而上升；
  对同一个人，**心理距离更近时努力更多**。Laws of UX 直接给出实践建议：
  **人为制造的进度**（让用户觉得已经走了一段）会让用户更愿意完成任务。
- **禀赋进度效应**（Nunes & Drèze 2006）：洗车店集章卡，一张"集 8 次"，一张"集 10 次但先送 2 次"——
  两张卡**实际都只需要 8 次**，但**预先赠送 2 格的那张完成率更高、完成得更快**。

来源：[Kivetz et al., The Goal-Gradient Hypothesis Resurrected（PDF, 2006, 被引 1200+）](https://home.uchicago.edu/ourminsky/Goal-Gradient_Illusionary_Goal_Progress.pdf)、
[Laws of UX — Goal-Gradient Effect](https://lawsofux.com/goal-gradient-effect/)、
[Nunes & Drèze, The Endowed Progress Effect](https://www.researchgate.net/publication/23547282_The_Endowed_Progress_Effect_How_Artificial_Advancement_Increases_Effort)

> ⚠️ 禀赋进度的**具体百分比**（常见转述为 34% vs 19%）未在本次检索中核实 → 只使用其方向性结论。

### 2.5 新鲜开始效应 ✅

**内容**：时间地标（新年、生日、月初、周一、学期开始）会让人**更倾向于开始追求有抱负的目标**，
机制是地标把过去的失败与"新的我"在心理上做了切分（Dai, Milkman & Riis 2014, *Management Science*）。

来源：[Dai et al., The Fresh Start Effect（Wharton PDF）](https://faculty.wharton.upenn.edu/wp-content/uploads/2014/06/Dai_Fresh_Start_2014_Mgmt_Sci.pdf)、
[PMC — Temporal Landmarks Spur Goal Initiation](https://pmc.ncbi.nlm.nih.gov/articles/PMC4839284/)

**含义**：周期性的"重新开始"入口是有心理学依据的，不是产品在纵容用户放弃。
它同时也是处理"断签后怎么办"的正规出口：**把断签转化成一个新的开始**，而不是一个失败。

---

## 3. 动机质量层：什么样的激励不会伤害内在动机

### 3.1 自我决定理论（SDT）三需求 ✅

**内容**：内在动机依赖三个基本心理需求的满足——**自主（autonomy）、胜任（competence）、归属（relatedness）**。
游戏化元素正是通过满足或挫伤这三者，来促进或破坏内在动机（沉浸类、成就类、社交类特征
分别对应这三条路径）。

来源：[Enhancing intrinsic learning motivation through gamification: a self-determination theory perspective（IJILT, 2023）](https://www.emerald.com/ijilt/article/40/5/413/134550/Enhancing-intrinsic-learning-motivation-through)、
[SAGE Open（2025）— How Gamification Enhances Learning Effectiveness](https://journals.sagepub.com/doi/10.1177/21582440251385846)

**含义**：一个激励机制必须能回答"它满足了哪条需求"。
- 只加"积分"→ 三条都不满足 → 纯噪声。
- "我做到了别人做不到的"→ 胜任，但过强会变成焦虑。
- "这是我选的、我可以改"→ 自主，**对本地优先 / 数据主权的产品来说是天然优势**。

### 3.2 过度理由效应：奖励会挤掉兴趣 ✅

**内容**：对本来就有内在兴趣的活动给予外部奖励，会**降低**内在动机（Lepper, Greene & Nisbett 1973 起的一系列研究）。
后续研究（Bitter 2022；IJSG 2023 综述）在游戏化语境下继续确认：**游戏化本身就是一种奖励**，
存在削弱内在动机的风险。NTNU 的一篇论文把它表述得更准确：游戏化**既能**通过支持基本心理需求
促进内在动机，**也能**通过挫伤它们来破坏内在动机。

来源：[Does It Pay to Play? Undermining Effects of Monetary Rewards（APA, 2022）](https://tmb.apaopen.org/pub/jbkavq2a/download/pdf)、
[The Fulcrum for Balanced Intrinsic Motivation and Extrinsic Motivation（IJSG, 2023）](https://journal.seriousgamessociety.org/index.php/IJSG/article/download/633/506/3953)、
[NTNU — Impacts of gamification on intrinsic motivation](https://www.ntnu.edu/documents/139799/1279149990/04+Article+Final_camildah_fors%C3%B8k_2017-12-06-13-5355_TPD4505.Camilla.Dahlstr%C3%B8m.pdf/9e48c5f5-0d17-4276-a23e-434abfe65491)

**含义**：这条直接否掉了"金币 / 积分商城"路线。
它也解释了为什么"打卡本身有意义"的用户会在被塞进排行榜之后**变得更不想打卡**。

### 3.3 小胜原则 / 进展原则 ✅

**内容**：Amabile & Kramer 基于大量工作日志的研究结论是：
正向"内在工作生活"最强单一驱动因素是**在有意义的工作上取得进展**；
**小胜**（渐进的前进）是最有力的正向事件。

来源：[HBS — The Progress Principle](https://www.hbs.edu/faculty/Pages/item.aspx?num=40692)、
[AMA — The Worth of Small Wins](https://www.amanet.org/articles/the-worth-of-small-wins-teresa-amabile-and-steven-kramer-on-the-progress-principle/)

**含义**：最好的"奖励"不是解锁一个徽章，而是**让用户清楚地看见自己今天推进了什么**。
徽章只是这个信息的载体，不能替代信息本身。

---

## 4. 社会层：为什么排行榜是个陷阱

### 4.1 排行榜的双面性与压力 ✅

**内容**：一项针对 1019 名大学生的横断面研究（2026）用结构方程模型检验了
"排行榜使用 → 基于能力的**社会比较** → 中等强度身体活动 → **感知压力**"的关联路径。
另一篇 2026 年的研究（*The winner takes it all*）指出：既有文献中排行榜对动机与绩效
"有正向效果 / 无效果"的结论互相冲突，原因之一是**没有区分**比较信息被感知为**激励**还是**威胁**。

来源：[Frontiers in Public Health（2026）— Leaderboard usage and physical activity](https://www.frontiersin.org/journals/public-health/articles/10.3389/fpubh.2026.1794299/full)、
[ScienceDirect（2026）— The winner takes it all](https://www.sciencedirect.com/science/article/pii/S1041608025002122)、
[PubMed 42221644](https://pubmed.ncbi.nlm.nih.gov/42221644/)

**含义**：排行榜不是一个"有用/没用"的问题，而是一个**有人被激励、有人被劝退**的问题。
在动机本就不稳的人群（正在挣扎着建立习惯的人）中，被劝退的那部分往往**正是最需要帮助的人**。
heyta 已把"社交 / 排行榜"列入 §11 反需求，本次调研**支持维持该决定**。

### 4.2 社会支持的替代形态 ✅🟡

**内容**：社会支持与"可问责性"（accountability）被视为影响治疗 / 行为依从性的重要构念，
但被主流依从性模型系统性遗漏（Oussedik et al., 2017）。

来源：[Oussedik et al. — Accountability: a missing construct in models of adherence](https://pmc.ncbi.nlm.nih.gov/articles/PMC5536091/)

**含义**：需要的不是"排名"，而是"**有人知道我在做这件事**"。这在产品上可以表现为
一个不比大小、只做见证的对象（搭子 / 一句留言），而不需要一个榜单。

---

## 5. 反证与风险清单（每条设计都必须回答）

| 风险 | 证据 | 设计必须回答 |
|---|---|---|
| **断签悬崖** | 全或无思维与 abstinence violation effect | 中断后第一屏给什么？ |
| **数字焦虑** | 自我追踪研究指出追踪本身可能带来负面情绪 | 是否允许"只记录不评分"的模式？ |
| **过度理由效应** | Lepper 1973；Bitter 2022 | 这个机制在没有奖励时会怎样？ |
| **新鲜感衰减** | 游戏化 RCT 提示长期效果可能衰减（🔴 证据有限） | 第 30 天的体验和第 3 天有什么不同？ |
| **排行榜劝退** | Frontiers 2026 | 不做排行榜是否够，还是要主动表达"不比"？ |
| **数据裸露** | 本地优先 / E2EE 产品的基本承诺 | 任何激励计算能不能不出本机？ |

### 5.1 行业量级参考（🟡 二手）

健康与健身类 App 的留存基线常被引用为 **D1 ≈ 20–27%、D7 ≈ 7%、D30 ≈ 3%**。
本文只把它当作"**D7 是习惯是否形成的关键关口**"的说明，不当作验收指标；
heyta 没有服务端行为数据（E2EE），这些指标不能直接采集（见设计文档 §7）。

来源：[Lovable — What Is a Good Retention Rate](https://lovable.dev/guides/what-is-a-good-retention-rate-for-an-application)、
[App Retention Benchmarks](https://vmobify.com/blog/app-retention-benchmarks)

---

## 6. 竞品机制事实（逐个产品）

**已展开为独立文档：[`competitor-incentive-teardown.md`](competitor-incentive-teardown.md)**
（Forest / Duolingo / Habitica / Streaks 与 Way of Life / 番茄Todo / 滴答清单 TickTick / 小日常·小打卡·时光序 / Apple Watch 健身记录；
逐个给出机制规则与具体数值 + 心理原理 + 对 heyta 的可迁移性判断 + 汇总表。）

---

## 7. 对 heyta 的约束推论

三条硬约束来自产品自身定位，不是心理学：

| 约束 | 来源 | 直接后果 |
|---|---|---|
| **服务端看不到明文** | [ADR-0005](../adr/0005-ai-data-path.md)、[ADR-0006](../adr/0006-supply-modes.md) | streak、成就、统计**只能在客户端计算**；服务端无法做任何基于行为的推送文案 |
| **没有云端社交图谱** | [`feature-matrix.md` §11 明确不做的（反需求）](feature-matrix.md) | 排行榜、好友 PK、战队副本**结构性不可做**（且不该做） |
| **本地是事实源，云端只是通道** | [`README.md`](../../README.md) 项目原则 3 | 激励数据必须能随数据导出一起带走；**不能有只存在于服务器上的成就** |

反过来看，这三条约束**恰好排除了所有被证据质疑的机制**（排行榜、积分经济、云端推送轰炸），
留下的是：**反馈即时性、连续性韧性、身份叙事、自愿分享**。
设计结论应展开在 `docs/plans/` 下的激励设计文档里 —— **该文档尚未撰写**（见文首说明）。