export class VUMeterUI {
  constructor(container, dbRange) {
    this._container = container;
    this._vertical = true;
    this._borderSize = 2;
    this._fontSize = 10;
    this._backgroundColor = "black";
    this._tickColor = "#ddd";
    this._gradient = ["red 1%", "#ff0 16%", "lime 45%", "#080 100%"];
    this._dbRange = dbRange;
    this._dbTickSize = 10;
    this._levelTransition = "0.1s";
    this._createBasicView();
  }

  create(numChannels) {
    if (this._fullValue) return;

    if (!this._meter) {
      this._createBasicView();
    }

    this._channels = numChannels;
    this._createGradient();

    let channelWidth = this._meterWidth / this._channels;
    if (!this._vertical) {
      channelWidth = this._meterHeight / this._channels;
    }
    let channelLeft = this._tickWidth;
    if (!this._vertical) {
      channelLeft = this._meterTop;
    }
    for (let i = 0; i < this._channels; i++) {
      this._createChannelLevel(
        this._borderSize * 2,
        this._meterTop,
        channelLeft,
        false,
      );
      this._channelLevels[i] = this._createChannelLevel(
        channelWidth,
        this._meterTop,
        channelLeft,
        this._levelTransition,
      );
      channelLeft += channelWidth;
      this._levelValues[i] = this._calcLevel(-this._dbRange);
    }
    this._fullValue = true;
    this._drawMeter();
  }

  refresh(numChannels) {
    if (
      this._container.clientWidth !== this._elementWidth ||
      this._container.clientHeight !== this._elementHeight
    ) {
      let isFull = this._fullValue;
      this.destroy(true);
      if (isFull) {
        this.create(numChannels);
      } else {
        this._createBasicView();
      }
    }
  }

  destroy(total) {
    if (!this._meter) return;

    if (this._fullValue) {
      for (let i = 0; i < this._fullValueItems.length; i++) {
        this._meter.removeChild(this._fullValueItems[i]);
      }
      this._fullValueItems = [];
      this._channelLevels = [];
      this._fullValue = false;
    }

    if (total) {
      this._container.removeChild(this._meter);
      this._meter = undefined;
    }
  }

  update(values) {
    if (!this._meter) return;

    for (let i = 0; i < this._channels; i++) {
      this._levelValues[i] = this._calcLevel(values[i]);
    }
  }

  _calcLevel(val) {
    let meterDimension = this._vertical ? this._meterHeight : this._meterWidth;
    let result = Math.floor((val * meterDimension) / -this._dbRange);
    if (result < 0) {
      result = 0;
    } else if (result > meterDimension) {
      result = meterDimension;
    }
    return result;
  }

  _setParams() {
    this._tickWidth = this._fontSize * 2.0;

    this._elementWidth = this._container.clientWidth;
    this._elementHeight = this._container.clientHeight;
    if (this._elementWidth > this._elementHeight) {
      this._vertical = false;
    }
    this._meterTop = this._vertical
      ? this._borderSize
      : this._fontSize * 1.5 + this._borderSize;

    this._meterHeight = this._elementHeight - this._meterTop - this._borderSize;
    this._meterWidth = this._elementWidth - this._tickWidth - this._borderSize;
    this._fullValueItems = [];
    this._channelLevels = [];
    this._levelValues = [];
  }

  _createBasicView() {
    this._setParams();
    this._createMeterDiv();
    this._createTicks();
    this._fullValue = false;
  }

  _removePlaceholder() {
    if (!this._placeholder) return;

    this._container.removeChild(this._meter);
    this._meter = undefined;
    this._placeholder = false;
  }

  _createMeterDiv() {
    this._meter = document.createElement("div");
    this._meter.style.position = "relative";
    this._meter.style.width = this._elementWidth + "px";
    this._meter.style.height = this._elementHeight + "px";
    this._meter.style.backgroundColor = this._backgroundColor;
    this._container.appendChild(this._meter);
  }

  _createTicks() {
    let numTicks = (this._dbRange / this._dbTickSize) >>> 0;
    let dbTickLabel = 0;
    if (this._vertical) {
      let dbTickTop = this._fontSize + this._borderSize;
      for (let i = 0; i < numTicks; i++) {
        let dbTick = document.createElement("div");
        this._meter.appendChild(dbTick);
        dbTick.style.width = this._tickWidth + "px";
        dbTick.style.textAlign = "right";
        dbTick.style.color = this._tickColor;
        dbTick.style.fontSize = this._fontSize + "px";
        dbTick.style.position = "absolute";
        dbTick.style.top = dbTickTop + "px";
        dbTick.textContent = dbTickLabel + "";
        dbTickLabel -= this._dbTickSize;
        dbTickTop += this._meterHeight / numTicks;
      }
    } else {
      this._tickWidth = this._meterWidth / numTicks;
      let dbTickRight = this._fontSize * 2;
      for (let i = 0; i < numTicks; i++) {
        let dbTick = document.createElement("div");
        this._meter.appendChild(dbTick);
        dbTick.style.width = this._tickWidth + "px";
        dbTick.style.textAlign = "right";
        dbTick.style.color = this._tickColor;
        dbTick.style.fontSize = this._fontSize + "px";
        dbTick.style.position = "absolute";
        dbTick.style.top = "5px";
        dbTick.style.right = dbTickRight + "px";
        dbTick.textContent = dbTickLabel + "";
        dbTickLabel -= this._dbTickSize;
        dbTickRight += this._tickWidth;
      }
    }
  }

  _createGradient() {
    let gradient = document.createElement("div");
    this._meter.appendChild(gradient);
    gradient.style.width = this._meterWidth + "px";
    gradient.style.height = this._meterHeight + "px";
    gradient.style.position = "absolute";
    gradient.style.top = this._meterTop + "px";
    let backgroundGradient;
    if (this._vertical) {
      gradient.style.left = this._tickWidth + "px";
      backgroundGradient =
        "linear-gradient(to bottom, " + this._gradient.join(", ") + ")";
    } else {
      gradient.style.left = this._borderSize + "px";
      backgroundGradient =
        "linear-gradient(to left, " + this._gradient.join(", ") + ")";
    }
    gradient.style.backgroundImage = backgroundGradient;
    this._fullValueItems.push(gradient);
  }

  _createChannelLevel(width, top, left, transition) {
    let level = document.createElement("div");
    this._meter.appendChild(level);
    level.style.position = "absolute";
    if (this._vertical) {
      level.style.width = width + "px";
      level.style.height = this._meterHeight + "px";
      level.style.top = top + "px";
      level.style.left = left + "px";
    } else {
      level.style.width = this._meterWidth + "px";
      level.style.height = width + "px";
      level.style.top = left + "px";
      level.style.right = this._fontSize * 2 + "px";
    }
    level.style.backgroundColor = this._backgroundColor;
    if (transition) {
      if (this._vertical) {
        level.style.transition = "height " + this._levelTransition;
      } else {
        level.style.transition = "width " + this._levelTransition;
      }
    }
    this._fullValueItems.push(level);
    return level;
  }

  _drawMeter() {
    if (!this._fullValue) return;

    for (let i = 0; i < this._channels; i++) {
      if (this._vertical) {
        this._channelLevels[i].style.height = this._levelValues[i] + "px";
      } else {
        this._channelLevels[i].style.width = this._levelValues[i] + "px";
      }
    }
    window.requestAnimationFrame(() => this._drawMeter());
  }
}
