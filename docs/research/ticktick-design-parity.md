# 滴答清单设计系统：macOS / Windows 双端对照

**一句话**：两端在**字阶**上意外收敛（同为 5 档主力、占比 87–89%），在**色与主题**上走的是
两条相反的路 —— macOS 把颜色交给 AppKit 的动态语义色，Windows 把颜色物化成
61 套字典 / 215 个键。**"谁更先进"是个伪问题**：分叉的根因一半是平台的强制，
另一半才是它的选择。本文件把这两半拆开写。

- 取证对象：macOS 8.2.03（430 个 nib 文档）、Windows 8.2.5.0（639 个 BAML）。
- 取证日期：2026-11-06。
- **归属一列是本文件的核心**：`平台强制` = 换到我们的技术栈上也会撞到的约束；
  `它的选择` = 同一个约束下它挑了其中一种做法，我们**可以**不挑它。
- 🔴 **本文件不摘录它的任何界面文案**，也不把它的字面色表抄成建议（只给统计 + 2 个例子）。

---

## 0. 复算：一处要更正、一处要澄清

任务书上给的共享事实我逐条复算过：**一个数要改**（216→215），
**一个数是口径问题**（639 对，但 `ui/` 目录不是 639 个文件），其余全部命中：

| 流传的读数 | 复算结果 | 差异原因 |
|---|---|---|
| Windows `colors.txt` = **216** 个键 | **215 个唯一键** | 该文件有 **168 行** `color_` 开头，其中**有 1 枚键出现两次**（键名不给，C7 会把它打印出来）；去重后 25 white + 23 black + **167** color = 215 |
| Windows `ui/` 下 **639** 个 BAML | 639 BAML ✅ | `ui/` 目录实有 **1296** 个文件，另含 598 png / 32 ico / 12 jpg / 9 json / 4 ttf / 2 cur；639 只是 `.baml` 那一类 |

其余复算全部一致：nib 文档 **430** ✅、字阶 11(146)/12(108)/13(348)/14(71)/16(82) ✅、
五档 **755/850 = 88.8%** ✅、窗口 440×**12** ✅、设置窗 **800×680** ✅、主窗 **1080×808** ✅、
按钮 24(**221**) ✅、输入 **36** ✅、`labelColor` **285** / `textBackgroundColor` **250** ✅。

> ⚠️ 一个口径要点：「850」不是"含 NSSize 的节点数"（那是 **852**），而是
> `class_name == NSFont` 的**资源节点数 = 850**。多出的 2 个是 `NSValue` 的 `{20, 20}`
> 结构体，被 `NSSize` 这个键名误纳。**分母认 850**，命令见 C1。

> 🔴 **两条证据路径必须分开读**（2026-11-06 XAML 可读之后补）：
> Windows 的 **145 个资源字典**（`resource/colorresource`、`resource/fontresource/*`、`icons_*`）
> 正文是 `DeferrableContent` 延迟块，转成 XAML 后只剩一行
> `<!--deferred-stream:NNNNB-->`（例：`colorresource.xaml` 仅 231 字节）。
> 所以 ——
> * **窗口尺寸、控件高度、`FontSize` 字面量** 是**字面量**，走 **C14**（XAML）✅；
> * **具名 token 的数值**（`white_NN`/`black_NN` 的实际色值、`Font10..Font20`/`Height*` 的实际数）
>   走 **C7/C8**（**原始 BAML 字节**，double 以「ASCII 数字 + `0x51`」存放）⚠️ **单路径**；
> * 🔴 **绝不能拿 XAML 说"token 值读不出来"去推翻 BAML 侧的读数** —— 那是两条路，不是同一个坑。
>   反过来也不能只信 BAML：C8 的对齐校验是「`normal` 档的 delta 必须恰为 0」（键名 = 数值）。
>   实测**两条独立对齐同时成立**：`Font` 9 键在值索引 21 处 delta **0.0**、
>   `Height` 32 键在值索引 30 处 delta **0.0**，且 21+9=30 严丝合缝 ⇒
>   记录顺序确为 `Double`(21) → `Font`(9) → `Height`(32)，**这个读法不是凑出来的**。
> * 例外：`color_#HEX` 这 167 个键**键名自带数值**，无需再解流，键名即色值本身。

---

## 1. 取证命令（每个读数都由下面某一条产出）

C1–C12 在 `/tmp/rea-lab` 下跑；**C13 读本仓的 `tokens.css`**（唯一一条不读标本的命令）。
全部只读，不改任何文件。

**C1 · macOS 字阶**
```bash
python3 - <<'PY'
import json,glob,collections
c=collections.Counter()
for f in glob.glob('/tmp/rea-lab/out/nib-b*.json'):
    for n in json.load(open(f))['normalized_result']['graph']['nodes']:
        a=n.get('attributes',{})
        if a.get('class_name')=='NSFont':
            c[(a.get('nibValues') or {}).get('NSSize')]+=1
t=sum(c.values()); top5=sum(c[k] for k in (11,12,13,14,16))
print(t, sorted(c.items(), key=lambda x:-x[1]))
print('top5', top5, round(top5/t*100,1))
PY
```

**C2 · macOS 窗口矩形**
```bash
python3 - <<'PY'
import json,glob,re,collections
tot=0; w=collections.Counter(); named={}
for f in glob.glob('/tmp/rea-lab/out/nib-b*.json'):
    for n in json.load(open(f))['normalized_result']['graph']['nodes']:
        nv=n.get('attributes',{}).get('nibValues',{})
        if isinstance(nv,dict) and 'NSWindowRect' in nv:
            tot+=1
            v=[float(x) for x in re.findall(r'-?\d+\.?\d*',nv['NSWindowRect'])]
            w[v[2]]+=1
            if v[2] in (800.0,1080.0): named[(v[2],v[3])]=n.get('name')
print('windows',tot)
print('width hist',sorted(w.items(), key=lambda x:-x[1])[:4])
print('notable',named)
PY
```

