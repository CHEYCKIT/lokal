using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.WindowsRuntime;
using Windows.Media;

namespace SmtcBridge
{
    // ISystemMediaTransportControlsInterop is the sanctioned way for a classic,
    // unpackaged Win32 app (no MSIX identity required) to obtain the
    // SystemMediaTransportControls object tied to one of its own top-level window
    // handles. It has no managed projection of its own -- consumers declare the
    // COM interface by hand and let the CLR's WinRT interop layer do the rest.
    //
    // GUIDs below are fixed OS contract values (systemmediatransportcontrolsinterop.h
    // in the Windows SDK), not something we control or can look up in NuGet metadata:
    //   - ddb0472d-c911-4a1f-86d9-dc3d71a95f5a is ISystemMediaTransportControlsInterop
    //     itself (used to obtain the interop object from the WinRT activation factory).
    //   - 99FA3FF4-1742-42A6-902E-087D41F965EC is IID_ISystemMediaTransportControls,
    //     passed as the requested riid so GetForWindow knows what to hand back.
    //
    // Reference: https://learn.microsoft.com/windows/win32/api/systemmediatransportcontrolsinterop
    [ComImport]
    [Guid("ddb0472d-c911-4a1f-86d9-dc3d71a95f5a")]
    [InterfaceType(ComInterfaceType.InterfaceIsIInspectable)]
    internal interface ISystemMediaTransportControlsInterop
    {
        SystemMediaTransportControls GetForWindow(IntPtr appWindow, [In] ref Guid riid);
    }

    internal static class SystemMediaTransportControlsInterop
    {
        private static readonly Guid IID_ISystemMediaTransportControls =
            new Guid("99FA3FF4-1742-42A6-902E-087D41F965EC");

        /// <summary>
        /// Binds to (or creates, if none exists yet) the SystemMediaTransportControls
        /// object associated with the given top-level window handle. This is a
        /// per-HWND singleton tracked by the OS's session broker, not per-process --
        /// calling this from a different process than the one that owns the window is
        /// exactly how the shell itself (explorer.exe, in a third process again) reads
        /// and drives every app's media session, so binding here from our own separate
        /// helper process to Electron's window is the intended, supported use of this
        /// API, not a hack around it.
        /// </summary>
        public static SystemMediaTransportControls GetForWindow(IntPtr hWnd)
        {
            var factory = (ISystemMediaTransportControlsInterop)
                WindowsRuntimeMarshal.GetActivationFactory(typeof(SystemMediaTransportControls));

            var riid = IID_ISystemMediaTransportControls;
            return factory.GetForWindow(hWnd, ref riid);
        }
    }
}
