import { multiInstanceService } from "@/shared/service";
import { NR_ROWS, NR_COLS } from "./cea608/constants";

class CaptionRenderer {
  constructor(instName) {
    this._instName = instName;
    this._captionId = 0;
    this._nrRows = NR_ROWS;
    this._nrCols = NR_COLS;
  }

  getDimensions() {
    return [this._nrRows, this._nrCols];
  }

  createCaptionsWrapper() {
    let wrapper = document.createElement("div");
    wrapper.className = "text-tracks-wrp-" + this._instName;
    wrapper.style.cssText = [
      "position: absolute; display: flex;",
      "pointer-events: none; overflow: hidden;",
      "top: 10%; bottom: 10%; left: 0px;",
      "width: 100%; line-height: 1.3em; z-index: 11;",
    ].join("");

    return wrapper;
  }

  createCaptionTrackWrapper(trackId) {
    let wrapper = document.createElement("div");
    wrapper.className = `text-captions-wrp-${this._instName}-${trackId}`;
    wrapper.style.cssText = [
      "position: absolute; overflow: hidden; pointer-events: none; visibility: visible;",
      'font-family: "Deja Vu Sans Mono", "Lucida Console", Monaco, Consolas, "PT Mono", monospace;',
      // 'font-family: Menlo, Consolas, "Cutive Mono", monospace; white-space: pre; font-size: 16.5px;',
      "width: 80%; height: 100%; left: 10%;",
    ].join("");

    return wrapper;
  }

  createCaptionRegionsFromScreen(captionScreen) {
    let lastRowHasText = false;
    let lastRowIndentL = -1;
    let curP = { spans: [] };
    let currentStyle = "style-cea608-white-black";

    this._styleStates = {};
    this._curRegion = null;
    this._regions = [];

    let r;
    for (r = 0; r < this._nrRows; r++) {
      let row = captionScreen.rows[r];
      if (!row.isEmpty()) {
        /* Get indentation of this row */
        const rowIndent = this._getIndent(row.chars);

        /* Create a new region is there is none */
        if (this._curRegion === null) {
          this._curRegion = {
            x: rowIndent,
            y1: r,
            y2: r,
            p: [],
          };
        }

        /* Check if indentation has changed and we had text of last row */
        if (rowIndent !== lastRowIndentL && lastRowHasText) {
          this._appendCurrRegion(r - 1, curP);

          curP = { spans: [] };
          this._curRegion = {
            x: rowIndent,
            y1: r,
            y2: r,
            p: [],
          };
        }

        let line = "";
        let prevPenState;
        for (let c = 0; c < row.chars.length; ++c) {
          const uc = row.chars[c];
          const curPenState = uc.penState;

          if (!prevPenState || !curPenState.equals(prevPenState)) {
            if (line.trim().length > 0) {
              curP.spans.push({ name: currentStyle, line: line, row: r });
              line = "";
            }

            let curPenStateString = `style_cea608_${curPenState.foreground}_${curPenState.background}`;
            if (curPenState.underline) curPenStateString += "_underline";
            if (curPenState.italics) curPenStateString += "_italics";

            if (!this._styleStates[curPenStateString]) {
              this._styleStates[curPenStateString] = JSON.parse(
                JSON.stringify(curPenState),
              );
            }

            prevPenState = curPenState;
            currentStyle = curPenStateString;
          }

          line += uc.uchar;
        }

        if (line.trim().length > 0) {
          curP.spans.push({ name: currentStyle, line: line, row: r });
        }

        lastRowHasText = true;
        lastRowIndentL = rowIndent;
      } else {
        lastRowHasText = false;
        lastRowIndentL = -1;

        if (this._curRegion) {
          this._appendCurrRegion(r - 1, curP);

          curP = { spans: [] };
          this._curRegion = null;
        }
      }
    }

    if (this._curRegion) {
      this._appendCurrRegion(r - 1, curP);
      this._curRegion = null;
    }

    return this._regions;
  }

