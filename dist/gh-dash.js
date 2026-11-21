/*
 * GH-Dash floor-plan card for Home Assistant.
 * A floor-plan image with buttons on top: tap = toggle, long-press = more info,
 * a glow shows what is on. Zoom (+/-, Ctrl+wheel, drag to pan) and a light/dark
 * switch on the card. In the card editor, devices are dragged from a list onto
 * the plan and moved/resized there. One file, no dependencies.
 *
 * Card type: custom:gh-dash-card
 */
const VERSION = '0.12.0';

// ---------------------------------------------------------------- helpers --

const TOGGLE_DOMAINS = new Set(['light', 'switch', 'fan', 'input_boolean', 'media_player']);
const MEDIA_OFF = new Set(['off', 'standby', 'unavailable', 'unknown']);
const STYLES = ['hotspot', 'label', 'text'];
const TAP_ACTIONS = ['toggle', 'more-info', 'sliders', 'ha-info', 'none'];
const COLOR_MODES = new Set(['hs', 'rgb', 'rgbw', 'rgbww', 'xy']);
const THEMES = ['light', 'dark', 'auto'];
const GROUPS = {
  light: 'lights',
  switch: 'switches', input_boolean: 'switches',
  media_player: 'media',
  fan: 'other', cover: 'other', climate: 'other', humidifier: 'other', vacuum: 'other',
  siren: 'other', valve: 'other', water_heater: 'other',
  scene: 'scenes', script: 'scenes',
  sensor: 'sensors', binary_sensor: 'sensors',
};
const GROUP_ORDER = ['lights', 'switches', 'media', 'sensors', 'scenes', 'other'];
// Only sensors that make sense on a floor plan are offered.
const SENSOR_CLASSES = new Set(['temperature', 'humidity', 'moisture']);
const BINARY_CLASSES = new Set(['door', 'window', 'opening', 'garage_door', 'motion', 'occupancy', 'moisture', 'smoke']);
const ACTIVATE_DOMAINS = new Set(['scene', 'script']);
// media_player supported_features bits (HA MediaPlayerEntityFeature)
const MP_PAUSE = 1;
const MP_VOLUME_SET = 4;
const MP_PREVIOUS = 16;
const MP_NEXT = 32;
const MP_PLAY = 16384;
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;
export const ZOOM_STEP = 0.25;

const round1 = (v) => Math.round(v * 10) / 10;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

/** True when the entity is missing, unavailable or unknown. */
export function isUnavailable(stateObj) {
  if (!stateObj) return true;
  // a scene/script that was never run has state 'unknown' but works fine
  if (/^(scene|script)\./.test(stateObj.entity_id)) return stateObj.state === 'unavailable';
  return stateObj.state === 'unavailable' || stateObj.state === 'unknown';
}

/** True when the entity counts as "on" (media players: anything but off/standby). */
export function isOn(stateObj) {
  if (isUnavailable(stateObj)) return false;
  const domain = stateObj.entity_id.split('.')[0];
  if (domain === 'media_player') return !MEDIA_OFF.has(stateObj.state);
  return stateObj.state === 'on';
}

/** Glow colour: the light's own colour when it has one, else the fallback. */
export function glowColor(stateObj, fallback) {
  if (stateObj && String(stateObj.entity_id).startsWith('binary_sensor.') && isOn(stateObj)) {
    return 'var(--error-color, #e53935)';
  }
  const rgb = stateObj && stateObj.attributes && stateObj.attributes.rgb_color;
  if (stateObj && stateObj.entity_id.startsWith('light.') && isOn(stateObj) && Array.isArray(rgb) && rgb.length === 3) {
    return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  }
  return fallback;
}

/** The service call that toggles an entity. */
export function toggleCall(entityId) {
  const domain = entityId.split('.')[0];
  if (ACTIVATE_DOMAINS.has(domain)) return { domain, service: 'turn_on', data: { entity_id: entityId } };
  return TOGGLE_DOMAINS.has(domain)
    ? { domain, service: 'toggle', data: { entity_id: entityId } }
    : { domain: 'homeassistant', service: 'toggle', data: { entity_id: entityId } };
}

/** Keep a box (percent of the image) inside the image, 1 decimal, min size 1. */
export function clampRect({ x, y, w, h }) {
  const W = clamp(round1(num(w, 8)), 1, 100);
  const H = clamp(round1(num(h, 3)), 1, 100);
  return {
    x: round1(clamp(round1(num(x, 0)), 0, 100 - W)),
    y: round1(clamp(round1(num(y, 0)), 0, 100 - H)),
    w: W,
    h: H,
  };
}

/** Pixel movement -> percent movement of the image box. */
export function pxToPct(dx, dy, boxWidth, boxHeight) {
  return {
    dx: boxWidth > 0 ? (dx / boxWidth) * 100 : 0,
    dy: boxHeight > 0 ? (dy / boxHeight) * 100 : 0,
  };
}

/** Zoom factor limited to 0.5..3 in 0.25 steps. */
export function clampZoom(z) {
  return clamp(Math.round(num(z, 1) / ZOOM_STEP) * ZOOM_STEP, ZOOM_MIN, ZOOM_MAX);
}

/** A new 8x3 % box centred on a drop point; null when dropped outside the plan. */
export function dropRect(clientX, clientY, stage, w = 8, h = 3) {
  if (!stage || stage.width <= 0 || stage.height <= 0) return null;
  if (clientX < stage.left || clientX > stage.left + stage.width || clientY < stage.top || clientY > stage.top + stage.height) return null;
  const px = ((clientX - stage.left) / stage.width) * 100;
  const py = ((clientY - stage.top) / stage.height) * 100;
  return clampRect({ x: px - w / 2, y: py - h / 2, w, h });
}

/** Light or dark: the card's own switch (stored) wins, then the config, 'auto' follows HA. */
export function resolveTheme(configTheme, stored, haDark) {
  if (stored === 'light' || stored === 'dark') return stored;
  if (configTheme === 'light' || configTheme === 'dark') return configTheme;
  if (configTheme === 'auto') return haDark ? 'dark' : 'light';
  return 'light';
}

/** Zoom at which the whole plan height fits in availHeight (0.1..1, 2 decimals). */
export function fitZoom(availHeight, width, aspect) {
  if (!(width > 0) || !(aspect > 0) || !(availHeight > 0)) return 1;
  return Math.round(clamp(availHeight / (width * aspect), 0.1, 1) * 100) / 100;
}

/** Replace the first card in a dashboard config that equals oldCard. Returns {found, config}. */
export function replaceCard(dashConfig, oldCard, newCard) {
  const target = JSON.stringify(oldCard);
  let found = false;
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      if (!found && node.type === 'custom:gh-dash-card' && JSON.stringify(node) === target) {
        found = true;
        return JSON.parse(JSON.stringify(newCard));
      }
      const out = {};
      Object.keys(node).forEach((k) => { out[k] = walk(node[k]); });
      return out;
    }
    return node;
  };
  const config = walk(dashConfig);
  return { found, config };
}

/** Rotation in whole degrees, 0..359. */
export function normRotate(deg) {
  const n = Math.round(num(deg, 0));
  return ((n % 360) + 360) % 360;
}

/** What a light can do: brightness, colour, white temperature. Non-lights: nothing. */
export function lightCaps(stateObj) {
  const none = { brightness: false, color: false, temp: false };
  if (!stateObj || !String(stateObj.entity_id).startsWith('light.')) return none;
  const modes = (stateObj.attributes && stateObj.attributes.supported_color_modes) || [];
  const color = modes.some((m) => COLOR_MODES.has(m));
  const temp = modes.includes('color_temp');
  return { brightness: color || temp || modes.includes('brightness') || modes.includes('white'), color, temp };
}

/** Angle from a box centre to the pointer: up = 0, clockwise. step > 0 snaps to steps,
 *  otherwise it snaps to 0/90/180/270 when within 4 degrees. */
export function angleTo(cx, cy, px, py, step = 0) {
  let a = (Math.atan2(py - cy, px - cx) * 180) / Math.PI + 90;
  a = ((a % 360) + 360) % 360;
  if (step > 0) return normRotate(Math.round(a / step) * step);
  const q = Math.round(a / 90) * 90;
  return normRotate(Math.abs(a - q) <= 4 ? q : a);
}

/** The rectangles a room is made of (a plain room is one rectangle). */
export function roomParts(r) {
  const src = r && Array.isArray(r.parts) && r.parts.length ? r.parts : [r || {}];
  return src.map((q) => ({ x: num(q.x, 0), y: num(q.y, 0), w: num(q.w, 10), h: num(q.h, 10) }));
}

/** Index of the room that contains the centre of box b (the smallest room wins), or -1. */
export function roomOf(rooms, b) {
  const cx = num(b.x, 0) + num(b.w, 0) / 2;
  const cy = num(b.y, 0) + num(b.h, 0) / 2;
  let best = -1;
  let area = Infinity;
  (rooms || []).forEach((r, i) => {
    const parts = roomParts(r);
    const inside = parts.some((q) => cx >= q.x && cx <= q.x + q.w && cy >= q.y && cy <= q.y + q.h);
    const size = parts.reduce((sum, q) => sum + q.w * q.h, 0);
    if (inside && size < area) { best = i; area = size; }
  });
  return best;
}

/** A point on the border two boxes share (touching within tol %, or overlapping), else null. */
export function sharedEdge(a, b, tol = 1.5) {
  const ax1 = a.x + a.w;
  const ay1 = a.y + a.h;
  const bx1 = b.x + b.w;
  const by1 = b.y + b.h;
  const oy0 = Math.max(a.y, b.y);
  const oy1 = Math.min(ay1, by1);
  const ox0 = Math.max(a.x, b.x);
  const ox1 = Math.min(ax1, bx1);
  if (oy1 - oy0 > 0) {
    if (Math.abs(ax1 - b.x) <= tol) return { x: round1((ax1 + b.x) / 2), y: round1((oy0 + oy1) / 2) };
    if (Math.abs(bx1 - a.x) <= tol) return { x: round1((bx1 + a.x) / 2), y: round1((oy0 + oy1) / 2) };
  }
  if (ox1 - ox0 > 0) {
    if (Math.abs(ay1 - b.y) <= tol) return { x: round1((ox0 + ox1) / 2), y: round1((ay1 + b.y) / 2) };
    if (Math.abs(by1 - a.y) <= tol) return { x: round1((ox0 + ox1) / 2), y: round1((by1 + a.y) / 2) };
  }
  if (ox1 - ox0 > 0 && oy1 - oy0 > 0) return { x: round1((ox0 + ox1) / 2), y: round1((oy0 + oy1) / 2) };
  return null;
}

/** Join room j into room i: i keeps its name and gets j's rectangles; j is removed. */
export function mergeRooms(rooms, i, j) {
  const target = { name: rooms[i].name, parts: [...roomParts(rooms[i]), ...roomParts(rooms[j])] };
  return rooms.map((r, k) => (k === i ? target : r)).filter((_, k) => k !== j);
}

/** Drag one side or corner of a box: edge is n, s, e, w or a corner like ne / sw. Min size 1. */
export function resizeEdge(r, edge, dx, dy) {
  let x0 = r.x;
  let y0 = r.y;
  let x1 = r.x + r.w;
  let y1 = r.y + r.h;
  if (edge.includes('w')) x0 = clamp(Math.min(x0 + dx, x1 - 1), 0, 100);
  if (edge.includes('e')) x1 = clamp(Math.max(x1 + dx, x0 + 1), 0, 100);
  if (edge.includes('n')) y0 = clamp(Math.min(y0 + dy, y1 - 1), 0, 100);
  if (edge.includes('s')) y1 = clamp(Math.max(y1 + dy, y0 + 1), 0, 100);
  return { x: round1(x0), y: round1(y0), w: round1(x1 - x0), h: round1(y1 - y0) };
}

/** Font size (px) that fits a text in a box of w x h px: never above maxPx, 1 or 2 lines. */
export function fitFont(text, w, h, maxPx) {
  const len = Math.max(1, String(text || '').length);
  let best = 0;
  [1, 2].forEach((lines) => {
    if (lines === 2 && !String(text || '').includes(' ') && len < 10) return;
    const byWidth = w / (Math.ceil(len / lines) * 0.6);
    const byHeight = (h * 0.8) / (lines * 1.15);
    best = Math.max(best, Math.min(byWidth, byHeight));
  });
  return Math.round(clamp(Math.min(best, maxPx), 4, maxPx) * 10) / 10;
}

/** Counts for the HA information panel: entities, lights on, unavailable, pending updates. */
export function haSummary(states) {
  const all = Object.values(states || {});
  const lights = all.filter((x) => x.entity_id.startsWith('light.'));
  return {
    entities: all.length,
    lightsOn: lights.filter((x) => x.state === 'on').length,
    lightsTotal: lights.length,
    unavailable: all.filter((x) => x.state === 'unavailable' || x.state === 'unknown').length,
    updates: all.filter((x) => x.entity_id.startsWith('update.') && x.state === 'on')
      .map((x) => ({ name: x.attributes.friendly_name || x.entity_id, version: x.attributes.latest_version || '' })),
  };
}

/** A size in GB as text (the Supervisor reports disk sizes in GB). */
export function fmtBytes(gb) {
  if (gb === undefined || gb === null || Number.isNaN(Number(gb))) return '–';
  const v = round1(Number(gb));
  return `${Number.isInteger(v) ? v : v.toFixed(1)} GB`;
}

// Example apartment: rooms measured on the bundled plan (dist/plan.png, 1357 x 1920). No devices.
const STARTER_ROOMS = [{"name": "Balkong", "x": 52.7, "y": 18.0, "w": 21.7, "h": 5.7}, {"name": "Sovrum 3", "x": 46.1, "y": 24.5, "w": 22.8, "h": 18.8}, {"name": "Kök", "x": 70.4, "y": 27.6, "w": 21.3, "h": 25.3}, {"name": "Hall", "parts": [{"x": 46.1, "y": 44.8, "w": 26.9, "h": 9.9}, {"x": 46.1, "y": 54.7, "w": 14.4, "h": 13.0}, {"x": 29.5, "y": 62.2, "w": 16.6, "h": 5.5}]}, {"name": "Bad", "x": 21.0, "y": 53.6, "w": 15.8, "h": 8.6}, {"name": "WC", "x": 38.3, "y": 54.7, "w": 7.0, "h": 7.6}, {"name": "Sovrum 1", "x": 9.2, "y": 64.1, "w": 20.3, "h": 18.2}, {"name": "Sovrum 2", "x": 35.4, "y": 69.3, "w": 27.3, "h": 13.0}, {"name": "Vardagsrum", "x": 64.1, "y": 55.2, "w": 26.2, "h": 27.1}];

/** A clean start: the bundled plan, its rooms and the Console/Terminal info button - no devices. */
export function starterConfig(image) {
  if (!image) return { type: 'custom:gh-dash-card', image: '', buttons: [] };
  return {
    type: 'custom:gh-dash-card',
    image,
    fit: true,
    buttons: [{ label: 'Console/Terminal', style: 'label', tap_action: 'ha-info', rotate: 90, x: 54, y: 53, w: 8, h: 3 }],
    rooms: JSON.parse(JSON.stringify(STARTER_ROOMS)),
  };
}

/** The floor plan shipped next to this file (dist/plan.png), as a URL the browser can load. */
function bundledPlan() {
  try {
    const u = new URL('plan.png', import.meta.url);
    if (typeof window === 'undefined') return u.pathname;
    return u.origin === window.location.origin ? u.pathname : u.href;
  } catch (e) {
    return '';
  }
}

/** Service call for a room: 'off' = everything controllable off, 'on' = the lights on. Null when nothing applies. */
export function roomCall(entityIds, mode) {
  const ids = (entityIds || []).filter((e) => TOGGLE_DOMAINS.has(String(e).split('.')[0]));
  if (mode === 'on') {
    const lights = ids.filter((e) => e.startsWith('light.'));
    return lights.length ? { domain: 'light', service: 'turn_on', data: { entity_id: lights } } : null;
  }
  return ids.length ? { domain: 'homeassistant', service: 'turn_off', data: { entity_id: ids } } : null;
}

/** Every placed device that can be turned off, each once. */
export function allOffTargets(buttons) {
  const out = [];
  (buttons || []).forEach((b) => {
    if (b.entity && TOGGLE_DOMAINS.has(String(b.entity).split('.')[0]) && !out.includes(b.entity)) out.push(b.entity);
  });
  return out;
}

/** A sensor's value as short text: '21,5 °C' (sv) / '21.5 °C' (en), '–' when unknown. */
export function sensorText(stateObj, lang) {
  if (isUnavailable(stateObj)) return '–';
  const unit = (stateObj.attributes && stateObj.attributes.unit_of_measurement) || '';
  const n = Number(stateObj.state);
  let v = stateObj.state;
  if (stateObj.state !== '' && !Number.isNaN(n)) {
    const r = Math.round(n * 10) / 10;
    v = String(r);
    if (String(lang || '').toLowerCase().startsWith('sv')) v = v.replace('.', ',');
  }
  return unit ? `${v} ${unit}` : v;
}

/** New items for devices whose Home Assistant area has the same name as a room (not yet placed). */
export function autoPlace(rooms, devices, buttons) {
  const placed = new Set((buttons || []).map((b) => b.entity).filter(Boolean));
  const byName = new Map();
  (rooms || []).forEach((r, i) => { if (r.name) byName.set(String(r.name).trim().toLowerCase(), i); });
  const count = {};
  const out = [];
  (devices || []).forEach((d) => {
    if (placed.has(d.id) || !d.area) return;
    const i = byName.get(String(d.area).trim().toLowerCase());
    if (i === undefined) return;
    const q = roomParts(rooms[i])[0];
    const k = count[i] || 0;
    count[i] = k + 1;
    const cols = 3;
    const cellW = q.w / cols;
    const w = Math.max(1, Math.min(8, cellW * 0.9));
    const h = Math.max(1, Math.min(3, q.h / 4));
    const x = q.x + (k % cols) * cellW + (cellW - w) / 2;
    const y = q.y + Math.min(q.h - h, 1 + Math.floor(k / cols) * (h + 1));
    out.push({
      entity: d.id, style: 'label', ...clampRect({ x, y, w, h }),
      ...(d.id.startsWith('light.') ? { sliders: true } : {}),
      ...(groupOf(d.id) === 'sensors' ? { tap_action: 'more-info' } : {}),
    });
    placed.add(d.id);
  });
  return out;
}

/** What a media player shows and which controls it supports. */
export function mediaInfo(stateObj) {
  const a = (stateObj && stateObj.attributes) || {};
  const sf = num(a.supported_features, 0);
  return {
    title: a.media_title || '',
    artist: a.media_artist || a.media_series_title || '',
    picture: a.entity_picture || '',
    volume: a.volume_level === undefined || a.volume_level === null ? null : Math.round(Number(a.volume_level) * 100),
    playing: !!stateObj && stateObj.state === 'playing',
    canPlayPause: !!(sf & MP_PAUSE) || !!(sf & MP_PLAY),
    canVolume: !!(sf & MP_VOLUME_SET),
    canPrev: !!(sf & MP_PREVIOUS),
    canNext: !!(sf & MP_NEXT),
  };
}

/** Undo history: add a snapshot (not twice in a row), keep the last max. */
export function pushHistory(stack, snapshot, max = 50) {
  if (stack.length && stack[stack.length - 1] === snapshot) return stack;
  const out = [...stack, snapshot];
  return out.length > max ? out.slice(out.length - max) : out;
}

