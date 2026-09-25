using System;
using System.Windows.Forms;

namespace SmtcBridge
{
    internal static class Program
    {
        /// <summary>
        /// SmtcBridge.exe &lt;electronPid&gt;
        ///
        /// Spawned by Electron's main process (electron/ipc/smtc.js) as a plain
        /// child process -- see SmtcBridge.csproj for why this is a separate exe
        /// rather than a compiled Node native addon. Talks to its parent over
        /// stdin/stdout as one JSON object per line (see Json.cs / Bridge.cs).
        /// </summary>
        [STAThread]
        private static int Main(string[] args)
        {
            try
            {
                Console.OutputEncoding = System.Text.Encoding.UTF8;
            }
            catch
            {
                // Setting OutputEncoding can throw if stdout isn't a normal
                // redirectable stream in some spawn configurations; our JSON
                // protocol is ASCII/escaped-unicode only (see Json.Escape), so
                // this is a nice-to-have, not a requirement to keep running.
            }

            if (args.Length < 1 || !int.TryParse(args[0], out int electronPid))
            {
                Console.Error.WriteLine("usage: SmtcBridge.exe <electronPid>");
                return 1;
            }

            // Real Win32 message pump on this STA thread: required for the WinRT
            // TypedEventHandler callbacks (ShuffleEnabledChangeRequested,
            // AutoRepeatModeChangeRequested) to actually be delivered. Window
            // discovery, retry polling and applying incoming state all happen on
            // this same thread (via a System.Windows.Forms.Timer, which ticks as
            // part of this same message loop) so nothing ever touches the COM
            // SystemMediaTransportControls object from a different thread than the
            // one that owns it.
            var bridge = new Bridge(electronPid);
            bridge.Start();
            Application.Run();
            return 0;
        }
    }
}
