import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Nimio from "@/nimio.js";
import { NimioLive } from "@/nimio-live";
import { NimioVod } from "@/nimio-vod";
import { EventBus } from "@/event-bus";
import { PlaybackContext } from "@/playback/context";
import { StateManager } from "@/state-manager";
import { IDX } from "@/shared/values";
import { PlaybackProgressService } from "@/playback/progress-service";
import { PlaybackProgressProxy } from "@/playback/progress-proxy";
import { SLDPManager } from "@/sldp/manager";
import { Reconnector } from "@/reconnector";
import { releaseInstances } from "@/shared/service";
import { MODE, STATE, ERROR } from "@/shared/values";

// The event sequence of a stop and of a URL change in VOD mode, pinned
// through the real facade, the real VOD engine's stop() and the real live
// engine's attach(), stop() and play(), on one real event bus and one real
// playback context. Only hls.js, the SLDP manager and the transport are
// stubbed. The fake-engine tests check the facade's calls; this one checks
// what an application and the UI hear, in order.

const NAME = "stop-events";
const OLD_LIVE = "wss://example.test/live/old";
const NEW_LIVE = "wss://example.test/live/new";
const OLD_VOD = "https://example.test/vod/old.m3u8";
const NEW_VOD = "https://example.test/vod/new.m3u8";

// liveMode: live playing with the UI, the VOD engine stopped after an
// archive of the old URL played (its levels in the context). realSldp: the
// real SLDP manager over a stubbed transport adapter (a kept-alive session
// whose status committed), instead of a manager stub.
function createPlayer({ liveMode = false, realSldp = false } = {}) {
  const bus = EventBus.getInstance(NAME);
  const context = PlaybackContext.getInstance(NAME);
  const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const ui = {
    mediaElement: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
    setDetached: vi.fn(),
    toggleMode: vi.fn(),
    showStopped: vi.fn(),
  };

  // one config object, shared by the facade and the live engine as in
  // the real player (setStreamURL() updates it in place); the VOD engine
  // holds its vod section the same way
  const config = {
    streamUrl: OLD_LIVE,
    startOffset: 0,
    vod: { url: OLD_VOD, adaptiveBitrate: {} },
  };

  // VOD engine: playing and attached (VOD mode) or stopped after playing
  // (live mode), its hls.js handler stubbed
  const vod = new NimioVod(NAME, undefined);
  vod._eventBus = bus;
  vod._logger = logger;
  vod._state = liveMode ? 4 : 3; // STOP : PLAY
  vod._metadataReady = true;
  vod._url = OLD_VOD;
  vod._config = config.vod;
  vod._ui = liveMode ? undefined : ui;
  vod._loadSourcePromise = Promise.resolve();
  vod._pHandler = {
    loadSource: vi.fn(),
    stopLoad: vi.fn(),
    pauseBuffering: vi.fn(),
    resumeBuffering: vi.fn(),
    attachMedia: vi.fn(() => vod._onMediaAttached()),
    detachMedia: vi.fn(() => vod._onMediaDetached()),
    on: vi.fn(),
    off: vi.fn(),
    destroy: vi.fn(),
  };
  vod._playbackService = {
    init: vi.fn(),
    resetPosition: vi.fn(),
    // the media element's position, as the real service reads it back
    setCurrentTime: vi.fn((time) => {
      vod._playbackService.currentTime = time;
    }),
    getCurrentTime: () => vod._playbackService.currentTime ?? 0,
    startPlayback: vi.fn(() => Promise.resolve()),
    clear: vi.fn(),
    state: STATE.PLAYING,
  };
  vod._audioCtrl = { reset: vi.fn() };
  vod._vuMeterSvc = { stop: vi.fn() };
  const progress = PlaybackProgressService.getInstance(NAME);
  progress._extProgressNotifier = { vodProgress: vi.fn() };
  vod._progressSvc = progress;
  if (liveMode) {
    // the old archive played: its levels, selection and duration are known
    context.setLevels(
      [{ url: ["https://example.test/vod/old/360p.m3u8?s=1"], height: 360 }],
      OLD_VOD,
    );
    context.setCurrentLevelIdx(0);
    context.updateCurrentLevel({ details: { totalduration: 10 } });
    vod._sessionParam = "s=1"; // the old archive's
    progress.updateVodPlaylistDuration(10);
    progress._extProgressNotifier.vodProgress.mockClear();
  }

  // live engine: in VOD mode detached and stopped by its detach for the
  // switch, the server session kept alive (connected transport); in live
  // mode attached and playing
  const live = Object.create(NimioLive.prototype);
  live._instName = NAME;
  live._config = config;
  live._logger = logger;
  live._eventBus = bus;
  live._context = context;
  // the real state manager over a plain buffer (one state at a time, as in
  // production); the methods are spied for the call-count assertions
  const idxCount = Object.values(IDX).reduce(
    (total, val) => total + (Array.isArray(val) ? val.length : 1),
    0,
  );
  live._state = new StateManager(
    new ArrayBuffer(Uint32Array.BYTES_PER_ELEMENT * idxCount),
    { shared: false, sendInit: false },
  );
  live._state.stop();
  vi.spyOn(live._state, "start");
  vi.spyOn(live._state, "stop");
  vi.spyOn(live._state, "pause");
  live._playGen = 0;
  live._autoplayTimers = [];
  live._latencyCtrl = { start: vi.fn(), pause: vi.fn() };
  live._isAutoAbr = () => false;
  live._cancelPauseTimeout = vi.fn();
  live._transport = {
    connected: true,
    connecting: false,
    setCallback: vi.fn(),
    runCallback: vi.fn(),
    send: vi.fn(),
  };
  if (realSldp) {
    live._sldpManager = new SLDPManager(NAME);
    live._sldpManager.init(live._transport, config);
    live._sldpManager._sessionReady = true; // the session's status committed
  } else {
    live._sldpManager = {
      start: vi.fn(),
      stop: vi.fn(),
      requestCurrentStreams: vi.fn(),
      keepAliveConnection: vi.fn(),
      sessionReady: true,
    };
  }
  live._reconnect = { stop: vi.fn(), reset: vi.fn(), pending: false };
  live._renderVideoFrame = () => {};
  live._resetPlayback = vi.fn();
  live._audioCtxProvider = { isSuspended: () => false };
  if (liveMode) {
    live._ui = ui;
    live._state.start();
    live._state.start.mockClear();
  }

  // facade
  const n = Object.create(Nimio.prototype);
  n._instName = NAME;
  n._logger = logger;
  n._eventBus = bus;
  n._context = context;
  n._ui = ui;
  n._config = config;
  n._livePlayer = live;
  n._vodPlayer = vod;
  n._playProgressSvc = progress;
  n._vodStartGen = 0;
  n._stopping = false;
  n._playAfterStop = false;
  n._actPlayer = liveMode ? live : vod;
  n._mode = liveMode ? MODE.LIVE : MODE.VOD;
  context.setState(STATE.PLAYING, false);

  const events = [];
  for (const name of [
    "nimio:playback-end",
    "nimio:play",
    "nimio:pause",
    "nimio:playback-error",
  ]) {
    bus.on(name, (e) => events.push([name, e.mode]));
  }
  bus.on("nimio:connection-started", (url) =>
    events.push(["nimio:connection-started", url]),
  );
  return { n, live, vod, ui, bus, context, progress, events };
}

