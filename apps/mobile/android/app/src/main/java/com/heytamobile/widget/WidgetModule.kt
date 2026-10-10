package com.heytamobile.widget

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONObject

/**
 * 小组件的 RN 原生模块 —— 应用侧与共享容器之间的**唯一接口**。
 *
 * ## 三个方法，各自对应一条纪律
 *
 * | 方法 | 谁用 | 纪律 |
 * |---|---|---|
 * | `setWidgetSnapshot` | 应用写 | 写进去的**必须先过契约校验**，不能让组件去猜 |
 * | `drainIntentQueue` | 应用读 | **非破坏读取**，成功后精确 ack（解析的真源在 `@heyta/widget-core`） |
 * | `clearWidgetState` | 登出 | 快照与密钥**一起**清（D6） |
 *
 * ## 🔴 为什么 `setWidgetSnapshot` 要**拒绝**而不是"先存着看看"
 *
 * 这里存进去的东西，下一步就是被组件在**别人的进程、没有日志可看**的地方读出来。
 * 若应用写下了一个 `projectId: null` 或 `alg: "none"` 的信封，组件只会安静地显示空列表 ——
 * 而"组件没数据"这个症状可以有十几种原因。所以在**写入点**就拒绝：
 * 责任落在有日志、有堆栈、能被调试的那一侧。
 */
class WidgetModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val store = WidgetStore(SharedPreferencesWidgetStore(reactContext))

    override fun getName(): String = NAME

    override fun getConstants(): Map<String, Any> = buildMap {
        WidgetLocalePreference.read(reactApplicationContext)?.let { put("preferredLocale", it) }
        put("deviceLocale", reactApplicationContext.resources.configuration.locales[0].toLanguageTag())
    }

    @ReactMethod
    fun setWidgetLocale(locale: String, promise: Promise) {
        try {
            WidgetLocalePreference.write(reactApplicationContext, locale)
            WidgetRefresh.pushAll(reactApplicationContext)
            promise.resolve(true)
        } catch (e: Throwable) {
            promise.reject(ERR_WRITE_FAILED, e)
        }
    }

    /**
     * 写入一份**已加密**的快照信封。
     *
     * ⚠️ 本方法**不做加密、不碰密钥** —— 它只负责"校验 + 存"。
     * 加密与设备密钥派生是 W1-4（见 ADR-0025 §2.1：Argon2id 永不进组件，
     * 而它的产物——那把 32 字节的密钥——由应用侧写完放进共享容器）。
     */
    @ReactMethod
    fun setWidgetSnapshot(envelopeJson: String, promise: Promise) {
        try {
            val parsed = WidgetSnapshotParser.parseEnvelope(
                try {
                    JSONObject(envelopeJson)
                } catch (e: Throwable) {
                    promise.reject(ERR_NOT_JSON, "快照不是合法 JSON：${e.message}")
                    return
                }
            )
            if (parsed is EnvelopeParseResult.Rejected) {
                // 把契约的拒绝原因**原样**带出去（`unknown-version` / `null-project-id` …），
                // 这样应用侧日志里的词与 TS 侧、与组件侧是同一套。
                promise.reject(ERR_INVALID_ENVELOPE, "${parsed.reason}: ${parsed.detail}")
                return
            }

            store.writeSnapshot(envelopeJson)

            // 数据已经落盘了 —— 到这里就**已经成功**，先把 Promise 了掉。
            promise.resolve(true)

            // 然后才主动推一次（内容更新的主路径）。
            //
            // 🔴 顺序是刻意的：这一步**必须在 resolve 之后、且自己吞掉异常**。
            // 若放在上面那个 try 里，`pushAll` 一抛（缺资源、R8 改名、RemoteViews 报错……）
            // 就会被外层 catch 变成 `E_WIDGET_WRITE_FAILED` ——
            // 而**快照其实已经写进去了**。应用侧收到失败会重试甚至回滚一个已经成功写入的操作，
            // 症状是"有时提示写入失败，但组件其实更新了"，极难归因。
            //
            // 推送失败本身没什么可补救的：`updateAppWidget` 在桌面上没有该组件实例时
            // 就是一次安全的空操作，而且下一次应用写快照、或系统定时器都会再推一次。
            try {
                WidgetRefresh.pushAll(reactApplicationContext)
            } catch (_: Throwable) {
                // 有意吞掉：快照已写入，推送失败不影响本次写入的**成败**。
            }
        } catch (e: Throwable) {
            promise.reject(ERR_WRITE_FAILED, e)
        }
    }

    /**
     * 读取意图队列的**原始 JSON**，ack 前保留。`null` = 没有待处理的点击。
     *
     * ⚠️ 刻意**不在原生侧解析**：队列语义（last-wins 折叠、上限 50、类型校验）
     * 只有一份真源，在 `@heyta/widget-core` 的 `parseIntentQueue` 里（36 条测试）。
     * 原生再实现一遍就是第二个真源，而两个真源会漂移、且**不会报错**。
     */
    @ReactMethod
    fun drainIntentQueue(promise: Promise) {
        try {
            promise.resolve(store.drainIntents())
        } catch (e: Throwable) {
            promise.reject(ERR_READ_FAILED, e)
        }
    }

    @ReactMethod
    fun ackIntentQueue(processedJson: String, promise: Promise) {
        try {
            promise.resolve(store.acknowledgeIntents(WidgetIntentQueues.parse(processedJson)))
        } catch (e: Throwable) {
            promise.reject(ERR_WRITE_FAILED, e)
        }
    }

    /** 兼容旧调用者：旧意图合并时保留较新的点击。当前消费流程使用非破坏读取与精确 ack。 */
    @ReactMethod
    fun mergeIntentQueue(pendingJson: String, promise: Promise) {
        try {
            // ⚠️ `parse` 对坏数据降级为空队列（与四端解析器同一策略，见其注释）。
            //    这里传入的是 JS 刚 `JSON.stringify` 出来的对象，现实中不该坏；
            //    真坏了也只会"少写回几条"，而不是抛出去让应用起不来。
            val pending = WidgetIntentQueues.parse(pendingJson)
            val merged = store.updateIntents { current ->
                // 🔴 **顺序是 `current` 新、`pending` 旧**，而且必须用
                //    `mergeOlderIntoNewer`（不是 `mergeAll`）：这两步之间到达的
                //    新点击**更新**，不能被写回的旧意图覆盖。
                //    写反的后果见 `mergeOlderIntoNewer` 的注释 —— 它是本轮的
                //    Kotlin 测试抓出来的。
                WidgetIntentQueues.mergeOlderIntoNewer(current, pending.intents)
            }
            promise.resolve(merged.intents.size)
        } catch (e: Throwable) {
            promise.reject(ERR_WRITE_FAILED, e)
        }
    }

    /**
     * 登出 / 切换账号时调用。**快照与设备密钥一起清**（D6）。
     *
     * 只清快照不清密钥，会让下一个登录的人"用旧密钥解新密文"——症状是组件一直显示占位符，
     * 看起来只是没数据，但**旧密文还留在磁盘上**（那才是要清的东西）。
     *
     * 🔴 2026-09-27（W1-4）：密钥已经**不在共享容器里**了（它归 `AndroidKeyStore`），
     * 所以这里必须**显式清两处**。这正是"清密钥"这件事唯一正确的位置 ——
     * 分散到两个地方就会出现"清了一半"的状态，而它的症状是
     * **下一个人登录后组件能正常显示上一个账号的旧快照**（如果密钥还在的话），
     * 或者永远显示占位符（如果密钥清了、密文没清）。两种都不会报错。
     *
     * ⚠️ 顺序：**先删密钥再清容器**。反过来的话，两步之间崩溃会留下
     * "旧密文 + 无密钥" —— 虽然也只是占位符，但先删密钥能让
     * "任何一刻崩溃都不会留下可解开的旧密文"这一点成立。
     */
    @ReactMethod
    fun clearWidgetState(promise: Promise) {
        try {
            WidgetDeviceKeyStore.delete()
            store.clearAll()
            // 清掉系统已缓存的文字；刷新失败也必须让清理流程知道。
            WidgetRefresh.pushAll(reactApplicationContext)
            promise.resolve(true)
        } catch (e: Throwable) {
            promise.reject(ERR_WRITE_FAILED, e)
        }
    }

    /**
     * W5-3 · 灵动岛（Live Activity）—— **Android 上没有这个东西**。
     *
     * 🔴 **这个方法存在的唯一目的是让 JS 侧不必知道平台。**
     *
     * `lifecycle.ts` 的 `wake()` 会**无条件**调它（和 iOS 走同一条代码路径）。
     * 在补这个方法之前，Android 上每次唤醒都会打一行：
     *
     *     '[widget] 推进灵动岛失败：', 'undefined is not a function'
     *
     * 不致命（`callNativeSafely` 兜住了），但**是真噪音**：
     * 一行"每次都会出现、且永远不代表有问题"的警告，会训练人忽略这个标签，
     * 于是真正的问题出现时也看不见了。
     *
     * 另一条路是在 JS 里写 `if (Platform.OS === 'ios')`。**没选那条**，理由与
     * `readWidgetPrivacy` 返回 `null` 让界面自己省略开关是同一条：
     * **平台能力的判断属于原生侧** —— 只有它真的知道这台设备有什么。
     * JS 里散落平台字符串，迟早会有人漏掉一处。
     *
     * ⚠️ 返回 `"none"` 而**不是**报错：`'none'` 正是 iOS 侧
     * "当前没有活跃的专注会话"的同一种结局字符串，调用方本来就要处理它。
     * 报错会让"这个平台不支持"看起来像"这一步出错了"。
     */
    @ReactMethod
    fun syncFocusActivity(promise: Promise) {
        promise.resolve("none")
    }

    /**
     * 把载荷 JSON 封成信封，返回信封 JSON 字符串。
     *
     * 🔴 **密钥不穿桥**：JS 交明文、拿回密文，全程拿不到密钥字节。
     * 这是 W1-4 定的密钥归属（原生生成随机密钥、永不离开 Keystore）的**落地方式** ——
     * 也是唯一一种能真正做到"密钥不进 JS 堆、不进日志、不进崩溃上报"的形状。
     *
     * ⚠️ 用 [WidgetDeviceKeyStore.getOrCreate] 而**不是** `existing()`：
     * 这里是**应用侧**（用户正在使用应用），它可以生成密钥。
     * 组件侧（渲染）恰恰相反 —— 见 `WidgetRefresh.resolveProductionAead` 的注释。
     */
    @ReactMethod
    fun sealWidgetSnapshot(payloadJson: String, dayStr: String, validUntil: Double, promise: Promise) {
        try {
            val aead = KeystoreAead(WidgetDeviceKeyStore.getOrCreate())
            val envelopeJson = WidgetSnapshotCipher.seal(
                payloadJson = payloadJson,
                dayStr = dayStr,
                // ⚠️ JS 的 number 到这里是 Double。epoch ms 在 2^53 以内可精确表示，
                //    但**必须显式取整**：`validUntil` 会进 AAD 字符串，
                //    而 `1.79E12` 与 `1790000000000` 拼出来的 AAD 不一样 →
                //    组件侧永远解不开，症状只是"没数据"。
                validUntil = validUntil.toLong(),
                aead = aead,
            )
            promise.resolve(envelopeJson)
        } catch (e: Throwable) {
            promise.reject(ERR_WRITE_FAILED, e)
        }
    }

    companion object {
        /** JS 侧 `NativeModules.HeytaWidget`。**改了它 JS 就找不到模块**。 */
        const val NAME = "HeytaWidget"

        private const val ERR_NOT_JSON = "E_WIDGET_NOT_JSON"
        private const val ERR_INVALID_ENVELOPE = "E_WIDGET_INVALID_ENVELOPE"
        private const val ERR_WRITE_FAILED = "E_WIDGET_WRITE_FAILED"
        private const val ERR_READ_FAILED = "E_WIDGET_READ_FAILED"
    }
}
