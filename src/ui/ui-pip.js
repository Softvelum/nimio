import { MODE } from "@/shared/values";

export const UiPip = {
  _PipNeedsMediaElement() {
    if (this._opts.audioOnly) return false;
    if ("documentPictureInPicture" in window) return false;
    if ("pictureInPictureEnabled" in document) return true;
    return false;
  },

  _setupPip() {
    if (this._opts.audioOnly) {
      this._buttonPictureInPicture.style.display = "none";
      return;
    }
    if ("documentPictureInPicture" in window) {
      this._togglePip = this._toggleDocumentPip.bind(this);
      this._enterPipEvent = this._handleEnterNativePip.bind(this);
      this._leavePipEvent = this._handleLeaveNativePip.bind(this);
      let pipMessage = document.createElement("div");
      pipMessage.className = "pip-message";
      pipMessage.textContent =
        "Video player is in the Picture-in-Picture window";
      pipMessage.style.display = "none";
      this._container.appendChild(pipMessage);
      this._pipMessage = pipMessage;
    } else if (document.pictureInPictureEnabled) {
      this._pipCaptureStreamMode = true;
      this._togglePip = this._toggieVideoPip.bind(this);
      this._enterPipEvent = this._handleEnterPip.bind(this);
      this._leavePipEvent = this._handleLeavePip.bind(this);
    } else {
      this._buttonPictureInPicture.style.display = "none";
      this._logger.warn("Picture-in-picture API is unavailable");
      return;
    }
    this._addPipEventListeners();
    this._buttonPictureInPicture.addEventListener("click", this._togglePip);
  },

  _addPipEventListeners() {
    let video = this._mediaElement;
    if (video) {
      video.addEventListener(
        "enterpictureinpicture",
        this._enterPipEvent,
        false,
      );
      video.addEventListener(
        "leavepictureinpicture",
        this._leavePipEvent,
        false,
      );
    }
  },

  _cleanupPip() {
    this._clearMediaElementEvents();

    if (this._buttonPictureInPicture && this._togglePip) {
      this._buttonPictureInPicture.removeEventListener(
        "click",
        this._togglePip,
      );
    }
    let pipWindowFrame = this._pipWindowFrame;
    if (pipWindowFrame) {
      this._restoreDocumentPip();
      try {
        pipWindowFrame.close();
      } catch (err) {
        this._logger.warn("Failed to close Picture-in-Picture window", err);
      }
    } else {
      this._pipResizeObserver?.disconnect();
      this._pipResizeObserver = undefined;
    }

    this._destroyCaptureStream();
    this._pipMessage?.remove();
    this._pipMessage = undefined;
    this._pipWindow = undefined;
    this._nativePip = false;
    this._mediaElementMode = false;
    this._togglePip = undefined;
    this._enterPipEvent = undefined;
    this._leavePipEvent = undefined;
  },

  _clearMediaElementEvents() {
    let video = this._mediaElement;
    if (!video) return;
    video.removeEventListener(
      "enterpictureinpicture",
      this._enterPipEvent,
      false,
    );
    video.removeEventListener(
      "leavepictureinpicture",
      this._leavePipEvent,
      false,
    );
    if (this._onCaptureStreamResume) {
      video.removeEventListener("play", this._onCaptureStreamResume);
      this._onCaptureStreamResume = undefined;
    }
    if (this._resumeCaptureTimeout) {
      clearTimeout(this._resumeCaptureTimeout);
      this._resumeCaptureTimeout = undefined;
    }
  },

  async _closeVideoPip() {
    let video = this._mediaElement;
    if (
      document.pictureInPictureElement === video &&
      document.exitPictureInPicture
    ) {
      try {
        await document.exitPictureInPicture();
      } catch (err) {
        this._logger.warn("Failed to exit Picture-in-Picture mode", err);
      }
    }
    this._clearMediaElementEvents();
  },

  async _toggleDocumentPip() {
    let activePip = window.documentPictureInPicture.window;
    if (activePip) {
      activePip.close();
      return;
    }
    if (this._nativePip) {
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture();
      }
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
    this._pipWindowFrame = pipWindow;
    this._onDocumentPipPageHide = () => {
      this._restoreDocumentPip();
      this._handleViewportUpdate();
    };
    pipWindow.addEventListener("pagehide", this._onDocumentPipPageHide);

    this._pipResizeObserver = new ResizeObserver((entries) => {
      requestAnimationFrame(() => {
        this._updateLayout(entries[0].contentRect);
      });
    });
    this._pipResizeObserver.observe(this._pipContainer);
    this._pipMessage.style.display = "flex";
  },

  _restoreDocumentPip() {
    this._pipResizeObserver?.disconnect();
    this._pipResizeObserver = undefined;

    if (this._pipWindowFrame && this._onDocumentPipPageHide) {
      this._pipWindowFrame.removeEventListener(
        "pagehide",
        this._onDocumentPipPageHide,
      );
    }
    this._onDocumentPipPageHide = undefined;

    if (this._pipPlayer && this._container) {
      this._container.append(this._pipPlayer);
    }
    this._pipContainer = undefined;
    this._pipPlayer = undefined;
    this._pipWindowFrame = undefined;
    if (this._pipMessage) {
      this._pipMessage.style.display = "none";
    }
  },

  _toggleModePip(mode) {
    if (this._pipWindow) {
      return false;
    }
    if (this._nativePip) {
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture();
      }
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

  _addPipContainerMediaElement() {
    if (this._pipContainer && this._mediaElement) {
      this._pipContainer.append(this._mediaElement);    
      return true;
    }
    return false;
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
      // Somehow capture stream does not work if we would try to open PiP again,
      // pause/resume fixes it
      video.style.visibility = "hidden";
      video.pause();
      this._onCaptureStreamResume = this._onResumeCaptureStream.bind(this);
      // Restore player picture when capture stream resumed (or after timeout, if it somehow failed to resume)
      // If we would restore it immediately, subsequent PIP window may have black stripes
      video.addEventListener("play", this._onCaptureStreamResume);
      this._resumeCaptureTimeout = setTimeout(this._onCaptureStreamResume, 250);
      video.play();
    } else {
      this._handleViewportUpdate();
    }
  },

  _handleEnterNativePip(event) {
    this._nativePip = true;
  },

  _handleLeaveNativePip() {
    this._nativePip = false;
  },

  _onResumeCaptureStream() {
    clearTimeout(this._resumeCaptureTimeout);
    let video = this._mediaElement;
    video.removeEventListener("play", this._onCaptureStreamResume);
    video.style.display = "none";
    this._canvas.style.display = "block";
    this._onCaptureStreamResume = undefined;
    this._resumeCaptureTimeout = undefined;
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
