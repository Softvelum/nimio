import {} from "./ui.css";
import { DebugView } from "./debug-view";
import controlsHtml from "./controls.html?raw";
import controlsCss from "./controls.css?raw";
import { UISeekBar } from "./seek-bar";
import { UITimeIndicator } from "./time-indicator";
import { LoggersFactory } from "@/shared/logger";
import { PlaybackProgressService } from "@/playback/progress-service";
import { UIThumbnailPreview } from "./thumbnail-preview";
import { UICaptionController } from "./caption-controller";
import { UICaptionList } from "./caption-list";
import { UILayoutManager } from "./layout-manager";
import { MODE } from "@/shared/values";

export class UI {
  constructor(instName, parent, opts, eventBus) {
    this._state = "pause";
    this._muted = false;
    this._instName = instName;
    this._eventBus = eventBus;
    this._opts = opts;
    this._logger = LoggersFactory.create(this._instName, "UI");

    this._parent = parent;
    if (!this._parent || !this._parent.appendChild) {
      throw new Error("UI container element is not valid");
    }

    this._container = document.createElement("div");
    this._parent.appendChild(this._container);
    this._container.classList.add("nimio-container");
    Object.assign(this._container.style, {
      display: "block",
      position: "relative",
      "background-color": "#000",
    });

    this._dpr = window.devicePixelRatio || 1;
    this._layoutMgr = new UILayoutManager(
      this._opts.width,
      this._opts.height,
      this._opts.ar,
    );
    Object.assign(this._container.style, this._layoutMgr.containerLayout());
    this._createResizeObserver();

    this._autoAbr = this._opts.abrEnabled;
    this._mode = MODE.LIVE;
    this._outputs = [];
    this._createCanvas();
    if (opts.vod) this._createMediaElement();

    this._outputs.forEach(this._applyBasicStyle);
    this._logger.debug(`Device DPR = ${this._dpr}`);

    this._cctx.save();
    this._cctx.scale(this._dpr, this._dpr);
    this._cctx.restore();

    this._outputs.forEach((elem) => this._container.appendChild(elem));

    this._btnPlayPause = document.createElement("div");
    this._btnPlayPause.classList.add("play-pause");
    this._button = document.createElement("div");
    this._button.classList.add("play");
    this._btnPlayPause.appendChild(this._button);
    this._container.appendChild(this._btnPlayPause);

    this._onClick = this._handleClick.bind(this);
    this._canvas.addEventListener("click", this._onClick);
    this._btnPlayPause.addEventListener("click", this._onClick);
    this._addPlaybackEventHandlers();
    this._addDisplayEventHandlers();

    this._createControls(opts);
    this._setupEasing();
    if (this._opts.captions && !this._opts.audioOnly) {
      this._captionCtrl = UICaptionController.getInstance(this._instName);
      this._captionCtrl.init(this._container, this._opts.captions);

      this._captionList = new UICaptionList(this._controlsBar, this._eventBus);
      this._captionCtrl.list = this._captionList;
      this._eventBus.on("aux:caption-list-open", () => this._closeAbrMenu());
    }

    if (this._opts.fullscreen) {
      this._toggleFullscreen();
    }
    if (this._opts.splashScreen) {
      this._splashScreenUrl = `url("${this._opts.splashScreen}")`;
    }
    this._setBackground();
  }

  destroy() {
    this._clearHideControlsTimer();
    this._removeSeekBar();
    this._removeCaptions();
    this._removePlaybackEventHandlers();
    this._removeControlsEventHandlers();
    this._removeDisplayEventHandlers();
    this._container.removeEventListener("mousemove", this._onMouseMove);
    this._container.removeEventListener("mouseout", this._onMouseOut);
    this._container.removeEventListener("click", this._onClick);
    this._resizeObserver.unobserve(this._container);
    while (this._container.firstChild) {
      this._container.removeChild(this._container.firstChild);
    }
    this._parent.removeChild(this._container);
  }