**C3 · macOS 按钮 / 输入框高度**
```bash
python3 - <<'PY'
import json,glob,re,collections
for cls in ('_TtC8TickTick13TTThemeButton','_TtC8TickTick23TTBorderedTextFieldView'):
    h=collections.Counter()
    for f in glob.glob('/tmp/rea-lab/out/nib-b*.json'):
        for n in json.load(open(f))['normalized_result']['graph']['nodes']:
            a=n.get('attributes',{})
            if a.get('class_name')!=cls: continue
            nv=a.get('nibValues',{})
            if isinstance(nv,dict) and 'NSFrame' in nv:
                v=[float(x) for x in re.findall(r'-?\d+\.?\d*',nv['NSFrame'])]
                if len(v)>=4: h[v[3]]+=1
    print(cls, sum(h.values()), h.most_common(6))
PY
```

**C4 · macOS 语义色名 / C5 · 原始色**
```bash
python3 - <<'PY'
import json,glob,base64,collections
nm=collections.Counter(); gray=collections.Counter(); rgb=collections.Counter(); tot=0
for f in glob.glob('/tmp/rea-lab/out/nib-b*.json'):
    for n in json.load(open(f))['normalized_result']['graph']['nodes']:
        a=n.get('attributes',{})
        if a.get('class_name')!='NSColor': continue
        tot+=1; nv=a.get('nibValues') or {}
        if 'NSColorName' in nv: nm[nv['NSColorName']]+=1
        for k,c in (('NSWhite',gray),('NSRGB',rgb)):
            if k in nv:
                try: c[base64.b64decode(nv[k]['$nib_data_base64']).decode('utf8','replace')]+=1
                except Exception: pass
print('NSColor total', tot)
print('semantic', sum(nm.values()), 'distinct', len(nm), nm.most_common(6))
print('gray', sum(gray.values()), 'distinct', len(gray), gray.most_common(4))
print('rgb', sum(rgb.values()), 'distinct', len(rgb))
PY
```

**C6 · macOS 图标**
```bash
python3 - <<'PY'
import json,glob
n=named=reps=tpl=0; names=set()
for f in glob.glob('/tmp/rea-lab/out/nib-b*.json'):
    for x in json.load(open(f))['normalized_result']['graph']['nodes']:
        a=x.get('attributes',{})
        if 'Template' in json.dumps(a): tpl+=1
        if a.get('class_name')!='NSImage': continue
        n+=1; nv=a.get('nibValues') or {}
        if nv.get('NSResourceName'): named+=1; names.add(nv['NSResourceName'])
        if 'NSReps' in nv or 'NSTintColor' in nv: reps+=1
print('NSImage', n, 'with name', named, 'distinct', len(names))
print('programmatic(NSReps/NSTintColor)', reps, 'nodes mentioning Template', tpl)
PY
```

**C7 · Windows 颜色键 + 色值统计（权威口径，直接从 BAML 字节统计）**
```bash
python3 - <<'PY'
import re,collections
d=open('/tmp/rea-lab/win/ui/resource_colorresource.baml','rb').read()
g=collections.defaultdict(set)
for m in re.finditer(rb'[\x20-\x7e]{2,40}', d):
    s=m.group().decode('ascii','ignore').strip()
    if re.fullmatch(r'white(_[0-9A-Fa-f]{2})?',s): g['white'].add(s)
    elif re.fullmatch(r'black(_[0-9A-Fa-f]{2})?',s): g['black'].add(s)
    elif re.fullmatch(r'color_#[0-9A-Fa-f]{6,8}',s): g['color'].add(s)
print({k:len(v) for k,v in g.items()}, 'total', sum(len(v) for v in g.values()))
h=[x.split('#')[1] for x in g['color']]
op=[[int(x[i:i+2],16) for i in (0,2,4)] for x in h if len(x)==6]
L=[(0.2126*c[0]+0.7152*c[1]+0.0722*c[2])/255 for c in op]
print('6hex',len(op),'8hex',len(h)-len(op))
print('lum',round(min(L),3),round(max(L),3))
print('chromatic(>40)',sum(1 for c in op if max(c)-min(c)>40),
      'neutral%(<=8)',round(sum(1 for c in op if max(c)-min(c)<=8)/len(op)*100))
occ=collections.Counter()
for m in re.finditer(rb'[\x20-\x7e]{2,40}', d):
    s=m.group().decode('ascii','ignore').strip()
    if re.fullmatch(r'color_#[0-9A-Fa-f]{6,8}',s): occ[s]+=1
print('color occurrences',sum(occ.values()),'repeated keys',[k for k,v in occ.items() if v>1])
PY
```

**C8 · Windows 字阶声明值（BAML 的 double 以「数字 + 0x51」存放）**

> 🔴 **解析方式为实现观察，非格式规范。**「double 存成 ASCII 数字 + `0x51`」是我在 8.2.5.0 的字节里
> 归纳出来的形状，**未见任何官方 BAML 规范记载**。它可能随版本失效 ⇒ **失效即作废**（见下方失效条件）。

```bash
python3 - <<'PY'
import re
for f in ('normal','middle','large'):
    d=open(f'/tmp/rea-lab/win/ui/resource_fontresource_font_{f}.baml','rb').read()
    runs=[m.group().decode('ascii','ignore').strip() for m in re.finditer(rb'[\x20-\x7e]{2,40}',d)]
    keys=[r for r in runs if re.fullmatch(r'Font\d{2}',r)]
    vals=[float(m.group(1)) for m in re.finditer(rb'(?<![\d.])(\d+(?:\.\d+)?)\x51',d)]
    imp=[float(re.sub(r'\D','',k)) for k in keys]
    for off in range(len(vals)-len(keys)+1):
        seg=vals[off:off+len(keys)]
        if len({round(v-i,3) for v,i in zip(seg,imp)})==1:
            print(f, list(zip(keys,seg)), 'delta', round(seg[0]-imp[0],1)); break
PY
```

