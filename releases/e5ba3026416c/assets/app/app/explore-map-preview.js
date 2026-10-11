import {el, button} from './dom.js';
import {icon, mediaImage} from './visual.js';
import {tokyoPilot} from './explore-pilot.js';
import {createGeographicMap} from './geographic-map.js';

// Session-only UI state; the map never receives traveler state or filter logic.
export function exploreMapPreview(bundle, session, openDetail, listView) {
  const entries = tokyoPilot(bundle);
  if (entries.length !== 5) return {element: null, dispose() {}};
  if (!entries.some(e => e.place.placeId === session.selectedId)) session.selectedId = entries[0].place.placeId;
  let controller, currentMode, disposed = false, mapStatus = 'inactive';
  const region = el('section', {class: 'explore-pilot', 'aria-label': 'Tokyo map and curated places'});
  const canvas = el('div', {class: 'pilot-canvas', id: 'tokyo-pilot-map'});
  const message = el('p', {class: 'pilot-status', role: 'status', 'aria-live': 'polite'});
  const retry = button('Retry Map', () => start(), {hidden: true});
  const viewPlaces = button('View Places', () => {mode('list'); listView.focus({preventScroll: true});}, {hidden: true});
  const failure = el('div', {class: 'pilot-failure', hidden: true}, message, retry, viewPlaces);
  const preview = el('section', {class: 'pilot-preview', 'aria-label': 'Selected Tokyo place'});
  const selected = el('p', {class: 'visually-hidden', role: 'status', 'aria-live': 'polite'});
  const choices = entries.map(entry => button(entry.place.name, () => select(entry.place.placeId, true),
    {class: 'pilot-place-choice', 'data-place': entry.place.placeId, 'aria-pressed': 'false'}));
  const placeSummary = el('summary', {}, 'Choose place');
  const placePicker = el('details', {class: 'pilot-places'}, placeSummary,
    el('div', {class: 'pilot-place-choices', role: 'group', 'aria-label': 'Select a Tokyo pilot place'}, choices));
  const mapButton = button('Map', () => mode('map'), {'aria-pressed': 'false', 'aria-controls': 'tokyo-pilot-map'});
  const listButton = button('List', () => mode('list'), {'aria-pressed': 'false', 'aria-controls': 'explore-list-view'});
  const activate = el('div', {class: 'pilot-activation'},
    el('p', {}, 'Explore five Tokyo places on the street map.'),
    button('Activate Map', () => {session.activated = true; start();}),
    el('p', {class: 'day-meta'}, 'Internet required. Opening the map contacts OpenFreeMap, which receives your IP address.'));
  const link = (text, href) => el('a', {href, target: '_blank', rel: 'noopener noreferrer'}, text);
  const zoomIn = button('Zoom in', () => controller?.zoomBy(1));
  const zoomOut = button('Zoom out', () => controller?.zoomBy(-1));
  const controls = el('details', {class: 'pilot-controls'}, el('summary', {}, 'Map controls'),
    el('div', {class: 'pilot-controls-body'},
      el('div', {class: 'pilot-switch'}, zoomIn, zoomOut),
      button('Zoom to selected place', () => controller?.focusSelected()),
      button('Show all five locations', () => controller?.fitAll()),
      el('p', {}, 'Drag to explore · Pinch to zoom. Keyboard: focus the map and use arrow keys to pan, + / − to zoom. Use List for all places and day/category filters.'),
      el('div', {class: 'pilot-attribution'}, link('MapLibre', 'https://maplibre.org/'),
        link('OpenFreeMap', 'https://openfreemap.org/'),
        link('Liberty style / font licenses', new URL('../maps/NOTICES.txt', import.meta.url).href))));
  const credits = el('div', {class: 'pilot-attribution pilot-copyright', 'aria-label': 'Map attribution'},
    link('© OpenMapTiles', 'https://www.openmaptiles.org/'),
    link('© OpenStreetMap contributors', 'https://www.openstreetmap.org/copyright'));
  const help = el('p', {class: 'pilot-gesture-help'}, 'Drag to explore · Pinch to zoom');
  const surface = el('div', {class: 'pilot-surface'}, canvas, activate);
  const mapView = el('div', {class: 'pilot-map-view'},
    el('div', {class: 'pilot-tools'}, help, controls), surface, credits, preview);
  for (const disclosure of [placePicker, controls]) disclosure.addEventListener('keydown', event => {
    if (event.key === 'Escape') {event.preventDefault(); disclosure.open = false; disclosure.querySelector('summary').focus({preventScroll: true});}
  });
  listView.tabIndex = -1;
  listView.addEventListener('scroll', () => {if (session.mode === 'list') session.listScrollTop = listView.scrollTop;});
  function syncSelection() {
    for (const row of listView.querySelectorAll('.place-row[data-place]')) {
      row.classList.toggle('is-selected', row.dataset.place === session.selectedId);
      row.querySelector('.place-select')?.setAttribute('aria-pressed', String(row.dataset.place === session.selectedId));
    }
  }
  function select(id, announce = false) {
    const entry = entries.find(e => e.place.placeId === id); if (!entry) return;
    session.selectedId = id; controller?.select(id); syncSelection();
    for (const choice of choices) choice.setAttribute('aria-pressed', String(choice.dataset.place === id));
    placeSummary.textContent = `Places · ${entry.place.name}`;
    const photo = mediaImage(bundle, entry.thumbnail, 'pilot-thumbnail', true);
    photo?.addEventListener('error', () => photo.replaceWith(el('span', {class: 'pilot-thumbnail pilot-neutral', 'aria-hidden': 'true'}, icon(entry.place.category))), {once: true});
    preview.replaceChildren(photo ?? el('span', {class: 'pilot-thumbnail pilot-neutral', 'aria-hidden': 'true'}, icon(entry.place.category)),
      el('div', {class: 'pilot-preview-copy'}, el('h3', {}, entry.place.name),
        el('p', {}, `${entry.place.category === 'shopping' ? 'Shopping' : 'Attraction'} · ${entry.place.neighborhood ?? entry.region}`),
        el('small', {class: 'pilot-editorial'}, entry.label),
        button(entry.member ? 'Open shopping collection' : 'Open activity detail', () => openDetail(entry.activity),
          {class: 'text-action', 'aria-label': `Open ${entry.activity.name} for ${entry.place.name}`})));
    if (announce) selected.textContent = `${entry.place.name} selected.`;
    if (announce && placePicker.contains(document.activeElement)) {
      placePicker.open = false; placeSummary.focus({preventScroll: true});
    }
  }
  function resize() {requestAnimationFrame(() => {if (!disposed && session.mode === 'map') controller?.resize();});}
  const observer = new ResizeObserver(resize);
  observer.observe(surface);
  function start() {
    if (disposed) return;
    session.activated = true;
    controller?.dispose(); controller = null; canvas.replaceChildren();
    mode('map', false); activate.hidden = true; canvas.hidden = false;
    controller = createGeographicMap({container: canvas,
      points: entries.map(({place}) => ({id: place.placeId, name: place.name, latitude: place.latitude, longitude: place.longitude})),
      selectedId: session.selectedId, camera: session.camera,
      onSelect: id => select(id, true), onCamera: camera => {session.camera = camera;},
      onStatus: (status, text) => {
        if (disposed) return;
        mapStatus = status; region.dataset.mapStatus = status;
        message.textContent = text; failure.hidden = status === 'ready';
        retry.hidden = viewPlaces.hidden = status !== 'failed';
        controls.hidden = status !== 'ready';
        if (status === 'failed') {
          canvas.hidden = true; mode('list', false);
          if (document.activeElement === document.body || mapView.contains(document.activeElement)) retry.focus({preventScroll: true});
        }
      }});
  }
  function mode(value, mayStart = true) {
    if (currentMode === 'list') session.listScrollTop = listView.scrollTop;
    currentMode = value; session.mode = value; region.dataset.mode = value;
    if (region.closest('main')) region.closest('main').dataset.exploreMode = value;
    mapButton.setAttribute('aria-pressed', String(value === 'map'));
    listButton.setAttribute('aria-pressed', String(value === 'list'));
    mapView.hidden = value !== 'map'; listView.hidden = value !== 'list';
    if (value === 'map') {
      if (mayStart && session.activated && (!controller || mapStatus === 'failed')) start();
      else resize();
    } else requestAnimationFrame(() => {if (!disposed && session.mode === 'list') listView.scrollTop = session.listScrollTop ?? 0;});
  }
  region.append(el('div', {class: 'explore-top'}, el('h1', {}, 'Explore'),
    el('div', {class: 'pilot-switch', role: 'group', 'aria-label': 'Map or place list'}, mapButton, listButton)),
    el('div', {class: 'pilot-context'}, el('span', {}, 'Tokyo pilot · QA only'), placePicker),
    failure, mapView, listView, selected);
  controls.hidden = true; canvas.hidden = true;
  select(session.selectedId);
  requestAnimationFrame(() => {if (!disposed) mode(session.mode ?? 'map');});
  return {element: region, select, syncSelection, hasPlace: id => entries.some(e => e.place.placeId === id),
    dispose() {if (currentMode === 'list') session.listScrollTop = listView.scrollTop;
      disposed = true; observer.disconnect(); controller?.dispose();}};
}
