import {} from "./ui.css";
import { DebugView } from "./debug-view";

export class Ui {
  constructor(container, opts, onPlayPause) {
    this.state = "pause";

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
    this.container.addEventListener("click", this._onClick);

    this.setupEasing();
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
  }

  drawPause() {
    this.state = "play";
    this.button.classList.remove("play");
    this.button.classList.add("pause");
  }

  showControls(animate) {
    this.btnPlayPause.style.transition = animate ? "opacity 0.2s ease" : "none";
    this.btnPlayPause.style.opacity = "0.7";
  }

  hideControls(animate) {
    this.btnPlayPause.style.transition = animate ? "opacity 0.5s ease" : "none";
    this.btnPlayPause.style.opacity = "0";
  }

  _hanldleClick(e, onPlayPause) {
    let isPlayClicked = false;
    if ("pause" === this.state) {
      isPlayClicked = true;
      this.drawPause();
    } else {
      this.drawPlay();
    }
    onPlayPause(e, isPlayClicked);
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