async function microtasks(n = 6) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

// the connection drops through the real disconnect handler: the engine
// is stopped, the socket is gone and a retry is pending; the application
// and the UI still see what the player was doing before the drop
function droppedPlayer({ paused = false } = {}) {
  const player = createPlayer({ liveMode: true });
  const { live } = player;
  if (paused) live._state.pause();
  live._transport.connected = false;
  live._reconnect = new Reconnector(NAME, 3);
  live._playCb = () => live.play(); // the real retry
  live._sldpManager.resetRequestedStreams = vi.fn();
  live._onDisconnect({ code: 1006 });
  expect(live._reconnect.pending).toBe(true);
  return player;
}

describe("Nimio stop() and setStreamURL() in VOD mode: the event sequence", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    releaseInstances(NAME);
  });

  it("stop(): the VOD end event only; live takes the UI idle with the stopped look", () => {
    const { n, live, vod, ui, context, events } = createPlayer();

    n.stop();

    expect(events).toEqual([["nimio:playback-end", MODE.VOD]]);
    expect(vod._state).toBe(4); // STOP
    expect(vod._ui).toBeUndefined();
    expect(live._ui).toBe(ui);
    expect(ui.toggleMode).toHaveBeenCalledWith(MODE.LIVE, { capture: false });
    expect(ui.showStopped).toHaveBeenCalledTimes(1);
    expect(live._state.start).not.toHaveBeenCalled();
    // the kept-alive session is closed
    expect(live._sldpManager.stop).toHaveBeenCalledWith({
      closeConnection: true,
    });
    expect(context.state).toEqual({ value: STATE.STOPPED, initial: false });
    expect(n._mode).toBe(MODE.LIVE);
    expect(n._actPlayer).toBe(live);
  });

  it("setStreamURL(): the VOD end event, then one initial live play with the new URL", () => {
    const { n, live, vod, events } = createPlayer();

    n.setStreamURL(NEW_LIVE);

    expect(events).toEqual([
      ["nimio:playback-end", MODE.VOD],
      ["nimio:play", MODE.LIVE],
    ]);
    expect(vod._state).toBe(4);
    expect(live._state.start).toHaveBeenCalledTimes(1);
    expect(live._sldpManager.start).toHaveBeenCalledTimes(1);
    expect(live._sldpManager.start).toHaveBeenCalledWith(NEW_LIVE, 0);
    // the old session was closed before the new connection
    const closed = live._sldpManager.stop.mock.invocationCallOrder[0];
    const started = live._sldpManager.start.mock.invocationCallOrder[0];
    expect(closed).toBeLessThan(started);
    expect(n._mode).toBe(MODE.LIVE);
  });

  it("stop() with a play() from the VOD end-event listener: the same sequence as a URL change", () => {
    const { n, live, bus, events } = createPlayer();
    bus.on("nimio:playback-end", () => n.play());

    n.stop();

    expect(events).toEqual([
      ["nimio:playback-end", MODE.VOD],
      ["nimio:play", MODE.LIVE],
    ]);
    expect(live._sldpManager.start).toHaveBeenCalledTimes(1);
    expect(live._sldpManager.start).toHaveBeenCalledWith(OLD_LIVE, 0);
  });

  it("a second stop() after the first emits nothing", () => {
    const { n, events } = createPlayer();
    n.stop();
    events.length = 0;

    n.stop();

    expect(events).toEqual([]);
  });
});

