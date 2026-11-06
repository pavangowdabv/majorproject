/* ================================================================
   forecast-animations.js
   Animated background chart + live data card updates
   ================================================================ */

/**
 * Initialise the full-width animated background line chart.
 * @param {string} canvasId
 */
function initBgChart(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const MONTHS = 24; // data points
  const ctx    = canvas.getContext('2d');

  /* ── Generate smooth wave data ── */
  function makeWave(base, amp, phase, len) {
    return Array.from({ length: len }, (_, i) =>
      base + amp * Math.sin((i / len) * Math.PI * 3 + phase) +
      (Math.random() - 0.5) * amp * 0.3
    );
  }

  const labels   = Array.from({ length: MONTHS }, (_, i) => `M${i + 1}`);
  const actual   = makeWave(55000, 18000, 0,    MONTHS);
  const forecast = makeWave(62000, 16000, 0.4,  MONTHS);
  const lower    = forecast.map(v => v * 0.91);
  const upper    = forecast.map(v => v * 1.09);

  /* ── Gradient fills ── */
  function makeGrad(color1, color2) {
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height || 300);
    g.addColorStop(0, color1);
    g.addColorStop(1, color2);
    return g;
  }

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Actual Sales',
          data: actual,
          borderColor: 'rgba(124,58,237,0.7)',
          backgroundColor: makeGrad('rgba(124,58,237,0.2)', 'rgba(124,58,237,0)'),
          fill: true, tension: 0.45, pointRadius: 0, borderWidth: 2,
        },
        {
          label: 'Forecast',
          data: forecast,
          borderColor: 'rgba(6,182,212,0.65)',
          backgroundColor: makeGrad('rgba(6,182,212,0.15)', 'rgba(6,182,212,0)'),
          fill: true, tension: 0.45, pointRadius: 0, borderWidth: 2, borderDash: [6, 3],
        },
        {
          label: 'Upper Bound',
          data: upper,
          borderColor: 'rgba(167,139,250,0.3)',
          fill: false, tension: 0.45, pointRadius: 0, borderWidth: 1, borderDash: [3, 4],
        },
        {
          label: 'Lower Bound',
          data: lower,
          borderColor: 'rgba(167,139,250,0.3)',
          fill: false, tension: 0.45, pointRadius: 0, borderWidth: 1, borderDash: [3, 4],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 2000, easing: 'easeInOutQuart' },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { display: false },
        y: { display: false },
      },
      elements: { line: { capBezierPoints: false } },
    },
  });

  /* ── Slowly animate the chart data over time ── */
  let tick = 0;
  setInterval(() => {
    tick++;
    chart.data.datasets[0].data = makeWave(55000 + tick * 200, 18000, tick * 0.05, MONTHS);
    chart.data.datasets[1].data = makeWave(62000 + tick * 220, 16000, tick * 0.04 + 0.4, MONTHS);
    chart.data.datasets[2].data = chart.data.datasets[1].data.map(v => v * 1.09);
    chart.data.datasets[3].data = chart.data.datasets[1].data.map(v => v * 0.91);
    chart.update('none'); // no animation on live update for smoothness
  }, 2400);

  return chart;
}

/* ================================================================
   Floating card live counter animation
   Increments displayed numbers slightly to give a "live" feel.
   ================================================================ */
function initLiveCounters() {
  const counters = [
    { selector: '.float-card-2 .fc-value', base: 48920, variance: 80,  format: v => v.toLocaleString() },
    { selector: '.float-card-3 .fc-value', base: 2.84,  variance: 0.01, format: v => `$${v.toFixed(2)}M` },
  ];

  counters.forEach(({ selector, base, variance, format }) => {
    const el = document.querySelector(selector);
    if (!el) return;
    let current = base;
    setInterval(() => {
      current += (Math.random() - 0.48) * variance;
      el.textContent = format(current);
    }, 3000);
  });
}

/* Run live counters after DOM ready */
document.addEventListener('DOMContentLoaded', initLiveCounters);
