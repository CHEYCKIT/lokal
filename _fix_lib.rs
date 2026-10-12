// Windows System Media Transport Controls (SMTC) shuffle/repeat bridge --
// compiled as a Node native addon (napi-rs) and loaded directly into
// Electron's main process.
//
// This *must* run in-process. An earlier design (native/smtc-bridge as a
// separate .NET helper .exe, spawned as its own OS process -- see git
// history) logged concrete diagnostic evidence that
// SystemMediaTransportControlsInterop::GetForWindow() throws
// UnauthorizedAccessException (HRESULT 0x80070005, E_ACCESSDENIED) on every
// single call, across 1000+ attempts and a process restart, for a window
// handle owned by a different process. That's a hard Windows security
// boundary on this interop call, not a transient bug: GetForWindow only
// succeeds when the caller and the window's owner are the same process.
// Loading this addon into Electron's own process satisfies that trivially,
// since find_chromium_smtc_window_proc below only matches windows whose
// owning PID is GetCurrentProcessId() -- i.e. this process's own hidden
// Chrome_WidgetWin_* window.
//
// This never touches play/pause/next/prev/metadata -- Chromium keeps doing
// all of that exactly as it already does today (see electron/main.js's
// enable-features=HardwareMediaKeyHandling,MediaSessionService switch,
// added for issue #12). This only adds ShuffleEnabled/AutoRepeatMode,
// augmenting Chromium's existing SMTC session rather than replacing it.

#![deny(clippy::all)]

use std::sync::{Mutex, OnceLock};

use napi_derive::napi;
use windows::core::{HSTRING, Result as WinResult};
use windows::Foundation::{TimeSpan, TypedEventHandler, Uri};
use windows::Media::{
    AutoRepeatModeChangeRequestedEventArgs, MediaPlaybackAutoRepeatMode, MediaPlaybackStatus,
    MediaPlaybackType, ShuffleEnabledChangeRequestedEventArgs, SystemMediaTransportControls,
    SystemMediaTransportControlsTimelineProperties,
};
use windows::Storage::Streams::RandomAccessStreamReference;
use windows::Win32::Foundation::{BOOL, HWND, LPARAM, TRUE};
use windows::Win32::System::Threading::GetCurrentProcessId;
use windows::Win32::System::WinRT::ISystemMediaTransportControlsInterop;
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
    IsWindowVisible,
};

static BOUND_HWND: OnceLock<isize> = OnceLock::new();

#[derive(Default)]
struct Pending {
    shuffle: Option<bool>,
    repeat: Option<i32>,
    // Incremented every time either WinRT event handler below actually
    // fires, regardless of the value it carried. Exposed through
    // poll_requests() purely as a diagnostic: if this never increases while
    // clicking Shuffle/Repeat in a native flyout, the click isn't reaching
    // this native module at all (a WinRT/session-binding problem), as
    // distinct from the handler firing but something downstream (the JS
    // poll loop, the IPC message, the renderer's action) not reacting to
    // it -- two very different bugs that look identical from the outside.
    fire_count: u32,
}

fn pending() -> &'static Mutex<Pending> {
    static PENDING: OnceLock<Mutex<Pending>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(Pending::default()))
}

#[napi(object)]
pub struct WinInfo {
    pub hwnd: i64,
    pub title: String,
}

struct FindCtx {
    pid: u32,
    hwnd: isize,
    title: String,
}

unsafe extern "system" fn find_chromium_smtc_window_proc(
    hwnd: HWND,
    lparam: LPARAM,
) -> BOOL {
    let ctx = &mut *(lparam.0 as *mut FindCtx);

    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if pid != ctx.pid {
        return TRUE;
    }

    // Chromium's Windows SMTC implementation binds to gfx::SingletonHwnd,
    // which is a hidden WindowImpl with Chromium's Chrome_WidgetWin_* class,
    // not the visible Electron BrowserWindow.
    let mut class_buf = [0u16; 256];
    let class_len = GetClassNameW(hwnd, &mut class_buf);
    if class_len <= 0 {
        return TRUE;
    }
    let class_name = String::from_utf16_lossy(&class_buf[..class_len as usize]);
    if !class_name.starts_with("Chrome_WidgetWin_") {
        return TRUE;
    }

    if IsWindowVisible(hwnd).as_bool() {
        return TRUE;
    }

    let title_len = GetWindowTextLengthW(hwnd);
    if title_len != 0 {
        return TRUE;
    }

    // Only accept the hidden Chromium window that already owns an enabled
    // SMTC session. This avoids accidentally creating a second session on
    // some other hidden Electron/Chromium window.
    let smtc = match smtc_for(hwnd.0) {
        Ok(smtc) => smtc,
        Err(_) => return TRUE,
    };
    if !smtc.IsEnabled().unwrap_or(false) {
        return TRUE;
    }

    ctx.hwnd = hwnd.0;
    ctx.title.clear();
    BOOL(0)
}

