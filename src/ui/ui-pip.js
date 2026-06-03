import { MODE } from "@/shared/values";

export const UiPip = {
  _setupPip() {
    if ("documentPictureInPicture" in window) {
      this._togglePip = this._toggleDocumentPip.bind(this);
    } else if ("pictureInPictureEnabled" in document) {
      this._pipCaptureStreamMode = true;
      this._togglePip = this._toggieVideoPip.bind(this);
      this._enterPipEvent = this._handleEnterPip.bind(this);
      this._leavePipEvent = this._handleLeavePip.bind(this);
      window.addEventListener(
        "enterpictureinpicture",
        this._enterPipEvent,
        false,
      );
      window.addEventListener(
        "leavepictureinpicture",
        this._leavePipEvent,
        false,
      );      
    } else {
      this._buttonPictureInPicture.style.display = "none";
      this._logger.warn("Picture-in-picture API is unavailable");
      return;
    }
    this._buttonPictureInPicture.addEventListener("click", this._togglePip);
    let pipMessage = document.createElement("div");
    pipMessage.className = "pip-message";
    pipMessage.textContent = "Video player is in the Picture-in-Picture window";
    pipMessage.style.display = "none";
    this._container.appendChild(pipMessage);
    this._pipMessage = pipMessage;
  },

  async _toggleDocumentPip() {
    let activePip = window.documentPictureInPicture.window;
    if (activePip) {
      activePip.close();
      return;
    }
    let rp = this._rendProps;
    if (!rp) return;

    const pipWindow = await window.documentPictureInPicture.requestWindow({
      width: rp.dWidth,
      height: rp.dHeight,
    });

    // Move the player to the Picture-in-Picture window.
    let videoPlayer = null;
    if (MODE.LIVE === this._mode) {
      videoPlayer = this._canvas;
    } else {
      videoPlayer = this._mediaElement;
    }

    let rootDiv = document.createElement("div");
    rootDiv.className = "pip-container";
    rootDiv.appendChild(videoPlayer);
    this._pipContainer = rootDiv;
    this._pipPlayer = videoPlayer;
    pipWindow.document.body.append(rootDiv);
    let playerContainer = this._container;
    this._pipWindowFrame = pipWindow;
    pipWindow.addEventListener("pagehide", (event) => {
      this._pipResizeObserver?.unobserve(this._pipContainer);
      this._pipContainer = undefined;
      this._pipResizeObserver = undefined;
      playerContainer.append(this._pipPlayer);
      this._pipPlayer = undefined;
      this._pipMessage.style.display = "none";
      this._handleViewportUpdate();
    });

    this._pipResizeObserver = new ResizeObserver((entries) => {
      requestAnimationFrame(() => {
        this._updateLayout(entries[0].contentRect);
      });
    });
    this._pipResizeObserver.observe(this._pipContainer);
    this._pipMessage.style.display = "flex";
  },

  _toggleModePip(mode) {
    if (this._pipWindow) {
      return false;
    }
    if (this._pipContainer === undefined) return true;

    // For documentPictureInPicture mode - swap mediaElement and canvas between main and PiP window
    if (mode === MODE.LIVE) {
      this._container.append(this._mediaElement);
      this._pipContainer.append(this._canvas);
      this._pipPlayer = this._canvas;
    } else {
      this._pipPlayer = this._mediaElement;
      this._container.append(this._canvas);
      this._pipContainer.append(this._mediaElement);
    }
    return true;
  },

  _getFrameSizePip(rect) {
    if (this._mediaElementMode !== true) return rect;
    const pipSize = this._layoutMgr.getAspectFrameSize(rect.width, rect.height);
    rect = new DOMRect(0, 0, pipSize.width, pipSize.height);
    return rect;
  },

  _resizePip(rect) {
    if (this._mediaElementMode !== true) {
      return true;
    }
    let video = this._mediaElement;
    video.style.width = `${rect.width}px`;
    video.style.height = `${rect.height}px`;
    return false;
  },

  async _toggieVideoPip(ev) {
    if (this._pipWindow) {
      document.exitPictureInPicture();
      return;
    }
    if (MODE.LIVE === this._mode) {
      let canvas = this._canvas;
      let video = this._mediaElement;
      canvas.style.display = "none";
      // Video should be presented as block, but hidden till PIP started
      video.style.visibility = "hidden";
      video.style.display = "block";
    }
    this._mediaElementMode = true;
    let rect = this._container.getBoundingClientRect();
    rect = this._getFrameSizePip(rect);
    this._updateLayout(rect);
    await this._mediaElement.requestPictureInPicture();
  },

  _handleEnterPip(event) {
    let pipWindow = event.pictureInPictureWindow;
    this._pipWindow = pipWindow;
    if (MODE.LIVE === this._mode) {
      this._mediaElement.style.visibility = "visible";
    }
  },

  _handleLeavePip() {
    this._pipWindow = undefined;
    this._mediaElementMode = false;

    let video = this._mediaElement;
    if (MODE.LIVE === this._mode) {
      video.style.display = "none";
      this._canvas.style.display = "block";
      // Somehow capture stream does not work if we would try to open PiP again,
      // pause/resume fixes it
      video.pause();
      video.play();
      this._handleViewportUpdate();
    }
  },

  _createCaptureStream() {
    if (
      this._pipCaptureStreamMode !== true ||
      this._captureStream !== undefined
    ) {
      return;
    }
    //Create MediaStream from canvas to support PiP if DocumentPictureInPicture is unsupported
    let stream = this._canvas.captureStream();
    this._captureStream = stream;
    let video = this._mediaElement;
    video.srcObject = stream;
    video.play();
  },

  _destroyCaptureStream() {
    if (
      this._captureStream === undefined ||
      this._mediaElement.srcObject === undefined
    ) {
      return;
    }
    this._mediaElement.pause();
    this._mediaElement.srcObject = undefined;
    this._captureStream = undefined;
  },
};
