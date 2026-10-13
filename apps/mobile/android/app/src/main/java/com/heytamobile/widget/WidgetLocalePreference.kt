package com.heytamobile.widget

import android.content.Context
import android.content.res.Configuration
import java.util.Locale

/** 非敏感设备偏好；独立于账号快照和密钥，登出后仍用于占位文案。 */
object WidgetLocalePreference {
    private const val PREFS_NAME = "heyta_widget_preferences"
    private const val LOCALE_KEY = "locale"

    fun supported(raw: String?): String? = when (raw) {
        "zh-CN", "en" -> raw
        else -> null
    }

    fun read(context: Context): String? = supported(context.applicationContext
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(LOCALE_KEY, null))

    fun write(context: Context, locale: String) {
        require(supported(locale) != null) { "Unsupported widget locale" }
        check(context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit().putString(LOCALE_KEY, locale).commit()) { "Widget locale persistence failed" }
    }

    /** 只覆盖这次 RemoteViews 的资源语言，不改系统/Activity 配置。 */
    fun localizedContext(context: Context): Context {
        val locale = read(context) ?: return context
        val configuration = Configuration(context.resources.configuration)
        configuration.setLocale(Locale.forLanguageTag(locale))
        return context.createConfigurationContext(configuration)
    }
}
