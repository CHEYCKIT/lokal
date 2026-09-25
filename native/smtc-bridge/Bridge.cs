using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Windows.Media;

namespace SmtcBridge
{
    internal sealed class Bridge
    {
        private const string TargetClassPrefix = "Chrome_WidgetWin_";

        private readonly int _targetPid;
        private readonly ConcurrentQueue<System.Collections.Generic.Dictionary<string, object>> _incoming =
            new ConcurrentQueue<System.Collections.Generic.Dictionary<string, object>>();
        private readonly object _stdoutLock = new object();

        private System.Windows.Forms.Timer _timer;
        private SystemMediaTransportControls _controls;
        private IntPtr _boundHwnd = IntPtr.Zero;

        // Desired state, updated as soon as a command arrives from Electron even if
        // we're not bound to a window yet -- applied immediately once binding
        // succeeds so the very first state push isn't lost while still searching
        // for Chromium's media-key window.
        private bool _desiredShuffle;
        private string _desiredRepeat = "none";
        private bool _haveDesiredState;

        public Bridge(int targetPid)
        {
            _targetPid = targetPid;
        }

        public void Start()
        {
            var stdinThread = new Thread(ReadStdinLoop) { IsBackground = true, Name = "smtc-stdin" };
            stdinThread.Start();

            _timer = new System.Windows.Forms.Timer { Interval = 1500 };
            _timer.Tick += (s, e) => Tick();
            _timer.Start();

            // Try immediately too, don't wait for the first tick.
            Tick();
        }

        private void Tick()
        {
            if (!IsElectronStillRunning())
            {
                Application.Exit();
                return;
            }

            DrainIncoming();

            if (_controls == null)
            {
                TryBind();
            }
        }

        private bool IsElectronStillRunning()
        {
            try
            {
                using (var p = Process.GetProcessById(_targetPid))
                {
                    return !p.HasExited;
                }
            }
            catch (ArgumentException)
            {
                return false;
            }
        }

        private void DrainIncoming()
        {
            bool changed = false;
            while (_incoming.TryDequeue(out var cmd))
            {
                _desiredShuffle = cmd.GetBool("shuffle", _desiredShuffle);
                _desiredRepeat = cmd.GetString("repeat", _desiredRepeat);
                _haveDesiredState = true;
                changed = true;
            }

            if (changed && _controls != null)
            {
                ApplyDesiredState();
            }
        }

        private void ApplyDesiredState()
        {
            if (!_haveDesiredState) return;
            try
            {
                _controls.ShuffleEnabled = _desiredShuffle;
                _controls.AutoRepeatMode = MapRepeatMode(_desiredRepeat);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[smtc-bridge] failed to apply state: " + ex);
            }
        }

        private static MediaPlaybackAutoRepeatMode MapRepeatMode(string repeat)
        {
            switch (repeat)
            {
                case "one": return MediaPlaybackAutoRepeatMode.Track;
                case "all": return MediaPlaybackAutoRepeatMode.List;
                default: return MediaPlaybackAutoRepeatMode.None;
            }
        }

        private static string MapRepeatModeBack(MediaPlaybackAutoRepeatMode mode)
        {
            switch (mode)
            {
                case MediaPlaybackAutoRepeatMode.Track: return "one";
                case MediaPlaybackAutoRepeatMode.List: return "all";
                default: return "none";
            }
        }

        private void TryBind()
        {
            IntPtr found = IntPtr.Zero;
            SystemMediaTransportControls candidateControls = null;

            NativeMethods.EnumWindows((hWnd, _) =>
            {
                NativeMethods.GetWindowThreadProcessId(hWnd, out uint pid);
                if (pid != (uint)_targetPid) return true; // continue enumeration

                var classBuf = new StringBuilder(256);
                NativeMethods.GetClassName(hWnd, classBuf, classBuf.Capacity);
                string className = classBuf.ToString();
                if (!className.StartsWith(TargetClassPrefix, StringComparison.Ordinal)) return true;

                if (NativeMethods.IsWindowVisible(hWnd)) return true;
                if (NativeMethods.GetWindowTextLength(hWnd) != 0) return true;

                // Candidate hidden Chrome_WidgetWin_* window owned by Electron's
                // browser process. Chromium creates this specifically for OS media
                // integration once `enable-features=HardwareMediaKeyHandling,MediaSessionService`
                // is set (electron/main.js already does this -- it's how play/pause/
                // next/prev already work via SMTC/lock-screen today). Only the real
                // one will report IsEnabled == true; the rest of a process's
                // Chrome_WidgetWin_* windows (there can be several, e.g. drag-image
                // or GPU-related windows) won't.
                try
                {
                    var controls = SystemMediaTransportControlsInterop.GetForWindow(hWnd);
                    if (controls != null && controls.IsEnabled)
                    {
                        found = hWnd;
                        candidateControls = controls;
                        return false; // stop enumeration
                    }
                }
                catch
                {
                    // Not every top-level window responds to GetForWindow; that's
                    // expected and not an error worth surfacing per-window.
                }

                return true;
            }, IntPtr.Zero);

            if (found == IntPtr.Zero || candidateControls == null)
                return;

            Bind(found, candidateControls);
        }

        private void Bind(IntPtr hWnd, SystemMediaTransportControls controls)
        {
            _boundHwnd = hWnd;
            _controls = controls;
            _controls.ShuffleEnabledChangeRequested += OnShuffleEnabledChangeRequested;
            _controls.AutoRepeatModeChangeRequested += OnAutoRepeatModeChangeRequested;

            ApplyDesiredState();

            Send(Json.WriteObject(("event", "ready"), ("hwnd", hWnd.ToInt64())));
        }

        private void OnShuffleEnabledChangeRequested(SystemMediaTransportControls sender, ShuffleEnabledChangeRequestedEventArgs args)
        {
            Send(Json.WriteObject(("event", "shuffleRequested"), ("value", args.RequestedShuffleEnabled)));
        }

        private void OnAutoRepeatModeChangeRequested(SystemMediaTransportControls sender, AutoRepeatModeChangeRequestedEventArgs args)
        {
            Send(Json.WriteObject(("event", "repeatRequested"), ("mode", MapRepeatModeBack(args.RequestedAutoRepeatMode))));
        }

        private void ReadStdinLoop()
        {
            string line;
            while ((line = Console.In.ReadLine()) != null)
            {
                var parsed = Json.ParseObject(line);
                if (parsed != null)
                {
                    _incoming.Enqueue(parsed);
                }
            }

            // stdin closed means Electron tore down our pipe (its own process is
            // exiting or the handle was closed) -- exit rather than spin forever.
            try { Application.Exit(); } catch { /* may already be exiting */ }
        }

        private void Send(string json)
        {
            lock (_stdoutLock)
            {
                try
                {
                    Console.Out.WriteLine(json);
                    Console.Out.Flush();
                }
                catch
                {
                    // stdout pipe gone (parent exited) -- nothing to do, the
                    // Electron-liveness check on the next tick will end this process.
                }
            }
        }
    }
}
