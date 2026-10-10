namespace Heyta.Windows.Host;

/// <summary>
/// Paths owned by one Windows shell run.
///
/// The normal path is deliberately unchanged. An explicit QA root moves the
/// shell SQLite store so data-management actions cannot mutate the user's DB.
/// </summary>
public sealed record WindowsDataPaths(
    string DataDirectory,
    string DatabasePath,
    bool IsQaOverride)
{
    private const string AppDirectoryName = "heyta";
    private const string DatabaseName = "heyta.sqlite";

    /// <summary>
    /// Resolve the shell's storage paths without creating or touching anything.
    ///
    /// <paramref name="qaDataDirectory"/> is intentionally a directory, not a
    /// database filename.  It must be absolute so a QA runner cannot silently
    /// resolve against a different working directory.
    /// </summary>
    public static WindowsDataPaths Resolve(
        string? qaDataDirectory,
        string? localApplicationData = null)
    {
        var defaultDirectory = Path.GetFullPath(Path.Combine(
            string.IsNullOrWhiteSpace(localApplicationData)
                ? Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)
                : localApplicationData,
            AppDirectoryName));

        var configured = qaDataDirectory?.Trim();
        if (string.IsNullOrEmpty(configured))
        {
            return Create(defaultDirectory, isQaOverride: false);
        }

        if (!Path.IsPathFullyQualified(configured))
        {
            throw new ArgumentException(
                "HEYTA_QA_DATA_DIR must be an absolute directory path.",
                nameof(qaDataDirectory));
        }

        var qaDirectory = Path.GetFullPath(configured);
        if (SamePath(qaDirectory, defaultDirectory))
        {
            throw new ArgumentException(
                "HEYTA_QA_DATA_DIR must not point at the default heyta data directory.",
                nameof(qaDataDirectory));
        }

        return Create(qaDirectory, isQaOverride: true);
    }

    private static WindowsDataPaths Create(string dataDirectory, bool isQaOverride) =>
        new(dataDirectory, Path.Combine(dataDirectory, DatabaseName), isQaOverride);

    private static bool SamePath(string left, string right) =>
        string.Equals(
            left.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar),
            right.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar),
            OperatingSystem.IsWindows()
                ? StringComparison.OrdinalIgnoreCase
                : StringComparison.Ordinal);
}
