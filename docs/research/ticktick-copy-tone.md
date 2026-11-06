# 滴答清单文案与语气取证（P6）—— 3 528 条键值，只做统计与结构

> 立项：2026-11-06。独立支线 P6，与 [桌面端逆向取证](ticktick-desktop-teardown-2026-11.md) 同一批本机副本，**只取文案层的量**。
> 授权口径沿用那篇 §1.1 的合规边界：分析对象是本机已安装副本（macOS 8.2.03 已购、Windows 8.2.5.0），
> 不抓他人数据、不代理流量、不登录账号、不重分发产物。
>
> 🔴 **本文没有一句它的 UI 原文。** 全篇是计数、比例、载体形态与族归类；需要举例时写「第 N 类 / 某族」，
> 探针只输出聚数量（长度、布尔、计数），不 `print` 词条内容。除非合规，还有工程上的理由：
> **表达可以看，不可以搬** —— [`THIRD_PARTY_LICENSES.md`](../../THIRD_PARTY_LICENSES.md) 已写明
> heyta 不使用它的商标、图标、文案与界面素材。
>
> 本文**不提工单**。任何一条要落地，先过 heyta 自己的 [`overlay-feedback.md`](../agents/overlay-feedback.md) 与
> [`ux-principles.md`](../agents/ux-principles.md) 的判据。

---

## 0. 六条结论

1. **它的文案单位是「标签」，不是「句子」。** 英文词条中位 **15 字符 / 3 词**，以句号收尾的只有 **18.8%**（665/3 528）；一条最长 **753 字符**，≥200 字符的有 25 条。想在它身上学「语气」，样本单位是短语而不是段落。
2. **问句是稀缺资源：全库只有 93 条以问号收尾（2.6%）。** 而危险动作占掉其中 37 条 —— 问号在它那里几乎等价于「这一步会掉东西」。
3. **危险动作的「档位」不由问号决定，由载体决定。** 115 条决策件 = 动作标签 59 + 疑问句 37 + 后果正文 15 + 勾选 3 + 逐字 1；18 个对象族里 **4 族完全没有疑问/勾选/逐字载体**；最强档（账号，4 条）用 2 个勾选 + 1 条全大写逐字，**一句问句都没有**。
4. **「中文更短」在短标签上不成立。** 字数比中位 0.371（中文确实短），但按 CJK≈2 拉丁字宽折算：英文 1–8 字符桶（789 条）里 **36.2% 的中文比英文更宽**、p95 宽度比 **1.25**；到 65+ 字符桶才降到 **0.85**。⇒ **留白按中文短标签定，换行按英文长句定**，两者不是同一种语言。
5. **流传的「AI 相关文案 267 条」是子串假象**（已由主线在 commit `51b2f7bd2` 更正）。真值 **119**（`ai_` 命名空间 115 + 值里提到 AI 的 25，去重 21）；267 里 152 条与 AI 无关。119 条的结构里 **47.9% 是「结果/进行态」**，不是卖点。
6. **对 heyta 最有用的一件东西**不是任何一句措辞，而是「**动作标签 + 后果句 + 范围词 + 载体**」这个四槽结构；以及「**疑问句只占 2.6%**」这个反例 —— 它证明「确认 = 问句」是一个会漏检的直觉。

---

## 1. 数据与口径

### 1.1 数据源

| 源 | 版本 | 规模 | 备注 |
|---|---|---|---|
| `/Applications/TickTick.app/Contents/Resources/{en,zh-Hans}.lproj/Localizable.strings` | macOS 8.2.03 | 各 **3 528** 键，键集差 **0** | 本文全部分母 |
| 解析产物 `/tmp/rea-lab/out/strings.json`（字段 `en` / `zh`） | 同上 | 3 528 × 2 | 一次性取证产物，**不入仓**（理由同 teardown §1.1） |
| `/tmp/rea-lab/win/ui/resource_stringresource_stringresource.{en-us,zh-cn}.baml` | Windows 8.2.5.0 | en-us 235 KB / zh-cn 234 KB | 只用于 §8 的跨平台交叉核对 |

重建解析产物（本文每条命令都读它）：

```bash
plutil -convert json -o /tmp/en.json "/Applications/TickTick.app/Contents/Resources/en.lproj/Localizable.strings"
plutil -convert json -o /tmp/zh.json "/Applications/TickTick.app/Contents/Resources/zh-Hans.lproj/Localizable.strings"
python3 -c "import json;e=json.load(open('/tmp/en.json'));z=json.load(open('/tmp/zh.json'));json.dump({'en':e,'zh':z},open('/tmp/rea-lab/out/strings.json','w'),ensure_ascii=False)"
```

> ⚠️ 这条**会覆盖**共享的 `strings.json`。共享件与 plutil 直出版本差在 **170 个键**的引号转义（`\"` vs `"`），**所有值相同**；
> 所以本文全部「按值」的统计不受影响，而「按键」的三项（§2.1）在两种解析下差 0–2 条，已在文中标注。

### 1.2 三个口径（先说清，否则数字对不上）

| 口径 | 定义 | 本文用途 |
|---|---|---|
| **键** | 3 528 个 key；其中 **1 291** 个是标识符形状（无空格且含 `.` 或 `_`），**1 906** 个 key 与英文值逐字相同（键值合一） | 只用于 §2.1 的命名结构 |
| **值** | 该键在 `en` / `zh` 下的显示文本；英文唯一值 **3 307**（221 个值被复用，最多复用 6 次） | **全部形态统计的分母** |
| **决策件** | 「用户在危险动作里真正读到的那一条」：动作标签 / 疑问句 / 后果正文 / 勾选陈述 / 逐字短语，排除长说明文 | §3 专用，判定规则见 §3.1 |

### 1.3 本文不做什么

