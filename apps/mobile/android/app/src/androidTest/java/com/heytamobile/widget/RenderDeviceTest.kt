package com.heytamobile.widget

// ⚠️ 显式 import：`R` 生成在 `com.heytamobile` 下，本文件在 `com.heytamobile.widget`，
//    Kotlin 不会向上层包查找。
import com.heytamobile.R

import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * **卡片真的渲染出真任务文案** —— 在设备上，不需要 launcher。
 * ==========================================================
 *
 * ## 为什么这条路比"把卡片拖到桌面"更该先做
 *
 * Android 的「把组件实例加到桌面」需要 **跨 Activity 的拖放**（Pixel launcher 的
 * 「长按抬起 → 切到桌面 → 松手」），而 `adb shell input`（`swipe` / `draganddrop` /
 * `motionevent` 都试过）**合成不出来**。也就是说那条路卡在**手势合成**上，
 * 与组件本身对不对无关。
 *
 * 但 **`RemoteViews` 可以在这里被真的 apply 出来**：
 * `TodayWidgetViews.render()` 是公开的纯构建函数，`bindRows` 用的是
 * **固定 view ID + `setTextViewText`**（不是 ListView + Adapter），
 * 所以 `apply()` 得到的视图树里**真的有那些行的文案**。
 *
 * 于是"渲染"这件事可以**被断言**，而不是只能被眼看 ——
 * 这也符合本仓库那条纪律：**能断言的就别只截图。**
 *
 * ⚠️ **一个必须说清的边界**：`apply()` 验证的是"**RemoteViews 的内容对不对**"，
 * 不是"**launcher 把它画到桌面上是什么样**"（字体、尺寸、裁剪、深色主题都在宿主那边）。
 * 两者都要，但这一个**能自动跑**。
 */
@RunWith(AndroidJUnit4::class)
class RenderDeviceTest {

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private lateinit var store: WidgetStore

    @Before
    fun setUp() {
        WidgetDeviceKeyStore.delete()
        store = WidgetStore(SharedPreferencesWidgetStore(context))
        store.clearAll()
    }

    @After
    fun tearDown() {
        WidgetDeviceKeyStore.delete()
        store.clearAll()
    }

    private fun goldenPlaintext(): String =
        InstrumentationRegistry.getInstrumentation().context.assets
            .open("v1.golden.plaintext.json")
            .bufferedReader(Charsets.UTF_8)
            .use { it.readText() }

    /** 写一份真快照（真 Keystore 加密），返回"现在"。 */
    private fun seedSnapshot(): Long {
        val aead = KeystoreAead(WidgetDeviceKeyStore.getOrCreate())
        val now = System.currentTimeMillis()
        store.writeSnapshot(WidgetSnapshotCipher.seal(goldenPlaintext(), "2026-09-28", now + 3_600_000L, aead))
        return now
    }

    /** 把 `RemoteViews` apply 成真实视图树，并把所有 `TextView` 的文案收出来。 */
    private fun applyAndCollectTexts(rv: android.widget.RemoteViews): List<String> {
        val holder = arrayOfNulls<View>(1)
        InstrumentationRegistry.getInstrumentation().runOnMainSync { holder[0] = rv.apply(context, null) }
        val out = mutableListOf<String>()
        fun walk(v: View?) {
            when (v) {
                null -> return
                is TextView -> v.text?.toString()?.let { if (it.isNotBlank()) out.add(it) }
                is ViewGroup -> for (i in 0 until v.childCount) walk(v.getChildAt(i))
            }
        }
        walk(holder[0])
        return out
    }

    /**
     * 🔴 **承重测试**：真快照 → 真模型 → 真 `RemoteViews` → apply → **断言夹具里的任务标题**。
     *
     * ⚠️ 断言的是**标题本身**，不是"有 5 个 TextView" —— 后者在"解不开密、只画了占位文案"时也会绿。
     */
    @Test
    fun todayCardRendersRealTaskTitles() {
        val now = seedSnapshot()
        val model = WidgetRefresh.todayModelFor(store, now, WidgetRefresh.resolveProductionAead())
        val texts = applyAndCollectTexts(TodayWidgetViews.render(context, model))

        assertTrue("渲染结果里没有夹具中的「交房租」，实际：$texts", texts.any { it.contains("交房租") })
        assertTrue("渲染结果里没有夹具中的「写周报」，实际：$texts", texts.any { it.contains("写周报") })
    }

    /**
     * **占位态渲染的必须是"打开 Heyta"，不是"今天没有任务"。**
     *
     * 🔴 这一条验的是四端共有的那条不变量：**"不知道"与"知道且为空"是两个状态。**
     * 把「解不开密」画成「今天没有任务」，用户就会以为今天没事 —— 那是**撒谎**。
     * ⚠️ 而且它在真机上**不会报错、不会崩**，只有内容不对。
     */
    @Test
    fun placeholderStateRendersOpenHintNotEmptyList() {
        // 注意：**不写快照** —— 设备上没有任何可信数据。
        val model = WidgetRefresh.todayModelFor(store, System.currentTimeMillis(), WidgetRefresh.resolveProductionAead())
        val texts = applyAndCollectTexts(TodayWidgetViews.render(context, model))

        // 🔴 **断言必须与语言无关。**
        //    第一版我写的是 `texts.any { it.contains("打开") }` —— 而模拟器是**英文区域**，
        //    实际渲染的是 `Open Heyta to show content`，于是测试红了。
        //    ⚠️ **实现是对的，错的是断言**：那条断言把"中文"当成了"占位态"的同义词，
        //    而这两种东西根本无关 —— 一个中文用户装英文包、一个英文用户装中文包都会让它红。
        //    正确做法：**期望值从资源里取**，而不是把某个语言的文案抄进断言。
        val joined = texts.joinToString(" | ")
        val expected = context.getString(R.string.widget_message_open_app)
        val forbidden = context.getString(R.string.widget_message_no_tasks)

        assertTrue("占位态应当渲染 R.string.widget_message_open_app（$expected），实际：$joined",
            texts.any { it == expected })
        assertTrue("占位态**不能**渲染成 R.string.widget_message_no_tasks（$forbidden），实际：$joined",
            texts.none { it == forbidden })
    }
}