> ✅ **这条读数的唯一可信度来源是两条自校验，两者都在正文里**（不在附录、不在别处）：
> 1. `normal` 档 **`Font` 9 键**在值索引 **21** 处 delta = **0.0**；
> 2. `normal` 档 **`Height` 32 键**在值索引 **30** 处 delta = **0.0**；
> 3. 且 **21 + 9 = 30** 严丝合缝 ⇒ 记录顺序确为 `Double`(21) → `Font`(9) → `Height`(32)。
>
> 为什么这三条能当校验：`normal` 是基准档，键名就该等于数值，所以 delta **必须**是 0。
> **若对齐错位一格，delta 会整体偏 ±1；两条（9 键 + 32 键）同时落在 0 的概率极低。**
> 换句话说：**这个读法不是凑出来的，但它也没有规范背书 —— 它只由这两条对齐担保。**
>
> 🔴 **失效条件（写死，不许放宽）**：一旦 ① BAML 版本变化、或 ② C8 解析报错 / 偏移量改变、
> 或 ③ 上面任一 delta 不再恰为 0 —— 则 `+0/+2/+4`、`Font10=10 / Font11=11 / Font14=14`
> 等**具体数值一律作废，退回键名层**（只保留「存在 `Font10..Font20` 九个键」这一档事实）。
> **不许以「看起来没变」为由继续引用旧数值。**

**C9 · Windows 字阶实际引用 / C10 · 高度阶梯引用**
```bash
python3 - <<'PY'
import re,glob,collections
fs=collections.Counter(); hts=collections.Counter()
for p in glob.glob('/tmp/rea-lab/win/ui/*.baml'):
    d=open(p,'rb').read()
    for m in re.finditer(rb'(Font\d{2})\b', d): fs[m.group(1).decode()]+=1
    for m in re.finditer(rb'(Height\d{1,3})\b', d): hts[m.group(1).decode()]+=1
t=sum(fs.values()); top5=sum(c for _,c in fs.most_common(5))
print('font refs', t, fs.most_common())
print('top5 share', round(top5/t*100,1))
print('height refs', sum(hts.values()), 'distinct', len(hts), hts.most_common(6))
d=open('/tmp/rea-lab/win/ui/resource_fontresource_font_normal.baml','rb').read()
runs=[m.group().decode('ascii','ignore').strip() for m in re.finditer(rb'[\x20-\x7e]{2,40}',d)]
decl=[r for r in runs if re.fullmatch(r'Height\d{1,3}',r)]
print('declared Height keys', len(decl))
PY
```

**C11 · Windows 图标 / C12 · 主题字典**
```bash
python3 - <<'PY'
import re,glob,os
for f in ('light','dark'):
    d=open(f'/tmp/rea-lab/win/ui/resource_icons_{f}.baml','rb').read()
    runs=[m.group().decode('ascii','ignore').strip()
          for m in re.finditer(rb'[\x20-\x7e]{2,80}',d)]
    s={re.sub(r'DrawingImage$','',r) for r in runs if r.endswith('DrawingImage')}
    print('icons_'+f, len(s))
th=[os.path.basename(p)[len('resource_themes_'):-5]
    for p in glob.glob('/tmp/rea-lab/win/ui/resource_themes_*.baml')]
season={'autumn','blossom','frozen','leaves','meadow','spring','summer','winter'}
city={'beijing','cairo','guangzhou','hangzhou','london','losangeles','moscow','newyork',
      'sanfrancisco','seoul','shanghai','shenzhen','sydney','tokyo'}
struct={'colorbase','colorderived','probase','structure','detailpopup',
        'projectmenupopuplightcolors','lightnecessarycolor'}
print('themes',len(th),'season',len(season&set(th)),'city',len(city&set(th)),
      'structural',len(struct&set(th)),'other',len(set(th)-season-city-struct))
PY
```

**C13 · heyta 自身的暗色派生审计（读本仓 tokens.css，不读标本）**
```bash
python3 - <<'PY'
import re
L=open('packages/design-system/src/tokens.css',encoding='utf-8').read().split('\n')
def audit(a,b,tag):
    d=[l for l in L[a-1:b] if re.match(r'\s*--ht-color-[\w-]+:',l)]
    hx=[l for l in d if re.search(r'#[0-9a-fA-F]{6}',l)]
    vr=[l for l in d if 'var(--ht-' in l]
    rg=[l for l in d if re.search(r'rgb\(',l)]
    print(tag,'decl',len(d),'literal_hex',len(hx),'var',len(vr),'rgb',len(rg))
    return hx
audit(101,227,'light'); hd=audit(697,810,'dark')
ramp={m.lower() for m in re.findall(r'#[0-9a-fA-F]{6}', '\n'.join(L[18:95]))}
dh={m.lower() for l in hd for m in re.findall(r'#[0-9a-fA-F]{6}',l)}
print('ramp hexes',len(ramp),'dark literal distinct',len(dh),'not_in_ramp',len(dh-ramp))
PY
```

