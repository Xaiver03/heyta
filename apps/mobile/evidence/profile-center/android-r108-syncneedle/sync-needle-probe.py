#!/usr/bin/env python3
"""正对照探针：证明 `mobile.profile.sync.notConfigured` 的**当前值**在未配置态真的渲染在屏上。

为什么需要它：`check:verify-script-copy` 只验"串在不在词条表里"，验不到"这句话在被测那一屏
画不画"。直接把旧针换成新串，如果新串在这一屏不出现，那两枚 absence 断言就会变成**永远成立**
（比永不成立更坏，因为它绿着）。这一支探针问的就是那把尺问不到的那一半。

只读 + 不抢前台：launch 用 `am start -W`（不是 monkey、不是 open -a），dump 用 uiautomator。
"""
import json
import subprocess
import sys
import time

SERIAL = "emulator-5554"
NEW_NEEDLE = "登录 heyta，让任务在设备间自动同步。"
OLD_NEEDLE = "填好服务器地址与访问令牌后才能同步。"

# 首屏那两下（与旅程探针同一族：中英同义定位，不靠单一语言）
OFFLINE_LABELS = ["只用本机", "Local only", "仅本机"]
WELCOME_LABELS = ["先离线使用", "Use offline", "离线使用"]
ME_LABELS = ["我的", "Me", "Profile", "我"]


def adb(*args, input_text=None):
    return subprocess.run(
        ["adb", "-s", SERIAL, *args],
        capture_output=True, text=True, input=input_text, timeout=120
    )


def dump():
    adb("shell", "uiautomator", "dump", "/sdcard/r108probe.xml")
    return adb("shell", "cat", "/sdcard/r108probe.xml").stdout


def find(xml_text, needles, attr="text"):
    """返回命中的节点 (needle, bounds, text, desc)。attr 可以是 "text"/"desc"/"rid"。"""
    import re
    out = []
    for m in re.finditer(r'<node\b[^>]*>', xml_text):
        tag = m.group(0)
        text = re.search(r'\btext="([^"]*)"', tag)
        desc = re.search(r'\bcontent-desc="([^"]*)"', tag)
        rid = re.search(r'\bresource-id="([^"]*)"', tag)
        bounds = re.search(r'\bbounds="(\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\])"', tag)
        if attr == "rid":
            vals = [rid.group(1) if rid else ""]
        else:
            vals = [(text.group(1) if text else ""), (desc.group(1) if desc else "")]
        for n in needles:
            if any(n in v for v in vals):
                out.append({"needle": n, "bounds": bounds.group(1) if bounds else None,
                            "text": text.group(1) if text else "",
                            "desc": desc.group(1) if desc else "",
                            "rid": rid.group(1) if rid else ""})
                break
    return out


