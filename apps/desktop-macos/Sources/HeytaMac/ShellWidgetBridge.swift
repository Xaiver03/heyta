import Foundation
import WebKit
import WidgetKit
import HeytaWidgetBridge
import HeytaWidgetCore

/// Native transport only: the shared app-host owns snapshot selection and all task writes.
@MainActor
final class ShellWidgetBridge: NSObject, WKScriptMessageHandlerWithReply {
    private let service = WidgetBridgeService(
        store: AppGroupWidgetStore(), keyStore: WidgetDeviceKeyStore(),
        push: { WidgetCenter.shared.reloadAllTimelines() }
    )
    weak var webView: WKWebView?

    override init() {
        super.init()
        DistributedNotificationCenter.default().addObserver(
            self, selector: #selector(intentsChanged),
            name: Notification.Name("cloud.finlaw.heyta.widget-intents"), object: nil
        )
    }

    deinit { DistributedNotificationCenter.default().removeObserver(self) }

    @objc private func intentsChanged() {
        webView?.evaluateJavaScript("window.dispatchEvent(new Event('heyta:widget-intents'));")
    }

    static let shim = """
    (() => {
      const call = (method, args = []) => window.webkit.messageHandlers.heytaWidget.postMessage({method, args});
      window.__heytaNativeWidgetBridge = Object.freeze({
        sealWidgetSnapshot: (payloadJson, dayStr, validUntil) => call('sealWidgetSnapshot', [payloadJson, dayStr, validUntil]),
        setWidgetSnapshot: envelopeJson => call('setWidgetSnapshot', [envelopeJson]),
        drainIntentQueue: () => call('drainIntentQueue'),
        ackIntentQueue: processedJson => call('ackIntentQueue', [processedJson]),
        mergeIntentQueue: pendingJson => call('mergeIntentQueue', [pendingJson]),
        clearWidgetState: () => call('clearWidgetState'),
        readPrivacyRaw: () => call('readPrivacyRaw'),
        setWidgetPrivacy: alwaysHideTitles => call('setWidgetPrivacy', [alwaysHideTitles]),
        setWidgetLocale: locale => call('setWidgetLocale', [locale]),
      });
    })();
    """

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void
    ) {
        guard message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol == "heyta-local",
              message.frameInfo.securityOrigin.host == "app",
              let body = message.body as? [String: Any],
              let method = body["method"] as? String,
              let args = body["args"] as? [Any] else {
            replyHandler(nil, "Widget bridge rejected origin or malformed message")
            return
        }
        do {
            let result: Any
            switch method {
            case "sealWidgetSnapshot":
                guard args.count == 3, let payload = args[0] as? String,
                      let day = args[1] as? String, let until = args[2] as? Double else { throw Failure.arguments }
                result = try service.sealWidgetSnapshot(payloadJson: payload, dayStr: day, validUntil: until)
            case "setWidgetSnapshot":
                guard args.count == 1, let envelope = args[0] as? String else { throw Failure.arguments }
                try service.setWidgetSnapshot(envelope); result = true
            case "drainIntentQueue": result = try service.drainIntentQueue() as Any? ?? NSNull()
            case "ackIntentQueue":
                guard args.count == 1, let processed = args[0] as? String else { throw Failure.arguments }
                result = try service.ackIntentQueue(processed)
            case "mergeIntentQueue":
                guard args.count == 1, let queue = args[0] as? String else { throw Failure.arguments }
                result = try service.mergeIntentQueue(queue)
            case "clearWidgetState":
                try service.clearWidgetState()
                result = true
            case "readPrivacyRaw":
                if let raw = service.readPrivacyRaw() {
                    let data = try JSONSerialization.data(withJSONObject: raw, options: [.fragmentsAllowed])
                    result = String(decoding: data, as: UTF8.self)
                } else { result = NSNull() }
            case "setWidgetPrivacy":
                guard args.count == 1, let hide = args[0] as? Bool else { throw Failure.arguments }
                try service.setWidgetPrivacy(alwaysHideTitles: hide)
                WidgetCenter.shared.reloadAllTimelines(); result = true
            case "setWidgetLocale":
                guard args.count == 1, let locale = args[0] as? String else { throw Failure.arguments }
                try WidgetLocalePreference.write(locale)
                WidgetCenter.shared.reloadAllTimelines(); result = true
            default: throw Failure.arguments
            }
            replyHandler(result, nil)
        } catch { replyHandler(nil, "Widget bridge: \(error)") }
    }

    private enum Failure: Error { case arguments }
}
