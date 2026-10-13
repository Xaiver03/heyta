using System.Text.Json;

namespace Heyta.Windows.Host;

public static class CardTemplates
{
    private const string Schema = "http://adaptivecards.io/schemas/adaptive-card.json";

    public static string Template(string definitionId) => definitionId switch
    {
        "today" => TodayTemplate,
        "quadrant" => QuadrantTemplate,
        "habits" => HabitsTemplate,
        "focus" => FocusTemplate,
        _ => TodayTemplate,
    };

    public static string Data(string definitionId)
    {
        try
        {
            var envelopeJson = WindowsWidgetStore.ReadSnapshot();
            if (envelopeJson is null) return Placeholder(definitionId);
            using var envelope = JsonDocument.Parse(envelopeJson);
            var root = envelope.RootElement;
            if (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() >= root.GetProperty("validUntil").GetInt64())
                return Placeholder(definitionId, stale: true);
            var plaintext = WindowsWidgetStore.OpenEnvelope(root, WindowsWidgetStore.GetExistingKey());
            using var payload = JsonDocument.Parse(plaintext);
            return FromPayload(definitionId, payload.RootElement, WindowsWidgetStore.ReadWidgetLocale());
        }
        catch
        {
            return Placeholder(definitionId);
        }
    }

    public static string FromPayload(string definitionId, JsonElement payload, string locale)
    {
        var strings = new WindowsWidgetStrings(locale);
        return definitionId switch
        {
            "today" => BuildToday(payload, strings),
            "quadrant" => BuildQuadrant(payload, strings),
            "habits" => BuildHabits(payload, strings),
            "focus" => BuildFocus(payload, strings),
            _ => Placeholder(definitionId),
        };
    }

    private static string BuildToday(JsonElement payload, WindowsWidgetStrings strings)
    {
        var tasks = payload.GetProperty("today");
        var rows = tasks.EnumerateArray().Take(4).Select(task => TaskRow(task, strings)).ToArray();
        return JsonSerializer.Serialize(new { kind = "today", showPlaceholder = false,
            titleText = strings.Text("widget.today.title"), countText = strings.Text("widget.today.count", ("count", tasks.GetArrayLength())),
            isEmpty = rows.Length == 0, emptyText = strings.Text("widget.today.empty"), overflowText = "", previewRows = rows });
    }

    private static string BuildQuadrant(JsonElement payload, WindowsWidgetStrings strings)
    {
        var slots = Enumerable.Range(1, 4).Select(slot =>
        {
            var rows = payload.TryGetProperty("quadrant", out var quadrant) && quadrant.TryGetProperty(slot.ToString(), out var raw)
                ? raw.EnumerateArray().Take(2).Select(task => TaskRow(task, strings)).ToArray() : [];
            var label = strings.Text($"web.quadrant.q{slot}");
            return new { heading = strings.Text("widget.quadrant.slotHeading", ("label", label), ("count", rows.Length)),
                isEmpty = rows.Length == 0, hint = strings.Text($"widget.quadrant.hint{slot}"), previewRows = rows, overflowText = "" };
        }).ToArray();
        return JsonSerializer.Serialize(new { kind = "quadrant", showPlaceholder = false, titleText = strings.Text("widget.quadrant.title"), slots });
    }

    private static string BuildHabits(JsonElement payload, WindowsWidgetStrings strings)
    {
        var rows = payload.TryGetProperty("habits", out var habits) ? habits.EnumerateArray().Take(4).Select(h => {
            var streak = h.TryGetProperty("streak", out var raw) ? raw.GetInt32() : 0;
            return new { id = h.GetProperty("id").GetString(), title = h.GetProperty("title").GetString(),
                doneLabel = h.TryGetProperty("doneToday", out var done) && done.GetBoolean() ? strings.Text("widget.habits.doneToday") : "",
                streakLabel = streak > 0 ? strings.Text(streak == 1 ? "web.habits.streak.currentOne" : "web.habits.streak.current", ("count", streak)) : "" };
        }).ToArray() : [];
        return JsonSerializer.Serialize(new { kind = "habits", showPlaceholder = false, titleText = strings.Text("widget.habits.title"),
            isEmpty = rows.Length == 0, emptyText = strings.Text("widget.habits.empty"), overflowText = "", previewRows = rows });
    }

    private static string BuildFocus(JsonElement payload, WindowsWidgetStrings strings)
    {
        var isActive = payload.TryGetProperty("focus", out var focus) && focus.TryGetProperty("active", out var active) && active.GetBoolean();
        var title = isActive && focus.TryGetProperty("sessionTitle", out var session) ? session.GetString() ?? "" : "";
        var seconds = isActive && focus.TryGetProperty("targetSeconds", out var target) ? target.GetInt32() : 0;
        var duration = strings.Text("widget.focus.minutes", ("minutes", Math.Ceiling(seconds / 60d)));
        return JsonSerializer.Serialize(new { kind = "focus", showPlaceholder = false, titleText = strings.Text("widget.focus.title"),
            state = isActive ? "active" : "idle", sessionTitle = title, targetLabel = seconds > 0 ? strings.Text("widget.focus.target", ("duration", duration)) : "",
            idleText = strings.Text("widget.focus.idle"), staleText = strings.Text("widget.focus.stale") });
    }

    private static object TaskRow(JsonElement task, WindowsWidgetStrings strings)
    {
        var done = task.GetProperty("isDone").GetBoolean();
        var title = task.GetProperty("title").GetString() ?? "";
        return new { id = task.GetProperty("id").GetString(), title, done, statusText = done ? "✓" : "○", style = done ? "good" : "default",
            actionText = strings.Text(done ? "widget.task.reopenAction" : "widget.task.completeAction", ("title", title)), targetIsDone = !done };
    }

