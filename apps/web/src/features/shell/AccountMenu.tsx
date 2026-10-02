import { ICON_SIZE } from '@heyta/design-system';
/**
 * 账号菜单（左侧导航顶部）
 * ========================
 *
 * 照滴答的 rail：**顶部是头像，点开才是账号相关的一切**。
 *
 * ## 为什么这几个入口要收进头像后面
 *
 * 产品负责人 2026-09-29 给的做法（滴答截图实测）：rail 上段只放"去哪看"，
 * 而**账号相关的一律收进头像**。理由与「功能模块」是同一个：
 * rail 是**每天点几十次**的地方，而"登录/注册/设置/统计/退出登录"是低频的 ——
 * 它们占着 rail 的每一屏，换来的只是每次扫读时多几个要跳过的词。
 *
 * ## 🔴 2026-09-30 修正：身份入口**只能有一个**，而且登录/注册在菜单里
 *
 * 产品负责人实测："注册登录那个地方排版还是不对吧？应该是点击头像出来注册、登录吧？"
 * —— 上一版把「登录 / 注册」做成头像**旁边**的第二个控件（一个常驻 ghost pill）。
 * 那有两个真问题：
 *
 * 1. **身份入口有两个**（头像 + pill）：点哪个才是"登进去"？两个都长得像账号入口，
 *    而它们开的是同一块面板 —— 用户要先猜一次。
 * 2. **未登录的人也看到「退出登录」**：菜单里那三项（设置/统计/退出登录）曾经
 *    无条件渲染。「退出登录」是**会清掉本机凭据**的动作，对一个根本没登录的人
 *    渲染它，等于给了一个按不出效果的危险按钮 —— 那是把"危险动作"降级成噪音。
 *
 * 现在的形态（通行做法，见 §"依据"）：
 *
 * ```
 *   未登录                          已登录
 *   ┌──────────────────┐            ┌──────────────────┐
 *   │ [→] 登录 / 注册   │  ← 主操作  │ user@example.com │  ← 身份区
 *   │     设置          │            │     设置          │
 *   │     统计          │            │     统计          │
 *   └──────────────────┘            │     退出登录      │  ← 危险、最底
 *                                   └──────────────────┘
 * ```
 *
 * 依据（外部调研，2026-09-30）：
 * - UsabilityGeek《The UX Logout Lapse》：把账号管理动作收进头像菜单是**每日使用**
 *   的个性化服务的通行做法（heyta 正是：一天开几十次）；但**藏得太深看起来像
 *   不想让你走** —— 所以菜单必须一点就到，且"退出"要在最显眼的位置（最底）。
 *   <https://usabilitygeek.com/ux-logout-lapse/>
 * - SaaSUI《SaaS Profile & Account UX Patterns (2026)》：账号面要**以身份区开头**
 *   （头像 + 邮箱），危险动作放**明确分隔的 danger zone、永远在最底**，
 *   且绝不能让破坏性动作与常规项**同样的视觉分量**。
 *   <https://www.saasui.design/blog/saas-profile-account-ux-patterns>
 *
 * ⚠️ 「登录 / 注册」在菜单里**不是**把前置性降级：前置的判据是
 * "冷启动 ≤1 次点击能看见身份入口、≤2 次到表单"，不是"入口必须常驻在屏幕上"。
 * 判据本体在 `apps/web/tests/signin-entry.spec.tsx`，定义见
 * `docs/plans/user-journey-and-auth.md` §0。
 *
 * ## 另外两个刻意的决定
 *
 * 1. **头像里是邮箱首字母**，不是随机色块或通用图标。
 *    邮箱从落盘的凭据里来（见 `credential-storage.ts`）—— 刷新之后仍然拿得到，
 *    所以不会出现"刚登录是首字母、刷新后变通用图标"这种自相矛盾。
 *    ⚠️ 拿不到邮箱时（手填凭据那条路径、或老版本凭据）**退回通用图标**，
 *    而不是编一个字母 —— 编出来的首字母会让人以为那是他的账号。
 *
 * 2. **🔴 面板是 `position: fixed` + 实测锚点，不是 `absolute`。**
 *    `nav.ht-rail` 是 `overflow-y: auto` 的裁剪容器（它的子元素超出边界就被切掉），
 *    而面板 `min-width: 12rem`(192px) > rail 宽 `11rem`(176px) —— 上一版
 *    `absolute` 的面板**右侧一直有 16px 被切**（`.ht-rail`/`.ht-inbox__panel`
 *    的注释早就记了这条，只是没人回头修）。塌缩态（≤768px）更糟：rail 变成
 *    底部导航且 `overflow-y: hidden`，向下弹的面板**整块看不见**。
 *    所以这里改成 fixed，并且**向下弹不开就向上翻**：塌缩态 rail 在底部，
 *    只有向上才是视口里的方向。锚点用 `getBoundingClientRect` 实测（而不是
 *    从 `--ht-layout-rail-width` 硬算）—— 塌缩态 rail 根本不在左边，
 *    任何"从 rail 宽度推坐标"的算法在那一档必然是错的。
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from '@heyta/i18n';
import { CircleUser, LogIn, LogOut, Settings, TrendingUp } from 'lucide-react';

/**
 * 读一个 token 的像素值。
 *
 * 🔴 JS 里**不抄一份数字**：间距的唯一来源是 `tokens.css`
 * （与 `QuadrantBoard` 读 `--ht-layout-two-column-min` 同一条纪律；
 * 而且裸值会被 `check:design` 拦）。
 */
