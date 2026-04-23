class UILayoutManager {
  constructor(width, height, ar) {
    this._cssWidth = this._toCssSize(width);
    this._cssHeight = this._toCssSize(height);
    this._initAspectRatio(ar);
  }

  computeLayout(cWidth, cHeight, mode, isFullscreen) {
    if (isFullscreen) {
      const screenAspect = window.innerWidth / window.innerHeight;

      let newWidth, newHeight;
      if (screenAspect > this._ar) {
        newHeight = window.innerHeight;
        newWidth = Math.round(newHeight * this._ar);
      } else {
        newWidth = window.innerWidth;
        newHeight = Math.round(newWidth / this._ar);
      }
    }
  }



  _initAspectRatio(ar) {
    if (!ar) return;

    let ar = ar.split(":").join("/").split("/");
    if (ar.length !== 2) return;
    ar = { x: parseInt(ar[0]), y: parseInt(ar[1]) };
    this._sar = ar.x / ar.y;
  }

  _toCssSize(value) {
    if (typeof value === "number") {
      return `${value}px`;
    }
    return value;
  }
}