# Universal React Native testing research（RN 0.84 / Hermes / RNOH / react-native-web）

> 🔴 **这是 AI 子代理产出的调研原料，未经人工逐条核实。**
> 产出时间：2026-09-27。产出方式：调研期间 `web_search` 全程返回 HTTP 432（不可用），
> 子代理改用 AnySearch CLI + `web_fetch` 直取一手来源。文中自称 `full-text verified`
> 与 `snippet-level` 的标注**是它自己的判断，搬进本文件的人没有复核过其中任何一条**。
>
> 用途：作为 [多端融合调研](../docs/research/multi-platform-ui-fusion.md) 的**输入原料**，
> 不是结论。引用其中的版本号或 API 行为之前**必须重新核对**。
>
> 与仓库约定不符之处（无状态行、英文正文）是**刻意保留原样**的 —— 它是原料，
> 不在 `docs/` 文档体系内。

---

# Universal React Native testing research — RN 0.84 + Hermes (iOS/Android/HarmonyOS-RNOH) + react-native-web

Source-backed research. Every claim below is either **full-text verified** (I fetched the page and quote/paraphrase it) or explicitly marked **snippet-level**. Versions are the npm registry `latest` tag at research time. `web_search` was broken; used AnySearch CLI + `web_fetch`.

---

## 1. Unit / component testing: what actually works

### 1.1 `@testing-library/react-native` (RNTL) — current state

- **Latest: `@testing-library/react-native@14.0.1`** (npm registry `latest`).
  - `peerDependencies`: `jest >=29.0.0` (**optional**), `react >=19.0.0`, `react-native >=0.78`, `test-renderer ^1.0.0`.
  - Dev deps it is actually built/tested against: `react 19.2.3`, `react-native 0.85.3`, `jest ^30.4.2`, `@react-native/jest-preset 0.85.3`.
  - Source: https://registry.npmjs.org/@testing-library/react-native/latest
- **RNTL v14 requires React 19** and a new renderer, **`test-renderer@1.3.0`** (not `react-test-renderer`). `test-renderer` declares `supportedReactRange: ">=19.0.0 <19.4.0"` and peer `react ^19.0.0`.
  - Source: https://registry.npmjs.org/test-renderer/latest
- RNTL docs confirm: *"This library has a peer dependency on Test Renderer… Test Renderer has better compatibility with React 19 and improved type safety compared to the deprecated React Test Renderer."* Install is `@testing-library/react-native` + `test-renderer`, and RNTL auto-extends Jest matchers.
  - Source: https://oss.callstack.com/react-native-testing-library/docs/start/quick-start
- **What RNTL does NOT cover** (full-text, from the official FAQ):
  - *"Can I test the native features of React Native apps? Short answer: no."*
  - It does not run the React Native renderer; it uses Test Renderer.
  - Limitations: cannot test native features; *"Tests don't execute native code"*; *"Tests are unaware of view state managed by native components, e.g., focus, unmanaged text boxes"*; *"Assertions don't operate on native view hierarchy"*; *"Runtime behaviors are simulated, sometimes imperfectly."*
  - Source: https://oss.callstack.com/react-native-testing-library/docs/guides/faq and https://oss.callstack.com/react-native-testing-library/docs/advanced/testing-env
- v14 change worth noting: the tree is **host-only** (composite components are invisible to queries). Source: same testing-env page.

### 1.2 Can RNTL run under **Vitest** instead of Jest? — Yes, now there is real tooling

RNTL itself was historically runner-agnostic but untested outside Jest:

- Official docs (testing-env) state it *"runs in a Node.js environment using Jest (or any other JavaScript test runner)"*, and the FAQ lists a benefit: *"Runs tests on any OS supported by Jest or other test runners, e.g., on CI."*
  - Sources: https://oss.callstack.com/react-native-testing-library/docs/advanced/testing-env , https://oss.callstack.com/react-native-testing-library/docs/guides/faq
