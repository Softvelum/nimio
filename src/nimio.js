import { ScriptPathProvider } from "./shared/script-path-provider";
import { EventBus } from "./event-bus";
import { MODE, ERROR, STATE } from "./shared/values";
import { UI } from "./ui/ui";
import { NimioLive } from "./nimio-live";
import { NimioVod } from "./nimio-vod";
import { NimioEvents } from "./nimio-events";
import { NimioVolume } from "./nimio-volume";
import { NimioExtAPI } from "./nimio-ext-api";
import { createConfig, updateConfigStreamURL } from "./player-config";
import { resolveContainer } from "./shared/container";
import { PlaybackContext } from "./playback/context";
import { PlaybackProgressService } from "./playback/progress-service";
import { PlaybackProgressProxy } from "./playback/progress-proxy";
import { VUMeterService } from "./vumeter/service";
import { LoggersFactory } from "./shared/logger";
import { AudioVolumeController } from "./audio/volume-controller";
import { allocateInstanceKey, releaseInstances } from "./shared/service";
import { PlaybackThumbnailService } from "./playback/thumbnail-service";
import { SPSHolder } from "./sps/holder";
import { runCleanupSteps } from "./shared/helpers";

let scriptPath;
if (document.currentScript === null) {
  // Javascript module
  scriptPath = import.meta.url;
} else if (document.currentScript) {
  // Javascript library
  scriptPath = document.currentScript.src;
}
if (scriptPath) {
  scriptPath = scriptPath.substr(0, scriptPath.lastIndexOf("/") + 1);
}

// Upper bound for a live<->VOD switch to complete. hls.js reports media
// attached only after the MediaSource "sourceopen" event, which never comes
// when MSE is unavailable or the media element is broken.
const MODE_SWITCH_TIMEOUT_MS = 5000;

export default class Nimio {
  constructor(options) {
    if (options && !options.instanceName) {
      options.instanceName = "nimio_" + (Math.floor(Math.random() * 10000) + 1);
    }
    // Registry key of the per-instance services, unique per player
    this._instName = allocateInstanceKey(options.instanceName);
    try {
      this._init(options);
    } catch (err) {
      // a failed construction must leave neither DOM, engines nor the key
      this._rollbackInit();
      throw err;
    }
  }

  _rollbackInit() {
    runCleanupSteps(this._logger || console, "Nimio init rollback", [
      ["VOD player", () => this._vodPlayer?.destroy()],
      ["live player", () => this._livePlayer?.destroy()],
      ["VU meter", () => this._vuMeterSvc?.clear()],
      ["UI", () => this._ui?.destroy()],
      ["services", () => releaseInstances(this._instName)],
    ]);
    this._vodPlayer = this._livePlayer = this._ui = undefined;
    this._vuMeterSvc = undefined;
    this._destroyed = true;
  }