- 不做**语气形容词表**（友好 / 克制 / 权威）—— 那是主观判断，本文只给可数的形态。
- 不做**功能对标**（那是 [`dida365-feature-benchmark.md`](dida365-feature-benchmark.md)）与**界面结构**（那是 teardown §3.2）。
- 不把任何词条写进 [`packages/i18n`](../../packages/i18n/src/locales/zh-CN.ts)。§6 的建议全部是**结构**建议，落地时必须用 heyta 自己的措辞重写。

---

## 2. 键的形态画像

### 2.1 命名结构：339 个命名空间，按「功能域」命名

现量：**339** 个命名空间（键名中第一个 `.` / `_` 之前的部分），前六名 `ai` **115**、`empty` **42**、`calendar` **31**、`delete` **30**、`task` **30**、`upgrade` **27**。

| 读数 | 值 | 含义 |
|---|---:|---|
| 键数 / 唯一英文值 | 3 528 / 3 307 | 221 条值被复用 |
| key 与英文值逐字相同 | 1 906（54.0%） | **一半以上没有语义键**，key 就是文案本身 |
| 中文值 == 英文值 | 4（0.1%） | 几乎没有漏翻，中文侧基本全覆盖 |
| 命名空间数 | 339 | 平均每空间 10.4 条 |

```bash
python3 - <<'PY'
import json,re,collections
d=json.load(open('/tmp/rea-lab/out/strings.json')); en,zh=d['en'],d['zh']; K=list(en)
ns=collections.Counter(m.group(1).lower() for k in K
                       if (m:=re.match(r'([A-Za-z0-9]+)[._]',k)) and ' ' not in k)
print('键',len(en),len(zh),'键集差',len(set(en)^set(zh)),'唯一值',len(set(en.values())))
print('键==英文值',sum(1 for k in K if k==en[k]),'中文==英文',sum(1 for k in K if zh[k]==en[k]))
print('命名空间',len(ns),ns.most_common(6))
PY
```

**读法**：命名空间是**功能域**（`calendar` / `habit` / `focus`），只有 `empty` 一个是**状态域**。于是同一个功能域的词条既进弹窗也进设置页，长说明文与 5 字标签混在同一个空间里（§2.2 的长尾就是这么来的）。heyta 的键是语义键（`MessageKey` 由 [zh-CN.ts](../../packages/i18n/src/locales/zh-CN.ts) 定义、[en.ts](../../packages/i18n/src/locales/en.ts) 用 `satisfies` 对齐），这一点比它强，**别退回去**。

### 2.2 长度分布：中位 15，长尾 753

| 指标 | 英文 | 中文 |
|---|---:|---:|
| 条数 | 3 528 | 3 528 |
| 中位（字符） | **15** | **5** |
| 均值 | 26.9 | 10.0 |
| p90 | 60.1 | 23.1 |
| p99 | 187.3 | 66.0 |
| 最长 | **753** | 203 |
| 中位词数（英文） | 3 | — |
| p90 / 最大词数 | 11 / 119 | — |

长尾：≥64 字符 **330 条（9.4%）**、≥100 字符 **158 条**、≥200 字符 **25 条**；最短 1 字符，单词词条 **756 条（21.4%）**。

```bash
python3 - <<'PY'
import json,statistics as st
d=json.load(open('/tmp/rea-lab/out/strings.json')); en,zh=d['en'],d['zh']
for name,t in (('en',en),('zh',zh)):
    L=[len(v) for v in t.values()]
    print(name,'中位',st.median(L),'均值',round(st.mean(L),1),
          'p90',round(st.quantiles(L,n=10)[8],1),'p99',round(st.quantiles(L,n=100)[98],1),'最长',max(L))
W=[len(v.split()) for v in en.values()]
print('词数 中位',st.median(W),'p90',st.quantiles(W,n=10)[8],'最大',max(W))
print('>=64',sum(1 for v in en.values() if len(v)>=64),'>=100',sum(1 for v in en.values() if len(v)>=100),
      '>=200',sum(1 for v in en.values() if len(v)>=200),'单词条',sum(1 for w in W if w==1))
PY
```

**长尾的形状**（本文少数带判断的读法）：753 字符那条是**多段说明**（含空行分段），不是一句话；25 条 ≥200 字符几乎全是「崩溃 / 数据异常 / 账号风险」这类兜底说明。它们与 5 字符按钮标签同处一张字符串表 —— 这既是「文案规模大」的来源，也说明**它没有把「解释」与「操作」分层**（§3.5 会看到同一个问题）。

### 2.3 疑问句：2.6%，且中英不对齐

| 读数 | 值 |
|---|---:|
| 英文以 `?` 收尾 | **93（2.6%）** |
| 英文任意位置含 `?` | 111（3.1%） |
| 中文以 `？` 收尾 | **87** |

```bash
python3 - <<'PY'
import json
d=json.load(open('/tmp/rea-lab/out/strings.json')); en,zh=d['en'],d['zh']
print('英文 ? 收尾',sum(1 for v in en.values() if v.rstrip().endswith('?')),
      '英文含 ?',sum(1 for v in en.values() if '?' in v),
      '中文 ？ 收尾',sum(1 for v in zh.values() if v.rstrip().endswith('？')))
PY
```

**不对齐**：93 条英文问句里 **82** 条中文仍以问号收尾，**11 条（11.8%）中文改成了陈述句**；另 5 条中文发问而英文不是。这既不是错译也不是规范，而是**没有规范**。heyta 的 `satisfies` 只保键对齐，保不住句式（§6 R4）。

### 2.4 以动词开头：21.0%

| 集合 | 动词开头 | 占比 |
|---|---:|---:|
| 全部 3 528 条 | **740** | 21.0% |
| 标签集（≤4 词、无句末标点，2 375 条） | **530** | 22.3% |

