export class UILayoutManager {
  constructor(widthProp, heightProp, arProp) {
    this._cssWidth = this._toCssSize(widthProp);
    this._cssHeight = this._toCssSize(heightProp);
    this._initAspectRatio(arProp);
  }

  setFrameSize(width, height) {
    this._frameWidth = width;
    this._frameHeight = height;
  }

  computeLayout(cWidth, cHeight, mode, isFullscreen) {
    if (isFullscreen) {
      const screenAspect = cWidth / cHeight;

      let newWidth, newHeight;
      if (screenAspect > this._far) {
        newHeight = window.innerHeight;
        newWidth = Math.round(newHeight * this._far);
      } else {
        newWidth = window.innerWidth;
        newHeight = Math.round(newWidth / this._far);
      }
    } else {

    }

    let res = {
      width: this._cssWidth,
      height: this._cssHeight,
    };
    if (this._ar) {
      res["aspect-ratio"] = `${this._ar.x} / ${this._ar.y}`;
    }

    return res;
  }

  computeRenderProps(cWidth, cHeight, mode, isFullscreen) {
    
  }

  get cssWidth() {
    return this._cssWidth;
  }

  get cssHeight() {
    return this._cssHeight;
  }

  _initAspectRatio(ar) {
    if (!ar) return;

    ar = ar.split(":").join("/").split("/");
    if (ar.length !== 2) return;
    this._ar = { x: parseInt(ar[0]), y: parseInt(ar[1]) };
    this._far = ar.x / ar.y;
  }

  _toCssSize(value) {
    if (typeof value === "number") {
      return `${value}px`;
    }
    return value;
  }

}