  _init(options) {
    ScriptPathProvider.getInstance(this._instName).setScriptPath(scriptPath);
    this._eventBus = EventBus.getInstance(this._instName);

    this._config = createConfig(options);
    this._logger = LoggersFactory.create(this._instName, "Nimio");
    this._logger.debug("Nimio " + this.version());

    const { element: containerElem, storageKey } = resolveContainer(
      this._config.container,
      { logger: this._logger, fallbackId: options.instanceName },
    );
    this._config.container = containerElem;
    this._config.volumeId = storageKey;

    this._ui = new UI(
      this._instName,
      this._config.container,
      {
        width: this._config.width,
        height: this._config.height,
        metricsOverlay: this._config.metricsOverlay,
        abrEnabled: !!this._config.adaptiveBitrate,
        fullscreen: !!this._config.fullscreen && !this._config.audioOnly,
        splashScreen: this._config.splashScreen,
        audioOnly: this._config.audioOnly,
        offscreenCanvas: this._config.offscreenCanvas,
        screenshots: this._config.screenshots,
        vod: this._config.vod,
        captions: this._config.captions,
        ar: this._config.aspectRatio,
      },
      this._eventBus,
    );

    this._context = PlaybackContext.getInstance(this._instName);
    this._audioVolumeCtrl = AudioVolumeController.getInstance(this._instName);
    this._addVolumeEventHandlers();
    this._createVUMeter();

    this._livePlayer = new NimioLive(this._instName, this._ui, this._config);
    if (this._config.vod) {
      this._vodPlayer = new NimioVod(this._instName, this._config.vod);
      this._eventBus.on("nimio:connection-established", this._onLiveConnected);
    }

    this._actPlayer = this._livePlayer;
    this._mode = MODE.LIVE;
    this._vodStartGen = 0; // voids VOD starts that resolve after a stop
    this._idleRestore = null; // a failed switch whose final notice is owed
    this._stopping = false; // re-entrancy guard for stop()
    this._playAfterStop = false; // a play() asked for while stopping
    this._urlChanging = false; // re-entrancy mark for setStreamURL()
    this._vodResetOwed = false; // a VOD URL change the application is not told of yet
    this._eventBus.on("aux:playback-error", this._onError);

    this._playProgressSvc = PlaybackProgressService.getInstance(this._instName);
    this._playProgressSvc.positionChangeCb =
      this._onPlaybackPositionChange.bind(this);
    this._playProgressProxy = new PlaybackProgressProxy(
      this._eventBus,
      this._playProgressSvc,
    );
    this._thumbnailSvc = PlaybackThumbnailService.getInstance(this._instName);
    if (this._config.timecodes || this._config.captions) {
      this._spsHolder = SPSHolder.getInstance(this._instName);
    }
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    // a listener invoked during the teardown (e.g. nimio:playback-end from
    // the live stop) must not be able to restart or steer the engines
    this._actPlayer = undefined;

    // every component is torn down independently: one failure must not
    // leave the others running, and the key is always released
    const errors = runCleanupSteps(this._logger, "destroy", [
      ["mode switch", () => this._cancelModeSwitch()],
      ["UI", () => this._ui.destroy()],
      ["volume handlers", () => this._removeVolumeEventHandlers()],
      ["VU meter", () => this._vuMeterSvc.clear()],
      ["VOD player", () => this._vodPlayer?.destroy()],
      ["live player", () => this._livePlayer.destroy()],
      [
        "listeners",
        () => {
          this._eventBus.off(
            "nimio:connection-established",
            this._onLiveConnected,
          );
          this._eventBus.off("aux:playback-error", this._onError);
        },
      ],
      // last, as live and VOD players share services (e.g. AudioContext);
      // the event bus release also drops the application's listeners
      ["services", () => releaseInstances(this._instName)],
    ]);

    this._ui = undefined;
    this._vodPlayer = undefined;
    this._livePlayer = undefined;
    this._actPlayer = undefined;
    this._eventBus = undefined;
    this._context = undefined;
    this._vuMeterSvc = undefined;
    this._playProgressSvc = undefined;
    this._playProgressProxy = undefined;
    this._thumbnailSvc = undefined;
    this._audioVolumeCtrl = undefined;
    this._spsHolder = undefined;

    if (errors.length) throw errors[0];
  }

  setParameters(params) {
    if (this._destroyed) return;
    this._livePlayer?.setParameters(params);
  }

  play() {
    if (this._destroyed) return;
    if (this._stopping) {
      // from a listener of the VOD end event of a stop in progress: the VOD
      // engine still holds the UI, so the play runs as the stop's last step
      this._playAfterStop = true;
      return;
    }
    // from the error listener of a failed switch: the application restarts
    // the player itself, and the notice an idle restore still owes it (the
    // playback end, or NO_SRC) would arrive on the new playback
    this._idleRestore = null;
    this._actPlayer?.play();
  }