/** All devices Home Assistant has that can be placed, grouped by type, with their area name. */
export function scanDevices(states, entities, devices, areas) {
  const groups = Object.fromEntries(GROUP_ORDER.map((g) => [g, []]));
  const ents = entities || {};
  const devs = devices || {};
  const ars = areas || {};
  Object.keys(states || {}).forEach((id) => {
    const g = groupOf(id);
    if (!g) return;
    if (g === 'sensors') {
      const dc = states[id].attributes && states[id].attributes.device_class;
      const ok = id.startsWith('binary_sensor.') ? BINARY_CLASSES.has(dc) : SENSOR_CLASSES.has(dc);
      if (!ok) return;
    }
    const reg = ents[id] || {};
    if (reg.hidden) return;
    const areaId = reg.area_id || (reg.device_id && devs[reg.device_id] && devs[reg.device_id].area_id) || '';
    const area = (areaId && ars[areaId] && ars[areaId].name) || '';
    groups[g].push({ id, name: String(states[id].attributes.friendly_name || id), area });
  });
  Object.values(groups).forEach((list) => list.sort((a, b) => a.name.localeCompare(b.name)));
  return { groups, total: Object.values(groups).reduce((n, list) => n + list.length, 0) };
}

/** Indexes of the plan items that use this entity (a device should be on the plan once). */
export function placedAt(buttons, entityId) {
  if (!entityId) return [];
  const out = [];
  (buttons || []).forEach((b, i) => { if (b.entity === entityId) out.push(i); });
  return out;
}

/** Scenes and scripts are shown as preset buttons next to the plan, not on it. */
export function isPreset(entityId) {
  return ACTIVATE_DOMAINS.has(String(entityId || '').split('.')[0]);
}

/** Sensors are drawn as small round icons on the plan. */
export function isSensor(entityId) {
  const d = String(entityId || '').split('.')[0];
  return d === 'sensor' || d === 'binary_sensor';
}

/** The icon for a sensor, from its domain and device class. */
export function sensorIcon(stateObj, entityId) {
  const id = (stateObj && stateObj.entity_id) || entityId || '';
  const dc = stateObj && stateObj.attributes ? stateObj.attributes.device_class : undefined;
  if (id.startsWith('binary_sensor.')) {
    if (dc === 'window') return 'window';
    if (dc === 'door' || dc === 'garage_door' || dc === 'opening') return 'door';
    if (dc === 'motion' || dc === 'occupancy') return 'motion';
    if (dc === 'moisture') return 'drop';
    if (dc === 'smoke') return 'flame';
    return 'gauge';
  }
  if (dc === 'temperature') return 'thermo';
  if (dc === 'humidity' || dc === 'moisture') return 'drop';
  return 'gauge';
}

/** For every room, the entity ids of the devices placed inside it. */
export function roomMembers(rooms, buttons) {
  const out = (rooms || []).map(() => []);
  (buttons || []).forEach((b) => {
    if (!b.entity || isPreset(b.entity)) return;
    const i = roomOf(rooms, b);
    if (i >= 0) out[i].push(b.entity);
  });
  return out;
}

/** Current brightness in percent (0 when off). */
export function brightnessPct(stateObj) {
  if (!isOn(stateObj)) return 0;
  return Math.round((num(stateObj.attributes.brightness, 0) / 255) * 100);
}

/** Current hue in degrees, or null when the light has no colour. */
export function hueOf(stateObj) {
  const hs = stateObj && stateObj.attributes && stateObj.attributes.hs_color;
  return Array.isArray(hs) ? Math.round(hs[0]) : null;
}

/** light.turn_on call for a slider: {brightness: %} | {hue: deg} | {kelvin: K}. */
export function lightCall(entityId, { brightness, hue, kelvin } = {}) {
  const data = { entity_id: entityId };
  if (brightness !== undefined) data.brightness_pct = clamp(Math.round(num(brightness, 100)), 1, 100);
  if (hue !== undefined) data.hs_color = [normRotate(hue), 100];
  if (kelvin !== undefined) data.color_temp_kelvin = Math.round(num(kelvin, 2700));
  return { domain: 'light', service: 'turn_on', data };
}

/** Palette group of an entity, or null when it is not something to place. */
export function groupOf(entityId) {
  return GROUPS[String(entityId).split('.')[0]] || null;
}

/** Validate a card config and fill in defaults. Throws on a broken config. */
export function normalizeConfig(cfg) {
  if (!cfg || cfg.image === undefined || cfg.image === null) throw new Error('gh-dash-card: "image" is required');
  const buttons = (cfg.buttons || []).map((b, i) => {
    if (!b || typeof b !== 'object') throw new Error(`gh-dash-card: button ${i + 1} is not an object`);
    const style = b.style === undefined ? 'label' : b.style;
    if (!STYLES.includes(style)) throw new Error(`gh-dash-card: button ${i + 1} style must be hotspot, label or text`);
    const tap = b.tap_action === undefined ? 'toggle' : b.tap_action;
    if (!TAP_ACTIONS.includes(tap)) throw new Error(`gh-dash-card: button ${i + 1} tap_action must be toggle, more-info, sliders, ha-info or none`);
    return { ...b, x: num(b.x, 45), y: num(b.y, 45), w: num(b.w, 8), h: num(b.h, 3), style, tap_action: tap,
      rotate: normRotate(b.rotate), sliders: b.sliders === true,
      ...(b.size !== undefined && b.size !== null && b.size !== '' ? { size: num(b.size, 0.95) } : {}) };
  });
  const rooms = (cfg.rooms || []).map((r) => ({
    ...r, x: num(r.x, 0), y: num(r.y, 0), w: num(r.w, 10), h: num(r.h, 10), entities: r.entities || [], parts: roomParts(r),
  }));
  const theme = cfg.theme === undefined ? 'light' : cfg.theme;
  if (!THEMES.includes(theme)) throw new Error('gh-dash-card: theme must be light, dark or auto');
  return {
    ...cfg, buttons, rooms, glow_color: cfg.glow_color || 'auto', theme,
    zoom: clampZoom(cfg.zoom), show_controls: cfg.show_controls !== false, fit: cfg.fit !== false,
    dim_after: Math.max(0, num(cfg.dim_after, 120)),
  };
}

const TEXTS = {
  en: {
    on: 'on', off: 'off', unavailable: 'unavailable', playing: 'playing',
    room_none: 'No devices in this room', add_device: 'Add device', label: 'Label', style: 'Style',
    remove: 'Remove', image: 'Floor plan image (URL)', entity: 'Device', tap: 'On tap', glow: 'Glow colour (auto or CSS colour)',
    no_image: 'Set a floor-plan image in the card settings.', drag_hint: 'Drag a device from the list onto the plan. Click a box to edit it (click again to close). Drag to move, corner to resize, round handle to rotate. Mouse wheel zooms, drag an empty spot to move the plan.',
    st_hotspot: 'Hotspot (label is in the image)', st_label: 'Label (card draws the box)',
    tap_toggle: 'Turn on/off', 'tap_more-info': 'Show details', tap_none: 'Nothing', select_hint: 'Click a box on the plan to edit it.',
    zoom_in: 'Zoom in', zoom_out: 'Zoom out', zoom_reset: 'Reset zoom', to_dark: 'Dark mode', to_light: 'Light mode',
    theme: 'Background', th_light: 'Light', th_dark: 'Dark', th_auto: 'Follow Home Assistant', zoom_default: 'Start zoom (0.5-3)',
    controls: 'Show zoom and light/dark buttons on the card', palette: 'Devices - drag onto the plan', search: 'Search…',
    g_lights: 'Lights', g_switches: 'Plugs and switches', g_media: 'TV and media', g_other: 'Other', placed: 'placed',
    fit: 'Scale to fit', fit_opt: 'Scale the plan to fit the screen (default)', edit: 'Edit the plan: add and move devices',
    save: 'Save', cancel: 'Cancel', saving: 'Saving…', save_failed: 'Could not save', not_found: 'This card was not found in the dashboard (YAML dashboard?). Copy the YAML from the card editor instead.',
    edit_title: 'Edit the plan', unsaved: 'Not saved yet',
    tap_sliders: 'Show sliders', rotate: 'Rotation (degrees)', rot_left: 'Rotate 90° left', rot_right: 'Rotate 90° right',
    sliders_opt: 'Sliders (brightness and colour) on long-press', brightness: 'Brightness', color: 'Colour',
    temp: 'White: warm – cold', more: 'More…', close: 'Close', onoff_only: 'This light can only be turned on and off.',
    turn_on: 'Turn on', turn_off: 'Turn off',
    upload: 'Upload floor plan', uploading: 'Uploading…', upload_failed: 'Upload failed', add_text: '+ Text', add_label: '+ Label',
    text: 'Text', size: 'Text size', color_txt: 'Text colour', st_text: 'Text (no box)', fullscreen: 'Full screen',
    rot_hint: 'Rotate: drag the round handle above the selected box (Shift = 15° steps).',
    add_room: '+ Room', new_room: 'Room', room_name: 'Room name', in_room: 'Room', no_room: 'not in a room',
    hotspots_converted: 'New plan: {n} invisible click areas became visible labels.',
    all_off: 'Turn everything off', all_off_confirm: 'Tap again to turn everything off', room_off: 'Turn off all',
    room_on: 'Turn on the lights', wall: 'Wall panel', wake: 'Tap to wake', play_pause: 'Play/pause', prev: 'Previous',
    next: 'Next', volume: 'Volume', nothing_playing: 'Nothing is playing', bs_open: 'open', bs_closed: 'closed',
    bs_motion: 'motion', bs_clear: 'no motion', bs_wet: 'water!', bs_dry: 'dry', bs_smoke: 'smoke!', bs_nosmoke: 'no smoke',
    presets: 'Scenes', sensors_title: 'Sensors', presets_editor: 'Scenes and scripts (buttons next to the plan)',
    presets_none: 'Tap a scene or script in the Devices list to add it here.', p_remove: 'Remove',
    undo: 'Undo', auto_place: 'Place by area', auto_placed: 'Placed {n} devices in rooms named like their Home Assistant area.',
    auto_none: 'No device has a Home Assistant area with the same name as a room.', g_sensors: 'Sensors', g_scenes: 'Scenes and scripts',
    scan: 'Scan for devices', scan_hint: 'Press "Scan for devices" to list every device in Home Assistant, then drag one onto the plan.',
    found: 'Found {n} devices', devices_title: 'Devices', rescan: 'Scan again',
    'tap_ha-info': 'Show HA information', ha_title: 'Home Assistant', version: 'Version', name: 'Name',
    connection: 'Connection', connected: 'connected', reconnecting: 'reconnecting…', timezone: 'Time zone', language: 'Language',
    overview: 'Overview', entities: 'Entities', devices: 'Devices', areas: 'Areas', lights: 'Lights on',
    of: 'of', unav_n: 'Unavailable', updates: 'Updates', no_updates: 'Everything is up to date',
    system: 'System', os: 'Operating system', host: 'Host', disk: 'Disk', used: 'used',
    repairs: 'Repairs', none: 'none', open_system: 'Open system settings', loading: 'Loading…',
    remove_sel: 'Remove', dup_warn: 'This device is also placed elsewhere on the plan - it is the same device, so both glow and both rooms count it.',
    dup_remove: 'Remove the other copy', moved: 'Already on the plan - moved here',
    join: 'Join with', parts: 'Parts', add_part: '+ Part', del_part: 'Remove part', part: 'Part',
    join_hint: 'Select a room: a + appears where it touches another room. Click + to join them into one room. Drag the edges of each part to fit the plan.',
    members: 'Devices in this room', room_hint: 'Devices belong to the room their centre is in. Move a device into another room and it moves with it.',
  },
  sv: {
    on: 'på', off: 'av', unavailable: 'ej tillgänglig', playing: 'spelar',
    room_none: 'Inga enheter i rummet', add_device: 'Lägg till enhet', label: 'Etikett', style: 'Stil',
    remove: 'Ta bort', image: 'Bild på planlösningen (URL)', entity: 'Enhet', tap: 'Vid tryck', glow: 'Glödfärg (auto eller CSS-färg)',
    no_image: 'Ange en bild på planlösningen i kortets inställningar.', drag_hint: 'Dra en enhet från listan till planen. Klicka på en ruta för att ändra den (klicka igen för att stänga). Dra för att flytta, hörnet för att ändra storlek, runda handtaget för att rotera. Mushjulet zoomar, dra i en tom yta för att flytta planen.',
    st_hotspot: 'Klickyta (etiketten finns i bilden)', st_label: 'Etikett (kortet ritar rutan)',
    tap_toggle: 'Slå på/av', 'tap_more-info': 'Visa detaljer', tap_none: 'Ingenting', select_hint: 'Klicka på en ruta på planen för att ändra den.',
    zoom_in: 'Zooma in', zoom_out: 'Zooma ut', zoom_reset: 'Återställ zoom', to_dark: 'Mörkt läge', to_light: 'Ljust läge',
    theme: 'Bakgrund', th_light: 'Ljus', th_dark: 'Mörk', th_auto: 'Följ Home Assistant', zoom_default: 'Startzoom (0,5–3)',
    controls: 'Visa zoom- och ljus/mörk-knappar på kortet', palette: 'Enheter – dra in på planen', search: 'Sök…',
    g_lights: 'Lampor', g_switches: 'Uttag och brytare', g_media: 'TV och media', g_other: 'Övrigt', placed: 'placerad',
    fit: 'Anpassa till skärmen', fit_opt: 'Anpassa planen till skärmen (standard)', edit: 'Redigera planen: lägg till och flytta enheter',
    save: 'Spara', cancel: 'Avbryt', saving: 'Sparar…', save_failed: 'Kunde inte spara', not_found: 'Kortet hittades inte i instrumentpanelen (YAML-läge?). Kopiera YAML från kortredigeraren i stället.',
    edit_title: 'Redigera planen', unsaved: 'Inte sparat än',
    tap_sliders: 'Visa reglage', rotate: 'Rotation (grader)', rot_left: 'Rotera 90° vänster', rot_right: 'Rotera 90° höger',
    sliders_opt: 'Reglage (ljusstyrka och färg) vid långt tryck', brightness: 'Ljusstyrka', color: 'Färg',
    temp: 'Vitt: varmt – kallt', more: 'Mer…', close: 'Stäng', onoff_only: 'Den här lampan kan bara slås på och av.',
    turn_on: 'Slå på', turn_off: 'Slå av',
    upload: 'Ladda upp planlösning', uploading: 'Laddar upp…', upload_failed: 'Uppladdningen misslyckades', add_text: '+ Text', add_label: '+ Etikett',
    text: 'Text', size: 'Textstorlek', color_txt: 'Textfärg', st_text: 'Text (utan ruta)', fullscreen: 'Helskärm',
    rot_hint: 'Rotera: dra i det runda handtaget ovanför den valda rutan (Skift = 15°-steg).',
    add_room: '+ Rum', new_room: 'Rum', room_name: 'Rummets namn', in_room: 'Rum', no_room: 'inte i något rum',
    hotspots_converted: 'Ny plan: {n} osynliga klickytor blev synliga etiketter.',
    all_off: 'Släck allt hemma', all_off_confirm: 'Tryck igen för att släcka allt', room_off: 'Släck allt i rummet',
    room_on: 'Tänd lamporna', wall: 'Väggpanel', wake: 'Tryck för att väcka', play_pause: 'Spela/pausa', prev: 'Föregående',
    next: 'Nästa', volume: 'Volym', nothing_playing: 'Inget spelas', bs_open: 'öppen', bs_closed: 'stängd',
    bs_motion: 'rörelse', bs_clear: 'ingen rörelse', bs_wet: 'vatten!', bs_dry: 'torrt', bs_smoke: 'rök!', bs_nosmoke: 'ingen rök',
    presets: 'Scener', sensors_title: 'Sensorer', presets_editor: 'Scener och skript (knappar bredvid planen)',
    presets_none: 'Tryck på en scen eller ett skript i listan Enheter för att lägga till den här.', p_remove: 'Ta bort',
    undo: 'Ångra', auto_place: 'Placera efter område', auto_placed: '{n} enheter placerades i rum med samma namn som deras område i Home Assistant.',
    auto_none: 'Ingen enhet har ett område i Home Assistant med samma namn som ett rum.', g_sensors: 'Sensorer', g_scenes: 'Scener och skript',
    scan: 'Skanna efter enheter', scan_hint: 'Tryck på "Skanna efter enheter" för att lista alla enheter i Home Assistant och dra sedan in dem på planen.',
    found: 'Hittade {n} enheter', devices_title: 'Enheter', rescan: 'Skanna igen',
    'tap_ha-info': 'Visa HA-information', ha_title: 'Home Assistant', version: 'Version', name: 'Namn',
    connection: 'Anslutning', connected: 'ansluten', reconnecting: 'återansluter…', timezone: 'Tidszon', language: 'Språk',
    overview: 'Översikt', entities: 'Entiteter', devices: 'Enheter', areas: 'Områden', lights: 'Lampor på',
    of: 'av', unav_n: 'Ej tillgängliga', updates: 'Uppdateringar', no_updates: 'Allt är uppdaterat',
    system: 'System', os: 'Operativsystem', host: 'Värd', disk: 'Disk', used: 'använt',
    repairs: 'Reparationer', none: 'inga', open_system: 'Öppna systeminställningar', loading: 'Hämtar…',
    remove_sel: 'Ta bort', dup_warn: 'Den här enheten finns också på ett annat ställe på planen – det är samma enhet, så båda lyser och båda rummen räknar den.',
    dup_remove: 'Ta bort den andra', moved: 'Fanns redan på planen – flyttad hit',
    join: 'Slå ihop med', parts: 'Delar', add_part: '+ Del', del_part: 'Ta bort del', part: 'Del',
    join_hint: 'Välj ett rum: ett + visas där det gränsar till ett annat rum. Klicka på + för att slå ihop dem till ett rum. Dra i kanterna på varje del så att den passar planen.',
    members: 'Enheter i rummet', room_hint: 'En enhet hör till det rum som dess mitt ligger i. Flytta enheten till ett annat rum så följer den med.',
  },
};

/** UI text in Swedish for sv*, else English. */
export function t(lang, key) {
  const table = String(lang || '').toLowerCase().startsWith('sv') ? TEXTS.sv : TEXTS.en;
  return table[key] !== undefined ? table[key] : (TEXTS.en[key] !== undefined ? TEXTS.en[key] : key);
}

/** Nearest scrollable ancestor, crossing shadow roots (HA's dialogs). */
function scrollParent(el) {
  let n = el;
  while (n) {
    n = n.parentNode || n.host;
    if (!n || n === document) break;
    if (n.nodeType === 1) {
      const s = getComputedStyle(n);
      if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight) return n;
    }
  }
  return document.scrollingElement;
}