  drawPlay() {
    this._state = "pause";
    this._button.classList.remove("pause");
    this._button.classList.add("play");
    this._buttonPlayPause.querySelector(".icon-play").style.display = "block";
    this._buttonPlayPause.querySelector(".icon-pause").style.display = "none";
  }

  drawPause() {
    this._state = "play";
    this._button.classList.remove("play");
    this._button.classList.add("pause");
    this._buttonPlayPause.querySelector(".icon-play").style.display = "none";
    this._buttonPlayPause.querySelector(".icon-pause").style.display = "block";
  }

  drawFrame(frame) {
    let rp = this._rendProps;
    if (!rp) return;

    this._cctx.drawImage(frame, rp.dx, rp.dy, rp.dWidth, rp.dHeight);
  }

  showControls(anim) {
    this._btnPlayPause.style.transition = anim ? "opacity 0.2s ease" : "none";
    this._btnPlayPause.style.opacity = "0.7";

    this._controlsBar.style.transition = anim ? "opacity 0.2s ease" : "none";
    this._controlsBar.style.opacity = "1";
  }

  hideControls(anim) {
    this._btnPlayPause.style.transition = anim ? "opacity 0.5s ease" : "none";
    this._btnPlayPause.style.opacity = "0";

    this._controlsBar.style.transition = anim ? "opacity 0.2s ease" : "none";
    this._controlsBar.style.opacity = "0";
  }

  clear() {
    if (!this._rendProps) return;
    this._cctx.clearRect(0, 0, this._rendProps.width, this._rendProps.height);
  }

  toggleMode(mode) {
    if (mode === this._mode) return;

    if (mode === MODE.LIVE) {
      this._mediaElement.style.display = "none";
      this._canvas.style.display = "block";
      this._liveSign.style.display = "inline-grid";
      if (this._captionCtrl) {
        this._captionList.refresh();
      }
    } else {
      this._canvas.style.display = "none";
      this._mediaElement.style.display = "block";
      if (!this._isPlayerFullscreen() && this._rendProps) {
        // keep the media element size same as the canvas during switch
        this._mediaElement.style.width = `${this._rendProps.width}px`;
        this._mediaElement.style.height = `${this._rendProps.height}px`;
      }
      this._liveSign.style.display = "none";
    }

    this._mode = mode;
  }

  replaceMediaElement() {
    this._removeMediaElement();
    this._addMediaElement();
    this._mediaElement.style.display = "block";
  }

  setDetached() {
    this._layoutMgr.pause();
    this._hideCaptions();
  }

  appendDebugOverlay(state, videoBuffer) {
    return new DebugView(this._container, state, videoBuffer);
  }

  get canvas() {
    return this._canvas;
  }

  get mediaElement() {
    return this._mediaElement;
  }

  get captionController() {
    return this._captionCtrl;
  }

  get size() {
    let output = this._mode === MODE.LIVE ? this._canvas : this._mediaElement;
    let box = output.getBoundingClientRect();
    return [box.width, box.height];
  }

  _createCanvas() {
    this._canvas = document.createElement("canvas");
    this._bCanvas = new OffscreenCanvas(0, 0);
    this._cctx = this._canvas.getContext("2d");
    this._bctx = this._bCanvas.getContext("2d");

    this._outputs.push(this._canvas);
  }

  _createMediaElement() {
    let type = this._opts.audioOnly ? "audio" : "video";
    this._mediaElement = document.createElement(type);
    this._mediaElement.setAttribute("playsinline", "playsinline");
    this._mediaElement.style["background-color"] = "#000";
    this._mediaElement.style.display = "none";
    this._outputs.push(this._mediaElement);
  }

  _addMediaElement() {
    this._createMediaElement();
    this._applyBasicStyle(this._mediaElement);
    this._canvas.after(this._mediaElement);
  }