  createHTMLCaptionsFromRegions(regions, startTime, endTime) {
    let captionsArray = [];
    for (let r = 0; r < regions.length; ++r) {
      const finalDiv = document.createElement("div");
      finalDiv.id = "sub_cea608_" + this._captionId++;
      const cueRegionProperties = this._getRegionProperties(regions[r]);
      finalDiv.style.cssText = [
        "position: absolute;",
        "margin: 0;",
        "display: flex;",
        "box-sizing: border-box;",
        "pointer-events: none;",
        cueRegionProperties,
      ].join("");

      const bodyDiv = document.createElement("div");
      bodyDiv.className = "caption-paragraph";
      bodyDiv.style.cssText = this._getStyle();

      const cueUniWrapper = document.createElement("div");
      cueUniWrapper.className = "cueUniWrapper";
      cueUniWrapper.style.cssText = "unicode-bidi: normal; direction: ltr;";

      for (let p = 0; p < regions[r].p.length; p++) {
        const ptag = regions[r].p[p];
        let lastSpanRow = 0;
        for (let s = 0; s < ptag.spans.length; s++) {
          let span = ptag.spans[s];
          if (span.line.length > 0) {
            if (s !== 0 && lastSpanRow != span.row) {
              const brElement = document.createElement("br");
              brElement.className = "lineBreak";
              cueUniWrapper.appendChild(brElement);
            }
            let sameRow = false;
            if (lastSpanRow === span.row) {
              sameRow = true;
            }
            lastSpanRow = span.row;
            const spanStyle = this._styleStates[span.name];
            const spanElement = document.createElement("span");
            spanElement.className =
              "caption-span " + span.name + " customSpanColor";
            spanElement.style.cssText = this._getStyle(spanStyle);
            /* If this is not the first span, and it's on the same
             * row as the last one */
            if (s !== 0 && sameRow) {
              /* and it's the last span on this row */
              if (s === ptag.spans.length - 1) {
                /* trim only the right side */
                spanElement.textContent = this._rtrim(span.line);
              } else {
                /* don't trim at all */
                spanElement.textContent = span.line;
              }
            } else {
              /* if there is more than 1 span and this isn't the last span */
              if (ptag.spans.length > 1 && s < ptag.spans.length - 1) {
                /* Check if next text is on same row */
                if (span.row === ptag.spans[s + 1].row) {
                  /* Next element on same row, trim start */
                  spanElement.textContent = this._ltrim(span.line);
                } else {
                  /* Different rows, trim both */
                  spanElement.textContent = span.line.trim();
                }
              } else {
                spanElement.textContent = span.line.trim();
              }
            }
            cueUniWrapper.appendChild(spanElement);
          }
        }
      }

      bodyDiv.appendChild(cueUniWrapper);
      finalDiv.appendChild(bodyDiv);

      captionsArray.push({
        start: startTime,
        end: endTime,
        capHTMLElement: finalDiv,
      });
    }

    return captionsArray;
  }

  getRegionSpanStyle(name) {
    return this._styleStates[name] || {};
  }

  _appendCurrRegion(row, par) {
    this._curRegion.p.push(par);
    this._curRegion.y2 = row;
    this._curRegion.name = `region_${this._curRegion.x}_${this._curRegion.y1}_${this._curRegion.y2}`;
    this._regions.push(this._curRegion);
  }

  _getIndent(chars) {
    let res = 0;
    for (let c = 0; c < chars.length; c++) {
      if (!/\s/.test(chars[c].uchar)) {
        break;
      }
      res++;
    }

    return res;
  }

  _getRegionProperties(region) {
    return [
      `left: ${region.x * 3.125}%;`,
      `top: ${region.y1 * 6.66}%;`,
      `width: ${100 - region.x * 3.125}%;`,
      `height: ${(region.y2 - region.y1 + 1) * 6.66}%;`,
      "align-items: flex-start; overflow: visible; -webkit-writing-mode: horizontal-tb;",
      "letter-spacing: calc(1em - 1ch)",
    ].join("");
  }

  _createRGB(color) {
    switch (color) {
      case "red":
        color = "rgb(255, 0, 0)";
        break;
      case "green":
        color = "rgb(0, 255, 0)";
        break;
      case "blue":
        color = "rgb(0, 0, 255)";
        break;
      case "cyan":
        color = "rgb(0, 255, 255)";
        break;
      case "magenta":
        color = "rgb(255, 0, 255)";
        break;
      case "yellow":
        color = "rgb(255, 255, 0)";
        break;
      case "white":
        color = "rgb(255, 255, 255)";
        break;
      case "black":
        color = "rgb(0, 0, 0)";
        break;
      default:
        break;
    }

    return color;
  }

  _getStyle(style) {
    let styleStr;
    if (style) {
      styleStr = [
        `color: ${style.foreground ? this._createRGB(style.foreground) : "rgb(255, 255, 255)"};`,
        `font-style: ${style.italics ? "italic" : "normal"};`,
        `text-decoration: ${style.underline ? "underline" : "none"};`,
        `background-color: ${style.background ? this._createRGB(style.background) : "transparent"};`,
      ];

      if (style.flash) {
        styleStr = styleStr.concat([
          "animation-name: flasher;",
          "animation-duration: 1s;",
          "animation-timing-function: linear;",
          "animation-iteration-count: infinite;",
        ]);
      }
    } else {
      styleStr = [
        "color: rgb(255, 255, 255); justify-content: flex-start; text-align: left;",
        "font-style: normal; line-height: normal; font-weight: normal;",
        "text-decoration: none; width: 100%; display: flex;",
      ];
    }

    return styleStr.join("");
  }

  _ltrim(s) {
    return s.replace(/^\s+/g, "");
  }

  _rtrim(s) {
    return s.replace(/\s+$/g, "");
  }
}

CaptionRenderer = multiInstanceService(CaptionRenderer);
export { CaptionRenderer };
