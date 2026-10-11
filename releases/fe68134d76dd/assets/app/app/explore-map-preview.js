import {el, button} from './dom.js';
import {icon, mediaImage} from './visual.js';
import {tokyoPilot} from './explore-pilot.js';
import {createGeographicMap} from './geographic-map.js';

export function exploreMapPreview(bundle, session, openDetail) {
  const entries = tokyoPilot(bundle);
  if (entries.length !== 5) return {element: null, dispose() {}};
  if (!entries.some(e => e.place.placeId === session.selectedId)) session.selectedId = entries[0].place.placeId;
  let controller, disposed = false;
  const region = el('section', {class: 'explore-pilot', 'aria-label': 'QA-only Tokyo interactive map preview'});
  const canvas = el('div', {class: 'pilot-canvas', id: 'tokyo-pilot-map'});
  const message = el('p', {class: 'pilot-status', role: 'status', 'aria-live': 'polite'});
  const retry = button('Retry street map', () => start(), {hidden: true});
  const zoomSelected = button('Zoom to selected place', () => controller?.focusSelected(), {hidden: true});
  const fitAll = button('Show all five locations', () => controller?.fitAll(), {hidden: true});
  const preview = el('section', {class: 'pilot-preview', 'aria-label': 'Selected Tokyo place'});
  const selected = el('p', {class: 'visually-hidden', role: 'status', 'aria-live': 'polite'});
  const choices = entries.map(entry => button(entry.place.name, () => select(entry.place.placeId, true),
    {class: 'pilot-place-choice', 'data-place': entry.place.placeId, 'aria-pressed': 'false'}));
  const mapButton = button('Show interactive map', () => mode('map'), {'aria-pressed': 'false', 'aria-controls': canvas.id});
  const listButton = button('Use place list', () => mode('list'), {'aria-pressed': 'true'});
  function select(id, announce = false) {
    const entry = entries.find(e => e.place.placeId === id); if (!entry) return;
    session.selectedId = id; controller?.select(id);
    for (const choice of choices) choice.setAttribute('aria-pressed', String(choice.dataset.place === id));
    const photo = mediaImage(bundle, entry.thumbnail, 'pilot-thumbnail', true);
    photo?.addEventListener('error', () => photo.replaceWith(el('span', {class: 'pilot-thumbnail pilot-neutral', 'aria-hidden': 'true'}, icon(entry.place.category))), {once: true});
    preview.replaceChildren(photo ?? el('span', {class: 'pilot-thumbnail pilot-neutral', 'aria-hidden': 'true'}, icon(entry.place.category)),
      el('div', {class: 'pilot-preview-copy'}, el('h3', {}, entry.place.name),
        el('p', {}, `${entry.place.category === 'shopping' ? 'Shopping' : 'Attraction'} · ${entry.place.neighborhood ?? entry.region}`),
        el('small', {class: 'pilot-editorial'}, entry.label),
        button(entry.member ? 'Open shopping collection' : 'Open activity detail', () => openDetail(entry.activity),
          {class: 'text-action', 'aria-label': `Open ${entry.activity.name} for ${entry.place.name}`})));
    if (announce) selected.textContent = `${entry.place.name} selected. Its preview and detail action are below.`;
  }
  function start() {
    controller?.dispose(); controller = null; canvas.replaceChildren();
    if (disposed || session.mode !== 'map') return;
    canvas.hidden = false; retry.hidden = true;
    zoomSelected.hidden = true;
    fitAll.hidden = true;
    controller = createGeographicMap({container: canvas,
      points: entries.map(({place}) => ({id: place.placeId, name: place.name, latitude: place.latitude, longitude: place.longitude})),
      selectedId: session.selectedId, camera: session.camera,
      onSelect: id => select(id, true), onCamera: camera => {session.camera = camera;},
      onStatus: (status, text) => {
        if (disposed) return;
        region.dataset.mapStatus = status; message.textContent = text;
        retry.hidden = status !== 'failed';
        zoomSelected.hidden = status !== 'ready';
        fitAll.hidden = status !== 'ready';
        // Hide an unusable canvas so focus and space return to working content.
        canvas.hidden = status === 'failed';
      }});
  }
  function mode(value) {
    session.mode = value;
    mapButton.setAttribute('aria-pressed', String(value === 'map'));
    listButton.setAttribute('aria-pressed', String(value === 'list'));
    canvas.hidden = value !== 'map';
    if (value === 'map') start();
    else {controller?.dispose(); controller = null; retry.hidden = true; zoomSelected.hidden = true; fitAll.hidden = true; region.dataset.mapStatus = 'list';
      message.textContent = 'The full curated place list is below. Select any pilot place to preview it here.';}
  }
  const link = (text, href) => el('a', {href, target: '_blank', rel: 'noopener noreferrer'}, text);
  region.append(el('h2', {}, 'Tokyo map preview · QA only'),
    el('p', {class: 'day-meta'}, 'Five verified venue locations only. Internet required: opening the map sends tile requests to OpenFreeMap. Filters apply to the full place list below.'),
    el('div', {class: 'pilot-switch', role: 'group', 'aria-label': 'Map or place list'}, mapButton, listButton),
    message, retry, el('div', {class: 'pilot-switch'}, zoomSelected, fitAll),
    el('p', {class: 'pilot-gesture-help'}, 'On touch screens, use two fingers to move the map. Use + and − to zoom, or Ctrl/⌘ with the mouse wheel. One-finger scrolling and browser zoom remain available.'),
    canvas,
    el('div', {class: 'pilot-attribution', 'aria-label': 'Map attribution'},
      link('MapLibre', 'https://maplibre.org/'), ' · ', link('OpenFreeMap', 'https://openfreemap.org/'), ' · ',
      link('© OpenMapTiles', 'https://www.openmaptiles.org/'), ' · ',
      link('© OpenStreetMap contributors', 'https://www.openstreetmap.org/copyright'), ' · ',
      link('Liberty style / licenses', new URL('../maps/NOTICES.txt', import.meta.url).href)),
    el('div', {class: 'pilot-place-choices', role: 'group', 'aria-label': 'Select a Tokyo pilot place'}, choices), selected, preview);
  select(session.selectedId);
  // The app attaches this section after rendering; deferred work checks disposal.
  requestAnimationFrame(() => {if (!disposed) mode(session.mode ?? 'list');});
  return {element: region, dispose() {disposed = true; controller?.dispose();}};
}
