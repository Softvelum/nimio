import {} from './ui.css'

export class Ui {
    constructor(container, opts, onPlayPause) {
        this.state = 'pause';

        this.container = document.getElementById(container);
        Object.assign(this.container.style, {
            display:    'inline-block',
            position: 'relative'
        });
        this.container.classList.add('nimio-container');

        this.canvas = document.createElement('canvas');
        this.canvas.width  = opts.width; // todo if no options, get from element
        this.canvas.height = opts.height;
        Object.assign(this.canvas.style, {
            cursor: 'pointer',
            zIndex: 10,
            'background-color': 'grey'
        });
        this.container.appendChild(this.canvas);

        this.btnPlayPause = document.createElement('div')
        this.btnPlayPause.classList.add('play-pause');
        this.button = document.createElement('button');
        this.button.classList.add('play')
        this.btnPlayPause.appendChild(this.button);
        this.container.appendChild(this.btnPlayPause);

        this.container.addEventListener('click', e => {
            let isPlayClicked;
            if ('pause' === this.state) {
                isPlayClicked = true;
                this.drawPause()
            } else {
                isPlayClicked = false;
                this.drawPlay()
            }
            onPlayPause(e, isPlayClicked)
        });

        this.setupEasing()
    }

    setupEasing() {
        this.hideTimer = null;
        this.container.addEventListener('mousemove', () => {
            this.btnPlayPause.style.opacity = '0.7';
            this.btnPlayPause.style.transition = 'opacity 0.2s ease';

            clearTimeout(this.hideTimer);

            this.hideTimer = setTimeout(() => {
                this.btnPlayPause.style.transition = 'opacity 0.5s ease';
                this.btnPlayPause.style.opacity = '0';
            }, 2000);
        });
        this.container.addEventListener('mouseout', () => {
            this.btnPlayPause.style.opacity = '0';
        });
    }

    getCanvas() {
        return this.canvas;
    }

    drawPlay() {
        this.state = 'pause';
        this.button.classList.remove('pause')
        this.button.classList.add('play')
    }

    drawPause() {
        this.state = 'play';
        this.button.classList.remove('play')
        this.button.classList.add('pause')
    }
}
