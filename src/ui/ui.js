import {} from "./ui.css";
import { DebugView } from "./debug-view";
import controlsHtml from "./controls.html?raw";
import controlsCss from "./controls.css?raw";

export class Ui {
  constructor(container, opts, eventBus) {
    this._state = "pause";
    this._muted = false;
    this._eventBus = eventBus;
    this._logger = opts.logger;
    this._autoAbr = opts.autoAbr;

    this._container = document.getElementById(container);
    Object.assign(this._container.style, {
      display: "inline-flex",
      position: "relative",
    });
    this._container.classList.add("nimio-container");

    // todo if no options, get from container
    this._baseWidth = opts.width;
    this._baseHeight = opts.height;

    this._canvas = document.createElement("canvas");
    this._updateCanvasSize(this._baseWidth, this._baseHeight);
    this._dpr = window.devicePixelRatio || 1;
    this._logger.warn("DPR", this._dpr);

    this._cctx = this._canvas.getContext("2d");
    this._cctx.save();
    this._cctx.scale(this._dpr, this._dpr);
    this._cctx.restore();
    Object.assign(this._canvas.style, {
      cursor: "pointer",
      zIndex: 10,
      margin: "auto",
      "background-color": "grey",
    });
    this._container.appendChild(this._canvas);

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

    this._createControls();
    this._setupEasing();
    if (opts.fullscreen) {
      this._toggleFullscreen();
    }
  }

  destroy() {
    if (this._hideTimer) {
      clearTimeout(this._hideTimer);
    }
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

  appendDebugOverlay(state, videoBuffer) {
    return new DebugView(this._container, state, videoBuffer);
  }

  get canvas() {
    return this._canvas;
  }

  get size() {
    let box = this._canvas.getBoundingClientRect();
    return [box.width, box.height];
  }

  _createControls() {
    const tpl = document.createElement("template");
    tpl.innerHTML = controlsHtml.trim();

    const frag = tpl.content.cloneNode(true);
    this._controlsBar = frag.querySelector(".nimio-controls");
    this._container.appendChild(frag);

    this._buttonPlayPause = this._controlsBar.querySelector(".btn-play-pause");
    this._buttonVolume = this._controlsBar.querySelector(".btn-volume");
    this._volumeRange = this._controlsBar.querySelector(".volume-range");
    this._buttonSettings = this._controlsBar.querySelector(".btn-settings");
    this._menuPopover = this._controlsBar.querySelector(".menu-popover");
    this._menuSection = this._menuPopover.querySelector(".menu-section");
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

    this._eventBus.on("nimio:volume-set", this._onVolumeSet);
    this._eventBus.on("nimio:muted", this._onMuteUnmuteSet);
    this._eventBus.on("nimio:rendition-set", this._onRenditionSet);
    this._eventBus.on("nimio:rendition-list", this._onRenditionsReceived);
    this._eventBus.on("nimio:abr", this._onAdaptiveBitrateSet);
  }

  _removePlaybackEventHandlers() {
    this._eventBus.off("nimio:volume-set", this._onVolumeSet);
    this._eventBus.off("nimio:muted", this._onMuteUnmuteSet);
    this._eventBus.off("nimio:rendition-set", this._onRenditionSet);
    this._eventBus.off("nimio:rendition-list", this._onRenditionsReceived);
    this._eventBus.off("nimio:abr", this._onAdaptiveBitrateSet);
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

    const autoBtn = this._menuSection.querySelector("button.rendition-auto");
    autoBtn.style.display = this._autoAbr ? "block" : "none";
    autoBtn.dataset.rendition = "auto";
    this._menuSection.querySelectorAll("button.menu-item").forEach((btn) => {
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
      this._menuSection.appendChild(button);
    });

    this._enableSelection();
  }

  _toggleAutoAbrButton() {
    const res = this._menuSection.querySelector("button.rendition-auto");
    res.setAttribute("aria-checked", this._autoAbr ? "true" : "false");
    if (this._autoAbr) {
      res.style.display = "block";
      if (this._curRendition) {
        const delim = "\u00A0\u00A0";
        res.textContent = `Auto${delim}${this._curRendition.name}`;
      }
    } else {
      res.textContent = "Auto";
    }
    return res;
  }

  _enableSelection() {
    this._menuSection.removeEventListener("click", this._onRendMenuSelected);
    this._menuSection.addEventListener("click", this._onRendMenuSelected);
  }

  _selectRendition(selectedBtn) {
    let selRendition = selectedBtn._rendition || { name: "Auto" };
    this._eventBus.emit("ui:rendition-change", selRendition);
  }

  _onRendMenuSelected(e) {
    const btn = e.target.closest("button.menu-item");
    if (!btn) return;
    this._selectRendition(btn);
    this._menuPopover.hidden = true;
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

    this._menuSection.querySelectorAll("button.menu-item").forEach((btn) => {
      if (btn.dataset.rendition === "auto") return;
      let isSel =
        !this._autoAbr &&
        this._curRendition.name === btn.dataset.rendition &&
        this._curRendition.id === parseInt(btn.dataset.rid);
      btn.setAttribute("aria-checked", isSel ? "true" : "false");
    });
  }

  _isPlayerFullscreen() {
    let fElem = document.fullscreenElement || document.webkitFullscreenElement;
    return fElem === this._container;
  }

  _handleResize() {
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

      this._updateCanvasSize(newWidth, newHeight);
    } else {
      this._updateCanvasSize(this._baseWidth, this._baseHeight);
    }
  }

  _updateCanvasSize(width, height) {
    // TODO: check if DPR is needed here
    this._canvas.width = width;
    this._canvas.height = height;
    this._canvas.style.width = `${width}px`;
    this._canvas.style.height = `${height}px`;
    this._ar = width / height;
  }

  _handleOrientChange(e) {
    // orientationchange can fire before actual size update
    // TODO: rework this using more granular approach involving aspect ratio
    setTimeout(this._onResize, 250);
  }

  _handleClick(e) {
    let isPlayClicked = "pause" === this._state;
    isPlayClicked ? this.drawPause() : this.drawPlay();
    this._eventBus.emit("ui:play-pause-click", isPlayClicked);
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
    this._menuPopover.hidden = !this._menuPopover.hidden;
  }

  _handleMouseMove(e) {
    this.showControls(true);
    clearTimeout(this._hideTimer);

    this._hideTimer = setTimeout(() => {
      this.hideControls(true);
    }, 2000);
  }

  _handleMouseOut(e) {
    this.hideControls(true);
    if (this._hideTimer) {
      clearTimeout(this._hideTimer);
    }
  }

  async _toggleFullscreen(e) {
    if (!this._isPlayerFullscreen()) {
      await this._container.requestFullscreen({ navigationUI: "hide" });
    } else {
      await document.exitFullscreen();
    }
    if (e) e.stopPropagation();
  }
}
