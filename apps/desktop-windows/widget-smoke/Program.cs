using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using Heyta.Windows.Host;

if (args.Length == 2 && args[0] == "--read-locale")
{
    WindowsWidgetStore.ConfigureStateDirectory(args[1]);
    Console.WriteLine(WindowsWidgetStore.ReadWidgetLocale());
    return;
}

var family = "heyta-widget-locale-smoke-" + Guid.NewGuid().ToString("N");
WindowsWidgetStore.ConfigureStateDirectory(family);
var stateDirectory = WindowsWidgetStore.StateDirectoryPath;
var originalCulture = CultureInfo.CurrentUICulture;
var checks = 0;
void Check(bool passes, string description)
{
    if (!passes) throw new InvalidOperationException(description);
    checks++;
    Console.WriteLine("PASS " + description);
}

try
{
    CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo("en-US");
    Check(WindowsWidgetStore.ReadWidgetLocale() == "en", "missing preference uses supported English system language");
    CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo("zh-HK");
    Check(WindowsWidgetStore.ReadWidgetLocale() == "zh-CN", "missing preference maps system Chinese to supported Chinese locale");
    Check(WindowsWidgetStore.SetWidgetLocale("en"), "application English preference is accepted");
    Check(WindowsWidgetStore.ReadWidgetLocale() == "en", "application language overrides Chinese system language");
    Check(!WindowsWidgetStore.SetWidgetLocale("fr"), "unsupported locale is rejected");
    Check(WindowsWidgetStore.ReadWidgetLocale() == "en", "unsupported locale cannot overwrite saved preference");
    Check(File.ReadAllText(Path.Combine(stateDirectory, WindowsWidgetStore.LocaleFileName)) == "en", "device preference contains only locale, no snapshot or account data");
    Check(WindowsWidgetStore.SetWidgetLocale("zh-CN"), "switch to Chinese persists");
    using (var child = Process.Start(new ProcessStartInfo(Environment.ProcessPath!)
    {
        ArgumentList = { "--read-locale", family }, RedirectStandardOutput = true,
    }) ?? throw new InvalidOperationException("cannot start independent provider preference probe"))
    {
        var output = child.StandardOutput.ReadToEnd();
        Check(child.WaitForExit(20000) && child.ExitCode == 0 && output.Trim() == "zh-CN", "independently woken process reads last application language");
    }
    WindowsWidgetStore.ClearWidgetState();
    Check(WindowsWidgetStore.ReadWidgetLocale() == "zh-CN", "clearing sensitive widget data preserves non-sensitive device language");

    using var payload = JsonDocument.Parse("""
      {"today":[{"id":"t1","title":"Task","isDone":true}],
       "quadrant":{"1":[{"id":"t1","title":"Task","isDone":false}]},
       "habits":[{"id":"h1","title":"Habit","doneToday":true,"streak":1},{"id":"h2","title":"Habit two","doneToday":false,"streak":2}],
       "focus":{"active":true,"sessionTitle":"Task","targetSeconds":1500}}
      """);
    foreach (var locale in new[] { "zh-CN", "en" })
    {
        WindowsWidgetStore.SetWidgetLocale(locale);
        var strings = new WindowsWidgetStrings(locale);
        foreach (var kind in new[] { "today", "quadrant", "habits", "focus" })
        {
            using var card = JsonDocument.Parse(CardTemplates.FromPayload(kind, payload.RootElement, locale));
            Check(card.RootElement.GetProperty("titleText").GetString() == strings.Text($"widget.{kind}.title"), locale + " " + kind + " non-empty card title is localized");
            using var placeholder = JsonDocument.Parse(CardTemplates.Data(kind));
            Check(placeholder.RootElement.GetProperty("placeholderText").GetString() == strings.Text("widget.placeholder.openApp"), locale + " " + kind + " independent provider placeholder is localized");
        }
        using var today = JsonDocument.Parse(CardTemplates.FromPayload("today", payload.RootElement, locale));
        Check(today.RootElement.GetProperty("previewRows")[0].GetProperty("actionText").GetString() == strings.Text("widget.task.reopenAction", ("title", "Task")), locale + " task accessibility action uses shared i18n");
        using var habits = JsonDocument.Parse(CardTemplates.FromPayload("habits", payload.RootElement, locale));
        Check(habits.RootElement.GetProperty("previewRows")[0].GetProperty("streakLabel").GetString() == strings.Text("web.habits.streak.currentOne", ("count", 1)), locale + " streak singular uses shared i18n");
        Check(habits.RootElement.GetProperty("previewRows")[1].GetProperty("streakLabel").GetString() == strings.Text("web.habits.streak.current", ("count", 2)), locale + " streak plural uses shared i18n");
        using var focus = JsonDocument.Parse(CardTemplates.FromPayload("focus", payload.RootElement, locale));
        Check(focus.RootElement.GetProperty("targetLabel").GetString() == strings.Text("widget.focus.target", ("duration", strings.Text("widget.focus.minutes", ("minutes", 25)))), locale + " focus duration interpolation uses shared i18n");
    }
    File.WriteAllText(Path.Combine(stateDirectory, WindowsWidgetStore.LocaleFileName), "malformed");
    Check(WindowsWidgetStore.ReadWidgetLocale() == "zh-CN", "malformed device preference falls back to supported system language");
    Console.WriteLine($"WIDGET_LOCALE_SMOKE=OK {checks}/{checks}");
}
finally
{
    CultureInfo.CurrentUICulture = originalCulture;
    Directory.Delete(stateDirectory, recursive: true);
}
