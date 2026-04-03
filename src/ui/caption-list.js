export class UICaptionList {
  constructor(parent) {
    this._btn = parent.querySelector(".btn-captions");
    this._btn.style.display = "inline-grid";

    this._listDlg = parent.querySelector(".caption-menu");
    this._list = parent.querySelector(".caption-section");
    this._btn.addEventListener("click", this._onBtnClick);

    this._parent = parent;
    this._captions = [];
  }

  setUIControlInterface(iface) {
    this._uiControl = iface;
  }

  setUserActionReportInterface(iface) {
    this._userActionReport = iface;
  }

  setCaptions(captions) {
    this._captions = captions;
  }

  setActiveIdx(idx) {
    this._activeIdx = idx;
    this.refresh();
  }

  getCaptionTitle(idx) {
    let title = this._captions[idx].name || `CC${idx + 1}`;
    if (this._captions[idx].lang) {
      title += ` (${this._captions[idx].lang})`;
    }
    return title;
  }

  isVisible() {
    return !!this._captListDlg;
  }

  refresh() {
    if (this._captBtn) {
      this._captBtn.style.display =
        this._captions.length > 0 ? "block" : "none";
    }
    if (this._captListDlg) {
      this._updateCaptionListDialog();
    }
  }

  closeDialog() {
    if (!this._listDlg) return;
    this._listDlg.hidden = true;
  }

  destroy() {
    this._btn.removeEventListener("click", this._onBtnClick);
    this._btn = this._listDlg = undefined;
    this._uiControl = this._captions = undefined;
  }

  _updateCaptionListDialog() {
    while (this._captListDlg.firstChild) {
      this._captListDlg.removeChild(this._captListDlg.firstChild);
    }

    for (let i = 0; i < this._captions.length; i++) {
      if (!this._captions[i]) {
        continue;
      }

      let title = this.getCaptionTitle(i);
      let cLi = document.createElement("li");
      if (this._activeIdx === i) {
        title = "&#10003 " + title;
      }
      cLi.innerHTML = title;
      cLi.onclick = function (e) {
        if (this._userActionReport) {
          let idx = i === this._activeIdx ? -1 : i;
          this._userActionReport.selectCaption(idx);
        }
        e.stopPropagation();
      }.bind(this);

      this._captListDlg.appendChild(cLi);
    }
  }

  _onBtnClick = function (e) {
    this._listDlg.hidden = !this._listDlg.hidden;
    if (this._captListDlg) {

      this._uiControl.showControlsForPeriod(2);
    } else {
      this._uiControl.closeCtrlDialogs();
      this._updateCaptionListDialog();

      this._playerWrp.insertBefore(this._captListDlg, this._btnHolder);
      this._uiControl.showControlsForPeriod("infinite");
    }
    e.stopPropagation();
  }.bind(this);

}
