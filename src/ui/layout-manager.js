export class UILayoutManager {
  constructor(width, height, ar) {
    this._width = this._toCssSize(width);
    this._height = this._toCssSize(height);
    this._initAspectRatio(ar);
  }

  setFrameSize(width, height) {
    this._frameWidth = width;
    this._frameHeight = height;
  }

  computeLayout(cWidth, cHeight, mode, isFullscreen) {
    if (isFullscreen) {
      const screenAspect = window.innerWidth / window.innerHeight;

      let newWidth, newHeight;
      if (screenAspect > this._far) {
        newHeight = window.innerHeight;
        newWidth = Math.round(newHeight * this._far);
      } else {
        newWidth = window.innerWidth;
        newHeight = Math.round(newWidth / this._far);
      }
    }
  }

  computeRenderProps(cWidth, cHeight, mode, isFullscreen) {

  }

  _initAspectRatio(ar) {
    if (!ar) return;

    ar = ar.split(":").join("/").split("/");
    if (ar.length !== 2) return;
    ar = { x: parseInt(ar[0]), y: parseInt(ar[1]) };
    this._far = ar.x / ar.y;
  }

  _toCssSize(value) {
    if (typeof value === "number") {
      return `${value}px`;
    }
    return value;
  }

}