  setStreamURL(url) {
    if (this._destroyed) return;
    const prevVodUrl = this._config.vod?.url;
    updateConfigStreamURL(this._config, url);
    const vodUrlChanged = this._config.vod?.url !== prevVodUrl;
    // the engine knows the old archive: it must load the configured one
    // anew, also when the URL changes back before any reload; the known
    // durations are the old archive's, dropped when the change is done
    if (vodUrlChanged) {
      this._vodPlayer?.forgetSource();
      this._vodResetOwed = true;
    }
    // re-entrant from a listener of a stop in progress: the outer call
    // continues with the newest config, and the stop, or the URL change it
    // belongs to, tells the application
    if (this._stopping) return;
    // re-entrant from a listener of the live restart of a URL change in
    // progress: the engines take the newest URLs now, the outer call tells
    const nested = this._urlChanging;
    this._urlChanging = true;
    try {
      if (this._mode === MODE.LIVE) {
        if (vodUrlChanged) {
          // a pending VOD start would attach the old URL; a running engine
          // re-initialises with the new URL on the next
          // nimio:connection-established and must not be attachable before;
          // the engine stop also cancels a queued reload
          this._vodStartGen++;
          this._vodPlayer?.stop();
        }
        // playing: stop + play; paused: stop; stopped: nothing (#98)
        this._livePlayer.setStreamURL();
        return;
      }
      // VOD mode or a pending switch: stop (VOD stopped, live idle with the
      // UI, kept-alive session closed, context reset), then an initial live
      // play with the new URL, performed by the stop as its last step. One
      // connection; no path back to the old archive.
      this._playAfterStop = true;
      this.stop();
    } finally {
      // told last, in every branch, by the outermost call: the
      // application's listener finds the engines done with the change (its
      // seek opens the new archive from the stopped engine), also when a
      // listener of the engines' own events threw
      if (!nested) {
        this._urlChanging = false;
        this._tellVodReset();
      }
    }
  }

  // Drops the durations a VOD URL change left stale, once: the one event
  // of the change the application gets from the player itself.
  _tellVodReset() {
    if (!this._vodResetOwed) return;
    this._vodResetOwed = false;
    if (!this._destroyed) this._playProgressSvc.resetVodDuration();
  }

  pause() {
    if (this._destroyed || this._stopping) return;
    this._actPlayer?.pause();
  }

  stop() {
    if (this._destroyed || this._stopping) return;
    this._stopping = true;
    try {
      // a switch in flight cannot complete into a stopped player; settle it
      // silently (no error: the stop is what the application asked for)
      this._cancelModeSwitch();
      // a VOD start still waiting for hls.js must not switch to VOD later
      this._vodStartGen++;
      // unconditional: the attached engine (VOD mode), the warm detached one
      // (live mode), a stopped one reloading a new URL in the background,
      // and a queued initialize() a seek left behind are all ended by it;
      // a cold engine ignores it
      this._vodPlayer?.stop();
      // a nimio:playback-end listener may have destroyed the player: the
      // engines are gone and the session closed, nothing left to hand over
      if (this._destroyed) return;
      // the VOD stop released the UI synchronously (before detaching media):
      // give it back to the live engine without starting it. A no-op when
      // the live engine already holds it.
      this._livePlayer.attach(this._ui, { latency: 0, idle: true });
      this._activate(this._livePlayer, MODE.LIVE);
      // the live stop is the last step and emits its playback-end last:
      // an application that restarts from that event gets a clean initial
      // play, as in the base (the guard protected the VOD stop, where the
      // engine still held the UI)
      this._stopping = false;
      this._livePlayer.stop(); // also closes a kept-alive session
      // the live playback-end listener may have destroyed the player too
      if (this._destroyed) return;
      // a stopped player presents a stopped context: the next VOD start
      // (a seek) opens paused, whatever the VOD detach recorded
      this._context.resetState();
      // a URL change, or a play() from the VOD end-event listener: an
      // initial live play from the stopped player
      if (this._playAfterStop) {
        this._playAfterStop = false;
        this._livePlayer.play();
      }
    } finally {
      this._stopping = false;
      // a listener that threw must not leave a deferred play for the next stop
      this._playAfterStop = false;
      // a VOD URL change from a listener of the stop: told after the stop's
      // events, unless the stop is a URL change's own, which tells last
      if (!this._urlChanging) this._tellVodReset();
    }
  }

  seekVod(position) {
    if (this._destroyed || this._stopping) return false;
    if (this._vodPlayer && this._vodPlayer.isRunning()) {
      return this._playProgressProxy.seekVod(position);
    }

    return this._runVodFromStart(position);
  }

  seekLive(buffer) {
    if (this._destroyed || this._stopping) return false;
    if (!this._playProgressProxy) return false;
    if (buffer === undefined || buffer === null) buffer = 0;
    return this._playProgressProxy.seekLive(buffer);
  }

  getVodPlayerHandler() {
    return this._vodPlayer?.isLoaded() ? this._vodPlayer.getHandler() : null;
  }

  version() {
    return __NIMIO_VERSION__;
  }

  static version() {
    return __NIMIO_VERSION__;
  }

  _createVUMeter() {
    this._vuMeterSvc = VUMeterService.getInstance(this._instName);
    this._vuMeterSvc.init(this._config.vuMeter, (magnitudes, decibels) => {
      this._eventBus.emit("nimio:vumeter-update", { magnitudes, decibels });
    });
  }

