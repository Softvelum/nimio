import { LoggersFactory } from "./shared/logger";

const DEFAULTS = {
  streamUrl: null,
  container: null,
  autoplay: false,
  width: 476,
  height: 268,
  latency: 200,
  latencyTolerance: "auto",
  latencyAdjustMethod: "fast-forward",
  startOffset: 1000,
  pauseTimeout: 3000,
  metricsOverlay: false,
  instanceName: null,
  logLevel: "warn",
  fullBufferMs: null,
  videoOnly: false,
  audioOnly: false,
  adaptiveBitrate: {},
  volumeId: false,
  muted: false,
  vuMeter: null,
  workletLogs: false,
  fullscreen: false,
  dropZeroDurationFrames: false,
  hardwareAcceleration: false,
  reconnects: 10,
  splashScreen: null,
  syncBuffer: null,
  vod: null,
  captions: null,
  timecodes: false,
  aspectRatio: null,
};

const REQUIRED_KEYS = ["streamUrl", "container"];
const MIN_LATENCY = 100;
const DEFAULT_HLSJS_SOURCE_URL = "https://cdn.jsdelivr.net/npm/hls.js@1";

function validateRequired(cfg) {
  REQUIRED_KEYS.forEach((key) => {
    const val = cfg[key];
    if (val === null || val === undefined || val === "") {
      throw new Error(`Config key "${key}" is required`);
    }
  });
}

function initLatencySettings(settings, logger) {
  settings.latency = parseInt(settings.latency);
  if (isNaN(settings.latency) || settings.latency < MIN_LATENCY) {
    let err =
      settings.latency < MIN_LATENCY
        ? `less than minimum ${MIN_LATENCY} ms`
        : "invalid";
    let val = settings.latency < MIN_LATENCY ? MIN_LATENCY : DEFAULTS.latency;
    logger.error(
      `Parameter latency=${settings.latency} is ${err}. Setting to ${DEFAULTS.latency} ms`,
    );
    settings.latency = val;
  }

  if (settings.latencyTolerance !== "auto") {
    settings.latencyTolerance = parseInt(settings.latencyTolerance);
    if (
      isNaN(settings.latencyTolerance) ||
      (settings.latencyTolerance < settings.latency && !settings.syncBuffer)
    ) {
      let err =
        settings.latencyTolerance < settings.latency
          ? `less than latency ${settings.latency} ms`
          : "invalid";
      logger.error(
        `Parameter latencyTolerance=${settings.latencyTolerance} is ${err}. Setting to "auto"`,
      );
      settings.latencyTolerance = "auto";
    }
  }

  if (settings.latencyTolerance === "auto") {
    settings.latencyTolerance =
      settings.latency + Math.min(settings.latency / 4, 200);
  }

  if (!["fast-forward", "seek"].includes(settings.latencyAdjustMethod)) {
    logger.error(
      `Parameter latencyAdjustMethod=${settings.latencyAdjustMethod} is invalid. Setting to default "fast-forward"`,
    );
    settings.latencyAdjustMethod = "fast-forward";
  }
}

// TODO: make more friendly setting of initialRendition and maxRendition
// Like "480p" or 480, "1280x720", "min", "max", etc.
function initAbrSettings(settings, logger) {
  let abrSettings = settings.adaptiveBitrate;
  if (abrSettings instanceof Object) {
    if (abrSettings.initialRendition) {
      if (!abrSettings.initialRendition.endsWith("p")) {
        logger.error(
          "Parameter adaptiveBitrate.initialRendition is ignored. It must be a name of a rendition, i. e. '240p', '480p' or '720p'",
        );
      } else {
        abrSettings.initialHeight =
          parseInt(abrSettings.initialRendition) || undefined;
      }
    }
    if (abrSettings.maxRendition) {
      if (!abrSettings.maxRendition.endsWith("p")) {
        logger.error(
          "Parameter adaptiveBitrate.maxRendition is ignored. It must be a name of a rendition, i. e. '240p', '480p' or '720p'",
        );
      } else {
        abrSettings.maxHeight = parseInt(abrSettings.maxRendition) || undefined;
        if (abrSettings.initialHeight > abrSettings.maxHeight) {
          logger.error(
            "Parameter adaptiveBitrate.maxRendition is ignored. It must be greater or equal to adaptiveBitrate.initialRendition",
          );
          abrSettings.maxHeight = abrSettings.maxRendition = undefined;
        }
      }
    }
    abrSettings.sizeConstrained = !!abrSettings.sizeConstrained;
  } else if (abrSettings === true) {
    settings.adaptiveBitrate = {};
  }
}

