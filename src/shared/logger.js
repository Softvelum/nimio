let LoggersFactory = (function () {
  let _level = "warn";

  class Logger {
    constructor(id, prefix) {
      this.id = id;
      this.prefix = prefix;
      this.lf = "log";
    }

    setId(id) {
      if (null == this.id) {
        this.id = id;
      } else {
        console.error("Logger.setId: attempt to reset Logger id", this.id, id);
      }
    }

    setPrefix(prefix) {
      this.prefix = prefix;
    }

    error() {
      this.lf = "error";
      this._log.apply(this, arguments);
    }

    warn() {
      if ("warn" == _level || "debug" == _level) {
        this.lf = "warn";
        this._log.apply(this, arguments);
      }
    }

    debug() {
      if ("debug" == _level) {
        this.lf = "log";
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
        this.id +
        "][" +
        this.prefix +
        "]: " +
        arguments[0];

      console[this.lf].apply(console, arguments);
    }
  }

  return {
    create: function (id, prefix) {
      return new Logger(id, prefix);
    },
    setLevel: function (lvl) {
      _level = lvl;
    },
  };
})();

export default LoggersFactory;
