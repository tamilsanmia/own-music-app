package snowsig.music.data

import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import org.junit.Assert.assertEquals
import org.junit.Test
import snowsig.music.data.api.MusicApi
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
class LikesRepositoryTest {
    private val scope = TestScope(StandardTestDispatcher())
    private val api = mockk<MusicApi>(relaxed = true)

    @Test
    fun `loads ids and toggles at once`() = scope.run {
        coEvery { api.likedIds() } returns listOf("a")
        val repo = LikesRepository(api, this)
        testScheduler.run { kotlinx.coroutines.runBlocking { repo.refresh() } }
        assertEquals(setOf("a"), repo.ids.value)

        repo.toggle("b")
        assertEquals(setOf("a", "b"), repo.ids.value)
        repo.toggle("a")
        assertEquals(setOf("b"), repo.ids.value)
        runCurrent()
        coVerify { api.like("b") }
        coVerify { api.unlike("a") }
    }

    @Test
    fun `rolls back when the server refuses`() = scope.run {
        coEvery { api.like("b") } throws IOException("offline")
        val repo = LikesRepository(api, this)
        repo.toggle("b")
        assertEquals(setOf("b"), repo.ids.value)
        runCurrent()
        assertEquals(emptySet<String>(), repo.ids.value)
    }
}
