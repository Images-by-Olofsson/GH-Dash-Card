import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeConfig, isOn, isUnavailable, glowColor, toggleCall, clampRect, pxToPct, t,
  clampZoom, dropRect, resolveTheme, groupOf, fitZoom, replaceCard,
  normRotate, lightCaps, brightnessPct, hueOf, lightCall, angleTo, roomOf, roomMembers,
  roomParts, sharedEdge, mergeRooms, resizeEdge, placedAt, fitFont, haSummary, fmtBytes, starterConfig,
  scanDevices, roomCall, allOffTargets, sensorText, autoPlace, mediaInfo, pushHistory,
  isPreset, isSensor, sensorIcon, allOnTargets,
  wheelSteps, pinchZoom, clampPct, glowStrength, glowMix, COLOR_KEYS,
} from '../dist/gh-dash.js';

const S = (entity_id, state, attributes = {}) => ({ entity_id, state, attributes });

test('roomCall: turn off everything controllable, turn on only lights', () => {
  const ids = ['light.a', 'switch.b', 'media_player.tv', 'sensor.t', 'binary_sensor.d', 'scene.film', 'fan.f'];
  assert.deepEqual(roomCall(ids, 'off'), { domain: 'homeassistant', service: 'turn_off',
    data: { entity_id: ['light.a', 'switch.b', 'media_player.tv', 'fan.f'] } });
  assert.deepEqual(roomCall(ids, 'on'), { domain: 'light', service: 'turn_on', data: { entity_id: ['light.a'] } });
  assert.equal(roomCall(['sensor.t'], 'off'), null);
});

test('allOffTargets: every placed device that can be turned off, once', () => {
  const buttons = [{ entity: 'light.a' }, { entity: 'light.a' }, { entity: 'switch.b' }, { label: 'text' },
    { entity: 'sensor.t' }, { entity: 'scene.x' }, { entity: 'input_boolean.y' }];
  assert.deepEqual(allOffTargets(buttons), ['light.a', 'switch.b', 'input_boolean.y']);
});

test('groupOf / scanDevices: sensors and scenes get their own groups; only useful sensors are listed', () => {
  assert.equal(groupOf('scene.film'), 'scenes');
  assert.equal(groupOf('script.godnatt'), 'scenes');
  assert.equal(groupOf('binary_sensor.door'), 'sensors');
  const states = {
    'sensor.temp': S('sensor.temp', '21.5', { device_class: 'temperature', unit_of_measurement: '°C', friendly_name: 'Temp' }),
    'sensor.hum': S('sensor.hum', '45', { device_class: 'humidity', unit_of_measurement: '%', friendly_name: 'Fukt' }),
    'sensor.power': S('sensor.power', '3', { device_class: 'power', friendly_name: 'Effekt' }),
    'binary_sensor.door': S('binary_sensor.door', 'off', { device_class: 'door', friendly_name: 'Ytterdörr' }),
    'binary_sensor.update': S('binary_sensor.update', 'off', { device_class: 'update', friendly_name: 'Upd' }),
    'scene.film': S('scene.film', 'scening', { friendly_name: 'Film' }),
  };
  const r = scanDevices(states, {}, {}, {});
  assert.deepEqual(r.groups.sensors.map((d) => d.id), ['sensor.hum', 'sensor.temp', 'binary_sensor.door'].sort((a, b) =>
    ({ 'sensor.hum': 'Fukt', 'sensor.temp': 'Temp', 'binary_sensor.door': 'Ytterdörr' })[a]
      .localeCompare(({ 'sensor.hum': 'Fukt', 'sensor.temp': 'Temp', 'binary_sensor.door': 'Ytterdörr' })[b])));
  assert.deepEqual(r.groups.scenes.map((d) => d.id), ['scene.film']);
  assert.equal(r.total, 4);
});

test('sensors: value text, binary sensors count as "on" when open/detected, scenes are activated', () => {
  assert.equal(sensorText(S('sensor.t', '21.46', { device_class: 'temperature', unit_of_measurement: '°C' }), 'sv'), '21,5 °C');
  assert.equal(sensorText(S('sensor.t', '21.46', { device_class: 'temperature', unit_of_measurement: '°C' }), 'en'), '21.5 °C');
  assert.equal(sensorText(S('sensor.h', '45', { device_class: 'humidity', unit_of_measurement: '%' }), 'sv'), '45 %');
  assert.equal(sensorText(S('sensor.h', 'unavailable', {}), 'sv'), '–');
  assert.equal(isOn(S('binary_sensor.door', 'on', { device_class: 'door' })), true);
  assert.deepEqual(toggleCall('scene.film'), { domain: 'scene', service: 'turn_on', data: { entity_id: 'scene.film' } });
  assert.deepEqual(toggleCall('script.godnatt'), { domain: 'script', service: 'turn_on', data: { entity_id: 'script.godnatt' } });
});

