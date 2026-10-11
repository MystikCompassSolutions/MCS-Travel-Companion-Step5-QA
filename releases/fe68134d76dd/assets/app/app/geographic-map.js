// Replaceable provider boundary. Do not pass itinerary or traveler data here.
export const MAP_PROVIDER = Object.freeze({name: 'OpenFreeMap',
  style: new URL('../maps/openfreemap-liberty.json', import.meta.url).href,
  origin: 'https://tiles.openfreemap.org'});

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
  const offline = () => fail('Interactive street maps require internet. Your curated places and details remain available below.');
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
      timer = setTimeout(() => fail('The street map could not load in time. It requires internet; use the place list or retry.'), 20000);
      const lib = await loadAssets();
      if (disposed || failed || !container.isConnected) return;
      const response = await fetch(MAP_PROVIDER.style);
      if (!response.ok) throw new Error('Local map style unavailable');
      const style = await response.json();
      if (disposed || failed) return;
      const bounds = points.reduce((b, p) => b.extend([p.longitude, p.latitude]), new lib.LngLatBounds());
      map = new lib.Map({container, style, bounds, fitBoundsOptions: {padding: 56, maxZoom: 13},
        ...(camera ? {center: camera.center, zoom: camera.zoom, bounds: undefined} : {}),
        cooperativeGestures: true, dragRotate: false, pitchWithRotate: false, touchPitch: false,
        maxPitch: 0, minZoom: 9, maxZoom: 18, renderWorldCopies: false, attributionControl: false,
        transformRequest: url => {
          if (!allowedMapRequest(url)) throw new Error('Unapproved map request');
          return {url, credentials: 'omit', referrerPolicy: 'no-referrer'};
        }});
      map.touchZoomRotate.disableRotation();
      map.addControl(new lib.NavigationControl({showCompass: false}), 'top-right');
      const canvas = map.getCanvas();
      canvas.setAttribute('aria-label', 'Tokyo street map. Use the place list for an accessible alternative.');
      canvas.addEventListener('webglcontextlost', () => fail('Street map graphics became unavailable. Use the place list or retry.'), {once: true});
      map.on('error', () => fail('The street map is unavailable. It requires internet; your curated list and details still work.'));
      map.on('moveend', () => {if (map) onCamera({center: map.getCenter().toArray(), zoom: map.getZoom()});});
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
        onStatus('ready', 'Tokyo street map ready. Select a marker or a place below.');
      });
    } catch {fail('Street map graphics or files are unavailable. The map requires internet and WebGL; use the place list or retry.');}
  })();
  return {select,
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
