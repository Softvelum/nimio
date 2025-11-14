export function mean(arr) {
  let result = 0;
  arr.forEach(function (v) {
    result += v;
  });
  return result === 0 ? result : result / arr.length;
}

export function currentTimeGetterMs() {
  function getPerfTime() {
    return performance.now();
  }

  function getCurrentTime() {
    return currentTime * 1000;
  }

  let hasPerformance = typeof performance !== "undefined";
  return hasPerformance ? getPerfTime : getCurrentTime;
}