  _removeMediaElement() {
    this._mediaElement.remove();
    this._outputs.length = 1; // Media Element is always second in outputs array
  }

  _createControls(opts) {
    const tpl = document.createElement("template");
    tpl.innerHTML = controlsHtml.trim();

    const frag = tpl.content.cloneNode(true);
    this._controlsBar = frag.querySelector(".nimio-controls");
    this._container.appendChild(frag);

    this._buttonPlayPause = this._controlsBar.querySelector(".btn-play-pause");
    this._buttonVolume = this._controlsBar.querySelector(".btn-volume");
    this._volumeRange = this._controlsBar.querySelector(".volume-range");
    this._buttonSettings = this._controlsBar.querySelector(".btn-settings");
    this._abrMenuPopover = this._controlsBar.querySelector(".abr-menu");
    this._abrMenuSection = this._abrMenuPopover.querySelector(".menu-section");
    this._buttonPictureInPicture = this._controlsBar.querySelector(".btn-pip");

    if (opts.vod) {
      this._seekBar = new UISeekBar(this._instName, this._controlsBar);
      this._playPrgSvc = PlaybackProgressService.getInstance(this._instName);
      this._playPrgSvc.setUI(this._seekBar);

      this._timeInd = new UITimeIndicator(this._instName, this._controlsBar);
      this._playPrgSvc.setTimeIndUI(this._timeInd);

      if (!this._opts.audioOnly) {
        this._thumbnailPreview = new UIThumbnailPreview(this._instName, {
          parent: this._controlsBar,
          preview: this._opts.thumbnails,
          baseUrl: opts.vod.thumbnailBaseUrl || "",
          offsetFn: () => this._seekBar.node.getBoundingClientRect().x,
        });
        this._seekBar.hoverHandler = this._thumbnailPreview;
        this._controlsBar.appendChild(this._thumbnailPreview.node);
      }
      this._liveSign = this._controlsBar.querySelector(".live-wrap");
    }
    this._addControlsEventHandlers();
    this._setupPip();

    this._onFullscreenClick = this._toggleFullscreen.bind(this);
    this._buttonFullscreen = this._controlsBar.querySelector(".btn-fullscreen");
    this._buttonFullscreen.addEventListener("click", this._onFullscreenClick);
    this._canvas.addEventListener("dblclick", this._onFullscreenClick);

    const style = document.createElement("style");
    style.textContent = controlsCss;
    document.head.appendChild(style);
  }

  _addControlsEventHandlers() {
    this._onMuteUnmuteClick = this._handleMuteUnmuteClick.bind(this);
    this._onVolumeChange = this._onVolumeChange.bind(this);
    this._onSettingsClick = this._handleSettingsClick.bind(this);

    this._buttonPlayPause.addEventListener("click", this._onClick);
    this._buttonVolume.addEventListener("click", this._onMuteUnmuteClick);
    this._volumeRange.addEventListener("input", this._onVolumeChange);
    this._buttonSettings.addEventListener("click", this._onSettingsClick);
  }

  _removeControlsEventHandlers() {
    this._buttonPlayPause.removeEventListener("click", this._onClick);
    this._buttonVolume.removeEventListener("click", this._onMuteUnmuteClick);
    this._volumeRange.removeEventListener("input", this._onVolumeChange);
    this._buttonSettings.removeEventListener("click", this._onSettingsClick);
  }

