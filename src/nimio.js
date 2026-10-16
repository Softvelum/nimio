import { ScriptPathProvider } from "./shared/script-path-provider";
import { EventBus } from "./event-bus";
import { MODE, ERROR } from "./shared/values";
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
    this._eventBus.on("aux:playback-error", this._onError);

    this._playProgressSvc = PlaybackProgressService.getInstance(this._instName);
    this._playProgressSvc.positionChangeCb = this._onPlaybackPositionChange;
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
    this._actPlayer?.play();
  }

  setStreamURL(url) {
    if (this._destroyed) return;
    updateConfigStreamURL(this._config, url);
    // detached (VOD mode or a pending switch): closes the kept-alive
    // session of the old URL so the next attach handshakes; attached:
    // stop + play with the new URL
    this._livePlayer.setStreamURL();
    if (this._mode === MODE.VOD) {
      // the switch's attach handshakes with the new URL: one connection,
      // and a failure restores VOD and is reported
      this._switchMode(MODE.LIVE, { latency: 0 });
    } else if (this._mode === MODE.PEND) {
      this._logger.warn(
        "Stream URL changed during a mode switch; applied on the next attach",
      );
    }
  }

  pause() {
    this._actPlayer?.pause();
  }

  stop() {
    if (this._destroyed) return;
    // a switch in flight cannot complete into a stopped player; settle it
    // silently (no error: the stop is what the application asked for)
    this._cancelModeSwitch();
    // running covers the attached VOD engine (VOD mode) and the warm,
    // detached one that reloads levels in the background (live mode)
    if (this._vodPlayer?.isRunning()) this._vodPlayer.stop();
    // a nimio:playback-end listener may have destroyed the player: the
    // engines are gone and the session closed, nothing left to hand over
    if (this._destroyed) return;
    // the VOD stop released the UI synchronously (before detaching media):
    // give it back to the live engine without starting it. A no-op when
    // the live engine already holds it.
    this._livePlayer.attach(this._ui, { latency: 0, idle: true });
    this._activate(this._livePlayer, MODE.LIVE);
    this._livePlayer.stop(); // also closes a kept-alive session
  }

  seekVod(position) {
    if (this._destroyed) return false;
    if (this._vodPlayer && this._vodPlayer.isRunning()) {
      return this._playProgressProxy.seekVod(position);
    }

    return this._runVodFromStart(position);
  }

  seekLive(buffer) {
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

  _runVodFromStart(pos) {
    if (this._vodPlayer?.isLoaded() && !this._vodPlayer.isRunning()) {
      this._vodPlayer.initialize(this._ui.mediaElement).then(() => {
        if (this._destroyed) return;
        let curState = this._context.state.value;
        this._switchToVod(pos);
        this._context.setState(curState, true);
        this._context.autoAbr = !!this._config.adaptiveBitrate;
      });

      return true;
    }

    return false;
  }

  _switchToVod(position) {
    return this._switchMode(MODE.VOD, position);
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
   */
  _switchMode(target, attachParams) {
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

    const detached = sw.prevPlayer.detach(() => {
      if (sw.settled) return;
      sw.detached = true;
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
    this._restoreMode(sw);
    this._eventBus.emit("nimio:playback-error", {
      error: ERROR.MODE_SWITCH,
      mode: sw.target,
    });
  }

  _restoreMode(sw) {
    if (sw.attachStarted) {
      // The new engine took the UI but never completed; release it.
      sw.nextPlayer.detach();
    }
    this._activate(sw.prevPlayer, sw.prevMode);

    // Only an engine that actually let go of the UI is re-attached. If the
    // detach was refused, the previous engine never changed state and
    // attaching it would start it rather than restore it.
    if (!sw.detached) return;
    const params = sw.prevMode === MODE.LIVE ? { latency: 0 } : undefined;
    if (!sw.prevPlayer.attach(this._ui, params, () => {})) {
      this._logger.error(`Could not re-attach ${sw.prevMode} player`);
    }
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
          vodStarted = this._runVodFromStart();
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

  _onPlaybackPositionChange = (mode, val) => {
    this._logger.debug(
      `_onPlaybackPositionChange new mode = ${mode}, value = ${val}, cur mode = ${this._mode}`,
    );
    if (this._destroyed || this._mode === MODE.PEND) return false;

    if (mode === this._mode) {
      return this._actPlayer.goto(val);
    }

    return mode === MODE.VOD ? this._switchToVod(val) : this._switchToLive(val);
  };

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