**C14 · Windows 的 XAML 侧读数（窗口尺寸 / 控件高度 / 字号字面量）**
> 🔴 这一条读的是 `/tmp/rea-lab/win/xaml/`（639 个 BAML 转出的 638 个 `.xaml`，1 个失败：
> `views/tasklist/item/subtasklistitem.baml`）。**WPF 的长度单位是 DIP（1/96 英寸），不是 pt**；
> 1 DIP = 72/96 = **0.75 pt**。所以 `FontSize="14"` = 10.5 pt，`Height="24"` = 18 pt。
> **凡本文件出现 Windows 尺寸，一律标注 DIP 并同时给 pt**；与 macOS 的 pt 直接比数字会系统性读错约 33%。
```bash
cd /tmp/rea-lab/win/xaml && python3 - <<'PY'
import re,glob,collections
DIP2PT=0.75
win=sorted(glob.glob('views/**/*window*.xaml',recursive=True)); sizes=[]
for p in win:
    s=open(p,encoding='utf-8',errors='replace').read()
    m=re.search(r'<([A-Za-z:][\w.:]*)Window\b([^>]*)>',s); a=m.group(2) if m else ''
    w=re.search(r'\bWidth="([\d.]+)"',a); h=re.search(r'\bHeight="([\d.]+)"',a)
    if w and h: sizes.append((p,float(w.group(1)),float(h.group(1))))
print('window xaml',len(win),'explicit root W+H',len(sizes))
print('width top5',[(f'{k:.0f}',c) for k,c in collections.Counter(s[1] for s in sizes).most_common(5)])
print('main',[(f'{a:.0f}x{b:.0f} DIP',f'{a*DIP2PT:.0f}x{b*DIP2PT:.0f} pt')
             for p,a,b in sizes if 'mainwindow' in p])
CTRL=re.compile(r'^(Button|TextBox|CheckBox|ComboBox|ToggleButton|PasswordBox)$')
h_all=collections.Counter()
for p in glob.glob('views/**/*.xaml',recursive=True):
    s=open(p,encoding='utf-8',errors='replace').read()
    for m in re.finditer(r'<([A-Za-z][\w.]*)\b([^>]*?)/?>',s):
        if not CTRL.match(m.group(1)): continue
        h=re.search(r'\bHeight="([\d.]+)"',m.group(2))
        if h: h_all[float(h.group(1))]+=1
    for m in re.finditer(r'<(Button|TextBox|CheckBox|ComboBox|ToggleButton|PasswordBox)\.Height>\s*<[^>]*>\s*([\d.]+)\s*<',s):
        h_all[float(m.group(2))]+=1
tot=sum(h_all.values()); print('control Height literals',tot)
for k,c in h_all.most_common(5):
    print(f'  {k:.0f} DIP = {k*DIP2PT:.1f} pt : {c} ({c/tot*100:.1f}%)')
fs=collections.Counter()
for p in glob.glob('views/**/*.xaml',recursive=True):
    s=open(p,encoding='utf-8',errors='replace').read()
    for m in re.finditer(r'\bFontSize="([\d.]+)"',s): fs[float(m.group(1))]+=1
t=sum(fs.values()); t5=sum(fs[k] for k in (11,12,13,14,16))
print('FontSize literals',t,'distinct',len(fs),'top5',t5,round(t5/t*100,1))
print('  top5 DIP->pt',[(f'{k:g}',f'{k*DIP2PT:g}pt',fs[k]) for k in (11,12,13,14,16)])
PY
```

---

## 2. 双端对照表

### 2.1 色

| # | macOS 怎么做（读数） | Windows 怎么做（读数） | 差异的成因 | 归属 |
|---|---|---|---|---|
| 色-1 | 颜色**对象**共 2271 个，其中 **1184（52%）** 是语义名引用【C4】 | 颜色资源 **215** 个唯一键（25 white + 23 black + 167 `color_#HEX`）【C7】 | macOS 能问系统"当前该是什么色"，Windows 不能，只能预先把色值写下来 | **平台强制**（WPF 无 `NSColor` 级动态语义色） |
| 色-2 | 语义名只有 **19 个**，头部是 `labelColor` **285** / `textBackgroundColor` **250** / `controlColor` **115** / `controlBackgroundColor` **112** / `controlTextColor` **105**；末位 `secondaryLabelColor` 仅 **1**【C4】 | light 主题字典有 **140** 个语义角色、暗色 **194** 个，分别引用 **19 / 22** 个 token | 一边把语义**外包给 OS**（角色少而通用），一边自己**承担全部角色**（角色多而具体） | **它的选择**（Windows 本可只做 ~20 个角色，它做了 140+） |
| 色-3 | 真·原始色很少：**935** 个灰阶引用但只有 **14** 个不同值；纯黑 `0` **340**、纯白 `1` **285**、`0.6027` **199**、`0.4247` **60**；RGB 仅 **152** 引用 / **24** 个值【C5】 | **167** 个 `color_#HEX`（164 个 6 位 + **3** 个 8 位带 alpha）；亮度 0.098–1.000；**96/164** 是强彩色（R/G/B 极差 > 40），仅 **23%** 近似中性 | macOS 的原始色是"黑/白/一个中灰"三件套，彩色交给语义色；Windows 把彩色也物化 | **它的选择** |
| 色-4 | 灰阶是**字面白度**（`NSWhite`），不是 token：`0.6027` / `0.4247` 这类不可名状的值直接躺在 nib 里 | 字面白度被收成 **25 档 `white_NN` + 23 档 `black_NN`**（两位十六进制命名） | 同一件事两种归档方式：一边留在控件实例上，一边升格为可复用键 | **它的选择**（这一步它比 macOS 做得更系统） |

> 🔴 **字面色只许举例 2 个**（任务边界）：全部 167 个 `color_#HEX` 的分布已由 色-3 的统计描述；
> 举两端各一例 —— `color_#001968`（最暗，亮度 0.098）与 `color_#fd5d5f`（偏亮红）。
> **不要把这张表当调色板抄进任何建议**：见 §4 不可借鉴第 3 条。

### 2.2 字

