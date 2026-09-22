#![deny(clippy::all)]

use std::sync::{Mutex, OnceLock};

use napi_derive::napi;
use windows::core::{HSTRING, Result as WinResult};
use windows::Foundation::{TimeSpan, TypedEventHandler, Uri};
use windows::Media::{
    AutoRepeatModeChangeRequestedEventArgs, MediaPlaybackAutoRepeatMode, MediaPlaybackStatus,
    MediaPlaybackType, PlaybackPositionChangeRequestedEventArgs,
    ShuffleEnabledChangeRequestedEventArgs, SystemMediaTransportControls,
    SystemMediaTransportControlsButton, SystemMediaTransportControlsButtonPressedEventArgs,
    SystemMediaTransportControlsTimelineProperties,
};
use windows::Storage::Streams::RandomAccessStreamReference;
use windows::Win32::Foundation::{BOOL, HWND, LPARAM, TRUE};
use windows::Win32::System::Threading::GetCurrentProcessId;
use windows::Win32::System::WinRT::ISystemMediaTransportControlsInterop;
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
};

static BOUND_HWND: OnceLock<isize> = OnceLock::new();

#[derive(Default)]
struct Pending {
    shuffle: Option<bool>,
    repeat: Option<i32>,
    button: Option<String>,
    position: Option<f64>,
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

unsafe extern "system" fn find_window_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let ctx = &mut *(lparam.0 as *mut FindCtx);
    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if pid == ctx.pid && IsWindowVisible(hwnd).as_bool() {
        let len = GetWindowTextLengthW(hwnd);
        if len > 0 {
            let mut buf = vec![0u16; (len + 1) as usize];
            let n = GetWindowTextW(hwnd, &mut buf);
            if n > 0 {
                ctx.hwnd = hwnd.0;
                ctx.title = String::from_utf16_lossy(&buf[..n as usize]);
                return BOOL(0);
            }
        }
    }
    TRUE
}

#[napi]
pub fn find_own_window() -> WinInfo {
    let mut ctx = FindCtx {
        pid: unsafe { GetCurrentProcessId() },
        hwnd: 0,
        title: String::new(),
    };
    unsafe {
        let _ = EnumWindows(Some(find_window_proc), LPARAM(&mut ctx as *mut _ as isize));
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
pub fn arm_shuffle_repeat(hwnd: i64) -> napi::Result<()> {
    let hwnd = hwnd as isize;
    let smtc = smtc_for(hwnd)
        .map_err(|e| napi::Error::from_reason(format!("SMTC arm failed: {e:?}")))?;

    // Lokal owns the Windows SMTC session. Chromium's MediaSessionService is
    // disabled in the main process so this is the authoritative session.
    smtc.SetIsEnabled(true)
        .map_err(|e| napi::Error::from_reason(format!("SetIsEnabled failed: {e:?}")))?;
    smtc.SetIsPlayEnabled(true)
        .map_err(|e| napi::Error::from_reason(format!("SetIsPlayEnabled failed: {e:?}")))?;
    smtc.SetIsPauseEnabled(true)
        .map_err(|e| napi::Error::from_reason(format!("SetIsPauseEnabled failed: {e:?}")))?;
    smtc.SetIsNextEnabled(true)
        .map_err(|e| napi::Error::from_reason(format!("SetIsNextEnabled failed: {e:?}")))?;
    smtc.SetIsPreviousEnabled(true)
        .map_err(|e| napi::Error::from_reason(format!("SetIsPreviousEnabled failed: {e:?}")))?;
    smtc.SetIsStopEnabled(true)
        .map_err(|e| napi::Error::from_reason(format!("SetIsStopEnabled failed: {e:?}")))?;
    smtc.SetIsFastForwardEnabled(true)
        .map_err(|e| napi::Error::from_reason(format!("SetIsFastForwardEnabled failed: {e:?}")))?;
    smtc.SetIsRewindEnabled(true)
        .map_err(|e| napi::Error::from_reason(format!("SetIsRewindEnabled failed: {e:?}")))?;
    smtc.SetShuffleEnabled(false)
        .map_err(|e| napi::Error::from_reason(format!("SetShuffleEnabled failed: {e:?}")))?;
    smtc.SetAutoRepeatMode(MediaPlaybackAutoRepeatMode::None)
        .map_err(|e| napi::Error::from_reason(format!("SetAutoRepeatMode failed: {e:?}")))?;

    smtc.ShuffleEnabledChangeRequested(&TypedEventHandler::new(
        move |_sender: &Option<SystemMediaTransportControls>,
              args: &Option<ShuffleEnabledChangeRequestedEventArgs>| {
            if let Some(args) = args {
                pending().lock().unwrap().shuffle = Some(args.RequestedShuffleEnabled()?);
            }
            Ok(())
        },
    ))
    .map_err(|e| napi::Error::from_reason(format!("Shuffle handler failed: {e:?}")))?;

    smtc.AutoRepeatModeChangeRequested(&TypedEventHandler::new(
        move |_sender: &Option<SystemMediaTransportControls>,
              args: &Option<AutoRepeatModeChangeRequestedEventArgs>| {
            if let Some(args) = args {
                pending().lock().unwrap().repeat = Some(repeat_to_i32(args.RequestedAutoRepeatMode()?));
            }
            Ok(())
        },
    ))
    .map_err(|e| napi::Error::from_reason(format!("Repeat handler failed: {e:?}")))?;

    smtc.ButtonPressed(&TypedEventHandler::new(
        move |_sender: &Option<SystemMediaTransportControls>,
              args: &Option<SystemMediaTransportControlsButtonPressedEventArgs>| {
            if let Some(args) = args {
                let button = match args.Button()? {
                    SystemMediaTransportControlsButton::Play => "play",
                    SystemMediaTransportControlsButton::Pause => "pause",
                    SystemMediaTransportControlsButton::Stop => "stop",
                    SystemMediaTransportControlsButton::Next => "next",
                    SystemMediaTransportControlsButton::Previous => "previous",
                    SystemMediaTransportControlsButton::FastForward => "fastforward",
                    SystemMediaTransportControlsButton::Rewind => "rewind",
                    _ => "other",
                };
                pending().lock().unwrap().button = Some(button.to_string());
            }
            Ok(())
        },
    ))
    .map_err(|e| napi::Error::from_reason(format!("Button handler failed: {e:?}")))?;

    smtc.PlaybackPositionChangeRequested(&TypedEventHandler::new(
        move |_sender: &Option<SystemMediaTransportControls>,
              args: &Option<PlaybackPositionChangeRequestedEventArgs>| {
            if let Some(args) = args {
                let position = args.RequestedPlaybackPosition()?;
                pending().lock().unwrap().position =
                    Some(position.Duration as f64 / 10_000_000.0);
            }
            Ok(())
        },
    ))
    .map_err(|e| napi::Error::from_reason(format!("Position handler failed: {e:?}")))?;

    let _ = BOUND_HWND.set(hwnd);
    Ok(())
}

#[napi(object)]
pub struct PendingRequests {
    pub shuffle: Option<bool>,
    pub repeat: Option<i32>,
    pub button: Option<String>,
    pub position: Option<f64>,
}

#[napi]
pub fn poll_requests() -> PendingRequests {
    let mut pending = pending().lock().unwrap();
    PendingRequests {
        shuffle: pending.shuffle.take(),
        repeat: pending.repeat.take(),
        button: pending.button.take(),
        position: pending.position.take(),
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
    }

    updater
        .Update()
        .map_err(|e| napi::Error::from_reason(format!("DisplayUpdater.Update failed: {e:?}")))
}
