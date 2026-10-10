# Windows titlebar UX round 8

Date: 2026-10-08

The remote Debug build completed with 0 warnings and 0 errors after restoring from the isolated local NuGet cache. The source inputs were copied to `C:\\src\\heyta` and the WebView2 app was launched from this fresh QA root:

`C:\\Users\\41478\\heyta-ux-round8-titlebar-20261008-1145`

The QA manifest reported the WebView2 profile inside the QA root. The screenshot collector ran in console session 2, selected Heyta hwnd `33361610`, and recorded `FOREGROUND=True` for every capture. The local evidence images are full window captures from that hwnd.

Interaction facts:

- Double click on the native drag region: `BEFORE_RECT=78,78,1230,665` → `AFTER_RECT=-8,-8,1544,824` (`double-facts.txt`).
- Restore returned to `78,78,1230,665` (`restored` output in the remote run log).
- Drag from the titlebar moved the window to `238,198,1390,785` (`drag-facts.txt`).
- Narrow resize to `760x560` captured in `narrow.png`; the selected page reported `744x551` with `scrollWidth=744` and `clientWidth=744`.
- Light, dark, modal, maximized, and narrow captures are nonblank according to `png-stats.mjs`.

Finding: every nonmaximized capture has an unrelated white toolbar strip from the window behind Heyta across the first roughly 24 pixels. The transparent native titlebar is exposing the desktop behind the WebView instead of presenting a continuous Heyta surface. The maximized capture is continuous because the maximized window covers the desktop. This is a visual failure for the requested integrated titlebar and needs a product fix before this evidence can be considered a pass.
