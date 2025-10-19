import {} from "./ui.css";
import { DebugView } from "./debug-view";
import controlsHtml from "./controls.html?raw";
import controlsCss from "./controls.css?raw";

export class Ui {
  constructor(container, opts, eventBus) {
    this.state = "pause";
    this._muted = false;
    this._eventBus = eventBus;
    this._logger = opts.logger;
    this._autoAbr = opts.autoAbr;

    this.container = document.getElementById(container);
    Object.assign(this.container.style, {
      display: "inline-block",
      position: "relative",
    });
    this.container.classList.add("nimio-container");

    this.canvas = document.createElement("canvas");
    this.canvas.width = opts.width; // todo if no options, get from container
    this.canvas.height = opts.height;
    Object.assign(this.canvas.style, {
      cursor: "pointer",
      zIndex: 10,
      "background-color": "grey",
    });
    this.container.appendChild(this.canvas);

    this.btnPlayPause = document.createElement("div");
    this.btnPlayPause.classList.add("play-pause");
    this.button = document.createElement("div");
    this.button.classList.add("play");
    this.btnPlayPause.appendChild(this.button);
    this.container.appendChild(this.btnPlayPause);

    this._onClick = this._handleClick.bind(this);
    this._onVolumeSet = this._onVolumeSet.bind(this);
    this._onMuteUnmuteClick = this._handleMuteUnmuteClick.bind(this);
    this._onMuteUnmuteSet = this._onMuteUnmuteSet.bind(this);
    this._onRenditionSet = this._onRenditionSet.bind(this);
    this._onRenditionsReceived = this._onRenditionsReceived.bind(this);
    this._onAdaptiveBitrateSet = this._onAdaptiveBitrateSet.bind(this);
    this.canvas.addEventListener("click", this._onClick);
    this.btnPlayPause.addEventListener("click", this._onClick);

    this._createControls();
    this._setupEasing();

    this._eventBus.on("nimio:volume-set", this._onVolumeSet);
    this._eventBus.on("nimio:muted", this._onMuteUnmuteSet);
    this._eventBus.on("nimio:rendition-set", this._onRenditionSet);
    this._eventBus.on("nimio:rendition-list", this._onRenditionsReceived);
    this._eventBus.on("nimio:abr", this._onAdaptiveBitrateSet);
  }

  _createControls() {
    const tpl = document.createElement("template");
    tpl.innerHTML = controlsHtml.trim();

    const frag = tpl.content.cloneNode(true);
    this.controlsBar = frag.querySelector(".nimio-controls");

    this.container.appendChild(frag);

    this.buttonPlayPause = this.controlsBar.querySelector(".btn-play-pause");
    this.buttonPlayPause.addEventListener("click", this._onClick);

    this._buttonVolume = this.controlsBar.querySelector(".btn-volume");
    this._buttonVolume.addEventListener("click", this._onMuteUnmuteClick);

    this.volumeRange = this.controlsBar.querySelector(".volume-range");
    this.volumeRange.addEventListener("input", (e) => {
      this._handleVolumeChange(Number(e.target.value));
    });

    this.buttonSettings = this.controlsBar.querySelector(".btn-settings");
    this.buttonSettings.addEventListener("click", (e) =>
      this._handleSettingsClick(e),
    );
    this.menuPopover = this.controlsBar.querySelector(".menu-popover");
    this.menuSection = this.menuPopover.querySelector(".menu-section");

    const style = document.createElement("style");
    style.textContent = controlsCss;
    document.head.appendChild(style);
  }