describe("Nimio stop(): the SLDP session through the real manager", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    releaseInstances(NAME);
  });

  it("closes the kept-alive session, clears the session-ready flag, and the next play() handshakes anew", () => {
    const { n, live, events } = createPlayer({ realSldp: true });
    const transport = live._transport;

    n.stop();

    // the closing stop went out and the session's metadata is void
    expect(transport.send).toHaveBeenCalledWith("stop", {
      sns: [],
      close: true,
    });
    expect(live._sldpManager.sessionReady).toBe(false);
    expect(events).toEqual([["nimio:playback-end", MODE.VOD]]);

    transport.connected = false; // the worker reports the socket closed
    n.play();

    // an initial play: a new start, no play request on the old session
    const commands = transport.send.mock.calls.map((c) => c[0]);
    expect(commands.filter((c) => c === "start")).toHaveLength(1);
    expect(commands).not.toContain("play");
    expect(transport.send).toHaveBeenCalledWith(
      "start",
      expect.objectContaining({ url: OLD_LIVE }),
    );
    expect(events.slice(1)).toEqual([
      ["nimio:play", MODE.LIVE],
      ["nimio:connection-started", OLD_LIVE],
    ]);
  });
});

describe("Nimio: a pause() during a reconnect wait, then a failed seek into VOD", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    releaseInstances(NAME);
  });

  it("the rollback reports the playback end exactly once; a later stop() adds nothing", async () => {
    const { n, live, vod, events } = createPlayer({ liveMode: true });
    // the connection dropped: the engine is stopped, the socket is gone and
    // a retry is pending
    live._state.stop();
    live._transport.connected = false;
    live._reconnect = new Reconnector(NAME, 3);
    live._reconnect.schedule(() => {});
    expect(live._reconnect.pending).toBe(true);

    n.pause(); // cancels the retry, reports the pause
    expect(events).toEqual([["nimio:pause", MODE.LIVE]]);

    // a seek into VOD whose attach never completes (no MEDIA_ATTACHED)
    vod._pHandler.attachMedia = vi.fn();
    expect(n.seekVod(30)).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(n._mode).toBe(MODE.PEND);
    await vi.advanceTimersByTimeAsync(5000); // the switch times out

    expect(n._mode).toBe(MODE.LIVE);
    expect(events).toEqual([
      ["nimio:pause", MODE.LIVE],
      ["nimio:playback-error", MODE.VOD],
      ["nimio:playback-end", MODE.LIVE],
    ]);

    n.stop();

    const ends = events.filter(([name]) => name === "nimio:playback-end");
    expect(ends).toHaveLength(1);
  });
});