test('autoPlace: devices whose HA area matches a room name are placed inside that room', () => {
  const rooms = [{ name: 'Sovrum 3', x: 40, y: 20, w: 20, h: 20 }, { name: 'Kök', parts: [{ x: 70, y: 20, w: 10, h: 10 }] }];
  const devices = [
    { id: 'light.a', name: 'A', area: 'sovrum 3' },   // case-insensitive
    { id: 'light.b', name: 'B', area: 'Sovrum 3' },
    { id: 'light.c', name: 'C', area: 'Kök' },
    { id: 'light.d', name: 'D', area: 'Garage' },     // no such room
    { id: 'light.e', name: 'E', area: 'Kök' },        // already placed -> skipped
  ];
  const added = autoPlace(rooms, devices, [{ entity: 'light.e', x: 1, y: 1, w: 8, h: 3 }]);
  assert.deepEqual(added.map((b) => b.entity), ['light.a', 'light.b', 'light.c']);
  added.forEach((b) => assert.ok(roomOf(rooms, b) >= 0, `${b.entity} inside a room`));
  assert.equal(roomOf(rooms, added[0]), 0);
  assert.equal(roomOf(rooms, added[2]), 1);
  assert.notDeepEqual([added[0].x, added[0].y], [added[1].x, added[1].y]); // not on top of each other
});

test('mediaInfo: title, artist, volume and which controls the player supports', () => {
  const tv = S('media_player.tv', 'playing', { media_title: 'Nyheterna', media_artist: 'SVT', volume_level: 0.35,
    entity_picture: '/api/media_player_proxy/media_player.tv?token=x', supported_features: 1 | 4 | 16 | 32 | 16384 });
  assert.deepEqual(mediaInfo(tv), { title: 'Nyheterna', artist: 'SVT', picture: '/api/media_player_proxy/media_player.tv?token=x',
    volume: 35, playing: true, canPlayPause: true, canVolume: true, canPrev: true, canNext: true });
  const plain = mediaInfo(S('media_player.x', 'off', { supported_features: 256 }));
  assert.equal(plain.canPlayPause || plain.canVolume || plain.canPrev || plain.canNext, false);
});

test('a scene that has never been activated ("unknown") can still be used', () => {
  assert.equal(isUnavailable(S('scene.film', 'unknown')), false);
  assert.equal(isUnavailable(S('script.x', 'unknown')), false);
  assert.equal(isUnavailable(S('scene.film', 'unavailable')), true);
  assert.equal(isUnavailable(S('light.a', 'unknown')), true);
});

test('pushHistory keeps the last N snapshots', () => {
  let h = [];
  for (let i = 0; i < 60; i += 1) h = pushHistory(h, `s${i}`, 50);
  assert.equal(h.length, 50);
  assert.equal(h[0], 's10');
  assert.equal(h[49], 's59');
  assert.deepEqual(pushHistory(['a'], 'a', 50), ['a']); // same as the last one: not added twice
});

test('scanDevices groups the devices Home Assistant has, with their area, skipping hidden ones', () => {
  const st = (id, name) => [id, { entity_id: id, state: 'off', attributes: { friendly_name: name } }];
  const states = Object.fromEntries([
    st('light.b', 'Bordslampa'), st('light.a', 'Arbetslampa'), st('switch.plug', 'Uttag'),
    st('media_player.tv', 'TV'), st('fan.f', 'Fläkt'), st('sensor.temp', 'Temp'), st('input_boolean.hidden', 'Dold'),
  ]);
  const entities = {
    'light.a': { area_id: 'kok' },
    'light.b': { device_id: 'dev1' },
    'input_boolean.hidden': { hidden: true },
  };
  const devices = { dev1: { area_id: 'vardagsrum' } };
  const areas = { kok: { name: 'Kök' }, vardagsrum: { name: 'Vardagsrum' } };
  const r = scanDevices(states, entities, devices, areas);
  assert.equal(r.total, 5);                                   // sensor and hidden helper are not devices to place
  assert.deepEqual(r.groups.lights, [
    { id: 'light.a', name: 'Arbetslampa', area: 'Kök' },      // area on the entity
    { id: 'light.b', name: 'Bordslampa', area: 'Vardagsrum' }, // area via its device
  ]);
  assert.deepEqual(r.groups.switches.map((d) => d.id), ['switch.plug']);
  assert.deepEqual(r.groups.media.map((d) => d.id), ['media_player.tv']);
  assert.deepEqual(r.groups.other.map((d) => d.id), ['fan.f']);
  assert.equal(scanDevices({}, {}, {}, {}).total, 0);
});