```bash
python3 - <<'PY'
import json,re
d=json.load(open('/tmp/rea-lab/out/strings.json')); en=d['en']
V=set('''add create delete remove edit set show hide open close go clear reset select choose enter tap click
drag enable disable turn sign log subscribe unsubscribe import export sync share invite join leave archive
restore move rename duplicate search filter sort pin unpin mark complete cancel confirm save discard apply
update upgrade download upload copy paste undo redo send start stop pause resume quit view manage customize
allow deny retry refresh skip continue try get buy verify change toggle adjust pick track record print pay
follow merge split attach detach link unlink lock unlock keep use'''.split())
def first(s):
    m=re.match(r"[A-Za-z][A-Za-z'-]*",s); return m.group(0).lower() if m else ''
print('全部动词开头',sum(1 for v in en.values() if first(v) in V))
lab=[v for v in en.values() if len(v.split())<=4 and not re.search(r'[.!?…:;]$',v.strip())]
print('标签集',len(lab),'其中动词开头',sum(1 for v in lab if first(v) in V))
PY
```

⚠️ 启发式：英文按首词是否落在手工动词表（约 90 条）；中文侧不做同口径统计（汉语无空格边界，按首字表会低估）。读法：**动词开头只占五分之一** —— 界面主语大多是名词（对象名、属性名、状态名），动作靠按钮语境承担。

### 2.5 礼貌词：`请/please` 只占 2.8%

| 侧 | 含礼貌词 | 占比 |
|---|---:|---:|
| 英文 `please`（词边界，忽略大小写） | **97** | 2.75% |
| 中文 `请` | **136** | 3.85% |

```bash
python3 - <<'PY'
import json,re
d=json.load(open('/tmp/rea-lab/out/strings.json')); en,zh=d['en'],d['zh']
print('please',sum(1 for v in en.values() if re.search(r'\bplease\b',v,re.I)),
      '请',sum(1 for v in zh.values() if '请' in v))
PY
```

**中文比英文多用 39%**（136 vs 97）—— 典型的「英文靠祈使语气，中文靠『请』补礼貌」。**危险动作里几乎为零**（115 条决策件里 1 条含 `请/please`）：它不靠礼貌词软化危险，靠「后果句 + 载体」。

### 2.6 数字与占位：16.2% 带占位

| 读数 | 值 |
|---|---:|
| 含阿拉伯数字 | 369（10.5%） |
| 含占位符 | **571（16.2%）** |
| ├ `%@` | 265 |
| ├ `%d` | 165 |
| ├ `%1$@` 这类位置参数 | 93 |
| └ `{name}` 这类花括号占位 | 52 |

```bash
python3 - <<'PY'
import json,re
d=json.load(open('/tmp/rea-lab/out/strings.json')); en=d['en']
V=list(en.values()); P=r'%@|%d|%ld|%s|%\d+\$@|\{[A-Za-z_]\w*\}'
print('数字',sum(1 for v in V if re.search(r'\d',v)),'占位',sum(1 for v in V if re.search(P,v)))
for p in (r'%@',r'%d',r'%ld',r'%\d+\$@',r'\{[A-Za-z_]\w*\}'):
    print(p,sum(1 for v in V if re.search(p,v)))
PY
```

**结构含义**：两种占位体系并存（Apple 的 `%@` 与模板式 `{name}`），说明字符串表**跨端共用**（同一份 `Localizable.strings` 喂原生与内嵌 WebView）。heyta 的 [`catalog.ts`](../../packages/i18n/src/catalog.ts) 只认 `{name}`，且「缺变量时保留原占位符」—— 这条差异是可验证的（`pnpm check:i18n-vars`）。

### 2.7 形态小结：82% 是标签

| 形态 | 判据 | 条数 | 占比 |
|---|---|---:|---:|
| 标签 / 属性值 | 无句末标点 | 2 863 | 81.2% |
| 句子 | 英文以 `.` 收尾 | 665 | 18.8% |

```bash
python3 - <<'PY'
import json
d=json.load(open('/tmp/rea-lab/out/strings.json')); en,zh=d['en'],d['zh']
print('英文句号收尾',sum(1 for v in en.values() if v.rstrip().endswith('.')),
      '中文句号收尾',sum(1 for v in zh.values() if v.rstrip().endswith('。')))
PY
```

⚠️ 中英规范不一致：英文 665 条带句号，中文只有 431 条带 `。`（差 234）。所以「按句统计长度」这一级中英不可直接比 —— §5 一律按**逐键**算。

---

## 3. 危险动作的措辞结构（本文核心）

### 3.1 怎么圈定：193 条命中 → 115 条决策件

三步可复现（不靠人眼挑）：

1. **命中**：英文值出现破坏动词词干（`delet/remov/eras/reset/discard/unsubscrib/revok/unlink/purg/wip/sign out/quit/archiv` 或独立词 `clear/empty`），并剔除 `empty` / `unavailable` 收尾的**校验提示**（它们不是动作）⇒ **193 条**。
2. **分载体**：按下列**唯一命中**顺序归五类；剩下的长说明文不算决策件。
3. **决策件 = 115**。

| 载体 | 判据 | 条数 |
|---|---|---:|
| 动作标签 | ≤4 词、无句末标点、非「清字段/退状态/恢复默认」、不以 It/You/This/The/Please… 开头 | **59** |
| 疑问句 | 值含 `?` | **37** |
| 后果正文 | 无 `?` 且含后果要素（永久 / 不可恢复 / 将不再 / 失去访问…） | **15** |
| 勾选陈述 | 键名匹配 `*_confirm_1/2`、`delete_all_focus_confirm` | **3** |
| 逐字短语 | 键名匹配 `im_sure*` | **1** |
| ~~说明文~~ | 其余（教程、发布说明、兜底错误） | 78 |

§3.2–§3.4 的全部数字都出自这一条命令：