function initVUMeterSettings(settings, logger) {
  if (!(settings.vuMeter instanceof Object)) return;

  settings.vuMeter.dbRange = parseInt(settings.vuMeter.dbRange);
  if (isNaN(settings.vuMeter.dbRange)) {
    settings.vuMeter.dbRange = undefined;
  }
  settings.vuMeter.rate = parseFloat(settings.vuMeter.rate);
  if (isNaN(settings.vuMeter.rate)) {
    settings.vuMeter.rate = undefined;
  } else if (settings.vuMeter.rate < 0.001) {
    settings.vuMeter.rate = 0.001;
  }

  if (settings.vuMeter.mode === undefined) {
    settings.vuMeter.mode = "peak";
  }
  if (!["peak", "rms", "avg"].includes(settings.vuMeter.mode)) {
    logger.warn(
      `VU meter mode ${settings.vuMeter.mode} isn't recognized. Setting the "peak" mode by default`,
    );
    settings.vuMeter.mode = "peak";
  }

  if (settings.vuMeter.type === undefined) {
    settings.vuMeter.type = "output";
  }
  if (!["input", "output"].includes(settings.vuMeter.type)) {
    logger.warn(
      `VU meter type ${settings.vuMeter.type} isn't recognized. Setting the "output" type be default`,
    );
    settings.vuMeter.type = "output";
  }

  if (settings.vuMeter.api === undefined) {
    settings.vuMeter.api = "AudioWorklet";
  }
  if (!["AudioWorklet", "ScriptProcessor"].includes(settings.vuMeter.api)) {
    logger.warn(
      `VU meter api ${settings.vuMeter.api} isn't recognized. Setting "AudioWorklet" by default`,
    );
    settings.vuMeter.api = "AudioWorklet";
  }
}

function initSyncBufferSetting(settings, logger) {
  if (undefined !== settings.syncBuffer) {
    settings.syncBuffer = parseInt(settings.syncBuffer);
    if (isNaN(settings.syncBuffer)) {
      settings.syncBuffer = null;
      return;
    }

    if (settings.syncBuffer < 500) {
      settings.syncBuffer = 500;
    }
    if (settings.latencyTolerance) {
      logger.warn(
        'Playback synchronization is set up. "latencyTolerance" parameter doesn\'t take any effect and is omitted.',
      );
      settings.latencyTolerance = 0;
    }
    if (settings.startOffset) {
      logger.warn(
        'Playback synchronization is set up. "startOffset" parameter doesn\'t take any effect and is omitted.',
      );
    }
    settings.latency = settings.syncBuffer - 50;
    settings.startOffset = settings.syncBuffer;
  }
}

