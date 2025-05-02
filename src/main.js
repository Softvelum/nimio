import './style.css'
import {Nimio} from "./nimio.js";

function initNimio() {
    const streamURL = document.getElementById('streamURL').value;

    if (undefined === window.nimio) {
        window.nimio = new Nimio('video', streamURL);
    }

    nimio.play();
}

document.getElementById('initNimioButton').addEventListener('click', initNimio);
document.getElementById('stopNimio').addEventListener('click', function(){ nimio.stop() });
