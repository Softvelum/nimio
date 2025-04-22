import './style.css'
import {Nimio} from "./nimio.js";

function initNimio() {
    const streamURL = document.getElementById('streamURL').value;

    let nimio = new Nimio('video', streamURL);

    nimio.play();
}

document.getElementById('initNimioButton').addEventListener('click', initNimio);