  // Start VOD from a non-running engine (stopped, or loaded but never
  // attached): the seek bar and seekVod() on a stopped or cold engine, and
  // the startup VOD failover. The engine re-initialises when its URL is
  // stale. `initial` marks the failover, where the autoplay setting decides;
  // everywhere else the VOD plays when the live engine was playing and
  // opens paused otherwise: the live detach records the engine's state in
  // the context and the VOD engine's _onLevelLoaded reads it.
  _runVodFromStart(pos, { initial = false } = {}) {
    if (!this._vodPlayer?.isLoaded() || this._vodPlayer.isRunning()) {
      return false;
    }
    // from the error listener of a failed startup failover: the archive is
    // being opened after all, so the NO_SRC the idle restore still owes
    // would be false. A paused player's end stays owed: that playback ended.
    if (this._idleRestore?.failover) this._idleRestore = null;
    const gen = ++this._vodStartGen;
    this._vodPlayer.initialize(this._ui.mediaElement).then(() => {
      // destroyed, stopped or re-targeted meanwhile: the start is void
      if (this._destroyed || gen !== this._vodStartGen) return;
      this._switchToVod(pos, { failover: initial });
      // a refused attach restores live at once; a listener of the events
      // the rollback emits may destroy the player
      if (this._destroyed) return;
      this._context.setState(this._context.state.value, initial);
      this._context.autoAbr = !!this._config.adaptiveBitrate;
    });

    return true;
  }

  _switchToVod(position, opts) {
    return this._switchMode(MODE.VOD, position, opts);
  }

  _switchToLive(latency) {
    if (!this._vodPlayer || this._mode === MODE.LIVE) return false;

    this._logger.debug(
      `Attach live with ${latency === 0 ? "default latency" : "latency = " + latency}`,
    );

    // pbError shows that VOD player couldn't play stream on start
    // that means that there is no playable stream source at the moment
    let pbError =
      this._context.state.initial && this._vodPlayer.hasPlaybackErrors();
    return this._switchMode(MODE.LIVE, { latency, pbError });
  }

  /**
   * Switch the active engine. Returns true when the switch started (it may
   * complete later) and false when it was rejected or failed synchronously.
   * Any failure restores the previous mode and emits nimio:playback-error.
   * `failover` marks the startup VOD failover: live was rejected, so a
   * rollback that leaves the player stopped reports NO_SRC as well.
   */
  _switchMode(target, attachParams, { failover = false } = {}) {
    if (this._destroyed) return false;
    if (!this._vodPlayer || this._mode === target) return false;
    if (this._mode === MODE.PEND) {
      this._logger.warn(`Switch to ${target} ignored: a switch is in progress`);
      return false;
    }

    const sw = {
      target,
      prevMode: this._mode,
      prevPlayer: this._actPlayer,
      nextPlayer: target === MODE.VOD ? this._vodPlayer : this._livePlayer,
      failover,
      detached: false,
      attachStarted: false,
      settled: false,
      ok: false,
      timer: null,
    };
    this._modeSwitch = sw;
    this._activate(sw.prevPlayer, MODE.PEND);
    sw.timer = setTimeout(
      () => this._finishModeSwitch(sw, false, "timeout"),
      MODE_SWITCH_TIMEOUT_MS,
    );

    // a live engine whose retry a pause() cancelled during a reconnect
    // wait, or that dropped while paused and waits for its retry, is
    // stopped, but the application still sees it paused; the detach
    // consumes that state, so a rollback must report the end (the snapshot
    // below says "stopped"). A retry pending for a drop during playback is
    // recorded as playing by the detach and takes the restart branch.
    sw.prevEndUnreported = !!sw.prevPlayer.hasUnreportedEnd?.();
    const detached = sw.prevPlayer.detach(() => {
      if (sw.settled) return;
      sw.detached = true;
      // the previous engine's detach just recorded its playback state in
      // the context; a rollback restores from this snapshot, since the new
      // engine's own detach overwrites the context with its state
      sw.prevState = this._context.state.value;
      this._activate(sw.nextPlayer, MODE.PEND);
      sw.attachStarted = sw.nextPlayer.attach(this._ui, attachParams, () =>
        this._finishModeSwitch(sw, true),
      );
      if (!sw.attachStarted) {
        this._finishModeSwitch(sw, false, "attach refused");
      }
    });
    if (!detached) this._finishModeSwitch(sw, false, "detach refused");

    return !sw.settled || sw.ok;
  }