| # | macOS 怎么做（读数） | Windows 怎么做（读数） | 差异的成因 | 归属 |
|---|---|---|---|---|
| 字-1 | **850** 个 `NSFont` 实例，实际只用到 **19** 个字号；主力 **5 档 = 11/12/13/14/16 共 755 = 88.8%**；13 独占 **348 = 40.9%**【C1】 | 声明 **9 档 = 10/11/12/13/14/16/18/19/20**；BAML 侧引用 **138** 次，主力 5 档 **= 11/12/13/14/16 共 87.0%**，13 占 **28.3%**【C8】【C9】。**第二条独立路径**：XAML 里 **786** 个 `FontSize` 字面量（22 个不同值），主力同为这 5 档 = **88.0%**，最大档 **14 DIP = 10.5 pt（233 = 29.6%）**【C14】 | 数值上**两端独立收敛到同一组五档**（88.8% / 88.0%），但 🔴 **物理尺寸并不相等**：macOS 的 13 是 **13 pt**，Windows 的 13 是 **13 DIP = 9.75 pt**，后者小了约 25% | **数值巧合，不是尺度对齐**：两边各自挑了一组圆整数字（5 档、同一组整数），单位却不同 —— 读这张表时不要跨端比绝对值 |
| 字-2 | 字体族几乎单一：`AppleSystemUIFont` **761/850 = 89.5%**，Medium 57、Demi 14、Bold 10、`HelveticaNeue` 仅 8【C1】 | 复合字体栈 + 按脚本的 `FontFamilyMap`：SourceHanSans / Harmony / Roboto / Nunito / Yahei / Arial / Inter / Poppins 各有一对 `Font*` / `Source*` 键，并带 **1.0 / 1.03 / 1.3 / 1.032** 四个缩放常数 | macOS 一个系统字体覆盖 CJK 由系统兜底；Windows 必须自己写复合字体（CJK / 拉丁 / 数字分别指定） | **平台强制**（WPF 复合字体是必需件） |
| 字-3 | **无**"字号密度"概念 | **3 套**密度字典 `normal / middle / large`，同一组 9 个键，值是**全局常量偏移 +0 / +2 / +4**（如 Font13 = 13 / 15 / 17）【C8】〔🔴 该数值来自**作者自建解析**（BAML double = ASCII + `0x51`），**属实现观察、非格式规范**；仅由 C8 的两条 delta=0 自校验担保，版本变化即作废、退回键名层〕 | 它把"字体大小"做成设置项；macOS 版交给系统"显示分辨率/辅助功能" | **它的选择** |
| 字-4 | 出现离散怪值：`90`(1)、`32`(2)、`28`(5)、`25`(5)、`21`(1) —— 长尾 14 个值共 **95** 次【C1】 | 声明里也有死档：**Font19(3) / Font20(4) / Font10(5)** 三档加起来 12 次【C9】 | 两端**都有**"声明了但基本不用"的档位 | 共性缺陷，不是差异 |

### 2.3 尺寸

| # | macOS 怎么做（读数） | Windows 怎么做（读数） | 差异的成因 | 归属 |
|---|---|---|---|---|
| 尺-1 | 窗口 **35** 个，**440 pt 宽出现 12 次**（最常见）；设置窗 **800×680 pt**；主窗 **1080×808 pt**【C2】 | `*window.xaml` **109** 个，其中 **26** 个在**根元素**上显式给了宽高（其余 73 个走 `Style=`，尺寸不在实例上）【C14】。主窗 **1140×780 DIP = 855×585 pt**；宽度众数 **440 DIP（4 次）= 330 pt**【C14】 | 两边都把对话框宽度收到**同一个数字 440**，但那是两套单位下的巧合：macOS **440 pt** vs Windows **440 DIP = 330 pt**（差 25%）；macOS 用大量固定宽小面板，Windows 多数窗口把尺寸交给样式 | **它的选择**（440 是产品形态，不是平台约束） |
| 尺-2 | **按钮没有统一高度**：`TTThemeButton` **657** 个实例里 **24 pt→221(33.6%)**、30→99、28→67、32→40（四档并存）【C3】 | **控件高度字面量 188 条**（Button/TextBox/CheckBox/ComboBox/PasswordBox）【C14】：**24 DIP = 18 pt→42(22.3%)**、36 DIP = 27 pt→31(16.5%)、28 DIP = 21 pt→30(16.0%)、30 DIP = 22.5 pt→27(14.4%)、32 DIP = 24 pt→19(10.1%)。另有命名阶梯 `Height*` 声明 **32** 档 / 引用 **147** 次，最高 `Height36` 仅 **15 次 = 10.2%**【C10】 | 两边都**没做到一档**，且**取值集合高度重合**（macOS 24/28/30/32 + Windows 24/28/30/32/36）——这不是互相抄，而是 24 这个数在两个 UI 体系里都是"最小可点控件"的自然落点；但**单位不同**：macOS 24 pt 比 Windows 24 DIP（18 pt）大 33% | **它的选择**：失败方式相反（macOS 靠默认值集中、Windows 靠 token 分散） |
| 尺-3 | **输入框 36 pt**：`TTBorderedTextFieldView` 33 个实例里 **36→22(66.7%)**，其后 32→6、38→2【C3】 | **TextBox 58 条**高度字面量：**24 DIP = 18 pt→16**、36 DIP = 27 pt→12、28 DIP = 21 pt→9、32 DIP = 24 pt→7、20 DIP = 15 pt→6【C14】 | macOS 上输入框比按钮**高一档**（36 vs 24 pt，+50%）；Windows 上输入框**众数反而等于按钮众数**（都是 24 DIP），36 DIP 只是第二档 | **它的选择**：Windows 没把"输入框更高"做成体系，macOS 做了 |

> 🔴 尺-2 与尺-3 是本文件对 heyta 最有用的一格：**它 macOS 端就是"四档按钮 + 一档更高的输入框"**，
> 正是 [`docs/agents/ux-principles.md`](../agents/ux-principles.md) §2 点名的反面症状。

### 2.4 图标

| # | macOS 怎么做（读数） | Windows 怎么做（读数） | 差异的成因 | 归属 |
|---|---|---|---|---|
| 图-1 | **535** 个 `NSImage` 实例，**533** 个有资源名，但**只有 195 个不同名字**（复用率 2.7×）【C6】 | **213** 个（light）/ **208** 个（dark）图标根，并集 **215**，light 独有 7、dark 独有 2【C11】 | 一边按"命名资源 × 复用"组织，一边按"每个图标一套几何"组织 | **它的选择** |
| 图-2 | 位图为主：仅 **2** 个 `NSImage` 带 `NSReps`/`NSTintColor`（程序化），其余是 `NSResourceName` 指向的资源 | **纯矢量**：`*DrawingImage` → `*DrawingGroup` → `*GeometryN`，无位图 | macOS 走模板图 + 系统着色；WPF 无模板图机制，必须**成对出两套** | **平台强制**（模板图是 AppKit 独有概念） |
| 图-3 | **53** 个节点涉及 `Template`（模板图渲染 = 系统按明暗自动反色） | light/dark **两份独立资源**，集合还真的不一样（差 7 / 2 个） | 模板图免费换来暗色适配；WPF 换不来，只能复制一份再改色 | **平台强制** |

