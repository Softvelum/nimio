import LoggersFactory from "./shared/logger";

const DEFAULTS = {
  streamUrl: null,
  container: null,
  autoplay: false,
  width: 476,
  height: 268,
  latency: 200,
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
};

const REQUIRED_KEYS = ["streamUrl", "container"];

function validateRequired(cfg) {
  REQUIRED_KEYS.forEach((key) => {
    const val = cfg[key];
    if (val === null || val === undefined || val === "") {
      throw new Error(`Config key "${key}" is required`);
    }
  });
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
  const logger = LoggersFactory.create(target.instanceName, "Player config");
  for (let i = 0; i < unknown.length; i++) {
    logger.warn(`Config key "${unknown[i]}" is unknown`);
  }

  target.fullBufferMs =
    target.latency + target.startOffset + target.pauseTimeout;

  initAbrSettings(target, logger);

  // ID for storing the last volume level
  target.volumeId = target.container;

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
