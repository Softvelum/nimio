import {} from "./ui.css";
import { DebugView } from "./debug-view";
import controlsHtml from "./controls.html?raw";
import controlsCss from "./controls.css?raw";

export class Ui {
  constructor(container, opts, onPlayPause, onMuteUnmute, onVolumeChange) {
    this.state = "pause";
    this.muted = false;

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

    this._onClick = (e) => this._hanldleClick(e, onPlayPause);
    this._onMuteUnmuteClick = () => this._hanldleMuteUnmuteClick(onMuteUnmute);
    this._onVolumeChange = (value) =>
      this._hanldleVolumeChange(value, onVolumeChange);
    this.canvas.addEventListener("click", this._onClick);

    this._createControls();

    this.setupEasing();
  }

  _createControls() {
    const tpl = document.createElement("template");
    tpl.innerHTML = controlsHtml.trim();

    const frag = tpl.content.cloneNode(true);
    this.controlsBar = frag.querySelector(".nimio-controls");

    this.container.appendChild(frag);

    this.buttonPlayPause = this.controlsBar.querySelector(".btn-play-pause");
    this.buttonPlayPause.addEventListener("click", this._onClick);

    this.buttonVolume = this.controlsBar.querySelector(".btn-volume");
    this.buttonVolume.addEventListener("click", this._onMuteUnmuteClick);

    this.volumeRange = this.controlsBar.querySelector(".volume-range");
    this.volumeRange.addEventListener("input", (e) => {
      this._onVolumeChange(Number(e.target.value));
    });

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

  setupEasing() {
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
    return;
    this.btnPlayPause.style.transition = animate ? "opacity 0.5s ease" : "none";
    this.btnPlayPause.style.opacity = "0";

    this.controlsBar.style.transition = animate ? "opacity 0.2s ease" : "none";
    this.controlsBar.style.opacity = "0";
  }

  get size() {
    let box = this.canvas.getBoundingClientRect();
    return [box.width, box.height];
  }

  _hanldleClick(e, onPlayPause) {
    let isPlayClicked = false;
    if ("pause" === this.state) {
      isPlayClicked = true;
      this.drawPause();
    } else {
      this.drawPlay();
    }
    onPlayPause?.(e, isPlayClicked);
  }

  _hanldleMuteUnmuteClick(onMuteUnmute) {
    this.muted = !this.muted;
    if (this.muted) {
      this.buttonVolume.querySelector(".icon-vol-mute").style.display = "none";
      this.buttonVolume.querySelector(".icon-vol-unmute").style.display =
        "block";
    } else {
      this.buttonVolume.querySelector(".icon-vol-mute").style.display = "block";
      this.buttonVolume.querySelector(".icon-vol-unmute").style.display =
        "none";
    }
    onMuteUnmute?.(this.muted);
  }

  _hanldleVolumeChange(value, onVolumeChange) {
    if (0 == value && !this.muted) {
      this._onMuteUnmuteClick();
    } else if (this.muted) {
      this._onMuteUnmuteClick();
    }
    onVolumeChange?.(value);
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