describe("Nimio: a seek into VOD during a reconnect wait", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    releaseInstances(NAME);
  });

  it("opens the VOD playing, as the player was playing a moment ago", async () => {
    const { n, vod, context, events } = droppedPlayer();

    expect(n.seekVod(30)).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(n._mode).toBe(MODE.VOD);
    expect(context.state).toEqual({ value: STATE.PLAYING, initial: false });

    vod._onManifestParsed(null, {
      levels: [
        { url: ["https://example.test/vod/new/360p.m3u8?s=9"], height: 360 },
      ],
    });
    vod._onLevelLoaded(null, {
      details: { totalduration: 120, fragments: [] },
    });
    await vi.advanceTimersByTimeAsync(10);

    expect(vod._pHandler.resumeBuffering).toHaveBeenCalledTimes(1);
    expect(vod._playbackService.startPlayback).toHaveBeenCalledTimes(1);
    expect(events).toEqual([]); // no end event: the playback goes on, in VOD
  });

  it("a player paused before the drop opens the VOD paused, as the base did", async () => {
    // the last user action was pause; the retry would have resumed live
    // later (base behaviour), but the seek cancels it, and the archive must
    // not start on its own
    const { n, vod, context, events } = droppedPlayer({ paused: true });

    expect(n.seekVod(30)).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(n._mode).toBe(MODE.VOD);
    // the engine's own state: the rollback's end event comes from the
    // unreported-end snapshot, not from a paused one
    expect(context.state.value).toBe(STATE.STOPPED);

    vod._onManifestParsed(null, {
      levels: [
        { url: ["https://example.test/vod/new/360p.m3u8?s=9"], height: 360 },
      ],
    });
    vod._onLevelLoaded(null, {
      details: { totalduration: 120, fragments: [] },
    });
    await vi.advanceTimersByTimeAsync(10);

    expect(vod._playbackService.startPlayback).not.toHaveBeenCalled();
    expect(vod._pHandler.resumeBuffering).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("a player paused before the drop: a timed-out switch ends stopped with the switch error, then the end event", async () => {
    // the seek cancelled the retry that was the pending end; the
    // application last heard a pause and now hears the end, once
    const { n, live, vod, events } = droppedPlayer({ paused: true });
    vod._pHandler.attachMedia = vi.fn(); // no MEDIA_ATTACHED

    expect(n.seekVod(30)).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(5000);

    expect(n._mode).toBe(MODE.LIVE);
    expect(live._state.start).not.toHaveBeenCalled();
    expect(events).toEqual([
      ["nimio:playback-error", MODE.VOD],
      ["nimio:playback-end", MODE.LIVE],
    ]);

    n.stop();
    expect(events).toHaveLength(2);
  });

  it("a timed-out switch restarts live (an immediate retry), with the switch error only", async () => {
    const { n, live, vod, events } = droppedPlayer();
    vod._pHandler.attachMedia = vi.fn(); // no MEDIA_ATTACHED

    expect(n.seekVod(30)).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(n._mode).toBe(MODE.PEND);
    await vi.advanceTimersByTimeAsync(5000);

    expect(n._mode).toBe(MODE.LIVE);
    expect(live._state.start).toHaveBeenCalledTimes(1);
    expect(live._sldpManager.start).toHaveBeenCalledWith(OLD_LIVE, 0);
    expect(events).toEqual([["nimio:playback-error", MODE.VOD]]);
  });
});

describe("Nimio: a play() during a reconnect wait", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    releaseInstances(NAME);
  });

  it("is the reconnect: the pending retry is cancelled and no end is left unreported", async () => {
    // the stale timer would spend an attempt on a player that is already
    // playing, and until it fired the engine would claim an unreported end
    const { n, live, events } = droppedPlayer();

    n.play();

    expect(live._reconnect.pending).toBe(false);
    expect(live.hasUnreportedEnd()).toBe(false);
    expect(live._sldpManager.start).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);

    expect(live._reconnect._done).toBe(0);
    expect(live._sldpManager.start).toHaveBeenCalledTimes(1);
    expect(events).toEqual([["nimio:play", MODE.LIVE]]);
  });
});

describe("Nimio: a startup VOD failover whose switch to VOD fails", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    releaseInstances(NAME);
  });

  it("reports the switch error, then NO_SRC, and leaves both engines stopped", async () => {
    // the server rejects the stream through the real status handler, the
    // facade starts the archive instead, and the archive never attaches
    const { n, live, vod, ui, bus } = createPlayer({ liveMode: true });
    n._config.vod.startupVodFailover = true;
    // the facade's own subscription, made by its constructor
    bus.on("aux:playback-error", (data) =>
      n._onLivePlaybackError(data.type, !data.stop),
    );
    const errors = [];
    bus.on("nimio:playback-error", (e) => errors.push([e.error, e.mode]));
    const others = [];
    for (const name of ["nimio:playback-end", "nimio:play", "nimio:pause"]) {
      bus.on(name, () => others.push(name));
    }
    vod._pHandler.attachMedia = vi.fn(); // no MEDIA_ATTACHED

    live._onInvalidStatus();
    await vi.advanceTimersByTimeAsync(10);
    expect(n._mode).toBe(MODE.PEND);
    expect(errors).toEqual([]); // the failover is trying the archive
    await vi.advanceTimersByTimeAsync(5000); // the switch times out

    expect(errors).toEqual([
      [ERROR.MODE_SWITCH, MODE.VOD],
      [ERROR.NO_SRC, MODE.LIVE],
    ]);
    expect(others).toEqual([]);
    // live holds the UI again without playing; the archive is not polled
    expect(n._mode).toBe(MODE.LIVE);
    expect(live._ui).toBe(ui);
    expect(live._state.start).not.toHaveBeenCalled();
    expect(vod._state).toBe(4); // STOP
    expect(
      vod._pHandler.stopLoad.mock.invocationCallOrder.at(-1),
    ).toBeGreaterThan(vod._pHandler.loadSource.mock.invocationCallOrder.at(-1));
  });
});