test('starterConfig: plan + rooms + Console info, and no devices at all', () => {
  const c = starterConfig('/local/community/GH-Dash/plan.png');
  assert.equal(c.type, 'custom:gh-dash-card');
  assert.equal(c.image, '/local/community/GH-Dash/plan.png');
  assert.equal(JSON.stringify(c).includes('entity'), false);           // no test devices
  assert.deepEqual(c.rooms.map((r) => r.name).sort(),
    ['Bad', 'Balkong', 'Hall', 'Kök', 'Sovrum 1', 'Sovrum 2', 'Sovrum 3', 'Vardagsrum', 'WC'].sort());
  assert.equal(c.buttons.length, 1);
  assert.equal(c.buttons[0].tap_action, 'ha-info');
  assert.doesNotThrow(() => normalizeConfig(c));
  assert.deepEqual(starterConfig('').buttons, []);                      // no bundled plan: empty card
});

test('haSummary counts entities, lights on, unavailable and pending updates', () => {
  const st = (id, state, attributes = {}) => [id, { entity_id: id, state, attributes }];
  const states = Object.fromEntries([
    st('light.a', 'on'), st('light.b', 'off'), st('light.c', 'unavailable'),
    st('switch.x', 'on'), st('sensor.t', 'unknown'),
    st('update.core', 'on', { friendly_name: 'Home Assistant Core', latest_version: '2026.12.0' }),
    st('update.os', 'off', { friendly_name: 'Home Assistant OS' }),
  ]);
  assert.deepEqual(haSummary(states), {
    entities: 7, lightsOn: 1, lightsTotal: 3, unavailable: 2,
    updates: [{ name: 'Home Assistant Core', version: '2026.12.0' }],
  });
  assert.deepEqual(haSummary({}), { entities: 0, lightsOn: 0, lightsTotal: 0, unavailable: 0, updates: [] });
});

test('fmtBytes / GB values for disk usage', () => {
  assert.equal(fmtBytes(32), '32 GB');
  assert.equal(fmtBytes(5.43), '5.4 GB');
  assert.equal(fmtBytes(undefined), '–');
});

test('normalizeConfig accepts tap_action ha-info', () => {
  assert.equal(normalizeConfig({ image: '/x.png', buttons: [{ label: 'Console', tap_action: 'ha-info' }] }).buttons[0].tap_action, 'ha-info');
});

test('fitFont: text shrinks to fit a small box, never above the normal size', () => {
  assert.equal(fitFont('TV', 200, 100, 12), 12);                  // big box: normal size
  const f = fitFont('Spelbordlampa', 37, 25, 12);                 // long word in a small box: smaller (2 lines if that is bigger)
  assert.ok(f < 12 && f >= 4, `got ${f}`);
  assert.ok(fitFont('Köksbelysning bänk', 66, 30, 12) > fitFont('Köksbelysning bänk', 66, 12, 12)); // 2 lines when tall enough
  assert.equal(fitFont('x', 1, 1, 12), 4);                        // never below 4 px
});

test('placedAt: where a device is on the plan (to avoid placing it twice)', () => {
  const buttons = [{ entity: 'light.a' }, { entity: 'media_player.tv' }, { label: 'text' }, { entity: 'media_player.tv' }, { entity: '' }];
  assert.deepEqual(placedAt(buttons, 'media_player.tv'), [1, 3]);
  assert.deepEqual(placedAt(buttons, 'light.a'), [0]);
  assert.deepEqual(placedAt(buttons, 'light.none'), []);
  assert.deepEqual(placedAt(buttons, ''), []);
});