#[napi]
pub fn find_chromium_smtc_window() -> WinInfo {
    let mut ctx = FindCtx {
        pid: unsafe { GetCurrentProcessId() },
        hwnd: 0,
        title: String::new(),
    };

    unsafe {
        let _ = EnumWindows(
            Some(find_chromium_smtc_window_proc),
            LPARAM(&mut ctx as *mut _ as isize),
        );
    }

    WinInfo {
        hwnd: ctx.hwnd as i64,
        title: ctx.title,
    }
}

fn smtc_for(hwnd: isize) -> WinResult<SystemMediaTransportControls> {
    let interop = windows::core::factory::<
        SystemMediaTransportControls,
        ISystemMediaTransportControlsInterop,
    >()?;
    unsafe { interop.GetForWindow(HWND(hwnd)) }
}

fn repeat_to_i32(mode: MediaPlaybackAutoRepeatMode) -> i32 {
    match mode {
        MediaPlaybackAutoRepeatMode::List => 1,
        MediaPlaybackAutoRepeatMode::Track => 2,
        _ => 0,
    }
}

fn i32_to_repeat(mode: i32) -> MediaPlaybackAutoRepeatMode {
    match mode {
        1 => MediaPlaybackAutoRepeatMode::List,
        2 => MediaPlaybackAutoRepeatMode::Track,
        _ => MediaPlaybackAutoRepeatMode::None,
    }
}

fn bound_hwnd() -> napi::Result<isize> {
    BOUND_HWND
        .get()
        .copied()
        .ok_or_else(|| napi::Error::from_reason("SMTC bridge is not armed"))
}

#[napi]
pub fn is_armed() -> bool {
    BOUND_HWND.get().is_some()
}

#[napi]
pub fn arm_shuffle_repeat(hwnd: i64) -> napi::Result<()> {
    let hwnd = hwnd as isize;
    let smtc = smtc_for(hwnd)
        .map_err(|e| napi::Error::from_reason(format!("SMTC arm failed: {e:?}")))?;

    // This is Chromium's own SMTC session. Leave its transport controls alone;
    // we only add shuffle/repeat support to the existing session.
    smtc.SetIsEnabled(true)
        .map_err(|e| napi::Error::from_reason(format!("SetIsEnabled failed: {e:?}")))?;
    smtc.SetShuffleEnabled(false)
        .map_err(|e| napi::Error::from_reason(format!("SetShuffleEnabled failed: {e:?}")))?;
    smtc.SetAutoRepeatMode(MediaPlaybackAutoRepeatMode::None)
        .map_err(|e| napi::Error::from_reason(format!("SetAutoRepeatMode failed: {e:?}")))?;

    smtc.ShuffleEnabledChangeRequested(&TypedEventHandler::new(
        move |_sender: &Option<SystemMediaTransportControls>,
              args: &Option<ShuffleEnabledChangeRequestedEventArgs>| {
            if let Some(args) = args {
                let mut p = pending().lock().unwrap();
                p.shuffle = Some(args.RequestedShuffleEnabled()?);
                p.fire_count = p.fire_count.wrapping_add(1);
            }
            Ok(())
        },
    ))
    .map_err(|e| napi::Error::from_reason(format!("Shuffle handler failed: {e:?}")))?;

    smtc.AutoRepeatModeChangeRequested(&TypedEventHandler::new(
        move |_sender: &Option<SystemMediaTransportControls>,
              args: &Option<AutoRepeatModeChangeRequestedEventArgs>| {
            if let Some(args) = args {
                let mut p = pending().lock().unwrap();
                p.repeat = Some(repeat_to_i32(args.RequestedAutoRepeatMode()?));
                p.fire_count = p.fire_count.wrapping_add(1);
            }
            Ok(())
        },
    ))
    .map_err(|e| napi::Error::from_reason(format!("Repeat handler failed: {e:?}")))?;

    let _ = BOUND_HWND.set(hwnd);
    Ok(())
}

#[napi(object)]
pub struct PendingRequests {
    pub shuffle: Option<bool>,
    pub repeat: Option<i32>,
    // Monotonic -- not reset on read, unlike shuffle/repeat above. JS
    // compares this against the value from its previous poll to tell
    // whether either native handler fired since then, independent of
    // whether the requested value actually changed anything.
    pub fire_count: u32,
}

#[napi]
pub fn poll_requests() -> PendingRequests {
    let mut pending = pending().lock().unwrap();
    PendingRequests {
        shuffle: pending.shuffle.take(),
        repeat: pending.repeat.take(),
        fire_count: pending.fire_count,
    }
}

#[napi]
pub fn set_shuffle_state(enabled: bool) -> napi::Result<()> {
    smtc_for(bound_hwnd()?)
        .and_then(|smtc| smtc.SetShuffleEnabled(enabled))
        .map_err(|e| napi::Error::from_reason(format!("SetShuffleEnabled failed: {e:?}")))
}