def tap(bounds):
    import re
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", bounds))
    adb("shell", "input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))


def main():
    report = {"serial": SERIAL, "steps": []}

    # 读数出处（本线在册纪律：设备读数必须带"哪一枚包 + 界面语言"）
    pm = adb("shell", "pm", "path", "com.heyta").stdout.strip().splitlines()
    apk = pm[0].replace("package:", "") if pm else ""
    sha = adb("shell", "sha256sum", apk).stdout.split()[0] if apk else ""
    report["artifact"] = {"device_apk_path": apk, "device_apk_sha256": sha,
                          "ui_locale": adb("shell", "getprop", "ro.product.locale").stdout.strip()}

    adb("shell", "am", "start", "-W", "-n", "com.heyta/com.heytamobile.MainActivity")
    time.sleep(6)

    x = dump()
    off = find(x, OFFLINE_LABELS)
    if off and off[0]["bounds"]:
        tap(off[0]["bounds"])
        report["steps"].append({"step": "dismiss-consent", "via": off[0]["needle"]})
        time.sleep(4)
    else:
        report["steps"].append({"step": "dismiss-consent", "via": None})

    x = dump()
    wel = find(x, WELCOME_LABELS)
    if wel and wel[0]["bounds"]:
        tap(wel[0]["bounds"])
        report["steps"].append({"step": "dismiss-welcome", "via": wel[0]["needle"]})
        time.sleep(4)
    else:
        report["steps"].append({"step": "dismiss-welcome", "via": None})

    x = dump()
    me = find(x, ME_LABELS)
    if me and me[0]["bounds"]:
        tap(me[0]["bounds"])
        report["steps"].append({"step": "open-me", "via": me[0]["needle"], "bounds": me[0]["bounds"]})
        time.sleep(4)
    else:
        report["steps"].append({"step": "open-me", "via": None})

    # 先滚回顶：「设置」那一行在身份卡之后（`ProfileScreen.tsx:1331`），而这一页的滚动位置
    # 在同一个 app 会话里是**留着**的 —— 上一趟滚到一半，这一趟直接找就会找不到。
    for _ in range(3):
        adb("shell", "input", "swipe", "540", "600", "540", "1900", "700")
        time.sleep(1.2)

    # 凭据表单在「设置」Modal 里（`scripts/lib/mobile-e2e.sh` 的 `configure_sync_credentials`
    # 就是按稳定锚点 resource-id 打开它的），不在「我的」的滚动流上。
    x = dump()
    st = find(x, ["profile-entry-settings"], attr="rid")
    if not st or not st[0]["bounds"]:
        # 还是不在可视区：向下滚一下再找（同一族先例：旅程探针的 reachability-aware scroll_to）
        for attempt in range(3):
            adb("shell", "input", "swipe", "540", "1500", "540", "900", "400")
            time.sleep(1.5)
            x = dump()
            st = find(x, ["profile-entry-settings"], attr="rid")
            if st and st[0]["bounds"]:
                report["steps"].append({"step": f"find-settings-after-scroll-{attempt}"})
                break
    if st and st[0]["bounds"]:
        tap(st[0]["bounds"])
        report["steps"].append({"step": "open-settings-modal", "via": st[0]["rid"], "bounds": st[0]["bounds"]})
        time.sleep(3)
    else:
        report["steps"].append({"step": "open-settings-modal", "via": None})

    # 设置 IA 把「同步与隐私」收成一个分组入口 —— 先按中英同义把它点开，再找同步那一节
    x = dump()
    grp = find(x, ["同步与隐私", "Sync & privacy", "Sync and privacy"])
    if grp and grp[0]["bounds"]:
        tap(grp[0]["bounds"])
        report["steps"].append({"step": "open-sync-group", "via": grp[0]["needle"], "bounds": grp[0]["bounds"]})
        time.sleep(3)
    else:
        report["steps"].append({"step": "open-sync-group", "via": None})

    # 「使用自托管服务器」才是凭据表单的入口（现量：点开之前这一屏上没有输入框）
    x = dump()
    selfhost = find(x, ["使用自托管服务器", "Use your own server", "self-hosted"])
    if selfhost and selfhost[0]["bounds"]:
        tap(selfhost[0]["bounds"])
        report["steps"].append({"step": "open-self-host-form", "via": selfhost[0]["needle"],
                                "bounds": selfhost[0]["bounds"]})
        time.sleep(3)
    else:
        report["steps"].append({"step": "open-self-host-form", "via": None})

    # 「立即同步」在 Modal 的同步那一节里，可能要滚一下才进可视区
    for attempt in range(5):
        x = dump()
        if find(x, [NEW_NEEDLE]) or find(x, ["立即同步", "Sync now"]):
            break
        adb("shell", "input", "swipe", "540", "1600", "540", "900", "300")
        time.sleep(2)
        report["steps"].append({"step": f"scroll-{attempt}", "via": "swipe"})

    x = dump()
    new_hits = find(x, [NEW_NEEDLE])
    old_hits = find(x, [OLD_NEEDLE])
    sync_btn = find(x, ["立即同步", "Sync now"])
    # 屏幕上这一帧到底画了什么：留一份逐字文本清单，下一位不必重跑就能判"探针问对了没有"
    import re
    texts = []
    for m in re.finditer(r'<node\b[^>]*\btext="([^"]{1,60})"[^>]*>', x):
        v = m.group(1).strip()
        if v and v not in texts:
            texts.append(v)
    report["visible_texts"] = texts[:60]
    report["readings"] = {
        "new_needle_present": bool(new_hits),
        "new_needle_bounds": [h["bounds"] for h in new_hits],
        "old_needle_present": bool(old_hits),
        "sync_button_present": bool(sync_btn),
        "sync_button_bounds": [h["bounds"] for h in sync_btn],
        # 凭据表单那三个输入框在不在这一帧上（`configure_sync_credentials` 找的就是它们）
        "credential_fields_present": {
            f: bool(find(x, [f])) for f in ("服务器地址", "访问令牌", "端到端加密口令")
        },
    }
    # 这一支的判决：新串在未配置态**在屏上**，且「立即同步」也在（同一节）
    report["verdict"] = "PASS" if (report["readings"]["new_needle_present"]
                                   and report["readings"]["sync_button_present"]) else "FAIL"
    # 共享设备：读完把设置那一层退出去，别把浮层留给下一位
    adb("shell", "input", "keyevent", "4")
    time.sleep(1)
    adb("shell", "input", "keyevent", "4")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["verdict"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
