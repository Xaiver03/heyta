# Android system widget acceptance (emulator-5554)

Date: 2026-10-08. Device: `emulator-5554` (`sdk_gphone64_arm64`). Existing installed QA package: `com.heyta` (no install/build performed).

## Source and installed registration

`apps/mobile/android/app/src/main/AndroidManifest.xml` registers these four `APPWIDGET_UPDATE` receivers, all with `android:exported="false"` and their own `appwidget-provider` XML:

- `com.heytamobile.widget.TodayWidgetProvider` → `@xml/widget_today_info`
- `com.heytamobile.widget.QuadrantWidgetProvider` → `@xml/widget_quadrant_info`
- `com.heytamobile.widget.HabitsWidgetProvider` → `@xml/widget_habits_info`
- `com.heytamobile.widget.FocusWidgetProvider` → `@xml/widget_focus_info`

The installed package dump is `package-dumpsys.txt`. The Launcher system picker showed `heyta` with `4 widgets`; its expanded gallery exposed `Focus`, `Today's habits`, `Today's tasks`, and `Quadrants` descriptors in `06-heyta-widget-gallery-scroll.xml` / `06-heyta-widget-gallery-scroll.png`.

## System UI results

All four were added through the Pixel Launcher Widgets picker using the visible `Add` action, producing four live AppWidget instances. `appwidget-final.txt` lists all four providers under the Launcher host. Live RemoteViews were visible for each:

- Focus: `No focus session running` (`11-focus-added.png`)
- Today's habits: `No habits yet`, with real date/count header (`16-habits-added.png`)
- Today's tasks: `Nothing for today`, with real date/count header (`22-tasks-added.png`)
- Quadrants: real QA task `AndroidAtomicCUpdated` in `Neither 0/1` (`27-quadrants-added.png`)

The Quadrants widget was resized wider with the system resize handle and still rendered the same live task (`28-quadrants-resized-width.png`). Tapping its header opened `com.heytamobile.MainActivity` (`31-header-click-activity.txt` and `31-header-click.xml`). Tapping the live task row once changed the widget to `Neither 1/1` / `✓ AndroidAtomicCUpdated` (`33-after-widget-toggle.png`). Pulling the SQLite database before and after showed ops increasing from 8 to 9, with exactly one new `UPD_TASK` op for that task (`db-before-ops.txt`, `db-after-last3.json`); after opening the app, the foreground was `MainActivity` and the queued intent was drained.

## Theme result / finding

Launcher light and dark states were exercised (`37-quadrants-light-widget.png`, `38-quadrants-dark-widget.png`; final device state restored to `Night mode: yes`). The Launcher chrome changes to dark, but the widget card remains the same light surface in both states. This is a real UI finding against the requested dark-theme behavior. The layouts currently use `?android:attr/colorBackground` / `textColorPrimary`, but the installed RemoteViews did not follow Launcher night mode in this run.

