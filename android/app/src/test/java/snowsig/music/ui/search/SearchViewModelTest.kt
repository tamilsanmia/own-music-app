package snowsig.music.ui.search

import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import snowsig.music.data.api.MusicApi
import snowsig.music.data.api.Ref
import snowsig.music.data.api.SearchDto
import snowsig.music.data.api.TrackDto
import snowsig.music.testing.MainDispatcherRule
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
class SearchViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    @get:Rule val main = MainDispatcherRule(dispatcher)

    private val api = mockk<MusicApi>()
    private fun result(title: String) = SearchDto(listOf(TrackDto("t", title, 1, 1000, Ref("a", "Deva"))), emptyList(), emptyList())

    @Test
    fun `waits for a pause in typing and searches once`() = runTest(dispatcher) {
        coEvery { api.search(any()) } answers { result(firstArg()) }
        val vm = SearchViewModel(api)
        vm.onQuery("v")
        advanceTimeBy(100)
        vm.onQuery("va")
        advanceTimeBy(100)
        vm.onQuery("vaa")
        advanceTimeBy(SEARCH_DEBOUNCE_MS - 1)
        runCurrent()
        coVerify(exactly = 0) { api.search(any()) }

        advanceTimeBy(2)
        runCurrent()
        coVerify(exactly = 1) { api.search("vaa") }
        val r = vm.results.value as SearchResultState.Results
        assertEquals("vaa", r.query)
        assertEquals("vaa", r.results.tracks.single().title)
    }

    @Test
    fun `blank or repeated queries don't search`() = runTest(dispatcher) {
        coEvery { api.search(any()) } returns result("x")
        val vm = SearchViewModel(api)
        vm.onQuery("   ")
        advanceTimeBy(SEARCH_DEBOUNCE_MS + 1); runCurrent()
        assertEquals(SearchResultState.Idle, vm.results.value)

        vm.onQuery("deva")
        advanceTimeBy(SEARCH_DEBOUNCE_MS + 1); runCurrent()
        vm.onQuery("deva ") // same after trimming
        advanceTimeBy(SEARCH_DEBOUNCE_MS + 1); runCurrent()
        coVerify(exactly = 1) { api.search(any()) }

        vm.onQuery("")
        advanceTimeBy(SEARCH_DEBOUNCE_MS + 1); runCurrent()
        assertEquals(SearchResultState.Idle, vm.results.value)
    }

    @Test
    fun `a newer query replaces a slow older one`() = runTest(dispatcher) {
        val slow = CompletableDeferred<SearchDto>()
        coEvery { api.search("old") } coAnswers { slow.await() }
        coEvery { api.search("new") } returns result("new")
        val vm = SearchViewModel(api)
        vm.onQuery("old")
        advanceTimeBy(SEARCH_DEBOUNCE_MS + 1); runCurrent()
        assertTrue(vm.results.value is SearchResultState.Loading)
        vm.onQuery("new")
        advanceTimeBy(SEARCH_DEBOUNCE_MS + 1); runCurrent()
        slow.complete(result("old"))
        runCurrent()
        assertEquals("new", (vm.results.value as SearchResultState.Results).query)
    }

    @Test
    fun `shows an error message`() = runTest(dispatcher) {
        coEvery { api.search(any()) } throws IOException("offline")
        val vm = SearchViewModel(api)
        vm.onQuery("deva")
        advanceTimeBy(SEARCH_DEBOUNCE_MS + 1); runCurrent()
        assertEquals(SearchResultState.Error("deva", "Can’t reach the server. Check your connection."), vm.results.value)
    }
}
