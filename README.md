# GH-Dash - floor-plan card for Home Assistant

A dashboard card that shows a floor plan with your devices on top of it.

- **Tap** a device to turn it on or off (lights, plugs/switches, TVs/media players, fans, helpers).
  Everything that is on gets a soft glow (a light glows in its own colour when it has one).
- **Long-press** (or right-click) a light with sliders enabled to change brightness, colour and
  warm/cold white. Other devices open Home Assistant's normal details dialog.
- **Rooms**: draw room areas on the plan. A device belongs to the room its centre is in, a room is
  tinted when something in it is on, and tapping a room shows what is on there.
- **Home Assistant information**: an item can show a panel with the Home Assistant version,
  connection, entities, updates and (for admins) system, disk and repairs.
- **Scale to fit**, **zoom**, **light/dark** and **full screen** buttons on the card.
- **Edit on the card** (admins): add devices by drag and drop, move, resize and rotate them,
  add rooms, text and labels, upload your own floor plan, then save.
- Swedish and English.

Card type: `custom:gh-dash-card`. One JavaScript file, `dist/gh-dash.js`, no dependencies.
The example floor plan `dist/plan.png` is installed together with the card.

## Install

### Marketplace (Home Assistant 2026.11 or newer)

1. Open the **Marketplace** and choose **Add from link**.
2. Paste `https://github.com/Images-by-Olofsson/GH-Dash-Card` and select **Add**
   (the first time, you are asked to connect a GitHub account). Download it.
3. **Restart Home Assistant once** if the `www` folder did not exist before - until then the
   card file cannot be loaded. The Marketplace adds the card to the dashboard resources itself.
4. Reload the browser.

### Manual

1. Copy `dist/gh-dash.js` and `dist/plan.png` into `/config/www/gh-dash/`
   (for example with the File editor or Samba add-on). Restart Home Assistant once if the
   `www` folder did not exist before.
2. Settings > Dashboards > menu (top right) > **Resources** > **Add resource**:
   `/local/gh-dash/gh-dash.js?v=1`, type **JavaScript module**. Raise `?v=` after each update.
3. Reload the browser.

## Add the card

Edit a dashboard > **Add card** > **GH-Dash floor plan**. The card starts with the example floor
plan, its rooms and a "Console/Terminal" information item - no devices. Tip: a view of the type
"Panel (single card)" lets the plan fill the screen.

The card looks for `plan.png` next to `gh-dash.js`, wherever it is installed. To use another
plan, upload it in edit mode (see below) or set `image:` to any image URL.

## Edit the plan

Use the pencil button in the card's top-right bar (shown to Home Assistant admins). Edit mode has
**Cancel** and **Save** in the bottom-right corner; Save writes the layout into the dashboard.
Dashboards in YAML mode cannot be saved this way - copy the YAML from the card editor instead.

- **Devices list**: lights, plugs and switches, TVs and media players and other devices from your
  Home Assistant, with search. Drag one onto the plan. A device that is already on the plan is
  moved instead of copied; a device placed twice is marked and can be removed.
- **Click** an item or a room to edit it, click again (or an empty spot) to close.
  **Remove** appears in the toolbar while something is selected; the Delete key works too.
- **Move** by dragging, **resize** with the corner handle, **rotate** with the round handle above
  the selected item (hold Shift for 15 degree steps).
- **Zoom** with the mouse wheel over the plan (or the minus, plus and fit buttons); drag an empty
  spot to move the plan.
- **+ Room** adds a room. Drag its edges and corners to fit the plan. When a room is selected, a
  **+** appears where it touches another room: click it to join the rooms into one (for example an
  L-shaped hall). Each part can still be resized on its own.
- **+ Text** and **+ Label** add words to the plan (no device): text, size, colour, rotation.
- **Upload floor plan** stores an image in Home Assistant (like the picture card does) and uses
  it as the plan. Invisible click areas made for labels drawn in the old image become visible labels.
- Item options: label, style (`label` box, `hotspot` invisible area over a label in the image,
  `text`), action on tap, sliders for lights, size and rotation.

## Configuration

```yaml
type: custom:gh-dash-card
image: /local/gh-dash/plan.png
fit: true                   # scale the plan to fit the screen (default true)
theme: light                # light | dark | auto (follow Home Assistant), default light
zoom: 1                     # start zoom 0.5-3, used when fit is off
glow_color: auto            # or any CSS colour
show_controls: true         # buttons on the card (default true)
buttons:
  - entity: light.living_room_lamp
    label: Living room lamp # optional, default = the device's name
    style: label            # label | hotspot | text (default label)
    tap_action: toggle      # toggle | more-info | sliders | ha-info | none (default toggle)
    sliders: true           # lights: long-press opens brightness/colour sliders
    rotate: 0               # degrees
    x: 72.0                 # left edge, % of the image width
    y: 58.0                 # top edge, % of the image height
    w: 7.0
    h: 3.0
  - label: Console/Terminal # an item without entity
    tap_action: ha-info     # shows information about Home Assistant
    x: 54
    y: 53
    w: 8
    h: 3
rooms:
  - name: Living room
    x: 64.1
    y: 55.2
    w: 26.2
    h: 27.1
  - name: Hall              # a room made of several parts
    parts:
      - { x: 46.1, y: 44.8, w: 26.9, h: 9.9 }
      - { x: 46.1, y: 54.7, w: 14.4, h: 13.0 }
```

Positions are in percent of the image, so items stay in place on every screen size.
"On" means state `on`; media players count as on unless `off`, `standby`, `unavailable` or
`unknown`. Missing or unavailable devices are shown grey and cannot be used.
`examples/card.yaml` is the starting configuration as YAML.

## Development

- `npm test` runs the unit tests (Node 18 or newer).
- `tools/find_labels.py` finds the label boxes in a floor-plan image.
- `tools/write_starter.mjs` writes `examples/card.yaml` from the card's starting configuration.
