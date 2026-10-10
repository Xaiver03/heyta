using System.Collections.Concurrent;
using System.Text.Json;
using Heyta.Windows.Host;
using Microsoft.Windows.Widgets.Providers;
using Windows.ApplicationModel;

namespace Heyta.WidgetProvider;

internal sealed class RunningWidget
{
    public required string Id { get; init; }
    public required string DefinitionId { get; init; }
    public bool Active { get; set; }
}

/// <summary>
/// The real Windows Widgets Board provider. It only reads the encrypted
/// snapshot and writes intent records; task mutations remain in app-host.
/// </summary>
internal sealed class HeytaWidgetProvider : IWidgetProvider
{
    private static readonly ConcurrentDictionary<string, RunningWidget> Running = new(StringComparer.Ordinal);
    private static readonly ManualResetEvent Empty = new(false);
    private static FileSystemWatcher? StateWatcher;

    public HeytaWidgetProvider()
    {
        WindowsWidgetStore.ConfigureStateDirectory(Package.Current.Id.FamilyName);
        // Refresh the Board when the app publishes a new snapshot or clears
        // it. In particular, deleting snapshot.json must replace cached task
        // text with the provider placeholder instead of leaving stale text in
        // an already-open Board card.
        try
        {
            StateWatcher = new FileSystemWatcher(WindowsWidgetStore.StateDirectoryPath)
            {
                NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.Size,
                EnableRaisingEvents = true,
            };
            StateWatcher.Changed += (_, e) => RefreshChangedFile(e.Name);
            StateWatcher.Created += (_, e) => RefreshChangedFile(e.Name);
            StateWatcher.Deleted += (_, e) => RefreshChangedFile(e.Name);
            StateWatcher.Renamed += (_, e) => { RefreshChangedFile(e.OldName); RefreshChangedFile(e.Name); };
        }
        catch
        {
            // A provider can still serve the last request if the watcher is
            // unavailable; the normal lifecycle callbacks remain authoritative.
        }
        try
        {
            foreach (var info in WidgetManager.GetDefault().GetWidgetInfos())
            {
                var context = info.WidgetContext;
                Running.TryAdd(context.Id, new RunningWidget { Id = context.Id, DefinitionId = context.DefinitionId });
            }
        }
        catch
        {
            // A provider can be created while Widgets Board is still starting.
            // The first CreateWidget call will establish the running set.
        }
    }

    public static void WaitUntilEmpty() => Empty.WaitOne();

    public void CreateWidget(WidgetContext widgetContext)
    {
        Running[widgetContext.Id] = new RunningWidget { Id = widgetContext.Id, DefinitionId = widgetContext.DefinitionId };
        Empty.Reset();
        Update(widgetContext.Id);
    }

    public void DeleteWidget(string widgetId, string customState)
    {
        Running.TryRemove(widgetId, out _);
        if (Running.IsEmpty) Empty.Set();
    }

    public void Activate(WidgetContext widgetContext)
    {
        if (Running.TryGetValue(widgetContext.Id, out var widget)) widget.Active = true;
        Update(widgetContext.Id);
    }

    public void Deactivate(string widgetId)
    {
        if (Running.TryGetValue(widgetId, out var widget)) widget.Active = false;
    }

    public void OnWidgetContextChanged(WidgetContextChangedArgs contextChangedArgs)
        => Update(contextChangedArgs.WidgetContext.Id);

    public void OnActionInvoked(WidgetActionInvokedArgs actionInvokedArgs)
    {
        if (!string.Equals(actionInvokedArgs.Verb, "toggle", StringComparison.Ordinal)) return;

        var data = actionInvokedArgs.Data?.ToString();
        if (string.IsNullOrWhiteSpace(data)) return;
        try
        {
            using var document = JsonDocument.Parse(data);
            var root = document.RootElement;
            var taskId = root.GetProperty("taskId").GetString();
            var target = root.GetProperty("targetIsDone").GetBoolean();
            if (!string.IsNullOrWhiteSpace(taskId))
                WindowsWidgetStore.MergeIntent(taskId, target);
        }
        catch (JsonException)
        {
            // Bad card data is ignored; it cannot mutate the task store.
        }
        Update(actionInvokedArgs.WidgetContext.Id);
    }

    private static void Update(string widgetId)
    {
        if (!Running.TryGetValue(widgetId, out var widget)) return;
        var options = new WidgetUpdateRequestOptions(widgetId)
        {
            Template = CardTemplates.Template(widget.DefinitionId),
            Data = CardTemplates.Data(widget.DefinitionId),
            CustomState = string.Empty,
        };
        try { WidgetManager.GetDefault().UpdateWidget(options); } catch { /* host may be closing */ }
    }

    private static void RefreshAll()
    {
        foreach (var widget in Running.Keys) Update(widget);
    }

    private static void RefreshChangedFile(string? name)
    {
        if (name is "snapshot.json" or WindowsWidgetStore.LocaleFileName) RefreshAll();
    }
}
