export function capitalizeFirstChar(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function mean(arr) {
  let result = 0;
  arr.forEach(function (v) { result += v; });
  return result === 0 ? result : result / arr.length;
}
