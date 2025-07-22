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
