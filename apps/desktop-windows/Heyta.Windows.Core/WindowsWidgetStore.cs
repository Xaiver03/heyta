using System.Security.Cryptography;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace Heyta.Windows.Host;

/// <summary>
/// The Windows native widget transport.
///
/// The WebView never receives the device key.  The host seals the JSON payload
/// here and stores the encrypted envelope in the package's per-user LocalState;
/// the Widgets Board provider reads the same files.  The provider can append
/// widget intents, but it never opens SQLite or constructs an op.
/// </summary>
public static class WindowsWidgetStore
{
    private const int ContractVersion = 1;
    private const string Algorithm = "AES-GCM-256";
    private const int KeyBytes = 32;
    private const int NonceBytes = 12;
    private const int TagBytes = 16;
    private const long MaxEpochMs = 8_640_000_000_000_000;

    private static readonly object Gate = new();
    private static string? _stateDirectory;

    public static void ConfigureStateDirectory(string packageFamilyName)
    {
        if (string.IsNullOrWhiteSpace(packageFamilyName))
            throw new ArgumentException("package family name is required", nameof(packageFamilyName));

        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        _stateDirectory = Path.Combine(localAppData, "Packages", packageFamilyName, "LocalState", "heyta-widgets");
        Directory.CreateDirectory(_stateDirectory);
    }

    public static string SealWidgetSnapshot(string payloadJson, string dayStr, long validUntil)
    {
        if (string.IsNullOrWhiteSpace(dayStr)) throw new ArgumentException("dayStr must not be empty", nameof(dayStr));
        if (validUntil is < 0 or > MaxEpochMs) throw new ArgumentOutOfRangeException(nameof(validUntil));

        var key = GetOrCreateKey();
        var nonce = RandomNumberGenerator.GetBytes(NonceBytes);
        var aad = Encoding.UTF8.GetBytes($"{ContractVersion}|{dayStr}|{validUntil}");
        var plaintext = Encoding.UTF8.GetBytes(payloadJson);
        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[TagBytes];
        using (var aes = new AesGcm(key, TagBytes))
            aes.Encrypt(nonce, plaintext, ciphertext, tag, aad);

        var combined = new byte[ciphertext.Length + tag.Length];
        Buffer.BlockCopy(ciphertext, 0, combined, 0, ciphertext.Length);
        Buffer.BlockCopy(tag, 0, combined, ciphertext.Length, tag.Length);
        return JsonSerializer.Serialize(new
        {
            v = ContractVersion,
            dayStr,
            validUntil,
            alg = Algorithm,
            nonce = Convert.ToBase64String(nonce),
            ciphertext = Convert.ToBase64String(combined),
        });
    }

    public static void SetWidgetSnapshot(string envelopeJson)
    {
        using var document = JsonDocument.Parse(envelopeJson);
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object ||
            root.GetProperty("v").GetInt32() != ContractVersion ||
            root.GetProperty("alg").GetString() != Algorithm)
            throw new InvalidDataException("unsupported widget envelope");

        var dayStr = root.GetProperty("dayStr").GetString();
        var validUntil = root.GetProperty("validUntil").GetInt64();
        var nonce = Convert.FromBase64String(root.GetProperty("nonce").GetString() ?? string.Empty);
        var ciphertext = Convert.FromBase64String(root.GetProperty("ciphertext").GetString() ?? string.Empty);
        if (string.IsNullOrEmpty(dayStr) || validUntil is < 0 or > MaxEpochMs || nonce.Length != NonceBytes || ciphertext.Length < TagBytes)
            throw new InvalidDataException("malformed widget envelope");

