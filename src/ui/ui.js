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
import { MODE } from "@/shared/values";

export class UI {
  constructor(instName, container, opts, eventBus) {
    this._state = "pause";
    this._muted = false;
    this._instName = instName;
    this._eventBus = eventBus;
    this._opts = opts;

    this._container = container;
    if (!this._container || !this._container.appendChild) {
      throw new Error("UI container element is not valid");
    }
    Object.assign(this._container.style, {
      display: "inline-flex",
      position: "relative",
    });
    this._container.classList.add("nimio-container");

    this._logger = LoggersFactory.create(this._instName, "UI");

    this._initPlayerSize();
    this._initAspectRatio();
    this._autoAbr = this._opts.abrEnabled;

    this._mode = MODE.LIVE;
    this._outputs = [];
    this._createCanvas();
    if (opts.vod) this._createMediaElement();

    this._outputs.forEach(this._applyBasicStyle);

    this._updateOutputSize(this._baseWidth, this._baseHeight);
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
    while (this._container.firstChild) {
      this._container.removeChild(this._container.firstChild);
    }
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
    let lm = this._layoutMgr;
    this._cctx.drawImage(frame, 0, 0, lm.width, lm.height);
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
    this._cctx.clearRect(0, 0, this._layoutMgr.width, this._layoutMgr.height);
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
    this._applySize(this._mediaElement, this._curWidth, this._curHeight);
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
    this._onResize = this._handleResize.bind(this);
    this._onOrientChange = this._handleOrientChange.bind(this);
    document.addEventListener("fullscreenchange", this._onResize);
    document.addEventListener("webkitfullscreenchange", this._onResize);
    window.addEventListener("resize", this._onResize);
    window.addEventListener("orientationchange", this._onOrientChange);
  }