### 2.5 主题

| # | macOS 怎么做（读数） | Windows 怎么做（读数） | 差异的成因 | 归属 |
|---|---|---|---|---|
| 主-1 | nib 里**读不到主题载荷**：只有 `TTCustomThemeEditViewController` / `TTCustomThemeOptionsViewController` / `TTThemePreferencesViewItem` 三个控制器 + 一个主题偏好面；亮暗由 `NSColor` 语义名在运行时解析 | **61** 套主题字典 = **8** 季（autumn/blossom/frozen/leaves/meadow/spring/summer/winter）+ **14** 城（beijing/cairo/guangzhou/hangzhou/london/losangeles/moscow/newyork/sanfrancisco/seoul/shanghai/shenzhen/sydney/tokyo）+ **32** 色/其他 + **7** 结构件，另有 **16** 张主题卡【C12】 | 亮暗在 macOS 上**不需要数据**（AppKit 解析），所以主题只能做"重着色"；Windows 没有这层，主题必须是一整份数据 | **平台强制**（前一半）+ **它的选择**（54 个皮肤是产品策略） |
| 主-2 | 语义色 19 个 → 亮暗自动成立，**零份主题数据** | light **140** 角色 / dark **194** 角色，**必须逐份维护** | 同一个"支持暗色"的目标，代价差了两个数量级 | **平台强制** |
| 主-3 | 主题数未核实（见 §5 未核实-2） | `custom` / `darkcustom` / `colorbase` / `colorderived` 表明还有**用户自定义主题 + 派生色** | 一边是固定几套，一边是可编辑主题系统 | **它的选择** |

---

## 3. 与 heyta 的差距清单

判定口径：**有** / **没有** / **有但档位数不同**。行号都指本仓当前树。

| # | 维度 | heyta 现状（`文件:行号`） | 对端读数 | 判定 |
|---|---|---|---|---|
| 3.1 | 色 | 语义层 **66** 枚 `--ht-color-*`（[`tokens.css:101-227`](../../packages/design-system/src/tokens.css)），暗色**逐枚**覆盖 66 枚（[`:697-810`](../../packages/design-system/src/tokens.css)）；原色阶在 [`tokens.css:19-95`](../../packages/design-system/src/tokens.css) | macOS 19 个语义名 / Windows 140+194 个角色 | **有**，且处在两端之间（66），两层派生结构与 Windows 的"角色→token"同构 |
| 3.2 | 色 | 主题只有亮/暗两套（[`tokens.css:697`](../../packages/design-system/src/tokens.css)） | Windows **54** 个皮肤 | **没有**（且不建议要，见 §4 不可借鉴-1） |
| 3.3 | 色 | **亮色 66 枚全是派生**：65 枚 `var(--ht-...)`、**0** 枚裸 hex（[`tokens.css:101-227`](../../packages/design-system/src/tokens.css)）。**但暗色 66 枚里 33 枚裸 hex + 13 枚 `rgb()` = 46 枚（70%）是字面值**，只有 20 枚仍走 `var()`（[`:697-810`](../../packages/design-system/src/tokens.css)）；且那 33 枚里 **21 个色值原色阶里根本没有**（仅 2 枚能回指 `blue-700/800`） | Windows 的 167 枚字面色是**平台强制**（WPF 无动态语义色，见 §2.1 色-1） | 🔴 **有真缺口**：我们的暗色在「字面值无法回指原色阶」这点上与 Windows 同形（46/66 vs 167），**但我们没有 WPF 那个理由** —— 亮色侧已经证明这套派生写得出来。与 [`design-system.md:16-17`](../agents/design-system.md) 「语义名 → 原色阶」的链条在暗色侧断了 |
| 3.4 | 字 | **8 档**字号平铺（[`tokens.css:242-259`](../../packages/design-system/src/tokens.css)）：11/12/13/14/16/18/20/24/30/36（`md`=13 是后补的，[`:253`](../../packages/design-system/src/tokens.css)） | macOS 5 档主力 88.8% / Windows 声明 9 档、主力 5 档 87.0% | **有但档位数不同**：我们的主力五档 **与两端 top-5 完全同集**（11/12/13/14/16）；差的是**没有标注哪几档是主力** |
| 3.5 | 字 | **没有**字号密度档（无"大字号模式"的 token 层） | Windows `+0/+2/+4` 三套 | **没有** |
| 3.6 | 字 | 字重 4 档（[`tokens.css:261-264`](../../packages/design-system/src/tokens.css)）、行高 3 档（[`:266-268`](../../packages/design-system/src/tokens.css)）、字距按层级（[`:600`](../../packages/design-system/src/tokens.css) 起） | Windows 有 `BoldToMedium` / `NormalToBold` 映射、`Baseline`、`LineSpacing` | **有** |
| 3.7 | 尺寸 | 控件高度**只有一档**：`--ht-size-field-height: 44px`（[`tokens.css:571`](../../packages/design-system/src/tokens.css)），规则在 [`ux-principles.md:119-135`](../agents/ux-principles.md)「不再加第二档」 | macOS 按钮 **4 档**（24/28/30/32 **pt**）+ 输入 **36 pt**；Windows 控件 **5 档**（24/28/30/32/36 **DIP**，众数 24 DIP = 18 pt）【C3】【C14】 | **我们一档，它 macOS 四档、Windows 五档** —— 方向相反。且有一处量级差：我们的 44 CSS px ≈ 44 DIP ≈ **33 pt**，比 macOS 的 24 pt 高 **37%**、比 Windows 的 24 DIP（18 pt）高 **83%** —— 因为 44 取的是 Apple HIG 的**触控**下限，而桌面端取的是**鼠标**命中下限 | **我们是对的**，代价是桌面端比两端都"胖"（见 3.8） |
| 3.8 | 尺寸 | **没有** button-height token：[`tokens.css`](../../packages/design-system/src/tokens.css) 的 `--ht-size-*` 里只有 `field-height`（[`:571`](../../packages/design-system/src/tokens.css)）、`chip-height`（[`:544`](../../packages/design-system/src/tokens.css)）、`avatar-*`、`fab`、`badge-*`；而 [`ux-principles.md:121`](../agents/ux-principles.md) 要求按钮复用 `field-height` | macOS 给按钮独立的 24 | **结构性缺口**：规则说"一档"，但**没有一枚 token 可以引用**，于是每个按钮只能各自写 44 或裸值 —— 这正是 [`design-system.md:14`](../agents/design-system.md) 禁止的形态 |
| 3.9 | 尺寸 | 图标 5 档 **14/16/20/24/32**（[`tokens.css:368-372`](../../packages/design-system/src/tokens.css)），并写明"禁止混用随手值" | macOS **没有**图标尺寸 token（逐图写死）；Windows 用 `Height*` 兼职 | **有**，这一层我们比两端都严 |
| 3.10 | 尺寸 | 布局尺寸 token 化且可拖：rail **64**（[`:402`](../../packages/design-system/src/tokens.css)）、sidebar 默认 **240**、可拖 **192–416**（[`:405-410`](../../packages/design-system/src/tokens.css)）、header **56**（[`:411`](../../packages/design-system/src/tokens.css)） | macOS 固定 440 宽（12 个窗） | **有**，且是**我们更强**的一格 |
| 3.11 | 图标 | 图标走 Lucide 闭集、尺寸 token 化 | macOS 195 个命名位图；Windows 215 个矢量 | **有**（尺寸维度），**没有**（数量维度 —— 我们的图标集远小于 195，这是产品阶段差异不是缺陷） |
| 3.12 | 主题 | `color-scheme` 在 [`:815`](../../packages/design-system/src/tokens.css) / [`:819`](../../packages/design-system/src/tokens.css) 声明；`prefers-reduced-motion`（[`:827`](../../packages/design-system/src/tokens.css)）与 `prefers-reduced-transparency`（[`:859`](../../packages/design-system/src/tokens.css)）都有降级 | 两端**都没有**等价物（BAML 侧未见 reduced-motion 分支） | **有**，且是**我们更强**的一格 |