test('roomParts: a plain room is one part; parts are kept', () => {
  assert.deepEqual(roomParts({ name: 'A', x: 1, y: 2, w: 3, h: 4 }), [{ x: 1, y: 2, w: 3, h: 4 }]);
  assert.deepEqual(roomParts({ name: 'A', parts: [{ x: 1, y: 2, w: 3, h: 4 }, { x: 4, y: 2, w: 2, h: 9 }] }).length, 2);
});

test('roomOf / roomMembers with an L-shaped room made of two parts', () => {
  const hall = { name: 'Hall', parts: [{ x: 40, y: 40, w: 30, h: 10 }, { x: 40, y: 50, w: 10, h: 30 }] };
  const rooms = [hall, { name: 'Vardagsrum', x: 60, y: 55, w: 30, h: 30 }];
  assert.equal(roomOf(rooms, { x: 42, y: 70, w: 4, h: 3 }), 0);   // in the corridor part
  assert.equal(roomOf(rooms, { x: 75, y: 70, w: 4, h: 3 }), 1);
  assert.deepEqual(roomMembers(rooms, [{ entity: 'switch.console', x: 42, y: 70, w: 4, h: 3 }]), [['switch.console'], []]);
});

test('sharedEdge: a point on the common border of two touching boxes, else null', () => {
  assert.deepEqual(sharedEdge({ x: 10, y: 10, w: 20, h: 20 }, { x: 30, y: 15, w: 10, h: 30 }), { x: 30, y: 22.5 }); // side by side
  assert.deepEqual(sharedEdge({ x: 10, y: 10, w: 20, h: 20 }, { x: 15, y: 30.8, w: 10, h: 5 }), { x: 20, y: 30.4 }); // above/below, 0.8 % gap
  assert.equal(sharedEdge({ x: 10, y: 10, w: 20, h: 20 }, { x: 50, y: 10, w: 10, h: 10 }), null);              // far apart
  assert.equal(sharedEdge({ x: 10, y: 10, w: 20, h: 20 }, { x: 30, y: 40, w: 10, h: 10 }), null);              // only a corner
});

test('mergeRooms: room j becomes parts of room i', () => {
  const rooms = [{ name: 'Hall', x: 40, y: 40, w: 30, h: 10 }, { name: 'Kök', x: 0, y: 0, w: 5, h: 5 }, { name: 'Hall 2', x: 40, y: 50, w: 10, h: 30 }];
  const out = mergeRooms(rooms, 0, 2);
  assert.equal(out.length, 2);
  assert.equal(out[0].name, 'Hall');
  assert.deepEqual(out[0].parts, [{ x: 40, y: 40, w: 30, h: 10 }, { x: 40, y: 50, w: 10, h: 30 }]);
  assert.equal(out[1].name, 'Kök');
});

test('resizeEdge drags one side (or a corner) of a box', () => {
  const r = { x: 10, y: 10, w: 20, h: 20 };
  assert.deepEqual(resizeEdge(r, 'e', 5, 0), { x: 10, y: 10, w: 25, h: 20 });
  assert.deepEqual(resizeEdge(r, 'w', 5, 0), { x: 15, y: 10, w: 15, h: 20 });
  assert.deepEqual(resizeEdge(r, 'n', 0, -4), { x: 10, y: 6, w: 20, h: 24 });
  assert.deepEqual(resizeEdge(r, 'se', 2, 3), { x: 10, y: 10, w: 22, h: 23 });
  assert.deepEqual(resizeEdge(r, 'w', 30, 0), { x: 29, y: 10, w: 1, h: 20 }); // never smaller than 1
});

const ROOMS = [
  { name: 'Vardagsrum', x: 60, y: 50, w: 30, h: 30 },
  { name: 'Sovrum', x: 40, y: 20, w: 25, h: 20 },
  { name: 'Soffhörna', x: 70, y: 70, w: 10, h: 8 }, // small room inside Vardagsrum
];

test('roomOf: the room that contains the centre of a box (smallest wins)', () => {
  assert.equal(roomOf(ROOMS, { x: 50, y: 28, w: 4, h: 3 }), 1);   // centre 52,29.5 -> Sovrum
  assert.equal(roomOf(ROOMS, { x: 80, y: 55, w: 4, h: 4 }), 0);   // Vardagsrum
  assert.equal(roomOf(ROOMS, { x: 72, y: 72, w: 2, h: 2 }), 2);   // inside both -> the smaller Soffhörna
  assert.equal(roomOf(ROOMS, { x: 5, y: 5, w: 4, h: 3 }), -1);    // outside every room
  assert.equal(roomOf([], { x: 5, y: 5, w: 4, h: 3 }), -1);
});

