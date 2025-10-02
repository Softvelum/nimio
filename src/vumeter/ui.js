export class VUMeterUI {
  constructor(container, dbRange) {
    this.container = container;
    this.vertical = true;
    this.borderSize = 2;
    this.fontSize = 10;
    this.backgroundColor = "black";
    this.tickColor = "#ddd";
    this.gradient = ["red 1%", "#ff0 16%", "lime 45%", "#080 100%"];
    this.dbRange = dbRange;
    this.dbTickSize = 10;
    this.levelTransition = "0.1s";
    this._createBasicView();
  }

  create(numChannels) {
    if (this.fullValue) {
      return;
    } else if (undefined === this.meter) {
      this._createBasicView();
    }

    this.channels = numChannels;
    this._createGradient();

    let channelWidth = this.meterWidth / this.channels;
    if (!this.vertical) {
      channelWidth = this.meterHeight / this.channels;
    }
    let channelLeft = this.tickWidth;
    if (!this.vertical) {
      channelLeft = this.meterTop;
    }
    for (let i = 0; i < this.channels; i++) {
      this._createChannelLevel(
        this.borderSize * 2,
        this.meterTop,
        channelLeft,
        false,
      );
      this.channelLevels[i] = this._createChannelLevel(
        channelWidth,
        this.meterTop,
        channelLeft,
        this.levelTransition,
      );
      channelLeft += channelWidth;
      this.levelValues[i] = this._calcLevel(-this.dbRange);
    }
    this.fullValue = true;
    this._drawMeter();
  }

  refresh(numChannels) {
    if (
      this.container.clientWidth !== this.elementWidth ||
      this.container.clientHeight !== this.elementHeight
    ) {
      let isFull = this.fullValue;
      this.destroy(true);
      if (isFull) {
        this.create(numChannels);
      } else {
        this._createBasicView();
      }
    }
  }

  destroy(total) {
    if (!this.meter) return;

    if (this.fullValue) {
      for (let i = 0; i < this.fullValueItems.length; i++) {
        this.meter.removeChild(this.fullValueItems[i]);
      }
      this.fullValueItems = [];
      this.channelLevels = [];
      this.fullValue = false;
    }

    if (total) {
      this.container.removeChild(this.meter);
      this.meter = undefined;
    }
  }

  update(values) {
    if (!this.meter) return;

    for (let i = 0; i < this.channels; i++) {
      this.levelValues[i] = this._calcLevel(values[i]);
    }
  }

  _calcLevel(val) {
    let meterDimension = this.vertical ? this.meterHeight : this.meterWidth;
    let result = Math.floor((val * meterDimension) / -this.dbRange);
    if (result < 0) {
      result = 0;
    } else if (result > meterDimension) {
      result = meterDimension;
    }
    return result;
  }

  _setParams() {
    this.tickWidth = this.fontSize * 2.0;

    this.elementWidth = this.container.clientWidth;
    this.elementHeight = this.container.clientHeight;
    if (this.elementWidth > this.elementHeight) {
      this.vertical = false;
    }
    this.meterTop = this.vertical
      ? this.borderSize
      : this.fontSize * 1.5 + this.borderSize;

    this.meterHeight = this.elementHeight - this.meterTop - this.borderSize;
    this.meterWidth = this.elementWidth - this.tickWidth - this.borderSize;
    this.fullValueItems = [];
    this.channelLevels = [];
    this.levelValues = [];
  }

  _createBasicView() {
    this._setParams();
    this._createMeterDiv();
    this._createTicks();
    this.fullValue = false;
  }

  _removePlaceholder() {
    if (!this.placeholder) return;

    this.container.removeChild(this.meter);
    this.meter = undefined;
    this.placeholder = false;
  }

  _createMeterDiv() {
    this.meter = document.createElement("div");
    this.meter.style.position = "relative";
    this.meter.style.width = this.elementWidth + "px";
    this.meter.style.height = this.elementHeight + "px";
    this.meter.style.backgroundColor = this.backgroundColor;
    this.container.appendChild(this.meter);
  }

  _createTicks() {
    let numTicks = (this.dbRange / this.dbTickSize) >>> 0;
    let dbTickLabel = 0;
    if (this.vertical) {
      let dbTickTop = this.fontSize + this.borderSize;
      for (let i = 0; i < numTicks; i++) {
        let dbTick = document.createElement("div");
        this.meter.appendChild(dbTick);
        dbTick.style.width = this.tickWidth + "px";
        dbTick.style.textAlign = "right";
        dbTick.style.color = this.tickColor;
        dbTick.style.fontSize = this.fontSize + "px";
        dbTick.style.position = "absolute";
        dbTick.style.top = dbTickTop + "px";
        dbTick.textContent = dbTickLabel + "";
        dbTickLabel -= this.dbTickSize;
        dbTickTop += this.meterHeight / numTicks;
      }
    } else {
      this.tickWidth = this.meterWidth / numTicks;
      let dbTickRight = this.fontSize * 2;
      for (let i = 0; i < numTicks; i++) {
        let dbTick = document.createElement("div");
        this.meter.appendChild(dbTick);
        dbTick.style.width = this.tickWidth + "px";
        dbTick.style.textAlign = "right";
        dbTick.style.color = this.tickColor;
        dbTick.style.fontSize = this.fontSize + "px";
        dbTick.style.position = "absolute";
        dbTick.style.top = "5px";
        dbTick.style.right = dbTickRight + "px";
        dbTick.textContent = dbTickLabel + "";
        dbTickLabel -= this.dbTickSize;
        dbTickRight += this.tickWidth;
      }
    }
  }

  _createGradient() {
    let gradient = document.createElement("div");
    this.meter.appendChild(gradient);
    gradient.style.width = this.meterWidth + "px";
    gradient.style.height = this.meterHeight + "px";
    gradient.style.position = "absolute";
    gradient.style.top = this.meterTop + "px";
    let backgroundGradient;
    if (this.vertical) {
      gradient.style.left = this.tickWidth + "px";
      backgroundGradient =
        "linear-gradient(to bottom, " + this.gradient.join(", ") + ")";
    } else {
      gradient.style.left = this.borderSize + "px";
      backgroundGradient =
        "linear-gradient(to left, " + this.gradient.join(", ") + ")";
    }
    gradient.style.backgroundImage = backgroundGradient;
    this.fullValueItems.push(gradient);
  }

  _createChannelLevel(width, top, left, transition) {
    let level = document.createElement("div");
    this.meter.appendChild(level);
    level.style.position = "absolute";
    if (this.vertical) {
      level.style.width = width + "px";
      level.style.height = this.meterHeight + "px";
      level.style.top = top + "px";
      level.style.left = left + "px";
    } else {
      level.style.width = this.meterWidth + "px";
      level.style.height = width + "px";
      level.style.top = left + "px";
      level.style.right = this.fontSize * 2 + "px";
    }
    level.style.backgroundColor = this.backgroundColor;
    if (transition) {
      if (this.vertical) {
        level.style.transition = "height " + this.levelTransition;
      } else {
        level.style.transition = "width " + this.levelTransition;
      }
    }
    this.fullValueItems.push(level);
    return level;
  }

  _drawMeter() {
    if (!this.fullValue) return;

    for (let i = 0; i < this.channels; i++) {
      if (this.vertical) {
        this.channelLevels[i].style.height = this.levelValues[i] + "px";
      } else {
        this.channelLevels[i].style.width = this.levelValues[i] + "px";
      }
    }
    window.requestAnimationFrame(() => this._drawMeter());
  }
}
