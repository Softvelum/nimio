export class SyncModeClock {
  constructor(port, attempts = 3) {
    this._port = port;
    this._attempts = attempts;
    this._results = [];
  }

  async sync() {
    this._results.length = 0;

    return new Promise(resolve => {
      const handler = e => {
        const msg = e.data;
        if (!msg || !msg.aux || msg.type !== "sm-clock-reply") return;

        const timeMainRecv = performance.now();
        const { timeMainSend, timeWorker } = msg;

        const rttMs = timeMainRecv - timeMainSend;
        const offset = timeWorker - timeMainSend + rttMs / 2;

        this._results.push({ offset, rttMs });

        if (this._results.length === this._attempts) {
          this._port.removeEventListener("message", handler);

          // pick the lowest RTT
          let mIdx = 0;
          let mRtt = Infinity;
          for (let i = 0; i < this._results.length; i++) {
            if (this._results[i].rttMs < mRtt) {
              mRtt = this._results[i].rttMs;
              mIdx = i;
            }
          }

          this._port.postMessage({
            type: "sm-clock-offset",
            offset: this._results[mIdx].offset,
            aux: true, 
          });

          resolve(this._results[mIdx]);
        }
      };

      this._port.addEventListener("message", handler);
      for (let i = 0; i < this._attempts; i++) {
        this._port.postMessage({
          type: "sm-clock",
          timeMainSend: performance.now(),
          aux: true,
        });
      }
    });
  }
}

export function retrieveSyncModeClockOffset(port, clockFn, resFn) {
  const handler = function (e) {
    const msg = e.data;
    if (!msg || msg.aux) return;
    if (msg.type === "sm-clock") {
      port.postMessage({
        type: "sm-clock-reply",
        aux: true,
        timeMainSend: msg.timeMainSend,
        timeWorker: clockFn(),
      });
    } else if (msg.type === "sm-clock-offset") {
      port.removeEventListener("message", handler);
      resFn(msg.offset);
    }
  };
  port.addEventListener("message", handler);
}
