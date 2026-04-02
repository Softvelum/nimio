export class UICaptionList {
  constructor(playerWrp, btnHolder, nextEl) {
    if (btnHolder && nextEl && !this._btnHolder) {
      this._captBtn = btnHolder.querySelector(".btn-captions");
      this._captBtn.onclick = this._captBtnClick;

      this._btnHolder = btnHolder;
      this._btnHolder.insertBefore(this._captBtn, nextEl);

      this._playerWrp = playerWrp;
    }

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
    if (this._captListDlg) {
      this._captListDlg.remove();
      delete this._captListDlg;
    }
  }

  destroy() {
    this._captBtn = undefined;
    this._btnHolder = undefined;
    this._captListDlg = undefined;
    this._playerWrp = undefined;
    this._uiControl = undefined;
    this._captions = undefined;
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

  _captBtnClick = function (e) {
    if (this._captListDlg) {
      this._captListDlg.remove();
      delete this._captListDlg;
      this._uiControl.showControlsForPeriod(2);
    } else {
      this._uiControl.closeCtrlDialogs();

      this._captListDlg = document.createElement("ul");
      this._captListDlg.className = "sldp_capt_dialog sldp_ctrl_dialog";
      this._updateCaptionListDialog();

      this._playerWrp.insertBefore(this._captListDlg, this._btnHolder);
      this._uiControl.showControlsForPeriod("infinite");
    }
    e.stopPropagation();
  }.bind(this);
}
