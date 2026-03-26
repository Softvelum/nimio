import LoggersFactory from "./logger";
import { singleInstanceService } from "./service";

class PlatformDetector {
  constructor() {
    this._logger = LoggersFactory.create("", "PlatformDetector");

    if (undefined !== window) {
      if (window.navigator || navigator) {
        this.nav = window.navigator || navigator;
        this.userAgent = (this.nav.userAgent || "").toLowerCase();

        this._isFirefox = "undefined" !== typeof InstallTrigger;
        this._isOpera =
          null !== this.userAgent.match(/(?:^opera.+?version|opr)\/(\d+)/);

        var vendor = ((this.nav && this.nav.vendor) || "").toLowerCase();
        var match = /google inc/.test(vendor)
          ? this.userAgent.match(/(?:chrome|crios)\/(\d+)/)
          : null;
        this._isChrome = null !== match && !this._isOpera;

        this._isSafari =
          /constructor/i.test(window.HTMLElement) ||
          (function (p) {
            return p.toString() === "[object SafariRemoteNotification]";
          })(
            !window["safari"] ||
              (typeof safari !== "undefined" && safari.pushNotification),
          );
        if (!this._isSafari && !this._isChrome) {
          this._isSafari =
            navigator.userAgent.indexOf("Safari") > -1 &&
            navigator.userAgent.indexOf("Chrome") <= -1;
        }

        this._isIE = /*@cc_on!@*/ false || !!document.documentMode;
        this._isEdge = !this._isIE && !!window.StyleMedia;

        this._iPadOS13 = this._isIOS13("iPad");
        this._isMobile =
          /android|webos|iphone|ipad|ipod|opera mini/i.test(this.userAgent) ||
          this._iPadOS13;
        this._isIOS =
          (/ipad|iphone|ipod/.test(this.userAgent) && !window.MSStream) ||
          this._iPadOS13;
      } else {
        this._logger.error("navigator is not defined");
      }
    } else {
      this._logger.error("window is undefined");
    }
  }

  isMobile() {
    return this._isMobile;
  }

  isIOS() {
    return this._isIOS;
  }

  isBrowser(name) {
    switch (name) {
      case "Firefox":
        return this._isFirefox;
      case "Chrome":
        return this._isChrome;
      case "Safari":
        return this._isSafari;
      case "Edge":
        return this._isEdge;
      case "IE":
        return this._isIE;
      case "Microsoft":
        return this._isIE || this._isEdge;
      default:
        this._logger.debug("Unknown browser name", name);
        return null;
    }
  }

  logData() {
    this._logger.debug(
      `Firefox - ${this._isFirefox}, Chrome - ${this._isChrome}, Safari - ${this._isSafari}, IE - ${this._isIE}, Edge - ${this._isEdge}, Mobile - ${this._isMobile}, iOS - ${this._isIOS}, iPadOS - ${this._iPadOS13}`,
    );
  }

  _isIOS13(type) {
    // iPad, iPhone
    return (
      this.nav &&
      this.nav.platform &&
      (this.nav.platform.indexOf(type) !== -1 ||
        (this.nav.platform === "MacIntel" &&
          this.nav.maxTouchPoints > 1 &&
          !window.MSStream))
    );
  }
}

PlatformDetector = singleInstanceService(PlatformDetector);
export { PlatformDetector };
