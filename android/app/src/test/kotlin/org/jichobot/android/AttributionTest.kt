package org.jichobot.android

import org.junit.Assert.assertEquals
import org.junit.Test

class AttributionTest {
    @Test fun nameAndRepoMatchPermission() {
        assertEquals("JichoBot for Android", Attribution.APP_NAME)
        assertEquals("https://github.com/T31SHA/jicho", Attribution.REPO_URL)
    }
}
