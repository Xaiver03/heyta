package com.heytamobile.widget

import org.junit.Assert.*
import org.junit.Test

class WidgetLocalePreferenceTest {
    @Test fun `only the two application locales are accepted`() {
        assertEquals("zh-CN", WidgetLocalePreference.supported("zh-CN"))
        assertEquals("en", WidgetLocalePreference.supported("en"))
        assertNull(WidgetLocalePreference.supported(null))
        assertNull(WidgetLocalePreference.supported("unsupported"))
        assertNull(WidgetLocalePreference.supported(""))
    }
}