  _addPlaybackEventHandlers() {
    this._onVolumeSet = this._onVolumeSet.bind(this);
    this._onMuteUnmuteSet = this._onMuteUnmuteSet.bind(this);
    this._onRenditionSet = this._onRenditionSet.bind(this);
    this._onRenditionsReceived = this._onRenditionsReceived.bind(this);
    this._onAdaptiveBitrateSet = this._onAdaptiveBitrateSet.bind(this);
    this._onRendMenuSelected = this._onRendMenuSelected.bind(this);
    this._onPlaybackStarting = this._onPlaybackStarting.bind(this);
    this._onPlaybackStarted = this._onPlaybackStarted.bind(this);
    this._onPlaybackPaused = this._onPlaybackPaused.bind(this);
    this._onPlaybackEnded = this._onPlaybackEnded.bind(this);

    this._eventBus.on("nimio:volume-set", this._onVolumeSet);
    this._eventBus.on("nimio:muted", this._onMuteUnmuteSet);
    this._eventBus.on("nimio:rendition-set", this._onRenditionSet);
    this._eventBus.on("nimio:rendition-list", this._onRenditionsReceived);
    this._eventBus.on("nimio:abr", this._onAdaptiveBitrateSet);
    this._eventBus.on("nimio:play", this._onPlaybackStarting);
    this._eventBus.on("nimio:pause", this._onPlaybackPaused);
    this._eventBus.on("nimio:playback-start", this._onPlaybackStarted);
    this._eventBus.on("nimio:playback-end", this._onPlaybackEnded);
  }

  _removePlaybackEventHandlers() {
    this._eventBus.off("nimio:volume-set", this._onVolumeSet);
    this._eventBus.off("nimio:muted", this._onMuteUnmuteSet);
    this._eventBus.off("nimio:rendition-set", this._onRenditionSet);
    this._eventBus.off("nimio:rendition-list", this._onRenditionsReceived);
    this._eventBus.off("nimio:abr", this._onAdaptiveBitrateSet);
    this._eventBus.off("nimio:play", this._onPlaybackStarting);
    this._eventBus.off("nimio:pause", this._onPlaybackPaused);
    this._eventBus.off("nimio:playback-start", this._onPlaybackStarted);
    this._eventBus.off("nimio:playback-end", this._onPlaybackEnded);
  }

  _addDisplayEventHandlers() {
    this._onViewportUpd = this._handleViewportUpdate.bind(this);
    document.addEventListener("fullscreenchange", this._onViewportUpd);
    document.addEventListener("webkitfullscreenchange", this._onViewportUpd);
    window.addEventListener("orientationchange", this._onViewportUpd);
    this._onLayoutUpdate = this._handleLayoutUpdate.bind(this);
    this._eventBus.on("aux:layout-update", this._onLayoutUpdate);
  }

  _removeDisplayEventHandlers() {
    document.removeEventListener("fullscreenchange", this._onViewportUpd);
    document.removeEventListener("webkitfullscreenchange", this._onViewportUpd);
    window.removeEventListener("orientationchange", this._onViewportUpd);
    this._eventBus.off("aux:layout-update", this._onLayoutUpdate);
  }

  _removeSeekBar() {
    if (this._seekBar) {
      this._playPrgSvc.unsetUI();
      this._seekBar.destroy();
      this._seekBar = undefined;
    }

    if (this._timeInd) {
      this._playPrgSvc.unsetTimeIndUI();
      this._timeInd.destroy();
      this._timeInd = undefined;
    }

    if (this._thumbnailPreview) {
      this._thumbnailPreview.destroy();
      this._thumbnailPreview = undefined;
    }
  }

  _removeCaptions() {
    if (!this._captionCtrl) return;
    this._captionCtrl.deinit();
    this._captionCtrl = undefined;
    this._captionList = undefined;
  }

  _setupEasing() {
    this._hideTimer = null;
    this._onMouseMove = (e) => this._handleMouseMove(e);
    this._container.addEventListener("mousemove", this._onMouseMove);
    this._onMouseOut = (e) => this._handleMouseOut(e);
    this._container.addEventListener("mouseout", this._onMouseOut);
  }

  _setupPip() {
    if ("documentPictureInPicture" in window) {
      this._togglePip = this._toggleDocumentPip.bind(this);
    } else {
      this._togglePip = this._toggieVideoPip.bind(this);
    }
    this._buttonPictureInPicture.addEventListener("click", this._togglePip);
  }

