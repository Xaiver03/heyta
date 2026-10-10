# macOS WidgetKit extension

`HeytaWidgets.xcodeproj` builds a native macOS `.appex`. The entry point lists the four widgets from the existing `HeytaWidgetKit` Swift package; rendering and snapshot contracts remain shared with iOS. The extension never opens the business SQLite database.

The host injects `__heytaNativeWidgetBridge` only into its main application frame. Methods delegate to `WidgetBridgeService`; snapshot selection and task writes belong to the shared Web/app-host lifecycle. Widget task intents append to the shared queue, then notify an already running macOS host via a payload-free distributed notification. A stopped host drains on its next launch.

`package-app.sh` builds and embeds the extension, signs it with sandbox entitlements, then signs the host. Both need a matching, unexpired **Developer ID (`MAC_APP_DIRECT`) profile** installed under Xcode's local provisioning profiles directory. `find-signing-profile.py` locates it by the exact bundle and team. Create/download/install profiles with `asc-signing-setup`; certificates and profiles stay outside the repository. A plain codesign verification does not establish entitlement authorization: an unprovisioned Keychain entitlement is rejected at launch by AMFI.

The macOS App Group is `<team>.cloud.finlaw.heyta.widgets`, supplied through each bundle's Info.plist. iOS retains `group.com.heyta`. The group holds encrypted snapshots and intent queues. Keys are shared through the provisioned Keychain access group, with the macOS Data Protection Keychain explicitly selected by both writer and reader.

Do not claim Gallery support from `xcodebuild` or `pluginkit` alone. Runtime acceptance requires adding the native Mac widget from the system Gallery, showing a newly created host task, completing it in the widget, and observing the resulting single op in the host. Keep QA app/database paths isolated from an existing installation.