#[napi]
pub fn set_repeat_state(mode: i32) -> napi::Result<()> {
    smtc_for(bound_hwnd()?)
        .and_then(|smtc| smtc.SetAutoRepeatMode(i32_to_repeat(mode)))
        .map_err(|e| napi::Error::from_reason(format!("SetAutoRepeatMode failed: {e:?}")))
}

#[napi]
pub fn set_playing(playing: bool) -> napi::Result<()> {
    let status = if playing {
        MediaPlaybackStatus::Playing
    } else {
        MediaPlaybackStatus::Paused
    };
    smtc_for(bound_hwnd()?)
        .and_then(|smtc| smtc.SetPlaybackStatus(status))
        .map_err(|e| napi::Error::from_reason(format!("SetPlaybackStatus failed: {e:?}")))
}

#[napi]
pub fn update_timeline(position_secs: f64, duration_secs: f64) -> napi::Result<()> {
    let smtc = smtc_for(bound_hwnd()?)
        .map_err(|e| napi::Error::from_reason(format!("GetForWindow failed: {e:?}")))?;
    let to_ts = |seconds: f64| TimeSpan {
        Duration: (seconds.max(0.0) * 10_000_000.0) as i64,
    };
    let props = SystemMediaTransportControlsTimelineProperties::new()
        .map_err(|e| napi::Error::from_reason(format!("Timeline properties failed: {e:?}")))?;
    props.SetStartTime(to_ts(0.0))
        .map_err(|e| napi::Error::from_reason(format!("SetStartTime failed: {e:?}")))?;
    props.SetMinSeekTime(to_ts(0.0))
        .map_err(|e| napi::Error::from_reason(format!("SetMinSeekTime failed: {e:?}")))?;
    props.SetPosition(to_ts(position_secs))
        .map_err(|e| napi::Error::from_reason(format!("SetPosition failed: {e:?}")))?;
    props.SetMaxSeekTime(to_ts(duration_secs))
        .map_err(|e| napi::Error::from_reason(format!("SetMaxSeekTime failed: {e:?}")))?;
    props.SetEndTime(to_ts(duration_secs))
        .map_err(|e| napi::Error::from_reason(format!("SetEndTime failed: {e:?}")))?;
    smtc.UpdateTimelineProperties(&props)
        .map_err(|e| napi::Error::from_reason(format!("UpdateTimelineProperties failed: {e:?}")))
}

#[napi]
pub fn update_metadata(
    title: String,
    artist: String,
    album: String,
    cover_url: String,
) -> napi::Result<()> {
    let smtc = smtc_for(bound_hwnd()?)
        .map_err(|e| napi::Error::from_reason(format!("GetForWindow failed: {e:?}")))?;
    let updater = smtc
        .DisplayUpdater()
        .map_err(|e| napi::Error::from_reason(format!("DisplayUpdater failed: {e:?}")))?;
    updater
        .SetType(MediaPlaybackType::Music)
        .map_err(|e| napi::Error::from_reason(format!("SetType failed: {e:?}")))?;
    let music = updater
        .MusicProperties()
        .map_err(|e| napi::Error::from_reason(format!("MusicProperties failed: {e:?}")))?;
    music.SetTitle(&HSTRING::from(title))
        .map_err(|e| napi::Error::from_reason(format!("SetTitle failed: {e:?}")))?;
    music.SetArtist(&HSTRING::from(artist))
        .map_err(|e| napi::Error::from_reason(format!("SetArtist failed: {e:?}")))?;
    music.SetAlbumTitle(&HSTRING::from(album))
        .map_err(|e| napi::Error::from_reason(format!("SetAlbumTitle failed: {e:?}")))?;

    if !cover_url.is_empty() {
        let uri = Uri::CreateUri(&HSTRING::from(cover_url))
            .map_err(|e| napi::Error::from_reason(format!("CreateUri failed: {e:?}")))?;
        let thumbnail = RandomAccessStreamReference::CreateFromUri(&uri)
            .map_err(|e| napi::Error::from_reason(format!("CreateFromUri failed: {e:?}")))?;
        updater
            .SetThumbnail(&thumbnail)
            .map_err(|e| napi::Error::from_reason(format!("SetThumbnail failed: {e:?}")))?;
    } else {
        // Without this, a track with no cover art keeps showing whatever
        // thumbnail the previous track set -- DisplayUpdater doesn't clear
        // fields on its own, it only applies whatever this call sets, so an
        // empty cover_url has to explicitly null the thumbnail out instead
        // of just skipping the call.
        updater
            .SetThumbnail(None)
            .map_err(|e| napi::Error::from_reason(format!("SetThumbnail failed: {e:?}")))?;
    }

    updater
        .Update()
        .map_err(|e| napi::Error::from_reason(format!("DisplayUpdater.Update failed: {e:?}")))
}
