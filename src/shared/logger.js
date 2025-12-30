let LoggersFactory = (function () {
  let _level = "warn";
  let _workletLogging = false;

  class Logger {
    constructor(id, prefix, workletPort) {
      this._id = id;
      this._prefix = prefix;
      this._lf = "log";
      if (_workletLogging) {
        this._workletPort = workletPort;
      }
    }

    setId(id) {
      if (null == this._id) {
        this._id = id;
      } else {
        console.error("Logger.setId: attempt to reset Logger id", this._id, id);
      }
    }

    setPrefix(prefix) {
      this._prefix = prefix;
    }

    error() {
      this._lf = "error";
      this._log.apply(this, arguments);
    }

    warn() {
      if ("warn" == _level || "debug" == _level) {
        this._lf = "warn";
        this._log.apply(this, arguments);
      }
    }

    debug() {
      if ("debug" == _level) {
        this._lf = "log";
        this._log.apply(this, arguments);
      }
    }

    _log() {
      let time = Date.now();
      let msecs = time % 1000;
      if (msecs < 10) {
        msecs = "00" + msecs;
      } else if (msecs < 100) {
        msecs = "0" + msecs;
      }
      time = (time / 1000) >>> 0;
      let secs = time % 86400;
      let hours = (secs / 3600) >>> 0;
      if (hours < 10) hours = "0" + hours;
      secs -= hours * 3600;
      let minutes = (secs / 60) >>> 0;
      if (minutes < 10) minutes = "0" + minutes;
      secs -= minutes * 60;
      if (secs < 10) secs = "0" + secs;
      arguments[0] =
        "[" +
        hours +
        ":" +
        minutes +
        ":" +
        secs +
        "." +
        msecs +
        "][" +
        this._id +
        "][" +
        this._prefix +
        "]: " +
        arguments[0];

      if (this._workletPort) {
        return this._workletPort.postMessage({
          type: "log",
          lf: this._lf,
          args: Array.prototype.slice.call(arguments),
        });
      }

      console[this._lf].apply(console, arguments);
    }
  }

  return {
    create: function (id, prefix, isWorklet) {
      return new Logger(id, prefix, isWorklet);
    },
    isDebugEnabled: function () {
      return _level === "debug";
    },
    setLevel: function (lvl) {
      if (lvl) _level = lvl;
    },
    toggleWorkletLogs: function (on) {
      _workletLogging = !!on;
    },
  };
})();

export { LoggersFactory };
