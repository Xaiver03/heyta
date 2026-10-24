/**
 * 产品介绍演示 —— 幻灯片主体
 * ============================
 *
 * 🔴 **界面页全部由 `src/mockup/` 的真实复现件渲染**（`AppWindow` 的五个视图：
 * 任务 / 四象限 / 习惯 / 专注 / 时间线）。这里**不画第二套 UI** ——
 * 复现件的结构从 `app-shell-shape.ts` 派生并与 `apps/web/src/App.tsx` 对账，
 * 在演示里另画一份会立刻失去那道对账。
 *
 * 1920×1080 舞台 + `scale()` 等比适配视口：字号、间距、圆角全部按 1920 写死，
 * 换算交给一次 transform —— 与复现件里「固定 stage + 等比缩放」是同一个主意。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { AppWindow } from '../src/mockup/AppWindow.js';

const STAGE_W = 1920;
const STAGE_H = 1080;
const AUTOPLAY_MS = 9000;

/* ── 小部件 ───────────────────────────────────────────── */

function Eyebrow({ children }: { children: string }): React.JSX.Element {
  return <p className="pd-eyebrow">{children}</p>;
}

function Bullet({ children }: { children: string }): React.JSX.Element {
  return (
    <li className="pd-bullet">
      <span className="pd-bullet__dot" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

function Card({
  n,
  title,
  body,
}: {
  n: string;
  title: string;
  body: string;
}): React.JSX.Element {
  return (
    <div className="pd-card">
      <span className="pd-card__n">{n}</span>
      <h3 className="pd-card__t">{title}</h3>
      <p className="pd-card__d">{body}</p>
    </div>
  );
}

/** 窗口框：真实复现件放进来，`AppWindow` 自己按宽度算缩放。 */
function WindowFrame({ view, wide }: { view: 'tasks' | 'quadrant' | 'habits' | 'focus' | 'timeline'; wide?: boolean }): React.JSX.Element {
  return (
    <div className={wide === true ? 'pd-window pd-window--wide' : 'pd-window'}>
      <AppWindow view={view} />
    </div>
  );
}

/* ── 各页 ─────────────────────────────────────────────── */

function Cover(): React.JSX.Element {
  return (
    <div className="pd-cover">
      <div className="pd-brand">
        <span className="pd-brand__mark" aria-hidden="true">
          <svg width="34" height="34" viewBox="0 0 40 40" fill="none">
            <path d="M9 20.5L16.5 28L31 13" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="pd-brand__name">heyta</span>
      </div>
      <h1 className="pd-cover__title">你的清单，不该是别人的资产</h1>
      <p className="pd-cover__sub">功能对标滴答清单，但可以自建自托管</p>
      <div className="pd-chips">
        <span className="pd-chip">本地优先</span>
        <span className="pd-chip">端到端加密</span>
        <span className="pd-chip">开源 MIT</span>
      </div>
      <p className="pd-cover__meta">产品介绍 · 2026</p>
    </div>
  );
}

function Problem(): React.JSX.Element {
  return (
    <div className="pd-body">
      <Eyebrow>问题</Eyebrow>
      <h2 className="pd-h2 pd-h2--onDark">订阅制任务工具，用户付了三笔账</h2>
      <div className="pd-grid3">
        <Card
          n="01"
          title="年费越涨"
          body="清单、日历、习惯、专注被打包成订阅制，年费不低，停付即停服。"
        />
        <Card
          n="02"
          title="数据在别人那里"
          body="日程与习惯躺在别人的服务器上，你能带走的往往只有一份导出。"
        />
        <Card
          n="03"
          title="想自建，没得选"
          body="不想把数据托管出去？主流商业产品基本不给你这个选项。"
        />
      </div>
    </div>
  );
}

function WhyNow(): React.JSX.Element {
  return (
    <div className="pd-body">
      <Eyebrow>为什么是现在</Eyebrow>
      <h2 className="pd-h2">三股力量，把这件事从理想变成可行</h2>
      <div className="pd-grid3">
        <Card n="1" title="本地优先成为共识" body="用户开始要求「数据在我手里」，而不是「服务商保证会保护好」。" />
        <Card n="2" title="加密与同步工程成熟" body="存储、加密、冲突解决已有成熟开源实现，不必从零发明轮子。" />
        <Card n="3" title="AI 需要可控的数据入口" body="AI 要读你的任务，就得有本地 API 和一条明确的出站边界。" />
      </div>
    </div>
  );
}

function Solution(): React.JSX.Element {
  return (
    <div className="pd-center">
      <Eyebrow>解决方案</Eyebrow>
      <p className="pd-statement">
        清单、日历、四象限、习惯、专注 ——
        <br />
        一套体验统一的工具，数据默认落在你自己的设备上。
      </p>
      <div className="pd-rule" />
      <div className="pd-chips">
        <span className="pd-chip">功能等价，不抄皮</span>
        <span className="pd-chip">复用优先</span>
        <span className="pd-chip">导出自由</span>
      </div>
      <p className="pd-fine">
        对标功能与交互逻辑，不使用对方商标、图标、文案与界面素材
      </p>
    </div>
  );
}

function AppTasks(): React.JSX.Element {
  return (
    <div className="pd-split">
      <div className="pd-split__copy">
        <Eyebrow>任务视图</Eyebrow>
        <h2 className="pd-h2 pd-h2--sm">
          一个界面，
          <br />
          装下你全部的待办
        </h2>
        <ul className="pd-bullets">
          <Bullet>左栏：今天 / 最近 7 天 / 已完成，四象限带实时计数</Bullet>
          <Bullet>任务行：勾选、截止徽标、清单与标签一屏内可读</Bullet>
          <Bullet>清单与标签并排两块，都能从标题栏直接新建</Bullet>
        </ul>
      </div>
      <WindowFrame view="tasks" />
    </div>
  );
}

function AppQuadrant(): React.JSX.Element {
  return (
    <div className="pd-split pd-split--flip">
      <WindowFrame view="quadrant" />
      <div className="pd-split__copy">
        <Eyebrow>四象限</Eyebrow>
        <h2 className="pd-h2 pd-h2--sm">
          重要与紧急由规则算出来，
          <br />
          不是你手动归类
        </h2>
        <ul className="pd-bullets">
          <Bullet>象限由截止日与优先级派生，改了任务自动重算</Bullet>
          <Bullet>侧栏计数与看板卡片来自同一批任务，不会两处对不上</Bullet>
          <Bullet>拖动即改象限，落下的仍然是一个 op</Bullet>
        </ul>
      </div>
    </div>
  );
}

function AppHabits(): React.JSX.Element {
  return (
    <div className="pd-split">
      <div className="pd-split__copy">
        <Eyebrow>习惯</Eyebrow>
        <h2 className="pd-h2 pd-h2--sm">
          打卡之后，
          <br />
          界面要给你回执
        </h2>
        <ul className="pd-bullets">
          <Bullet>连续与韧性由领域层算，断一天不会把你清零</Bullet>
          <Bullet>热力图不是装饰，每一行都对应一次真实打卡</Bullet>
          <Bullet>打卡之后有反馈，而不是按钮从「打卡」变成「已打卡」</Bullet>
        </ul>
      </div>
      <WindowFrame view="habits" />
    </div>
  );
}

function AppFocus(): React.JSX.Element {
  return (
    <div className="pd-split pd-split--flip">
      <WindowFrame view="focus" />
      <div className="pd-split__copy">
        <Eyebrow>专注</Eyebrow>
        <h2 className="pd-h2 pd-h2--sm">
          一次番茄钟
          <br />
          就是一条 op
        </h2>
        <ul className="pd-bullets">
          <Bullet>专注时长可回放、可归因到具体任务</Bullet>
          <Bullet>专注与休息各有配色，落在同一条时间线上</Bullet>
          <Bullet>计时跑在本地，关掉窗口不会丢</Bullet>
        </ul>
      </div>
    </div>
  );
}

function AppTimeline(): React.JSX.Element {
  return (
    <div className="pd-split">
      <div className="pd-split__copy">
        <Eyebrow>时间线</Eyebrow>
        <h2 className="pd-h2 pd-h2--sm">
          做过的事，
          <br />
          按时间排给你看
        </h2>
        <ul className="pd-bullets">
          <Bullet>任务、习惯、专注三股事件汇入同一条时间线</Bullet>
          <Bullet>不是「今天做了什么」的统计，是逐条可回溯的记录</Bullet>
          <Bullet>所有条目都由 op-log 重放得出，删了也能追</Bullet>
        </ul>
      </div>
      <WindowFrame view="timeline" />
    </div>
  );
}

const VIEWS: readonly { view: 'tasks' | 'quadrant' | 'habits' | 'focus' | 'timeline'; label: string }[] = [
  { view: 'tasks', label: '任务' },
  { view: 'quadrant', label: '四象限' },
  { view: 'habits', label: '习惯' },
  { view: 'focus', label: '专注' },
  { view: 'timeline', label: '时间线' },
];

function Overview(): React.JSX.Element {
  return (
    <div className="pd-body pd-body--tight">
      <Eyebrow>五种视图，一份数据</Eyebrow>
      <h2 className="pd-h2 pd-h2--sm">换的是看法，不是另一套数据</h2>
      <div className="pd-grid5">
        {VIEWS.map((item) => (
          <figure key={item.view} className="pd-thumb">
            <div className="pd-thumb__win">
              <AppWindow view={item.view} />
            </div>
            <figcaption className="pd-thumb__cap">{item.label}</figcaption>
          </figure>
        ))}
        <div className="pd-overview__note">
          <strong>五个视图，同一批 op</strong>
          <span>
            切视图只是换投影，不换数据。改一处，五个视图同时变 ——
            因为它们读的是同一份 op-log，不是五份互相覆盖的副本。
          </span>
        </div>
      </div>
    </div>
  );
}

function Privacy(): React.JSX.Element {
  return (
    <div className="pd-body">
      <Eyebrow>隐私架构</Eyebrow>
      <h2 className="pd-h2 pd-h2--onDark">数据先落本地，服务端只收密文</h2>
      <div className="pd-grid4">
        <Card n="01" title="本地存储" body="SQLite 或 IndexedDB，就落在你自己那台设备上。" />
        <Card n="02" title="op-log 事件溯源" body="一个用户意图 = 一条 op，只追加，不覆盖历史。" />
        <Card n="03" title="端到端加密" body="密钥不出设备，上行之前载荷已经是密文。" />
        <Card n="04" title="云端只是通道" body="同步不是事实源，随时换成你自己那台服务器。" />
      </div>
    </div>
  );
}

const AI_CARDS: readonly { icon: React.ReactNode; title: string; body: string }[] = [
  {
    icon: (
      <svg width="44" height="44" viewBox="0 0 52 52" fill="none">
        <rect x="2" y="2" width="48" height="48" rx="14" fill="var(--ht-color-primary-subtle)" />
        <path d="M27 14L17 30h8l-2 8 12-17h-8l2-7z" stroke="var(--ht-color-primary)" strokeWidth="2.6" strokeLinejoin="round" />
      </svg>
    ),
    title: '捕获',
    body: '一句话变成结构化任务字段，解析失败会如实告诉你，不静默丢字段。',
  },
  {
    icon: (
      <svg width="44" height="44" viewBox="0 0 52 52" fill="none">
        <rect x="2" y="2" width="48" height="48" rx="14" fill="var(--ht-color-primary-subtle)" />
        <path d="M15 17h22M15 26h22M15 35h14" stroke="var(--ht-color-primary)" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
    ),
    title: '拆解',
    body: '把一件任务拆成可勾选的子项，先落在备注清单里。',
  },
  {
    icon: (
      <svg width="44" height="44" viewBox="0 0 52 52" fill="none">
        <rect x="2" y="2" width="48" height="48" rx="14" fill="var(--ht-color-primary-subtle)" />
        <path d="M17 34V22M26 34V16M35 34V27" stroke="var(--ht-color-primary)" strokeWidth="3" strokeLinecap="round" />
      </svg>
    ),
    title: '优先级',
    body: '逐条给出象限与优先级建议，采纳才写进 op-log。',
  },
  {
    icon: (
      <svg width="44" height="44" viewBox="0 0 52 52" fill="none">
        <rect x="2" y="2" width="48" height="48" rx="14" fill="var(--ht-color-primary-subtle)" />
        <circle cx="26" cy="26" r="12" stroke="var(--ht-color-primary)" strokeWidth="2.6" />
        <path d="M26 20v6l4 3" stroke="var(--ht-color-primary)" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
    ),
    title: '时长估算',
    body: '估这一步大概要多久，用来排今天的时间块。',
  },
];

function Ai(): React.JSX.Element {
  return (
    <div className="pd-body">
      <Eyebrow>AI 能力</Eyebrow>
      <h2 className="pd-h2">AI 只在你说要的时候才出门</h2>
      <div className="pd-grid2">
        {AI_CARDS.map((item) => (
          <div key={item.title} className="pd-card pd-card--row">
            <span className="pd-card__icon">{item.icon}</span>
            <div>
              <h3 className="pd-card__t">{item.title}</h3>
              <p className="pd-card__d">{item.body}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="pd-note">
        本地 API 与 MCP：30 个工具、9/10 实体覆盖，只监听回环地址；AI 端点可自带，自带即免费不限次
      </p>
    </div>
  );
}

const PLATFORMS: readonly { name: string; path: React.ReactNode }[] = [
  { name: 'Web', path: <><rect x="6" y="10" width="44" height="34" rx="5" /><path d="M6 20h44" /><circle cx="14" cy="15" r="1.6" /><circle cx="20" cy="15" r="1.6" /></> },
  { name: 'macOS', path: <><rect x="11" y="12" width="34" height="24" rx="4" /><path d="M7 42h42l-4 4H11l-4-4z" /></> },
  { name: 'Windows', path: <><rect x="8" y="8" width="18" height="18" rx="3" /><rect x="30" y="8" width="18" height="18" rx="3" /><rect x="8" y="30" width="18" height="18" rx="3" /><rect x="30" y="30" width="18" height="18" rx="3" /></> },
  { name: 'Linux', path: <><circle cx="28" cy="30" r="15" /><circle cx="23" cy="27" r="2.2" /><circle cx="33" cy="27" r="2.2" /><path d="M22 13l6 7 6-7" /></> },
  { name: 'Android', path: <><path d="M19 25a9 9 0 0118 0v13a3.5 3.5 0 01-3.5 3.5h-11A3.5 3.5 0 0119 38V25z" /><path d="M18 22l-4-4M38 22l4-4" /></> },
  { name: 'iOS', path: <><rect x="18" y="7" width="20" height="42" rx="6" /><path d="M25 12h6" /><circle cx="28" cy="45" r="2.2" /></> },
  { name: '鸿蒙', path: <><circle cx="28" cy="28" r="18" /><circle cx="28" cy="28" r="10" /><circle cx="28" cy="28" r="2.6" /></> },
];

function Platforms(): React.JSX.Element {
  return (
    <div className="pd-body">
      <Eyebrow>多端覆盖</Eyebrow>
      <h2 className="pd-h2">一份 UI 单源，七端同一套核心</h2>
      <div className="pd-platforms">
        {PLATFORMS.map((item) => (
          <div key={item.name} className="pd-platform">
            <svg viewBox="0 0 56 56" fill="none" stroke="var(--ht-color-primary)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              {item.path}
            </svg>
            <span>{item.name}</span>
          </div>
        ))}
      </div>
      <p className="pd-note pd-note--plain">
        一份 RN 组件实现，各端渲成该平台的原生控件；各端唯一的平台差异，是注入哪个 SQLite 驱动。
      </p>
    </div>
  );
}

const PLANS: readonly { name: string; price: string; period: string; items: readonly string[]; hot?: boolean }[] = [
  { name: '开源自建', price: '免费', period: '永久 · MIT 许可', items: ['除云端 AI 外的全部功能', '设备数不限，不校验', '数据与密钥都留在你手里'] },
  { name: '官方托管', price: '¥5 / 月', period: '大陆（海外 $5 / 月）', items: ['功能与自建完全一致', '多设备之间自动同步', '服务端记录完整保留，到期不删'] },
  { name: '官方托管 + 云端 AI', price: '¥12 / 月', period: '大陆（海外 $12 / 月）', items: ['上面这一档的全部', '云端 AI，每月 300 次', '自带端点的 AI 仍免费、不限次'], hot: true },
];

function Pricing(): React.JSX.Element {
  return (
    <div className="pd-body">
      <Eyebrow>商业模式</Eyebrow>
      <h2 className="pd-h2">软件永久免费，只对托管和 AI 收费</h2>
      <div className="pd-plans">
        {PLANS.map((plan) => (
          <div key={plan.name} className={plan.hot === true ? 'pd-plan pd-plan--hot' : 'pd-plan'}>
            <span className="pd-plan__name">{plan.name}</span>
            <span className="pd-plan__price">{plan.price}</span>
            <span className="pd-plan__period">{plan.period}</span>
            <ul className="pd-plan__items">
              {plan.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="pd-note">
        两个付费档都不阉割功能 —— 第二档贵出来的钱买的是我们的云端 AI，不是解锁功能。
      </p>
      <p className="pd-fine">
        收银台已经接通，但大陆与海外的支付通道都还在等支付商资质 —— 现在还不能下单。
      </p>
    </div>
  );
}

const PHASES: readonly { name: string; state: string; done: boolean }[] = [
  { name: 'P0 奠基', state: '已完成', done: true },
  { name: 'P1 单端闭环', state: '已完成', done: true },
  { name: 'P2 多端补齐', state: '进行中', done: false },
];

function Roadmap(): React.JSX.Element {
  return (
    <div className="pd-center">
      <Eyebrow>路线图</Eyebrow>
      <div className="pd-phases">
        {PHASES.map((phase) => (
          <div key={phase.name} className={phase.done ? 'pd-phase' : 'pd-phase pd-phase--active'}>
            <span className="pd-phase__mark" aria-hidden="true">
              {phase.done ? '✓' : '◔'}
            </span>
            <span className="pd-phase__name">{phase.name}</span>
            <span className="pd-phase__state">{phase.state}</span>
          </div>
        ))}
      </div>
      <h2 className="pd-cover__title pd-cover__title--sm">把清单搬回自己的机器</h2>
      <p className="pd-cover__sub pd-cover__sub--sm">
        代码开放，自建永久免费；一条命令就能起自己的服务端，把数据搬回来。
      </p>
      <div className="pd-ctas">
        <span className="pd-cta pd-cta--solid">开始自建</span>
        <span className="pd-cta">GitHub · MIT</span>
      </div>
    </div>
  );
}

/* ── 幻灯片表 ─────────────────────────────────────────── */

interface Slide {
  readonly id: string;
  readonly tone: 'light' | 'dark';
  readonly render: () => React.JSX.Element;
}

const SLIDES: readonly Slide[] = [
  { id: 'cover', tone: 'light', render: () => <Cover /> },
  { id: 'problem', tone: 'dark', render: () => <Problem /> },
  { id: 'why-now', tone: 'light', render: () => <WhyNow /> },
  { id: 'solution', tone: 'light', render: () => <Solution /> },
  { id: 'app-tasks', tone: 'light', render: () => <AppTasks /> },
  { id: 'app-quadrant', tone: 'light', render: () => <AppQuadrant /> },
  { id: 'app-habits', tone: 'light', render: () => <AppHabits /> },
  { id: 'app-focus', tone: 'light', render: () => <AppFocus /> },
  { id: 'app-timeline', tone: 'light', render: () => <AppTimeline /> },
  { id: 'overview', tone: 'light', render: () => <Overview /> },
  { id: 'privacy', tone: 'dark', render: () => <Privacy /> },
  { id: 'ai', tone: 'light', render: () => <Ai /> },
  { id: 'platforms', tone: 'light', render: () => <Platforms /> },
  { id: 'pricing', tone: 'light', render: () => <Pricing /> },
  { id: 'roadmap', tone: 'dark', render: () => <Roadmap /> },
];

/* ── 外壳 ─────────────────────────────────────────────── */

function useStageScale(ref: React.RefObject<HTMLDivElement | null>): number {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const measure = (): void => {
      setScale(Math.min(el.clientWidth / STAGE_W, el.clientHeight / STAGE_H));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return scale;
}

export function PitchDeck(): React.JSX.Element {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [grid, setGrid] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const scale = useStageScale(viewportRef);

  const go = useCallback((delta: number): void => {
    setIndex((current) => Math.min(SLIDES.length - 1, Math.max(0, current + delta)));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      switch (event.key) {
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          event.preventDefault();
          go(1);
          break;
        case 'ArrowLeft':
        case 'PageUp':
          event.preventDefault();
          go(-1);
          break;
        case 'Home':
          setIndex(0);
          break;
        case 'End':
          setIndex(SLIDES.length - 1);
          break;
        case 'f':
        case 'F':
          if (document.fullscreenElement === null) void document.documentElement.requestFullscreen();
          else void document.exitFullscreen();
          break;
        case 'a':
        case 'A':
          setPlaying((current) => !current);
          break;
        case 'g':
        case 'G':
          setGrid((current) => !current);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % SLIDES.length);
    }, AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [playing]);

  const current = SLIDES[index] ?? SLIDES[0]!;

  return (
    <div className="pd-root">
      <div className="pd-viewport" ref={viewportRef}>
        <div
          className={grid ? 'pd-stage pd-stage--grid' : 'pd-stage'}
          style={{
            width: STAGE_W,
            height: STAGE_H,
            transform: grid ? 'none' : `scale(${String(scale)})`,
          }}
        >
          {grid
            ? SLIDES.map((slide, i) => (
                <button
                  type="button"
                  key={slide.id}
                  className={`pd-slide pd-slide--${slide.tone} pd-slide--thumb${i === index ? ' pd-slide--current' : ''}`}
                  onClick={() => setIndex(i)}
                >
                  <div className="pd-thumbIndex">{String(i + 1)}</div>
                  <div className="pd-thumbInner">{slide.render()}</div>
                </button>
              ))
            : (
                <div className={`pd-slide pd-slide--${current.tone}`} key={current.id}>
                  {current.render()}
                </div>
              )}
        </div>
      </div>

      <div className="pd-bar">
        <div className="pd-bar__track">
          <div className="pd-bar__fill" style={{ width: `${String(((index + 1) / SLIDES.length) * 100)}%` }} />
        </div>
        <span className="pd-bar__n">
          {String(index + 1).padStart(2, '0')} / {String(SLIDES.length)}
        </span>
        <span className="pd-bar__hint">← → 翻页 · F 全屏 · A 自动播放 · G 总览</span>
      </div>
    </div>
  );
}
