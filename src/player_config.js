const DEFAULTS = {
    streamUrl: null,
    container: null,
    width: 476,
    height: 268,
    latency: 200,
    startOffset: 1000,
    pauseTimeout: 3000,
    fastForward: false,
    metricsOverlay: false
};

const REQUIRED_KEYS = ["streamUrl", "container"];

function validateRequired(cfg) {
    REQUIRED_KEYS.forEach(key => {
        const val = cfg[key];
        if (val === null || val === undefined || val === "") {
            throw new Error(`config key "${key}" required`);
        }
    });
}

export function createConfig(overrides = {}) {
    const filtered = {};
    for (const [key, value] of Object.entries(overrides)) {
        if (key in DEFAULTS) {
            filtered[key] = value;
        } else {
            console.warn(`Config unknown key "${key}" ignored`);
        }
    }

    const target = { ...DEFAULTS, ...filtered };

    validateRequired(target);

    return new Proxy(target, {
        get(obj, prop) {
            if (!(prop in DEFAULTS)) {
                console.error(`Config get unknown key "${prop}"`);
                return undefined;
            }
            return obj[prop];
        },
        set(obj, prop, value) {
            if (!(prop in DEFAULTS)) {
                console.warn(`Config set unknown key "${prop}"`);
                return false;
            }
            obj[prop] = value;
            return true;
        }
    });
}
