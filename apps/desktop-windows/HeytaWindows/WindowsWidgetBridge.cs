using System.Text.Json;
using Heyta.Windows.Host;
using Microsoft.Web.WebView2.Core;
using Windows.ApplicationModel;

namespace Heyta.Shell;

/// <summary>
/// The only Windows-specific part of the shared native-widget session.
/// MainWindow injects <see cref="Script"/> before navigation and calls
/// <see cref="TryHandleMessage"/> before its existing op-log message branch.
/// </summary>
internal static class WindowsWidgetBridge
{
    public const string Script = """
      (() => {
        const pending = new Map();
        let sequence = 0;
        const call = (method, args = []) => new Promise((resolve, reject) => {
          const requestId = `widget-${Date.now()}-${sequence++}`;
          pending.set(requestId, { resolve, reject });
          window.chrome.webview.postMessage({ heytaNativeWidget: { requestId, method, args } });
        });
        window.__heytaNativeWidgetBridge = Object.freeze({
          sealWidgetSnapshot: (payloadJson, dayStr, validUntil) => call('sealWidgetSnapshot', [payloadJson, dayStr, validUntil]),
          setWidgetSnapshot: envelopeJson => call('setWidgetSnapshot', [envelopeJson]),
          setWidgetLocale: locale => call('setWidgetLocale', [locale]),
          drainIntentQueue: () => call('drainIntentQueue'),
          ackIntentQueue: processedJson => call('ackIntentQueue', [processedJson]),
          mergeIntentQueue: pendingJson => call('mergeIntentQueue', [pendingJson]),
          clearWidgetState: () => call('clearWidgetState'),
          readPrivacyRaw: () => Promise.resolve(null),
          setWidgetPrivacy: () => Promise.resolve(false),
        });
        window.chrome.webview.addEventListener('message', event => {
          const response = event.data?.heytaNativeWidgetResponse;
          if (!response || typeof response.requestId !== 'string') return;
          const entry = pending.get(response.requestId);
          if (!entry) return;
          pending.delete(response.requestId);
          if (typeof response.error === 'string') entry.reject(new Error(response.error));
          else entry.resolve(response.result);
        });
      })();
      """;

    public static bool TryHandleMessage(CoreWebView2 webView, string source, string rawMessage)
    {
        if (!Uri.TryCreate(source, UriKind.Absolute, out var origin) ||
            !string.Equals(origin.Scheme, "https", StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(origin.Host, "heyta.local", StringComparison.OrdinalIgnoreCase) ||
            origin.Port is not (-1 or 443) ||
            !string.IsNullOrEmpty(origin.UserInfo)) return false;
        return TryHandleMessage(webView, rawMessage);
    }

    public static bool TryHandleMessage(CoreWebView2 webView, string rawMessage)
    {
        try
        {
            using var doc = JsonDocument.Parse(rawMessage);
            if (!doc.RootElement.TryGetProperty("heytaNativeWidget", out var request)) return false;
            var requestId = request.GetProperty("requestId").GetString();
            var method = request.GetProperty("method").GetString();
            var args = request.TryGetProperty("args", out var supplied) ? supplied : default;
            if (string.IsNullOrWhiteSpace(requestId) || string.IsNullOrWhiteSpace(method)) return true;

            object? result = method switch
            {
                "sealWidgetSnapshot" => Seal(args),
                "setWidgetSnapshot" => Set(args),
                "setWidgetLocale" => SetLocale(args),
                "drainIntentQueue" => WindowsWidgetStore.DrainIntentQueue(),
                "ackIntentQueue" => Ack(args),
                "mergeIntentQueue" => Merge(args),
                "clearWidgetState" => Clear(),
                _ => throw new InvalidOperationException("unknown widget bridge method"),
            };
            Post(webView, requestId, result, null);
        }
        catch (Exception error)
        {
            try
            {
                using var doc = JsonDocument.Parse(rawMessage);
                var requestId = doc.RootElement.GetProperty("heytaNativeWidget").GetProperty("requestId").GetString();
                if (!string.IsNullOrWhiteSpace(requestId)) Post(webView, requestId, null, error.Message);
            }
            catch (JsonException) { }
        }
        return true;
    }

    private static string Seal(JsonElement args)
    {
        if (args.ValueKind != JsonValueKind.Array || args.GetArrayLength() != 3) throw new ArgumentException("widget seal arguments");
        return WindowsWidgetStore.SealWidgetSnapshot(args[0].GetString() ?? throw new ArgumentException("payload"), args[1].GetString() ?? throw new ArgumentException("day"), args[2].GetInt64());
    }

    private static bool Set(JsonElement args)
    {
        WindowsWidgetStore.SetWidgetSnapshot(args[0].GetString() ?? throw new ArgumentException("envelope"));
        return true;
    }

    private static bool SetLocale(JsonElement args)
    {
        if (args.ValueKind != JsonValueKind.Array || args.GetArrayLength() != 1 || args[0].ValueKind != JsonValueKind.String)
            throw new ArgumentException("widget locale arguments");
        return WindowsWidgetStore.SetWidgetLocale(args[0].GetString() ?? string.Empty);
    }

    private static int Merge(JsonElement args)
        => WindowsWidgetStore.MergeIntentQueue(args[0].GetString() ?? throw new ArgumentException("pending queue"));

    private static int Ack(JsonElement args)
    {
        if (args.ValueKind != JsonValueKind.Array || args.GetArrayLength() != 1)
            throw new ArgumentException("widget ack arguments");
        return WindowsWidgetStore.AckIntentQueue(args[0].GetString() ?? throw new ArgumentException("processed queue"));
    }

    private static bool Clear()
    {
        WindowsWidgetStore.ClearWidgetState();
        return true;
    }

    private static void Post(CoreWebView2 webView, string requestId, object? result, string? error)
    {
        webView.PostWebMessageAsJson(JsonSerializer.Serialize(new
        {
            heytaNativeWidgetResponse = new { requestId, result, error },
        }));
    }
}
