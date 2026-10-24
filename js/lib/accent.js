/**
 * The accent currently in force.
 *
 * A preset is a static block in tokens.css picked with `data-accent`, so it
 * costs nothing at boot and stays readable in the stylesheet. A colour chosen
 * by hand has no block, so its whole ramp is derived (lib/color.js) and written
 * as inline custom properties on `<html>`: inline beats both `:root` and every
 * preset, and the properties are removed again when a preset is chosen, or the
 * colour you replaced would keep leaking through.
 */

import { settings, onSettings, ACCENTS, DEFAULT_ACCENT, CUSTOM_ACCENT } from './store.js';
import { rampFrom, parseHex, toHex } from './color.js';

/* The token names a custom ramp owns — the same list every preset block
   writes, so switching between the two leaves nothing half-changed. */
const TOKENS = Object.keys(rampFrom(ACCENTS[DEFAULT_ACCENT]));

/** The id the interface marks as chosen: a preset, or 'custom' while a
    hand-picked colour is on screen. A stored value that is not a colour falls
    back to the preset rather than painting half the ramp. */
export function accentId() {
  const id = settings.get('accent');
  if (id === CUSTOM_ACCENT && parseHex(settings.get('accentCustom'))) return CUSTOM_ACCENT;
  return ACCENTS[id] ? id : DEFAULT_ACCENT;
}

/** Six digits, no `#`, for whatever is on screen — the player is tinted with
    this, so its controls and the page are always the same colour. */
export function accentValue() {
  const id = accentId();
  if (id === CUSTOM_ACCENT) return toHex(parseHex(settings.get('accentCustom')));
  return ACCENTS[id];
}

function apply(ramp) {
  const el = document.documentElement;
  if (!ramp) {
    for (const name of TOKENS) el.style.removeProperty(name);
    el.dataset.accent = accentId();
    return;
  }
  for (const [name, value] of Object.entries(ramp)) el.style.setProperty(name, value);
  el.dataset.accent = CUSTOM_ACCENT;
}

/** Paint what the settings say. */
export function paintAccent() {
  apply(accentId() === CUSTOM_ACCENT ? rampFrom(settings.get('accentCustom')) : null);
}

/** Paint a colour that has not been saved yet — the drag of a colour picker. */
export function previewAccent(hex) {
  apply(rampFrom(hex));
}

/* One owner for the paint: the Settings row, a reset, or a value restored from
   the cloud all land here, so the interface can never show an accent that is
   not the one stored. A reset arrives as '*' and repaints from defaults. */
onSettings((key) => {
  if (key === 'accent' || key === 'accentCustom' || key === '*') paintAccent();
});
