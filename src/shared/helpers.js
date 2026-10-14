export function mean(arr) {
  let result = 0;
  arr.forEach(function (v) {
    result += v;
  });
  return result === 0 ? result : result / arr.length;
}

export function clamp(val, lo, hi) {
  return Math.max(lo, Math.min(hi, val));
}

export function fillTemplateStr(templateStr, params) {
  return templateStr.replace(/\$\{(\w+)\}/g, (match, key) => {
    return key in params ? params[key] : match;
  });
}

export function throttler(inst, func, ms) {
  let timer;
  let lastArgs;
  function wrapper() {
    if (undefined === timer) {
      lastArgs = undefined;
      timer = setTimeout(function () {
        timer = undefined;
        if (lastArgs) {
          wrapper.apply(inst, lastArgs);
        }
      }, ms);
      func.apply(inst, arguments);
    } else {
      lastArgs = arguments;
    }
  }

  return wrapper;
}

export function debouncer(inst, func, ms) {
  let timer;
  let args;

  function wrapper() {
    args = arguments;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = undefined;
      func.apply(inst, args);
      args = undefined;
    }, ms);
  }

  return wrapper;
}

// Runs each [what, fn] cleanup step in isolation. A failing step is logged
// as "<prefix>: <what> failed" and does not prevent the others; the errors
// are returned so the caller can rethrow the first one after cleanup has
// completed.
export function runCleanupSteps(logger, prefix, steps) {
  const errors = [];
  for (const [what, fn] of steps) {
    try {
      fn();
    } catch (err) {
      logger.error(`${prefix}: ${what} failed`, err);
      errors.push(err);
    }
  }
  return errors;
}
