import './style.css'
import {Nimio} from "./nimio.js";

function initNimio() {
    const streamUrl = document.getElementById('streamURL').value;

    if (undefined === window.nimio) {
        window.nimio = new Nimio(
            {
                streamUrl: streamUrl,
                container: 'video',
                width: 476,
                height: 268,
                latency: 200,
                startOffset: 100
            });
    }
}

document.getElementById('initNimioButton').addEventListener('click', initNimio);
