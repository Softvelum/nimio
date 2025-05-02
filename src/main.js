import './style.css'
import {Nimio} from "./nimio.js";

function initNimio() {
    const streamURL = document.getElementById('streamURL').value;

    if (undefined === window.nimio) {
        window.nimio = new Nimio('video', streamURL);
    }
}

document.getElementById('initNimioButton').addEventListener('click', initNimio);
