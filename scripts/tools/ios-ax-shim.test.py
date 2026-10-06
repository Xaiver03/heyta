"""Regression checks for AX geometry; run with python3 scripts/tools/ios-ax-shim.test.py."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("ax", Path(__file__).with_name("ios-ax-shim.py"))
ax = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ax)


def node(label, x, y, width, height, kind="Button"):
    return {"AXLabel": label, "type": kind, "enabled": True,
            "frame": dict(x=x, y=y, width=width, height=height)}


def scene(target):
    return [node("app", 0, 0, 386, 678, "Application"), target,
            *[node(label, i * 77, 580, 77, 64, "GenericElement")
              for i, label in enumerate(["任务", "日历", "专注", "分类", "我的"])]]


class GeometryTests(unittest.TestCase):
    def press(self, target, nodes):
        output = io.StringIO()
        with patch.object(ax, "locate", return_value=(target, nodes)), \
             patch.object(ax.subprocess, "run") as run, \
             patch("sys.argv", ["ax", target["AXLabel"], "--press", "--exact",
                                "--udid", "fixture", "--idb", "idb", "--companion", "localhost:1"]), \
             contextlib.redirect_stdout(output):
            run.return_value.returncode = 0
            ax.main()
        return json.loads(output.getvalue()), run

    def test_save_overlapping_tab_never_sends_tap(self):
        target = node("保存并启用同步", 16, 591, 354, 44, "Link")
        result, run = self.press(target, scene(target))
        self.assertEqual(result["result"], "tap-blocked-by-tab-bar")
        run.assert_not_called()

    def test_real_tab_still_receives_tap(self):
        nodes = scene(node("保存并启用同步", 16, 591, 354, 44))
        result, run = self.press(nodes[-1], nodes)
        self.assertEqual(result["result"], "success")
        run.assert_called_once()

    def test_offscreen_target_never_sends_tap(self):
        target = node("保存并启用同步", 16, 720, 354, 44)
        result, run = self.press(target, scene(target))
        self.assertEqual(result["result"], "tap-outside-screen")
        run.assert_not_called()

    def test_partly_above_viewport_requires_fresh_frame_after_scroll(self):
        target = node("服务器地址", 34, -13, 318, 42, "TextField")
        visible = node("服务器地址", 34, 180, 318, 42, "TextField")
        with patch.object(ax, "dump_nodes", side_effect=[scene(target), scene(target), scene(visible)]), \
             patch.object(ax, "idb_swipe", return_value=(0, "")) as swipe, \
             patch.object(ax.time, "sleep"):
            result = ax.scroll_into_view("idb", "localhost:1", "fixture", "服务器地址", False, True, None)
        swipe.assert_called_once()
        self.assertEqual(result["visible"], "True")
        self.assertEqual(result["y"], "180")


if __name__ == "__main__":
    unittest.main()
