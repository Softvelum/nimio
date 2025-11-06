export function mean(arr) {
  let result = 0;
  arr.forEach(function (v) {
    result += v;
  });
  return result === 0 ? result : result / arr.length;
}
