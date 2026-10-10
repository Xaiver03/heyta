package com.heytamobile.widget

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Paths

/**
 * W1-1 的**第一步**：先证明"单测真的能跑"，再写解析器。
 *
 * ============================================================
 * 为什么第一步是这个，而不是直接写解析器
 * ============================================================
 *
 * 写解析器之前有三个**互相独立**的未知数，任何一个不成立都会让后面白写：
 *
 *   1. `:app:testDebugUnitTest` 在这个工程里**能不能跑**（此前没有任何 `src/test`）；
 *   2. Android 单测里 `org.json` 拿到的**是桩还是真实现**；
 *   3. 测试进程**能不能读到仓库里那一份** golden fixture。
 *
 * 第 2 条是最阴的：`android.jar` 里的 `org.json` 是桩。如果开了
 * `returnDefaultValues = true`，桩**不抛异常而是返回 null/0** ——
 * 于是解析"成功"了，只是结果全空，测试照样绿。
 * 那正是本仓库反复强调要消灭的形状：**一个不可能失败的检查**。
 * 所以这里专门有一条测试去撞它。
 *
 * 第 3 条同样不平凡：夹具路径由 Gradle 通过系统属性注入
 *（`app/build.gradle` 的 `tasks.withType(Test)`），因为"测试进程的工作目录"
 * 是 Gradle 的实现细节，写死相对路径迟早会读到**另一份**同名文件。
 */
class GoldenFixtureSmokeTest {

    private val fixturesDir: File = File(
        requireNotNull(System.getProperty("heyta.widget.fixtures")) {
            "缺少系统属性 heyta.widget.fixtures —— 应由 app/build.gradle 的 tasks.withType(Test) 注入"
        }
    )

    private fun read(name: String): JSONObject =
        JSONObject(File(fixturesDir, name).readText(Charsets.UTF_8))

    @Test
    fun `夹具体系可解析，且指向的是仓库里那一份而不是副本`() {
        assertTrue("夹具目录不存在：$fixturesDir", fixturesDir.isDirectory)

        // 🔴 不只断言"文件在"，还断言**它在仓库的正确位置**。
        //    否则若有人把夹具复制一份到 app/src/test/resources 再改路径，
        //    这就变成"两个真源"——四端漂移的起点，而且不会报错。
        val canonical = fixturesDir.canonicalFile.toPath()
        assertTrue(
            "夹具目录不在 packages/widget-core/fixtures 下：$canonical",
            canonical.endsWith(Paths.get("packages", "widget-core", "fixtures"))
        )

        listOf("v1.golden.json", "v1.golden.plaintext.json", "v99.unknown.golden.json").forEach {
            assertTrue("缺夹具：$it", File(fixturesDir, it).isFile)
        }
    }

    @Test
    fun `org json 是真实实现，不是 android stub`() {
        // 若拿到的是 android.jar 的桩：
        //   - 没开 returnDefaultValues → 抛 RuntimeException("Stub!")
        //   - 开了 returnDefaultValues → 返回 null / 0
        // 两种情况都会让下面每一条断言失败。这就是这条测试存在的全部意义。
        val o = JSONObject("""{"a":1,"b":"x","c":[1,2],"d":true,"e":null}""")

        assertEquals(1, o.getInt("a"))
        assertEquals("x", o.getString("b"))
        assertEquals(2, o.getJSONArray("c").length())
        assertEquals(2, o.getJSONArray("c").getInt(1))
        assertTrue(o.getBoolean("d"))
        assertTrue("null 必须被识别为 null", o.isNull("e"))
    }

    @Test
    fun `信封的字段与契约一致`() {
        val env = read("v1.golden.json")

        assertEquals(1, env.getInt("v"))
        assertEquals("2026-09-27", env.getString("dayStr"))
        assertEquals(1_790_000_000_000L, env.getLong("validUntil"))
        assertEquals("AES-GCM-256", env.getString("alg"))
        assertTrue(env.has("nonce"))
        assertTrue(env.has("ciphertext"))
    }

    @Test
    fun `明暗两套类别色都在原生 token 文件里（D7 的更正后事实）`() {
        // 这条测试与解析器无关，它守的是**一条曾经写错的结论**。
        // 账本里 D7 原写"原生 token 文件里一个类别色都没有"（用 `grep -c category` 大小写敏感
        // 得到 0）。真相是 `colorCategory1..8` 明暗各一套，共 16 个。
        // 把事实钉在测试里，比钉在注释里更难被推翻。
        val swift = File(
            fixturesDir,
            "../../design-system/generated/HeytaTokens.swift"
        ).canonicalFile

        assertTrue("找不到 HeytaTokens.swift：$swift", swift.isFile)

        val text = swift.readText(Charsets.UTF_8)
        val hits = Regex("colorCategory[1-8]").findAll(text).count()
        assertEquals("明暗各 8 个类别色，共 16 处 colorCategoryN", 16, hits)
    }
}
