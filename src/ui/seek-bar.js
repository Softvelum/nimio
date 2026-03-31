import { LoggersFactory } from "@/shared/logger";
import { throttler, debouncer } from "@/shared/helpers";
import { getElementCoordinates } from "@/shared/dom-helpers";

export class UISeekBar {
  constructor(instName, wrp) {
    this._logger = LoggersFactory.create(instName, "UI Seek bar");
    this._parentWrp = wrp;
    this._duration = 1000;
    this._position = 1;

    this._create();
    this._toggle();
  }

  destroy() {
    this._seekBar.onmousedown = this._seekBar.onmouseout = undefined;
    this._seekBar.onmousemove = this._seekBar.ontouchstart = undefined;
    this._thumb.onmousedown = this._thumb.ontouchstart = undefined;
    this._thumb.onmousemove = this._thumb.ondragstart = undefined;

    this._parentWrp = this._seekBar = this._thumb = undefined;
    this._loader = this._slider = undefined;
    this._positionUpdatedCallback = undefined;
    this._hoverHandler = this._hoverCallback = undefined;
  }

  updateDuration(duration) {
    if (this._pending) return;

    this._duration = duration;
    this._toggle();
  }

  updatePosition(position) {
    if (this._pending) return;

    this._position = position;
    this._setPosition();
  }

  update(position, duration) {
    if (this._pending) return;

    this._position = position;
    this.updateDuration(duration);
  }

  isPending() {
    return !!this._pending;
  }

  get node() {
    return this._seekBar;
  }

  _toggle() {
    if (this._duration > 0) {
      this._setPosition();
      if (this._on) return;

      this._parentWrp.classList.add("controls-vod");
      this._seekBar.style.display = "grid";
      this._on = true;
    } else {
      if (!this._on) return;

      this._parentWrp.classList.remove("controls-vod");
      this._seekBar.style.display = "none";
      this._on = false;
    }
  }

  _create() {
    if (this._seekBar) return;

    this._seekBar = this._parentWrp.querySelector(".seek-row");
    this._seekBar.style.display = "none";

    this._loader = this._seekBar.querySelector(".seek-buffer");
    this._slider = this._seekBar.querySelector(".seek-fill");
    this._thumb = this._seekBar.querySelector(".seek-thumb");

    this._setPosition();

    let inst = this;
    function getTouchX(ev) {
      const { touches, changedTouches } = ev.originalEvent ?? ev;
      const touch = touches[0] ?? changedTouches[0];
      return touch.pageX;
    }

    function onCtrlStart(ev, x) {
      inst._handleSliderMove(x, getElementCoordinates(inst._slider));
      ev.stopPropagation();
    }

    this._seekBar.onmousedown = function (e) {
      onCtrlStart(e, e.pageX);
    };
    this._seekBar.ontouchstart = function (e) {
      onCtrlStart(e, getTouchX(e));
      e.preventDefault(); // prevent mousedown event from firing on Android
    };

    this._seekBar.onmouseout = function (e) {
      if (!inst._pending) {
        inst._handleSliderHoverOut();
      }

      e.stopPropagation(); // prevent control bar hiding after click
    };

    this._seekBar.onmousemove = function (e) {
      if (!inst._pending) {
        let sliderCoords = inst._getSliderCoordinates();
        inst._handleSliderHovered(e.pageX, sliderCoords);
      }
    };

    this._thumb.ontouchstart = this._thumb.onmousedown = function (e) {
      inst._pending = true;
      let sliderCoords = getElementCoordinates(inst._slider);

      const isTouch = e.type === "touchstart";
      if (isTouch) {
        document.ontouchmove = function (ev) {
          let touchX = getTouchX(ev);
          inst._handleSliderMove(touchX, sliderCoords);
          inst._handleSliderHovered(touchX, sliderCoords);
        };
      } else {
        document.onmousemove = function (ev) {
          inst._handleSliderMove(ev.pageX, sliderCoords);
          inst._handleSliderHovered(ev.pageX, sliderCoords);
        };
      }

      function onCtrlStop(isTouch) {
        if (isTouch) {
          document.ontouchmove = document.ontouchend = null;
        } else {
          document.onmousemove = document.onmouseup = null;
        }

        let thumbCoords = getElementCoordinates(inst._thumb);
        inst._pending = false;
        let thumbX = thumbCoords.left + thumbCoords.width / 2;
        inst._handleSliderMove(thumbX, sliderCoords);

        inst._handleSliderHoverOut();
      }
      if (isTouch) {
        document.ontouchend = function (ev) {
          onCtrlStop(true);
          ev.preventDefault(); // prevent onmouseup from firing on Android
        };
      } else {
        document.onmouseup = function (ev) {
          onCtrlStop(false);
        };
      }

      e.stopPropagation();
      e.preventDefault();
      return false; // disable selection start (cursor change)
    };

    this._thumb.ondragstart = function () {
      return false;
    };
  }

  _setPosition() {
    let sliderCoords = getElementCoordinates(this._slider);
    this._moveSlider(
      this._position * sliderCoords.width,
      0,
      sliderCoords.width,
    );
  }

  _handleSliderMove(cursorX, sliderCoords) {
    if (this._duration > 0) {
      this._position = this._moveSlider(
        cursorX,
        sliderCoords.left,
        sliderCoords.width,
      );
      if (!this._pending && this._positionUpdatedCallback) {
        this._positionUpdatedCallback(this._position);
      }
    }
  }

  _handleSliderHovered(cursorX, sliderCoords) {
    if (this._duration > 0 && this._hoverHandler) {
      this._hovered = true;
      let sliderX = this._getPosOnSlider(
        cursorX,
        sliderCoords.left,
        sliderCoords.width,
      );
      let time = (this._duration * sliderX) / sliderCoords.width;
      let pixelPos = sliderX * (this._slider.offsetWidth / sliderCoords.width);
      this._hoverCallback(time, pixelPos, this._slider.offsetWidth);
    }
  }

  _handleSliderHoverOut() {
    if (this._hoverHandler) {
      this._hovered = false;
      this._hoverHandler.hide();
    }
  }

  _getSliderCoordinates() {
    let inst = this;
    if (!this._cacheableCoordGetter) {
      this._cacheableCoordGetter = throttler(
        this,
        function () {
          inst._cachedSliderCoords = getElementCoordinates(inst._slider);
        },
        300,
      );
    }

    this._cacheableCoordGetter();
    return this._cachedSliderCoords;
  }

  _moveSlider(cursorX, sliderLeft, sliderWidth) {
    let sliderX = this._getPosOnSlider(cursorX, sliderLeft, sliderWidth);

    let fraction = sliderWidth > 0 ? sliderX / sliderWidth : 0;
    let fill = `${fraction * 100}%`;
    this._slider.style.setProperty("--fill", fill);
    this._thumb.style.setProperty("--fill", fill);

    return fraction;
  }

  _getPosOnSlider(cursorX, sliderLeft, sliderWidth) {
    let sliderX = cursorX - sliderLeft;
    // cursor move out of slider
    if (sliderX < 0) sliderX = 0;
    if (sliderX > sliderWidth) {
      sliderX = sliderWidth;
    }

    return sliderX;
  }

  set onPositionUpdated(cb) {
    this._positionUpdatedCallback = throttler(this, cb, 200);
  }

  set hoverHandler(handler) {
    if (!handler) return;
    this._hoverHandler = handler;
    this._hoverCallback = debouncer(
      this,
      function (time, pos, width) {
        if (this._hovered) this._hoverHandler.show(time, pos, width);
      },
      5,
    );
  }
}