**差距清单的结论**：真正要动的有三处 —— **3.3**（暗色 46/66 是字面值，其中 21 个色值在原色阶之外）、
**3.5**（字号密度档，缺失）、**3.8**（按钮高度无 token，规则悬空）。
3.1 / 3.4 / 3.9 / 3.10 / 3.12 我们已经不低于两端；3.2 是**不该追**的方向。

⚠️ 三处里 **3.3 的优先级最高**：它是**现存的、可判红的**不一致（亮色 0 枚裸值为证），
而 3.5 是**新增能力**、3.8 是**规则悬空**。

---

## 4. 可借鉴 3 条 / 不可借鉴 3 条

### ✅ 可借鉴

**1. 把"主力五档"显式化，而不是八档平铺。**
证据是两端**独立**收敛到同一组 `{11,12,13,14,16}`（macOS 88.8% / Windows 87.0%，C1/C9），
且第一大档都是 13。heyta 现在 8 档在 [`tokens.css:242-259`](../../packages/design-system/src/tokens.css)
是**平等列举**的，读的人无法知道 18/20/24/30/36 是"展示级"而 11–16 是"UI 级"。
借鉴动作：在 `typography.ts` 的 `TEXT_STYLES` 角色表里把两类分开（这不需要加 token，
只需要给已有 token 分组），并让 `check:design` 能报"某档在 UI 里被当正文用了"。
**不借鉴它的 9 档声明** —— 它自己有三档一共只用 12 次（字-4）。

**2. 把"密度偏移"做成字典常量，视图只见 token。**
Windows 的 `normal/middle/large` 是同一组 9 个键、值整体 `+0/+2/+4`（C8）。
它的视图里写的是 `Font13`，**从不写 13**，所以换密度时视图零改动。
这对 heyta 的价值在**无障碍/长辈模式**：我们若做"大字号"，
照现在的写法会在各组件里散落 media query 与 `font-size` 覆盖，必然漏；
而"组件只引用角色 token + 偏移集中在字典"这个形状，漏不了。
（注意：借鉴的是**形状**，不是那 3 个具体偏移值 —— 那是它的取值。）

**3. token 使用率审计：量"声明数 vs 被引用数"。**
它声明 167 个 `color_#HEX`，而 light 字典只用到 **19** 个 token、dark **22** 个（色-2）
—— 约 **88%** 的字面色是死重。heyta 有 **365** 枚 token，**从未统计过有多少枚被引用**。
这是一个**它替我们演示了必要性的**、且成本极低的审计动作：
在 `check:design` 上加一臂，报出"声明但零引用"的 token。
判据本身可判红（删一枚死 token 前后读数不同），符合 [`design-system.md:43`](../agents/design-system.md)
「不能失败的检查没有价值」。🔴 **注意区分**：这条借鉴的是**审计方法**，不是它的字面色表。

### 🔴 明确不可借鉴（三条都是"它的表达"，不是可迁移的设计）

**1. 54 套皮肤 / 61 套主题字典 —— 抄的是营销，不是设计系统。**
为什么是"它的表达"：消费级产品的换肤是**获客与付费点**（城市/季节皮肤是它的商品），
不是可访问性或一致性的需要。放到 heyta 上代价立刻变形：66 枚语义色 × 54 套 =
**3564 个前景/背景对**都要过对比度门禁（[`design-system.md:45-51`](../agents/design-system.md)
是**真实计算**每一对的），而它自己的死重率（19/167）已经证明**它也没把 54 套维护住**。
heyta 是本地优先 + 自托管工具，主题数量对用户价值近乎零、对门禁成本是线性上涨。

