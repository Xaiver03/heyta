# Android candidate: account legal reader acceptance

Captured 2026-10-08 18:20–18:25 +0800 on `emulator-5554`. This is a device-level acceptance of the already-installed candidate APK. No source, Gradle, emulator, account, registration request, consent checkbox, or app data was changed by this run.

## Installed binary

- Package/activity: `com.heyta` / `com.heytamobile.MainActivity`
- Device: `sdk_gphone64_arm64`, Android 16, 1080x2400
- Installed APK SHA-256: `26d39bc0ca06d13e6000a363649cdf56f42d52d9a4fc0e6f2c3e4d0dbb36d115`
- Expected candidate SHA-256: `26d39bc0ca06d13e6000a363649cdf56f42d52d9a4fc0e6f2c3e4d0dbb36d115`
- SHA match: **YES**
- Package version: `1.0` (`versionCode=1`), update time `2026-10-08 18:20:07`

Raw package and device metadata are in `device-install.txt`, `package-version.txt`, and `device-base-apk-sha256.txt`.

## Steps and results

| Step | Action | Result | Evidence |
|---|---|---|---|
| 1 | Open Profile and tap “Sign in or register” | Pass; account entry reached through the real UI | `01-profile.png`, `02-auth-entry.png` |
| 2 | Tap “No account for this email yet? Create one” | Pass; registration form appeared | `03-create-account.png` / `03-create-account-ui.xml` |
| 3 | Inspect registration form | Pass; email field, password + confirmation fields, agreement checkbox, Terms of Service, Privacy Policy, and primary “Send verification code” button are present. No redundant password-help explanation appeared in the rendered UI tree. | `03-create-account-ui.xml` |
| 4 | Tap Terms of Service | Pass; in-app reader opened with title, version, and legal body text | `04-terms-reader.png` / `04-terms-reader-ui.xml` |
| 5 | Press Android system Back | Pass; reader closed and registration form returned | `05-after-system-back-from-terms.png` / `05-after-system-back-from-terms-ui.xml` |
| 6 | Tap Privacy Policy | Pass; in-app reader opened with title, version, and policy body text | `06-privacy-reader.png` / `06-privacy-reader-ui.xml` |
| 7 | Press Android system Back | Pass; reader closed and registration form returned with the agreement and “Send verification code” button still present | `07-after-system-back-from-privacy.png` / `07-after-system-back-from-privacy-ui.xml` |

The primary button was observed but deliberately not tapped. The agreement was left unchecked. No email/password was entered and no registration or verification request was submitted.

## Bounded image mirror

The four review images are mirrored into the main tree at:

`apps/mobile/evidence/ux-final-20261008/android-candidate/auth-legal-frozen/installed-legal/`

Mirrored images: `03-create-account.png`, `04-terms-reader.png`, `06-privacy-reader.png`, and `07-after-system-back-from-privacy.png`.

## Limits

This run verifies the installed Android UI through adb/UIAutomator and screenshots. It does not verify server-side account creation, email delivery, or the post-submit verification-code screen because those actions would submit registration, which was explicitly excluded.

## Dark theme and small-height reader acceptance

The app was already rendering in its dark palette at the start of this pass. The app's own General settings were opened and inspected; this Android surface exposes widget and language settings but no appearance/theme selector. The installed mobile provider resolves its theme from the system color scheme, so there was no truthful app-level dark toggle to operate. The reader checks below are therefore recorded as completed in the already-dark app state, without pretending an unavailable control was used.

The original display policy was recorded as `accelerometer_rotation=1`, `user_rotation=0`, portrait `1080x2400`. It was restored to the same values at the end.

| Step | Action | Result | Evidence |
|---|---|---|---|
| 8 | Open Terms reader, lock the device to landscape (`2400x1080`) | Pass; title and Close button remain fixed in the small-height reader surface; the body is a real scrollable `android.widget.ScrollView` | `17-terms-reader-landscape-dark.png` / `17-terms-reader-landscape-dark-ui.xml` |
| 9 | Swipe the Terms body in landscape | Pass; later table content appears while the title and Close button remain present | `19-terms-reader-landscape-dark-scrolled.png` / `19-terms-reader-landscape-dark-scrolled-further-ui.xml` |
| 10 | System Back from the Terms reader | Pass; registration form returns | `20-create-after-reader-back-portrait-ui.xml` |
| 11 | Put a non-real draft value `readercheck%40example.invalid` into the email field, reopen Terms, rotate the reader to landscape, then system Back | Pass; the draft value remains in the registration form, with the legal links and “Send verification code” button still present. No request was sent. | `21-create-with-dummy-email.png`, `22-terms-reader-landscape-with-dummy-input.png`, `23-after-landscape-reader-back-form-ui.xml` |
| 12 | Open Privacy reader in landscape and inspect/scroll it | Pass; title and Close button remain fixed, body is scrollable, and later policy content appears after real swipes | `24-privacy-reader-landscape-dark.png`, `25-privacy-reader-landscape-dark-scrolled.png` / `25-privacy-reader-landscape-dark-scrolled-ui.xml` |
| 13 | System Back from the Privacy reader and restore auto-rotation | Pass; draft registration value, legal links, and primary verification-code button remain; final orientation policy matches the original | `26-after-privacy-landscape-back-form.png`, `orientation-before.txt`, `orientation-final.txt` |

The temporary email value was not a real account and was never submitted. The agreement remained unchecked. No source or APK was rebuilt.
