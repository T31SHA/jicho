/* Usage: const bot = JichoBot.mount(el); bot.setMood('needs-you'); bot.lookAt(dx, dy); */
(function (root) {
  const SVG = `
<svg class="jicho-bot" viewBox="0 0 120 120" role="img" aria-label="Jicho" data-mood="idle" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="jicho-glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="2.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <linearGradient id="jicho-hood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a7aab0"/><stop offset="1" stop-color="#777a81"/></linearGradient>
    <linearGradient id="jicho-visor" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#23252b"/><stop offset="1" stop-color="#0b0c0f"/></linearGradient>
  </defs>
  <g class="bob">
    <path d="M10 118 C12 92 34 84 60 84 C86 84 108 92 110 118 Z" fill="#7d8087"/>
    <path d="M44 86 L42 104 M76 86 L78 104" stroke="#e8b9a0" stroke-width="3" stroke-linecap="round"/>
    <ellipse cx="60" cy="52" rx="48" ry="46" fill="url(#jicho-hood)"/>
    <ellipse cx="60" cy="56" rx="39" ry="35" fill="#5f6269"/>
    <rect x="24" y="30" width="72" height="50" rx="24" fill="url(#jicho-visor)"/>
    <ellipse cx="42" cy="38" rx="13" ry="4.5" fill="#fff" opacity=".07"/>
    <g class="eyes">
      <rect class="eye l" x="38" y="44" width="11" height="22" rx="5.5"/>
      <rect class="core l" x="41" y="48" width="5" height="12" rx="2.5"/>
      <rect class="eye r" x="71" y="46" width="10" height="19" rx="5"/>
      <rect class="core r" x="73.5" y="50" width="4.5" height="10" rx="2.2"/>
      <path class="happy" d="M37 61 Q43.5 47 50 61"/>
      <path class="happy" d="M70 61 Q76 48 82 61"/>
    </g>
  </g>
</svg>`;
  const MOODS = ['idle', 'working', 'needs-you', 'done', 'offline'];
  function mount(el) {
    el.innerHTML = SVG;
    const svg = el.querySelector('svg');
    return {
      setMood(m) { svg.setAttribute('data-mood', MOODS.includes(m) ? m : 'idle'); },
      lookAt(dx, dy) {
        const c = (v, max) => Math.max(-max, Math.min(max, v));
        svg.style.setProperty('--lx', c(dx / 40, 4).toFixed(2));
        svg.style.setProperty('--ly', c(dy / 40, 3).toFixed(2));
      }
    };
  }
  root.JichoBot = { mount, MOODS };
})(typeof window !== 'undefined' ? window : globalThis);
