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
    this._paused = true;
  }

  resume() {
    this._paused = false;
  }

  setFrameSize(width, height) {
    if (!width || !height) return;

    this._frameHeight = height;
    if (!this._forcedAr) {
      this._setAspectRatio(width, height);
    }
    if (this._frameSized) {
      this._cssHeight = `${this._frameHeight}px`;
      this._cssWidth = `${Math.round(this._frameHeight * this._ar.val)}px`;
    }
  }

  getAspectFrameSize(heightVal) {
    const height = heightVal ?? this._frameHeight;
    let width = Math.round(height * this._ar.val);
    return {
      width: width,
      height: height,
    };
  }

  containerLayout(isFullscreen) {
    return {
      width: isFullscreen ? "100vw" : this._cssWidth,
      height: isFullscreen ? "100vh" : this._cssHeight,
    };
  }

  fullLayout(cWidth, cHeight, mode, isFullscreen) {
    if (!this._ar || this._paused) return null;

    let res = { container: this.containerLayout(isFullscreen) };

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

    width = Math.round(width);
    height = Math.round(height);
    dWidth = Math.round(dWidth);
    dHeight = Math.round(dHeight);

    return { width, height, dWidth, dHeight, dx, dy };
  }

  _initAspectRatio(ar) {
    if (!ar) return;

    switch (typeof ar) {
      case "number":
        ar = [ar, 1];
        break;
      case "string":
        ar = ar.split(":").join("/").split("/");
        if (ar.length > 2) return;
        if (ar.length === 1) {
          ar[1] = 1; // default height to 1 if only one value is provided
        }
        break;
      default:
        return;
    }

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
