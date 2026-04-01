/**
 * Simple logger class to be able to write with time-stamps and filter on level.
 */
export const Logger = {
  verboseFilter : {'DATA' : 3, 'DEBUG' : 3, 'INFO' : 2, 'WARNING' : 2, 'TEXT' : 1, 'ERROR' : 0},
  time : null,
  verboseLevel : 0,
  setTime: function (newTime) {
    this.time = newTime;
  },
  log: function (severity, msg) {
    var minLevel = this.verboseFilter[severity];
    if (this.verboseLevel >= minLevel) {
      console.log(this.time + " [" + severity + "] " + msg);
    }
  }
};