```bash
python3 - <<'PY'
import json,re,collections
d=json.load(open('/tmp/rea-lab/out/strings.json')); en=d['en']; K=list(en)
DEST=re.compile(r'(?i)\b(delet|remov|eras|reset|discard|unsubscrib|revok|unlink|purg|wip|sign out|quit|archiv)[a-z]*\b|\b(clear|empty)\b')
FIELD=re.compile(r'(?i)^(clear (date|time)$|remove tags|remove text in tasks|reset default|emoji reset|remove link|quit ([A-Z][a-z]+)$|unsubscribe (failed|succeed)$)')
CONSEQ=re.compile(r"(?i)(permanently|cannot be (recovered|restored|undone)|can't be (recovered|restored|undone)|will (also )?be (deleted|removed|erased|moved)|will not (appear|be saved)|will no longer|will stop|be lost|lose access|no longer (synchronize|be able|take effect)|not be saved|unrecoverable)")
SCOPE=re.compile(r"(?i)(\ball\b|\bselected\b|%d|%\d+\$@|in this section|within this filter|members|shared|each|every|these)")
NONIMPER=re.compile(r"(?i)^(it|it's|this|these|the|a|an|you|your|we|please|all|if|when|after|before|to|no|not)\b")
VALID=re.compile(r'(?i)\bempty\s*\.?$|\bunavailable\s*\.?$')
CHK=re.compile(r'(?i)^(delete_account_confirm_[12]|delete_all_focus_confirm)$'); TYP=re.compile(r'(?i)^im_sure')
def carrier(k):
    s=en[k]
    if CHK.match(k): return '勾选'
    if TYP.match(k): return '逐字'
    if '?' in s: return '疑问句'
    if CONSEQ.search(s): return '后果正文'
    if len(s.split())<=4 and not re.search(r'[.!?:;]$',s.strip()) \
       and not FIELD.match(s.strip()) and not NONIMPER.match(s.strip()): return '动作标签'
    return '说明文'
hits=[k for k in K if DEST.search(en[k]) and not VALID.search(en[k])]
dec=[k for k in hits if carrier(k)!='说明文']
print('命中',len(hits),'决策件',len(dec),dict(collections.Counter(carrier(k) for k in dec)))
q=[k for k in dec if carrier(k)=='疑问句']
print('疑问 收尾',sum(1 for k in q if re.search(r'\?\s*$',en[k])),'带后果',sum(1 for k in q if CONSEQ.search(en[k])),
      '带范围',sum(1 for k in q if SCOPE.search(en[k])),'带计数',sum(1 for k in q if re.search(r'%d|%\d+\$@',en[k])))
print('决策件 带后果',sum(1 for k in dec if CONSEQ.search(en[k])),'带范围',sum(1 for k in dec if SCOPE.search(en[k])))
PY
```

输出：`命中 193 决策件 115 {'动作标签': 59, '疑问句': 37, '后果正文': 15, '勾选': 3, '逐字': 1}` / `疑问 收尾 34 带后果 24 带范围 15 带计数 2` / `决策件 带后果 39 带范围 32`。

### 3.2 疑问句的四个子指标：有句式，内容槽不齐

| 子指标 | 条数 | 占 37 条疑问句 |
|---|---:|---:|
| 问号在**末尾**（后果在前） | 34 | 91.9% |
| 含**后果句** | 24 | 64.9% |
| 含**范围词**（all / selected / members / shared / 计数占位） | 15 | 40.5% |
| 含**计数占位**（`%d` / `%1$@`） | 2 | 5.4% |

**读法**：句式高度统一（问号收尾 92%），但**内容槽不齐** —— 只有 65% 说清后果、40% 说清范围、5% 给条数。也就是说：**它把「要不要问」做成了制度，把「问什么」留给了作者。** 这正是 heyta 可以补的那一层。

### 3.3 18 个对象族：4 族没有确认载体

每条决策件按对象族归一次（关键词优先匹配，一条只归一族；族计数对分类顺序敏感，总数 115 不受影响）：

| 对象族 | 动作标签 | 疑问句 | 后果正文 | 勾选 | 逐字 | 带后果句 | 带范围词 | 合计 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 其他（任务/通用） | 25 | 5 | 0 | 0 | 0 | 2 | 5 | 30 |
| 清单 | 6 | 7 | 4 | 0 | 0 | 9 | 9 | 17 |
| 习惯/打卡 | 5 | 4 | 1 | 0 | 0 | 5 | 3 | 10 |
| 专注记录/计时器 | 2 | 6 | 0 | 1 | 0 | 4 | 2 | 9 |
| 日历订阅 | 3 | 1 | 2 | 0 | 0 | 3 | 2 | 6 |
| 本地异常数据 | 3 | 0 | 3 | 0 | 0 | 3 | 3 | 6 |
| 垃圾桶 | 1 | 2 | 1 | 0 | 0 | 3 | 0 | 4 |
| 标签 | 2 | 0 | 2 | 0 | 0 | 2 | 1 | 4 |
| 成员/共享 | 2 | 2 | 0 | 0 | 0 | 2 | 2 | 4 |
| 分组/看板列 | 1 | 3 | 0 | 0 | 0 | 3 | 3 | 4 |
| 账号 | 1 | 0 | 0 | 2 | 1 | 0 | 1 | 4 |
| 退出登录 | 1 | 2 | 0 | 0 | 0 | 1 | 0 | 3 |
| 模板 | 1 | 1 | 1 | 0 | 0 | 1 | 0 | 3 |
| 纪念日/倒数日 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 3 |
| AI 会话 | 1 | 1 | 1 | 0 | 0 | 1 | 0 | 3 |
| 归档 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| 过滤器 | 1 | 1 | 0 | 0 | 0 | 0 | 1 | 2 |
| 重复任务 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |

从表里读出的三条**结构事实**（不带语气评价）：

1. **4 族完全没有疑问/勾选/逐字载体**：标签、重复任务、归档、本地异常数据。前两者用「后果正文」或「范围选择」替代，后两者只有标签 + 长说明。
2. **最强的一档没有问句**：账号族 4 条 = 1 动作标签 + **2 勾选陈述** + **1 全大写逐字短语**（另有 1 条带感叹号的警告句归入说明文）。→ **它把「重」表达为「要你动手做两件事」，不是「问你一句」。**
3. **最松的一处也是它**：本地异常数据清除 6 条里 3 条长说明、3 条动作标签、**0 问句 0 勾选 0 逐字** —— 而它描述的正是**永久删除未同步数据**。

