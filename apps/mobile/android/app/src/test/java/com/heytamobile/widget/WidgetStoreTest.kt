package com.heytamobile.widget

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class WidgetStoreTest {
    private class MemoryStore : WidgetKeyValueStore {
        val data = ConcurrentHashMap<String, String>()
        var commits = 0
        var failCommit = false
        override fun getString(key: String) = data[key]
        override fun putString(key: String, value: String) { data[key] = value }
        override fun remove(key: String) { data.remove(key) }
        override fun commit(): Boolean { commits++; return !failCommit }
    }
    private val first = WidgetIntent("task", true, 1)

    @Test fun `read survives a new store instance until exact acknowledgement`() {
        val memory = MemoryStore()
        val initial = WidgetStore(memory)
        initial.updateIntents { WidgetIntentQueue(listOf(first)) }
        val raw = initial.drainIntents()
        val restarted = WidgetStore(memory)
        assertEquals(raw, restarted.drainIntents())
        restarted.acknowledgeIntents(WidgetIntentQueue(listOf(first)))
        assertTrue(restarted.peekIntents().intents.isEmpty())
    }

    @Test fun `acknowledgement preserves newer click on same task`() {
        val memory = MemoryStore()
        val host = WidgetStore(memory)
        val provider = WidgetStore(memory)
        host.updateIntents { WidgetIntentQueue(listOf(first)) }
        host.drainIntents()
        val newer = WidgetIntent("task", false, 2)
        provider.updateIntents { WidgetIntentQueues.merge(it, newer) }
        host.acknowledgeIntents(WidgetIntentQueue(listOf(first)))
        assertEquals(listOf(newer), host.peekIntents().intents)
    }

    @Test fun `concurrent acknowledgements cannot erase another producer click`() {
        val memory = MemoryStore()
        val old = WidgetIntent("old", true, 1)
        val new = WidgetIntent("new", true, 2)
        WidgetStore(memory).updateIntents { WidgetIntentQueue(listOf(old)) }
        val barrier = CyclicBarrier(2)
        val pool = Executors.newFixedThreadPool(2)
        try {
            val ack = pool.submit { barrier.await(); WidgetStore(memory).acknowledgeIntents(WidgetIntentQueue(listOf(old))) }
            val append = pool.submit { barrier.await(); WidgetStore(memory).updateIntents { WidgetIntentQueues.merge(it, new) } }
            ack.get(10, TimeUnit.SECONDS); append.get(10, TimeUnit.SECONDS)
            assertEquals(listOf(new), WidgetStore(memory).peekIntents().intents)
        } finally { pool.shutdownNow() }
    }

    @Test fun `cleanup prevents stale launcher clicks from recreating state`() {
        val memory = MemoryStore(); val store = WidgetStore(memory)
        store.writeSnapshot("encrypted")
        assertTrue(store.appendIntentIfSnapshot(first))
        store.clearAll()
        assertFalse(store.appendIntentIfSnapshot(first))
        assertNull(store.readSnapshot())
        assertTrue(store.peekIntents().intents.isEmpty())
    }

    @Test fun `reads never write and failed persistence does not report success`() {
        val memory = MemoryStore(); val store = WidgetStore(memory)
        store.writeSnapshot("encrypted")
        val count = memory.commits
        store.readSnapshot(); store.drainIntents()
        assertEquals(count, memory.commits)
        memory.failCommit = true
        assertThrows(IllegalStateException::class.java) { store.updateIntents { WidgetIntentQueue(listOf(first)) } }
    }
}
