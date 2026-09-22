#![deny(clippy::all)]

use std::sync::{Mutex, OnceLock};

use napi_derive::napi;
use windows::core::{HSTRING, Result as WinResult};
use windows::Foundation::TypedEventHandler;
use windows::Media::{
    AutoRepeatModeChangeRequestedEventArgs, MediaPlaybackAutoRepeatMode,
    ShuffleEnabledChangeRequestedEventArgs, SystemMediaTransportControls,
};
use windows::Storage::Streams::RandomAccessStreamReference;
use windows::Win32::Foundation::{BOOL, HWND, LPARAM, TRUE};
use windows::Win32::System::Threading::GetCurrentProcessId;
use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible};
use windows::Win32::System::WinRT::ISystemMediaTransportControlsInterop;

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
    WinInfo { hwnd: ctx.hwnd as i64, title: ctx.title }
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


