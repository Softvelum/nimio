import { MODE } from "@/shared/values";

export class UILayoutManager {
  constructor(widthProp, heightProp, arProp) {
    this._cssWidth = this._toCssSize(widthProp);
    this._cssHeight = this._toCssSize(heightProp);
    this._initAspectRatio(arProp);
    this._forcedAr = !!this._ar;
    if (!widthProp && !heightProp) {
      // empty width and height settings -> apply frame dimensions
      this._frameSized = true;
    }
  }

  pause() {
    console.warn("Pause layout manager");
    this._paused = true;
  }

  resume() {
    console.warn("Resume layout manager")
    this._paused = false;
  }

  setFrameSize(width, height) {
    this._frameHeight = height;
    if (!this._forcedAr) {
      this._setAspectRatio(width, height);
    }
    if (this._frameSized) {
      this._cssHeight = `${this._frameHeight}px`;
      this._cssWidth = `${Math.round(this._frameHeight * this._ar.val)}px`;
    }
  }

  computeLayout(cWidth, cHeight, mode, isFullscreen) {
    if (!this._ar || this._paused) return null;

    let res = {
      container: {
        width: isFullscreen ? "100vw" : this._cssWidth,
        height: isFullscreen ? "100vh" : this._cssHeight,
      },
    };

    res.output = {
      "object-fit": this._forcedAr ? "fill" : "contain",
      "aspect-ratio": this._ar.str,
    };
    if (mode === MODE.LIVE) {
      if (res.container.width !== "auto") {
        res.output.width = "100%";
      }
      if (res.container.height !== "auto") {
        res.output.height = "100%";
      }
    } else if (mode === MODE.VOD) {
      let cAspect = cWidth / cHeight;
      let wDiff = (cAspect - this._ar.val) * cHeight;
      if (wDiff > -1) {
        // width difference doesn't exceed 1 pixel
        res.output.height = "100%";
        res.output.width = "auto";
      } else {
        res.output.width = "100%";
        res.output.height = "auto";
      }
    }

    return res;
  }

  computeRenderProps(width, height) {
    if (!this._ar || !width || !height || this._paused) return null;

    let sourceWidth = this._frameHeight * this._ar.val;
    let scale = Math.min(width / sourceWidth, height / this._frameHeight);

    let dWidth = sourceWidth * scale;
    let dHeight = this._frameHeight * scale;
    let dx = Math.round((width - dWidth) / 2);
    let dy = Math.round((height - dHeight) / 2);

    return { width, height, dWidth, dHeight, dx, dy };
  }

  _initAspectRatio(ar) {
    if (!ar) return;

    ar = ar.split(":").join("/").split("/");
    if (ar.length !== 2) return;
    this._setAspectRatio(ar[0], ar[1]);
  }

  _setAspectRatio(x, y) {
    x = Number(x);
    y = Number(y);
    if (isNaN(x) || isNaN(y)) return;

    this._ar = { x, y, str: `${x} / ${y}`, val: x / y };
  }

  _toCssSize(value) {
    if (typeof value === "number") {
      return `${value}px`;
    }

    return value || "auto";
  }
}
