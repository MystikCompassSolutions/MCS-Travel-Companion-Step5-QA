import {overlappingPoints} from '../domain/explore.js';
// Replaceable provider boundary. Do not pass itinerary or traveler data here.
export const MAP_PROVIDER = Object.freeze({name: 'OpenFreeMap',
  style: new URL('../maps/openfreemap-liberty.json', import.meta.url).href,
  origin: 'https://tiles.openfreemap.org'});

export const MAP_GESTURES = Object.freeze({cooperativeGestures: false, dragRotate: false,
  pitchWithRotate: false, touchPitch: false, maxPitch: 0});
export function mapUnavailableMessage(online) {
  return online ? 'Map unavailable. Please try again.' : 'Map unavailable. Check your connection and try again.';
}

export function allowedMapRequest(url) {
  const parsed = new URL(url);
  return parsed.origin === MAP_PROVIDER.origin && !parsed.search &&
    /^\/(planet(?:\/|$)|fonts\/|sprites\/ofm_f384\/|natural_earth\/ne2sr\/)/.test(parsed.pathname);
}

let assets;
function loadAssets() {
  if (!assets) assets = (async () => {
    const css = new URL('../vendor/maplibre/maplibre-gl.css', import.meta.url).href;
    await new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = css;
      link.onload = resolve; link.onerror = () => {link.remove(); reject(new Error('Map stylesheet unavailable'));};
      document.head.append(link);
    });
    const lib = await import('../vendor/maplibre/maplibre-gl.mjs');
    lib.setWorkerUrl(new URL('../vendor/maplibre/maplibre-gl-worker.mjs', import.meta.url).href);
    lib.setWorkerCount(1);
    return lib;
  })().catch(error => {assets = null; throw error;});
  return assets;
}

export function createGeographicMap({container, points, selectedId, camera, regionName = 'Region', onSelect, onChooseGroup, onCamera, onStatus}) {
  let library;
  let map, timer, disposed = false, failed = false;
  const markers = new Map(); const started = performance.now();
  const cleanup = () => {clearTimeout(timer); map?.remove(); map = null; markers.clear();};
  function fail(reason) {
    if (disposed || failed) return;
    failed = true; cleanup(); onStatus('failed', reason);
  }
  const unavailable = () => mapUnavailableMessage(navigator.onLine);
  const offline = () => fail(unavailable());
  addEventListener('offline', offline);
  function select(id) {
    selectedId = id;
    for (const [placeId, marker] of markers) {
      const button = marker.getElement();
      button.setAttribute('aria-pressed', String(JSON.parse(button.dataset.entries).includes(id)));
      button.classList.toggle('is-selected', JSON.parse(button.dataset.entries).includes(id));
    }
  }
  function renderMarkers() {
    if (!map || !library) return;
    for (const marker of markers.values()) marker.remove();
    markers.clear();
    const groups = overlappingPoints(points, coordinate => map.project(coordinate));
    for (const group of groups) {
      const point = group[0], element = document.createElement('button');
      element.type = 'button'; element.className = 'pilot-pin';
      element.textContent = group.length > 1 ? `${group.length}+` : point.number ? String(point.number) : point.alternative ? '◇' : '●';
      element.classList.toggle('is-cluster', group.length > 1);
      element.dataset.place = point.placeId;
      element.dataset.entry = point.id;
      element.dataset.entries = JSON.stringify(group.map(p => p.id));
      element.setAttribute('aria-label', group.length > 1 ? `Choose ${group.length} nearby places: ${group.map(p => p.label).join(', ')}` : `Select ${point.label}`);
      element.addEventListener('click', () => {
        if (group.length > 1) onChooseGroup(group.map(p => p.id));
        else {select(point.id); onSelect(point.id);}
      });
      markers.set(point.id, new library.Marker({element}).setLngLat([point.longitude, point.latitude]).addTo(map));
    }
    select(selectedId);
  }
  function fit() {
    if (!map || !points.length) return;
    const coordinates = points.map(p => [p.longitude, p.latitude]);
    map.fitBounds([[Math.min(...coordinates.map(p => p[0])), Math.min(...coordinates.map(p => p[1]))],
      [Math.max(...coordinates.map(p => p[0])), Math.max(...coordinates.map(p => p[1]))]],
      {padding: 56, maxZoom: 13, duration: 0});
  }
  void (async () => {
    try {
      if (!navigator.onLine) {offline(); return;}
      onStatus('loading', 'Loading street map…');
      timer = setTimeout(() => fail(unavailable()), 20000);
      const lib = await loadAssets(); library = lib;
      if (disposed || failed || !container.isConnected) return;
      const response = await fetch(MAP_PROVIDER.style);
      if (!response.ok) throw new Error('Local map style unavailable');
      const style = await response.json();
      if (disposed || failed) return;
      const bounds = points.reduce((b, p) => b.extend([p.longitude, p.latitude]), new lib.LngLatBounds());
      map = new lib.Map({container, style, bounds, fitBoundsOptions: {padding: 56, maxZoom: 13},
        ...(camera ? {center: camera.center, zoom: camera.zoom, bounds: undefined} : {}),
        ...MAP_GESTURES,
        minZoom: 9, maxZoom: 18, renderWorldCopies: false, attributionControl: false, trackResize: false,
        transformRequest: url => {
          if (!allowedMapRequest(url)) throw new Error('Unapproved map request');
          return {url, credentials: 'omit', referrerPolicy: 'no-referrer'};
        }});
      map.touchZoomRotate.disableRotation();
      map.keyboard.disableRotation();
      const canvas = map.getCanvas();
      canvas.setAttribute('aria-label', `${regionName} street map. Use the place list for an accessible alternative.`);
      canvas.addEventListener('webglcontextlost', () => fail(unavailable()), {once: true});
      map.on('error', () => fail(unavailable()));
      const saveCamera = () => {if (map) {
        const current = {center: map.getCenter().toArray(), zoom: map.getZoom()};
        onCamera(current); container.dataset.camera = JSON.stringify(current);
        container.dataset.bearing = String(map.getBearing()); container.dataset.pitch = String(map.getPitch());
      }};
      map.on('movestart', () => {container.dataset.tilesReady = 'false';});
      map.on('idle', () => {if (map) container.dataset.tilesReady = String(map.areTilesLoaded());});
      map.on('moveend', saveCamera);
      map.on('moveend', renderMarkers);
      renderMarkers();
      map.once('load', () => {
        if (failed || disposed) return;
        clearTimeout(timer); container.dataset.initMs = String(Math.round(performance.now() - started));
        saveCamera(); onStatus('ready', `${regionName} street map ready.`);
      });
    } catch {fail(unavailable());}
  })();
  return {select,
    resize() {map?.resize(); renderMarkers();},
    zoomBy(amount) {if (map) map.jumpTo({zoom: map.getZoom() + amount});},
    focusSelected() {
      const point = points.find(p => p.id === selectedId);
      if (map && point) map.jumpTo({center: [point.longitude, point.latitude], zoom: 16});
    },
    fitAll: fit,
    update(next) {
      points = next.points; selectedId = next.selectedId;
      regionName = next.regionName;
      if (!map && (next.fit || next.camera)) camera = next.camera;
      if (map) {
        map.getCanvas().setAttribute('aria-label', `${regionName} street map. Use the place list for an accessible alternative.`);
        if (next.camera) map.jumpTo(next.camera);
        else if (next.fit) fit();
        renderMarkers();
      }
    },
    dispose() {disposed = true; cleanup(); removeEventListener('offline', offline);}};
}