function initVodSettings(settings) {
  if (!settings.vod) return;
  if (settings.vod === true) {
    settings.vod = {};
  }
  if (!(settings.vod instanceof Object)) {
    settings.vod = undefined;
    return;
  }

  let vod = settings.vod;
  if (!vod.hlsjs) vod.hlsjs = {};

  if (vod.hlsjs === "local") {
    vod.hlsjs = { source: null };
  } else if (vod.hlsjs === "cdn" || !(vod.hlsjs instanceof Object)) {
    vod.hlsjs = { source: DEFAULT_HLSJS_SOURCE_URL };
  }

  if (vod.hlsjs.source === undefined) {
    vod.hlsjs.source = DEFAULT_HLSJS_SOURCE_URL;
  }

  if (!vod.url) {
    vod.url = defaultVodUrl(settings);
    vod.isDefault = true;
  }

  if (vod.startupVodFailover === undefined) {
    vod.startupVodFailover = true;
  }
  if (vod.liveFailover === undefined) {
    vod.liveFailover = true;
  }
  vod.thumbnails = settings.audioOnly ? false : !!vod.thumbnails;
  if (vod.thumbnails) {
    setThumbnailBaseUrl(vod);
  }

  vod.adaptiveBitrate = settings.adaptiveBitrate;
  vod.autoplay = settings.autoplay;
  vod.timecodes = settings.timecodes;
  vod.volumeId = settings.volumeId;
  vod.muted = settings.muted;
}

function defaultVodUrl(settings) {
  let vodProtocol = "http";

  let url = settings.streamUrl;
  let prPos = url.indexOf("://");
  if (prPos > 0) {
    let protocol = url.slice(0, prPos);
    if ("wss" === protocol) {
      vodProtocol = "https";
    }
    url = url.slice(prPos + 3);
  }

  return vodProtocol + "://" + url + "/playlist_dvr.m3u8";
}

function setThumbnailBaseUrl(vodStngs) {
  let url = vodStngs.url.trim();
  if (url) {
    let plPos = url.indexOf(".m3u8");
    if (plPos > 0) {
      plPos = url.lastIndexOf("/", plPos);
      if (plPos > 0) {
        vodStngs.thumbnailBaseUrl = url.slice(0, plPos + 1) + "dvr_thumbnail_";
      }
    }
  }
}

export function createConfig(overrides = {}) {
  const filtered = {};
  const unknown = [];
  for (const [key, value] of Object.entries(overrides)) {
    if (key in DEFAULTS) {
      filtered[key] = value;
    } else {
      unknown.push(key);
    }
  }

  const target = { ...DEFAULTS, ...filtered };

  validateRequired(target);

  LoggersFactory.setLevel(target.logLevel);
  LoggersFactory.toggleWorkletLogs(target.workletLogs);
  const logger = LoggersFactory.create(target.instanceName, "Player config");
  for (let i = 0; i < unknown.length; i++) {
    logger.warn(`Config key "${unknown[i]}" is unknown`);
  }

  // ID for storing the last volume level
  target.volumeId = target.container;

  if (target.videoOnly && target.audioOnly) {
    logger.warn("Both video and audio only modes are set. Skipping.");
    target.videoOnly = target.audioOnly = false;
  }

  initSyncBufferSetting(target, logger);

  target.fullBufferMs =
    target.latency + target.startOffset + target.pauseTimeout;

  initLatencySettings(target, logger);
  initAbrSettings(target, logger);
  initVUMeterSettings(target, logger);
  initVodSettings(target);

  return new Proxy(target, {
    get(obj, prop) {
      if (!(prop in DEFAULTS)) {
        logger.error(`Config get unknown key "${prop}"`);
        return undefined;
      }
      return obj[prop];
    },
    set(obj, prop, value) {
      if (!(prop in DEFAULTS)) {
        logger.warn(`Config set unknown key "${prop}"`);
        return false;
      }
      obj[prop] = value;
      return true;
    },
  });
}

export function updateConfigStreamURL(settings, url) {
  let liveUrl, vodUrl;
  if (url instanceof Object) {
    liveUrl = url.live;
    vodUrl = url.vod;
  } else {
    liveUrl = url;
  }

  if (liveUrl !== undefined) {
    settings.streamUrl = liveUrl;
  }

  if (settings.vod) {
    if (vodUrl !== undefined) {
      settings.vod.url = vodUrl;
    } else if (settings.vod.isDefault) {
      settings.vod.url = defaultVodUrl(settings);
    }

    if (settings.vod.thumbnails) {
      setThumbnailBaseUrl(settings.vod);
    }
  }
}