**2. 440px 固定窗宽 —— 那是它列表弹窗的产品形态，不是布局尺度。**
为什么是"它的表达"：440 出现在 **12 个窗口**里（C2），是因为它的 macOS 端把"任务详情/清单项"
做成**固定宽的弹出面板**，440 是这个产品决策的副产品，不是一个可以搬到别处的栅格常数。
heyta 已经把"宽度"做成了**用户状态**：sidebar 默认 240、可拖 192–416
（[`tokens.css:405-410`](../../packages/design-system/src/tokens.css)）。把 440 抄进来会把可拖区间钉死，
还会与详情列 352/288–480（[`:429-431`](../../packages/design-system/src/tokens.css)）打架。
🔴 反过来，它**固定窗宽**这件事本身是它的弱点，不是我们要对齐的目标。

**3. 167 枚字面 `color_#HEX` 当调色板 —— 那是平台强制下的补丁，且它自己维护不住。**
为什么是"它的表达"：WPF 没有 `NSColor.labelColor`，所以**"必须把颜色写下来"是平台的强制**；
但**"写成 167 枚互不相干的字面色、其中 88% 无人引用、且有 1 枚重复键"是它的选择**。
heyta 已经是"语义 66 枚 → 原色阶 11 级"两层派生（[`tokens.css:19-95`](../../packages/design-system/src/tokens.css)），
抄字面色会直接违反 [`design-system.md:14-17`](../agents/design-system.md)
（禁裸 hex、禁外观名）。**这 167 个值一个都不该进 heyta。**

---

## 5. 未核实

| # | 未核实的事 | 为什么没核到 | 要核需要什么 |
|---|---|---|---|
| 1 | ~~Windows 窗口尺寸~~ **已补齐（2026-11-06，XAML 可读后）** | 已由 C14 取到：**109** 个 `*window.xaml`，**26** 个根元素显式宽高，主窗 **1140×780 DIP**，宽度众数 **440 DIP** | 无需再核（C14 可复现） |
| 1b | 那 **73** 个走 `Style=` 的窗口的**实际尺寸** | 尺寸不在实例上，而在样式/代码里；`styles/` 下的资源字典同样是 deferred | 解出 `styles/` 的 deferred 流，或运行时实测 |
| 2 | macOS 版主题/皮肤**清单与数量** | nib 抽取只覆盖 430 个 nib；`/tmp/rea-lab/bundles/b1/Fake.app` 每次切片只放 60 个 nib，**主题载荷不在 nib 里**；`find -iname '*theme*'` 在切片里零命中 | 完整 app bundle 的 Resources 目录 + 主题数据文件（plist/json） |
| 3 | 167 个 `color_#HEX` 各自的**消费去向** | 只统计了键集合与重复；未逐个追到 light/dark 字典的引用点（只量到 19/22 个 token 被引用） | 对 `resource_themes_*.baml` 做 token→引用反向索引 |
| 4 | 那 **3 个 8 位（带 alpha）色**的**字节序**（C7 打出 `8hex 3`，此处不复写其值） | 按"alpha 在最前"推断是 ARGB、alpha ≈ 0x33/0x3E（20–24%），**未验证渲染** | 一处实际使用点 + 截图比对 |
| 5 | macOS 那个 **90pt** 字号（C1 里的长尾 `90`）用在哪 | 单例，未回溯到具体控件类 | 对该 NSFont 节点做反向引用定位 |
| 6 | Windows 字阶引用的**完整性** | C9 读的是 BAML 字符串表里的 `FontNN` 键（`DynamicResource` 形态），**代码里直接赋 `FontSize` 的地方读不到** ⇒ 138 次是**下界** | 反编译 `ticktick_WPF.dll` 的 IL |
| 7 | Windows `Height*` 阶梯**具名键**与**控件实测高度**的对应关系 | 两侧都读到了（键名 32 档 / 引用 147 次 & 控件字面量 188 条），但 `Height*` 的**数值**在 deferred 流里，无法把键对到值，也就无法证明某控件用的是哪一档 | 解出 `resource/fontresource/*` 的 deferred 流 |

---

## 6. 对本仓的净结论

1. **最该动的是暗色的色值链条（3.3），而且它与滴答无关。**
   亮色 66 枚语义变量 **0 枚裸值**、暗色 **46/66（70%）是字面值**、其中 **21 个色值在原色阶之外**
   （命令 C13）。这不是"学它"或"不学它"的问题 —— 是**我们自己两头不一致**，
   而这一路对照只是把它照出来了。它必须动，理由和竞品无关。
2. **字阶不用改取值** —— heyta 的 11/12/13/14/16 与两端 top-5 同集，这是三段独立收敛的强信号。
   要改的只是**标注哪几档是主力**（§4 可借鉴-1）。
3. **尺寸有一处规则悬空**：[`ux-principles.md:121`](../agents/ux-principles.md) 说控件只有一档高度，
   但 [`tokens.css`](../../packages/design-system/src/tokens.css) 里**没有按钮高度 token**（3.8）。
   这会让「一档」变成每个按钮各自解释。
4. **色与主题不要对齐它的数量**：它的 54 皮肤 / 167 字面色里，可迁移的是**审计方法**，
   不可迁移的是**取值与数量**（§4 不可借鉴 1、3）。
5. **两端都没有、而我们有的**：`prefers-reduced-motion` / `prefers-reduced-transparency` 降级
   （[`tokens.css:827`](../../packages/design-system/src/tokens.css)、[`:859`](../../packages/design-system/src/tokens.css)）、
   可拖侧栏区间（[`:405-410`](../../packages/design-system/src/tokens.css)）、图标尺寸 5 档 token。
   **这三格别为了"对齐竞品"去退步。**
