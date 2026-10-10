import Foundation

/// 非敏感设备语言。独立文件，不进入快照、密钥或任务 op；账号清理保留它。
public enum WidgetLocalePreference {
    public static let fileName = "widget-locale.json"

    public static func supported(_ raw: String?) -> String? {
        switch raw {
        case "zh-CN", "en": return raw
        default: return nil
        }
    }

    public static func current() -> String? {
        read(from: WidgetContainerFiles.containerURL()?.appendingPathComponent(fileName))
    }

    public static func read(from url: URL?) -> String? {
        guard let url, let data = try? Data(contentsOf: url),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return supported(object["locale"] as? String)
    }

    public static func write(_ locale: String) throws {
        try write(locale, to: WidgetContainerFiles.containerURL()?.appendingPathComponent(fileName))
    }

    public static func write(_ locale: String, to url: URL?) throws {
        guard supported(locale) != nil else { throw Failure.unsupportedLocale }
        guard let url else { throw Failure.containerUnavailable }
        let data = try JSONSerialization.data(withJSONObject: ["locale": locale])
        try data.write(to: url, options: .atomic)
        #if os(iOS)
        // 只有语言代码，无用户内容；锁屏时仍能维持界面语言一致。
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.none], ofItemAtPath: url.path)
        #endif
    }

    public enum Failure: Error { case unsupportedLocale, containerUnavailable }
}
