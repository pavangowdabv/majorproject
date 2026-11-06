/* ===== FORM INPUT COMPONENT ===== */
class FormInput {
  /**
   * @param {string} inputId - ID of the <input> element
   * @param {Function} validator - fn(value) => string|null (null = valid, string = error msg)
   * @param {string} errorId - ID of the error hint element
   */
  constructor(inputId, validator, errorId) {
    this.input = document.getElementById(inputId);
    this.errorEl = document.getElementById(errorId);
    this.validator = validator;
    if (this.input) this._bind();
  }

  _bind() {
    this.input.addEventListener('blur', () => this.validate());
    this.input.addEventListener('input', () => {
      if (this.input.classList.contains('error')) this.validate();
    });
  }

  validate() {
    const msg = this.validator(this.input.value.trim());
    if (msg) {
      this.input.classList.add('error');
      this.input.classList.remove('success');
      if (this.errorEl) { this.errorEl.textContent = msg; this.errorEl.classList.add('show'); }
      return false;
    } else {
      this.input.classList.remove('error');
      this.input.classList.add('success');
      if (this.errorEl) this.errorEl.classList.remove('show');
      return true;
    }
  }

  getValue() { return this.input ? this.input.value.trim() : ''; }
  reset() {
    if (this.input) { this.input.value = ''; this.input.classList.remove('error', 'success'); }
    if (this.errorEl) this.errorEl.classList.remove('show');
  }
}