// Simple line icons (24x24, stroke = currentColor). No emoji anywhere in the UI.
const ICONS = {
  minus: [['line', { x1: 5, y1: 12, x2: 19, y2: 12 }]],
  plus: [['line', { x1: 12, y1: 5, x2: 12, y2: 19 }], ['line', { x1: 5, y1: 12, x2: 19, y2: 12 }]],
  fit: [['polyline', { points: '15 3 21 3 21 9' }], ['polyline', { points: '9 21 3 21 3 15' }],
    ['line', { x1: 21, y1: 3, x2: 14, y2: 10 }], ['line', { x1: 3, y1: 21, x2: 10, y2: 14 }]],
  moon: [['path', { d: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z' }]],
  sun: [['circle', { cx: 12, cy: 12, r: 4 }],
    ['line', { x1: 12, y1: 1.5, x2: 12, y2: 4 }], ['line', { x1: 12, y1: 20, x2: 12, y2: 22.5 }],
    ['line', { x1: 1.5, y1: 12, x2: 4, y2: 12 }], ['line', { x1: 20, y1: 12, x2: 22.5, y2: 12 }],
    ['line', { x1: 4.6, y1: 4.6, x2: 6.4, y2: 6.4 }], ['line', { x1: 17.6, y1: 17.6, x2: 19.4, y2: 19.4 }],
    ['line', { x1: 4.6, y1: 19.4, x2: 6.4, y2: 17.6 }], ['line', { x1: 17.6, y1: 6.4, x2: 19.4, y2: 4.6 }]],
  full: [['path', { d: 'M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3' }]],
  edit: [['path', { d: 'M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z' }]],
  close: [['line', { x1: 18, y1: 6, x2: 6, y2: 18 }], ['line', { x1: 6, y1: 6, x2: 18, y2: 18 }]],
  warn: [['path', { d: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z' }],
    ['line', { x1: 12, y1: 9, x2: 12, y2: 13 }], ['line', { x1: 12, y1: 17, x2: 12.01, y2: 17 }]],
  check: [['polyline', { points: '20 6 9 17 4 12' }]],
  trash: [['polyline', { points: '3 6 5 6 21 6' }],
    ['path', { d: 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }]],
  upload: [['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }], ['polyline', { points: '17 8 12 3 7 8' }],
    ['line', { x1: 12, y1: 3, x2: 12, y2: 15 }]],
  home: [['path', { d: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }], ['polyline', { points: '9 22 9 12 15 12 15 22' }]],
  scan: [['circle', { cx: 11, cy: 11, r: 7 }], ['line', { x1: 21, y1: 21, x2: 16, y2: 16 }]],
  power: [['path', { d: 'M18.36 6.64a9 9 0 1 1-12.73 0' }], ['line', { x1: 12, y1: 2, x2: 12, y2: 12 }]],
  play: [['polygon', { points: '6 4 19 12 6 20 6 4' }]],
  pause: [['rect', { x: 6, y: 4, width: 4, height: 16 }], ['rect', { x: 14, y: 4, width: 4, height: 16 }]],
  prev: [['polygon', { points: '19 20 9 12 19 4 19 20' }], ['line', { x1: 5, y1: 19, x2: 5, y2: 5 }]],
  next: [['polygon', { points: '5 4 15 12 5 20 5 4' }], ['line', { x1: 19, y1: 5, x2: 19, y2: 19 }]],
  tablet: [['rect', { x: 5, y: 2, width: 14, height: 20, rx: 2 }], ['line', { x1: 12, y1: 18, x2: 12.01, y2: 18 }]],
  undo: [['polyline', { points: '9 14 4 9 9 4' }], ['path', { d: 'M20 20v-7a4 4 0 0 0-4-4H4' }]],
  bulb: [['path', { d: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z' }]],
  pin: [['path', { d: 'M12 21s-7-6.1-7-11a7 7 0 1 1 14 0c0 4.9-7 11-7 11z' }], ['circle', { cx: 12, cy: 10, r: 2.5 }]],
  thermo: [['path', { d: 'M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z' }]],
  drop: [['path', { d: 'M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z' }]],
  door: [['path', { d: 'M6 21V3h12v18' }], ['line', { x1: 3, y1: 21, x2: 21, y2: 21 }], ['line', { x1: 14.5, y1: 12, x2: 14.5, y2: 12.01 }]],
  window: [['rect', { x: 4, y: 3, width: 16, height: 18, rx: 1 }], ['line', { x1: 12, y1: 3, x2: 12, y2: 21 }], ['line', { x1: 4, y1: 12, x2: 20, y2: 12 }]],
  motion: [['polyline', { points: '22 12 18 12 15 21 9 3 6 12 2 12' }]],
  flame: [['path', { d: 'M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5S5 13 5 15a7 7 0 0 0 7 7z' }]],
  gauge: [['circle', { cx: 12, cy: 12, r: 9 }], ['line', { x1: 12, y1: 12, x2: 16, y2: 8 }]],
  star: [['polygon', { points: '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2' }]],
};

/** An <svg> line icon (or null outside a browser). */
function iconEl(name, size = 18) {
  if (typeof document === 'undefined' || !ICONS[name]) return null;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('ic');
  ICONS[name].forEach(([tag, attrs]) => {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
    svg.appendChild(el);
  });
  return svg;
}

/** Put an icon (optional) and a text (optional) into an element. */
function setContent(el, iconName, text, size) {
  el.textContent = '';
  const ic = iconName ? iconEl(iconName, size) : null;
  if (ic) el.appendChild(ic);
  if (text) el.appendChild(document.createTextNode(ic ? ` ${text}` : text));
}

const store = {
  get(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
};

// ------------------------------------------------------------------- card --

const CARD_CSS = `
  :host { display: block; }
  ha-card { display: block; overflow: hidden; padding: 8px; position: relative; transition: background-color .3s, color .3s;
            container-type: inline-size; }
  .body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
  @container (min-width: 720px) { .body.has-side { grid-template-columns: minmax(0, 1fr) 240px; } }
  .mainc { position: relative; min-width: 0; }
  .side { display: flex; flex-direction: column; gap: 14px; font-size: .9rem; line-height: 1.3; min-width: 0; }
  .side h4 { margin: 0 0 6px; font-size: .75rem; font-weight: 600; text-transform: uppercase; letter-spacing: .06em;
             color: var(--secondary-text-color, #666); }
  ha-card.dark .side h4 { color: #9aa3b2; }
  .presets { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 6px; }
  .preset { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 8px; padding: 10px; min-height: 44px;
            border-radius: 10px; cursor: pointer; background: var(--secondary-background-color, #f1f3f5);
            color: var(--primary-text-color, #111); font-weight: 500; overflow-wrap: anywhere;
            transition: background-color .2s; -webkit-tap-highlight-color: transparent; }
  .preset:hover { background: color-mix(in srgb, var(--primary-color, #03a9f4) 16%, var(--secondary-background-color, #f1f3f5)); }
  .preset:focus-visible { outline: 2px solid var(--primary-color, #03a9f4); }
  .preset .ic { color: var(--primary-color, #03a9f4); }
  .preset.unavailable { opacity: .5; cursor: not-allowed; }
  .preset.fired { animation: gh-fired .9s ease-out; }
  ha-card.dark .preset { background: #1d232c; color: #e6e9ef; }
  .srows { display: flex; flex-direction: column; gap: 2px; }
  .srow { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 8px;
          cursor: pointer; -webkit-tap-highlight-color: transparent; }
  .srow:hover { background: rgba(127, 127, 127, .12); }
  .srow:focus-visible { outline: 2px solid var(--primary-color, #03a9f4); }
  .srow .sic { flex: none; width: 30px; height: 30px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
               background: var(--secondary-background-color, #f1f3f5); color: var(--primary-color, #03a9f4); }
  ha-card.dark .srow .sic { background: #1d232c; }
  .srow .sn { flex: 1; min-width: 0; }
  .srow .sn small { display: block; font-size: .75rem; color: var(--secondary-text-color, #666); }
  .srow .sv { font-weight: 600; white-space: nowrap; }
  .srow.alert .sic { background: var(--error-color, #e53935); color: #fff; }
  .srow.alert .sv { color: var(--error-color, #e53935); }
  .srow.unavailable { opacity: .55; }
  .btn.circ { width: max(22px, 2.6cqw) !important; height: auto !important; aspect-ratio: 1; border-radius: 50%; padding: 0;
              transform: translate(-50%, -50%); background: #fff; color: #1d6fb8; border: 1px solid #5b6576; }
  ha-card.dark .btn.circ { background: #1d232c; color: #7cc4ff; border-color: #8a94a6; }
  .btn.circ .si { display: flex; width: 100%; height: 100%; align-items: center; justify-content: center; }
  .btn.circ .si svg { width: 62%; height: 62%; }
  .btn.circ .txt { display: none; }
  .btn.circ.alert { background: var(--error-color, #e53935); color: #fff; border-color: var(--error-color, #e53935); }
  ha-card.dark { background: #11151b; color: #e6e9ef; }
  .vp { position: relative; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; }
  .vp.pannable { cursor: grab; }
  .vp.panning { cursor: grabbing; }
  .plan { position: relative; container-type: inline-size; line-height: 0; user-select: none; -webkit-user-select: none;
          margin: 0 auto; width: calc(var(--zoom, 1) * 100%); }
  .plan img { width: 100%; height: auto; display: block; transition: filter .3s; -webkit-user-drag: none; }
  ha-card.dark .plan img { filter: invert(.9) hue-rotate(180deg) brightness(.95) contrast(.95); }
  .room { position: absolute; z-index: 1; border-radius: 4px; cursor: pointer; transition: background-color .3s; }
  .room.on { background: color-mix(in srgb, var(--primary-color, #03a9f4) 12%, transparent); }
  .room.selected { outline: 2px dashed color-mix(in srgb, var(--primary-color, #03a9f4) 60%, transparent); }
  .btn { position: absolute; z-index: 2; box-sizing: border-box; margin: 0; padding: 0 2px; cursor: pointer;
         display: flex; align-items: center; justify-content: center; text-align: center; line-height: 1.15;
         font: 500 max(7px, calc(var(--fs, 0.95) * 1cqw))/1.15 var(--paper-font-body1_-_font-family, system-ui, sans-serif);
         border-radius: 6px; transition: box-shadow .3s, background-color .3s; -webkit-tap-highlight-color: transparent;
         transform: rotate(var(--rot, 0deg)); }
  .btn.style-label { background: #fff; color: #111; border: 1px solid #333; }
  ha-card.dark .btn.style-label { background: #1d232c; color: #e6e9ef; border-color: #8a94a6; }
  .btn.style-hotspot { background: transparent; border: 2px solid transparent; color: transparent; }
  .btn.style-text { background: transparent; border: 2px solid transparent; color: var(--tc, #1d2330); font-weight: 600; }
  ha-card.dark .btn.style-text { color: var(--tc-dark, #e6e9ef); }
  .btn.static { cursor: default; }
  .btn.static.style-hotspot { display: none; }
  ha-card:fullscreen { overflow: auto; border-radius: 0; background: var(--primary-background-color, #fafafa); }
  ha-card.dark:fullscreen { background: #11151b; }
  .btn.style-hotspot:hover, .btn:focus-visible { border-color: color-mix(in srgb, var(--primary-color, #03a9f4) 55%, transparent); outline: none; }
  .btn.on { box-shadow: 0 0 0 2px var(--glow), 0 0 14px 5px var(--glow); animation: gh-pulse 2.4s ease-in-out infinite; }
  .btn.on.style-hotspot { background: color-mix(in srgb, var(--glow) 16%, transparent); }
  .btn.unavailable { filter: grayscale(1); opacity: .55; cursor: not-allowed; }
  .btn .txt { overflow: hidden; overflow-wrap: anywhere; }
  .btn.vert .txt { writing-mode: vertical-rl; }
  .ic { display: inline-block; vertical-align: -0.2em; flex: none; }
  .btn .warn { display: none; position: absolute; top: -0.9em; right: -0.6em; font-size: 1.1em; color: var(--warning-color, #ffa600); }
  .btn.unavailable .warn { display: block; }
  @keyframes gh-pulse { 0%, 100% { box-shadow: 0 0 0 2px var(--glow), 0 0 10px 3px var(--glow); }
                        50% { box-shadow: 0 0 0 2px var(--glow), 0 0 20px 8px var(--glow); } }
  @media (prefers-reduced-motion: reduce) { .btn.on { animation: none; } }
  .bar { position: absolute; top: 14px; right: 14px; z-index: 5; display: flex; align-items: center; gap: 2px;
         padding: 3px; border-radius: 10px; background: rgba(255, 255, 255, .88); color: #1d2330;
         box-shadow: 0 1px 4px rgba(0, 0, 0, .18); font: 500 13px/1 system-ui, sans-serif; }
  ha-card.dark .bar { background: rgba(29, 35, 44, .9); color: #e6e9ef; box-shadow: 0 1px 4px rgba(0, 0, 0, .5); }
  .bar button { all: unset; box-sizing: border-box; min-width: 32px; height: 32px; padding: 0 6px; border-radius: 8px;
                display: inline-flex; align-items: center; justify-content: center; cursor: pointer; font-size: 18px; }
  .bar button:hover { background: rgba(127, 127, 127, .18); }
  .bar button:focus-visible { outline: 2px solid var(--primary-color, #03a9f4); }
  .bar .pct { min-width: 44px; font-size: 12px; }
  .bar button.active { background: color-mix(in srgb, var(--primary-color, #03a9f4) 22%, transparent); }
  .editwrap { padding: 4px; }
  .edithead { position: sticky; top: 0; z-index: 6; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
              margin: -4px -4px 8px; padding: 8px; background: var(--card-background-color, #fff);
              border-bottom: 1px solid var(--divider-color, #ddd); }
  .edithead .grow { flex: 1; }
  .edithead h3 { margin: 0; font-size: 1.05rem; font-weight: 600; }
  .edithead .status { font-size: .85rem; color: var(--secondary-text-color); }
  .editactions { position: fixed; right: 24px; bottom: 24px; z-index: 20; display: flex; gap: 8px; align-items: center;
                 padding: 8px; border-radius: 14px; background: var(--card-background-color, #fff);
                 box-shadow: 0 6px 24px rgba(0, 0, 0, .25); }
  .editactions .status { font-size: .85rem; color: var(--secondary-text-color); max-width: 260px; }
  .hint button { margin-top: 10px; font: inherit; padding: 8px 14px; border-radius: 8px; cursor: pointer;
                 border: none; background: var(--primary-color, #03a9f4); color: #fff; }
  .editactions button { font: inherit; padding: 8px 16px; border-radius: 8px; cursor: pointer; border: 1px solid var(--divider-color, #ccc);
                        background: var(--card-background-color, #fff); color: var(--primary-text-color, #111); }
  .editactions button.primary { background: var(--primary-color, #03a9f4); color: #fff; border-color: transparent; }
  .editactions button:disabled { opacity: .6; cursor: default; }
  .bar .sep { width: 1px; height: 20px; background: rgba(127, 127, 127, .35); margin: 0 3px; }
  .info { min-height: 1.4em; margin-top: 6px; font-size: .9rem; color: var(--secondary-text-color); line-height: 1.4;
          display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .info .iact { display: flex; gap: 6px; }
  .info button { font: inherit; font-size: .85rem; display: inline-flex; align-items: center; gap: 4px; cursor: pointer;
                 padding: 4px 10px; border-radius: 8px; border: 1px solid var(--divider-color, #ccc); background: var(--card-background-color, #fff);
                 color: var(--primary-text-color, #111); }
  ha-card.dark .info button { background: #1d232c; color: #e6e9ef; border-color: #3a4352; }
  .btn.sensor { font-weight: 600; }
  .btn.alert { border-color: var(--error-color, #e53935) !important; }
  .btn .pl { display: none; position: absolute; bottom: -0.8em; right: -0.7em; width: 1.3em; height: 1.3em; border-radius: 50%;
             background: var(--glow, #ffb300); color: #111; align-items: center; justify-content: center; }
  .btn.playing .pl { display: inline-flex; }
  .btn.fired { animation: gh-fired .9s ease-out; }
  @keyframes gh-fired { 0% { box-shadow: 0 0 0 2px var(--primary-color, #03a9f4), 0 0 22px 10px var(--primary-color, #03a9f4); }
                       100% { box-shadow: 0 0 0 0 transparent; } }
  .bar button.armed { background: var(--error-color, #e53935); color: #fff; }
  .bar button.on { background: color-mix(in srgb, var(--primary-color, #03a9f4) 22%, transparent); }
  .dim { position: absolute; inset: 0; z-index: 40; background: #000; opacity: 0; pointer-events: none; transition: opacity 1.2s;
         display: flex; align-items: flex-end; justify-content: center; padding-bottom: 6vh; color: #6b7280; font: 15px system-ui, sans-serif; }
  .dim.on { opacity: .88; pointer-events: auto; }
  .pop .art { width: 100%; max-height: 160px; object-fit: contain; border-radius: 8px; margin-bottom: 6px; background: rgba(127,127,127,.12); }
  .pop .mt { font-weight: 600; margin: 2px 0; }
  .pop .ma { font-size: 12px; opacity: .8; margin-bottom: 6px; }
  .pop .ctrl { display: flex; justify-content: center; gap: 8px; margin: 6px 0; }
  .pop .ctrl button { width: 44px; height: 40px; display: inline-flex; align-items: center; justify-content: center; }
  ha-card.dark .info { color: #b8c0cc; }
  .hint { padding: 16px; color: var(--secondary-text-color); line-height: 1.4; }
  .pop { position: absolute; z-index: 8; width: 250px; box-sizing: border-box; padding: 10px 12px 12px; border-radius: 14px;
         background: var(--card-background-color, #fff); color: var(--primary-text-color, #111);
         box-shadow: 0 8px 28px rgba(0, 0, 0, .28); font: 14px/1.3 system-ui, sans-serif; }
  ha-card.dark .pop { background: #1d232c; color: #e6e9ef; }
  .pop .ph { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .pop .ph b { flex: 1; font-size: 15px; }
  .pop button { font: inherit; cursor: pointer; border-radius: 8px; border: 1px solid var(--divider-color, #ccc);
                background: transparent; color: inherit; padding: 4px 10px; }
  .pop button.x { border: none; font-size: 18px; padding: 0 6px; }
  .pop button.pw { width: 100%; margin-bottom: 8px; }
  .pop button.pw.on { background: color-mix(in srgb, var(--glow, #ffb300) 30%, white); color: #111; border-color: var(--glow, #ffb300); }
  .pop .lab { display: flex; justify-content: space-between; font-size: 12px; opacity: .8; margin: 6px 0 3px; }
  .pop input[type=range] { width: 100%; margin: 0; accent-color: var(--primary-color, #03a9f4); }
  .pop input.hue, .pop input.ct { -webkit-appearance: none; appearance: none; height: 12px; border-radius: 6px; outline: none; }
  .pop input.hue { background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00); }
  .pop input.ct { background: linear-gradient(to right, #ffa757, #fff3e6, #cfe3ff); }
  .pop input.hue::-webkit-slider-thumb, .pop input.ct::-webkit-slider-thumb { -webkit-appearance: none; width: 20px; height: 20px;
         border-radius: 50%; background: #fff; border: 2px solid #333; box-shadow: 0 1px 3px rgba(0,0,0,.4); }
  .pop input.hue::-moz-range-thumb, .pop input.ct::-moz-range-thumb { width: 18px; height: 18px; border-radius: 50%;
         background: #fff; border: 2px solid #333; }
  .pop .note { font-size: 12px; opacity: .8; margin: 4px 0; }
  .pop .more { margin-top: 8px; text-align: right; }
  .pop .more a { color: var(--primary-color, #03a9f4); cursor: pointer; font-size: 13px; }
  .pop.info { width: 310px; max-height: 70vh; overflow: auto; }
  .pop h5 { margin: 10px 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; opacity: .7; }
  .pop dl { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; margin: 0; font-size: 13px; }
  .pop dt { opacity: .75; }
  .pop dd { margin: 0; text-align: right; font-weight: 500; overflow-wrap: anywhere; }
  .pop .ok { color: var(--success-color, #43a047); }
  .pop .bad { color: var(--warning-color, #ffa600); }
  .pop ul { margin: 2px 0 0; padding-left: 18px; font-size: 13px; }
  .pop button.sys { width: 100%; margin-top: 10px; }
`;

const LONG_PRESS_MS = 500;
const PAN_THRESHOLD = 6;

// Outside a browser (unit tests) there is no HTMLElement; the classes are never registered there.
const Base = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};

class GhDashCard extends Base {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = null;
    this._hass = null;
    this._built = false;
    this._room = null;
    this._zoom = 1;
    this._aspect = 0;
    this._suppressClick = false;
  }

  static getConfigElement() {
    return document.createElement('gh-dash-card-editor');
  }

  static getStubConfig() {
    const c = starterConfig(bundledPlan());
    delete c.type; // Home Assistant adds the type itself
    return c;
  }

  setConfig(config) {
    this._config = normalizeConfig(config);
    this._raw = JSON.parse(JSON.stringify(config));
    this._key = `gh-dash:${this._config.image}`;
    const storedZoom = store.get(`${this._key}:zoom`);
    const storedFit = store.get(`${this._key}:fit`);
    this._fit = storedFit === null ? this._config.fit : storedFit === '1';
    this._zoom = storedZoom ? clampZoom(storedZoom) : this._config.zoom;
    this._editing = false;
    this._editEl = null;
    this._built = false;
    this._room = null;
    this._build();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (this._editEl) this._editEl.hass = hass;
    if (!this._built || first) this._build();
    this._update();
  }

  getCardSize() {
    return 8;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6 };
  }

  connectedCallback() {
    if (this._vp && this._ro) this._ro.observe(this._vp);
    this._onWinResize = this._onWinResize || (() => this._fitViewport());
    window.addEventListener('resize', this._onWinResize);
    document.addEventListener('fullscreenchange', this._onWinResize);
  }

  disconnectedCallback() {
    if (this._ro) this._ro.disconnect();
    if (this._onWinResize) {
      window.removeEventListener('resize', this._onWinResize);
      document.removeEventListener('fullscreenchange', this._onWinResize);
    }
  }

  _lang() {
    return (this._hass && (this._hass.locale?.language || this._hass.language)) || 'en';
  }

  _theme() {
    const haDark = !!(this._hass && this._hass.themes && this._hass.themes.darkMode);
    return resolveTheme(this._config.theme, store.get(`${this._key}:theme`), haDark);
  }

  _build() {
    if (!this._config) return;
    this._closeSliders();
    const root = this.shadowRoot;
    root.innerHTML = '';
    if (this._ro) this._ro.disconnect();
    const style = document.createElement('style');
    style.textContent = CARD_CSS;
    root.appendChild(style);
    const card = document.createElement('ha-card');
    this._card = card;
    root.appendChild(card);
    if (!this._config.image) {
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = t(this._lang(), 'no_image');
      if (this._hass && this._hass.user && this._hass.user.is_admin) {
        const go = document.createElement('button');
        go.type = 'button';
        setContent(go, 'edit', t(this._lang(), 'upload'), 16);
        go.addEventListener('click', () => this._enterEdit());
        hint.appendChild(document.createElement('br'));
        hint.appendChild(go);
      }
      card.appendChild(hint);
      this._btnEls = null;
      this._built = true;
      return;
    }
    const vp = document.createElement('div');
    vp.className = 'vp';
    this._vp = vp;
    const plan = document.createElement('div');
    plan.className = 'plan';
    this._plan = plan;
    const img = document.createElement('img');
    img.src = this._config.image;
    img.alt = '';
    img.draggable = false;
    img.addEventListener('load', () => {
      this._aspect = img.naturalWidth ? img.naturalHeight / img.naturalWidth : 0;
      this._fitViewport();
    });
    plan.appendChild(img);

    this._roomEls = this._config.rooms.map((r, i) => r.parts.map((q) => {
      const el = document.createElement('div');
      el.className = 'room';
      Object.assign(el.style, { left: `${q.x}%`, top: `${q.y}%`, width: `${q.w}%`, height: `${q.h}%` });
      el.title = r.name || '';
      el.addEventListener('click', () => {
        if (this._suppressClick) return;
        this._room = this._room === i ? null : i;
        this._update();
      });
      plan.appendChild(el);
      return el;
    }));

    this._btnEls = this._config.buttons.map((b) => {
      if (isPreset(b.entity)) return null; // shown as a preset button next to the plan
      const isStatic = !b.entity && b.tap_action !== 'ha-info';
      const el = document.createElement(isStatic ? 'div' : 'button');
      if (!isStatic) el.type = 'button';
      if (isSensor(b.entity)) {
        // a small round icon centred where the item was placed
        el.className = 'btn circ';
        Object.assign(el.style, { left: `${b.x + b.w / 2}%`, top: `${b.y + b.h / 2}%` });
        const si = document.createElement('span');
        si.className = 'si';
        el.appendChild(si);
      } else {
        el.className = `btn style-${b.style}${isStatic ? ' static' : ''}`;
        Object.assign(el.style, { left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%` });
        if (b.rotate) el.style.setProperty('--rot', `${b.rotate}deg`);
      }
      if (b.size) el.style.setProperty('--fs', String(b.size));
      if (b.color) { el.style.setProperty('--tc', b.color); el.style.setProperty('--tc-dark', b.color); }
      const txt = document.createElement('span');
      txt.className = 'txt';
      el.appendChild(txt);
      const warn = document.createElement('span');
      warn.className = 'warn';
      setContent(warn, 'warn', '', 12);
      warn.setAttribute('aria-hidden', 'true');
      el.appendChild(warn);
      if (b.entity && b.entity.startsWith('media_player.')) {
        const pl = document.createElement('span');
        pl.className = 'pl';
        setContent(pl, 'play', '', 10);
        el.appendChild(pl);
      }
      if (!isStatic) this._wireButton(el, b);
      plan.appendChild(el);
      return el;
    });

    vp.appendChild(plan);
    const body = document.createElement('div');
    body.className = 'body';
    const mainc = document.createElement('div');
    mainc.className = 'mainc';
    mainc.appendChild(vp);
    body.appendChild(mainc);
    card.appendChild(body);
    this._wirePanZoom(vp);
    if (this._config.show_controls) mainc.appendChild(this._buildBar());
    const side = this._buildSide();
    if (side) { body.classList.add('has-side'); body.appendChild(side); }
    this._info = document.createElement('div');
    this._info.className = 'info';
    this._infoTxt = document.createElement('span');
    this._infoTxt.setAttribute('aria-live', 'polite');
    this._infoAct = document.createElement('span');
    this._infoAct.className = 'iact';
    this._info.appendChild(this._infoTxt);
    this._info.appendChild(this._infoAct);
    card.appendChild(this._info);
    this._dimEl = document.createElement('div');
    this._dimEl.className = 'dim';
    this._dimEl.textContent = t(this._lang(), 'wake');
    this._dimEl.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); this._wake(); });
    card.appendChild(this._dimEl);
    card.addEventListener('pointerdown', () => this._poke(), true);
    this._ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this._fitViewport()) : null;
    if (this._ro) this._ro.observe(vp);
    this._applyZoom(this._zoom, false);
    this._built = true;
  }

  /** Scenes/scripts as preset buttons and the sensors' values, next to the plan (below it on narrow screens). */
  _buildSide() {
    const L = (k) => t(this._lang(), k);
    const presets = this._config.buttons.filter((b) => isPreset(b.entity));
    const sensors = this._config.buttons.filter((b) => isSensor(b.entity));
    this._presetEls = [];
    this._sensorRows = [];
    if (!presets.length && !sensors.length) return null;
    const side = document.createElement('div');
    side.className = 'side';
    if (presets.length) {
      const sec = document.createElement('section');
      const h = document.createElement('h4');
      h.textContent = L('presets');
      sec.appendChild(h);
      const grid = document.createElement('div');
      grid.className = 'presets';
      presets.forEach((b) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'preset';
        el.addEventListener('click', () => {
          if (!this._hass || isUnavailable(this._hass.states[b.entity])) return;
          const c = toggleCall(b.entity);
          this._hass.callService(c.domain, c.service, c.data);
          el.classList.remove('fired');
          void el.offsetWidth; // restart the animation
          el.classList.add('fired');
        });
        grid.appendChild(el);
        this._presetEls.push({ b, el });
      });
      sec.appendChild(grid);
      side.appendChild(sec);
    }
    if (sensors.length) {
      const sec = document.createElement('section');
      const h = document.createElement('h4');
      h.textContent = L('sensors_title');
      sec.appendChild(h);
      const list = document.createElement('div');
      list.className = 'srows';
      sensors.forEach((b) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'srow';
        const ic = document.createElement('span');
        ic.className = 'sic';
        const sn = document.createElement('span');
        sn.className = 'sn';
        const name = document.createElement('span');
        const room = document.createElement('small');
        sn.appendChild(name);
        sn.appendChild(room);
        const sv = document.createElement('span');
        sv.className = 'sv';
        el.appendChild(ic);
        el.appendChild(sn);
        el.appendChild(sv);
        el.addEventListener('click', () => this._moreInfo(b.entity));
        list.appendChild(el);
        this._sensorRows.push({ b, el, ic, name, room, sv });
      });
      sec.appendChild(list);
      side.appendChild(sec);
    }
    return side;
  }

  _updateSide(lang) {
    (this._presetEls || []).forEach(({ b, el }) => {
      const s = this._hass.states[b.entity];
      const name = this._name(b.entity, b.label);
      const icon = b.entity.startsWith('script.') ? 'play' : 'star';
      if (el.dataset.name !== name) { setContent(el, icon, name, 18); el.dataset.name = name; }
      el.classList.toggle('unavailable', isUnavailable(s));
      el.title = name;
    });
    (this._sensorRows || []).forEach((r) => {
      const s = this._hass.states[r.b.entity];
      const icon = sensorIcon(s, r.b.entity);
      if (r.ic.dataset.ic !== icon) { setContent(r.ic, icon, '', 16); r.ic.dataset.ic = icon; }
      r.name.textContent = this._name(r.b.entity, r.b.label);
      const ri = roomOf(this._config.rooms, r.b);
      r.room.textContent = ri >= 0 ? (this._config.rooms[ri].name || '') : '';
      r.sv.textContent = this._stateText(s, lang);
      r.el.classList.toggle('alert', r.b.entity.startsWith('binary_sensor.') && isOn(s));
      r.el.classList.toggle('unavailable', isUnavailable(s));
    });
  }

  _buildBar() {
    const L = (k) => t(this._lang(), k);
    const bar = document.createElement('div');
    bar.className = 'bar';
    const mk = (cls, text, label, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      if (ICONS[text]) setContent(b, text, '', 18); else b.textContent = text;
      b.title = label;
      b.setAttribute('aria-label', label);
      b.addEventListener('click', (ev) => { ev.stopPropagation(); onClick(); });
      bar.appendChild(b);
      return b;
    };
    this._fitBtn = mk('fitb', 'fit', L('fit'), () => {
      this._fit = true;
      store.set(`${this._key}:fit`, '1');
      this._fitViewport();
    });
    mk('zout', 'minus', L('zoom_out'), () => this._applyZoom(this._zoom - ZOOM_STEP, true));
    this._pct = mk('pct', '100%', L('zoom_reset'), () => this._applyZoom(1, true));
    mk('zin', 'plus', L('zoom_in'), () => this._applyZoom(this._zoom + ZOOM_STEP, true));
    const sep = document.createElement('span');
    sep.className = 'sep';
    bar.appendChild(sep);
    this._themeBtn = mk('theme', 'moon', L('to_dark'), () => {
      const next = this._theme() === 'dark' ? 'light' : 'dark';
      store.set(`${this._key}:theme`, next);
      this._update();
    });
    mk('fsb', 'full', L('fullscreen'), () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (this._card.requestFullscreen) this._card.requestFullscreen().catch(() => {});
    });
    this._wallBtn = mk('wallb', 'tablet', L('wall'), () => this._toggleWall());
    const sep3 = document.createElement('span');
    sep3.className = 'sep';
    bar.appendChild(sep3);
    this._allOffBtn = mk('alloff', 'power', L('all_off'), () => this._allOff());
    if (this._hass && this._hass.user && this._hass.user.is_admin) {
      const sep2 = document.createElement('span');
      sep2.className = 'sep';
      bar.appendChild(sep2);
      mk('editb', 'edit', L('edit'), () => this._enterEdit());
    }
    return bar;
  }

  _fitViewport() {
    if (!this._vp) return;
    const w = this._vp.clientWidth;
    if (this._fit && this._aspect && w && this._plan) {
      // Scale so the whole plan height fits between the card's top and the bottom of the window.
      const top = Math.max(0, this._vp.getBoundingClientRect().top);
      const full = document.fullscreenElement === this._card;
      const avail = window.innerHeight - Math.min(top, window.innerHeight / 2) - (full ? 16 : 56);
      const z = fitZoom(avail, w, this._aspect);
      this._zoom = z;
      this._plan.style.setProperty('--zoom', String(z));
      if (this._pct) this._pct.textContent = `${Math.round(z * 100)}%`;
    }
    if (this._fitBtn) {
      this._fitBtn.classList.toggle('active', !!this._fit);
      this._fitBtn.setAttribute('aria-pressed', String(!!this._fit));
    }
    // At zoom > 1 the viewport keeps the 100 % height and the plan scrolls/pans inside it.
    this._vp.style.maxHeight = !this._fit && this._zoom > 1 && this._aspect && w ? `${Math.round(w * this._aspect)}px` : '';
    const scrollable = this._vp.scrollWidth > this._vp.clientWidth + 1 || this._vp.scrollHeight > this._vp.clientHeight + 1;
    this._vp.classList.toggle('pannable', scrollable);
    this._fitLabels();
  }

  /** Shrink each button's text so it fits its box (boxes scale with the plan, text has a minimum). */
  _fitLabels() {
    if (!this._btnEls || !this._plan) return;
    const planW = this._plan.clientWidth;
    this._config.buttons.forEach((b, i) => {
      const el = this._btnEls[i];
      const txt = el && el.querySelector('.txt');
      if (!txt || !txt.textContent || !el.offsetWidth) { if (el) el.style.fontSize = ''; return; }
      const maxPx = Math.max(7, (planW * num(b.size, 0.95)) / 100);
      const w = el.offsetWidth - 4;
      const h = el.offsetHeight - 2;
      // tall, narrow box: write the text vertically if that lets it be bigger
      const across = fitFont(txt.textContent, w, h, maxPx);
      const down = h > w * 1.6 ? fitFont(txt.textContent, h, w, maxPx) : 0;
      el.classList.toggle('vert', down > across);
      el.style.fontSize = `${Math.max(across, down)}px`;
    });
  }

  _applyZoom(z, remember) {
    const vp = this._vp;
    if (!vp || !this._plan) return;
    if (remember) {
      this._fit = false;
      store.set(`${this._key}:fit`, '0');
    }
    const next = clampZoom(z);
    // keep the point in the middle of the view in the middle
    const cx = vp.scrollWidth ? (vp.scrollLeft + vp.clientWidth / 2) / vp.scrollWidth : 0.5;
    const cy = vp.scrollHeight ? (vp.scrollTop + vp.clientHeight / 2) / vp.scrollHeight : 0.5;
    this._zoom = next;
    this._plan.style.setProperty('--zoom', String(next));
    this._fitViewport();
    vp.scrollLeft = cx * vp.scrollWidth - vp.clientWidth / 2;
    vp.scrollTop = cy * vp.scrollHeight - vp.clientHeight / 2;
    if (this._pct) this._pct.textContent = `${Math.round(next * 100)}%`;
    if (remember) store.set(`${this._key}:zoom`, String(next));
    this._fitLabels();
  }

  _enterEdit() {
    if (this._editing || !this._card) return;
    const L = (k) => t(this._lang(), k);
    this._closeSliders();
    this._editing = true;
    this._pending = JSON.parse(JSON.stringify(this._raw));
    this._card.classList.remove('dark');
    Array.from(this._card.children).forEach((c) => { c.style.display = 'none'; });
    const wrap = document.createElement('div');
    wrap.className = 'editwrap';
    const head = document.createElement('div');
    head.className = 'edithead';
    const h = document.createElement('h3');
    h.textContent = L('edit_title');
    const status = document.createElement('span');
    status.className = 'status';
    status.setAttribute('aria-live', 'polite');
    head.appendChild(h);
    wrap.appendChild(head);
    const ed = document.createElement('gh-dash-card-editor');
    ed.onCard = true;
    ed.hass = this._hass;
    ed.setConfig(this._pending);
    ed.addEventListener('config-changed', (e) => {
      e.stopPropagation();
      this._pending = e.detail.config;
      status.textContent = L('unsaved');
    });
    this._editEl = ed;
    wrap.appendChild(ed);
    const actions = document.createElement('div');
    actions.className = 'editactions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = L('cancel');
    cancel.addEventListener('click', () => this._leaveEdit());
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'primary';
    save.textContent = L('save');
    save.addEventListener('click', () => this._saveEdit(save, status));
    actions.appendChild(status);
    actions.appendChild(cancel);
    actions.appendChild(save);
    wrap.appendChild(actions);
    this._card.appendChild(wrap);
    wrap.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  _leaveEdit() {
    this._editing = false;
    this._editEl = null;
    this._built = false;
    this._build();
    this._update();
  }

  async _saveEdit(btn, status) {
    const L = (k) => t(this._lang(), k);
    btn.disabled = true;
    status.textContent = L('saving');
    try {
      normalizeConfig(this._pending); // refuse to save a broken config
      const seg = window.location.pathname.split('/').filter(Boolean)[0] || 'lovelace';
      const urlPath = seg === 'lovelace' ? null : seg;
      const dash = await this._hass.callWS({ type: 'lovelace/config', url_path: urlPath });
      const r = replaceCard(dash, this._raw, this._pending);
      if (!r.found) {
        status.textContent = L('not_found');
        btn.disabled = false;
        return;
      }
      await this._hass.callWS({ type: 'lovelace/config/save', url_path: urlPath, config: r.config });
      const saved = this._pending;
      this.setConfig(saved);
      this._update();
    } catch (e) {
      status.textContent = `${L('save_failed')}: ${e && e.message ? e.message : e}`;
      btn.disabled = false;
    }
  }

  _wirePanZoom(vp) {
    vp.addEventListener('wheel', (ev) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      this._applyZoom(this._zoom + (ev.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP), true);
    }, { passive: false });
    // Mouse: drag to pan when the plan is larger than the view. Touch scrolls natively.
    vp.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType !== 'mouse' || ev.button !== 0 || !vp.classList.contains('pannable')) return;
      const sx = ev.clientX;
      const sy = ev.clientY;
      const sl = vp.scrollLeft;
      const st = vp.scrollTop;
      let panning = false;
      const move = (e) => {
        const dx = e.clientX - sx;
        const dy = e.clientY - sy;
        if (!panning && Math.hypot(dx, dy) < PAN_THRESHOLD) return;
        if (!panning) {
          panning = true;
          vp.setPointerCapture(ev.pointerId);
          vp.classList.add('panning');
          this._cancelLongPress?.();
        }
        vp.scrollLeft = sl - dx;
        vp.scrollTop = st - dy;
      };
      const up = () => {
        vp.removeEventListener('pointermove', move);
        vp.removeEventListener('pointerup', up);
        vp.removeEventListener('pointercancel', up);
        vp.classList.remove('panning');
        if (panning) {
          this._suppressClick = true;
          setTimeout(() => { this._suppressClick = false; }, 0);
        }
      };
      vp.addEventListener('pointermove', move);
      vp.addEventListener('pointerup', up);
      vp.addEventListener('pointercancel', up);
    });
  }

  _wireButton(el, b) {
    let timer = null;
    let longFired = false;
    const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
    el.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      longFired = false;
      clear();
      this._cancelLongPress = clear;
      timer = setTimeout(() => { longFired = true; timer = null; this._longPress(b, el); }, LONG_PRESS_MS);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((n) => el.addEventListener(n, clear));
    el.addEventListener('contextmenu', (ev) => { ev.preventDefault(); clear(); longFired = true; this._longPress(b, el); });
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (this._suppressClick) return;
      if (longFired) { longFired = false; return; }
      this._tap(b, el);
    });
  }

  _tap(b, el) {
    if (!this._hass) return;
    if (b.tap_action === 'ha-info') { this._openInfo(b, el); return; }
    if (!b.entity) return;
    if (isUnavailable(this._hass.states[b.entity])) return;
    if (b.tap_action === 'none') return;
    if (b.tap_action === 'sliders') { this._openSliders(b, el); return; }
    if (b.tap_action === 'more-info') { this._moreInfo(b.entity); return; }
    const dom = b.entity.split('.')[0];
    if (dom === 'sensor' || dom === 'binary_sensor') { this._moreInfo(b.entity); return; }
    const c = toggleCall(b.entity);
    this._hass.callService(c.domain, c.service, c.data);
    if (ACTIVATE_DOMAINS.has(dom) && el) {
      el.classList.remove('fired');
      void el.offsetWidth; // restart the animation
      el.classList.add('fired');
    }
  }

  /** Short state text: on/off, open/closed, motion, water, smoke, unavailable. */
  _stateText(s, lang) {
    if (isUnavailable(s)) return t(lang, 'unavailable');
    const dom = s.entity_id.split('.')[0];
    if (dom === 'sensor') return sensorText(s, lang);
    if (dom === 'binary_sensor') {
      const dc = s.attributes.device_class;
      const on = s.state === 'on';
      if (dc === 'motion' || dc === 'occupancy') return t(lang, on ? 'bs_motion' : 'bs_clear');
      if (dc === 'moisture') return t(lang, on ? 'bs_wet' : 'bs_dry');
      if (dc === 'smoke') return t(lang, on ? 'bs_smoke' : 'bs_nosmoke');
      return t(lang, on ? 'bs_open' : 'bs_closed');
    }
    if (ACTIVATE_DOMAINS.has(dom)) return '';
    if (dom === 'media_player' && s.state === 'playing' && s.attributes.media_title) return `${t(lang, 'playing')} ${s.attributes.media_title}`;
    return isOn(s) ? t(lang, 'on') : t(lang, 'off');
  }

  _renderRoomActions(members, lang) {
    const box = this._infoAct;
    if (!box) return;
    box.textContent = '';
    const add = (icon, label, call) => {
      if (!call) return;
      const b = document.createElement('button');
      b.type = 'button';
      setContent(b, icon, label, 14);
      b.addEventListener('click', (ev) => { ev.stopPropagation(); this._hass.callService(call.domain, call.service, call.data); });
      box.appendChild(b);
    };
    add('power', t(lang, 'room_off'), roomCall(members, 'off'));
    add('bulb', t(lang, 'room_on'), roomCall(members, 'on'));
  }

  /** Whole home off: the first tap arms the button, a second tap within 3 s turns everything off. */
  _allOff() {
    const btn = this._allOffBtn;
    const L = (k) => t(this._lang(), k);
    const targets = allOffTargets(this._config.buttons);
    if (!targets.length || !btn) return;
    if (!btn.classList.contains('armed')) {
      btn.classList.add('armed');
      btn.title = L('all_off_confirm');
      btn.setAttribute('aria-label', L('all_off_confirm'));
      clearTimeout(this._armTimer);
      this._armTimer = setTimeout(() => {
        btn.classList.remove('armed');
        btn.title = L('all_off');
        btn.setAttribute('aria-label', L('all_off'));
      }, 3000);
      return;
    }
    clearTimeout(this._armTimer);
    btn.classList.remove('armed');
    btn.title = L('all_off');
    this._hass.callService('homeassistant', 'turn_off', { entity_id: targets });
  }

  // ---- wall panel: full screen, screen kept on, dims after dim_after seconds without a touch
  _toggleWall() {
    if (this._wall) { this._stopWall(); if (document.fullscreenElement) document.exitFullscreen(); return; }
    this._wall = true;
    if (this._wallBtn) this._wallBtn.classList.add('on');
    if (this._card.requestFullscreen && document.fullscreenElement !== this._card) this._card.requestFullscreen().catch(() => {});
    if (navigator.wakeLock && navigator.wakeLock.request) {
      navigator.wakeLock.request('screen').then((l) => { this._lock = l; }).catch(() => {});
    }
    if (!this._fsWatch) {
      this._fsWatch = () => { if (this._wall && !document.fullscreenElement) this._stopWall(); };
      document.addEventListener('fullscreenchange', this._fsWatch);
    }
    this._poke();
  }

  _stopWall() {
    this._wall = false;
    clearTimeout(this._dimTimer);
    if (this._dimEl) this._dimEl.classList.remove('on');
    if (this._wallBtn) this._wallBtn.classList.remove('on');
    if (this._lock) { this._lock.release().catch(() => {}); this._lock = null; }
  }

  _poke() {
    if (!this._wall) return;
    clearTimeout(this._dimTimer);
    const secs = this._config.dim_after;
    if (secs > 0) this._dimTimer = setTimeout(() => { if (this._dimEl) this._dimEl.classList.add('on'); }, secs * 1000);
  }

  _wake() {
    if (this._dimEl) this._dimEl.classList.remove('on');
    this._poke();
  }

  _longPress(b, el) {
    if (String(b.entity).startsWith('media_player.') && !isUnavailable(this._hass && this._hass.states[b.entity])) {
      this._openMedia(b, el);
      return;
    }
    if (b.sliders && String(b.entity).startsWith('light.') && !isUnavailable(this._hass && this._hass.states[b.entity])) {
      this._openSliders(b, el);
    } else {
      this._moreInfo(b.entity);
    }
  }

  _openMedia(b, anchor) {
    this._closeSliders();
    if (!this._hass || !this._card) return;
    const L = (k) => t(this._lang(), k);
    const pop = document.createElement('div');
    pop.className = 'pop';
    pop.setAttribute('role', 'dialog');
    const head = document.createElement('div');
    head.className = 'ph';
    const title = document.createElement('b');
    title.textContent = this._name(b.entity, b.label);
    pop.setAttribute('aria-label', title.textContent);
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'x';
    setContent(x, 'close', '', 16);
    x.title = L('close');
    x.setAttribute('aria-label', L('close'));
    x.addEventListener('click', () => this._closeSliders());
    head.appendChild(title);
    head.appendChild(x);
    pop.appendChild(head);
    const art = document.createElement('img');
    art.className = 'art';
    art.alt = '';
    pop.appendChild(art);
    const mt = document.createElement('div');
    mt.className = 'mt';
    const ma = document.createElement('div');
    ma.className = 'ma';
    pop.appendChild(mt);
    pop.appendChild(ma);
    const call = (service, data = {}) => this._hass.callService('media_player', service, { entity_id: b.entity, ...data });
    const ctrl = document.createElement('div');
    ctrl.className = 'ctrl';
    const cb = (icon, label, fn) => {
      const k = document.createElement('button');
      k.type = 'button';
      setContent(k, icon, '', 20);
      k.title = label;
      k.setAttribute('aria-label', label);
      k.addEventListener('click', fn);
      ctrl.appendChild(k);
      return k;
    };
    const prev = cb('prev', L('prev'), () => call('media_previous_track'));
    const pp = cb('play', L('play_pause'), () => call('media_play_pause'));
    const next = cb('next', L('next'), () => call('media_next_track'));
    pop.appendChild(ctrl);
    const lab = document.createElement('div');
    lab.className = 'lab';
    const la = document.createElement('span');
    la.textContent = L('volume');
    const lv = document.createElement('span');
    lab.appendChild(la);
    lab.appendChild(lv);
    const vol = document.createElement('input');
    vol.type = 'range';
    vol.min = '0';
    vol.max = '100';
    vol.step = '1';
    vol.setAttribute('aria-label', L('volume'));
    vol.addEventListener('input', () => { lv.textContent = `${vol.value} %`; });
    vol.addEventListener('change', () => call('volume_set', { volume_level: Number(vol.value) / 100 }));
    pop.appendChild(lab);
    pop.appendChild(vol);
    const pw = document.createElement('button');
    pw.type = 'button';
    pw.className = 'pw';
    pw.addEventListener('click', () => { const c = toggleCall(b.entity); this._hass.callService(c.domain, c.service, c.data); });
    pop.appendChild(pw);
    const more = document.createElement('div');
    more.className = 'more';
    const a = document.createElement('a');
    a.textContent = L('more');
    a.tabIndex = 0;
    a.addEventListener('click', () => { this._closeSliders(); this._moreInfo(b.entity); });
    more.appendChild(a);
    pop.appendChild(more);
    this._card.appendChild(pop);
    const outside = (ev) => {
      const path = ev.composedPath();
      if (!path.includes(pop) && !path.includes(anchor)) this._closeSliders();
    };
    const esc = (ev) => { if (ev.key === 'Escape') this._closeSliders(); };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', esc, true);
    this._pop = { el: pop, b, kind: 'media', anchor, outside, esc, art, mt, ma, prev, pp, next, vol, lab, lv, pw };
    this._fillMedia();
    this._placePop(pop, anchor);
    x.focus();
  }

  _fillMedia() {
    const p = this._pop;
    if (!p || p.kind !== 'media') return;
    const L = (k) => t(this._lang(), k);
    const s = this._hass.states[p.b.entity];
    const m = mediaInfo(s);
    p.art.style.display = m.picture ? '' : 'none';
    if (m.picture && p.art.getAttribute('src') !== m.picture) p.art.src = m.picture;
    p.mt.textContent = m.title || L('nothing_playing');
    p.ma.textContent = m.artist;
    p.prev.style.display = m.canPrev ? '' : 'none';
    p.next.style.display = m.canNext ? '' : 'none';
    p.pp.style.display = m.canPlayPause ? '' : 'none';
    setContent(p.pp, m.playing ? 'pause' : 'play', '', 20);
    const showVol = m.canVolume && m.volume !== null;
    p.vol.style.display = showVol ? '' : 'none';
    p.lab.style.display = showVol ? '' : 'none';
    if (showVol && this.shadowRoot.activeElement !== p.vol) { p.vol.value = String(m.volume); p.lv.textContent = `${m.volume} %`; }
    const on = isOn(s);
    p.pw.textContent = on ? L('turn_off') : L('turn_on');
    p.pw.classList.toggle('on', on);
  }

  _closeSliders() {
    if (!this._pop) return;
    this._pop.el.remove();
    window.removeEventListener('pointerdown', this._pop.outside, true);
    window.removeEventListener('keydown', this._pop.esc, true);
    this._pop = null;
  }

  _openSliders(b, anchor) {
    this._closeSliders();
    if (!this._hass || !this._card) return;
    const L = (k) => t(this._lang(), k);
    const s = this._hass.states[b.entity];
    const caps = lightCaps(s);
    const name = this._name(b.entity, b.label);
    const pop = document.createElement('div');
    pop.className = 'pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', name);
    const head = document.createElement('div');
    head.className = 'ph';
    const title = document.createElement('b');
    title.textContent = name;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'x';
    setContent(x, 'close', '', 16);
    x.title = L('close');
    x.setAttribute('aria-label', L('close'));
    x.addEventListener('click', () => this._closeSliders());
    head.appendChild(title);
    head.appendChild(x);
    pop.appendChild(head);
    const pw = document.createElement('button');
    pw.type = 'button';
    pw.className = 'pw';
    pw.addEventListener('click', () => { const c = toggleCall(b.entity); this._hass.callService(c.domain, c.service, c.data); });
    pop.appendChild(pw);
    const inputs = {};
    const slider = (key, cls, label, min, max, step, toCall, fmt) => {
      const lab = document.createElement('div');
      lab.className = 'lab';
      const a = document.createElement('span');
      a.textContent = label;
      const v = document.createElement('span');
      lab.appendChild(a);
      lab.appendChild(v);
      const r = document.createElement('input');
      r.type = 'range';
      r.className = cls;
      r.min = String(min);
      r.max = String(max);
      r.step = String(step);
      r.setAttribute('aria-label', label);
      r.addEventListener('input', () => { v.textContent = fmt(Number(r.value)); });
      r.addEventListener('change', () => {
        const c = toCall(Number(r.value));
        this._hass.callService(c.domain, c.service, c.data);
      });
      pop.appendChild(lab);
      pop.appendChild(r);
      inputs[key] = { r, v, fmt };
    };
    if (caps.brightness) slider('bri', 'bri', L('brightness'), 1, 100, 1, (val) => lightCall(b.entity, { brightness: val }), (val) => `${val} %`);
    if (caps.color) slider('hue', 'hue', L('color'), 0, 359, 1, (val) => lightCall(b.entity, { hue: val }), (val) => `${val}°`);
    if (caps.temp) {
      const lo = num(s.attributes.min_color_temp_kelvin, 2000);
      const hi = num(s.attributes.max_color_temp_kelvin, 6500);
      slider('ct', 'ct', L('temp'), lo, hi, 50, (val) => lightCall(b.entity, { kelvin: val }), (val) => `${val} K`);
    }
    if (!caps.brightness && !caps.color && !caps.temp) {
      const n = document.createElement('div');
      n.className = 'note';
      n.textContent = L('onoff_only');
      pop.appendChild(n);
    }
    const more = document.createElement('div');
    more.className = 'more';
    const a = document.createElement('a');
    a.textContent = L('more');
    a.tabIndex = 0;
    a.addEventListener('click', () => { this._closeSliders(); this._moreInfo(b.entity); });
    more.appendChild(a);
    pop.appendChild(more);
    this._card.appendChild(pop);

    // place it next to the button, inside the card
    const cr = this._card.getBoundingClientRect();
    const br = anchor.getBoundingClientRect();
    const pw2 = pop.offsetWidth;
    const ph2 = pop.offsetHeight;
    let left = br.left - cr.left + br.width / 2 - pw2 / 2;
    left = clamp(left, 6, Math.max(6, cr.width - pw2 - 6));
    let top = br.bottom - cr.top + 10;
    if (top + ph2 > cr.height - 6) top = Math.max(6, br.top - cr.top - ph2 - 10);
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;

    const outside = (ev) => {
      const path = ev.composedPath();
      if (!path.includes(pop) && !path.includes(anchor)) this._closeSliders();
    };
    const esc = (ev) => { if (ev.key === 'Escape') this._closeSliders(); };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', esc, true);
    this._pop = { el: pop, b, pw, inputs, outside, esc };
    this._syncSliders();
    (inputs.bri || inputs.hue || inputs.ct || { r: pw }).r.focus();
  }

  _syncSliders() {
    if (!this._pop || !this._hass) return;
    if (this._pop.kind === 'info') { this._fillInfo(); return; }
    if (this._pop.kind === 'media') { this._fillMedia(); return; }
    const { b, pw, inputs } = this._pop;
    const s = this._hass.states[b.entity];
    const L = (k) => t(this._lang(), k);
    const on = isOn(s);
    pw.textContent = on ? L('turn_off') : L('turn_on');
    pw.classList.toggle('on', on);
    this._pop.el.style.setProperty('--glow', glowColor(s, 'var(--state-light-active-color, #ffb300)'));
    const active = this.shadowRoot.activeElement;
    const set = (k, val) => {
      const i = inputs[k];
      if (!i || val === null || val === undefined || i.r === active) return;
      i.r.value = String(val);
      i.v.textContent = i.fmt(Number(i.r.value));
    };
    set('bri', brightnessPct(s) || (on ? 100 : 1));
    set('hue', hueOf(s));
    set('ct', s && s.attributes ? s.attributes.color_temp_kelvin : null);
  }

  _openInfo(b, anchor) {
    this._closeSliders();
    if (!this._hass || !this._card) return;
    const L = (k) => t(this._lang(), k);
    const pop = document.createElement('div');
    pop.className = 'pop info';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', L('ha_title'));
    const head = document.createElement('div');
    head.className = 'ph';
    const title = document.createElement('b');
    setContent(title, 'home', L('ha_title'), 16);
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'x';
    setContent(x, 'close', '', 16);
    x.title = L('close');
    x.setAttribute('aria-label', L('close'));
    x.addEventListener('click', () => this._closeSliders());
    head.appendChild(title);
    head.appendChild(x);
    pop.appendChild(head);
    const live = document.createElement('div');
    pop.appendChild(live);
    const sys = document.createElement('div');
    pop.appendChild(sys);
    if (this._hass.user && this._hass.user.is_admin) {
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'sys';
      go.textContent = L('open_system');
      go.addEventListener('click', () => {
        this._closeSliders();
        window.history.pushState(null, '', '/config/system');
        window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: false } }));
      });
      pop.appendChild(go);
    }
    this._card.appendChild(pop);
    this._placePop(pop, anchor);
    const outside = (ev) => {
      const path = ev.composedPath();
      if (!path.includes(pop) && !path.includes(anchor)) this._closeSliders();
    };
    const esc = (ev) => { if (ev.key === 'Escape') this._closeSliders(); };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', esc, true);
    this._pop = { el: pop, b, kind: 'info', live, sys, outside, esc, anchor };
    this._fillInfo();
    this._loadSystemInfo(sys);
    x.focus();
  }

  _placePop(pop, anchor) {
    const cr = this._card.getBoundingClientRect();
    const br = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    let left = br.left - cr.left + br.width / 2 - pw / 2;
    left = clamp(left, 6, Math.max(6, cr.width - pw - 6));
    let top = br.bottom - cr.top + 10;
    if (top + ph > cr.height - 6) top = Math.max(6, br.top - cr.top - ph - 10);
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  }

  _dl(rows) {
    const dl = document.createElement('dl');
    rows.forEach(([k, v, cls]) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      if (cls) dd.className = cls;
      dl.appendChild(dt);
      dl.appendChild(dd);
    });
    return dl;
  }

  _h5(text) {
    const h = document.createElement('h5');
    h.textContent = text;
    return h;
  }

  /** The parts that come from the live hass object (refreshed on every state change). */
  _fillInfo() {
    if (!this._pop || this._pop.kind !== 'info') return;
    const L = (k) => t(this._lang(), k);
    const h = this._hass;
    const c = h.config || {};
    const sum = haSummary(h.states);
    const live = this._pop.live;
    live.textContent = '';
    live.appendChild(this._dl([
      [L('name'), c.location_name || '–'],
      [L('version'), c.version || '–'],
      [L('connection'), h.connected === false ? L('reconnecting') : L('connected'), h.connected === false ? 'bad' : 'ok'],
      [L('timezone'), c.time_zone || '–'],
      [L('language'), (h.locale && h.locale.language) || h.language || '–'],
    ]));
    live.appendChild(this._h5(L('overview')));
    live.appendChild(this._dl([
      [L('entities'), String(sum.entities)],
      [L('devices'), String(Object.keys(h.devices || {}).length || '–')],
      [L('areas'), String(Object.keys(h.areas || {}).length || '–')],
      [L('lights'), `${sum.lightsOn} ${L('of')} ${sum.lightsTotal}`],
      [L('unav_n'), String(sum.unavailable), sum.unavailable ? 'bad' : 'ok'],
    ]));
    live.appendChild(this._h5(L('updates')));
    if (!sum.updates.length) {
      const ok = document.createElement('div');
      ok.className = 'ok';
      ok.style.fontSize = '13px';
      setContent(ok, 'check', L('no_updates'), 14);
      live.appendChild(ok);
    } else {
      const ul = document.createElement('ul');
      sum.updates.forEach((u) => {
        const li = document.createElement('li');
        li.className = 'bad';
        li.textContent = `${u.name}${u.version ? `: ${u.version}` : ''}`;
        ul.appendChild(li);
      });
      live.appendChild(ul);
    }
  }

  /** Admin-only system facts from the Supervisor and Repairs (skipped quietly when not available). */
  async _loadSystemInfo(box) {
    const L = (k) => t(this._lang(), k);
    const h = this._hass;
    if (!h || !h.user || !h.user.is_admin || !h.callWS) return;
    box.appendChild(this._h5(L('system')));
    const wait = document.createElement('div');
    wait.style.fontSize = '13px';
    wait.textContent = L('loading');
    box.appendChild(wait);
    const sup = (endpoint) => h.callWS({ type: 'supervisor/api', endpoint, method: 'get' }).catch(() => null);
    const [os, host, rep2] = await Promise.all([
      sup('/os/info'), sup('/host/info'), h.callWS({ type: 'repairs/list_issues' }).catch(() => null),
    ]);
    if (!this._pop || this._pop.sys !== box) return; // panel closed meanwhile
    wait.remove();
    const rows = [];
    if (host && host.operating_system) rows.push([L('os'), host.operating_system]);
    else if (os && os.version) rows.push([L('os'), `Home Assistant OS ${os.version}`]);
    if (host && host.hostname) rows.push([L('host'), host.hostname]);
    if (host && host.disk_total) {
      const pct = Math.round((num(host.disk_used, 0) / num(host.disk_total, 1)) * 100);
      rows.push([L('disk'), `${fmtBytes(host.disk_used)} / ${fmtBytes(host.disk_total)} (${pct} %)`, pct > 85 ? 'bad' : '']);
    }
    if (rep2 && Array.isArray(rep2.issues)) {
      const open = rep2.issues.filter((i) => !i.ignored).length;
      rows.push([L('repairs'), open ? String(open) : L('none'), open ? 'bad' : 'ok']);
    }
    if (rows.length) box.appendChild(this._dl(rows));
    if (this._pop && this._pop.anchor) this._placePop(this._pop.el, this._pop.anchor);
  }

  _moreInfo(entityId) {
    if (!entityId) return;
    this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId }, bubbles: true, composed: true }));
  }

  _name(entityId, fallback) {
    const s = this._hass && this._hass.states[entityId];
    return fallback || (s && s.attributes.friendly_name) || entityId;
  }

  _update() {
    if (!this._hass || !this._config) return;
    const lang = this._lang();
    const dark = this._theme() === 'dark';
    if (this._card) this._card.classList.toggle('dark', dark && !this._editing);
    if (this._themeBtn) {
      setContent(this._themeBtn, dark ? 'sun' : 'moon', '', 18);
      const lbl = t(lang, dark ? 'to_light' : 'to_dark');
      this._themeBtn.title = lbl;
      this._themeBtn.setAttribute('aria-label', lbl);
    }
    if (!this._btnEls || this._editing) return;
    const accent = this._config.glow_color === 'auto' ? 'var(--state-light-active-color, var(--primary-color, #ffb300))' : this._config.glow_color;
    this._config.buttons.forEach((b, i) => {
      const el = this._btnEls[i];
      if (!el) return;
      if (!b.entity) { el.querySelector('.txt').textContent = b.label || ''; return; }
      const s = this._hass.states[b.entity];
      const dom = b.entity.split('.')[0];
      const on = ACTIVATE_DOMAINS.has(dom) ? false : isOn(s);
      const unav = isUnavailable(s);
      const name = this._name(b.entity, b.label);
      el.classList.toggle('on', on);
      el.classList.toggle('sensor', dom === 'sensor' || dom === 'binary_sensor');
      el.classList.toggle('alert', dom === 'binary_sensor' && on);
      el.classList.toggle('playing', dom === 'media_player' && !!s && s.state === 'playing');
      el.classList.toggle('unavailable', unav);
      el.style.setProperty('--glow', this._config.glow_color === 'auto' ? glowColor(s, accent) : accent);
      el.setAttribute('aria-pressed', String(on));
      const stateTxt = this._stateText(s, lang);
      el.setAttribute('aria-label', `${name}: ${stateTxt}`);
      el.title = `${name}: ${stateTxt}`;
      if (el.classList.contains('circ')) {
        const si = el.querySelector('.si');
        const icon = sensorIcon(s, b.entity);
        if (si.dataset.ic !== icon) { setContent(si, icon, '', 14); si.dataset.ic = icon; }
        el.querySelector('.txt').textContent = '';
        return;
      }
      el.querySelector('.txt').textContent = b.style === 'hotspot' ? '' : name;
    });
    this._updateSide(lang);
    const members = roomMembers(this._config.rooms, this._config.buttons);
    if (this._allOffBtn) this._allOffBtn.disabled = !allOffTargets(this._config.buttons).length;
    this._config.rooms.forEach((r, i) => {
      const anyOn = members[i].some((e) => !e.startsWith('sensor.') && isOn(this._hass.states[e]));
      this._roomEls[i].forEach((el) => {
        el.classList.toggle('on', anyOn);
        el.classList.toggle('selected', this._room === i);
      });
    });
    this._infoTxt.textContent = this._room === null ? '' : this._roomText(this._config.rooms[this._room], members[this._room], lang);
    this._renderRoomActions(this._room === null ? [] : members[this._room], lang);
    if (!this._fitted) { this._fitted = true; requestAnimationFrame(() => this._fitLabels()); }
    this._syncSliders();
  }

  _roomText(r, allEnts, lang) {
    const ents = (allEnts || []).filter((e) => !ACTIVATE_DOMAINS.has(e.split('.')[0])); // scenes have no state to show
    if (!ents.length) return `${r.name || ''}: ${t(lang, 'room_none')}`;
    const labelOf = (e) => (this._config.buttons.find((b) => b.entity === e) || {}).label;
    const parts = ents.map((e) => {
      const s = this._hass.states[e];
      if (isUnavailable(s)) return `${this._name(e, labelOf(e))} ${t(lang, 'unavailable')}`;
      if (e.startsWith('sensor.')) return `${this._name(e, labelOf(e))} ${sensorText(s, lang)}`;
      return `${this._name(e, labelOf(e))} ${this._stateText(s, lang)}`;
    });
    return `${r.name || ''}: ${parts.join(', ')}`;
  }
}

// ----------------------------------------------------------------- editor --

const EDITOR_CSS = `
  :host { display: block; container-type: inline-size; }
  .layout { display: grid; grid-template-columns: minmax(260px, 320px) 1fr; gap: 12px; align-items: start; }
  .side { position: sticky; top: 0; max-height: 82vh; overflow: auto; display: flex; flex-direction: column; gap: 10px;
          padding-right: 2px; overscroll-behavior: contain; }
  .main { min-width: 0; }
  @container (max-width: 760px) { .layout { grid-template-columns: 1fr; } .side { position: static; max-height: none; order: 2; } }
  .scanner { border: 1px solid var(--divider-color, #ccc); border-radius: 8px; padding: 8px; }
  .scanner h4 { margin: 0 0 8px; font-size: .95rem; }
  .scanner .scanbtn { width: 100%; justify-content: center; margin-bottom: 8px; }
  .scanner .count { font-size: .8rem; color: var(--secondary-text-color); margin: 4px 0 6px; }
  .scanner input[type=search] { width: 100%; box-sizing: border-box; }
  .side .chips { flex-direction: column; flex-wrap: nowrap; gap: 4px; }
  .side .chip { border-radius: 8px; display: flex; flex-direction: column; align-items: flex-start; }
  .chip .ar { font-size: .72rem; color: var(--secondary-text-color); }
  .side .panel { margin-top: 0; }
  .side .nums { grid-template-columns: repeat(2, 1fr); }
  .side { overflow-x: hidden; }
  .side .row, .side label { min-width: 0; }
  .side input, .side select { width: 100%; box-sizing: border-box; min-width: 0; }
  .side input[type=checkbox] { width: 18px; }
  .side .grid2 { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .side .nums { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: .85rem; color: var(--secondary-text-color); }
  label.check { flex-direction: row; align-items: center; gap: 8px; }
  input, select { font: inherit; padding: 6px 8px; border: 1px solid var(--divider-color, #ccc); border-radius: 6px;
                  background: var(--card-background-color, #fff); color: var(--primary-text-color, #111); }
  input[type=checkbox] { width: 18px; height: 18px; padding: 0; }
  input[type=color] { padding: 0 2px; height: 34px; width: 100%; }
  .tools { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 8px 0; }
  .tools .pct { min-width: 46px; text-align: center; font-size: .85rem; color: var(--secondary-text-color); }
  .tools .sp { flex: 1; }
  button.act { font: inherit; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--divider-color, #ccc);
               background: var(--card-background-color, #fff); color: var(--primary-text-color, #111); cursor: pointer; }
  button.act.icon { min-width: 36px; padding: 6px 8px; }
  button.danger { color: var(--error-color, #db4437); }
  .wrap { position: relative; overflow: auto; border: 1px solid var(--divider-color, #ccc); border-radius: 6px;
          background: var(--secondary-background-color, #f3f4f7); overscroll-behavior: contain; }
  .wrap { cursor: grab; }
  .wrap.panning { cursor: grabbing; }
  .stage { position: relative; container-type: inline-size; line-height: 0; margin: 0 auto; touch-action: none;
           user-select: none; -webkit-user-select: none; cursor: grab; }
  .stage.drop { outline: 3px dashed var(--accent-color, #ff9800); outline-offset: -3px; }
  .stage img { width: 100%; height: auto; display: block; pointer-events: none; }
  .box { position: absolute; box-sizing: border-box; cursor: move; border: 2px solid var(--primary-color, #03a9f4);
         background: color-mix(in srgb, var(--primary-color, #03a9f4) 18%, transparent); border-radius: 5px;
         font: 600 max(7px, calc(var(--fs, 0.95) * 1cqw))/1.1 system-ui, sans-serif; color: var(--tc, #111);
         display: flex; align-items: center; justify-content: center; text-align: center; overflow: visible;
         transform: rotate(var(--rot, 0deg)); }
  .box.text { border-style: dashed; background: transparent; }
  .box { z-index: 2; }
  .box.selected { border-color: var(--accent-color, #ff9800); background: color-mix(in srgb, var(--accent-color, #ff9800) 22%, transparent); z-index: 4; }
  .rbox { position: absolute; box-sizing: border-box; z-index: 1; cursor: move; border: 2px dashed #7b61ff;
          background: rgba(123, 97, 255, .08); border-radius: 6px; }
  .rbox .rn { position: absolute; left: 4px; top: 3px; font: 600 max(8px, .9cqw)/1.1 system-ui, sans-serif; color: #4b2fc4;
              background: rgba(255, 255, 255, .85); padding: 1px 5px; border-radius: 4px; pointer-events: none; white-space: nowrap; }
  .rbox.selected { border-style: solid; border-color: #7b61ff; background: rgba(123, 97, 255, .16); z-index: 3; }
  .eh { position: absolute; z-index: 2; }
  .eh.n, .eh.s { left: 6px; right: 6px; height: 10px; cursor: ns-resize; }
  .eh.e, .eh.w { top: 6px; bottom: 6px; width: 10px; cursor: ew-resize; }
  .eh.n { top: -6px; } .eh.s { bottom: -6px; } .eh.e { right: -6px; } .eh.w { left: -6px; }
  .eh.ne, .eh.nw, .eh.se, .eh.sw { width: 14px; height: 14px; }
  .eh.ne { top: -7px; right: -7px; cursor: nesw-resize; } .eh.sw { bottom: -7px; left: -7px; cursor: nesw-resize; }
  .eh.nw { top: -7px; left: -7px; cursor: nwse-resize; } .eh.se { bottom: -7px; right: -7px; cursor: nwse-resize; }
  .rbox:hover { border-color: #5b3fd6; }
  .rbox.selected .eh.ne, .rbox.selected .eh.nw, .rbox.selected .eh.se, .rbox.selected .eh.sw {
         background: #fff; border: 2px solid #7b61ff; border-radius: 3px; width: 10px; height: 10px; }
  .merge { position: absolute; z-index: 6; width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 50%;
           border: 2px solid #fff; background: #7b61ff; color: #fff; font: 700 18px/20px system-ui, sans-serif;
           cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.35); padding: 0; }
  .merge:hover { background: #5b3fd6; transform: scale(1.1); }
  .parts { display: flex; flex-direction: column; gap: 4px; margin: 6px 0 10px; }
  .parts .prow { display: flex; align-items: center; gap: 8px; font-size: .85rem; }
  .box:focus-visible { outline: 2px solid var(--accent-color, #ff9800); outline-offset: 2px; }
  .box.circ { width: max(22px, 2.6cqw) !important; height: auto !important; aspect-ratio: 1; border-radius: 50%;
              transform: translate(-50%, -50%); color: #1d6fb8; background: #fff; }
  .box.circ.selected { background: color-mix(in srgb, var(--accent-color, #ff9800) 30%, #fff); }
  .box.circ .grip, .box.circ .rh, .box.circ .lbl, .box.circ.selected .grip, .box.circ.selected .rh { display: none; }
  .box.circ .si { display: flex; width: 100%; height: 100%; align-items: center; justify-content: center; pointer-events: none; }
  .box.circ .si svg { width: 62%; height: 62%; }
  .plist { border: 1px solid var(--divider-color, #ccc); border-radius: 8px; padding: 8px; }
  .plist h4 { margin: 0 0 8px; font-size: .95rem; }
  .plist .pi { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 6px; cursor: pointer; }
  .plist .pi:hover { background: rgba(127, 127, 127, .12); }
  .plist .pi.selected { background: color-mix(in srgb, var(--accent-color, #ff9800) 22%, transparent); }
  .plist .pi span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .plist .pi button { font: inherit; border: none; background: none; cursor: pointer; padding: 2px; color: inherit; }
  .plist .none { font-size: .8rem; color: var(--secondary-text-color); line-height: 1.35; }
  .box .lbl { overflow: hidden; pointer-events: none; }
  .grip { position: absolute; right: -16px; bottom: -16px; width: 12px; height: 12px; cursor: nwse-resize;
          background: var(--accent-color, #ff9800); border: 2px solid #fff; border-radius: 3px; display: none; }
  .rh { position: absolute; left: 50%; top: -28px; width: 14px; height: 14px; margin-left: -9px; cursor: grab;
        background: #fff; border: 2px solid var(--accent-color, #ff9800); border-radius: 50%; display: none; }
  .rh::after { content: ''; position: absolute; left: 6px; top: 14px; width: 2px; height: 12px; background: var(--accent-color, #ff9800); }
  .box.selected .grip, .box.selected .rh { display: block; }
  .hint { font-size: .85rem; color: var(--secondary-text-color); margin: 4px 0 8px; line-height: 1.4; }
  .panel { border: 1px solid var(--divider-color, #ccc); border-radius: 8px; padding: 10px; margin-top: 8px; }
  .panel h4 { margin: 0 0 8px; font-size: .95rem; }
  .nums { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .palette { border: 1px solid var(--divider-color, #ccc); border-radius: 8px; padding: 8px; margin: 8px 0; }
  .palette h4 { margin: 0 0 6px; font-size: .9rem; font-weight: 600; color: var(--primary-text-color); }
  .palette .grp { font-size: .78rem; text-transform: uppercase; letter-spacing: .04em; color: var(--secondary-text-color); margin: 8px 0 4px; }
  .palette .list { max-height: none; overflow: visible; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { touch-action: none; user-select: none; -webkit-user-select: none; cursor: grab; padding: 5px 10px; border-radius: 14px;
          border: 1px solid var(--divider-color, #ccc); background: var(--secondary-background-color, #f3f4f7);
          color: var(--primary-text-color, #111); font-size: .85rem; line-height: 1.2; }
  .chip.placed { opacity: .6; }
  .chip small { color: var(--secondary-text-color); margin-left: 4px; }
  .ghost { position: fixed; z-index: 10000; pointer-events: none; padding: 5px 10px; border-radius: 14px; font-size: .85rem;
           background: var(--accent-color, #ff9800); color: #fff; box-shadow: 0 4px 12px rgba(0,0,0,.3); transform: translate(-50%, -50%); }
  .status { font-size: .85rem; color: var(--secondary-text-color); }
  .warnbox { border-left: 4px solid var(--warning-color, #ffa600); background: color-mix(in srgb, var(--warning-color, #ffa600) 12%, transparent);
             padding: 8px 10px; border-radius: 6px; font-size: .85rem; margin: 0 0 10px; line-height: 1.4; }
  .warnbox button { margin-top: 6px; }
  .box.dup { outline: 2px dashed var(--warning-color, #ffa600); outline-offset: 2px; }
  .box.dup::after { content: '!'; position: absolute; top: -12px; left: -12px; width: 16px; height: 16px; border-radius: 50%;
                    background: var(--warning-color, #ffa600); color: #fff; font: 700 11px/16px system-ui, sans-serif;
                    text-align: center; transform: rotate(calc(-1 * var(--rot, 0deg))); }
  .ic { display: inline-block; vertical-align: -0.2em; flex: none; }
  button.act { display: inline-flex; align-items: center; gap: 4px; }
  button.act:disabled { opacity: .45; cursor: default; }
  .scanner .autobtn { width: 100%; justify-content: center; margin: 4px 0 6px; }
  .scanner .msg { font-size: .8rem; color: var(--secondary-text-color); margin-bottom: 6px; line-height: 1.35; }
  button.act.danger.sel { border-color: var(--error-color, #db4437); }
`;

const EZ_MIN = 0.5;
const EZ_MAX = 4;

class GhDashCardEditor extends Base {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = null;
    this._hass = null;
    this._sel = -1;
    this._lastFired = null;
    this._search = '';
    this._ez = 1; // editor zoom
    this._selRoom = -1;
    this._hist = [];
    // Ctrl+Z anywhere on the page while the editor is open (focus is often on the page, not in the editor)
    this._onKey = (ev) => {
      if (!this.isConnected || !(ev.ctrlKey || ev.metaKey) || ev.shiftKey || String(ev.key).toLowerCase() !== 'z') return;
      const target = ev.composedPath()[0];
      if (target && (/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName) || target.isContentEditable)) return; // let fields undo text
      ev.preventDefault();
      this._undo();
    };
    this._scroll = null;
  }

  setConfig(config) {
    const json = JSON.stringify(config);
    this._config = JSON.parse(json);
    if (!Array.isArray(this._config.buttons)) this._config.buttons = [];
    if (!Array.isArray(this._config.rooms)) this._config.rooms = [];
    this._config.rooms = this._config.rooms.map((r) => ({ name: r.name || '', parts: roomParts(r) }));
    if (json === this._lastFired && this.shadowRoot.childElementCount) return; // our own change echoed back
    this._cur = json;
    this._render();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first && this._config) this._render();
  }

  connectedCallback() {
    window.addEventListener('keydown', this._onKey);
  }

  disconnectedCallback() {
    window.removeEventListener('keydown', this._onKey);
  }

  _lang() {
    return (this._hass && (this._hass.locale?.language || this._hass.language)) || 'en';
  }

  _fire() {
    const config = { ...this._config, buttons: this._config.buttons.map((b) => this._clean(b)) };
    // rooms: name + area; members follow the devices' positions, so no entity lists are stored
    config.rooms = (this._config.rooms || []).map((r) => {
      const parts = roomParts(r).map((q) => clampRect(q));
      return parts.length === 1 ? { name: r.name || '', ...parts[0] } : { name: r.name || '', parts };
    });
    if (!config.rooms.length) delete config.rooms;
    this._lastFired = JSON.stringify(config);
    if (!this._undoing && this._cur && this._cur !== this._lastFired) this._hist = pushHistory(this._hist || [], this._cur);
    this._cur = this._lastFired;
    this._config = JSON.parse(this._lastFired);
    this._config.rooms = (this._config.rooms || []).map((r) => ({ name: r.name || '', parts: roomParts(r) }));
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
  }

  /** Undo the last change (button or Ctrl+Z). */
  _undo() {
    if (!this._hist || !this._hist.length) return;
    const prev = this._hist[this._hist.length - 1];
    this._hist = this._hist.slice(0, -1);
    const c = JSON.parse(prev);
    if (!Array.isArray(c.buttons)) c.buttons = [];
    c.rooms = (Array.isArray(c.rooms) ? c.rooms : []).map((r) => ({ name: r.name || '', parts: roomParts(r) }));
    this._config = c;
    this._sel = -1;
    this._selRoom = -1;
    this._undoing = true;
    this._fire();
    this._undoing = false;
    this._render();
  }

  _clean(b) {
    const out = {};
    if ('entity' in b) out.entity = b.entity || '';
    if (b.label) out.label = b.label;
    out.style = b.style || 'label';
    if (b.tap_action && b.tap_action !== 'toggle') out.tap_action = b.tap_action;
    if (normRotate(b.rotate)) out.rotate = normRotate(b.rotate);
    if (b.sliders === true) out.sliders = true;
    if (b.size !== undefined && b.size !== null && b.size !== '') out.size = round1(num(b.size, 1));
    if (b.color) out.color = b.color;
    return { ...out, ...clampRect(b) };
  }

  _isDevice(b) {
    return 'entity' in b;
  }

  // ------------------------------------------------------------ render
  _render() {
    const L = (k) => t(this._lang(), k);
    if (this._wrap) this._scroll = { l: this._wrap.scrollLeft, t: this._wrap.scrollTop };
    const root = this.shadowRoot;
    root.innerHTML = '';
    const style = document.createElement('style');
    style.textContent = EDITOR_CSS;
    root.appendChild(style);

    if (!this.onCard) this._settings(root, L);

    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = L('drag_hint');
    root.appendChild(hint);

    const layout = document.createElement('div');
    layout.className = 'layout';
    const side = document.createElement('div');
    side.className = 'side';
    const main = document.createElement('div');
    main.className = 'main';
    layout.appendChild(side);
    layout.appendChild(main);
    root.appendChild(layout);
    main.appendChild(this._tools(L));

    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    const stage = document.createElement('div');
    stage.className = 'stage';
    if (this._config.image) {
      const img = document.createElement('img');
      img.src = this._config.image;
      img.alt = '';
      img.addEventListener('load', () => this._layout());
      stage.appendChild(img);
    }
    this._config.rooms.forEach((r, i) => r.parts.forEach((q, k) => stage.appendChild(this._partBox(r, i, q, k))));
    this._mergeButtons(stage);
    this._config.buttons.forEach((b, i) => { if (!isPreset(b.entity)) stage.appendChild(this._box(b, i)); });
    wrap.appendChild(stage);
    main.appendChild(wrap);
    this._wrap = wrap;
    this._stage = stage;
    this._wireStage(wrap, stage);
    this._layout();

    // left menu: the selected item's settings on top, the device scanner below
    const panel = this._panel(L);
    if (panel) side.appendChild(panel);
    side.appendChild(this._presetList(L));
    side.appendChild(this._palette());
    if (this._sideScroll) side.scrollTop = this._sideScroll;
    side.addEventListener('scroll', () => { this._sideScroll = side.scrollTop; });
  }

  /** Size the plan: the wrap is as tall as the plan at 100 % (max 70 % of the window); zoom scrolls inside. */
  _layout() {
    const wrap = this._wrap;
    const img = this._stage && this._stage.querySelector('img');
    if (!wrap || !img || !img.naturalWidth) return;
    const aspect = img.naturalHeight / img.naturalWidth;
    const ww = wrap.clientWidth || 400;
    const h = Math.max(240, Math.min(window.innerHeight * 0.7, ww * aspect));
    wrap.style.height = `${Math.round(h)}px`;
    this._baseW = h / aspect;
    this._stage.style.width = `${Math.round(this._baseW * this._ez)}px`;
    if (this._pct) this._pct.textContent = `${Math.round(this._ez * 100)}%`;
    if (this._scroll) {
      wrap.scrollLeft = this._scroll.l;
      wrap.scrollTop = this._scroll.t;
      this._scroll = null;
    }
  }

  _setZoom(z, clientX, clientY) {
    const wrap = this._wrap;
    const stage = this._stage;
    if (!wrap || !stage || !this._baseW) return;
    const before = stage.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    const px = clientX === undefined ? wr.left + wr.width / 2 : clientX;
    const py = clientY === undefined ? wr.top + wr.height / 2 : clientY;
    const fx = before.width ? (px - before.left) / before.width : 0.5;
    const fy = before.height ? (py - before.top) / before.height : 0.5;
    this._ez = clamp(Math.round(z * 100) / 100, EZ_MIN, EZ_MAX);
    stage.style.width = `${Math.round(this._baseW * this._ez)}px`;
    if (this._pct) this._pct.textContent = `${Math.round(this._ez * 100)}%`;
    const after = stage.getBoundingClientRect();
    // keep the point under the pointer where it was
    wrap.scrollLeft += (after.left + fx * after.width) - px;
    wrap.scrollTop += (after.top + fy * after.height) - py;
  }

  _tools(L) {
    const bar = document.createElement('div');
    bar.className = 'tools';
    const btn = (txt, label, fn, cls = 'act') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      if (Array.isArray(txt)) setContent(b, txt[0], txt[1], 16);
      else if (ICONS[txt]) setContent(b, txt, '', 16);
      else b.textContent = txt;
      b.title = label;
      b.setAttribute('aria-label', label);
      b.addEventListener('click', fn);
      bar.appendChild(b);
      return b;
    };
    btn('minus', L('zoom_out'), () => this._setZoom(this._ez / 1.25), 'act icon');
    this._pct = document.createElement('span');
    this._pct.className = 'pct';
    this._pct.textContent = `${Math.round(this._ez * 100)}%`;
    bar.appendChild(this._pct);
    btn('plus', L('zoom_in'), () => this._setZoom(this._ez * 1.25), 'act icon');
    btn('fit', L('fit'), () => { this._ez = 1; this._layout(); this._wrap.scrollLeft = 0; this._wrap.scrollTop = 0; }, 'act icon');
    const sp = document.createElement('span');
    sp.className = 'sp';
    bar.appendChild(sp);
    const addAt = (item) => {
      const c = this._visibleCentre();
      this._config.buttons.push({ ...item, ...clampRect({ x: c.x - 4, y: c.y - 1.5, w: 8, h: 3 }) });
      this._sel = this._config.buttons.length - 1;
      this._selRoom = -1;
      this._fire();
      this._render();
    };
    if (this._sel >= 0 || this._selRoom >= 0) {
      btn(['trash', L('remove_sel')], L('remove_sel'), () => this._removeSelected(), 'act danger sel');
    }
    const undoBtn = btn(['undo', L('undo')], `${L('undo')} (Ctrl+Z)`, () => this._undo());
    undoBtn.disabled = !(this._hist && this._hist.length);
    btn(L('add_room'), L('add_room'), () => {
      const c = this._visibleCentre();
      this._config.rooms.push({ name: `${L('new_room')} ${this._config.rooms.length + 1}`, parts: [clampRect({ x: c.x - 12, y: c.y - 9, w: 24, h: 18 })] });
      this._selRoom = this._config.rooms.length - 1;
      this._sel = -1;
      this._fire();
      this._render();
    });
    btn(L('add_text'), L('add_text'), () => addAt({ label: L('text'), style: 'text', size: 1.4 }));
    btn(L('add_label'), L('add_label'), () => addAt({ label: L('label'), style: 'label' }));
    btn(`+ ${L('add_device')}`, L('add_device'), () => addAt({ entity: '', style: 'label' }));
    // upload a new floor-plan image into Home Assistant (same storage as HA's picture card)
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'image/*';
    file.hidden = true;
    bar.appendChild(file);
    const status = document.createElement('span');
    status.className = 'status';
    status.setAttribute('aria-live', 'polite');
    const up = btn(['upload', L('upload')], L('upload'), () => file.click());
    bar.appendChild(status);
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      if (!f || !this._hass) return;
      up.disabled = true;
      status.textContent = L('uploading');
      try {
        const fd = new FormData();
        fd.append('file', f);
        const res = await this._hass.fetchWithAuth('/api/image/upload', { method: 'POST', body: fd });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        this._config.image = `/api/image/serve/${body.id}/original`;
        this._ez = 1;
        // a new image does not have the old drawn labels: invisible hotspots become visible labels
        let converted = 0;
        this._config.buttons.forEach((b) => { if (b.style === 'hotspot') { b.style = 'label'; converted += 1; } });
        this._fire();
        this._render();
        if (converted) {
          const st = this.shadowRoot.querySelector('.tools .status');
          if (st) st.textContent = L('hotspots_converted').replace('{n}', String(converted));
        }
      } catch (e) {
        status.textContent = `${L('upload_failed')}: ${e && e.message ? e.message : e}`;
        up.disabled = false;
      }
    });
    return bar;
  }

  _removeSelected() {
    if (this._selRoom >= 0 && this._config.rooms[this._selRoom]) {
      this._config.rooms.splice(this._selRoom, 1);
    } else if (this._sel >= 0 && this._config.buttons[this._sel]) {
      this._config.buttons.splice(this._sel, 1);
    } else {
      return;
    }
    this._sel = -1;
    this._selRoom = -1;
    this._fire();
    this._render();
  }

  _visibleCentre() {
    const wr = this._wrap && this._wrap.getBoundingClientRect();
    const sr = this._stage && this._stage.getBoundingClientRect();
    if (!wr || !sr || !sr.width) return { x: 50, y: 50 };
    return {
      x: clamp(((wr.left + wr.width / 2 - sr.left) / sr.width) * 100, 0, 100),
      y: clamp(((wr.top + wr.height / 2 - sr.top) / sr.height) * 100, 0, 100),
    };
  }

  _wireStage(wrap, stage) {
    // mouse wheel = zoom around the pointer
    wrap.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      this._setZoom(this._ez * (ev.deltaY < 0 ? 1.15 : 1 / 1.15), ev.clientX, ev.clientY);
    }, { passive: false });
    // drag on an empty spot = move the plan; a click on an empty spot = deselect
    wrap.addEventListener('pointerdown', (ev) => {
      if (ev.target !== stage && ev.target !== wrap && ev.target.tagName !== 'IMG') return;
      if (ev.button !== 0) return;
      const sx = ev.clientX;
      const sy = ev.clientY;
      const sl = wrap.scrollLeft;
      const st = wrap.scrollTop;
      let moved = false;
      wrap.setPointerCapture(ev.pointerId);
      const move = (e) => {
        const dx = e.clientX - sx;
        const dy = e.clientY - sy;
        if (!moved && Math.hypot(dx, dy) < 4) return;
        moved = true;
        wrap.classList.add('panning');
        wrap.scrollLeft = sl - dx;
        wrap.scrollTop = st - dy;
      };
      const up = () => {
        wrap.removeEventListener('pointermove', move);
        wrap.removeEventListener('pointerup', up);
        wrap.removeEventListener('pointercancel', up);
        wrap.classList.remove('panning');
        if (!moved && (this._sel !== -1 || this._selRoom !== -1)) { this._sel = -1; this._selRoom = -1; this._render(); }
      };
      wrap.addEventListener('pointermove', move);
      wrap.addEventListener('pointerup', up);
      wrap.addEventListener('pointercancel', up);
    });
  }

  /** Card-wide settings (only in Home Assistant's card editor, not in the on-card edit mode). */
  _settings(root, L) {
    root.appendChild(this._field(L('image'), 'text', this._config.image || '', (v) => { this._config.image = v; this._fire(); this._render(); }));
    const g2 = document.createElement('div');
    g2.className = 'grid2';
    g2.appendChild(this._select(L('theme'), [['light', L('th_light')], ['dark', L('th_dark')], ['auto', L('th_auto')]],
      this._config.theme || 'light', (v) => { this._config.theme = v; this._fire(); }));
    g2.appendChild(this._field(L('zoom_default'), 'number', String(clampZoom(this._config.zoom)), (v) => {
      this._config.zoom = clampZoom(v); this._fire(); this._render();
    }, { step: String(ZOOM_STEP), min: String(ZOOM_MIN), max: String(ZOOM_MAX) }));
    root.appendChild(g2);
    root.appendChild(this._field(L('glow'), 'text', this._config.glow_color || 'auto', (v) => { this._config.glow_color = v || 'auto'; this._fire(); }));
    root.appendChild(this._check(L('fit_opt'), this._config.fit !== false, (v) => { this._config.fit = v; this._fire(); }));
    root.appendChild(this._check(L('controls'), this._config.show_controls !== false, (v) => { this._config.show_controls = v; this._fire(); }));
  }

  _palette() {
    const L = (k) => t(this._lang(), k);
    const box = document.createElement('div');
    box.className = 'palette scanner';
    const h = document.createElement('h4');
    h.textContent = L('devices_title');
    box.appendChild(h);
    const scan = document.createElement('button');
    scan.type = 'button';
    scan.className = 'act scanbtn';
    setContent(scan, 'scan', this._scanned ? L('rescan') : L('scan'), 16);
    scan.addEventListener('click', () => { this._scanned = this._scanStates(); this._render(); });
    box.appendChild(scan);
    if (!this._scanned) {
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = L('scan_hint');
      box.appendChild(hint);
      return box;
    }
    const res = this._scanned;
    const count = document.createElement('div');
    count.className = 'count';
    count.textContent = L('found').replace('{n}', String(res.total));
    if (this._config.rooms.length) {
      const auto = document.createElement('button');
      auto.type = 'button';
      auto.className = 'act autobtn';
      setContent(auto, 'pin', L('auto_place'), 16);
      auto.addEventListener('click', () => {
        const all = GROUP_ORDER.flatMap((g) => res.groups[g] || []);
        const added = autoPlace(this._config.rooms, all, this._config.buttons);
        this._scanMsg = added.length ? L('auto_placed').replace('{n}', String(added.length)) : L('auto_none');
        if (added.length) {
          this._config.buttons.push(...added);
          this._sel = -1;
          this._selRoom = -1;
          this._fire();
        }
        this._render();
      });
      box.appendChild(count);
      box.appendChild(auto);
      if (this._scanMsg) {
        const msg = document.createElement('div');
        msg.className = 'msg';
        msg.setAttribute('aria-live', 'polite');
        msg.textContent = this._scanMsg;
        box.appendChild(msg);
      }
    } else {
      box.appendChild(count);
    }
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = L('search');
    search.value = this._search;
    const list = document.createElement('div');
    list.className = 'list';
    const fill = () => {
      list.textContent = '';
      const placed = new Set(this._config.buttons.map((b) => b.entity));
      const q = this._search.trim().toLowerCase();
      GROUP_ORDER.forEach((g) => {
        const items = (res.groups[g] || []).filter((d) => !q || d.id.toLowerCase().includes(q)
          || d.name.toLowerCase().includes(q) || d.area.toLowerCase().includes(q));
        if (!items.length) return;
        const gh = document.createElement('div');
        gh.className = 'grp';
        gh.textContent = `${L(`g_${g}`)} (${items.length})`;
        list.appendChild(gh);
        const chips = document.createElement('div');
        chips.className = 'chips';
        items.forEach((d) => chips.appendChild(this._chip(d.id, d.name, placed.has(d.id), d.area)));
        list.appendChild(chips);
      });
    };
    search.addEventListener('input', () => { this._search = search.value; fill(); });
    box.appendChild(search);
    box.appendChild(list);
    fill();
    return box;
  }

  /** The scenes and scripts shown as buttons next to the plan. */
  _presetList(L) {
    const box = document.createElement('div');
    box.className = 'plist';
    const h = document.createElement('h4');
    h.textContent = L('presets_editor');
    box.appendChild(h);
    let any = false;
    this._config.buttons.forEach((b, i) => {
      if (!isPreset(b.entity)) return;
      any = true;
      const row = document.createElement('div');
      row.className = `pi${i === this._sel ? ' selected' : ''}`;
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      const ic = iconEl(b.entity.startsWith('script.') ? 'play' : 'star', 16);
      if (ic) row.appendChild(ic);
      const name = document.createElement('span');
      name.textContent = this._boxLabel(b);
      row.appendChild(name);
      const del = document.createElement('button');
      del.type = 'button';
      setContent(del, 'close', '', 16);
      del.title = L('p_remove');
      del.setAttribute('aria-label', `${L('p_remove')}: ${name.textContent}`);
      del.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this._config.buttons.splice(i, 1);
        this._sel = -1;
        this._fire();
        this._render();
      });
      row.appendChild(del);
      const pick = () => { this._sel = this._sel === i ? -1 : i; this._selRoom = -1; this._render(); };
      row.addEventListener('click', pick);
      row.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(); } });
      box.appendChild(row);
    });
    if (!any) {
      const none = document.createElement('div');
      none.className = 'none';
      none.textContent = L('presets_none');
      box.appendChild(none);
    }
    return box;
  }

  /** Read every placeable device from the live Home Assistant data (the 'scan'). */
  _scanStates() {
    const h = this._hass || {};
    return scanDevices(h.states, h.entities, h.devices, h.areas);
  }

  _chip(entityId, name, placed, area) {
    const L = (k) => t(this._lang(), k);
    const chip = document.createElement('div');
    chip.className = `chip${placed ? ' placed' : ''}`;
    chip.textContent = name;
    chip.title = entityId;
    if (area) {
      const ar = document.createElement('span');
      ar.className = 'ar';
      ar.textContent = area;
      chip.appendChild(ar);
    }
    if (placed) {
      const s = document.createElement('small');
      s.textContent = `(${L('placed')})`;
      chip.appendChild(s);
    }
    // Pointer-based drag so it works with mouse, pen and touch (HTML5 drag-and-drop does not work on touch).
    chip.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      chip.setPointerCapture(ev.pointerId);
      const ghost = document.createElement('div');
      ghost.className = 'ghost';
      ghost.textContent = name;
      this.shadowRoot.appendChild(ghost);
      const pos = (e) => { ghost.style.left = `${e.clientX}px`; ghost.style.top = `${e.clientY}px`; };
      pos(ev);
      const inside = (e, r) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      const over = (e) => inside(e, this._wrap.getBoundingClientRect()) && inside(e, this._stage.getBoundingClientRect());
      // Auto-scroll the surrounding page/dialog when the pointer nears its edges.
      const scroller = scrollParent(chip);
      let lastY = ev.clientY;
      const tick = setInterval(() => {
        if (!scroller) return;
        const r = scroller === document.scrollingElement
          ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
        const edge = 70;
        if (lastY < r.top + edge) scroller.scrollTop -= 18;
        else if (lastY > r.bottom - edge) scroller.scrollTop += 18;
      }, 30);
      const move = (e) => { lastY = e.clientY; pos(e); this._stage.classList.toggle('drop', over(e)); };
      const end = (e, cancelled) => {
        clearInterval(tick);
        chip.removeEventListener('pointermove', move);
        chip.removeEventListener('pointerup', onUp);
        chip.removeEventListener('pointercancel', onCancel);
        ghost.remove();
        this._stage.classList.remove('drop');
        if (!cancelled && isPreset(entityId)) {
          if (!placedAt(this._config.buttons, entityId).length) {
            this._config.buttons.push({ entity: entityId, style: 'label', x: 0, y: 0, w: 8, h: 3 });
            this._fire();
          }
          this._render();
          return;
        }
        if (cancelled || !over(e)) return;
        const r = this._stage.getBoundingClientRect();
        const rect = dropRect(e.clientX, e.clientY, { left: r.left, top: r.top, width: r.width, height: r.height });
        if (!rect) return;
        const existing = placedAt(this._config.buttons, entityId);
        if (existing.length) {
          // one device = one place: move the existing item instead of adding a copy
          const ex = this._config.buttons[existing[0]];
          Object.assign(ex, clampRect({ ...ex, x: rect.x + rect.w / 2 - num(ex.w, 8) / 2, y: rect.y + rect.h / 2 - num(ex.h, 3) / 2 }));
          this._sel = existing[0];
          this._selRoom = -1;
          this._fire();
          this._render();
          return;
        }
        this._config.buttons.push({ entity: entityId, style: 'label', ...rect, ...(entityId.startsWith('light.') ? { sliders: true } : {}),
          ...(groupOf(entityId) === 'sensors' ? { tap_action: 'more-info' } : {}) });
        this._sel = this._config.buttons.length - 1;
        this._selRoom = -1;
        this._fire();
        this._render();
      };
      const onUp = (e) => end(e, false);
      const onCancel = (e) => end(e, true);
      chip.addEventListener('pointermove', move);
      chip.addEventListener('pointerup', onUp);
      chip.addEventListener('pointercancel', onCancel);
    });
    return chip;
  }

  _field(labelText, type, value, onChange, attrs = {}) {
    const row = document.createElement('div');
    row.className = 'row';
    const lab = document.createElement('label');
    lab.textContent = labelText;
    const input = document.createElement('input');
    input.type = type;
    input.value = value;
    if (type === 'number' && !attrs.step) input.step = '0.1';
    Object.entries(attrs).forEach(([k, v]) => input.setAttribute(k, v));
    input.addEventListener('change', () => onChange(input.value));
    lab.appendChild(input);
    row.appendChild(lab);
    return row;
  }

  _check(labelText, checked, onChange) {
    const row = document.createElement('div');
    row.className = 'row';
    const lab = document.createElement('label');
    lab.className = 'check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    lab.appendChild(input);
    lab.appendChild(document.createTextNode(labelText));
    row.appendChild(lab);
    return row;
  }

  _select(labelText, options, value, onChange) {
    const row = document.createElement('div');
    row.className = 'row';
    const lab = document.createElement('label');
    lab.textContent = labelText;
    const sel = document.createElement('select');
    options.forEach(([v, txt]) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = txt;
      if (v === value) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => onChange(sel.value));
    lab.appendChild(sel);
    row.appendChild(lab);
    return row;
  }

  _boxLabel(b) {
    const s = this._hass && b.entity && this._hass.states[b.entity];
    return b.label || (s && s.attributes.friendly_name) || b.entity || '?';
  }

  _place(el, r) {
    Object.assign(el.style, { left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` });
  }

  _box(b, i) {
    const el = document.createElement('div');
    const dup = b.entity && placedAt(this._config.buttons, b.entity).length > 1;
    el.className = `box${b.style === 'text' ? ' text' : ''}${i === this._sel ? ' selected' : ''}${dup ? ' dup' : ''}`;
    if (dup) el.title = t(this._lang(), 'dup_warn');
    el.dataset.i = String(i);
    el.tabIndex = 0;
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = this._boxLabel(b);
    el.appendChild(lbl);
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', this._boxLabel(b));
    el.setAttribute('aria-pressed', String(i === this._sel));
    const circ = isSensor(b.entity);
    const place = (r) => {
      if (circ) Object.assign(el.style, { left: `${r.x + r.w / 2}%`, top: `${r.y + r.h / 2}%` });
      else this._place(el, r);
    };
    if (circ) {
      el.classList.add('circ');
      el.title = this._boxLabel(b);
      const si = document.createElement('span');
      si.className = 'si';
      setContent(si, sensorIcon(this._hass && this._hass.states[b.entity], b.entity), '', 14);
      el.appendChild(si);
    }
    place(clampRect(b));
    if (!circ && normRotate(b.rotate)) el.style.setProperty('--rot', `${normRotate(b.rotate)}deg`);
    if (b.size) el.style.setProperty('--fs', String(b.size));
    if (b.color) el.style.setProperty('--tc', b.color);
    const grip = document.createElement('div');
    grip.className = 'grip';
    el.appendChild(grip);
    const rh = document.createElement('div');
    rh.className = 'rh';
    rh.title = t(this._lang(), 'rot_hint');
    el.appendChild(rh);

    el.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      const mode = ev.target === grip ? 'resize' : (ev.target === rh ? 'rotate' : 'move');
      const start = { ...clampRect(b), rotate: normRotate(b.rotate) };
      const sx = ev.clientX;
      const sy = ev.clientY;
      const rect = this._stage.getBoundingClientRect();
      const br = el.getBoundingClientRect();
      const cx = br.left + br.width / 2;
      const cy = br.top + br.height / 2;
      const rad = (start.rotate * Math.PI) / 180;
      let cur = { ...start };
      let moved = false;
      el.setPointerCapture(ev.pointerId);
      const move = (e) => {
        let mx = e.clientX - sx;
        let my = e.clientY - sy;
        if (!moved && Math.hypot(mx, my) < 3) return;
        moved = true;
        if (mode === 'rotate') {
          cur = { ...start, rotate: angleTo(cx, cy, e.clientX, e.clientY, e.shiftKey ? 15 : 0) };
          el.style.setProperty('--rot', `${cur.rotate}deg`);
          return;
        }
        if (mode === 'resize' && rad) {
          const c = Math.cos(rad);
          const s2 = Math.sin(rad);
          [mx, my] = [mx * c + my * s2, -mx * s2 + my * c];
        }
        const d = pxToPct(mx, my, rect.width, rect.height);
        cur = mode === 'move'
          ? { ...clampRect({ ...start, x: start.x + d.dx, y: start.y + d.dy }), rotate: start.rotate }
          : { ...clampRect({ ...start, w: start.w + d.dx, h: start.h + d.dy }), rotate: start.rotate };
        place(cur);
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        if (!moved) {
          // a plain click toggles the item's details
          this._sel = this._sel === i ? -1 : i;
          this._selRoom = -1;
          this._render();
          return;
        }
        Object.assign(b, { x: cur.x, y: cur.y, w: cur.w, h: cur.h, rotate: cur.rotate });
        this._sel = i;
        this._selRoom = -1;
        this._fire();
        this._render();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
    el.addEventListener('keydown', (ev) => {
      const step = 0.5;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[ev.key]) {
        ev.preventDefault();
        const [dx, dy] = moves[ev.key];
        Object.assign(b, ev.shiftKey ? clampRect({ ...b, w: b.w + dx, h: b.h + dy }) : clampRect({ ...b, x: b.x + dx, y: b.y + dy }));
        this._sel = i;
        this._fire();
        this._render();
        this.shadowRoot.querySelector(`.box[data-i="${i}"]`)?.focus();
      } else if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        this._sel = this._sel === i ? -1 : i;
        this._render();
        this.shadowRoot.querySelector(`.box[data-i="${i}"]`)?.focus();
      } else if (ev.key === 'Escape') {
        this._sel = -1;
        this._render();
      } else if ((ev.key === 'Delete' || ev.key === 'Backspace') && this._sel === i) {
        ev.preventDefault();
        this._removeSelected();
      }
    });
    return el;
  }

  _partBox(r, i, q, k) {
    const el = document.createElement('div');
    el.className = `rbox${i === this._selRoom ? ' selected' : ''}`;
    el.tabIndex = k === 0 ? 0 : -1;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `${r.name || ''}${r.parts.length > 1 ? ` (${k + 1}/${r.parts.length})` : ''}`);
    el.setAttribute('aria-pressed', String(i === this._selRoom));
    this._place(el, q);
    if (k === 0) {
      const name = document.createElement('span');
      name.className = 'rn';
      name.textContent = r.name || '';
      el.appendChild(name);
    }
    ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].forEach((edge) => {
      const h = document.createElement('div');
      h.className = `eh ${edge}`;
      h.dataset.edge = edge;
      el.appendChild(h);
    });
    el.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      const edge = ev.target.dataset && ev.target.dataset.edge;
      const start = { ...q };
      const sx = ev.clientX;
      const sy = ev.clientY;
      const rect = this._stage.getBoundingClientRect();
      let cur = start;
      let moved = false;
      el.setPointerCapture(ev.pointerId);
      const move = (e) => {
        const mx = e.clientX - sx;
        const my = e.clientY - sy;
        if (!moved && Math.hypot(mx, my) < 3) return;
        moved = true;
        const d = pxToPct(mx, my, rect.width, rect.height);
        cur = edge ? resizeEdge(start, edge, d.dx, d.dy) : clampRect({ ...start, x: start.x + d.dx, y: start.y + d.dy });
        this._place(el, cur);
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        if (!moved) {
          this._selRoom = this._selRoom === i ? -1 : i;
          this._sel = -1;
          this._render();
          return;
        }
        r.parts[k] = cur;
        this._selRoom = i;
        this._sel = -1;
        this._fire();
        this._render();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); this._selRoom = this._selRoom === i ? -1 : i; this._sel = -1; this._render(); }
      if (ev.key === 'Escape') { this._selRoom = -1; this._render(); }
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && this._selRoom === i) { ev.preventDefault(); this._removeSelected(); }
    });
    return el;
  }

  /** '+' buttons where the selected room touches another room; a click joins them. */
  _mergeButtons(stage) {
    const i = this._selRoom;
    const rooms = this._config.rooms;
    if (i < 0 || !rooms[i]) return;
    const L = (k) => t(this._lang(), k);
    rooms.forEach((other, j) => {
      if (j === i) return;
      let at = null;
      rooms[i].parts.some((a) => other.parts.some((b) => { at = sharedEdge(a, b); return !!at; }));
      if (!at) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'merge';
      btn.textContent = '+';
      btn.title = `${L('join')} ${other.name || ''}`;
      btn.setAttribute('aria-label', btn.title);
      btn.style.left = `${at.x}%`;
      btn.style.top = `${at.y}%`;
      btn.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this._config.rooms = mergeRooms(rooms, i, j).map((r) => ({ name: r.name || '', parts: roomParts(r) }));
        this._selRoom = j < i ? i - 1 : i;
        this._fire();
        this._render();
      });
      stage.appendChild(btn);
    });
  }

  _roomPanel(L) {
    const r = this._config.rooms[this._selRoom];
    const panel = document.createElement('div');
    panel.className = 'panel';
    const h = document.createElement('h4');
    h.textContent = `${L('in_room')}: ${r.name || ''}`;
    panel.appendChild(h);
    panel.appendChild(this._field(L('room_name'), 'text', r.name || '', (v) => { r.name = v; this._fire(); this._render(); }));
    const mem = roomMembers(this._config.rooms, this._config.buttons)[this._selRoom];
    const names = mem.map((e) => {
      const b = this._config.buttons.find((x) => x.entity === e) || {};
      return this._boxLabel({ ...b, entity: e });
    });
    const m = document.createElement('div');
    m.className = 'hint';
    m.textContent = `${L('members')}: ${names.length ? names.join(', ') : '–'}`;
    panel.appendChild(m);
    // the parts this room is made of
    const pl = document.createElement('div');
    pl.className = 'parts';
    const ph = document.createElement('b');
    ph.textContent = `${L('parts')}: ${r.parts.length}`;
    pl.appendChild(ph);
    r.parts.forEach((q, k) => {
      const row = document.createElement('div');
      row.className = 'prow';
      const tx = document.createElement('span');
      tx.textContent = `${L('part')} ${k + 1}: x ${q.x} · y ${q.y} · ${q.w} × ${q.h} %`;
      row.appendChild(tx);
      if (r.parts.length > 1) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'act danger';
        del.textContent = L('del_part');
        del.addEventListener('click', () => { r.parts.splice(k, 1); this._fire(); this._render(); });
        row.appendChild(del);
      }
      pl.appendChild(row);
    });
    const addp = document.createElement('button');
    addp.type = 'button';
    addp.className = 'act';
    addp.textContent = L('add_part');
    addp.addEventListener('click', () => {
      const last = r.parts[r.parts.length - 1];
      r.parts.push(clampRect({ x: last.x + last.w, y: last.y, w: Math.max(5, last.w / 2), h: last.h }));
      this._fire();
      this._render();
    });
    pl.appendChild(addp);
    panel.appendChild(pl);
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = `${L('join_hint')} ${L('room_hint')}`;
    panel.appendChild(hint);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'act danger';
    del.textContent = L('remove');
    del.addEventListener('click', () => {
      this._config.rooms.splice(this._selRoom, 1);
      this._selRoom = -1;
      this._fire();
      this._render();
    });
    panel.appendChild(del);
    return panel;
  }

  _panel(L) {
    if (this._selRoom >= 0 && this._config.rooms[this._selRoom]) return this._roomPanel(L);
    const b = this._config.buttons[this._sel];
    if (!b) {
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = L('select_hint');
      return hint;
    }
    const panel = document.createElement('div');
    panel.className = 'panel';
    const h = document.createElement('h4');
    h.textContent = this._boxLabel(b);
    panel.appendChild(h);
    const device = this._isDevice(b);
    const others = device ? placedAt(this._config.buttons, b.entity).filter((k) => k !== this._sel) : [];
    if (others.length) {
      const w = document.createElement('div');
      w.className = 'warnbox';
      const where = others.map((k) => {
        const ri = roomOf(this._config.rooms, clampRect(this._config.buttons[k]));
        return ri >= 0 ? this._config.rooms[ri].name : L('no_room');
      }).join(', ');
      setContent(w, 'warn', `${L('dup_warn')} (${where})`, 16);
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'act danger';
      rm.textContent = L('dup_remove');
      rm.addEventListener('click', () => {
        const keep = this._config.buttons[this._sel];
        this._config.buttons = this._config.buttons.filter((x, k) => !others.includes(k));
        this._sel = this._config.buttons.indexOf(keep);
        this._fire();
        this._render();
      });
      w.appendChild(document.createElement('br'));
      w.appendChild(rm);
      panel.appendChild(w);
    }
    if (device && this._config.rooms.length) {
      const ri = roomOf(this._config.rooms, clampRect(b));
      const rr = document.createElement('div');
      rr.className = 'hint';
      rr.textContent = `${L('in_room')}: ${ri >= 0 ? this._config.rooms[ri].name : L('no_room')}`;
      panel.appendChild(rr);
    }
    if (device) {
      const entRow = document.createElement('div');
      entRow.className = 'row';
      const entLab = document.createElement('label');
      entLab.textContent = L('entity');
      entRow.appendChild(entLab);
      // Own searchable field (input + datalist). HA's ha-entity-picker is internal and
      // rendered empty when created from a custom card editor (HA 2026.11), so it is not used.
      const input = document.createElement('input');
      input.type = 'text';
      input.value = b.entity || '';
      input.placeholder = 'light.…';
      input.setAttribute('list', 'gh-entities');
      input.autocomplete = 'off';
      const list = document.createElement('datalist');
      list.id = 'gh-entities';
      const states = (this._hass && this._hass.states) || {};
      Object.keys(states).sort().forEach((id) => {
        const o = document.createElement('option');
        o.value = id;
        o.label = states[id].attributes.friendly_name || id;
        list.appendChild(o);
      });
      input.addEventListener('change', () => { b.entity = input.value.trim(); this._fire(); this._render(); });
      entLab.appendChild(input);
      entRow.appendChild(list);
      panel.appendChild(entRow);
    }
    panel.appendChild(this._field(device ? L('label') : L('text'), 'text', b.label || '', (v) => { b.label = v; this._fire(); this._render(); }));
    // sensors (round icons) and scenes (preset buttons) have no style, size, rotation or box to edit
    const simple = isSensor(b.entity) || isPreset(b.entity);
    if (!simple) {
    const styles = device
      ? [['label', L('st_label')], ['hotspot', L('st_hotspot')], ['text', L('st_text')]]
      : [['text', L('st_text')], ['label', L('st_label')]];
    const g = document.createElement('div');
    g.className = 'grid2';
    g.appendChild(this._select(L('style'), styles, b.style || 'label', (v) => { b.style = v; this._fire(); this._render(); }));
    if (device) {
      g.appendChild(this._select(L('tap'), TAP_ACTIONS.map((a) => [a, L(`tap_${a}`)]), b.tap_action || 'toggle',
        (v) => { b.tap_action = v; this._fire(); }));
    } else {
      g.appendChild(this._field(L('color_txt'), 'color', b.color || '#1d2330', (v) => { b.color = v; this._fire(); this._render(); }));
    }
    panel.appendChild(g);
    if (device && String(b.entity).startsWith('light.')) {
      panel.appendChild(this._check(L('sliders_opt'), b.sliders === true, (v) => { b.sliders = v; this._fire(); }));
    }
    const g2 = document.createElement('div');
    g2.className = 'grid2';
    g2.appendChild(this._field(L('size'), 'number', String(b.size || 0.95), (v) => { b.size = clamp(num(v, 0.95), 0.3, 10); this._fire(); this._render(); },
      { step: '0.1', min: '0.3', max: '10' }));
    g2.appendChild(this._field(L('rotate'), 'number', String(normRotate(b.rotate)), (v) => { b.rotate = normRotate(v); this._fire(); this._render(); },
      { step: '1' }));
    panel.appendChild(g2);
    const rh = document.createElement('div');
    rh.className = 'hint';
    rh.textContent = L('rot_hint');
    panel.appendChild(rh);
    const nums = document.createElement('div');
    nums.className = 'nums';
    ['x', 'y', 'w', 'h'].forEach((k) => {
      nums.appendChild(this._field(`${k} %`, 'number', String(clampRect(b)[k]), (v) => {
        Object.assign(b, clampRect({ ...b, [k]: Number(v) }));
        this._fire();
        this._render();
      }));
    });
    panel.appendChild(nums);
    }
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'act danger';
    del.textContent = L('remove');
    del.addEventListener('click', () => {
      this._config.buttons.splice(this._sel, 1);
      this._sel = -1;
      this._fire();
      this._render();
    });
    panel.appendChild(del);
    return panel;
  }
}

// --------------------------------------------------------------- register --

if (typeof customElements !== 'undefined') {
  if (!customElements.get('gh-dash-card')) customElements.define('gh-dash-card', GhDashCard);
  if (!customElements.get('gh-dash-card-editor')) customElements.define('gh-dash-card-editor', GhDashCardEditor);
  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c.type === 'gh-dash-card')) {
    window.customCards.push({
      type: 'gh-dash-card',
      name: 'GH-Dash floor plan',
      description: 'Floor plan with buttons that turn things on and off and glow when on.',
      preview: false,
    });
  }
  console.info(`%c GH-DASH-CARD %c ${VERSION} `, 'background:#2a78d6;color:#fff;border-radius:3px 0 0 3px', 'background:#333;color:#fff;border-radius:0 3px 3px 0');
}
