package snowsig.music.ui.playlist

import androidx.lifecycle.SavedStateHandle
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import snowsig.music.data.PlaylistsRepository
import snowsig.music.data.api.MoveRequest
import snowsig.music.data.api.MusicApi
import snowsig.music.data.api.PlaylistDto
import snowsig.music.data.api.PlaylistItemDto
import snowsig.music.data.api.Ref
import snowsig.music.data.api.TrackDto
import snowsig.music.testing.MainDispatcherRule
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
class PlaylistViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    @get:Rule val main = MainDispatcherRule(dispatcher)

    private val api = mockk<MusicApi>()
    private val repo = mockk<PlaylistsRepository>(relaxed = true)
    private fun item(n: Int) = PlaylistItemDto("i$n", TrackDto("t$n", "Song $n", n, 1000, Ref("a", "Deva")))
    private fun playlist(vararg n: Int) = PlaylistDto("p1", "Mix", null, n.size, emptyList(), n.map(::item))
    private fun PlaylistViewModel.titles() = state.value.data!!.items.map { it.track.title }

    private fun vm(initial: PlaylistDto = playlist(1, 2, 3)): PlaylistViewModel {
        coEvery { api.playlist("p1") } returns initial
        return PlaylistViewModel(SavedStateHandle(mapOf("id" to "p1")), api, repo)
    }

    @Test
    fun `moves a song at once and keeps the server's answer`() = runTest(dispatcher) {
        val sent = slot<MoveRequest>()
        val reply = CompletableDeferred<PlaylistDto>()
        coEvery { api.movePlaylistItem("p1", capture(sent)) } coAnswers { reply.await() }
        val vm = vm()
        runCurrent()

        vm.move("i3", 0)
        assertEquals(listOf("Song 3", "Song 1", "Song 2"), vm.titles()) // before the server answers
        runCurrent()
        assertEquals(MoveRequest("i3", 0), sent.captured)
        reply.complete(playlist(3, 1, 2))
        runCurrent()
        assertEquals(listOf("Song 3", "Song 1", "Song 2"), vm.titles())
        coVerify { repo.refresh() }
    }

    @Test
    fun `undoes a move the server refuses`() = runTest(dispatcher) {
        coEvery { api.movePlaylistItem(any(), any()) } throws IOException("offline")
        val vm = vm()
        runCurrent()
        vm.move("i1", 2)
        assertEquals(listOf("Song 2", "Song 3", "Song 1"), vm.titles())
        runCurrent()
        assertEquals(listOf("Song 1", "Song 2", "Song 3"), vm.titles())
        assertEquals("That change couldn’t be saved, so it was undone.", vm.message.value)
    }

    @Test
    fun `removes a song`() = runTest(dispatcher) {
        coEvery { api.removeFromPlaylist("p1", "i2") } returns playlist(1, 3)
        val vm = vm()
        runCurrent()
        vm.remove("i2")
        assertEquals(listOf("Song 1", "Song 3"), vm.titles())
        assertEquals(2, vm.state.value.data!!.trackCount)
        runCurrent()
        assertNull(vm.message.value)
    }

    @Test
    fun `moved clamps the target`() {
        assertEquals(listOf("b", "c", "a"), listOf("a", "b", "c").moved(0, 99))
        assertEquals(listOf("c", "a", "b"), listOf("a", "b", "c").moved(2, -5))
    }
}