  _finishModeSwitch(sw, ok, reason) {
    if (sw.settled) return;
    sw.settled = true;
    sw.ok = ok;
    clearTimeout(sw.timer);
    if (this._modeSwitch === sw) this._modeSwitch = null;

    if (ok) {
      this._activate(sw.nextPlayer, sw.target);
      return;
    }

    this._logger.error(
      `Switch to ${sw.target} failed (${reason}), restoring ${sw.prevMode}`,
    );
    // The previous mode is restored first, without events of its own: the
    // error listener gets a player that is back in that mode, so its
    // play(), stop() or seekVod() act on the restored engine and not on the
    // one being released. The error then comes before what followed from
    // it: an application that restarts from the end event does not get the
    // error of the old attempt on its new playback.
    const idle = this._restoreMode(sw);
    // a restarted live engine emits its own events from inside the restore
    // (nimio:play, the connection start); a listener may have destroyed the
    // player
    if (this._destroyed) return;
    this._idleRestore = idle ? sw : null;
    this._eventBus.emit("nimio:playback-error", {
      error: ERROR.MODE_SWITCH,
      mode: sw.target,
    });
    // nothing more for a restarted or untouched engine; the listener may
    // also have destroyed the player, or started playback itself (a play(),
    // or a seekVod() after a failed failover)
    const owed = this._idleRestore === sw;
    this._idleRestore = null;
    if (this._destroyed || !owed) return;
    if (sw.failover) {
      // the server rejected live and the archive did not open either: the
      // player is stopped with nothing to play, as when the failover is off
      this._eventBus.emit("nimio:playback-error", {
        error: ERROR.NO_SRC,
        mode: MODE.LIVE,
      });
    } else if (sw.prevState === STATE.PAUSED || sw.prevEndUnreported) {
      // the detach stopped the paused engine without an event (its session
      // was kept), or consumed an end left unreported by a pause() during a
      // reconnect wait or by a drop while paused, and the engine's stop in
      // the restore found it stopped: the application still holds a paused
      // player, tell it the playback ended (a stopped engine never played:
      // nothing to end)
      this._eventBus.emit("nimio:playback-end", { mode: MODE.LIVE });
    }
  }

  // Returns true when a live engine was taken back idle: the player ends
  // stopped, and the caller reports what the application is still owed.
  _restoreMode(sw) {
    if (sw.attachStarted) {
      // The new engine took the UI but never completed; release it.
      sw.nextPlayer.detach();
    }
    this._activate(sw.prevPlayer, sw.prevMode);

    // Only an engine that actually let go of the UI is re-attached. If the
    // detach was refused, the previous engine never changed state and
    // attaching it would start it rather than restore it.
    if (!sw.detached) return false;
    // Restore the playback state the previous engine had when it let go of
    // the UI (the new engine's detach above overwrote the context): a live
    // engine that was playing is restarted; a stopped or paused one takes
    // the UI back idle, so a failed seek into VOD on a stopped player does
    // not start playback nobody asked for. VOD reads the context itself.
    this._context.setState(sw.prevState);
    let params;
    if (sw.prevMode === MODE.LIVE) {
      params =
        sw.prevState === STATE.PLAYING
          ? { latency: 0 }
          : { latency: 0, idle: true };
    }
    if (!sw.prevPlayer.attach(this._ui, params, () => {})) {
      this._logger.error(`Could not re-attach ${sw.prevMode} player`);
      return false;
    }
    if (!params?.idle) return false;
    // The player ends stopped, as after stop(): the VOD engine's detach
    // above restarted the background playlist reload of a loaded archive
    // (a warm engine never stopped it), or the master request of an
    // archive that never loaded is still in flight; a stopped player must
    // not keep polling the archive. The engine holds no UI here, so its
    // stop emits no end event.
    this._vodPlayer?.stop();
    // a paused engine's detach kept its server session alive for a
    // restart; a restored player that shows the splash must not keep it
    sw.prevPlayer.stop();
    // and presents a stopped context: the snapshot restored above was for
    // the engine's attach only
    this._context.resetState();
    return true;
  }