test('roomMembers: devices follow their position; moving the TV moves it to the other room', () => {
  const tvInLiving = [{ entity: 'media_player.tv', x: 80, y: 55, w: 4, h: 4 }, { label: 'text only', x: 50, y: 28, w: 4, h: 3 }];
  assert.deepEqual(roomMembers(ROOMS, tvInLiving), [['media_player.tv'], [], []]);
  const tvInBedroom = [{ entity: 'media_player.tv', x: 50, y: 28, w: 4, h: 3 }];
  assert.deepEqual(roomMembers(ROOMS, tvInBedroom), [[], ['media_player.tv'], []]);
});

test('angleTo: handle above the centre = 0 deg, clockwise, optional step', () => {
  assert.equal(angleTo(100, 100, 100, 50), 0);     // straight up
  assert.equal(angleTo(100, 100, 150, 100), 90);   // right
  assert.equal(angleTo(100, 100, 100, 150), 180);  // down
  assert.equal(angleTo(100, 100, 50, 100), 270);   // left
  assert.equal(angleTo(100, 100, 150, 60), 51);    // free angle
  assert.equal(angleTo(100, 100, 150, 60, 15), 45); // Shift: 15 deg steps
  assert.equal(angleTo(100, 100, 152, 97), 90);    // within 4 deg of 90 snaps to 90
});

test('normalizeConfig: text items without a device, style text, size', () => {
  const c = normalizeConfig({ image: '/x.png', buttons: [{ label: 'Vardagsrum', style: 'text', size: '2', color: '#c00' }] });
  assert.equal(c.buttons[0].entity, undefined);
  assert.equal(c.buttons[0].style, 'text');
  assert.equal(c.buttons[0].size, 2);
  assert.equal(c.buttons[0].color, '#c00');
  assert.equal(normalizeConfig({ image: '/x.png', buttons: [{ label: 'A' }] }).buttons[0].size, undefined);
});

test('normRotate keeps degrees in 0..359', () => {
  assert.equal(normRotate(0), 0);
  assert.equal(normRotate(90), 90);
  assert.equal(normRotate(360), 0);
  assert.equal(normRotate(-90), 270);
  assert.equal(normRotate(450.6), 91);
  assert.equal(normRotate('180'), 180);
  assert.equal(normRotate(undefined), 0);
});

test('normalizeConfig: rotate and sliders defaults', () => {
  const c = normalizeConfig({ image: '/x.png', buttons: [{ entity: 'light.a', rotate: -90, sliders: true }, { entity: 'light.b' }] });
  assert.equal(c.buttons[0].rotate, 270);
  assert.equal(c.buttons[0].sliders, true);
  assert.equal(c.buttons[1].rotate, 0);
  assert.equal(c.buttons[1].sliders, false);
  assert.equal(normalizeConfig({ image: '/x.png', buttons: [{ entity: 'light.a', tap_action: 'sliders' }] }).buttons[0].tap_action, 'sliders');
});

test('lightCaps reads what a light supports', () => {
  const l = (modes, attrs = {}) => ({ entity_id: 'light.a', state: 'on', attributes: { supported_color_modes: modes, ...attrs } });
  assert.deepEqual(lightCaps(l(['onoff'])), { brightness: false, color: false, temp: false });
  assert.deepEqual(lightCaps(l(['brightness'])), { brightness: true, color: false, temp: false });
  assert.deepEqual(lightCaps(l(['color_temp', 'hs'])), { brightness: true, color: true, temp: true });
  assert.deepEqual(lightCaps(l(['rgbww'])), { brightness: true, color: true, temp: false });
  assert.deepEqual(lightCaps({ entity_id: 'switch.a', state: 'on', attributes: {} }), { brightness: false, color: false, temp: false });
  assert.deepEqual(lightCaps(undefined), { brightness: false, color: false, temp: false });
});

test('brightnessPct and hueOf read the current light', () => {
  assert.equal(brightnessPct({ entity_id: 'light.a', state: 'on', attributes: { brightness: 255 } }), 100);
  assert.equal(brightnessPct({ entity_id: 'light.a', state: 'on', attributes: { brightness: 128 } }), 50);
  assert.equal(brightnessPct({ entity_id: 'light.a', state: 'off', attributes: {} }), 0);
  assert.equal(hueOf({ entity_id: 'light.a', state: 'on', attributes: { hs_color: [210.4, 80] } }), 210);
  assert.equal(hueOf({ entity_id: 'light.a', state: 'on', attributes: {} }), null);
});

