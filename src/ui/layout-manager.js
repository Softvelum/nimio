class UILayoutManager {
  constructor(container, width, height) {
    this._container = container;
    this._width = width;
    this._height = height;
  }

  async toggleFullscreen(e) {
    let fReq;
    if (!this._isPlayerFullscreen()) {
      let fsOpts = { navigationUI: "hide" };
      if (this._container.requestFullscreen) {
        fReq = this._container.requestFullscreen(fsOpts);
      } else if (this._container.webkitRequestFullscreen) {
        fReq = this._container.webkitRequestFullscreen(fsOpts);
      }
    } else {
      if (document.exitFullscreen) {
        fReq = document.exitFullscreen();
      } else if (document.cancelFullScreen) {
        fReq = document.cancelFullScreen();
      } else if (document.webkitCancelFullScreen) {
        fReq = document.webkitCancelFullScreen();
      }
    }

    if (fReq) {
      await fReq.catch((err) => {
        this._logger.error("Failed to toggle fullscreen mode:", err);
      });
    } else {
      this._logger.warn("No fullscreen API is available");
    }
    if (e) e.stopPropagation();
  }

  _applySize(elem, w, h) {
    elem.style.width = `${w}px`;
    elem.style.height = `${h}px`;
  }

  _isPlayerFullscreen() {
    let fElem = document.fullscreenElement || document.webkitFullscreenElement;
    return fElem === this._container;
  }

  _resizeAndRedraw() {
    if (this._isPlayerFullscreen()) {
      const screenAspect = window.innerWidth / window.innerHeight;

      let newWidth, newHeight;
      if (screenAspect > this._ar) {
        newHeight = window.innerHeight;
        newWidth = Math.round(newHeight * this._ar);
      } else {
        newWidth = window.innerWidth;
        newHeight = Math.round(newWidth / this._ar);
      }

      this._updateOutputSize(newWidth, newHeight);
    } else {
      this._updateOutputSize(this._baseWidth, this._baseHeight);
    }
  }

  _initPlayerSize() {
    // get size from op
    this._baseWidth = this._opts.width;
    this._baseHeight = this._opts.height;
  }

  _initAspectRatio() {
    if (this._opts.ar) {
      let ar = this._opts.ar.split(":");
      if (2 === ar.length) {
        this._opts.ar = {
          x: parseInt(ar[0]),
          y: parseInt(ar[1]),
        };
        this._ar = this._opts.ar.x / this._opts.ar.y;

        this._baseHeight = Math.round(this._baseWidth / this._ar);
        return;
      }
    }

    // default calculation
    this._ar = this._baseWidth / this._baseHeight;
  }

  _handleOrientChange(e) {
    // orientationchange can fire before actual size update
    // TODO: rework this using more granular approach involving aspect ratio
    setTimeout(this._onResize, 250);
  }

  _toCssSize(value) {
    if (typeof value === "number") {
      return `${value}px`;
    }
    return value;
  }
}