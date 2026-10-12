#![deny(clippy::all)]

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use rodio::{Decoder, OutputStream, OutputStreamBuilder, Sink, Source};

type AudioSource = Box<dyn Source<Item = f32> + Send>;

struct LoadedSource {
    source: AudioSource,
    duration: Option<f64>,
}

struct StreamState {
    bytes: Vec<u8>,
    total: Option<usize>,
    complete: bool,
    error: Option<String>,
}

/// A seekable view over a response body that is still arriving. Container probes commonly seek
/// to the tail before they decode the first frame; the reader exposes the server's content length
/// immediately and only waits when a requested byte has not arrived yet.
struct StreamingReader {
    state: Arc<(Mutex<StreamState>, Condvar)>,
    position: usize,
}

impl StreamingReader {
    fn from_response(mut response: reqwest::blocking::Response) -> Self {
        let total = response.content_length().map(|value| value as usize);
        let state = Arc::new((Mutex::new(StreamState {
            bytes: Vec::new(),
            total,
            complete: false,
            error: None,
        }), Condvar::new()));
        let worker_state = state.clone();
        std::thread::spawn(move || {
            let mut chunk = [0u8; 128 * 1024];
            loop {
                match response.read(&mut chunk) {
                    Ok(0) => {
                        let (lock, ready) = &*worker_state;
                        if let Ok(mut state) = lock.lock() {
                            state.complete = true;
                            ready.notify_all();
                        }
                        break;
                    }
                    Ok(size) => {
                        let (lock, ready) = &*worker_state;
                        if let Ok(mut state) = lock.lock() {
                            state.bytes.extend_from_slice(&chunk[..size]);
                            ready.notify_all();
                        }
                    }
                    Err(error) => {
                        let (lock, ready) = &*worker_state;
                        if let Ok(mut state) = lock.lock() {
                            state.error = Some(error.to_string());
                            state.complete = true;
                            ready.notify_all();
                        }
                        break;
                    }
                }
            }
        });
        Self { state, position: 0 }
    }
}

impl Read for StreamingReader {
    fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
        if output.is_empty() { return Ok(0); }
        let (lock, ready) = &*self.state;
        let mut state = lock.lock().map_err(|_| std::io::Error::other("audio stream lock poisoned"))?;
        loop {
            if self.position < state.bytes.len() {
                let count = output.len().min(state.bytes.len() - self.position);
                output[..count].copy_from_slice(&state.bytes[self.position..self.position + count]);
                self.position += count;
                return Ok(count);
            }
            if let Some(error) = &state.error {
                return Err(std::io::Error::other(error.clone()));
            }
            if state.complete { return Ok(0); }
            state = ready.wait(state).map_err(|_| std::io::Error::other("audio stream lock poisoned"))?;
        }
    }
}

impl Seek for StreamingReader {
    fn seek(&mut self, from: SeekFrom) -> std::io::Result<u64> {
        let (lock, _) = &*self.state;
        let state = lock.lock().map_err(|_| std::io::Error::other("audio stream lock poisoned"))?;
        let total = state.total.ok_or_else(|| std::io::Error::other("audio stream length is unknown"))? as i64;
        let current = self.position as i64;
        let target = match from {
            SeekFrom::Start(value) => value as i64,
            SeekFrom::Current(value) => current + value,
            SeekFrom::End(value) => total + value,
        };
        if target < 0 { return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "audio seek before start")); }
        self.position = target as usize;
        Ok(self.position as u64)
    }
}

struct Deck {
    sink: Sink,
    track_id: Option<String>,
    duration: f64,
}

impl Deck {
    fn new(stream: &OutputStream) -> Self {
        Self {
            sink: Sink::connect_new(stream.mixer()),
            track_id: None,
            duration: 0.0,
        }
    }

    fn clear(&mut self) {
        self.sink.stop();
        self.track_id = None;
        self.duration = 0.0;
    }
}

struct EngineState {
    // The stream must stay alive for the lifetime of both sinks.
    _stream: OutputStream,
    decks: [Deck; 2],
    active: usize,
    volume: f32,
    rate: f32,
    playing: bool,
}

impl EngineState {
    fn new() -> Result<Self> {
        let stream = OutputStreamBuilder::open_default_stream()
            .map_err(|error| Error::from_reason(format!("could not open audio output: {error}")))?;
        let decks = [Deck::new(&stream), Deck::new(&stream)];
        Ok(Self {
            _stream: stream,
            decks,
            active: 0,
            volume: 1.0,
            rate: 1.0,
            playing: false,
        })
    }

    fn load(&mut self, track_id: String, loaded: LoadedSource, standby: bool) -> Result<f64> {
        let index = if standby { 1 - self.active } else { self.active };
        let deck = &mut self.decks[index];
        deck.clear();
        deck.track_id = Some(track_id);
        deck.duration = loaded.duration.unwrap_or(0.0);
        deck.sink.set_volume(if standby { 0.0 } else { self.volume });
        deck.sink.set_speed(self.rate);
        deck.sink.append(loaded.source);
        if standby || !self.playing {
            deck.sink.pause();
        } else {
            deck.sink.play();
        }
        Ok(deck.duration)
    }