  _onRenditionsReceived(renditions) {
    if (!Array.isArray(renditions)) {
      this._logger.error("_onRenditionsReceived: not an array");
      return;
    }

    const autoBtn = this._abrMenuSection.querySelector("button.rendition-auto");
    let showAuto = this._opts.abrEnabled && renditions.length > 0;
    autoBtn.style.display = showAuto ? "block" : "none";
    autoBtn.dataset.rendition = "auto";
    this._abrMenuSection.querySelectorAll("button.menu-item").forEach((btn) => {
      if (btn !== autoBtn) btn.remove();
    });

    renditions.forEach((rendition) => {
      const button = document.createElement("button");
      button.className = "menu-item";
      button.setAttribute("role", "menuitemradio");
      button.setAttribute("aria-checked", "false");
      button.dataset.rendition = rendition.name;
      button.dataset.rid = rendition.id;
      button.textContent = rendition.name;
      button._rendition = rendition;
      this._abrMenuSection.appendChild(button);
    });

    this._enableSelection();
  }

  _toggleAutoAbrButton() {
    const res = this._abrMenuSection.querySelector("button.rendition-auto");
    res.setAttribute("aria-checked", this._autoAbr ? "true" : "false");
    if (this._autoAbr) {
      res.style.display = "block";
      if (this._curRendition) {
        const delim = "\u00A0\u00A0";
        res.textContent = `Auto${delim}${this._curRendition.rendition}`;
      }
    } else {
      res.textContent = "Auto";
    }
    return res;
  }

  _enableSelection() {
    this._abrMenuSection.removeEventListener("click", this._onRendMenuSelected);
    this._abrMenuSection.addEventListener("click", this._onRendMenuSelected);
  }

  _selectRendition(selectedBtn) {
    let selRendition = selectedBtn._rendition || { name: "Auto" };
    this._eventBus.emit("ui:rendition-select", {
      mode: this._mode,
      rend: selRendition,
    });
  }

  _onRendMenuSelected(e) {
    const btn = e.target.closest("button.menu-item");
    if (!btn) return;
    this._selectRendition(btn);
    this._closeAbrMenu();
  }

  _closeAbrMenu() {
    this._abrMenuPopover.hidden = true;
  }

  _onRenditionSet(rData) {
    this._curRendition = rData;
    this._applyCurrentRendition();
  }

  _applyCurrentRendition() {
    if (!this._curRendition) {
      this._logger.error("No current rendition to apply!");
      return;
    }
    this._toggleAutoAbrButton();

    this._abrMenuSection.querySelectorAll("button.menu-item").forEach((btn) => {
      if (btn.dataset.rendition === "auto") return;
      let isSel =
        !this._autoAbr &&
        this._curRendition.rendition === btn.dataset.rendition &&
        this._curRendition.id === parseInt(btn.dataset.rid);
      btn.setAttribute("aria-checked", isSel ? "true" : "false");
    });
  }