        // Verify before publishing a new envelope. This catches a bridge or a
        // partially written payload at the only point with useful diagnostics.
        _ = OpenEnvelope(root, GetOrCreateKey());
        WithStateLock(() =>
        {
            AtomicWrite(SnapshotPath, Encoding.UTF8.GetBytes(envelopeJson));
            return true;
        });
    }

    public static string? ReadSnapshot()
    {
        var path = SnapshotPath;
        return File.Exists(path) ? File.ReadAllText(path, Encoding.UTF8) : null;
    }

    /// <summary>Non-sensitive device preference, independent of encrypted task snapshots.</summary>
    public static bool SetWidgetLocale(string locale)
    {
        if (locale is not ("zh-CN" or "en")) return false;
        return WithStateLock(() =>
        {
            if (File.Exists(LocalePath) && File.ReadAllText(LocalePath, Encoding.UTF8) == locale) return true;
            AtomicWrite(LocalePath, Encoding.UTF8.GetBytes(locale));
            return true;
        });
    }

    public static string ReadWidgetLocale()
    {
        try
        {
            if (File.Exists(LocalePath))
            {
                var locale = File.ReadAllText(LocalePath, Encoding.UTF8);
                if (locale is "zh-CN" or "en") return locale;
            }
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        return System.Globalization.CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "zh" ? "zh-CN" : "en";
    }

    public static string? DrainIntentQueue()
    {
        // Reading is deliberately non-destructive. The app acknowledges only
        // the intents it has durably applied, so a crash or a failed op write
        // cannot make a widget click disappear.
        return WithStateLock(ReadIntentQueueUnsafe);
    }

    /// <summary>
    /// Remove exactly the intents represented by <paramref name="processedJson" />.
    /// A widget click that arrived after the read remains in the queue.
    /// </summary>
    public static int AckIntentQueue(string processedJson)
    {
        return WithStateLock(() =>
        {
            var processed = ParseIntentsStrict(processedJson);
            if (processed.Count == 0) return 0;

            var current = ReadCurrentIntentsStrict();
            var processedKeys = processed
                .Select(IntentKey)
                .ToHashSet();
            var remaining = current
                .Where(intent => !processedKeys.Contains(IntentKey(intent)))
                .ToArray();
            var removed = current.Count - remaining.Length;
            if (removed > 0)
            {
                var json = JsonSerializer.Serialize(new { v = ContractVersion, intents = remaining });
                AtomicWrite(IntentPath, Encoding.UTF8.GetBytes(json));
            }
            return removed;
        });
    }

    public static int MergeIntentQueue(string pendingJson)
    {
        return WithStateLock(() =>
        {
            EnsureWidgetStateActive();
            var current = ReadCurrentIntentsStrict();
            var pending = ParseIntentsStrict(pendingJson);
            var byTask = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
            foreach (var intent in pending) AddOrMoveToEnd(byTask, intent);
            foreach (var intent in current) AddOrMoveToEnd(byTask, intent);
            if (byTask.Count > 50) throw new InvalidDataException("too many intents");
            var json = JsonSerializer.Serialize(new { v = 1, intents = byTask.Values.ToArray() });
            AtomicWrite(IntentPath, Encoding.UTF8.GetBytes(json));
            return byTask.Count;
        });
    }

    public static void MergeIntent(string taskId, bool targetIsDone)
    {
        WithStateLock(() =>
        {
            EnsureWidgetStateActive();
            var current = ReadCurrentIntentsStrict();
            var byTask = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
            foreach (var intent in current) AddOrMoveToEnd(byTask, intent);
            using var doc = JsonDocument.Parse(JsonSerializer.Serialize(new { taskId, targetIsDone, at = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() }));
            if (!byTask.ContainsKey(taskId) && byTask.Count >= 50) throw new InvalidDataException("too many intents");
            AddOrMoveToEnd(byTask, doc.RootElement.Clone());
            AtomicWrite(IntentPath, Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { v = 1, intents = byTask.Values.ToArray() })));
            return true;
        });
    }

    public static void ClearWidgetState()
    {
        WithStateLock(() =>
        {
            DeleteIfExists(KeyPath);
            DeleteIfExists(IntentPath);
            DeleteIfExists(SnapshotPath);
            return true;
        });
    }

    public static byte[] OpenEnvelope(JsonElement envelope, byte[] key)
    {
        var version = envelope.GetProperty("v").GetInt32();
        var dayStr = envelope.GetProperty("dayStr").GetString() ?? throw new InvalidDataException("dayStr missing");
        var validUntil = envelope.GetProperty("validUntil").GetInt64();
        var nonce = Convert.FromBase64String(envelope.GetProperty("nonce").GetString() ?? string.Empty);
        var combined = Convert.FromBase64String(envelope.GetProperty("ciphertext").GetString() ?? string.Empty);
        if (version != ContractVersion || nonce.Length != NonceBytes || combined.Length < TagBytes || key.Length != KeyBytes)
            throw new InvalidDataException("malformed widget envelope");
        var ciphertext = combined.AsSpan(0, combined.Length - TagBytes);
        var tag = combined.AsSpan(combined.Length - TagBytes, TagBytes);
        var plain = new byte[ciphertext.Length];
        using var aes = new AesGcm(key, TagBytes);
        aes.Decrypt(nonce, ciphertext, tag, plain, Encoding.UTF8.GetBytes($"{version}|{dayStr}|{validUntil}"));
        return plain;
    }

    public static byte[] GetExistingKey()
    {
        var path = KeyPath;
        if (!File.Exists(path)) throw new FileNotFoundException("widget key is not available", path);
        return UnprotectForCurrentUser(File.ReadAllBytes(path));
    }

    private static byte[] GetOrCreateKey()
    {
        return WithStateLock(() =>
        {
            if (File.Exists(KeyPath)) return GetExistingKey();
            var key = RandomNumberGenerator.GetBytes(KeyBytes);
            AtomicWrite(KeyPath, ProtectForCurrentUser(key));
            return key;
        });
    }

    private static T WithStateLock<T>(Func<T> action)
    {
        lock (Gate)
        {
            using var mutex = new Mutex(false, "Local\\heyta-widget-state");
            var acquired = false;
            try
            {
                try { acquired = mutex.WaitOne(TimeSpan.FromSeconds(5)); }
                catch (AbandonedMutexException) { acquired = true; }
                if (!acquired) throw new TimeoutException("widget state lock timed out");
                return action();
            }
            finally
            {
                if (acquired) mutex.ReleaseMutex();
            }
        }
    }

    private static string StateDirectory => _stateDirectory ?? throw new InvalidOperationException("WindowsWidgetStore is not configured");
    /// <summary>Directory watched by the packaged Widgets provider for refreshes.</summary>
    public static string StateDirectoryPath => StateDirectory;
    private static string SnapshotPath => Path.Combine(StateDirectory, "snapshot.json");
    private static string IntentPath => Path.Combine(StateDirectory, "intents.json");
    private static string KeyPath => Path.Combine(StateDirectory, "device-key.bin");
    public const string LocaleFileName = "locale.txt";
    private static string LocalePath => Path.Combine(StateDirectory, LocaleFileName);

    private static string ReadIntentQueueUnsafe() => File.Exists(IntentPath)
        ? File.ReadAllText(IntentPath, Encoding.UTF8)
        : "{\"v\":1,\"intents\":[]}";

    private static List<JsonElement> ParseIntents(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return [];
        try
        {
            using var doc = JsonDocument.Parse(raw);
            if (!doc.RootElement.TryGetProperty("v", out var version) || version.GetInt32() != 1 ||
                !doc.RootElement.TryGetProperty("intents", out var intents) || intents.ValueKind != JsonValueKind.Array) return [];
            var parsed = new List<JsonElement>();
            foreach (var intent in intents.EnumerateArray())
            {
                if (intent.ValueKind != JsonValueKind.Object ||
                    !intent.TryGetProperty("taskId", out var taskId) || taskId.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(taskId.GetString()) ||
                    !intent.TryGetProperty("targetIsDone", out var target) || (target.ValueKind != JsonValueKind.True && target.ValueKind != JsonValueKind.False) ||
                    !intent.TryGetProperty("at", out var at) || at.ValueKind != JsonValueKind.Number || !at.TryGetInt64(out var timestamp) || timestamp < 0 || timestamp > MaxEpochMs)
                    return [];
                parsed.Add(intent.Clone());
            }
            return parsed.Count <= 50 ? parsed : [];
        }
        catch (JsonException) { return []; }
    }

    private static string TaskId(JsonElement intent) => intent.GetProperty("taskId").GetString() ?? string.Empty;

    private static (string TaskId, bool TargetIsDone, long At) IntentKey(JsonElement intent)
        => (TaskId(intent), intent.GetProperty("targetIsDone").GetBoolean(), intent.GetProperty("at").GetInt64());

    private static void AddOrMoveToEnd(Dictionary<string, JsonElement> byTask, JsonElement intent)
    {
        var taskId = TaskId(intent);
        byTask.Remove(taskId);
        byTask.Add(taskId, intent);
    }

    private static List<JsonElement> ReadCurrentIntentsStrict()
        => File.Exists(IntentPath) ? ParseIntentsStrict(File.ReadAllText(IntentPath, Encoding.UTF8)) : [];

    private static void EnsureWidgetStateActive()
    {
        if (!File.Exists(SnapshotPath) || !File.Exists(KeyPath))
            throw new InvalidOperationException("widget state is not active");
    }

    private static List<JsonElement> ParseIntentsStrict(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) throw new InvalidDataException("intent queue is empty");
        try
        {
            using var doc = JsonDocument.Parse(raw);
            if (doc.RootElement.ValueKind != JsonValueKind.Object ||
                !doc.RootElement.TryGetProperty("v", out var version) || version.GetInt32() != ContractVersion ||
                !doc.RootElement.TryGetProperty("intents", out var intents) || intents.ValueKind != JsonValueKind.Array)
                throw new InvalidDataException("unsupported intent queue");
            var parsed = new List<JsonElement>();
            foreach (var intent in intents.EnumerateArray())
            {
                if (intent.ValueKind != JsonValueKind.Object ||
                    !intent.TryGetProperty("taskId", out var taskId) || taskId.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(taskId.GetString()) ||
                    !intent.TryGetProperty("targetIsDone", out var target) || (target.ValueKind != JsonValueKind.True && target.ValueKind != JsonValueKind.False) ||
                    !intent.TryGetProperty("at", out var at) || at.ValueKind != JsonValueKind.Number || !at.TryGetInt64(out var timestamp) || timestamp < 0 || timestamp > MaxEpochMs)
                    throw new InvalidDataException("malformed intent");
                parsed.Add(intent.Clone());
            }
            if (parsed.Count > 50) throw new InvalidDataException("too many intents");
            return parsed;
        }
        catch (JsonException error)
        {
            throw new InvalidDataException("malformed intent queue", error);
        }
    }

    private static byte[] ProtectForCurrentUser(byte[] data)
    {
        using var input = new DataBlob(data);
        if (!CryptProtectData(ref input.Blob, null, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 0, out var output))
            throw new CryptographicException(Marshal.GetLastWin32Error());
        try { return BlobToArray(output); }
        finally { LocalFree(output.Data); }
    }

    private static byte[] UnprotectForCurrentUser(byte[] data)
    {
        using var input = new DataBlob(data);
        if (!CryptUnprotectData(ref input.Blob, out var description, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 0, out var output))
            throw new CryptographicException(Marshal.GetLastWin32Error());
        try { return BlobToArray(output); }
        finally
        {
            LocalFree(output.Data);
            if (description != IntPtr.Zero) LocalFree(description);
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeBlob
    {
        public int Length;
        public IntPtr Data;
    }

    private sealed class DataBlob : IDisposable
    {
        public NativeBlob Blob;
        private readonly IntPtr _allocated;
        public DataBlob(byte[] bytes)
        {
            _allocated = Marshal.AllocHGlobal(bytes.Length);
            Marshal.Copy(bytes, 0, _allocated, bytes.Length);
            Blob = new NativeBlob { Length = bytes.Length, Data = _allocated };
        }
        public void Dispose() => Marshal.FreeHGlobal(_allocated);
    }

    private static byte[] BlobToArray(NativeBlob blob)
    {
        if (blob.Length < 0 || blob.Data == IntPtr.Zero) throw new CryptographicException("DPAPI returned an invalid blob");
        var bytes = new byte[blob.Length];
        Marshal.Copy(blob.Data, bytes, 0, bytes.Length);
        return bytes;
    }

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptProtectData(ref NativeBlob dataIn, string? description, IntPtr entropy, IntPtr reserved, IntPtr prompt, uint flags, out NativeBlob dataOut);

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptUnprotectData(ref NativeBlob dataIn, out IntPtr description, IntPtr entropy, IntPtr reserved, IntPtr prompt, uint flags, out NativeBlob dataOut);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr handle);

    private static void AtomicWrite(string path, byte[] bytes)
    {
        Directory.CreateDirectory(StateDirectory);
        var temp = path + ".tmp-" + Guid.NewGuid().ToString("N");
        File.WriteAllBytes(temp, bytes);
        File.Move(temp, path, true);
    }

    private static void DeleteIfExists(string path)
    {
        if (File.Exists(path)) File.Delete(path);
    }
}