    fn active_status(&self) -> PlaybackStatus {
        let deck = &self.decks[self.active];
        PlaybackStatus {
            track_id: deck.track_id.clone(),
            position: deck.sink.get_pos().as_secs_f64(),
            duration: deck.duration,
            playing: self.playing && !deck.sink.is_paused(),
            ended: deck.track_id.is_some() && deck.sink.empty(),
        }
    }

    fn transition(&mut self, track_id: String, fade_ms: u32) -> Result<bool> {
        let next = 1 - self.active;
        if self.decks[next].track_id.as_deref() != Some(track_id.as_str()) {
            return Ok(false);
        }
        let fade = fade_ms.min(30_000);
        if fade == 0 {
            let active = self.active;
            self.decks[active].sink.stop();
            self.active = next;
            let level = self.volume;
            self.decks[self.active].sink.set_volume(level);
            self.decks[self.active].sink.play();
            self.playing = true;
            return Ok(true);
        }
        let steps = (fade / 20).max(1);
        self.decks[next].sink.play();
        for step in 1..=steps {
            let progress = step as f32 / steps as f32;
            let active = self.active;
            let level = self.volume;
            self.decks[active].sink.set_volume(level * (1.0 - progress));
            self.decks[next].sink.set_volume(level * progress);
            std::thread::sleep(Duration::from_millis(20));
        }
        let active = self.active;
        self.decks[active].sink.stop();
        self.active = next;
        let level = self.volume;
        self.decks[self.active].sink.set_volume(level);
        self.playing = true;
        Ok(true)
    }
}

#[napi(object)]
pub struct PlaybackStatus {
    pub track_id: Option<String>,
    pub position: f64,
    pub duration: f64,
    pub playing: bool,
    pub ended: bool,
}

struct LoadTask {
    engine: Arc<Mutex<Option<EngineState>>>,
    track_id: String,
    kind: String,
    value: String,
    headers: Option<HashMap<String, String>>,
    standby: bool,
    loaded: Option<LoadedSource>,
}

struct TransitionTask {
    engine: Arc<Mutex<Option<EngineState>>>,
    track_id: String,
    fade_ms: u32,
}

impl Task for TransitionTask {
    type Output = bool;
    type JsValue = JsBoolean;

    fn compute(&mut self) -> Result<Self::Output> {
        let mut guard = self.engine.lock().map_err(|_| Error::from_reason("audio engine lock poisoned"))?;
        let engine = guard.as_mut().ok_or_else(|| Error::from_reason("audio engine is closed"))?;
        engine.transition(self.track_id.clone(), self.fade_ms)
    }

    fn resolve(self, env: Env, transitioned: Self::Output) -> Result<Self::JsValue> {
        env.get_boolean(transitioned)
    }
}

impl Task for LoadTask {
    type Output = f64;
    type JsValue = JsNumber;

    fn compute(&mut self) -> Result<Self::Output> {
        let loaded = open_source(&self.kind, &self.value, self.headers.as_ref())?;
        let duration = loaded.duration.unwrap_or(0.0);
        self.loaded = Some(loaded);
        Ok(duration)
    }

    fn resolve(self, env: Env, duration: Self::Output) -> Result<Self::JsValue> {
        let mut guard = self.engine.lock().map_err(|_| Error::from_reason("audio engine lock poisoned"))?;
        let engine = guard.as_mut().ok_or_else(|| Error::from_reason("audio engine is closed"))?;
        engine.load(self.track_id, self.loaded.ok_or_else(|| Error::from_reason("audio source was not decoded"))?, self.standby)?;
        env.create_double(duration)
    }
}

#[napi]
pub struct AudioEngine {
    inner: Arc<Mutex<Option<EngineState>>>,
}

#[napi]
impl AudioEngine {
    #[napi(constructor)]
    pub fn new() -> Result<Self> {
        Ok(Self { inner: Arc::new(Mutex::new(Some(EngineState::new()?))) })
    }

    /// Decode a local file or HTTP(S) stream off the Electron main thread and load it into one
    /// of the two native decks. The decoder receives the response body directly, so playback can
    /// begin as soon as the container header and first frames arrive.
    #[napi]
    pub fn load(
        &self,
        track_id: String,
        kind: String,
        value: String,
        headers: Option<HashMap<String, String>>,
        standby: Option<bool>,
    ) -> AsyncTask<LoadTask> {
        AsyncTask::new(LoadTask {
            engine: self.inner.clone(),
            track_id,
            kind,
            value,
            headers,
            standby: standby.unwrap_or(false),
            loaded: None,
        })
    }