  _cancelModeSwitch() {
    const sw = this._modeSwitch;
    if (!sw) return;
    clearTimeout(sw.timer);
    sw.settled = true;
    this._modeSwitch = null;
  }

  // The only writer of the active player and the mode (besides the
  // constructor and destroy()): a mode change is never half applied.
  _activate(player, mode) {
    this._actPlayer = player;
    this._mode = mode;
  }

  _onLivePlaybackError(type, allowFailover) {
    this._logger.warn(`Live playback error: ${ERROR[type]}`);
    switch (type) {
      case "NOT_SUP":
        this._eventBus.emit("nimio:playback-error", {
          error: ERROR[type],
          mode: MODE.LIVE,
        });
        break;
      case "NO_SRC":
        // Start playback from the beginning
        let vodStarted = false;
        if (allowFailover && this._config.vod?.startupVodFailover) {
          // TODO: VOD failover happens on the first run only, to make it
          // always try VOD use the same logic as seekVod() method does
          vodStarted = this._runVodFromStart(undefined, { initial: true });
        }

        if (!vodStarted) {
          if (this._vodPlayer?.isRunning()) {
            this._vodPlayer.stop();
          }
          this._eventBus.emit("nimio:playback-error", {
            error: ERROR[type],
            mode: MODE.LIVE,
          });
        }
        break;
      default:
        this._logger.error(`Live error type is not recognized: ${type}`);
        break;
    }
  }

  _onVodPlaybackError(type) {
    // Switch to live player for now.
    this._logger.warn(`VOD playback error: ${ERROR[type]}`);
    const sw = this._modeSwitch;
    if (sw && sw.target === MODE.VOD) {
      // The switch can't complete any more; fail it now instead of waiting
      // for the timeout. This restores the previous (live) mode.
      this._finishModeSwitch(sw, false, "VOD playback error");
      return;
    }
    if (this._config.vod?.liveFailover) {
      this._switchToLive(0);
    } else {
      this._eventBus.emit("nimio:playback-error", {
        error: ERROR[type],
        mode: MODE.VOD,
      });
    }
  }

  _onError = (data) => {
    if (this._destroyed) return;
    if (data.mode === MODE.LIVE) {
      this._onLivePlaybackError(data.type, !data.stop);
    } else {
      this._onVodPlaybackError(data.type);
    }
  };

  _onLiveConnected = () => {
    if (!this._vodPlayer || this._vodPlayer.isPlaying()) return;
    this._vodPlayer.initialize();
  };

  _onPlaybackPositionChange(mode, val) {
    this._logger.debug(
      `_onPlaybackPositionChange new mode = ${mode}, value = ${val}, cur mode = ${this._mode}`,
    );
    if (this._destroyed || this._stopping || this._mode === MODE.PEND) {
      return false;
    }

    if (mode === this._mode) {
      return this._actPlayer.goto(val);
    }

    if (mode === MODE.VOD && !this._vodPlayer?.isRunning()) {
      // the seek bar and seekVod() share one path into a non-running
      // engine: a stopped engine is attachable as-is and would play the
      // URL it was stopped with
      return this._runVodFromStart(val);
    }

    return mode === MODE.VOD ? this._switchToVod(val) : this._switchToLive(val);
  }

  _addVolumeEventHandlers() {
    this._onMuteUnmuteClick = this._onMuteUnmuteClick.bind(this);
    this._onVolumeChange = this._onVolumeChange.bind(this);
    this._eventBus.on("ui:mute-unmute-click", this._onMuteUnmuteClick);
    this._eventBus.on("ui:volume-change", this._onVolumeChange);
  }

  _removeVolumeEventHandlers() {
    this._eventBus.off("ui:mute-unmute-click", this._onMuteUnmuteClick);
    this._eventBus.off("ui:volume-change", this._onVolumeChange);
  }

  _checkRenditionType(type) {
    if (type !== "video" && type !== "audio") {
      this._logger.error("Rendition type must be either 'video' or 'audio'");
      return false;
    }
    return true;
  }
}

Object.assign(Nimio.prototype, NimioEvents);
Object.assign(Nimio.prototype, NimioVolume);
Object.assign(Nimio.prototype, NimioExtAPI);

if (typeof window !== "undefined") {
  // Expose globally when used via <script type="module"> without manual assignment
  window.Nimio = Nimio;
}