describe("Nimio setStreamURL() in live mode, then a seek into the new archive before the connection is established", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    releaseInstances(NAME);
  });

  it("start, attach and manifest come from the new archive; the old one is never requested", async () => {
    const { n, live, vod, ui, context, progress, events } = createPlayer({
      liveMode: true,
    });
    const requested = () =>
      vod._pHandler.loadSource.mock.calls.map((c) => c[0]);

    n.setStreamURL({ live: NEW_LIVE, vod: NEW_VOD });

    // the live engine restarted with the new URL; the stopped VOD engine
    // was stopped again (nothing to load yet); the old archive's duration
    // is forgotten at once
    expect(events).toEqual([
      ["nimio:playback-end", MODE.LIVE],
      ["nimio:play", MODE.LIVE],
    ]);
    expect(live._sldpManager.start).toHaveBeenLastCalledWith(NEW_LIVE, 0);
    expect(requested()).toEqual([]);
    expect(progress._extProgressNotifier.vodProgress).toHaveBeenCalledWith(
      0,
      0,
    );
    expect(progress._vodPlaylistDuration).toBe(0);
    progress._extProgressNotifier.vodProgress.mockClear();

    // a seek before nimio:connection-established of the new URL
    expect(n.seekVod(30)).toBe(true);
    await microtasks();

    // the reload loaded the new master playlist without the old session
    // parameter (it made no duration reset of its own: the URL change had
    // already forgotten the source), and the attach requested the new URL
    // at the position
    expect(n._mode).toBe(MODE.VOD);
    expect(vod._url).toBe(NEW_VOD);
    expect(requested()).toEqual([NEW_VOD, NEW_VOD]); // no "?s=1", no old URL
    expect(progress._extProgressNotifier.vodProgress).not.toHaveBeenCalled();
    expect(vod._playbackService.setCurrentTime).toHaveBeenCalledWith(30);
    expect(vod._ui).toBe(ui);
    expect(live._ui).toBeUndefined();

    // the new master manifest replaces the old archive's levels
    vod._onManifestParsed(null, {
      levels: [
        { url: ["https://example.test/vod/new/360p.m3u8?s=9"], height: 360 },
        { url: ["https://example.test/vod/new/720p.m3u8?s=9"], height: 720 },
      ],
    });

    expect(context.levelsSourceUrl).toBe(NEW_VOD);
    expect(context.getCurrentLevel().data.url[0]).toContain("/new/");
    expect(context.getCurrentLevel().data.details).toBeUndefined();
    expect(vod._sessionParam).toBe("s=9");
    expect(progress._vodPlaylistDuration).toBe(0); // no old duration republished

    // the new variant playlist brings the duration; live was playing, so
    // the VOD plays
    vod._onLevelLoaded(null, {
      details: { totalduration: 120, fragments: [] },
    });
    await microtasks();

    expect(progress._vodPlaylistDuration).toBe(120);
    expect(progress._extProgressNotifier.vodProgress).toHaveBeenLastCalledWith(
      0,
      120,
    );
    expect(vod._pHandler.resumeBuffering).toHaveBeenCalledTimes(1);
    expect(vod._playbackService.startPlayback).toHaveBeenCalledTimes(1);
    expect(context.state).toEqual({ value: STATE.PLAYING, initial: false });
    expect(events).toHaveLength(2); // no error, no further end event
  });
});

describe("Nimio: a seek into the archive after its first load failed", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn());
    vi.stubGlobal("Hls", {
      ErrorTypes: { NETWORK_ERROR: "networkError", MEDIA_ERROR: "mediaError" },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    releaseInstances(NAME);
  });

  // live plays; the VOD engine warmed up in the background (SYNC, which
  // counts as running) and a fatal network error ended its load before the
  // variant playlist arrived: no duration is known, the URL is forgotten.
  // Seeks of a running engine go through the progress proxy.
  function failedWarmUp() {
    const player = createPlayer({ liveMode: true });
    const { n, vod, bus, context, progress } = player;
    vod._state = 2; // SYNC
    vod._metadataReady = false;
    // a first load: no levels, no session parameter, no duration
    context.setLevels([], OLD_VOD);
    vod._sessionParam = undefined;
    progress.resetVodDuration();
    n._playProgressProxy = new PlaybackProgressProxy(bus, progress);
    progress.positionChangeCb = n._onPlaybackPositionChange.bind(n);
    const vodProgress = [];
    bus.on("nimio:vod-progress", (e) =>
      vodProgress.push([e.position, e.duration]),
    );

    vod._onError(null, { fatal: true, type: "networkError" });
    expect(vod._url).toBeUndefined();
    expect(vod.isRunning()).toBe(true);
    return { ...player, vodProgress };
  }

  it("reloads the master playlist and switches to VOD, with no switch error", () => {
    const { n, vod, ui, events } = failedWarmUp();

    expect(n.seekVod(30)).toBe(true);

    expect(n._mode).toBe(MODE.VOD);
    expect(vod._ui).toBe(ui);
    expect(vod._url).toBe(OLD_VOD);
    expect(vod._pHandler.loadSource.mock.calls).toEqual([[OLD_VOD]]);
    expect(vod._playbackService.setCurrentTime).toHaveBeenCalledWith(30);
    expect(events).toEqual([]);
  });

  it("a target beyond the end is validated when the playlist arrives", () => {
    const { n, vod, vodProgress } = failedWarmUp();

    expect(n.seekVod(500)).toBe(true);
    expect(vod._playbackService.setCurrentTime).toHaveBeenLastCalledWith(500);

    vod._onManifestParsed(null, {
      levels: [
        { url: ["https://example.test/vod/old/360p.m3u8?s=2"], height: 360 },
      ],
    });
    vod._onLevelLoaded(null, {
      details: { totalduration: 120, fragments: [] },
    });

    expect(vod._playbackService.setCurrentTime).toHaveBeenLastCalledWith(120);
    expect(vodProgress).toEqual([[120, 120]]);
  });
});