  async _toggleFullscreen(e) {
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

  _isPlayerFullscreen() {
    let fElem = document.fullscreenElement || document.webkitFullscreenElement;
    return fElem === this._container;
  }

  _createResizeObserver() {
    this._resizeObserver = new ResizeObserver((entries) => {
      requestAnimationFrame(() => {
        this._updateLayout(entries[0].contentRect);
      });
    });
    this._resizeObserver.observe(this._container);
  }

  _handleLayoutUpdate(data) {
    if (!data.width || !data.height) return;

    this._layoutMgr.setFrameSize(data.width, data.height);
    let container = this._pipContainer ?? this._container;
    if (!container) return;
    this._updateLayout(container.getBoundingClientRect());
  }

  _handleViewportUpdate() {
    if (this._viewportUpdatePending) return;

    this._viewportUpdatePending = true;
    // double RAF for fullscreen and orientation change events
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this._viewportUpdatePending = false;
        let container = this._pipContainer ?? this._container;
        if (!container) return;
        this._updateLayout(container.getBoundingClientRect());
      });
    });
  }

  _updateLayout(rect) {
    if (this._layoutUpdatePending) return;
    const pipMode = this._pipContainer !== undefined;
    this._layoutUpdatePending = true;
    requestAnimationFrame(() => {
      this._layoutUpdatePending = false;
      this._resizeAndRedraw(rect, pipMode);
      if (this._thumbnailPreview) this._thumbnailPreview.update();
    });
  }

  _resizeAndRedraw(rect, pipMode) {
    let cssProps = this._layoutMgr.fullLayout(
      rect.width,
      rect.height,
      this._mode,
      pipMode || this._isPlayerFullscreen(),
    );
    if (!cssProps) return;
    let container = pipMode ? this._pipContainer : this._container;
    container.style.width = cssProps.container.width;
    container.style.height = cssProps.container.height;
    let output = this._mode === MODE.LIVE ? this._canvas : this._mediaElement;
    output.style.width = cssProps.output.width;
    output.style.height = cssProps.output.height;
    output.style["object-fit"] = cssProps.output["object-fit"];
    output.style["aspect-ratio"] = cssProps.output["aspect-ratio"];

    if (this._mode === MODE.LIVE) {
      this._prevRendProps = this._rendProps;
      this._rendProps = this._layoutMgr.computeRenderProps(
        rect.width,
        rect.height,
      );
      this._updateCanvasSize();
    }
  }

  _updateCanvasSize() {
    // DPR can change when dragging window between monitors,
    // browser zoom, external display attach/detach
    this._dpr = window.devicePixelRatio || 1;
    let dprWidth = this._rendProps.width * this._dpr;
    let dprHeight = this._rendProps.height * this._dpr;
    if (this._canvas.width === dprWidth && this._canvas.height === dprHeight) {
      return;
    }

    this._bCanvas.width = dprWidth;
    this._bCanvas.height = dprHeight;
    this._bctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);

    const prp = this._prevRendProps || this._rendProps;
    const rp = this._rendProps;
    this._bctx.drawImage(
      this._canvas,
      prp.dx,
      prp.dy,
      prp.dWidth,
      prp.dHeight,
      rp.dx,
      rp.dy,
      rp.dWidth,
      rp.dHeight,
    );

    this._canvas.width = dprWidth;
    this._canvas.height = dprHeight;
    this._cctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    this._cctx.drawImage(
      this._bCanvas,
      rp.dx,
      rp.dy,
      rp.dWidth,
      rp.dHeight,
      rp.dx,
      rp.dy,
      rp.dWidth,
      rp.dHeight,
    );
  }

  _handleClick(e) {
    let isPlayClicked = "pause" === this._state;
    this._eventBus.emit("ui:play-pause-click", {
      mode: this._mode,
      play: isPlayClicked,
    });
  }

  _handleMuteUnmuteClick() {
    this._muted = !this._muted;
    this._eventBus.emit("ui:mute-unmute-click", this._muted);
  }

  _onMuteUnmuteSet(muted) {
    this._muted = muted;
    let muteIcon = this._buttonVolume.querySelector(".icon-vol-mute");
    let unmuteIcon = this._buttonVolume.querySelector(".icon-vol-unmute");

    muteIcon.style.display = this._muted ? "none" : "block";
    unmuteIcon.style.display = this._muted ? "block" : "none";
  }

  _onVolumeChange(e) {
    this._handleVolumeChange(Number(e.target.value));
  }

  _handleVolumeChange(value) {
    if (this._muted || value === 0) {
      this._handleMuteUnmuteClick();
    }
    this._eventBus.emit("ui:volume-change", value);
  }

  _onVolumeSet(value) {
    this._volumeRange.value = value;
  }

  _onAdaptiveBitrateSet(val) {
    this._autoAbr = val;
    this._applyCurrentRendition();
  }

  _handleSettingsClick(e) {
    if (this._captionList) this._captionList.closeDialog();
    this._abrMenuPopover.hidden = !this._abrMenuPopover.hidden;
  }

  _handleMouseMove(e) {
    this.showControls(true);
    this._clearHideControlsTimer();
    this._setHideControlsTimer(2);
  }

  _handleMouseOut(e) {
    this._clearHideControlsTimer();
    this.hideControls(true);
  }

  _setHideControlsTimer(secs) {
    this._hideTimer = setTimeout(() => {
      if (this._seekBar && this._seekBar.isPending()) {
        this._clearHideControlsTimer();
        this._setHideControlsTimer(secs);
      } else {
        this.hideControls(true);
      }
    }, 1000 * secs);
  }

  _clearHideControlsTimer() {
    if (!this._hideTimer) return;
    clearTimeout(this._hideTimer);
    this._hideTimer = undefined;
  }

  _onPlaybackStarting() {
    this.drawPause();
  }

  _onPlaybackStarted(data) {
    this.drawPause();
    this._unsetBackground();
    this._layoutMgr.resume();
    if (data.mode === MODE.LIVE) {
      if (this._captionCtrl) {
        this._captionCtrl.resume();
        this._captionList.refresh();
      }
    }
  }

  _onPlaybackPaused(data) {
    if (data.mode === MODE.LIVE) {
      if (this._captionCtrl) this._captionCtrl.pause();
    }
    this.drawPlay();
  }

  _onPlaybackEnded(data) {
    if (data.mode === MODE.LIVE) {
      this._setBackground();
      this._hideCaptions();
    }
    this._layoutMgr.pause();
    this.drawPlay();
  }

  _setBackground() {
    if (this._splashScreenUrl) {
      this._canvas.style.removeProperty("background-color");
      setTimeout(() => {
        // misterious chrome bug
        this._canvas.style["background-color"] = "#000";
        this._canvas.style["background-image"] = this._splashScreenUrl;
        this._canvas.style["background-size"] = "cover";
      }, 0);
    } else {
      this._canvas.style["background-color"] = "#000";
    }
  }

  _unsetBackground() {
    if (!this._splashScreenUrl) return;
    this._canvas.style["background-image"] = "";
    this._canvas.style["background-size"] = "";
  }

  _hideCaptions() {
    if (!this._captionCtrl) return;
    this._captionCtrl.clear();
    this._captionList.hide();
  }

  _applyBasicStyle(elem) {
    Object.assign(elem.style, {
      cursor: "pointer",
      zIndex: 10,
      margin: "auto",
      position: "relative",
    });
  }

  async _toggleDocumentPip(ev) {
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
    pipWindow.document.body.append(rootDiv);
    let playerContainer = this._container;
    this._pipWindow = pipWindow;
    pipWindow.addEventListener("pagehide", (event) => {
      //inPipMessage.style.display = "none";
      this._pipContainer = undefined;
      playerContainer.append(videoPlayer);
    });

    if (MODE.LIVE === this._mode) {
      const rect = window.getBoundingClientRect();
      this._updateLayout(rect);
    }
    // TODO: Display a message to say it has been moved
  }

  async _toggieVideoPip(ev) {
    if (MODE.VOD === this._mode) {
      window.addEventListener('enterpictureinpicture', this._handleEnterPip.bind(this), false);
      window.addEventListener('leavepictureinpicture', this._handleLeavePip.bind(this), false);
      await this._mediaElement.requestPictureInPicture();
      return;
    } else {
      // TODO: capture frames from canvas and feed to video element
    }
  }

  _handleEnterPip (event) {
    this._pipWindow = event.pictureInPictureWindow;
  }

  _handleLeavePip () {
    this._pipWindow = undefined;
  }

}
