/**
 * State of CEA-608 pen or character
 */
export class PenState {
  constructor(foreground, underline, italics, background, flash) {
    this.foreground = foreground || "white";
    this.background = background || "black";
    this.underline = underline || false;
    this.italics = italics || false;
    this.flash = flash || false;
  }

  reset() {
    this.foreground = "white";
    this.background = "black";
    this.underline = false;
    this.italics = false;
    this.flash = false;
  }

  setStyles(styles) {
    let attribs = ["foreground", "underline", "italics", "background", "flash"];

    for (let i = 0; i < attribs.length; i++) {
      let style = attribs[i];
      if (styles.hasOwnProperty(style)) {
        this[style] = styles[style];
      }
    }
  }

  isDefault() {
    return (
      this.foreground === "white" &&
      this.background === "black" &&
      !this.underline &&
      !this.italics &&
      !this.flash
    );
  }

  equals(other) {
    return (
      this.foreground === other.foreground &&
      this.underline === other.underline &&
      this.italics === other.italics &&
      this.background === other.background &&
      this.flash === other.flash
    );
  }

  copy(newPenState) {
    this.foreground = newPenState.foreground;
    this.underline = newPenState.underline;
    this.italics = newPenState.italics;
    this.background = newPenState.background;
    this.flash = newPenState.flash;
  }

  toString() {
    return `color=${this.foreground}, underline=${this.underline}, italics=${this.italics}, background=${this.background}, flash=${this.flash}`;
  }
}
