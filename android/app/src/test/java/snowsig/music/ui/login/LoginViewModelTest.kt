package snowsig.music.ui.login

import app.cash.turbine.test
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.runTest
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import snowsig.music.data.auth.SessionManager
import snowsig.music.testing.MainDispatcherRule
import java.io.IOException

class LoginViewModelTest {
    @get:Rule val main = MainDispatcherRule()

    private val session = mockk<SessionManager>()

    private fun http(code: Int, body: String) =
        HttpException(Response.error<Any>(code, body.toResponseBody()))

    @Test
    fun `submit is disabled until both fields are filled`() {
        val vm = LoginViewModel(session)
        assertFalse(vm.state.value.canSubmit)
        vm.onEmail("ann@test.local")
        assertFalse(vm.state.value.canSubmit)
        vm.onPassword("pw")
        assertTrue(vm.state.value.canSubmit)
        vm.onEmail("   ")
        assertFalse(vm.state.value.canSubmit)
    }

    @Test
    fun `successful login shows progress, then clears the password`() = runTest {
        val gate = CompletableDeferred<Unit>()
        coEvery { session.login("ann@test.local", "pw") } coAnswers { gate.await() }
        val vm = LoginViewModel(session)
        vm.onEmail("ann@test.local")
        vm.onPassword("pw")

        vm.state.test {
            assertFalse(awaitItem().submitting)
            vm.submit()
            assertTrue(awaitItem().submitting)
            gate.complete(Unit)
            val done = awaitItem()
            assertFalse(done.submitting)
            assertEquals("", done.password)
            assertNull(done.error)
        }
        coVerify(exactly = 1) { session.login("ann@test.local", "pw") }
    }

    @Test
    fun `shows the server's message for wrong credentials`() {
        coEvery { session.login(any(), any()) } throws http(401, """{"message":"Invalid email or password","statusCode":401}""")
        val vm = LoginViewModel(session).apply { onEmail("ann@test.local"); onPassword("nope"); submit() }
        assertEquals("Invalid email or password", vm.state.value.error)
        assertFalse(vm.state.value.submitting)
    }

    @Test
    fun `explains rate limiting and network errors`() {
        coEvery { session.login(any(), any()) } throws http(429, """{"message":"ThrottlerException"}""")
        val vm = LoginViewModel(session).apply { onEmail("a@b.c"); onPassword("x"); submit() }
        assertEquals("Too many attempts. Wait a minute and try again.", vm.state.value.error)

        coEvery { session.login(any(), any()) } throws IOException("offline")
        vm.submit()
        assertEquals("Can’t reach the server. Check your connection.", vm.state.value.error)
    }

    @Test
    fun `typing clears the error`() {
        coEvery { session.login(any(), any()) } throws IOException("offline")
        val vm = LoginViewModel(session).apply { onEmail("a@b.c"); onPassword("x"); submit() }
        vm.onPassword("y")
        assertNull(vm.state.value.error)
    }
}
