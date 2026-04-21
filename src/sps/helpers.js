const EXTENDED_SAR = 255;
const DEFAULT_SAR = Object.freeze({ w: 1, h: 1 });
const SAR_TABLE = Object.freeze({
  1: { w: 1, h: 1 },
  2: { w: 12, h: 11 },
  3: { w: 10, h: 11 },
  4: { w: 16, h: 11 },
  5: { w: 40, h: 33 },
  6: { w: 24, h: 11 },
  7: { w: 20, h: 11 },
  8: { w: 32, h: 11 },
  9: { w: 80, h: 33 },
  10: { w: 18, h: 11 },
  11: { w: 15, h: 11 },
  12: { w: 64, h: 33 },
  13: { w: 160, h: 99 },
  14: { w: 4, h: 3 },
  15: { w: 3, h: 2 },
  16: { w: 2, h: 1 },
});

export function getSarFromAspectRatioIdc(aspRatioIdc, extSarGetterFn) {
  if (aspRatioIdc === EXTENDED_SAR) {
    return extSarGetterFn?.() ?? DEFAULT_SAR;
  }

  return SAR_TABLE[aspRatioIdc] ?? DEFAULT_SAR;
}