### 3.4 与 heyta 四档的映射（推定，不是它的自述）

heyta 的档位只由 [`resolveDangerTier()`](../../packages/domain/src/danger-tier.ts) 的输入决定：`target='subject'` ⇒ `typed-alert`；`externallyVisible` / `involvesPayment` / `destroysIrrecoverableResource` ⇒ 至少 `alert`（且 `affectedCount≥10` 再抬到 `typed-alert`）；`affectedCount≥10` ⇒ `alert`；`>1` 或 `collateralImpact>0` ⇒ `popconfirm`；否则 `undo`/`popconfirm`。

| 动作格 | 它的实测载体 | heyta 判据输入（推定） | heyta 档 | 相对松紧 |
|---|---|---|---|---|
| 单条任务删除（进回收站） | 1 条动作标签，无确认 | `undoAvailable=true`, count=1 | `undo` | 一致 |
| 批量 2–9 条 | 1 句疑问句，带计数占位 | count>1 | `popconfirm` | 一致 |
| 批量 ≥10 条 | 同一句疑问句，仍只有计数、无后果句 | count≥10 | `alert` | **它松一档** |
| 清空回收站 | 疑问句 + 永久/不可恢复 | `destroysIrrecoverableResource` | `alert` | 一致 |
| 删除专注记录 | 疑问句 + 不可恢复；另有 1 条勾选 | `destroysIrrecoverableResource` | `alert` | 一致 |
| 删除共享清单 | 疑问句 + 后果（成员失去访问、同步停止），**无键入** | `externallyVisible` | `alert` | 一致（成员数不进 `affectedCount`） |
| 取消日历订阅 | 疑问句 + 后果 | `externallyVisible` | `alert` | 一致 |
| 注销账号 | 2 勾选 + 1 全大写逐字 + 1 警告 | `target='subject'` | `typed-alert` | 一致（载体比我们更死板） |
| 删除标签 | 2 条后果正文，**无问句、无计数** | 标签不进回收站 ⇒ 永远要问 | `popconfirm` | **它松** |
| 清除本地异常数据 | 3 条长说明 + 动作标签，**无问句/勾选/逐字** | `destroysIrrecoverableResource` | `alert` | **它松一档（最松一处）** |
| 删除重复任务 | 单独一步「范围选择」（本次 / 全部） | 我们模型里没有这一步 | —（需新输入） | **它更紧** |

**判定**：它的档位轴是「**进不进回收站 / 是不是永久**」，不是「**影响谁**」。所以「影响他人」格（共享清单、日历）只给一句后果句、不要求键入 —— 与 heyta 的 `externallyVisible ⇒ alert` **同档**；而「只影响自己但不可恢复」格（本地数据、标签）连问句都省 —— **比 heyta 松一到两档**。反过来，重复任务删除它比我们多一步范围选择，这一格更紧。

⇒ 对 heyta 的直接含义：**判据比它严，缺的是「档位 → 文案槽」的强制**（哪些档必须出后果句、哪些档必须出范围词）。见 §6 R1。

---

## 4. AI 文案：先更正 267，再分类

### 4.1 「267」是子串命中，不是语义计数

`sum(1 for k in keys if 'ai' in k.lower())` = **267**，与 teardown 旧版 §3.3 一致。但 `ai` 是极常见的字母对：**267 里有 152 条与 AI 无关**，命中源是 `fail`（含 a-i）**43**、`email` **41**、`daily` **14**、`tail` **14**、`detail` **13**、`again` **12**、`available` **7**、`main` **5**。

| 口径 | 键数 | 说明 |
|---|---:|---|
| `'ai' in key.lower()` | 267 | ❌ 子串，不可引用 |
| `ai_` / `ai.` 命名空间 | **115** | 结构口径：作者自己就是这么归的 |
| 值里出现词边界 `AI` | 25 | 用户可见口径（文案里真的写了 AI） |
| **并集** | **119** | 115 + 25 − 交集 21 |

（主线独立复核得 120 / 25 / 121，差异在词边界定义；**以 119 为准**，见 commit `51b2f7bd2`。）

### 4.2 119 条的结构分类：近一半是「结果/进行态」

| 类别 | 条数 | 占比 | 判据（键名或值的关键词，按此顺序唯一命中） |
|---|---:|---:|---|
| **结果/进行态** | **57** | 47.9% | analyzing / generat / suggest / complete / analysised / added_ / saved / save_dialog / regenerate / break_ / subtask / recommend / advice |
| 引导/入口 | 26 | 21.8% | try_now / use_here / placeholder / tab_desc / greeting / quick_ / new_conversation / history_empty / prompt_ / hint / _desc / feature_guide |
| 额度/付费 | 11 | 9.2% | usage / limit / token / premium / upgrade |
| 免责/隐私 | 11 | 9.2% | privacy / agreement / info_provided / warn / upload_data / modify_data / read_data / use_input |
| 失败态 | 6 | 5.0% | fail / timeout / stop / exceed / another_task / provide_more_info / error |
| 未归类（标签/会话管理） | 8 | 6.7% | 含 3 条 AI 会话删除与 1 条设置标题 |