    #[napi]
    pub fn play(&self) -> Result<()> {
        let mut guard = self.lock()?;
        let engine = guard.as_mut().ok_or_else(|| Error::from_reason("audio engine is closed"))?;
        engine.playing = true;
        let active = engine.active;
        engine.decks[active].sink.play();
        Ok(())
    }

    #[napi]
    pub fn pause(&self) -> Result<()> {
        let mut guard = self.lock()?;
        let engine = guard.as_mut().ok_or_else(|| Error::from_reason("audio engine is closed"))?;
        engine.playing = false;
        let active = engine.active;
        engine.decks[active].sink.pause();
        Ok(())
    }

    #[napi]
    pub fn stop(&self) -> Result<()> {
        let mut guard = self.lock()?;
        let engine = guard.as_mut().ok_or_else(|| Error::from_reason("audio engine is closed"))?;
        engine.playing = false;
        let active = engine.active;
        engine.decks[active].clear();
        engine.decks[1 - active].clear();
        Ok(())
    }

    #[napi]
    pub fn seek(&self, seconds: f64) -> Result<()> {
        let guard = self.lock()?;
        let engine = guard.as_ref().ok_or_else(|| Error::from_reason("audio engine is closed"))?;
        engine.decks[engine.active]
            .sink
            .try_seek(Duration::from_secs_f64(seconds.max(0.0)))
            .map_err(|error| Error::from_reason(format!("audio seek failed: {error}")))
    }

    #[napi]
    pub fn set_volume(&self, volume: f64) -> Result<()> {
        let mut guard = self.lock()?;
        let engine = guard.as_mut().ok_or_else(|| Error::from_reason("audio engine is closed"))?;
        engine.volume = volume.clamp(0.0, 1.0) as f32;
        let active = engine.active;
        let level = engine.volume;
        engine.decks[active].sink.set_volume(level);
        Ok(())
    }

    #[napi]
    pub fn set_rate(&self, rate: f64) -> Result<()> {
        let mut guard = self.lock()?;
        let engine = guard.as_mut().ok_or_else(|| Error::from_reason("audio engine is closed"))?;
        engine.rate = rate.clamp(0.25, 4.0) as f32;
        let active = engine.active;
        let speed = engine.rate;
        engine.decks[active].sink.set_speed(speed);
        Ok(())
    }

    /// Switch to the already-decoded standby deck. A short equal-power-style ramp keeps the
    /// handoff click-free while the caller updates the queue state.
    #[napi]
    pub fn transition(&self, track_id: String, fade_ms: Option<u32>) -> AsyncTask<TransitionTask> {
        AsyncTask::new(TransitionTask {
            engine: self.inner.clone(),
            track_id,
            fade_ms: fade_ms.unwrap_or(0),
        })
    }

    #[napi]
    pub fn status(&self) -> Result<PlaybackStatus> {
        let guard = self.lock()?;
        Ok(guard.as_ref().ok_or_else(|| Error::from_reason("audio engine is closed"))?.active_status())
    }

    #[napi]
    pub fn close(&self) -> Result<()> {
        let mut guard = self.inner.lock().map_err(|_| Error::from_reason("audio engine lock poisoned"))?;
        if let Some(engine) = guard.as_mut() {
            engine.playing = false;
            engine.decks[0].clear();
            engine.decks[1].clear();
        }
        *guard = None;
        Ok(())
    }
}

impl AudioEngine {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Option<EngineState>>> {
        self.inner.lock().map_err(|_| Error::from_reason("audio engine lock poisoned"))
    }
}

fn open_source(kind: &str, value: &str, headers: Option<&HashMap<String, String>>) -> Result<LoadedSource> {
    let decoder = match kind {
        "file" => Decoder::try_from(BufReader::new(File::open(value).map_err(|error| Error::from_reason(format!("could not open audio file: {error}")))?))
            .map_err(|error| Error::from_reason(format!("audio decode failed: {error}")))?,
        "url" => {
            let client = reqwest::blocking::Client::builder()
                .build()
                .map_err(|error| Error::from_reason(format!("could not create audio client: {error}")))?;
            let mut request = client.get(value);
            if let Some(headers) = headers {
                for (name, value) in headers {
                    request = request.header(name, value);
                }
            }
            let response = request.send().map_err(|error| Error::from_reason(format!("audio stream request failed: {error}")))?;
            if !response.status().is_success() {
                return Err(Error::from_reason(format!("audio stream request returned {}", response.status())));
            }
            Decoder::try_from(BufReader::new(StreamingReader::from_response(response)))
                .map_err(|error| Error::from_reason(format!("audio decode failed: {error}")))?
        }
        _ => return Err(Error::from_reason("unsupported native audio source")),
    };

    let duration = decoder.total_duration().map(|value| value.as_secs_f64());
    Ok(LoadedSource { source: Box::new(decoder), duration })
}