  _removeDisplayEventHandlers() {
    document.removeEventListener("fullscreenchange", this._onResize);
    document.removeEventListener("webkitfullscreenchange", this._onResize);
    window.removeEventListener("resize", this._onResize);
    window.removeEventListener("orientationchange", this._onOrientChange);
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

  _handleResize() {
    if (this._resizeQueued) return;

    this._resizeQueued = true;
    requestAnimationFrame(() => {
      this._resizeQueued = false;
      this._resizeAndRedraw();
      if (this._thumbnailPreview) this._thumbnailPreview.update();
    });
  }

  _updateOutputSize(w, h) {
    if (this._mode === MODE.LIVE) {
      this._updateCanvasSize(w, h);
    }
    this._outputs.forEach((elem) => {
      this._applySize(elem, w, h);
    });
    this._curWidth = w;
    this._curHeight = h;
  }

  _updateCanvasSize(w, h) {
    // DPR can change when dragging window between monitors, browser zoom, external display attach/detach
    this._dpr = window.devicePixelRatio || 1;

    let devW = w * this._dpr;
    let devH = h * this._dpr;
    if (this._canvas.width === devW && this._canvas.height === devH) return;

    this._bCanvas.width = devW;
    this._bCanvas.height = devH;
    this._bctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    this._bctx.drawImage(this._canvas, 0, 0);

    this._canvas.width = devW;
    this._canvas.height = devH;
    this._cctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    this._cctx.drawImage(this._bCanvas, 0, 0, w, h);
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
    });
  }

  // adjustAspectRatio () {
  //   this.orientMq = window.matchMedia("(orientation: portrait)");
  //   if( this._opts.ar ) {
  //     let curStreamSize = this._context.getCurrentVideoStreamSize();
  //     if( curStreamSize ) {
  //       let w = curStreamSize.width;
  //       let h = curStreamSize.height;

  //       let aW = h * this._opts.ar.x / this._opts.ar.y;
  //       if( aW > w ) {
  //         let aH = w * this._opts.ar.y / this._opts.ar.x;
  //         this._adjustY( aH / h, w, h );
  //       } else if( aW < w) {
  //         this._adjustX( aW / w, w / aW, w, h );
  //       }
  //     }
  //   } else {
  //     this._adjustHeight();
  //   }
  // }

  // _adjustHeight() {
  //   if( this.mediaElement && this.playerWrapper && !this.fullscreenReq && (this.container.offsetHeight > 0) ) {
  //     if( this._isFullscreenMode() ) {
  //       this._updateFullscreenWrapperSize();
  //     } else if( '100%' === this.settings.height ) {
  //       this.playerWrapper.style.height = `${this.container.offsetHeight}px`;
  //     }
  //   }
  // }

  // _adjustX( xR, rX, w, h ) {
  //   if( !this._processContainerSize() ) {
  //     return;
  //   }
  //   if( !this.cW ) {
  //     this.cW = this.cH * w * xR / h;
  //   }
  //   let vHeight = this.cW * h / w;
  //   let wrpHeight = vHeight / xR;

  //   let xTransform = 'scaleX(' + xR + ')';
  //   let xyTransform = ' scale(' + rX + ')';
  //   let mPercent = 50 * (rX - 1) * h / w;
  //   if( undefined !== this.cH ) {
  //     if( this.cH > wrpHeight + 0.5 ) {
  //       let hDiff = this.cH - wrpHeight;
  //       wrpHeight = this.cH;
  //       mPercent += 50 * hDiff / this.cW;
  //     } else if( this.cH < wrpHeight - 0.5 ) {
  //       let hDiff = wrpHeight - this.cH;
  //       wrpHeight = this.cH;
  //       xyTransform = ' scale(' + wrpHeight / vHeight + ')';
  //       mPercent -= 50 * hDiff / this.cW;
  //     }
  //   }
  //   this.mediaElement.style.transform = xTransform + xyTransform;

  //   this.mediaElement.style.margin = mPercent + '% 0';
  //   this.mediaElement.style.height = `${Math.round(vHeight)}px`;
  //   if( this.playerWrapper ) {
  //     let vActHeight = this.mediaElement.getBoundingClientRect().height;
  //     if( vActHeight ) vActHeight = Math.ceil(vActHeight);
  //     wrpHeight = Math.round(wrpHeight);
  //     if( wrpHeight < vActHeight ) wrpHeight = vActHeight;
  //     this.playerWrapper.style.height = `${wrpHeight}px`;
  //   }
  // }

  // _adjustY( yR, w, h ) {
  //   if( !this._processContainerSize() ) {
  //     return;
  //   }
  //   if( !this.cW ) {
  //     this.cW = this.cH * w / (h * yR);
  //   }
  //   let vHeight = this.cW * h / w;
  //   let wrpHeight = vHeight * yR;
  //   let hDiff = vHeight - wrpHeight;

  //   let yTransform = 'scaleY(' + yR + ')';
  //   let xyTransform = '';
  //   if( undefined !== this.cH ) {
  //     if( this.cH > wrpHeight + 0.5 ) {
  //       wrpHeight = this.cH;
  //       vHeight = wrpHeight + hDiff;
  //     } else if( this.cH < wrpHeight - 0.5 ) {
  //       wrpHeight = this.cH;
  //       vHeight = wrpHeight + hDiff;
  //       let xyR = wrpHeight / (vHeight * yR);
  //       xyTransform = ' scale(' + xyR + ')';
  //     }
  //   }
  //   this.mediaElement.style.transform = yTransform + xyTransform;

  //   let mPercent = 50 * (1 - yR) * h / w;
  //   this.mediaElement.style.margin = '-' + mPercent + '% 0';
  //   this.mediaElement.style.height = `${Math.round(vHeight)}px`;
  //   if( this.playerWrapper ) {
  //     this.playerWrapper.style.height = `${Math.round(wrpHeight)}px`;
  //   }
  // }

  // _getScreenSize () {
  //   var isPortrait = this.orientMq.matches;

  //   var result = [screen.width, screen.height];
  //   if( isPortrait && (screen.width > screen.height) ||
  //      !isPortrait && (screen.width < screen.height) ) {
  //     result[0] = screen.height;
  //     result[1] = screen.width;
  //   }
  //   return result;
  // }

  // _processContainerSize() {
  //   this.cW = this.settings.width;
  //   this.cH = this.settings.height;
  //   let isFullscreen = this._isFullscreenMode();
  //   if( isFullscreen ) {
  //     var scrSize = this._getScreenSize();
  //     this.cW = scrSize[0];
  //     this.cH = scrSize[1];
  //     this._stashCurrentSize();
  //   } else if( !this.stashed ) {
  //     if( '100%' === this.settings.width ) {
  //       if( this.stashedContWidth ) {
  //         this.cW = this.stashedContWidth;
  //         this.stashedContWidth = undefined;
  //       } else {
  //         this.cW = this._getContainerWidth();
  //         if( !this.cW ) {
  //           this.cW = this.playerWrapper ? this.playerWrapper.offsetWidth :
  //                                           this.mediaElement.offsetWidth;
  //         }
  //         this.currentContWidth = this.cW;
  //       }
  //     }
  //     if( '100%' === this.settings.height ) {
  //       if( this.stashedContHeight ) {
  //         this.cH = this.stashedContHeight;
  //         this.stashedContHeight = undefined;
  //       } else {
  //         this.cH = this._getContainerHeight();
  //         if( !this.cH ) {
  //           this.cH = this.playerWrapper ? this.playerWrapper.offsetHeight :
  //                                           this.mediaElement.offsetHeight;
  //         }
  //         this.currentContHeight = this.cH;
  //       }
  //     }
  //     if( !this.settings.width && !this.settings.height ) {
  //       this.cW = this.mediaElement.offsetWidth;
  //     }
  //   } else { // original video element size isn't yet restored after fullscreen mode
  //     return false;
  //   }
  //   return true;
  // }
}