```bash
python3 - <<'PY'
import json,re,collections
d=json.load(open('/tmp/rea-lab/out/strings.json')); en,zh=d['en'],d['zh']; K=list(en)
NS={k for k in K if re.match(r'(?i)^ai[._]',k)}
VAL={k for k in K if re.search(r'(?<![A-Za-z])AI(?![A-Za-z])',en[k])}
UN=NS|VAL
print('子串',sum(1 for k in K if 'ai' in k.lower()),'命名空间',len(NS),'值命中',len(VAL),'并集',len(UN))
FP=[k for k in K if 'ai' in k.lower() and k not in NS]
print('假阳性',len(FP),[(w,sum(1 for k in FP if w in k.lower())) for w in ('fail','email','daily','tail','detail','again')])
R=[('免责/隐私',r'(privacy|agreement|info_provided|warn|upload_data|modify_data|read_data|use_input)'),
   ('额度/付费',r'(usage|limit|token|premium|upgrade)'),
   ('失败态',r'(fail|timeout|stop|exceed|another_task|provide_more_info|error)'),
   ('结果/进行态',r'(analyzing|generat|suggest|complete|analysised|added_|saved|save_dialog|regenerate|break_|subtask|recommend|advice)'),
   ('引导/入口',r'(try_now|use_here|placeholder|tab_desc|^ai_agent_title|greeting|quick_|new_conversation|history_empty|prompt_|hint|tab_|_desc$|group_recent|feature_guide)')]
def c(k):
    t=k+' '+en[k]
    for n,p in R:
        if re.search(p,t,re.I): return n
    return '未归类'
print(collections.Counter(c(k) for k in UN).most_common())
print('长度中位',sorted(len(en[k]) for k in UN)[len(UN)//2],'带占位',
      sum(1 for k in UN if re.search(r'%@|%d|%ld|%\d+\$@',en[k])),'含问号',sum(1 for k in UN if '?' in en[k]))
PY
```

### 4.3 与全库的两处形态差

| 指标 | AI 119 条 | 全库 3 528 条 |
|---|---:|---:|
| 英文长度中位 | **19** | 15 |
| 带占位符 | **17（14.3%）** | 16.2% |
| 含问号 | 7 | 111 |

**读法**：AI 文案比全库**长 27%**，结构上是「状态机」而不是「卖点」—— 48% 在讲「正在分析 / 已生成 / 已加入」，22% 是入口与快捷动作。对 heyta 的用法是**预算配比**，不是措辞：见 §6 R5。

---

## 5. 中英长度比：字数会骗人，宽度不会

### 5.1 字数比：中文是英文的 37%

| 指标 | 值 |
|---|---:|
| 逐键字数比 `len(zh)/len(en)` 中位 | **0.371** |
| 均值 | 0.418 |
| p10 / p90 | 0.246 / 0.667 |
| 中文比英文**短**的键 | **97.2%** |
| 中文比英文**长**的键 | 0.7% |

```bash
python3 - <<'PY'
import json,statistics as st
d=json.load(open('/tmp/rea-lab/out/strings.json')); en,zh=d['en'],d['zh']
r=[len(zh[k])/len(en[k]) for k in en]
q=lambda p: round(st.quantiles(r,n=100)[p-1],3)
print('中位',round(st.median(r),3),'均值',round(st.mean(r),3),'p10',q(10),'p90',q(90))
print('中文更短',round(sum(1 for x in r if x<1)/len(r),3),'中文更长',round(sum(1 for x in r if x>1)/len(r),3))
PY
```

### 5.2 折算显示宽度（CJK≈2 拉丁字宽、英文去空格）

| 指标 | 值 |
|---|---:|
| 逐键宽度比中位 | **0.80** |
| p10 / p90 | 0.516 / **1.20** |
| 中文显著更窄 | 69.8% |
| **中文更宽** | **19.4%** |
| 中文比英文宽 ≥20% | 8.9% |

```bash
python3 - <<'PY'
import json,statistics as st
d=json.load(open('/tmp/rea-lab/out/strings.json')); en,zh=d['en'],d['zh']
w=lambda s: sum(2 if ord(c)>0x2E80 else 1 for c in s)
r=[w(zh[k])/max(1,len(en[k].replace(' ',''))) for k in en]
q=lambda p: round(st.quantiles(r,n=100)[p-1],3)
print('中位',round(st.median(r),3),'p10',q(10),'p90',q(90),
      '更窄',round(sum(1 for x in r if x<1)/len(r),3),'更宽',round(sum(1 for x in r if x>1)/len(r),3))
PY
```

> 口径说明：英文分母**去掉空格**。若把空格按 1 字宽计，中位降到 **0.706**、「中文更宽」降到 **10.3%**。真实拼音文字里空格约 0.25–0.5 字宽，所以真值在两者之间；本文取「去空格」是因为布局约束的是**连续字形的最大宽度**（换行恰好发生在空格处）。**桶间趋势在两种口径下一致**（§5.3），结论不随口径翻转。

### 5.3 分桶：交叉点在 9–16 字符 —— 🔴 必须按**英文**长度分桶

| 英文长度桶 | 条数 | 英文宽度中位 | 英文 p95 | 中文宽度中位 | 中文 p95 | p95 比值 | 中文更宽占比 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1–8 | 789 | 6 | **8.0** | 4 | **10.0** | **1.25** | **36.2%** |
| 9–16 | 1 173 | 11 | 14.0 | 8 | 14.0 | 1.00 | 17.1% |
| 17–32 | 771 | 19 | 27.0 | 14 | 25.4 | 0.94 | 14.4% |
| 33–64 | 472 | 36 | 51.4 | 28 | 48.0 | 0.93 | 11.2% |
| 65+ | 323 | 83 | 182.6 | 66 | 155.6 | **0.85** | 10.8% |

```bash
python3 - <<'PY'
import json,statistics as st
d=json.load(open('/tmp/rea-lab/out/strings.json')); en,zh=d['en'],d['zh']; K=list(en)
w=lambda s: sum(2 if ord(c)>0x2E80 else 1 for c in s)
p95=lambda L: round(st.quantiles(L,n=100)[94],1)
for name,a,b in (('1-8',1,8),('9-16',9,16),('17-32',17,32),('33-64',33,64),('65+',65,10**9)):
    ks=[k for k in K if a<=len(en[k])<=b]
    ew=[len(en[k].replace(' ','')) for k in ks]; zw=[w(zh[k]) for k in ks]
    wider=sum(1 for k in ks if w(zh[k])>len(en[k].replace(' ','')))/len(ks)
    print(name,len(ks),'en中位',round(st.median(ew)),'en p95',p95(ew),
          'zh中位',round(st.median(zw)),'zh p95',p95(zw),'比值',round(p95(zw)/p95(ew),2),'更宽',round(wider,3))
PY
```

