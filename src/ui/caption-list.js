export class UICaptionList {
  constructor(parent, eventBus) {
    this._btn = parent.querySelector(".btn-captions");
    this._listDlg = parent.querySelector(".caption-menu");
    this._list = parent.querySelector(".caption-section");
    this._btn.addEventListener("click", this._onBtnClick);

    this._offLabel = "Turn Off";
    this._eventBus = eventBus;
    this._parent = parent;
    this._captions = [];
  }

  getCaptionTitle(idx) {
    let title = this._captions[idx].name || `CC${idx + 1}`;
    if (this._captions[idx].lang) {
      title += ` (${this._captions[idx].lang})`;
    }
    return title;
  }

  refresh() {
    this._toggleButton();
    if (this.visible) {
      this._updateCaptionListDialog();
    }
  }

  closeDialog() {
    if (!this._listDlg) return;
    this._listDlg.hidden = true;
  }

  hide() {
    this.closeDialog();
    this._btn.style.display = "none";
  }

  destroy() {
    this._btn.removeEventListener("click", this._onBtnClick);
    this._btn = this._listDlg = this._captions = undefined;
  }

  get visible() {
    return this._listDlg && !this._listDlg.hidden;
  }

  set captions(val) {
    this._captions = val;
  }

  set userActionReportInterface(iface) {
    this._userActionReport = iface;
  }

  set activeIdx(idx) {
    this._activeIdx = idx;
    this.refresh();
  }

  _toggleButton() {
    if (!this._btn) return;
    this._btn.style.display = this._captions.length ? "inline-grid" : "none";
  }

  _updateCaptionListDialog() {
    if (!this._list) return;

    let offBtn = this._list.querySelector(".menu-item.captions-off");
    if (this._activeIdx === -1) {
      offBtn.textContent = "✓ " + this._offLabel;
      offBtn.setAttribute("aria-checked", "true");
    } else {
      offBtn.textContent = this._offLabel;
      offBtn.setAttribute("aria-checked", "false");
    }
    offBtn.onclick = (e) => {
      if (this._userActionReport) {
        this._userActionReport.selectCaption(-1);
        this.closeDialog();
      }
      e.stopPropagation();
    };

    this._list.querySelectorAll(".menu-item").forEach((btn) => {
      if (btn !== offBtn) btn.remove();
    });

    for (let i = 0; i < this._captions.length; i++) {
      if (!this._captions[i]) continue;

      let title = this.getCaptionTitle(i);
      let capt = document.createElement("button");
      capt.className = "menu-item";
      capt.setAttribute("role", "menuitemradio");
      if (this._activeIdx === i) {
        title = "✓ " + title;
        capt.setAttribute("aria-checked", "true");
      } else {
        capt.setAttribute("aria-checked", "false");
      }
      capt.textContent = title;
      capt.onclick = (e) => {
        if (this._userActionReport) {
          this._userActionReport.selectCaption(i);
          this.closeDialog();
        }
        e.stopPropagation();
      };

      this._list.appendChild(capt);
    }
  }

  _onBtnClick = function (e) {
    this._listDlg.hidden = !this._listDlg.hidden;
    if (!this._listDlg.hidden) {
      this._eventBus.emit("ui:caption-list-open");
      this._updateCaptionListDialog();
    }
    e.stopPropagation();
  }.bind(this);
}