describe("Nimio: a stream URL change from inside a playlist callback of the old archive", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    releaseInstances(NAME);
  });

  // live plays, the old archive is known and the VOD engine reloads its
  // variant playlist in the background (SYNC). hls.js delivers that
  // response as MANIFEST_PARSED and then LEVEL_LOADED; the first publishes
  // the duration, and a nimio:vod-progress listener changes the stream URL
  // right there. A stopLoad() from inside the callback does not stop the
  // rest of the same response.
  function urlChangeDuringReload() {
    const player = createPlayer({ liveMode: true });
    const { n, vod, progress } = player;
    vod._state = 2; // SYNC
    vod._metadataReady = true;
    const reported = [];
    let change = true;
    progress._extProgressNotifier.vodProgress = vi.fn((position, duration) => {
      reported.push([position, duration]);
      if (change && duration > 0) {
        change = false;
        n.setStreamURL({ live: NEW_LIVE, vod: NEW_VOD });
      }
    });
    const oldVariant = {
      url: ["https://example.test/vod/old/360p.m3u8?s=1"],
      height: 360,
      details: { totalduration: 10, fragments: [] },
    };

    vod._onManifestParsed(null, { levels: [oldVariant] });
    expect(reported).toEqual([
      [0, 10],
      [0, 0],
    ]);
    expect(vod._config.url).toBe(NEW_VOD);
    vod._pHandler.stopLoad.mockClear();
    vod._onLevelLoaded(null, { details: oldVariant.details });
    return { ...player, reported };
  }

  it("the rest of that response does not bring the old duration back, and its loading is stopped", () => {
    const { vod, progress, reported } = urlChangeDuringReload();

    expect(reported).toEqual([
      [0, 10],
      [0, 0],
    ]);
    expect(progress._vodPlaylistDuration).toBe(0);
    // hls.js re-enables loading after a manifest it delivered
    expect(vod._pHandler.stopLoad).toHaveBeenCalledTimes(1);
  });

  it("the reload of the new archive that follows is still taken", async () => {
    const { vod, context, progress, reported } = urlChangeDuringReload();

    await vod.initialize(); // the next nimio:connection-established
    expect(vod._pHandler.loadSource).toHaveBeenLastCalledWith(NEW_VOD);
    vod._onManifestParsed(null, {
      levels: [
        { url: ["https://example.test/vod/new/360p.m3u8?s=9"], height: 360 },
      ],
    });
    vod._onLevelLoaded(null, {
      details: { totalduration: 120, fragments: [] },
    });

    expect(context.levelsSourceUrl).toBe(NEW_VOD);
    expect(vod._metadataReady).toBe(true);
    expect(progress._vodPlaylistDuration).toBe(120);
    expect(reported.at(-1)).toEqual([0, 120]);
  });
});