test('lightCall builds light.turn_on calls', () => {
  assert.deepEqual(lightCall('light.a', { brightness: 55 }),
    { domain: 'light', service: 'turn_on', data: { entity_id: 'light.a', brightness_pct: 55 } });
  assert.deepEqual(lightCall('light.a', { hue: 400 }),
    { domain: 'light', service: 'turn_on', data: { entity_id: 'light.a', hs_color: [40, 100] } });
  assert.deepEqual(lightCall('light.a', { kelvin: 2700 }),
    { domain: 'light', service: 'turn_on', data: { entity_id: 'light.a', color_temp_kelvin: 2700 } });
  assert.deepEqual(lightCall('light.a', { brightness: 0 }),
    { domain: 'light', service: 'turn_on', data: { entity_id: 'light.a', brightness_pct: 1 } });
});

test('fitZoom scales the plan so its whole height fits', () => {
  assert.equal(fitZoom(700, 1000, 1.4), 0.5);   // 1000 px wide plan is 1400 px tall -> half
  assert.equal(fitZoom(2000, 1000, 1.4), 1);    // already fits -> never above 100 %
  assert.equal(fitZoom(50, 1000, 1.4), 0.1);    // never below 10 %
  assert.equal(fitZoom(700, 0, 1.4), 1);        // not measured yet
  assert.equal(fitZoom(700, 1000, 0), 1);
});

test('replaceCard swaps exactly the matching card in a dashboard config', () => {
  const old = { type: 'custom:gh-dash-card', image: '/a.png', buttons: [] };
  const dash = { views: [{ cards: [{ type: 'markdown', content: 'x' },
    { type: 'vertical-stack', cards: [{ ...old }] }] }] };
  const neu = { ...old, buttons: [{ entity: 'light.a', x: 1, y: 2, w: 8, h: 3 }] };
  const r = replaceCard(dash, old, neu);
  assert.equal(r.found, true);
  assert.deepEqual(r.config.views[0].cards[1].cards[0], neu);
  assert.deepEqual(r.config.views[0].cards[0], { type: 'markdown', content: 'x' });
  assert.equal(replaceCard(dash, { ...old, image: '/other.png' }, neu).found, false);
});

test('normalizeConfig: fit defaults to true', () => {
  assert.equal(normalizeConfig({ image: '/x.png' }).fit, true);
  assert.equal(normalizeConfig({ image: '/x.png', fit: false }).fit, false);
});

test('clampZoom keeps 0.5..3 in 0.25 steps', () => {
  assert.equal(clampZoom(1), 1);
  assert.equal(clampZoom(5), 3);
  assert.equal(clampZoom(0.1), 0.5);
  assert.equal(clampZoom(1.3), 1.25);
  assert.equal(clampZoom('2'), 2);
  assert.equal(clampZoom(undefined), 1);
});

test('dropRect centres a new box on the drop point, inside the image', () => {
  const stage = { left: 100, top: 50, width: 1000, height: 500 };
  assert.deepEqual(dropRect(600, 300, stage), { x: 46, y: 48.5, w: 8, h: 3 });
  assert.deepEqual(dropRect(1095, 545, stage), { x: 92, y: 97, w: 8, h: 3 });
  assert.equal(dropRect(50, 300, stage), null); // dropped outside the plan
});

test('resolveTheme: stored choice wins, then config, auto follows HA', () => {
  assert.equal(resolveTheme('light', 'dark', false), 'dark');
  assert.equal(resolveTheme('dark', null, false), 'dark');
  assert.equal(resolveTheme('auto', null, true), 'dark');
  assert.equal(resolveTheme('auto', null, false), 'light');
  assert.equal(resolveTheme(undefined, 'bogus', false), 'light');
});

test('groupOf sorts devices into palette groups', () => {
  assert.equal(groupOf('light.a'), 'lights');
  assert.equal(groupOf('switch.plug'), 'switches');
  assert.equal(groupOf('input_boolean.x'), 'switches');
  assert.equal(groupOf('media_player.tv'), 'media');
  assert.equal(groupOf('fan.f'), 'other');
  assert.equal(groupOf('sensor.temp'), 'sensors');
  assert.equal(groupOf('lock.door'), null);
});

const st = (entity_id, state, attributes = {}) => ({ entity_id, state, attributes });