function tokenPx(name: string): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : 0;
}

export function AccountMenu({
  email,
  showSignIn = false,
  onSignIn,
  onOpenSettings,
  onOpenGrowth,
  growthEnabled = false,
  onSignOut,
  testID = 'account-menu',
}: {
  /** 账号邮箱。`undefined` = 不知道（见文件头第 1 条）。 */
  email?: string;
  /**
   * 🔴 未登录（`token === undefined`）。
   *
   * 未登录时菜单第一项是「登录 / 注册」**主操作**，且**不出现「退出登录」**
   * （见文件头：给没登录的人一个会清凭据的按钮是纯噪音）。
   * 已登录后主操作消失、身份区与退出登录出现。
   */
  showSignIn?: boolean;
  /** 打开「登录 / 注册」面板。`showSignIn` 为真时它是菜单的第一项。 */
  onSignIn: () => void;
  onOpenSettings: () => void;
  onOpenGrowth: () => void;
  /**
   * 🔴 「成长」模块是否启用（功能模块开关）。
   *
   * 不传（或 false）时**不渲染那一条**：关掉一个模块的语义是"它从界面上消失"，
   * 而菜单里留一条能进去的入口就是绕过那条开关（rail 上那条已经按开关过滤了）。
   */
  growthEnabled?: boolean;
  onSignOut: () => void;
  testID?: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const avatarRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  /** 面板的 fixed 坐标。`undefined` = 还没量（只在挂载那一帧，人看不到）。 */
  const [pos, setPos] = useState<{ top: number; left: number } | undefined>(undefined);

  /** 首字母：取邮箱 @ 之前那一段的第一个字符。 */
  const initial = ((): string | undefined => {
    if (email === undefined) return undefined;
    const local = email.split('@')[0] ?? '';
    const first = local.trim().charAt(0);
    return first === '' ? undefined : first.toUpperCase();
  })();

  // 点外部关闭。`mousedown` 而不是 `click`：在拖动选择文本时 `click` 不触发，
  // 于是"点空白处关不掉"会变成偶发现象。
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  /**
   * 锚点：面板 fixed 到触发器下方（放不下就上方），并夹在视口内。
   *
   * 在 layout effect 里量（不是 effect）：面板与坐标同一次提交里就位，
   * 人看不到"先在左上角闪一下再跳过去"。
   */
  useLayoutEffect(() => {
    if (!open) {
      setPos(undefined);
      return;
    }
    const place = (): void => {
      const trigger = wrapRef.current?.getBoundingClientRect();
      const panel = panelRef.current;
      if (trigger === undefined || panel === null) return;
      const gap = tokenPx('--ht-space-1');
      const edge = tokenPx('--ht-space-2');
      const size = panel.getBoundingClientRect();
      // 🔴 **哪边空间大就往哪边弹**，不是"下面装不下才翻上去"。
      //    塌缩态（≤768px）的头像在**底部导航**里：下方虽然还塞得下（面板矮），
      //    但那样面板会盖住底部导航自己 —— 而"菜单盖住触发它的那条栏"
      //    是实测被判错的那种形态（e2e `account-menu.spec.ts` 的塌缩态用例）。
      const roomAbove = trigger.top - gap - edge;
      const roomBelow = window.innerHeight - trigger.bottom - gap - edge;
      const flipUp = roomAbove > roomBelow;
      const top = flipUp
        ? Math.max(edge, trigger.top - gap - size.height)
        : trigger.bottom + gap;
      const left = Math.min(
        Math.max(edge, trigger.left),
        Math.max(edge, window.innerWidth - size.width - edge),
      );
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    // 🔴 捕获阶段：rail / main 自己是滚动容器，滚动事件**不冒泡**到 window，
    //    冒泡阶段挂上去等于没挂（面板会停在原地，而内容已经滚走）。
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  /**
   * 打开时把焦点送进菜单（WAI-ARIA menu-button 形态：菜单获得焦点，
   * 第一个条目是入口）。**不给** `tabIndex=0` 的条目：菜单是一组互斥选项，
   * 不是一个 Tab 序列 —— 所以全部 `tabIndex=-1`，靠方向键走。
   */
  useEffect(() => {
    if (!open) return;
    const first = panelRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    first?.focus();
  }, [open]);

  const close = (returnFocus = false): void => {
    setOpen(false);
    if (returnFocus) avatarRef.current?.focus();
  };

  /** 菜单内的方向键走动（首尾相接）+ Esc / Tab 关闭。 */
  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const items = Array.from(
      panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
    );
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === 'Tab') {
      // 菜单不是对话框：Tab 走人就该收起（ARIA menu-button 形态）。
      close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const from = current === -1 ? (step === 1 ? -1 : 0) : current;
      items[(from + step + items.length) % items.length]?.focus();
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
    }
  };

  const item = (
    label: string,
    Icon: typeof Settings,
    onClick: () => void,
    testId: string,
    tone?: 'danger' | 'primary',
  ): React.JSX.Element => (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      data-testid={testId}
      className={`ht-accountmenu__item${tone === undefined ? '' : ` ht-accountmenu__item--${tone}`}`}
      onClick={() => {
        close();
        onClick();
      }}
    >
      <Icon size={ICON_SIZE.xs} aria-hidden="true" />
      {label}
    </button>
  );

  return (
    <div className="ht-accountmenu" ref={wrapRef}>
      <button
        type="button"
        ref={avatarRef}
        className="ht-accountmenu__avatar"
        data-testid={`${testID}-avatar`}
        aria-haspopup="menu"
        aria-expanded={open}
        // 头像的可访问名要说清它是账号，而不是"一个圆形按钮"。
        aria-label={email === undefined ? t('web.shell.account.aria') : t('web.shell.account.ariaAs', { email })}
        onClick={() => {
          setOpen((was) => !was);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            close();
            return;
          }
          // 键盘用户不点鼠标：打开菜单最自然的一下是 ↓
          //（Enter/Space 走浏览器默认的 click）。
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {initial === undefined ? (
          <CircleUser size={ICON_SIZE.md} aria-hidden="true" />
        ) : (
          <span aria-hidden="true">{initial}</span>
        )}
      </button>

      {open ? (
        <div
          role="menu"
          ref={panelRef}
          aria-label={t('web.shell.account.aria')}
          className="ht-accountmenu__panel ht-material"
          data-testid={`${testID}-panel`}
          style={pos === undefined ? { visibility: 'hidden' } : { top: pos.top, left: pos.left }}
          onKeyDown={onMenuKeyDown}
        >
          {/* 不知道账号时**不编一个** —— 那行只在真有邮箱时出现。 */}
          {email === undefined ? null : (
            <div className="ht-accountmenu__who" data-testid={`${testID}-email`}>
              {email}
            </div>
          )}
          {/*
            未登录：登录/注册是这一组里的**主操作**（第一项、强调样式）；
            已登录：完全不出现（不给已登录的人看"去登录"）。
          */}
          {showSignIn
            ? item(t('web.auth.title'), LogIn, onSignIn, 'sync-signin-entry', 'primary')
            : null}
          {item(t('web.shell.account.settings'), Settings, onOpenSettings, `${testID}-settings`)}
          {/*
            「成长」用**与 rail 同一条词条**（`web.shell.views.growth` = 成长）——
            此前这里单独一条 `web.shell.account.growth` = 「统计」，于是**同一个视图
            两个名字**（rail 叫成长、菜单叫统计），而两边点下去都是 `setView('growth')`。
            并且它按**功能模块开关**决定是否渲染：模块关掉的语义是"从界面消失"，
            菜单里留一条能进去的入口就是绕过那条开关。
          */}
          {growthEnabled
            ? item(t('web.shell.views.growth'), TrendingUp, onOpenGrowth, `${testID}-growth`)
            : null}
          {/* 🔴 退出登录只在**已登录**时出现，且永远在最底、危险色。
              未登录时它不是"暂时没用"，而是**语义上不存在**。 */}
          {showSignIn
            ? null
            : item(t('web.shell.account.signOut'), LogOut, onSignOut, `${testID}-signout`, 'danger')}
        </div>
      ) : null}
    </div>
  );
}