🔴 **分桶轴必须与布局问题对齐。** 若按**中文**长度分桶，同一批数据的中位是 0.78 / 0.82 / 0.83 —— 看起来「几乎不随长度变化」，但这只证明「中文越长、英文也越长」，回答不了「这条**短英文**串够不够宽」。布局问的是「缺哪种语言的位置」，所以桶只能按英文长度分。

**口径稳健性**：把英文空格按 1 字宽计入（另一常见口径），1–8 桶里「中文更宽」的占比从 **36.2%** 降到 **29.9%**，65+ 桶从 **10.8%** 降到 **3.4%** —— **趋势不变**（短桶最危险、长桶最安全），只是幅度收窄。结论不随口径翻转。

```bash
python3 - <<'PY'
import json,statistics as st
d=json.load(open('/tmp/rea-lab/out/strings.json')); en,zh=d['en'],d['zh']; K=list(en)
w=lambda s: sum(2 if ord(c)>0x2E80 else 1 for c in s)
# 按中文长度分桶（错的分桶轴）：看起来"平坦"
for nm,a,b in (('zh<=6',1,6),('zh 7-14',7,14),('zh>=15',15,10**9)):
    ks=[k for k in K if a<=len(zh[k])<=b]
    r=[w(zh[k])/max(1,len(en[k].replace(' ',''))) for k in ks]
    print(nm,len(ks),'中位',round(st.median(r),2))
# 按英文长度分桶，两种分母对照（对的分桶轴）
for nm,a,b in (('1-8',1,8),('9-16',9,16),('17-32',17,32),('33-64',33,64),('65+',65,10**9)):
    ks=[k for k in K if a<=len(en[k])<=b]
    r1=[w(zh[k])/max(1,len(en[k].replace(' ',''))) for k in ks]
    r2=[w(zh[k])/max(1,len(en[k])) for k in ks]
    print(nm,len(ks),'去空格更宽 %.1f%%'%(100*sum(1 for x in r1 if x>1)/len(ks)),
          '| 含空格更宽 %.1f%%'%(100*sum(1 for x in r2 if x>1)/len(ks)))
PY
```

### 5.4 结论：留白按哪种语言定

**分两段定，不要用一句话概括：**

- **短标签（英文 ≤8 字符）按中文定。** 中文最宽 5% 达 **10 字宽**，英文只有 **8**；36.2% 的条目中文更宽。这是「中文字少」直觉失效的区间 —— 3 个汉字 = 6 字宽，已经顶满 4–6 个拉丁字母的按钮。
- **长句（英文 33+ 字符）按英文定。** 英文 p95 是中文的 1.08–1.18 倍（65+ 桶 182.6 vs 155.6）⇒ 多行换行、行高、可展开正文的容纳量按英文估。
- **9–16 字符是等宽区**（p95 比值 1.00），按任一侧定都行。

一句话落点：**「最小宽度 / 不换行的按钮」按中文验，「行数 / 高度」按英文验** —— 两个方向的坏情况不在同一种语言里。这条直接推翻「中文更短，所以留白能省」。

⚠️ 以上只在 macOS 侧成立：Windows 的 `zh-cn` BAML 无法可靠提取中文（§8）。

---

## 6. 对 heyta 的 5 条可执行建议

每条写成「判据 + 落点 + 依据」，判据要能被机器判红。

### R1 把危险动作文案拆成 4 个槽，由档位决定哪几槽必填

- **槽**：`title`（动作 + 对象）/ `consequence`（做什么不可逆的事）/ `scope`（影响几条、影响谁）/ `commit`（按钮文字或有：无）。
- **映射**：`undo` 0 槽；`popconfirm` ≥2 槽（title + scope 或 consequence）；`alert` 3 槽（title + consequence + scope）；`typed-alert` 4 槽（再加 commit = 键入对象名）。
- **落点**：`packages/domain` 加纯函数 `dangerCopySlots(tier)`（零文案，只返回必填槽集合）+ 单测；UI 按返回的槽渲染，缺槽在类型层或门禁层红。
- **依据**：它 115 条决策件里只有 **39 条（33.9%）** 带后果句、**32 条（27.8%）** 带范围词，且分布与档位无关（§3.3）。**「有档位函数」不等于「有槽位契约」** —— heyta 现在的 [`check:danger-confirm`](../../scripts/check-danger-confirm.mjs) 只查「禁 ×、主按钮必须 `--danger`」，查不到「有没有后果句」。

### R2 最小宽度按中文短标签定，行数按英文定

- **判据**：同组件在 `zh-CN` 与 `en` 两套 fixture 下 `scrollWidth ≤ clientWidth`；≤8 字符标签给 `min-inline-size` 预留 **1.25×** 英文宽度。
- **落点**：`packages/design-system` 的 token 注释写明「短标签按 zh 定」；`e2e/` 加一条双语言 fixture 断言。判据必须写明「按哪种语言量的」。
- **依据**：§5.3（1–8 桶 p95 比值 1.25、36.2% 中文更宽；65+ 桶 0.85）。

### R3 别用「有没有问号」当确认判据

- **判据**：门禁按「档位 → 载体」校验（`alert` 必须有 consequence 槽且走 `DangerDialog`；`typed-alert` 必须有键入控件），**不扫 `？`**。
- **落点**：`packages/domain` 在 `requiresModalCommitment()` 旁加 `requiredCommitCarrier(tier)`，门禁读它。
- **依据**：它 37 条疑问句里 4 条不以问号收尾；18 族里 4 族没有问句；**最强档账号 0 问句**（§3.3）。按问号扫会 100% 漏掉账号档 —— 而账号档恰是它唯一做到 typed 的地方。

