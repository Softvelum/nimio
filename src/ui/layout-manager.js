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

  getAspectFrameSize(widthVal, heightVal) {
    let width = widthVal;
    let height = heightVal;

    if (!!this._ar) {
      const cAspect = widthVal / heightVal;
      const wDiff = (cAspect - this._ar.val) * heightVal;
      if (wDiff > -1) {
        width = Math.round(heightVal * this._ar.val);
      } else {
        height = Math.round(widthVal / this._ar.val);
      }
    }
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

  canLayout() {
    return !!this._ar && !this._paused;
  }

  heightNeedsProbe() {
    return this._cssSizeKind(this._cssHeight) === "relative";
  }

  fullLayout(
    cWidth,
    cHeight,
    mode,
    isFullscreen,
    isMediaElementMode,
    heightIndependent = false,
  ) {
    if (!this._ar || this._paused) return null;

    let res = { container: this.containerLayout(isFullscreen) };

    res.output = {
      "object-fit": this._forcedAr ? "fill" : "contain",
      "aspect-ratio": this._ar.str,
    };
    if (mode === MODE.LIVE && !isMediaElementMode) {
      if (res.container.width !== "auto") {
        res.output.width = "100%";
      }
      if (res.container.height !== "auto") {
        res.output.height = "100%";
      }
    } else if (mode === MODE.VOD || isMediaElementMode) {
      const widthAuto = this._cssSizeKind(this._cssWidth) === "intrinsic";
      const heightIndefinite =
        !isFullscreen && this._isHeightIndefinite(heightIndependent);
      if (heightIndefinite) {
        // With an indefinite HEIGHT (auto, a content-based keyword, or a
        // percentage against a parent with no definite height) the
        // container is sized by the output itself, so a rect-based fit
        // feeds back and oscillates - width constrains, aspect-ratio
        // keeps the shape. An auto WIDTH is parent-derived on a block
        // container, so the rect fit below stays valid for it (assumes
        // the container remains display:block).
        res.output.width = widthAuto ? "auto" : "100%";
        res.output.height = "auto";
      } else {
        let cAspect = cWidth / cHeight;
        let wDiff = (cAspect - this._ar.val) * cHeight;
        if (wDiff > -1) {
          // width difference doesn't exceed 1 pixel
          res.output.height = "100%";
          res.output.width = isMediaElementMode ? `${cWidth}px` : "auto";
        } else {
          res.output.width = "100%";
          res.output.height = isMediaElementMode ? `${cHeight}px` : "auto";
        }
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

  // "intrinsic" - computes to a content-based height, always indefinite
  // (auto, fit-content and friends, and the css-wide keywords that fall
  // back to auto for height - NOT revert/revert-layer, which roll back
  // to user-origin or lower-layer author styles that may define a
  // definite height);
  // "definite" - a positively recognized plain absolute length, the
  // only syntax trusted without measurement;
  // "relative" - everything else is context-dependent or unknown
  // (%, var(), env() with a possibly-auto fallback, calc(),
  // calc-size(), inherit, revert, revert-layer, future grammar) and is
  // resolved by the DOM probe in ui.js, which measures whether the
  // container's height actually follows the output.
  _cssSizeKind(value) {
    if (!value) return "intrinsic";
    const v = String(value).trim().toLowerCase();
    if (/^(auto|fit-content|min-content|max-content|initial|unset)\b/.test(v)) {
      return "intrinsic";
    }
    if (
      v === "0" ||
      /^\+?(\d+(\.\d+)?|\.\d+)(e[+-]?\d+)?(px|em|rem|ex|ch|cap|ic|lh|rlh|rex|rch|rcap|ric|vw|vh|vmin|vmax|vi|vb|svw|svh|svi|svb|svmin|svmax|lvw|lvh|lvi|lvb|lvmin|lvmax|dvw|dvh|dvi|dvb|dvmin|dvmax|cqw|cqh|cqi|cqb|cqmin|cqmax|cm|mm|q|in|pt|pc)$/.test(
        v,
      )
    ) {
      return "definite";
    }
    return "relative";
  }

  _isHeightIndefinite(heightIndependent) {
    const kind = this._cssSizeKind(this._cssHeight);
    if (kind === "intrinsic") return true;
    if (kind === "relative") return !heightIndependent;
    return false;
  }

  _toCssSize(value) {
    if (typeof value === "number") {
      return `${value}px`;
    }

    return value || "auto";
  }
}