    private static string Placeholder(string definitionId, bool stale = false)
    {
        var strings = new WindowsWidgetStrings(WindowsWidgetStore.ReadWidgetLocale());
        var text = strings.Text(stale ? "widget.focus.stale" : "widget.placeholder.openApp");
        return definitionId switch
        {
            "focus" => JsonSerializer.Serialize(new { kind = "focus", showPlaceholder = !stale, titleText = strings.Text("widget.focus.title"), state = stale ? "stale" : "placeholder",
                sessionTitle = "", targetLabel = "", placeholderText = text, staleText = strings.Text("widget.focus.stale"), idleText = strings.Text("widget.focus.idle") }),
            "habits" => JsonSerializer.Serialize(new { kind = "habits", showPlaceholder = true, titleText = strings.Text("widget.habits.title"), isEmpty = true,
                emptyText = strings.Text("widget.habits.empty"), placeholderText = text, overflowText = "", previewRows = Array.Empty<object>() }),
            "quadrant" => JsonSerializer.Serialize(new { kind = "quadrant", showPlaceholder = true, titleText = strings.Text("widget.quadrant.title"), placeholderText = text, slots = Array.Empty<object>() }),
            _ => JsonSerializer.Serialize(new { kind = "today", showPlaceholder = true, titleText = strings.Text("widget.today.title"), countText = strings.Text("widget.today.count", ("count", 0)),
                isEmpty = true, emptyText = strings.Text("widget.today.empty"), placeholderText = text, overflowText = "", previewRows = Array.Empty<object>() }),
        };
    }

    private const string TodayTemplate = "{\"$schema\":\"" + Schema + "\",\"type\":\"AdaptiveCard\",\"version\":\"1.5\",\"body\":[{\"type\":\"TextBlock\",\"text\":\"${placeholderText}\",\"wrap\":true,\"isVisible\":\"${showPlaceholder}\"},{\"type\":\"Container\",\"isVisible\":\"${!showPlaceholder}\",\"items\":[{\"type\":\"ColumnSet\",\"columns\":[{\"type\":\"Column\",\"width\":\"stretch\",\"items\":[{\"type\":\"TextBlock\",\"text\":\"${titleText}\",\"weight\":\"Bolder\"}]},{\"type\":\"Column\",\"width\":\"auto\",\"items\":[{\"type\":\"TextBlock\",\"text\":\"${countText}\"}]}]},{\"type\":\"TextBlock\",\"text\":\"${emptyText}\",\"isVisible\":\"${isEmpty}\"},{\"type\":\"Container\",\"$data\":\"${previewRows}\",\"selectAction\":{\"type\":\"Action.Execute\",\"verb\":\"toggle\",\"title\":\"${actionText}\",\"data\":{\"taskId\":\"${id}\",\"targetIsDone\":\"${targetIsDone}\"}},\"items\":[{\"type\":\"TextBlock\",\"text\":\"${title}\",\"wrap\":true,\"maxLines\":2}]}]}]}";
    private const string HabitsTemplate = "{\"$schema\":\"" + Schema + "\",\"type\":\"AdaptiveCard\",\"version\":\"1.5\",\"body\":[{\"type\":\"TextBlock\",\"text\":\"${placeholderText}\",\"wrap\":true,\"isVisible\":\"${showPlaceholder}\"},{\"type\":\"Container\",\"isVisible\":\"${!showPlaceholder}\",\"items\":[{\"type\":\"TextBlock\",\"text\":\"${titleText}\",\"weight\":\"Bolder\"},{\"type\":\"TextBlock\",\"text\":\"${emptyText}\",\"isVisible\":\"${isEmpty}\"},{\"type\":\"Container\",\"$data\":\"${previewRows}\",\"items\":[{\"type\":\"TextBlock\",\"text\":\"${title}\",\"wrap\":true},{\"type\":\"TextBlock\",\"text\":\"${streakLabel} ${doneLabel}\",\"isSubtle\":true}]}]}]}";
    private const string QuadrantTemplate = "{\"$schema\":\"" + Schema + "\",\"type\":\"AdaptiveCard\",\"version\":\"1.5\",\"body\":[{\"type\":\"TextBlock\",\"text\":\"${placeholderText}\",\"wrap\":true,\"isVisible\":\"${showPlaceholder}\"},{\"type\":\"Container\",\"isVisible\":\"${!showPlaceholder}\",\"items\":[{\"type\":\"TextBlock\",\"text\":\"${titleText}\",\"weight\":\"Bolder\"},{\"type\":\"Container\",\"$data\":\"${slots}\",\"items\":[{\"type\":\"TextBlock\",\"text\":\"${heading}\",\"weight\":\"Bolder\"},{\"type\":\"Container\",\"$data\":\"${previewRows}\",\"items\":[{\"type\":\"TextBlock\",\"text\":\"${title}\",\"wrap\":true}]}]}]}]}";
    private const string FocusTemplate = "{\"$schema\":\"" + Schema + "\",\"type\":\"AdaptiveCard\",\"version\":\"1.5\",\"body\":[{\"type\":\"TextBlock\",\"text\":\"${placeholderText}\",\"isVisible\":\"${showPlaceholder}\"},{\"type\":\"TextBlock\",\"text\":\"${titleText}\",\"weight\":\"Bolder\",\"isVisible\":\"${!showPlaceholder}\"},{\"type\":\"TextBlock\",\"text\":\"${idleText}\",\"isVisible\":\"${state == 'idle'}\"},{\"type\":\"TextBlock\",\"text\":\"${sessionTitle}\",\"isVisible\":\"${state == 'active'}\"},{\"type\":\"TextBlock\",\"text\":\"${targetLabel}\",\"isVisible\":\"${state == 'active'}\"}]}";
}
