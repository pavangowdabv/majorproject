/* ===== OTP INPUT COMPONENT ===== */
class OTPInput {
  constructor(containerId, digits = 6, onChange) {
    this.container = document.getElementById(containerId);
    this.digits = digits;
    this.onChange = onChange;
    this.inputs = [];
    this._render();
    this._bind();
  }

  _render() {
    this.container.innerHTML = '';
    this.container.className = 'otp-wrapper';
    for (let i = 0; i < this.digits; i++) {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.inputMode = 'numeric';
      inp.maxLength = 1;
      inp.className = 'otp-box';
      inp.setAttribute('autocomplete', 'one-time-code');
      inp.setAttribute('aria-label', `OTP digit ${i + 1}`);
      this.container.appendChild(inp);
      this.inputs.push(inp);
    }
  }

  _bind() {
    this.inputs.forEach((inp, idx) => {
      inp.addEventListener('input', (e) => {
        const val = e.target.value.replace(/\D/g, '');
        inp.value = val ? val[0] : '';
        inp.classList.toggle('filled', !!inp.value);
        if (val && idx < this.digits - 1) this.inputs[idx + 1].focus();
        this._notify();
      });

      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace') {
          if (!inp.value && idx > 0) {
            this.inputs[idx - 1].value = '';
            this.inputs[idx - 1].classList.remove('filled');
            this.inputs[idx - 1].focus();
          } else {
            inp.value = '';
            inp.classList.remove('filled');
          }
          this._notify();
        }
        if (e.key === 'ArrowLeft' && idx > 0) this.inputs[idx - 1].focus();
        if (e.key === 'ArrowRight' && idx < this.digits - 1) this.inputs[idx + 1].focus();
      });

      // Handle paste
      inp.addEventListener('paste', (e) => {
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
        pasted.split('').slice(0, this.digits).forEach((ch, i) => {
          if (this.inputs[i]) {
            this.inputs[i].value = ch;
            this.inputs[i].classList.add('filled');
          }
        });
        const next = Math.min(pasted.length, this.digits - 1);
        this.inputs[next].focus();
        this._notify();
      });

      inp.addEventListener('focus', () => inp.select());
    });
  }

  _notify() {
    const val = this.getValue();
    if (this.onChange) this.onChange(val, val.length === this.digits);
  }

  getValue() {
    return this.inputs.map(i => i.value).join('');
  }

  setError() {
    this.inputs.forEach(i => { i.classList.add('error'); i.classList.remove('filled'); });
    setTimeout(() => this.inputs.forEach(i => i.classList.remove('error')), 600);
  }

  setSuccess() {
    this.inputs.forEach(i => { i.classList.add('success-box'); i.classList.remove('error'); });
  }

  clear() {
    this.inputs.forEach(i => { i.value = ''; i.classList.remove('filled', 'error', 'success-box'); });
    this.inputs[0].focus();
  }

  focus() {
    this.inputs[0].focus();
  }
}