test('isOn: light on/off', () => {
  assert.equal(isOn(st('light.a', 'on')), true);
  assert.equal(isOn(st('light.a', 'off')), false);
});

test('isOn: media_player playing/idle on, standby/off not', () => {
  assert.equal(isOn(st('media_player.tv', 'playing')), true);
  assert.equal(isOn(st('media_player.tv', 'idle')), true);
  assert.equal(isOn(st('media_player.tv', 'standby')), false);
  assert.equal(isOn(st('media_player.tv', 'off')), false);
});

test('missing entity is unavailable', () => {
  assert.equal(isUnavailable(undefined), true);
  assert.equal(isUnavailable(st('light.a', 'unavailable')), true);
  assert.equal(isUnavailable(st('light.a', 'unknown')), true);
  assert.equal(isUnavailable(st('light.a', 'off')), false);
  assert.equal(isOn(undefined), false);
});

test('glow uses rgb_color', () => {
  assert.equal(glowColor(st('light.a', 'on', { rgb_color: [255, 120, 0] }), 'var(--x)'), 'rgb(255, 120, 0)');
});

test('glow falls back to accent', () => {
  assert.equal(glowColor(st('light.a', 'on'), 'var(--x)'), 'var(--x)');
  assert.equal(glowColor(st('switch.a', 'on', { rgb_color: [1, 2, 3] }), 'var(--x)'), 'var(--x)');
});

test('toggleCall: known domains and fallback', () => {
  assert.deepEqual(toggleCall('light.a'), { domain: 'light', service: 'toggle', data: { entity_id: 'light.a' } });
  assert.deepEqual(toggleCall('media_player.tv'), { domain: 'media_player', service: 'toggle', data: { entity_id: 'media_player.tv' } });
  assert.deepEqual(toggleCall('cover.x'), { domain: 'homeassistant', service: 'toggle', data: { entity_id: 'cover.x' } });
});

test('clampRect keeps box inside', () => {
  assert.deepEqual(clampRect({ x: 98, y: 50, w: 8, h: 3 }), { x: 92, y: 50, w: 8, h: 3 });
  assert.deepEqual(clampRect({ x: -4, y: -1.26, w: 0.2, h: 200 }), { x: 0, y: 0, w: 1, h: 100 });
  assert.deepEqual(clampRect({ x: 10.04, y: 20.06, w: 5, h: 5 }), { x: 10, y: 20.1, w: 5, h: 5 });
});

test('layout stays in percent', () => {
  assert.deepEqual(pxToPct(50, 20, 1000, 400), { dx: 5, dy: 5 });
  assert.deepEqual(pxToPct(10, 10, 0, 0), { dx: 0, dy: 0 });
});

test('normalizeConfig defaults', () => {
  const c = normalizeConfig({ image: '/x.png', buttons: [{ entity: 'light.a', x: '10', y: '20.5' }] });
  assert.deepEqual(c.buttons[0], { entity: 'light.a', x: 10, y: 20.5, w: 8, h: 3, style: 'label', tap_action: 'toggle', rotate: 0, sliders: false });
  assert.deepEqual(c.rooms, []);
  assert.equal(c.glow_color, 'auto');
  assert.throws(() => normalizeConfig({}), /image/);
  assert.throws(() => normalizeConfig({ image: '/x.png', buttons: [{ entity: 'light.a', style: 'big' }] }), /style/);
});

test('t: Swedish and English', () => {
  assert.equal(t('sv', 'on'), 'på');
  assert.equal(t('sv-SE', 'unavailable'), 'ej tillgänglig');
  assert.equal(t('en', 'on'), 'on');
  assert.equal(t('de', 'off'), 'off');
});

test('scenes and scripts are presets, sensors are sensors', () => {
  assert.equal(isPreset('scene.film'), true);
  assert.equal(isPreset('script.godnatt'), true);
  assert.equal(isPreset('light.a'), false);
  assert.equal(isPreset(undefined), false);
  assert.equal(isSensor('sensor.temp'), true);
  assert.equal(isSensor('binary_sensor.door'), true);
  assert.equal(isSensor('switch.x'), false);
});

