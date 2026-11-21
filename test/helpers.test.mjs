import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeConfig, isOn, isUnavailable, glowColor, toggleCall, clampRect, pxToPct, t,
  clampZoom, dropRect, resolveTheme, groupOf, fitZoom, replaceCard,
  normRotate, lightCaps, brightnessPct, hueOf, lightCall, angleTo, roomOf, roomMembers,
  roomParts, sharedEdge, mergeRooms, resizeEdge, placedAt, fitFont, haSummary, fmtBytes, starterConfig,
} from '../dist/gh-dash.js';

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
  assert.equal(groupOf('sensor.temp'), null);
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
