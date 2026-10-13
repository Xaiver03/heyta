using System.Runtime.InteropServices;
using Heyta.Windows.Host;
using Microsoft.Windows.Widgets.Providers;
using Windows.ApplicationModel;

namespace Heyta.WidgetProvider;

internal static class Program
{
    private static readonly Guid Clsid = new("B5E3EAF7-9B4A-4A3C-9A8E-7E6E0BEA2B14");

    [DllImport("ole32.dll")]
    private static extern int CoRegisterClassObject(
        [MarshalAs(UnmanagedType.LPStruct)] Guid rclsid,
        [MarshalAs(UnmanagedType.IUnknown)] object classObject,
        uint context,
        uint flags,
        out uint registrationCookie);

    [DllImport("ole32.dll")]
    private static extern int CoRevokeClassObject(uint registrationCookie);

    public static void Main()
    {
        WindowsWidgetStore.ConfigureStateDirectory(Package.Current.Id.FamilyName);
        var factory = new WidgetProviderFactory<HeytaWidgetProvider>();
        var result = CoRegisterClassObject(Clsid, factory, 0x4, 0x1, out var cookie);
        Marshal.ThrowExceptionForHR(result);
        try
        {
            HeytaWidgetProvider.WaitUntilEmpty();
        }
        finally
        {
            _ = CoRevokeClassObject(cookie);
        }
    }
}

internal static class ComGuids
{
    public const string IClassFactory = "00000001-0000-0000-C000-000000000046";
    public const string IUnknown = "00000000-0000-0000-C000-000000000046";
}

[ComImport, ComVisible(false), InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid(ComGuids.IClassFactory)]
internal interface IClassFactory
{
    [PreserveSig] int CreateInstance(IntPtr outer, ref Guid riid, out IntPtr objectPointer);
    [PreserveSig] int LockServer(bool lockServer);
}

[ComVisible(true)]
internal sealed class WidgetProviderFactory<T> : IClassFactory where T : IWidgetProvider, new()
{
    public int CreateInstance(IntPtr outer, ref Guid riid, out IntPtr objectPointer)
    {
        objectPointer = IntPtr.Zero;
        if (outer != IntPtr.Zero) return unchecked((int)0x80040110);
        if (riid != typeof(T).GUID && riid != Guid.Parse(ComGuids.IUnknown)) return unchecked((int)0x80004002);
        objectPointer = WinRT.MarshalInspectable<IWidgetProvider>.FromManaged(new T());
        return 0;
    }

    public int LockServer(bool lockServer) => 0;
}
