#![deny(clippy::all)]

use std::sync::{Mutex, OnceLock};

use napi_derive::napi;
use windows::Media::{
    AutoRepeatModeChangeRequestedEventArgs, MediaPlaybackAutoRepeatMode,
    ShuffleEnabledChangeRequestedEventArgs, SystemMediaTransportControls,
};
use windows::Win32::Foundation::HWND;
use windows::Win32::System::WinRT::ISystemMediaTransportControlsInterop;
use windows::core::TypedEventHandler;

#[derive(Default)]
struct Pending {
    shuffle: Option<bool>,
    repeat: Option<i32>,
}

fn pending() -> &'static Mutex<Pending> {
    static PENDING: OnceLock<Mutex<Pending>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(Pending::default()))
}

fn smtc_for(hwnd: isize) -> windows::core::Result<SystemMediaTransportControls> {
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

#[napi]
pub fn arm_shuffle_repeat(hwnd: i64) -> napi::Result<()> {
    let smtc = smtc_for(hwnd as isize)
        .map_err(|e| napi::Error::from_reason(format!("SMTC GetForWindow failed: {e:?}")))?;

    smtc.SetShuffleEnabled(false)
        .map_err(|e| napi::Error::from_reason(format!("SetShuffleEnabled failed: {e:?}")))?;
    smtc.SetAutoRepeatMode(MediaPlaybackAutoRepeatMode::None)
        .map_err(|e| napi::Error::from_reason(format!("SetAutoRepeatMode failed: {e:?}")))?;

    smtc.ShuffleEnabledChangeRequested(&TypedEventHandler::new(
        move |_sender: &Option<SystemMediaTransportControls>,
              args: &Option<ShuffleEnabledChangeRequestedEventArgs>| {
            if let Some(args) = args {
                let value = args.RequestedShuffleEnabled()?;
                pending().lock().unwrap().shuffle = Some(value);
            }
            Ok(())
        },
    ))
    .map_err(|e| napi::Error::from_reason(format!("Shuffle handler failed: {e:?}")))?;

    smtc.AutoRepeatModeChangeRequested(&TypedEventHandler::new(
        move |_sender: &Option<SystemMediaTransportControls>,
              args: &Option<AutoRepeatModeChangeRequestedEventArgs>| {
            if let Some(args) = args {
                let value = args.RequestedAutoRepeatMode()?;
                pending().lock().unwrap().repeat = Some(repeat_to_i32(value));
            }
            Ok(())
        },
    ))
    .map_err(|e| napi::Error::from_reason(format!("Repeat handler failed: {e:?}")))?;

    Ok(())
}

#[napi(object)]
pub struct PendingRequests {
    pub shuffle: Option<bool>,
    pub repeat: Option<i32>,
}

#[napi]
pub fn poll_requests() -> PendingRequests {
    let mut pending = pending().lock().unwrap();
    PendingRequests {
        shuffle: pending.shuffle.take(),
        repeat: pending.repeat.take(),
    }
}

#[napi]
pub fn set_shuffle_state(enabled: bool, hwnd: i64) -> napi::Result<()> {
    smtc_for(hwnd as isize)
        .and_then(|smtc| smtc.SetShuffleEnabled(enabled))
        .map_err(|e| napi::Error::from_reason(format!("SetShuffleEnabled failed: {e:?}")))
}

#[napi]
pub fn set_repeat_state(mode: i32, hwnd: i64) -> napi::Result<()> {
    smtc_for(hwnd as isize)
        .and_then(|smtc| smtc.SetAutoRepeatMode(i32_to_repeat(mode)))
        .map_err(|e| napi::Error::from_reason(format!("SetAutoRepeatMode failed: {e:?}")))
}
