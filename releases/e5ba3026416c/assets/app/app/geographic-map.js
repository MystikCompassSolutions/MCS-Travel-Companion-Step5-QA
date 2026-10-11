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

export function createGeographicMap({container, points, selectedId, camera, onSelect, onCamera, onStatus}) {
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
      button.setAttribute('aria-pressed', String(placeId === id));
      button.classList.toggle('is-selected', placeId === id);
    }
  }
  void (async () => {
    try {
      if (!navigator.onLine) {offline(); return;}
      onStatus('loading', 'Loading Tokyo street map…');
      timer = setTimeout(() => fail(unavailable()), 20000);
      const lib = await loadAssets();
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
      canvas.setAttribute('aria-label', 'Tokyo street map. Use the place list for an accessible alternative.');
      canvas.addEventListener('webglcontextlost', () => fail(unavailable()), {once: true});
      map.on('error', () => fail(unavailable()));
      const saveCamera = () => {if (map) {
        const current = {center: map.getCenter().toArray(), zoom: map.getZoom()};
        onCamera(current); container.dataset.camera = JSON.stringify(current);
        container.dataset.bearing = String(map.getBearing()); container.dataset.pitch = String(map.getPitch());
      }};
      map.on('moveend', saveCamera);
      for (const point of points) {
        const element = document.createElement('button');
        element.type = 'button'; element.className = 'pilot-pin'; element.textContent = '●';
        element.dataset.place = point.id;
        element.setAttribute('aria-label', `Select ${point.name}`);
        element.addEventListener('click', () => {select(point.id); onSelect(point.id);});
        markers.set(point.id, new lib.Marker({element}).setLngLat([point.longitude, point.latitude]).addTo(map));
      }
      select(selectedId);
      map.once('load', () => {
        if (failed || disposed) return;
        clearTimeout(timer); container.dataset.initMs = String(Math.round(performance.now() - started));
        saveCamera(); onStatus('ready', 'Tokyo street map ready.');
      });
    } catch {fail(unavailable());}
  })();
  return {select,
    resize() {map?.resize();},
    zoomBy(amount) {if (map) map.jumpTo({zoom: map.getZoom() + amount});},
    focusSelected() {
      const point = points.find(p => p.id === selectedId);
      if (map && point) map.jumpTo({center: [point.longitude, point.latitude], zoom: 16});
    },
    fitAll() {
      if (map) {
        const coordinates = points.map(p => [p.longitude, p.latitude]);
        map.fitBounds([[Math.min(...coordinates.map(p => p[0])), Math.min(...coordinates.map(p => p[1]))],
          [Math.max(...coordinates.map(p => p[0])), Math.max(...coordinates.map(p => p[1]))]],
        {padding: 56, maxZoom: 13, duration: 0});
      }
    },
    dispose() {disposed = true; cleanup(); removeEventListener('offline', offline);}};
}