test('sensorIcon picks the icon from the device class', () => {
  const S2 = (id, dc) => ({ entity_id: id, state: 'on', attributes: { device_class: dc } });
  assert.equal(sensorIcon(S2('sensor.t', 'temperature')), 'thermo');
  assert.equal(sensorIcon(S2('sensor.h', 'humidity')), 'drop');
  assert.equal(sensorIcon(S2('sensor.p', 'power')), 'gauge');
  assert.equal(sensorIcon(S2('binary_sensor.d', 'door')), 'door');
  assert.equal(sensorIcon(S2('binary_sensor.g', 'garage_door')), 'door');
  assert.equal(sensorIcon(S2('binary_sensor.w', 'window')), 'window');
  assert.equal(sensorIcon(S2('binary_sensor.m', 'motion')), 'motion');
  assert.equal(sensorIcon(S2('binary_sensor.l', 'moisture')), 'drop');
  assert.equal(sensorIcon(S2('binary_sensor.s', 'smoke')), 'flame');
  assert.equal(sensorIcon(undefined, 'sensor.unknown'), 'gauge');
});

test('scenes do not belong to the room they happen to sit in', () => {
  const rooms = [{ name: 'A', x: 0, y: 0, w: 50, h: 50 }];
  const buttons = [{ entity: 'light.a', x: 10, y: 10, w: 5, h: 3 }, { entity: 'scene.film', x: 10, y: 10, w: 5, h: 3 }];
  assert.deepEqual(roomMembers(rooms, buttons), [['light.a']]);
});

test('allOnTargets lists every placed light once, nothing else', () => {
  const buttons = [{ entity: 'light.a' }, { entity: 'switch.p' }, { entity: 'light.a' }, { entity: 'media_player.tv' },
    { entity: 'light.b' }, { label: 'Text' }, { entity: 'scene.film' }];
  assert.deepEqual(allOnTargets(buttons), ['light.a', 'light.b']);
  assert.deepEqual(allOnTargets([]), []);
  assert.deepEqual(allOnTargets(undefined), []);
});

test('the built-in "turn everything off / on" presets are on unless switched off', () => {
  assert.equal(normalizeConfig({ image: '/x.png' }).home_presets, true);
  assert.equal(normalizeConfig({ image: '/x.png', home_presets: false }).home_presets, false);
});

test('wheelSteps: one mouse notch = one step, touchpad events add up, lines count as pixels', () => {
  assert.deepEqual(wheelSteps(0, -100), { steps: 1, rest: -10 });
  assert.deepEqual(wheelSteps(0, 120), { steps: -1, rest: 30 });
  let r = { steps: 0, rest: 0 };
  let total = 0;
  for (let i = 0; i < 20; i += 1) { r = wheelSteps(r.rest, -6); total += r.steps; }
  assert.equal(total, 1);
  assert.equal(wheelSteps(0, -3, 1).steps, 1);
  assert.equal(wheelSteps(0, -5000).steps, 2);
  assert.equal(wheelSteps(0, 0).steps, 0);
});

test('pinchZoom: fingers apart = zoom in, together = out, limited and in 0.25 steps', () => {
  assert.equal(pinchZoom(1, 100, 200), 2);
  assert.equal(pinchZoom(1, 100, 50), 0.5);
  assert.equal(pinchZoom(1, 100, 112), 1);
  assert.equal(pinchZoom(1, 100, 130), 1.25);
  assert.equal(pinchZoom(2, 100, 1000), 3);
  assert.equal(pinchZoom(1, 0, 50), 1);
});

test('glow strength: item setting wins, then the card, default 100; mix with transparent', () => {
  assert.equal(clampPct(''), 100);
  assert.equal(clampPct('abc', 40), 40);
  assert.equal(clampPct(150), 100);
  assert.equal(clampPct(-3), 0);
  assert.equal(glowStrength({}, {}), 100);
  assert.equal(glowStrength({}, { glow_opacity: 40 }), 40);
  assert.equal(glowStrength({ glow_opacity: 0 }, { glow_opacity: 40 }), 0);
  assert.equal(glowStrength({ glow_opacity: '' }, { glow_opacity: 40 }), 40);
  assert.equal(glowMix('#ff0000', 100), '#ff0000');
  assert.equal(glowMix('#ff0000', 30), 'color-mix(in srgb, #ff0000 30%, transparent)');
  assert.equal(normalizeConfig({ image: 'x' }).glow_opacity, 100);
  assert.equal(normalizeConfig({ image: 'x', glow_opacity: '55' }).glow_opacity, 55);
  assert.deepEqual(COLOR_KEYS, ['color', 'bg_color', 'border_color', 'on_color', 'on_bg_color']);
});
