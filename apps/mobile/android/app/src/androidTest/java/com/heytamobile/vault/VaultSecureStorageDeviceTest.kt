package com.heytamobile.vault

import android.content.Context
import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertFalse
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Real-device probe for the vault secure-storage boundary.
 *
 * The default test verifies account isolation. The opt-in vaultProbePhase
 * seed/verify/remove phases run in separate instrumentation invocations; each
 * phase checks the preceding PID, so an in-process rerun cannot claim durable
 * process-restart evidence. All fixture keys are synthetic and never logged.
 */
@RunWith(AndroidJUnit4::class)
class VaultSecureStorageDeviceTest {
    private val context: Context
        get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val preferences
        get() = context.getSharedPreferences(VaultSecureStorageModule.PREFERENCES, Context.MODE_PRIVATE)
    private val accountA = "vault-device-test-a"
    private val accountB = "vault-device-test-b"
    private val origin = "https://vault-device-test.invalid"
    private val rootA = Base64.encodeToString(ByteArray(32) { 0x11 }, Base64.NO_WRAP)
    private val rootB = Base64.encodeToString(ByteArray(32) { 0x22 }, Base64.NO_WRAP)
    private val phase: String?
        get() = InstrumentationRegistry.getArguments().getString("vaultProbePhase")
    private val probeMetadata
        get() = context.getSharedPreferences("vault_device_test_metadata", Context.MODE_PRIVATE)

    @Before
    fun setUp() {
        if (phase != null) return
        VaultSecureStorage.remove(preferences, origin, accountA)
        VaultSecureStorage.remove(preferences, origin, accountB)
    }

    @After
    fun tearDown() {
        if (phase != null) return
        VaultSecureStorage.remove(preferences, origin, accountA)
        VaultSecureStorage.remove(preferences, origin, accountB)
    }

    @Test
    fun accountScopesAreIsolatedAndRemovalDoesNotTouchAnotherAccount() {
        assumeTrue("Standalone isolation test", phase == null)
        VaultSecureStorage.save(preferences, origin, accountA, rootA)
        VaultSecureStorage.save(preferences, origin, accountB, rootB)

        assertEquals(rootA, VaultSecureStorage.load(preferences, origin, accountA))
        assertEquals(rootB, VaultSecureStorage.load(preferences, origin, accountB))

        VaultSecureStorage.remove(preferences, origin, accountA)

        assertNull(VaultSecureStorage.load(preferences, origin, accountA))
        assertEquals(rootB, VaultSecureStorage.load(preferences, origin, accountB))
    }

    @Test
    fun separateProcessPersistenceAndDeletion() {
        assumeTrue("Requires the multi-process probe runner", phase != null)
        val selectedPhase = requireNotNull(phase)
        val pid = android.os.Process.myPid()
        val bootCount = android.provider.Settings.Global.getInt(context.contentResolver, android.provider.Settings.Global.BOOT_COUNT, -1)
        if (selectedPhase != "seed") {
            val previousPid = probeMetadata.getInt("pid", -1)
            check(previousPid > 0) { "Run the seed phase first" }
            check(previousPid != pid || probeMetadata.getInt("bootCount", -1) != bootCount) {
                "Each phase must run in a new app process"
            }
        }
        when (selectedPhase) {
            "seed" -> {
                VaultSecureStorage.save(preferences, origin, accountA, rootA)
                VaultSecureStorage.save(preferences, origin, accountB, rootB)
                // Inspect persisted envelopes, not just the bridge return value.
                assertFalse(preferences.all.values.any { it.toString().contains(rootA) || it.toString().contains(rootB) })
            }
            "verify" -> {
                assertEquals(rootA, VaultSecureStorage.load(preferences, origin, accountA))
                assertEquals(rootB, VaultSecureStorage.load(preferences, origin, accountB))
                assertNull(VaultSecureStorage.load(preferences, "https://other.invalid", accountA))
                VaultSecureStorage.remove(preferences, origin, accountA)
            }
            "remove" -> {
                assertNull(VaultSecureStorage.load(preferences, origin, accountA))
                assertEquals(rootB, VaultSecureStorage.load(preferences, origin, accountB))
                VaultSecureStorage.remove(preferences, origin, accountB)
            }
            "clean" -> {
                assertNull(VaultSecureStorage.load(preferences, origin, accountA))
                assertNull(VaultSecureStorage.load(preferences, origin, accountB))
            }
            else -> error("Unknown vaultProbePhase")
        }
        check(probeMetadata.edit().putInt("pid", pid).putInt("bootCount", bootCount).commit())
    }
}