- **2022 maintainer answer** (Discussion #1142, still the canonical "vitest?" thread): maintainer `mdjastrzebski` — *"We try no[t] to add any code that would force running on Jest, so there are high chance[s] that RNTL will work with it out-of-the-box or with minor tweaks. However this is something we didn't try yet."* The thread is unanswered and dates to Sep 2022.
  - Source: https://github.com/callstack/react-native-testing-library/discussions/1142
- **2026 answer: `vitest-native@0.13.0`** — description *"Run real React Native tests under Vitest. One install, zero config."*
  - `peerDependencies`: `vitest >=4 <6`, `vite ^6.4.2 || ^7.3.2 || ^8.0.5`, `react >=18`, `@testing-library/react-native >=12 <15` (optional). Exports include `vitest-native/jest-compat`, `vitest-native/rntl-matchers`, `vitest-native/matchers`, `vitest-native/serializer`.
  - Source: https://registry.npmjs.org/vitest-native/latest
  - README: default `engine: 'native'` runs real RN JS and mocks only the native boundary; requirements table says **RN 0.81–0.86 validated**, **Vitest 4.x**, **RNTL 12/13/14**, Node ≥20.19 (RNTL 14 needs Node ≥22.13). It is explicitly **Beta**, with a CI-gated cross-check. RNTL 14 made `render`/`fireEvent`/`act` **async** — must `await render(...)`.
  - Sources: https://raw.githubusercontent.com/danfry1/vitest-native/main/README.md and https://raw.githubusercontent.com/danfry1/vitest-native/main/packages/vitest-native/README.md
  - Config is a single Vite plugin: `plugins: [reactNative()]`; `platform: 'ios' | 'android'` selects RN platform resolution.
  - NOTE discrepancy between the two READMEs in the repo: root README says *"React Native 0.81–0.87 validated in CI"*, package README says *"0.81–0.86 validated"*. Treat the range as ~0.81–0.87 and verify against your pinned RN.
- Related/competing options found and verified:
  - **`vitest-mobile`** (pzuraq) — announced in Vitest Discussion #10160 (Apr 18, 2026): *"Vitest Mobile actually boots a full emulator/simulator and runs the tests in the real environment."* It is positioned vs `vitest-native` and `vitest-react-native`. Source: https://github.com/vitest-dev/vitest/discussions/10160
  - **React Native Harness** (Callstack) — *"Test Native Modules with JavaScript"*, Jest-compatible `describe/it/expect`, *"Execute tests on iOS simulators, Android emulators, or in a real browser (Web), with native modules available where the platform provides them."* Source: https://www.react-native-harness.dev/

**Practical read for your repo:** you already run Vitest on mobile and web/platforms. `vitest-native` is the only off-the-shelf bridge that runs **RNTL 14 tests under Vitest against real RN JS**; it is Beta with peer `vitest >=4 <6`, so pinning matters. Otherwise stay on Jest + `jest-expo` for native and Vitest only for web. Do **not** assume the 2022 discussion is still the state of the art.

### 1.3 Jest presets: `react-native`/`@react-native/jest-preset` vs `jest-expo`

- Bare RN preset:
  - Jest docs (last updated **Aug 28, 2026**): default config is `preset: 'react-native'`; *"Recent versions of React Native moved the preset into its own package, `@react-native/jest-preset`."* The preset is a Node environment that mocks RN and *"doesn't load any DOM or browser APIs."*
  - Latest `@react-native/jest-preset@0.87.1` (peer `react ^19.2.3`). Source: https://registry.npmjs.org/@react-native/jest-preset/latest
  - Sources: https://jestjs.io/docs/tutorial-react-native
- `jest-expo`:
  - Latest **`jest-expo@57.0.5`**; `package.json` sets `"jest": { "preset": "jest-expo/universal" }`; peer `@react-native/jest-preset ^0.86.3`, `expo`, `react-native`, `react-server-dom-webpack`. Source: https://registry.npmjs.org/jest-expo/latest
  - README (full-text): *"The recommended way to test your project is with `jest-expo/universal` which runs your tests with every Expo supported platform. Currently this includes iOS, Android, web, and Node (which is used for testing SSR compliance)."* You can also compose individual runners via Jest `projects`: `jest-expo/ios`, `jest-expo/android`, `jest-expo/web`, `jest-expo/node`. `getWebPreset()` *"runs in a JSDOM environment for testing Expo web."* Snapshots are per-platform (`.snap.ios`, `.snap.web`, …).
  - Source: https://raw.githubusercontent.com/expo/expo/main/packages/jest-expo/README.md
  - Expo official docs (page `modificationDate: September 17, 2026`) still say **Jest is the path**: install `jest-expo jest @types/jest`, `preset: "jest-expo"`, then `@testing-library/react-native`. It explicitly deprecates `react-test-renderer` because *"react-test-renderer does not support React 19 and above."*
  - Source: https://docs.expo.dev/develop/unit-testing.md
- **Is there an official Expo Vitest path?** None found. Expo's own docs only document Jest/`jest-expo`. I found no official Expo Vitest preset. (Thin/negative — see §6.)

---

## 2. One test suite for both targets: realistically shareable vs duplicated

Three distinct strategies exist; they are **not** equivalent.

### A. "RNTL everywhere" — NOT possible
RNTL renders **RN host elements via Test Renderer**, in a Node env; it does not use jsdom/React DOM and does not target react-native-web. Official docs: *"the React Testing Library (web one) works a bit differently… it has access to a simulated browser DOM environment from the `jsdom` package, which allows it to use a regular React DOM renderer. Unfortunately, there is no similar React Native runtime environment package [for RN]."* So an RNTL test file is native-only.
Source: https://oss.callstack.com/react-native-testing-library/docs/advanced/testing-env

### B. Web tests: `@testing-library/react` + `react-native-web` in jsdom (official, documented)
- RNW's **official Setup doc** documents aliasing `react-native` → `react-native-web` for **Jest**:
  ```js
  { "moduleNameMapper": { "^react-native$": "react-native-web" } }
  ```
  and for bundlers/compilers/Flow/Node. (Page updated **September 25, 2026**.)
  Source: https://necolas.github.io/react-native-web/docs/setup/
- Under Vitest, the same idea is done with `resolve.alias` + `environment: 'jsdom'`. A real, published example is assistant-ui's native-kit testing doc (full-text): *"The native kit tests its copied source with Vitest. It renders through `react-dom` into jsdom and resolves React Native components through `react-native-web`."* Its config aliases `"react-native": "react-native-web"`, maps `react-native-svg` to its web entry, orders `resolve.extensions` to prefer `.web.tsx/.web.ts/...`, and inlines native-oriented packages under `test.server.deps.inline`.
  Source: https://www.assistant-ui.com/docs/react-native/testing
- Historical real-world confirmation: react-testing-library issue #22 — *"I'm using it by rendering component with react-native-web. It works pretty well but you have to structure your components so you can render what…"* (2018; old but real).
  Source: https://github.com/testing-library/react-testing-library/issues/22
- RNW itself: **`react-native-web@0.21.3`**, peer `react ^18 || ^19`, `react-dom ^18 || ^19`. Source: https://registry.npmjs.org/react-native-web/latest
- **Sharing consequence:** a web test suite that imports RNTL `render`/`screen` cannot be pointed at RNW without a shim. What *is* shareable is (a) component source (`react-native` imports alias to RNW) and (b) test **logic/assertions** if you standardize on `@testing-library/react` on web and RNTL on native and accept two render/query imports — or add your own alias `@testing-library/react-native` → `@testing-library/react` for the web project (I found no official/comprehensive recipe for that alias; treat as custom, unverified).

### C. One Jest config, many platforms: `jest-expo/universal` or `projects`
- Documented, full-text: `jest-expo/universal` runs the same test on iOS, Android, web, and Node; or mix single-runner projects:
  ```diff
  "jest": {
  -  "preset": "jest-expo/universal"
  +  "projects": [ { "preset": "jest-expo/ios" }, { "preset": "jest-expo/android" } ]
  }
  ```
  Extensions `-test.ios.*`, `-test.android.*`, `-test.native.*`, `-test.web.*`, `-test.node.*` let you scope tests per platform; snapshots are per-platform.
  Source: https://raw.githubusercontent.com/expo/expo/main/packages/jest-expo/README.md
- This is the closest thing to "one suite for both targets" that is **officially documented**: one test file, run under multiple projects, with platform-specific snapshots and file extensions. It does **not** make RNTL's native rendering equal RNW's DOM rendering — platform-conditional assertions are still required.

**Recommendation-shaped summary (evidence-based):**
- Shareable: component source, token/style constants, pure-logic/util tests, `jest-expo/universal` test files with per-platform extensions.
- Duplicated: the render harness/query layer (RNTL vs RTL) unless you build a custom alias shim; and any assertion that depends on host tree vs DOM.

---

## 3. E2E per target: tool, status, New-Architecture status

### Web — Playwright
- Latest **`@playwright/test@1.63.0`** (peer none; `playwright@1.63.0` bundled; Node ≥20). Source: https://registry.npmjs.org/@playwright/test/latest
- For RNW web, Playwright drives the real browser; no RN-specific integration needed. (No RN/New-Arch caveat applies.)

### Native — Detox
- Latest **`detox@20.51.4`**; peer `jest 30.x.x || 29.x.x || 28.x.x || ^27.2.5` (optional). Source: https://registry.npmjs.org/detox/latest
- **New Architecture status — official and explicit** (Detox docs, "Version: 20.x"):
  - *"**RN `v0.77.x`–`v0.84.x`: Fully compatible with React Native's "New Architecture".** Newer RN versions might work with Detox, but they've not been thoroughly tested by the Detox team yet."*
  - Also: *"Expo integration with Detox is entirely a community-driven effort. There is no special support for Expo projects in Detox."*
  - Source: https://wix.github.io/Detox/docs/introduction/environment-setup/
- **This directly covers your RN 0.84 target**: Detox is the one native E2E tool whose official docs claim full New-Architecture compatibility for 0.84.
- Known New-Arch pain (issue, full-text title/body): wix/Detox issue **#4832** "Detox for Android not working with New architecture in CICD" (Sep 16, 2025). Source: https://github.com/wix/Detox/issues/4832 (title/labels via search; body not fully re-verified)
- **HarmonyOS / RNOH:** no upstream support. Open issue **#4968** (Aug 11, 2026, labels `status: triage`, `type: enhancement`): a community fork *"implemented HarmonyOS support for Detox, enabling RNOH (`@react-native-oh/react-native-harmony`) apps to be tested with the same Detox API as iOS and Android. **61/61 e2e tests pass** on a real HarmonyOS device"* (device: HarmonyOS 6.1.0, API 23). It reuses the Android FQCN namespace *"zero changes to Detox JS source"*, uses `@kit.TestKit`, and C++ JSI gray-box sync. Full fork linked at `gitcode.com/react-native/detox`. **Not merged upstream.**
  - Source: https://github.com/wix/detox/issues/4968 (body extracted full-text)

### Native — Maestro
- Latest release **CLI 2.10.0** (GitHub releases list "CLI 2.10.0 … Latest"). Source: https://github.com/mobile-dev-inc/maestro/releases
- Supported platforms per official docs index: *"Android, iOS, React Native, Flutter, and web applications via UI-layer automation."* **HarmonyOS is absent.** Sources: https://docs.maestro.dev/llms.txt and https://docs.maestro.dev/get-started/supported-platform
- RN support page (full-text): *"Maestro provides full support for React Native applications on both Android and iOS. By operating at the accessibility layer… zero instrumentation or modifications to your JavaScript/TypeScript source code."* Interactions via visible text or `testID`. Expo Go needs `openLink: exp://…` instead of `launchApp` with a custom appId.
  - Source: https://docs.maestro.dev/get-started/supported-platform/react-native.md
- **New Architecture:** no explicit official statement found in the RN supported-platform page or the Known Issues page (Known Issues covers Java versions, Android device quirks, `inputText` Unicode, iOS `hideKeyboard` flakiness, XCTest `willDisplayCell` pagination bug — **no New-Architecture section**). GitHub issue **#2202** "Compatibility with React Native New Architecture" (opened Dec 17, 2024) is **closed**, but I could not read any maintainer answer/comments (extraction returned an empty Activity section). Treat Maestro's New-Architecture support as **unverified/thin**.
  - Sources: https://docs.maestro.dev/extra-materials/troubleshooting/known-issues.md , https://github.com/mobile-dev-inc/maestro/issues/2202
- **HarmonyOS: officially unsupported and requested.** Open issue **#3196** (Apr 21, 2026): *"Does maestro have any plans to support HarmonyOS (it use hdc is similar to android's adb)"*; the reporter shows `maestro --platform harmony test test-harmony.yaml` → `Error: failed to create driver: unsupported platform: harmony`. No maintainer response visible; no PR linked.
  - Source: https://github.com/mobile-dev-inc/maestro/issues/3196 (body full-text)
- RNOH context (snippet-level only — not full-text verified): Software Mansion/Huawei blog *"Huawei x Software Mansion: Bringing React Native support to HarmonyOS NEXT"* describes RNOH; a daily.dev summary says RNOH supports RN 0.77/0.72 with 0.82 "in progress". Sources: https://swmansion.com/blog/huawei-x-software-mansion-bringing-react-native-support-to-harmonyos-next-82e02bd75549/ , https://gitee.com/rnoh/rnoh

**E2E bottom line for HarmonyOS:** Detox has a **community, unmerged** HarmonyOS client (61/61 on device, issue #4968); Maestro has **no** HarmonyOS support and an open request. Neither gives you an official, maintained HarmonyOS E2E gate today.

---

## 4. Design-token gating: concrete mechanisms with sources

### 4.1 Core lint primitives (verified)
- **`eslint-plugin-react-native@5.0.0`** rule **`no-color-literals`** — *"Detect color literals in styles… The rule looks at all properties that contain `color` (case-insensitive) in their name in either `StyleSheet` definitions or JSX properties that have `style` in their name."* Flags `backgroundColor: '#FFF'`, `color: 'blue'`, `rgba(...)`, etc.; allows variables/`this.state`/token consts.
  - Full-text: https://raw.githubusercontent.com/intellicode/eslint-plugin-react-native/master/docs/rules/no-color-literals.md
  - Version: https://registry.npmjs.org/eslint-plugin-react-native/latest
  - Limitation: **colors only**, name-must-contain-"color"; does not catch magic spacing numbers.
- **`stylelint-react-native@2.7.0`** — *"A collection of React Native specific rules for stylelint."* Peer `stylelint ^8–^16`. npm snippet says *"last published: a year ago"* (stale-ish).
  - Sources: https://registry.npmjs.org/stylelint-react-native/latest , listed under https://stylelint.io/awesome-stylelint/ (snippet)
  - Caveat: I did **not** verify that its rule set includes a token/scale enforcement rule. Treat "stylelint-react-native can gate tokens" as unverified.
- **ESLint core `no-restricted-syntax`** — the escape hatch for banning arbitrary literals, using AST selectors (e.g. `BinaryExpression[operator='in']`, and `AST selectors` for precise patterns). This is the primitive for banning hex strings / magic numbers in `StyleSheet.create` without a custom plugin.
  - Source: https://eslint.org/docs/latest/rules/no-restricted-syntax
- **Custom ESLint rules** are the documented route when built-ins/community rules don't cover a case. Sources: https://eslint.org/docs/latest/extend/custom-rules , https://eslint.org/docs/latest/extend/custom-rule-tutorial (the second via search; first fetched)

### 4.2 Ready-made token-enforcement plugins (verified)
- **`@aiuxmasters/eslint-plugin-design-tokens`** — flags hardcoded colors **and px values** in JSX inline `style` and in styled-components/emotion template literals. Rules: `no-hardcoded-style-values`, `no-hardcoded-css-in-js`. Skips `--custom-property: #fff` definitions and `var(--...)`. Scope limitation stated: *"Detects literal hex colors and `px` values… `rgb()`/`hsl()` functions and other unit types aren't covered yet."* Flat-config `configs.recommended`.
  - Source: https://raw.githubusercontent.com/aiuxmasters/eslint-plugin-design-tokens/main/README.md
- **`eslint-plugin-sitka-tokens`** (Sitka design system) — rule `sitka-tokens/token-usage`: *"Disallows hardcoded hex colors, px spacing, border-radius values, and shadow strings that don't match Sitka tokens."* Options include `tokenPath: "@/tokens/tokens.json"` and `allowFallback`. Documents a husky + lint-staged pre-commit setup (`"*.{ts,tsx}": ["eslint --fix"]`).
  - Source: https://jsrothwell.github.io/Sitka/tools/eslint-plugin/
  - NOTE: this is a design-system-specific package; it is a *pattern* to copy, not a drop-in.
- **`@kong/stylelint-plugin-design-tokens`** — CSS/SCSS token linting: `use-proper-token` (e.g. a text-color token must not be used for `background-color`) and `token-var-usage` (enforces `var(--token, $token)` fallback form). Real, published, with documented limitations (multi-line `var()`, interpolation).
  - Source: https://raw.githubusercontent.com/Kong/design-tokens/main/packages/stylelint-plugin-design-tokens/README.md
- **Atlassian `@atlaskit/eslint-plugin-design-system`**: search surfaced a changelog page, but my `web_fetch` of https://atlassian.design/components/eslint-plugin-design-system/ returned **empty content** — treat as unverified.

### 4.3 Token source-of-truth: Style Dictionary
- **`style-dictionary@5.5.5`** (Apache-2.0, Node ≥22, ESM). Description: *"Style once, use everywhere. A build system for creating cross-platform styles."* npm keywords include **"react native"**. Source: https://registry.npmjs.org/style-dictionary/latest
- Docs/repo state it integrates with a React Native app and exports to iOS/Android/CSS/JS/HTML etc. (the `create-react-native-app` example). This is **snippet-level** (search snippet of https://styledictionary.com/getting-started/examples/ and https://github.com/style-dictionary/style-dictionary/tree/main/examples ); I did not fetch those two pages' bodies.
- Established pattern (compose from the verified pieces): Style Dictionary emits a JS/TS token module consumed by both RNW and RN; `eslint-plugin-react-native/no-color-literals` (or a custom rule / `no-restricted-syntax`) blocks raw literals in `StyleSheet.create`, and a design-system-specific rule/plugin like the Sitka or aiuxmasters ones blocks hex + px in shared/web code; run ESLint in CI as a hard gate (Sitka documents the pre-commit half). I did **not** find a single official end-to-end "Style Dictionary + ESLint token gate" tutorial from Style Dictionary itself.

---

## 5. Evidence quality: strong vs thin

**Strong (official docs / registry / full issue bodies):**
- RNTL 14.0.1 peers + React 19 requirement + `test-renderer` — npm registry + official docs.
- RNTL limitations (no native features, host-only tree, simulation caveats) — official FAQ + testing-env.
- RNTL-under-Vitest: `vitest-native@0.13.0` — npm registry + two full READMEs; plus Vitest Discussion #10160 and React Native Harness site.
- jest-expo 57.0.5 universal/projects and Expo's Jest-only recommendation — official README + Expo docs.
- Bare RN preset moved to `@react-native/jest-preset` (0.87.1) — Jest docs + registry.
- RNW official alias recipe (`moduleNameMapper`/Resolve) — official RNW Setup doc; Vitest variant from assistant-ui doc.
- Detox 20.51.4 + official "RN 0.77.x–0.84.x fully compatible with New Architecture" — official Detox docs.
- Detox HarmonyOS community patch — full issue body #4968 (61/61 on device; not upstream).
- Maestro: no HarmonyOS in platform list; `--platform harmony` errors — official docs index + issue #3196 body.
- Playwright 1.63.0 — registry.
- Token lint primitives/plugins: ESLint `no-restricted-syntax`, `eslint-plugin-react-native/no-color-literals`, aiuxmasters plugin, Sitka plugin, Kong stylelint plugin — all full-text.

**Thin / needs your own verification:**
- **Maestro New-Architecture support**: issue #2202 is closed but the comments were not retrievable; no official doc statement. Higher risk than Detox for RN 0.84.
- **Maestro maintenance cadence**: latest is CLI 2.10.0, but I did not verify release dates, open/closed issue counts, or commit cadence.
- **`stylelint-react-native`** token rules: only "RN-specific rules" confirmed; stale (~1yr).
- **Style Dictionary React Native example**: snippet-level only.
- **RNOH RN-version support** (0.77/0.72, 0.82 in progress): snippet-level (search/daily.dev), not full-text.
- **`@atlaskit/eslint-plugin-design-system`**: fetch returned empty.
- **Custom alias `@testing-library/react-native` → `@testing-library/react`** for one web suite: not found as an official/documented recipe.
- **`vitest-native` RN range** differs between its two READMEs (0.87 vs 0.86); beta software, small maintainer team — treat the gate as "works, verify on your pinned RN 0.84 + RNTL 14 + Vitest version".

---

## 6. Explicit list of what I could NOT verify

1. An **official Expo Vitest path** or Expo Vitest preset — none found.
2. A **maintainer confirmation** that Maestro officially supports React Native New Architecture (Fabric/TurboModules) — issue #2202 closed, comments unreadable; docs silent.
3. **Maestro release dates / commit cadence / issue counts** — not retrieved.
4. **Maestro HarmonyOS support** — confirmed *unsupported* (error string) but the issue has no maintainer reply and no roadmap.
5. **Detox HarmonyOS support shipping upstream** — only an open community issue/fork; not merged.
6. **RNOH's exact supported RN versions** and whether RN 0.84 works — snippet-level only.
7. **A specific `@react-native/jest-preset` version for RN 0.84** — I only verified latest 0.87.1; pin to your RN minor and confirm.
8. **`stylelint-react-native` containing a token/scale rule** — unverified.
9. **Style Dictionary's React Native example contents** — snippet-level.
10. **Atlassian's design-system ESLint plugin** — page fetch returned empty.
11. Any **benchmark** of vitest-native vs Jest from an independent source — only the project's own self-reported harness exists; I did not reproduce it.
12. **Playwright** has no RN/New-Arch angle (N/A), and I did not verify any Playwright+RNW specific recipe beyond the generic RNW aliasing.