describe("Nimio: the VOD URL changed and changed back before the archive reloads", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    releaseInstances(NAME);
  });

  it("the archive is loaded again at the next live connection, and its duration comes back", async () => {
    // the first change dropped the durations; the engine still held the
    // archive as loaded and would load nothing, leaving the seek bar
    // without its archive part for good
    const { n, vod, progress } = createPlayer({ liveMode: true });
    expect(progress._vodPlaylistDuration).toBe(10);

    n.setStreamURL({ live: NEW_LIVE, vod: NEW_VOD });
    n.setStreamURL({ live: OLD_LIVE, vod: OLD_VOD });
    expect(progress._vodPlaylistDuration).toBe(0);

    await vod.initialize(); // nimio:connection-established
    expect(vod._pHandler.loadSource.mock.calls).toEqual([[OLD_VOD]]);
    vod._onManifestParsed(null, {
      levels: [
        { url: ["https://example.test/vod/old/360p.m3u8?s=5"], height: 360 },
      ],
    });
    vod._onLevelLoaded(null, {
      details: { totalduration: 10, fragments: [] },
    });

    expect(progress._vodPlaylistDuration).toBe(10);
    expect(vod._sessionParam).toBe("s=5");
  });

  it("a second URL change, after the first one's archive loaded, drops its duration too", async () => {
    // a change is not the only one of the player's life: the facade must
    // be as ready to tell after the first as before it
    const { n, vod, progress } = createPlayer({ liveMode: true });
    n.setStreamURL({ live: NEW_LIVE, vod: NEW_VOD });
    await vod.initialize(); // nimio:connection-established of the new URL
    vod._onManifestParsed(null, {
      levels: [
        { url: ["https://example.test/vod/new/360p.m3u8?s=9"], height: 360 },
      ],
    });
    vod._onLevelLoaded(null, {
      details: { totalduration: 120, fragments: [] },
    });
    expect(progress._vodPlaylistDuration).toBe(120);
    progress._extProgressNotifier.vodProgress.mockClear();

    n.setStreamURL({ live: OLD_LIVE, vod: OLD_VOD });

    expect(progress._vodPlaylistDuration).toBe(0);
    expect(progress._extProgressNotifier.vodProgress).toHaveBeenCalledWith(
      0,
      0,
    );
  });

  // the engine was warm (SYNC) on the old archive when the URL changed, and
  // a listener of the duration reset seeks: the seek must open the new
  // archive, not attach what the engine still knew, and the live engine
  // must do what the URL change alone makes it do (restart when playing,
  // nothing when stopped). The branch of the change is decided by the
  // mode, which the seek must not have changed before.
  function warmEngineWithSeekingListener({
    livePlaying = false,
    vodMode = false,
  }) {
    const { n, live, vod, bus, progress, events } = createPlayer({
      liveMode: !vodMode,
    });
    const requested = () =>
      vod._pHandler.loadSource.mock.calls.map((c) => c[0]);
    if (!livePlaying) live._state.stop();
    if (vodMode) {
      progress.updateVodPlaylistDuration(10); // the playing archive's
    } else {
      vod._state = 2; // SYNC
    }
    // the application listens through the real proxy, as in production
    n._playProgressProxy = new PlaybackProgressProxy(bus, progress);
    progress.positionChangeCb = n._onPlaybackPositionChange.bind(n);
    let seek = true;
    bus.on("nimio:vod-progress", ({ duration }) => {
      events.push(["nimio:vod-progress", duration]);
      if (seek && duration === 0) {
        seek = false;
        n.seekVod(30);
      }
    });
    return { n, live, vod, bus, progress, events, requested };
  }

  it("a seek from the listener of the duration reset opens the new archive, after the live restart", async () => {
    const { n, live, vod } = warmEngineWithSeekingListener({
      livePlaying: true,
    });

    n.setStreamURL({ live: NEW_LIVE, vod: NEW_VOD });
    await microtasks();

    // one restart, by the URL change; the seek then switched to the archive
    expect(live._sldpManager.start.mock.calls).toEqual([[NEW_LIVE, 0]]);
    expect(live._sldpManager.start.mock.invocationCallOrder[0]).toBeLessThan(
      vod._pHandler.attachMedia.mock.invocationCallOrder[0],
    );
    // the reload's master and the attach's master, both of the new archive
    const requested = vod._pHandler.loadSource.mock.calls.map((c) => c[0]);
    expect(requested).toEqual([NEW_VOD, NEW_VOD]);
    expect(vod._url).toBe(NEW_VOD);
    expect(n._mode).toBe(MODE.VOD);
  });

  it("a seek from the listener of the duration reset on a stopped player opens the new archive, live stays stopped", async () => {
    const { n, live, vod, events } = warmEngineWithSeekingListener({
      livePlaying: false,
    });

    n.setStreamURL({ live: NEW_LIVE, vod: NEW_VOD });
    await microtasks();

    // nobody asked for live playback: a stopped player keeps the new URL
    // for its next play()
    expect(live._sldpManager.start).not.toHaveBeenCalled();
    expect(events).not.toContainEqual(["nimio:play", MODE.LIVE]);
    // the reload's master and the attach's master, both of the new archive
    const requested = vod._pHandler.loadSource.mock.calls.map((c) => c[0]);
    expect(requested).toEqual([NEW_VOD, NEW_VOD]);
    expect(vod._url).toBe(NEW_VOD);
    expect(n._mode).toBe(MODE.VOD);
  });

  it("in VOD mode a seek from the listener of the duration reset opens the new archive after the stop and the live start", async () => {
    // the archive was playing: the change stops it and starts live anew;
    // the listener is told then, and its seek opens the new archive
    const { n, live, vod, events } = warmEngineWithSeekingListener({
      vodMode: true,
    });

    n.setStreamURL({ live: NEW_LIVE, vod: NEW_VOD });
    const told = events.length;
    await microtasks();

    expect(events.slice(0, told)).toEqual([
      ["nimio:playback-end", MODE.VOD],
      ["nimio:play", MODE.LIVE],
      ["nimio:vod-progress", 0],
    ]);
    expect(live._sldpManager.start.mock.calls).toEqual([[NEW_LIVE, 0]]);
    // the reload's master and the attach's master, both of the new archive
    const requested = vod._pHandler.loadSource.mock.calls.map((c) => c[0]);
    expect(requested).toEqual([NEW_VOD, NEW_VOD]);
    expect(vod._url).toBe(NEW_VOD);
    expect(n._mode).toBe(MODE.VOD);
  });

  it("in VOD mode a URL change from the playback-end listener of the change is told after the stop and the live start too", async () => {
    // the nested change runs inside the stop: told at once, the listener
    // of the reset would find the player still stopping and its seek refused
    const NEWER_LIVE = "wss://example.test/live/newer";
    const NEWER_VOD = "https://example.test/vod/newer.m3u8";
    const { n, live, vod, bus, events } = warmEngineWithSeekingListener({
      vodMode: true,
    });
    bus.on("nimio:playback-end", () => {
      n.setStreamURL({ live: NEWER_LIVE, vod: NEWER_VOD });
    });

    n.setStreamURL({ live: NEW_LIVE, vod: NEW_VOD });
    const told = events.length;
    await microtasks();

    expect(events.slice(0, told)).toEqual([
      ["nimio:playback-end", MODE.VOD],
      ["nimio:play", MODE.LIVE],
      ["nimio:vod-progress", 0],
    ]);
    expect(live._sldpManager.start.mock.calls).toEqual([[NEWER_LIVE, 0]]);
    // the reload's master and the attach's master, both of the newest archive
    const requested = vod._pHandler.loadSource.mock.calls.map((c) => c[0]);
    expect(requested).toEqual([NEWER_VOD, NEWER_VOD]);
    expect(vod._url).toBe(NEWER_VOD);
    expect(n._mode).toBe(MODE.VOD);
  });

  it("in live mode a URL change from the playback-end listener of the live restart is told after the restart too", async () => {
    // the live engine's own stop and play make up its URL change: the
    // nested change is told after the outer one is done, by the outer one
    const NEWER_LIVE = "wss://example.test/live/newer";
    const NEWER_VOD = "https://example.test/vod/newer.m3u8";
    const { n, live, vod, bus, events } = warmEngineWithSeekingListener({
      livePlaying: true,
    });
    bus.on("nimio:playback-end", () => {
      n.setStreamURL({ live: NEWER_LIVE, vod: NEWER_VOD });
    });

    n.setStreamURL({ live: NEW_LIVE, vod: NEW_VOD });
    const told = events.length;
    await microtasks();

    expect(events.slice(0, told)).toEqual([
      ["nimio:playback-end", MODE.LIVE],
      ["nimio:play", MODE.LIVE],
      ["nimio:vod-progress", 0],
    ]);
    expect(live._sldpManager.start.mock.calls).toEqual([[NEWER_LIVE, 0]]);
    // the reload's master and the attach's master, both of the newest archive
    const requested = vod._pHandler.loadSource.mock.calls.map((c) => c[0]);
    expect(requested).toEqual([NEWER_VOD, NEWER_VOD]);
    expect(vod._url).toBe(NEWER_VOD);
    expect(n._mode).toBe(MODE.VOD);
  });

  it("in live mode a stop() from the playback-end listener of the live restart does not tell: the change does, after its play", async () => {
    // told by the stop, a listener's seek would open the archive while the
    // restart's play is still to come
    const { n, live, bus, events, requested } = warmEngineWithSeekingListener({
      livePlaying: true,
    });
    bus.on("nimio:playback-end", () => n.stop());

    n.setStreamURL({ live: NEW_LIVE, vod: NEW_VOD });
    const told = events.length;
    await microtasks();

    expect(events.slice(0, told)).toEqual([
      ["nimio:playback-end", MODE.LIVE],
      ["nimio:play", MODE.LIVE],
      ["nimio:vod-progress", 0],
    ]);
    expect(live._sldpManager.start.mock.calls).toEqual([[NEW_LIVE, 0]]);
    expect(requested()).toEqual([NEW_VOD, NEW_VOD]);
    expect(n._mode).toBe(MODE.VOD);
  });

  it("a URL change from the playback-end listener of a stop() is told after the stop, which stays a stop", async () => {
    const { n, live, bus, events, requested } = warmEngineWithSeekingListener({
      vodMode: true,
    });
    bus.on("nimio:playback-end", () => {
      n.setStreamURL({ live: NEW_LIVE, vod: NEW_VOD });
    });

    n.stop();
    const told = events.length;
    await microtasks();

    // no live play: nobody asked for one; the seek opens the new archive
    expect(events.slice(0, told)).toEqual([
      ["nimio:playback-end", MODE.VOD],
      ["nimio:vod-progress", 0],
    ]);
    expect(live._sldpManager.start).not.toHaveBeenCalled();
    expect(requested()).toEqual([NEW_VOD, NEW_VOD]);
    expect(n._mode).toBe(MODE.VOD);
  });

  it("a stop() after a URL change keeps the new archive's duration: the change was told once", async () => {
    const { n, vod, progress, events } = warmEngineWithSeekingListener({
      livePlaying: true,
    });
    n.setStreamURL({ live: NEW_LIVE, vod: NEW_VOD });
    await microtasks(); // the seek from the reset's listener opens the new archive
    vod._onManifestParsed(null, {
      levels: [{ url: ["https://example.test/vod/new/360p.m3u8?s=9"] }],
    });
    vod._onLevelLoaded(null, {
      details: { totalduration: 120, fragments: [] },
    });
    events.length = 0;

    n.stop();

    expect(events).toEqual([["nimio:playback-end", MODE.VOD]]);
    expect(progress._vodPlaylistDuration).toBe(120);
  });
});
