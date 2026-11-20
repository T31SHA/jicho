'use strict';

function selectIslandLayout({ pendingCount = 0, showSettings = false, expanded = false, activeUntil = 0, now = Date.now() } = {}) {
  if (pendingCount > 0) return 'card';
  if (showSettings) return 'phone';
  if (expanded || activeUntil > now) return 'expanded';
  return 'idle';
}

const LAYOUT_SIZE = Object.freeze({
  idle: [448, 92],
  expanded: [568, 560],
  card: [448, 360],
  phone: [430, 700]
});

function selectIslandBounds(display, layout, offsetX = 0, offsetY = 0) {
  const size = LAYOUT_SIZE[layout] || LAYOUT_SIZE.idle;
  const area = display && (display.workArea || display.bounds);
  if (!area) throw new TypeError('A display work area is required.');
  return {
    x: Math.round(area.x + (area.width - size[0]) / 2 + offsetX),
    y: Math.round(area.y + 8 + offsetY),
    width: size[0],
    height: size[1]
  };
}

module.exports = { selectIslandLayout, selectIslandBounds };
