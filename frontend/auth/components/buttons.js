/* ===== BUTTON COMPONENT ===== */
class AuthButton {
  /**
   * @param {string} id - button element ID
   * @param {Function} onClick - async click handler
   * @param {string} loadingLabel - text shown while loading
   */
  constructor(id, onClick, loadingLabel = 'Loading...') {
    this.btn = document.getElementById(id);
    this.loadingLabel = loadingLabel;
    this._originalLabel = '';
    if (this.btn) {
      this._originalLabel = this.btn.querySelector('.btn-text')?.textContent || this.btn.textContent;
      this.btn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (this.btn.disabled) return;
        this.setLoading(true);
        try { await onClick(); } finally { this.setLoading(false); }
      });
    }
  }

  setLoading(on) {
    if (!this.btn) return;
    this.btn.disabled = on;
    const spinner = this.btn.querySelector('.btn-spinner');
    const text    = this.btn.querySelector('.btn-text');
    if (spinner) spinner.classList.toggle('show', on);
    if (text) text.textContent = on ? this.loadingLabel : this._originalLabel;
  }

  enable()  { if (this.btn) this.btn.disabled = false; }
  disable() { if (this.btn) this.btn.disabled = true; }
}