  destroy() {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
    }
    this.container.removeEventListener("mousemove", this._onMouseMove);
    this.container.removeEventListener("mouseout", this._onMouseOut);
    this.container.removeEventListener("click", this._onClick);
    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }
  }

  _setupEasing() {
    this.hideTimer = null;
    this._onMouseMove = (e) => this._handleMouseMove(e);
    this.container.addEventListener("mousemove", this._onMouseMove);
    this._onMouseOut = (e) => this._handleMouseOut(e);
    this.container.addEventListener("mouseout", this._onMouseOut);
  }

  appendDebugOverlay(state, videoBuffer) {
    return new DebugView(this.container, state, videoBuffer);
  }

  getCanvas() {
    return this.canvas;
  }

  drawPlay() {
    this.state = "pause";
    this.button.classList.remove("pause");
    this.button.classList.add("play");
    this.buttonPlayPause.querySelector(".icon-play").style.display = "block";
    this.buttonPlayPause.querySelector(".icon-pause").style.display = "none";
  }

  drawPause() {
    this.state = "play";
    this.button.classList.remove("play");
    this.button.classList.add("pause");
    this.buttonPlayPause.querySelector(".icon-play").style.display = "none";
    this.buttonPlayPause.querySelector(".icon-pause").style.display = "block";
  }

  showControls(animate) {
    this.btnPlayPause.style.transition = animate ? "opacity 0.2s ease" : "none";
    this.btnPlayPause.style.opacity = "0.7";

    this.controlsBar.style.transition = animate ? "opacity 0.2s ease" : "none";
    this.controlsBar.style.opacity = "1";
  }

  hideControls(animate) {
    this.btnPlayPause.style.transition = animate ? "opacity 0.5s ease" : "none";
    this.btnPlayPause.style.opacity = "0";

    this.controlsBar.style.transition = animate ? "opacity 0.2s ease" : "none";
    this.controlsBar.style.opacity = "0";
  }

  get size() {
    let box = this.canvas.getBoundingClientRect();
    return [box.width, box.height];
  }

  _onRenditionsReceived(renditions) {
    if (!Array.isArray(renditions)) {
      this._logger.error("_onRenditionsReceived: not an array");
      return;
    }

    const autoBtn = this.menuSection.querySelector("button.rendition-auto");
    autoBtn.style.display = this._autoAbr ? "block" : "none";
    autoBtn.dataset.rendition = "auto";
    this.menuSection.querySelectorAll("button.menu-item").forEach((btn) => {
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
      this.menuSection.appendChild(button);
    });

    this._enableSelection();
  }

  _toggleAutoAbrButton() {
    const res = this.menuSection.querySelector("button.rendition-auto");
    res.setAttribute("aria-checked", this._autoAbr ? "true" : "false");
    if (this._autoAbr) {
      res.style.display = "block";
      if (this._curRendition) {
        res.textContent = `Auto ${this._curRendition.name}`;
      }
    } else {
      res.textContent = "Auto";
    }
    return res;
  }

  _enableSelection() {
    this.menuSection.addEventListener("click", (e) => {
      const btn = e.target.closest("button.menu-item");
      if (!btn) return;
      this.selectRendition(btn);
    });
  }

  selectRendition(selectedBtn) {
    let selRendition = selectedBtn._rendition || { name: "Auto" };
    this._eventBus.emit("ui:rendition-change", selRendition);
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

    this.menuSection.querySelectorAll("button.menu-item").forEach((btn) => {
      if (btn.dataset.rendition === "auto") return;
      let isSel =
        !this._autoAbr &&
        this._curRendition.name === btn.dataset.rendition &&
        this._curRendition.id === parseInt(btn.dataset.rid);
      btn.setAttribute("aria-checked", isSel ? "true" : "false");
    });
  }

  _handleClick(e) {
    let isPlayClicked = "pause" === this.state;
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

  _handleVolumeChange(value) {
    if (this._muted || value === 0) {
      this._handleMuteUnmuteClick();
    }
    this._eventBus.emit("ui:volume-change", value);
  }

  _onVolumeSet(value) {
    this.volumeRange.value = value;
  }

  _onAdaptiveBitrateSet(val) {
    this._autoAbr = val;
    this._applyCurrentRendition();
  }

  _handleSettingsClick(e) {
    this.menuPopover.hidden = !this.menuPopover.hidden;
  }

  _handleMouseMove(e) {
    this.showControls(true);
    clearTimeout(this.hideTimer);

    this.hideTimer = setTimeout(() => {
      this.hideControls(true);
    }, 2000);
  }

  _handleMouseOut(e) {
    this.hideControls(true);
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
    }
  }
}
