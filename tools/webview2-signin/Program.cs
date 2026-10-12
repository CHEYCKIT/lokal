// Lokal's YouTube Music sign-in window on Windows, in Microsoft Edge WebView2.
//
// Google refuses sign-in in Electron's Chromium ("This browser or app may not
// be secure"); WebView2 is Edge itself, so it signs in like a browser, Windows
// Hello passkeys included. Nothing about the browser is changed or hidden.
//
// Talks to Lokal over standard input and output, one JSON object per line:
//   out: {"type":"ready"} | {"type":"changed"} | {"type":"closed"}
//        | {"type":"error","code":"no-runtime"|"failed","message":"…"}
//        | {"type":"snapshot","id":N,"url":…,"userAgent":…,"context":{…},"cookies":[…]}
//   in:  {"cmd":"read","id":N} | {"cmd":"focus"} | {"cmd":"close"}
// Closing standard input (Lokal went away) closes the window.
//
// Usage: LokalSignIn.exe --profile <folder> --url <sign-in page>

using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace LokalSignIn
{
    internal static class Program
    {
        internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 8 * 1024 * 1024 };
        private static readonly object OutputLock = new object();

        internal static void Send(Dictionary<string, object> message)
        {
            lock (OutputLock)
            {
                try
                {
                    Console.Out.WriteLine(Json.Serialize(message));
                    Console.Out.Flush();
                }
                catch (IOException) { }
            }
        }

        internal static Dictionary<string, object> Message(string type, params object[] pairs)
        {
            var message = new Dictionary<string, object> { ["type"] = type };
            for (var i = 0; i + 1 < pairs.Length; i += 2) message[(string)pairs[i]] = pairs[i + 1];
            return message;
        }

        [STAThread]
        private static int Main(string[] args)
        {
            string profile = null, url = null;
            for (var i = 0; i + 1 < args.Length; i++)
            {
                if (args[i] == "--profile") profile = args[++i];
                else if (args[i] == "--url") url = args[++i];
            }
            if (string.IsNullOrEmpty(profile) || string.IsNullOrEmpty(url) || !SignInForm.Allowed(url))
            {
                Send(Message("error", "code", "failed", "message", "Usage: LokalSignIn.exe --profile <folder> --url <https Google or YouTube page>"));
                return 2;
            }
            try { CoreWebView2Environment.GetAvailableBrowserVersionString(); }
            catch (WebView2RuntimeNotFoundException)
            {
                Send(Message("error", "code", "no-runtime", "message", "The Microsoft Edge WebView2 runtime is not installed."));
                return 3;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SignInForm(profile, url));
            return 0;
        }
    }

    internal sealed class SignInForm : Form
    {
        // Google's own sign-in, accounts and YouTube: the only pages this window opens.
        private static readonly Regex AllowedHost = new Regex(@"^(?:[a-z0-9-]+\.)*(?:google\.(?:com|[a-z]{2,3}|com?\.[a-z]{2})|youtube\.com|gstatic\.com|googleusercontent\.com)$", RegexOptions.IgnoreCase);
        private const string Music = "https://music.youtube.com";
        private const string ContextScript = @"(() => {
  const config = window.ytcfg;
  if (!config || typeof config.get !== 'function') return {};
  const names = { 'x-goog-authuser': 'SESSION_INDEX', 'x-goog-pageid': 'DELEGATED_SESSION_ID', 'x-goog-visitor-id': 'VISITOR_DATA', 'x-youtube-client-version': 'INNERTUBE_CLIENT_VERSION' };
  const out = {};
  for (const [header, key] of Object.entries(names)) {
    const value = config.get(key);
    if (typeof value === 'string' || typeof value === 'number') out[header] = String(value);
  }
  return out;
})()";

        private readonly string profile;
        private readonly string startUrl;
        private readonly WebView2 web = new WebView2 { Dock = DockStyle.Fill };
        private readonly System.Windows.Forms.Timer cookiePoll = new System.Windows.Forms.Timer { Interval = 1000 };
        private string lastCookies = "";
        private bool ready;

        internal static bool Allowed(string value)
        {
            if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)) return false;
            return uri.Scheme == Uri.UriSchemeHttps && uri.IsDefaultPort && string.IsNullOrEmpty(uri.UserInfo) && AllowedHost.IsMatch(uri.Host);
        }

        internal SignInForm(string profile, string url)
        {
            this.profile = profile;
            startUrl = url;
            Text = "Sign in to YouTube Music";
            // Sizes below are at 96 DPI; WinForms scales them to the screen's
            // DPI (without AutoScaleDimensions it doesn't, and the window comes
            // out tiny on a 150% or 200% display).
            SuspendLayout();
            AutoScaleDimensions = new SizeF(96F, 96F);
            AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(430, 880); // a large phone
            MinimumSize = new Size(360, 560);
            StartPosition = FormStartPosition.CenterScreen;
            ResumeLayout(false);
            Load += (s, e) => FitScreen();
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            Controls.Add(web);
            Load += async (s, e) => await StartAsync();
            FormClosed += (s, e) => Program.Send(Program.Message("closed"));
            cookiePoll.Tick += async (s, e) => await PollCookiesAsync();
            new Thread(ReadCommands) { IsBackground = true, Name = "commands" }.Start();
        }

        // Never taller or wider than the screen it opens on.
        private void FitScreen()
        {
            var area = Screen.FromControl(this).WorkingArea;
            var height = Math.Min(Height, (int)(area.Height * 0.94));
            var width = Math.Min(Width, area.Width);
            if (height == Height && width == Width) return;
            Size = new Size(width, height);
            CenterToScreen();
        }

        private async Task StartAsync()
        {
            try
            {
                Directory.CreateDirectory(profile);
                var environment = await CoreWebView2Environment.CreateAsync(null, profile);
                await web.EnsureCoreWebView2Async(environment);
                var core = web.CoreWebView2;
                core.Settings.AreDevToolsEnabled = false;
                core.Settings.AreHostObjectsAllowed = false;
                core.Settings.IsStatusBarEnabled = false;
                core.NavigationStarting += (s, e) => { if (!Allowed(e.Uri)) e.Cancel = true; else Changed(); };
                core.NewWindowRequested += (s, e) =>
                {
                    // Popups (account chooser, "use another device") open here, never in a browser.
                    e.Handled = true;
                    if (Allowed(e.Uri)) core.Navigate(e.Uri);
                };
                core.NavigationCompleted += (s, e) => Changed();
                core.SourceChanged += (s, e) => Changed();
                core.ProcessFailed += (s, e) => Fail("failed", "The sign-in window stopped responding. Please try again.");
                core.Navigate(startUrl);
                cookiePoll.Start();
                ready = true;
                Program.Send(Program.Message("ready"));
            }
            catch (WebView2RuntimeNotFoundException)
            {
                Fail("no-runtime", "The Microsoft Edge WebView2 runtime is not installed.");
            }
            catch (Exception error)
            {
                Fail("failed", "Could not open the sign-in window: " + error.Message);
            }
        }

        private void Changed() { if (ready) Program.Send(Program.Message("changed")); }

        private void Fail(string code, string message)
        {
            Program.Send(Program.Message("error", "code", code, "message", message));
            BeginInvoke((Action)Close);
        }

        private async Task PollCookiesAsync()
        {
            if (web.CoreWebView2 == null) return;
            try
            {
                var cookies = await web.CoreWebView2.CookieManager.GetCookiesAsync(Music);
                var key = string.Join("\n", cookies.Select(c => c.Domain + "|" + c.Path + "|" + c.Name + "|" + c.Value).OrderBy(x => x, StringComparer.Ordinal));
                if (key != lastCookies) { lastCookies = key; Changed(); }
            }
            catch { }
        }

        private void ReadCommands()
        {
            try
            {
                string line;
                while ((line = Console.In.ReadLine()) != null)
                {
                    Dictionary<string, object> command;
                    try { command = Program.Json.Deserialize<Dictionary<string, object>>(line); }
                    catch { continue; }
                    if (command == null || !command.TryGetValue("cmd", out var name)) continue;
                    var id = command.TryGetValue("id", out var value) ? value : null;
                    BeginInvoke((Action)(async () => await RunAsync(name as string, id)));
                }
            }
            catch { }
            // Lokal is gone: so is this window.
            try { BeginInvoke((Action)Close); } catch { }
        }

        private async Task RunAsync(string name, object id)
        {
            switch (name)
            {
                case "focus":
                    if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
                    Activate();
                    break;
                case "close":
                    Close();
                    break;
                case "read":
                    Program.Send(await SnapshotAsync(id));
                    break;
            }
        }

        private async Task<Dictionary<string, object>> SnapshotAsync(object id)
        {
            var core = web.CoreWebView2;
            if (core == null) return Program.Message("snapshot", "id", id, "url", "about:blank", "userAgent", "", "context", new Dictionary<string, object>(), "cookies", new object[0]);
            var url = core.Source ?? "about:blank";
            var context = new Dictionary<string, object>();
            if (Uri.TryCreate(url, UriKind.Absolute, out var page) && page.Scheme == "https" && page.Host == "music.youtube.com")
            {
                try
                {
                    var result = await core.ExecuteScriptAsync(ContextScript);
                    context = Program.Json.Deserialize<Dictionary<string, object>>(result) ?? context;
                }
                catch { }
            }
            var cookies = (await core.CookieManager.GetCookiesAsync(Music)).Select(cookie => (object)new Dictionary<string, object>
            {
                ["name"] = cookie.Name,
                ["value"] = cookie.Value,
                ["domain"] = cookie.Domain,
                ["path"] = cookie.Path,
                ["secure"] = cookie.IsSecure,
                ["httpOnly"] = cookie.IsHttpOnly,
                ["sameSite"] = cookie.SameSite == CoreWebView2CookieSameSiteKind.None ? "None" : cookie.SameSite == CoreWebView2CookieSameSiteKind.Strict ? "Strict" : "Lax",
                ["session"] = cookie.IsSession,
                ["expires"] = cookie.IsSession ? 0 : (cookie.Expires.ToUniversalTime() - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalSeconds,
            }).ToArray();
            return Program.Message("snapshot", "id", id, "url", url, "userAgent", core.Settings.UserAgent ?? "", "context", context, "cookies", cookies);
        }
    }
}
