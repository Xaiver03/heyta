using System.Globalization;
using System.Text.Json;

namespace Heyta.Windows.Host;

/// <summary>Generated i18n resource; no independently maintained native copy.</summary>
public sealed class WindowsWidgetStrings
{
    private static readonly Dictionary<string, Dictionary<string, string>> Catalog = Load();
    private readonly Dictionary<string, string> _messages;

    public WindowsWidgetStrings(string locale)
    {
        _messages = Catalog[locale == "zh-CN" ? "zh-CN" : "en"];
    }

    public string Text(string key, params (string Key, object Value)[] parameters)
    {
        var text = _messages[key];
        foreach (var (name, value) in parameters)
            text = text.Replace("{" + name + "}", Convert.ToString(value, CultureInfo.InvariantCulture), StringComparison.Ordinal);
        return text;
    }

    private static Dictionary<string, Dictionary<string, string>> Load()
    {
        using var source = typeof(WindowsWidgetStrings).Assembly.GetManifestResourceStream("Heyta.WidgetStrings")
            ?? throw new InvalidDataException("generated widget strings resource missing");
        return JsonSerializer.Deserialize<Dictionary<string, Dictionary<string, string>>>(source)
            ?? throw new InvalidDataException("generated widget strings resource invalid");
    }
}
