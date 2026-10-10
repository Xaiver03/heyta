package com.heytamobile.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.widget.RemoteViews
import org.json.JSONObject

/**
 * 把"当前该显示什么"算出来并推给桌面。
 *
 * ## 拆成两半，是为了让一半能被测
 *
 * [contentFor] **不碰任何 Android API**（只用一个 [WidgetStore]），所以它能在 JVM 单测里
 * 跑完整条管线：存储里的密文 → 解析信封 → 用密钥解密 → 解析载荷 → 判定过期 → 叠加意图。
 * [push] / [pushAll] 才是那个只能在真机上验的壳（`AppWidgetManager` + `RemoteViews`）。
 *
 * ## 🔴 四款组件共用**一次**解析
 *
 * 四款组件读的是**同一份快照**。若各自去解析一遍，就会开出四次
 * `JSONObject` + 四次 AES-GCM —— 而组件唤醒是有时间预算的（`BroadcastReceiver`
 * 大约 10 秒），且它们全在**主线程**上。
 * [pushAll] 因此只调一次 [contentFor]，把结果喂给四个渲染器。
 *
 * ## 什么时候会被调用
 *
 * 1. 应用写完快照之后（`WidgetModule.setWidgetSnapshot`）—— **主动推**，这是内容的主路径；
 * 2. 用户在组件上点了一下之后（[BaseWidgetProvider]）—— 只重画**那一个**组件；
 * 3. 系统按 `updatePeriodMillis` 的定时唤醒（见各 `widget_*_info.xml`）——
 *    这**不是在取数据**，只是重新判断一次"过期了没有"。
 */
object WidgetRefresh {

    /**
     * 一款组件的接线：它是哪个 provider、用哪个渲染器。
     *
     * 🔴 **这里是"有哪几款组件"的唯一声明处。** 加第五款时只改这个列表，
     * 就自动获得：应用发布时推送、定时唤醒重画、manifest 之外的完整接线。
     * 分散写成 if-else 的话，漏掉一款的表现是"那款组件永远停在第一次的画面"，
     * 而**不会有任何报错**。
     */
    private class Spec(
        val provider: Class<out AppWidgetProvider>,
        val render: (Context, WidgetContent) -> RemoteViews,
    )

    private fun specs(): List<Spec> = listOf(
        Spec(TodayWidgetProvider::class.java) { context, content ->
            TodayWidgetViews.render(context, TodayWidgetModelBuilder.build(content))
        },
        Spec(QuadrantWidgetProvider::class.java) { context, content ->
            QuadrantWidgetViews.render(context, QuadrantWidgetModelBuilder.build(content))
        },
        Spec(HabitsWidgetProvider::class.java) { context, content ->
            HabitsWidgetViews.render(context, HabitsWidgetModelBuilder.build(content))
        },
        Spec(FocusWidgetProvider::class.java) { context, content ->
            FocusWidgetViews.render(context, FocusWidgetModelBuilder.build(content))
        },
    )

    /** 重算并推给桌面上**所有**组件实例。 */
    fun pushAll(context: Context, now: Long = System.currentTimeMillis()) {
        val content = contentFor(WidgetStore(SharedPreferencesWidgetStore(context)), now, resolveProductionAead())
        for (spec in specs()) pushRendered(context, spec, content)
    }

    /**
     * 只重画**一款**组件（`provider` 指定的那款）。
     *
     * 用于点击之后立刻给反馈 —— 用户在象限组件上点了一下，没有理由让习惯组件
     * 也重画一次；每多推一个 `RemoteViews` 就是多一次跨进程事务，而它在主线程上。
     */
    fun push(context: Context, provider: Class<out AppWidgetProvider>, now: Long = System.currentTimeMillis()) {
        val spec = specs().firstOrNull { it.provider == provider } ?: return
        val content = contentFor(WidgetStore(SharedPreferencesWidgetStore(context)), now, resolveProductionAead())
        pushRendered(context, spec, content)
    }

    private fun pushRendered(context: Context, spec: Spec, content: WidgetContent) {
        AppWidgetManager.getInstance(context)
            .updateAppWidget(ComponentName(context, spec.provider), spec.render(WidgetLocalePreference.localizedContext(context), content))
    }

    /**
     * 算出四款组件共用的**可信内容**（含状态判定）。
     *
     * 规则本身在 [WidgetGate] 里（唯一一处，四款共用）；这里只负责"把密文变成对象"。
     *
     * ⚠️ 用 [WidgetSnapshotCipher.readOrNull] 而**不是** `readSafely`：
     * 后者会把"解不开密"降级成 `emptyPayload()`（`today = []`），
     * 于是刚重启、还没跑过应用时组件会显示 **"今天没有任务"** ——
     * 那是**在骗用户**。`readOrNull` 返回 `null`，[WidgetGate] 就会走占位符。
     *
     * 🔴 **[aead] 由调用方注入而不是在这里去 Keystore 取**，有两个理由：
     *   1. 单测能跑（`AndroidKeyStore` 在 JVM 上是桩）；
     *   2. 让"生产取密钥"这件事只有**一处**（[resolveProductionAead]），
     *      而不是散在每个渲染入口里 —— 散开的后果是有一处忘了走 Keystore、
     *      悄悄用上了别的东西，而组件会照样渲染。
     *
     * ⚠️ 每次调用都重新解析一次密钥：设备重启后"第一次刷新时密钥还读不到、
     * 解锁后的下一次刷新就能读到"是**正常时序**，缓存住 `null` 会让组件
     * 一直停在占位符上，直到下次重启进程 —— 而用户已经解锁了。
     */
    fun contentFor(store: WidgetStore, now: Long, aead: WidgetAead?): WidgetContent {
        val raw = store.readSnapshot()

        // 先转成 JSON 对象：`parseEnvelope` / `readOrNull` 收的是**对象**，不是字符串。
        // 坏 JSON 直接给 null，两个下游都会各自 fail closed。
        val json: Any? = try {
            raw?.let { JSONObject(it) }
        } catch (_: Throwable) {
            null
        }

        val envelope = when (val parsed = WidgetSnapshotParser.parseEnvelope(json)) {
            is EnvelopeParseResult.Ok -> parsed.envelope
            is EnvelopeParseResult.Rejected -> null
        }

        return WidgetGate.resolve(
            envelope = envelope,
            payload = WidgetSnapshotCipher.readOrNull(json, aead),
            queue = store.peekIntents(),
            now = now,
        )
    }

    /** 「今日任务」那一款的模型。单测直接用它跑完整条管线。 */
    fun todayModelFor(store: WidgetStore, now: Long, aead: WidgetAead?): TodayWidgetModel =
        TodayWidgetModelBuilder.build(contentFor(store, now, aead))

    /**
     * 生产路径上"拿密钥"的**唯一一处**。
     *
     * 🔴 用 [WidgetDeviceKeyStore.existing] 而**不是** `getOrCreate`：
     * 组件是被系统唤醒的**渲染**方，它不该有"顺手造一把密钥"的能力 ——
     * 那会在"应用还没跑过"的正常时序里生成一把**应用不知道**的密钥，
     * 于是应用随后写下的快照组件永远解不开，而两边各自都"成功"了。
     *
     * 返回 `null` 是**正常状态**（设备刚重启、还没解锁，或应用从未登录过），
     * 渲染层会据此显示占位符 —— 而**不是**"今天没有任务"。
     */
    fun resolveProductionAead(): WidgetAead? =
        WidgetDeviceKeyStore.existing()?.let { KeystoreAead(it) }
}
