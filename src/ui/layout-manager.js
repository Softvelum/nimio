export class UILayoutManager {
  constructor(ar) {
    this._initAspectRatio(ar);
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

  _initAspectRatio(ar) {
    if (!ar) return;

    ar = ar.split(":").join("/").split("/");
    if (ar.length !== 2) return;
    ar = { x: parseInt(ar[0]), y: parseInt(ar[1]) };
    this._far = ar.x / ar.y;
  }

}