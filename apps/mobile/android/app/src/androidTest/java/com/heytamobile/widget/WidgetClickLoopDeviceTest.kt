package com.heytamobile.widget

import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * **点击回写 → intent 队列 → drain 闭环**，在真设备上跑。
 * ======================================================
 *
 * ## 这个闭环为什么必须单独测
 *
 * 卡片上的点击**不能直接改数据** —— 卡片没有 op-log、不知道冲突规则。
 * 它只能把用户的意图写进一个队列，由应用在下次唤醒时 drain 出来、转成真正的 op。
 * 于是"点了一下"到"任务真的变了"之间隔着**两个进程、三次序列化**，
 * 而这条链上任何一环断掉，表现都是**同一件事：点了没反应**。
 *
 * ## 🔴 断言的是"队列里出现了正确的意图"，不是"onReceive 没抛异常"
 *
 * `handleToggle` 在 `taskId` 为空时会**静默 return**。所以"没抛异常"这个断言
 * 在点击根本没被记下来的时候**也会绿** —— 必须去队列里查。
 */
@RunWith(AndroidJUnit4::class)
class WidgetClickLoopDeviceTest {

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
        store.clearAll()
        WidgetDeviceKeyStore.delete()
    }

    /** 造一条和 `WidgetClicks.toggle()` 真正发出的**同样形状**的广播。 */
    private fun toggleIntent(taskId: String, targetIsDone: Boolean): Intent =
        Intent(context, TodayWidgetProvider::class.java).apply {
            action = WidgetClicks.ACTION_TOGGLE
            putExtra(WidgetClicks.EXTRA_TASK_ID, taskId)
            putExtra(WidgetClicks.EXTRA_TARGET_IS_DONE, targetIsDone)
        }

    /** 一次点击 → 队列里出现一条目标状态正确的意图。 */
    @Test
    fun clickWritesTargetStateIntoTheQueue() {
        TodayWidgetProvider().onReceive(context, toggleIntent("t_rent", true))

        val queue = store.peekIntents()
        assertEquals("点击没有进队列", 1, queue.intents.size)
        assertEquals("t_rent", queue.intents[0].taskId)
        assertTrue("目标状态丢了 —— 卡片会变成切换语义，在过期视图上会算错", queue.intents[0].targetIsDone)
    }

    /**
     * 🔴 **同一任务连点两次：队列里只留最后那个目标状态（last-wins）。**
     *
     * 这不是优化。用户在过期卡片上连点两下（先标完成、发现错了再标未完成），
     * 如果两条都留着并被应用依次执行，**最终状态取决于消息顺序** ——
     * 而顺序在跨进程之间是不保证的。留最后一条让结果**幂等且确定**。
     */
    @Test
    fun repeatedClicksOnSameTaskCollapseToLastWins() {
        TodayWidgetProvider().onReceive(context, toggleIntent("t_milk", true))
        TodayWidgetProvider().onReceive(context, toggleIntent("t_milk", false))

        val queue = store.peekIntents()
        assertEquals("同一任务被记了多条 —— 最终状态会不确定", 1, queue.intents.size)
        assertEquals("留下的不是最后一次点击", false, queue.intents[0].targetIsDone)
    }

    /** 不同任务各留一条。 */
    @Test
    fun differentTasksAreKeptSeparately() {
        TodayWidgetProvider().onReceive(context, toggleIntent("t_rent", true))
        TodayWidgetProvider().onReceive(context, toggleIntent("t_milk", true))

        val ids = store.peekIntents().intents.map { it.taskId }.sorted()
        assertEquals(listOf("t_milk", "t_rent"), ids)
    }

    /**
     * **drain 之后队列必须清空。**
     *
     * 🔴 这一条是承重的：drain 不清空 ⇒ 每次应用启动都会把**同一次点击**
     * 再执行一遍，用户会看到"我明明只点了一次，它被标记了好几回"。
     */
    @Test
    fun drainReturnsTheIntentsAndEmptiesTheQueue() {
        TodayWidgetProvider().onReceive(context, toggleIntent("t_rent", true))

        val drained = store.drainIntents()
        assertNotNull("drain 没有返回内容", drained)
        assertTrue("drain 出来的 JSON 里没有 taskId", drained!!.contains("t_rent"))

        assertEquals("drain 没有清空队列 —— 同一次点击会被重复执行", 0, store.peekIntents().intents.size)
        assertNull("再 drain 一次应该什么都没有", store.drainIntents())
    }

    /** 空 taskId 必须被拒 —— 否则队列里会出现一条无法归因的意图。 */
    @Test
    fun clickWithoutTaskIdIsIgnored() {
        TodayWidgetProvider().onReceive(context, toggleIntent("", true))
        assertEquals(0, store.peekIntents().intents.size)
    }
}
