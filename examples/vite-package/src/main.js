import Nimio from "nimio-player";
import "nimio-player/style.css";

const streamUrlInput = document.getElementById("stream-url");
const loadButton = document.getElementById("load-player");
const versionElement = document.getElementById("version");

versionElement.textContent = `Nimio ${Nimio.version()}`;

function loadPlayer() {
  if (window.nimio) {
    window.nimio.destroy();
  }

  window.nimio = new Nimio({
    streamUrl: streamUrlInput.value,
    container: "player",
    autoplay: true,
    width: 476,
    height: 268,
    latency: 1000,
    latencyTolerance: 2200,
    startOffset: 2000,
    latencyAdjustMethod: "fast-forward",
    logLevel: "debug",
  });
}

loadButton.addEventListener("click", loadPlayer);
loadPlayer();