### R4 语义键保持现状，另加一道「句式对齐」门禁

- **判据**：逐键比较 zh/en 的「终止标点类别 + 是否疑问」，必须一致（带白名单），不一致报红并列键。
- **落点**：扩 [`packages/i18n`](../../packages/i18n/src/catalog.ts) 的测试面（现有 `satisfies Record<MessageKey,string>` 只保键集合）。
- **依据**：它 93 条英文问句里 **11 条中文变陈述句（11.8%）**，另 5 条反向（§2.3）；英文 665 条句号 vs 中文 431 条（§2.7）。这类漂移在它的规模上是常态，只能靠门禁。

### R5 AI 文案按结构配比写，按前缀分组

- **配比**（照 119 条的分母）：结果/进行态 ≈48%、入口/引导 ≈22%、额度 ≈9%、免责/隐私 ≈9%、失败态 ≈5%、其他 ≈7%。
- **落点**：`packages/i18n` 里 AI 组统一前缀（如 `ai.state.*` / `ai.entry.*` / `ai.quota.*` / `ai.privacy.*` / `ai.error.*`），plan 层写明「状态文案优先于能力介绍」。
- **依据**：§4.2。**它的 AI 文案有一半在讲「现在发生了什么」**，而 heyta 的 AI 条目更容易长成「AI 能做什么」的介绍段。

---

## 7. 三条明确「不要学」

### N1 不要学它的「问句形态不对齐」

93 条英文问句里 11 条中文不再发问（§2.3）。这是**规模化的静默漂移**：没有一条测试能发现它，因为键集合完全一致。heyta 要把它变成门禁（R4），而不是写成一条「注意中英句式」的规范。

### N2 不要学它「一条字符串塞完标题 + 后果 + 问句」

37 条疑问句里 **24 条（64.9%）** 把后果句和问句拼在同一串（§3.2）。可预测的症状：

- 弹窗只能整段排版 —— 后果句无法加粗、无法与被强调的范围词分开；
- 同一条文案无法复用到「内联确认」（手机上是 sheet、桌面是行内）—— heyta 的 `popconfirm` 与 `alert` 共用一份判断但**渲染器有两套**，一句长串会逼出第二套排版。

heyta 应该存 4 个槽（R1），拼装发生在渲染层。

### N3 不要学它「同族形态不一致」

18 族里 4 族无确认载体；垃圾桶 2 条问句都带后果句却**都不带范围词**；清单族 17 条里 7 条问句、4 条后果正文混用（§3.3）。后果是：**用户无法从文案形态判断「这一下有多重」** —— 同样是问句，一处删 1 条任务、一处删整个共享清单。heyta 已有唯一的档位判据，正好可以钉住「同档同载体」；这是它做不到而我们做得到的（我们只有一个入口，它有五端各自写文案）。

---

## 8. 未核实项与已知局限

1. **Windows 侧中文无法可靠提取**，§5 只在 macOS 成立。实测：`strings -a` 对 `resource_stringresource_stringresource.zh-cn.baml` 输出 4 488 行、**CJK 行 0 条**（多字节被切碎）；参数化 UTF-8 扫描得 12 325 段，但无法与 en-us 逐条配对（en-us 得 15 730 段，含碎片）。**已核实的只有英文侧**：macOS 8.2.03 的 3 307 个唯一英文值里 **2 339 条（70.7%）** 在 Windows 8.2.5.0 的 en-us 表里逐字存在 —— 说明跨平台/跨版本文案高度连续，但**不足以**把 §5 推广到 Windows。
2. **语气本身没有量化**。只给形态（长度、句式、载体、族），不给形容词表。给不出来不是没做，是这类判断没有可判红的载体。
3. **只有 en / zh**。它另有 40+ 个 `.lproj`，其它语言的长度膨胀未测（德语/俄语通常比英文长，那才是「留白」的真坏情况）。
4. **`请/please` 只统计字面出现**（97 / 136），未区分「礼貌请求」与「操作提示」，未做位置分析（句首 vs 句中）。
5. **族归类对顺序敏感**：一条可命中多族时按固定顺序归一次（18 族），族计数会随顺序变 ±2；总数 115 不受影响。另有约 5 条非破坏性动作（清字段、移除文本）落在「动作标签」里，它们不计入危险分母但计入 59。
6. **数字与量词未逐条核对**：`%d` 在中文里挂什么量词（条/个/天）未统计。
7. **口径敏感性**：把「动作标签」收紧成「必须主动词开头」后，决策件从上一轮的 120 降到 **115**（差 5 条全在动作侧）；而**疑问句 37 / 勾选 3 / 逐字 1 / 后果正文 15 四项一项没变** —— §3 的结构结论不依赖那个边界。
8. **未读服务端/接口文案**：只覆盖客户端字符串表（`Localizable.strings` 与 WPF 资源），不含任何远程下发文案。

---

## 9. 附：本文的合规自述

- **零原文**：全篇没有一条它的 UI 词条；所有探针只 `print` 计数、长度、布尔与键名特征，不 `print` 值。
- **零搬运**：没有把任何词条写进 [`packages/i18n`](../../packages/i18n/src/locales/zh-CN.ts)（§6 全是结构建议，措辞由 heyta 自己写）。
- **零残留**：解析产物（`strings.json`、BAML 副本）留在 `/tmp`，**不入仓**，理由与 [teardown §1.1](ticktick-desktop-teardown-2026-11.md) 同。
- **可复现**：所有命令跑在本机同一批副本上，依赖 `/tmp/rea-lab/out/strings.json`（重建见 §1.1）。数据一旦被清理，本文读数**不能重跑** —— 这也是它只是一次取证、而不是常驻判据的原因。
