# B4 installed macOS Widget/help acceptance

- Timestamp: 2026-10-08T10:52:55+08:00
- Artifact: `/Applications/Heyta.app` (`cloud.finlaw.heyta.desktop`, version `1.0.0`)
- Source reference: B4 (supplied acceptance target)
- Git worktree reference: `b081811c`
- Scope: installed app UI only; no build, install, production-source edit, Android, or iOS action.

## Preconditions

- Lock-screen read: `IOConsoleLocked=No`; no unlock or password action was attempted.
- `open -a /Applications/Heyta.app` brought Heyta to the foreground. `mac idle` reported `前台 app: heyta`.
- Heyta's AX WebArea URL before and after the help action was `heyta-local://app/index.html`.

## UI path and Widget text

Using the visible installed app through macOS Accessibility (CUA):

1. Opened `账号` → `应用设置`.
2. Confirmed the `任务与显示` settings section.
3. Read the live Widget section from the AX tree:
   - `桌面小组件`
   - `查看此桌面应用的小组件支持情况。`
   - `正在原生桌面应用中运行`
   - `当前桌面应用暂不支持系统小组件。你仍可在应用内查看任务、习惯与专注进度。`
4. No numbered Widget install guide was exposed in this section (`INSTALL_GUIDE_MATCH=false` by the section shape).

The AX tree was the acceptance evidence for this semantic content. A window-level raster capture was retained as [b4-settings-task-display.png](b4-settings-task-display.png), but it did not render the settings body reliably, so it is not used to claim the Widget/help result.

## Help handoff

1. Clicked the live `关于与帮助` settings button.
2. Confirmed the live external link `帮助中心 使用指南与常见问题`, value `heyta.waytofuture.cn/docs`.
3. Clicked that link.
4. Heyta remained alive and its AX WebArea remained `heyta-local://app/index.html`.
5. `mac idle` and System Events reported the frontmost app as `Google Chrome`.
6. Chrome AX exposed a selected tab titled `帮助中心 —— heyta` with URL `heyta.waytofuture.cn/docs/` and the Help Centre page content.

Result: the installed app handed Help Centre navigation to the system browser, while the Heyta app stayed on its internal `heyta-local://app/index.html` address.

