import {el, button} from './dom.js';
import {icon, mediaImage} from './visual.js';
import {createGeographicMap} from './geographic-map.js';
import {reconcileExploreSelection, exploreCardWindow} from '../domain/explore.js';

// One supplied projection drives the map, carousel and complete List. UI state is
// session-only; this component never writes traveler state or resolves schedules.
export function exploreMapPreview(bundle, session, openDetail, listView, options) {
  let model = options.model, controller, currentMode, disposed = false, mapStatus = 'inactive';
  session.cameras ??= {};
  let regionId = model.regionId;
  let cards = [], cardEntries = [], scrollTimer, restoringList = false;
  const region = el('section', {class: 'explore-pilot', 'aria-label': 'Itinerary map and curated places'});
  const canvas = el('div', {class: 'pilot-canvas', id: 'itinerary-map'});
  const message = el('p', {class: 'pilot-status', role: 'status', 'aria-live': 'polite'});
  const retry = button('Retry Map', () => start(), {hidden: true});
  const viewPlaces = button('View Places', () => {mode('list'); listView.focus({preventScroll: true});}, {hidden: true});
  const failure = el('div', {class: 'pilot-failure', hidden: true}, message, retry, viewPlaces);
  const selected = el('p', {class: 'visually-hidden', role: 'status', 'aria-live': 'polite'});
  const choices = el('div', {class: 'pilot-place-choices', role: 'group', 'aria-label': 'Select an itinerary place'});
  const placeSummary = el('summary', {}, 'Places');
  const placePicker = el('details', {class: 'pilot-places'}, placeSummary, choices);
  const regionSelect = el('select', {'aria-label': 'Explore region', onChange: () => options.onRegion(regionSelect.value)});
  const resultCount = el('span', {class: 'explore-count', role: 'status', 'aria-live': 'polite'});
  const mapButton = button('Map', () => mode('map'), {'aria-pressed': 'false', 'aria-controls': 'itinerary-map'});
  const listButton = button('List', () => mode('list'), {'aria-pressed': 'false', 'aria-controls': 'explore-list-view'});
  const activate = el('div', {class: 'pilot-activation'},
    el('p', {}, 'Explore your curated places on the street map.'),
    button('Activate Map', () => {session.activated = true; start();}),
    el('p', {class: 'day-meta'}, 'Internet required. Opening the map contacts OpenFreeMap, which receives your IP address.'));
  const empty = el('p', {class: 'pilot-map-empty', hidden: true}, 'No verified map locations in this scope. View List for authored places and activities.');
  const link = (text, href) => el('a', {href, target: '_blank', rel: 'noopener noreferrer'}, text);
  const controls = el('details', {class: 'pilot-controls'}, el('summary', {}, 'Map controls'),
    el('div', {class: 'pilot-controls-body'},
      el('div', {class: 'pilot-switch'}, button('Zoom in', () => controller?.zoomBy(1)), button('Zoom out', () => controller?.zoomBy(-1))),
      button('Zoom to selected place', () => controller?.focusSelected()),
      button('Show filtered locations', () => controller?.fitAll()),
      el('p', {}, 'Drag to explore · Pinch to zoom. Keyboard: focus the map and use arrow keys to pan, + / − to zoom. Places and List provide named selection. Plain numbers are day visit order; a number with + opens nearby places; dots are curated locations; diamonds are unselected alternatives. No walking directions are shown.'),
      el('div', {class: 'pilot-attribution'}, link('MapLibre', 'https://maplibre.org/'),
        link('OpenFreeMap', 'https://openfreemap.org/'),
        link('Liberty style / font licenses', new URL('../maps/NOTICES.txt', import.meta.url).href))));
  const credits = el('div', {class: 'pilot-attribution pilot-copyright', 'aria-label': 'Map attribution'},
    link('© OpenMapTiles', 'https://www.openmaptiles.org/'),
    link('© OpenStreetMap contributors', 'https://www.openstreetmap.org/copyright'));
  const carousel = el('div', {class: 'explore-carousel', role: 'region', 'aria-label': 'Place previews', tabindex: '0'});
  const cardPosition = el('span', {class: 'card-position'});
  const previous = button('‹', () => adjacent(-1), {'aria-label': 'Previous place preview'});
  const next = button('›', () => adjacent(1), {'aria-label': 'Next place preview'});
  const cardControls = el('div', {class: 'carousel-controls', role: 'group', 'aria-label': 'Place preview navigation'}, previous, cardPosition, next);
  const preview = el('section', {class: 'explore-preview', 'aria-label': 'Selected place previews'}, carousel);
  const surface = el('div', {class: 'pilot-surface'}, canvas, activate, empty);
  const mapView = el('div', {class: 'pilot-map-view'},
    el('div', {class: 'pilot-tools'}, cardControls, controls), surface, credits, preview);
  for (const disclosure of [placePicker, controls]) disclosure.addEventListener('keydown', event => {
    if (event.key === 'Escape') {event.preventDefault(); disclosure.open = false; disclosure.querySelector('summary').focus({preventScroll: true});}
  });
  listView.tabIndex = -1;
  listView.addEventListener('scroll', () => {if (currentMode === 'list' && !restoringList) session.listScrollTop = listView.scrollTop;});
  const entries = () => model.entries.filter(e => e.regionId === regionId);
  const entryLabel = entry => `${entry.name}${entry.dayNumber ? ` · Day ${entry.dayNumber}` : ''}${entry.visitOrdinal ? ` · Visit ${entry.visitOrdinal}` : ''}${entry.kind === 'alternative' ? ' · Not scheduled' : ''}`;
  const visitLabel = entry => entry.dayNumber ? `Day ${entry.dayNumber}${entry.visitOrdinal ? ` · Visit ${entry.visitOrdinal}` : entry.member ? ' · Curated option' : ' · Alternative'}` : 'Curated place';
  function syncSelection() {
    for (const row of listView.querySelectorAll('.place-row[data-entry]')) {
      const active = row.dataset.entry === session.selectedId;
      row.classList.toggle('is-selected', active);
      row.querySelector('.place-select')?.setAttribute('aria-pressed', String(active));
    }
  }
  function renderCards() {
    cardEntries = exploreCardWindow(entries(), session.selectedId);
    cards = cardEntries.map(entry => {
      const photo = mediaImage(bundle, entry.thumbnail, 'pilot-thumbnail', true);
      const neutral = () => el('span', {class: 'pilot-thumbnail pilot-neutral', 'aria-hidden': 'true'}, icon(entry.categoryGroup));
      photo?.addEventListener('error', () => photo.replaceWith(neutral()), {once: true});
      return el('article', {class: 'pilot-preview explore-place-card', 'data-entry': entry.id,
        'aria-label': entryLabel(entry), onFocusin: () => select(entry.id, false, false)},
        photo ?? neutral(), el('div', {class: 'pilot-preview-copy'}, el('h3', {}, entry.name),
          el('p', {}, `${entry.category} · ${entry.neighborhood ?? entry.region}`),
          el('small', {class: 'pilot-editorial'}, `${entry.editorial} · ${visitLabel(entry)}`),
          entry.target ? button(entry.member ? `Open ${entry.parent.collection.kind} collection` : 'Open activity detail',
            () => {session.returnFocusId = entry.id; openDetail(entry.target);},
            {class: 'text-action', 'aria-label': `Open ${entry.target.name} for ${entry.name}`}) : el('small', {}, 'Activity detail unavailable'),
          !entry.mapped ? el('small', {}, entry.locationNote) : null));
    });
    carousel.replaceChildren(...cards);
    if (!cards.length) carousel.append(el('p', {class: 'explore-empty'}, 'No places match this scope. Try All or another category.'));
  }
  function select(id, announce = false, align = true) {
    const started = performance.now();
    const entry = model.entries.find(e => e.id === id); if (!entry) return;
    if (entry.regionId !== regionId) {options.onRegion(entry.regionId, id); return;}
    const changed = session.selectedId !== id;
    session.selectedId = id; controller?.select(id); syncSelection();
    if (!cardEntries.some(e => e.id === id)) renderCards();
    cards.forEach(card => {const active = card.dataset.entry === id; card.classList.toggle('is-selected', active);
      card.setAttribute('aria-current', active ? 'true' : 'false');});
    choices.querySelectorAll('button').forEach(choice => choice.setAttribute('aria-pressed', String(choice.dataset.entry === id)));
    const index = entries().findIndex(e => e.id === id);
    cardPosition.textContent = `${index + 1} / ${entries().length}`;
    previous.disabled = index <= 0; next.disabled = index >= entries().length - 1;
    const wasNearbyChooser = placeSummary.textContent === 'Nearby places';
    placeSummary.textContent = 'Places';
    if (align) requestAnimationFrame(() => {if (disposed) return; const card = cards.find(c => c.dataset.entry === id);
      if (card) carousel.scrollLeft += card.getBoundingClientRect().left - carousel.getBoundingClientRect().left;});
    if (announce && changed) selected.textContent = `${entryLabel(entry)} selected. ${visitLabel(entry)}.`;
    if (announce && placePicker.contains(document.activeElement)) {
      placePicker.open = false;
      if (wasNearbyChooser) refreshChoices();
      placeSummary.focus({preventScroll: true});
    }
    region.dataset.selectionMs = String(performance.now() - started);
  }
  function adjacent(amount) {
    const scoped = entries(), index = scoped.findIndex(e => e.id === session.selectedId);
    if (scoped[index + amount]) select(scoped[index + amount].id, true);
  }
  carousel.addEventListener('keydown', event => {
    if (event.target !== carousel || !['ArrowLeft','ArrowRight'].includes(event.key)) return;
    event.preventDefault(); adjacent(event.key === 'ArrowRight' ? 1 : -1);
  });
  carousel.addEventListener('scroll', () => {
    clearTimeout(scrollTimer); scrollTimer = setTimeout(() => {
      if (disposed || currentMode !== 'map' || !cards.length) return;
      const left = carousel.getBoundingClientRect().left;
      const nearest = cards.reduce((a,b) => Math.abs(a.getBoundingClientRect().left-left) < Math.abs(b.getBoundingClientRect().left-left) ? a : b);
      if (nearest.dataset.entry !== session.selectedId) select(nearest.dataset.entry, true, false);
    }, 100);
  }, {passive: true});
  function chooseGroup(ids) {
    choices.replaceChildren(...ids.map(id => model.entries.find(e => e.id === id)).filter(Boolean).map(entry =>
      button(entryLabel(entry), () => select(entry.id, true), {class: 'pilot-place-choice', 'data-entry': entry.id,
        'data-place': entry.placeId ?? '',
        'aria-pressed': String(session.selectedId === entry.id)})));
    placeSummary.textContent = 'Nearby places'; placePicker.open = true;
    choices.querySelector('button')?.focus({preventScroll: true});
    selected.textContent = `${ids.length} nearby places. Choose a named place.`;
  }
  placePicker.addEventListener('toggle', () => {if (!placePicker.open && placeSummary.textContent === 'Nearby places') refreshChoices();});
  function refreshChoices() {
    placeSummary.textContent = 'Places';
    choices.replaceChildren(...entries().map(entry => button(entryLabel(entry), () => select(entry.id, true),
      {class:'pilot-place-choice', 'data-entry':entry.id, 'data-place':entry.placeId??'', 'aria-pressed':String(session.selectedId===entry.id)})));
  }
  const points = () => model.mapEntries.map(e => ({id:e.id,placeId:e.placeId,name:e.name,label:entryLabel(e),
    latitude:e.place.latitude,longitude:e.place.longitude,number:e.markerNumber,alternative:e.kind==='alternative'}));
  function resize() {requestAnimationFrame(() => {if (!disposed && session.mode === 'map') controller?.resize();});}
  const observer = new ResizeObserver(resize); observer.observe(surface);
  function start() {
    if (disposed || !model.mapEntries.length) return;
    session.activated = true; controller?.dispose(); controller = null; canvas.replaceChildren();
    mode('map', false); activate.hidden = true; canvas.hidden = false;
    controller = createGeographicMap({container:canvas,points:points(),selectedId:session.selectedId,
      regionName:bundle.regions.find(r=>r.regionId===regionId)?.name??'Region',camera:session.cameras[regionId],
      onSelect:id=>select(id,true),onChooseGroup:chooseGroup,
      onCamera:camera=>{session.cameras[regionId]=camera;session.camera=camera;},
      onStatus:(status,text)=>{
        if(disposed)return;mapStatus=status;region.dataset.mapStatus=status;
        message.textContent=text;failure.hidden=status==='ready';retry.hidden=viewPlaces.hidden=status!=='failed';
        controls.hidden=status!=='ready';
        if(status==='failed'){canvas.hidden=true;mode('list',false);
          if(document.activeElement===document.body||mapView.contains(document.activeElement))retry.focus({preventScroll:true});}
      }});
  }
  function mode(value, mayStart = true) {
    if(currentMode==='list')session.listScrollTop=listView.scrollTop;
    currentMode=value;session.mode=value;region.dataset.mode=value;
    if(region.closest('main'))region.closest('main').dataset.exploreMode=value;
    mapButton.setAttribute('aria-pressed',String(value==='map'));listButton.setAttribute('aria-pressed',String(value==='list'));
    mapView.hidden=value!=='map';listView.hidden=value!=='list';
    if(value==='map'){
      if(mayStart&&session.activated&&(!controller||mapStatus==='failed'))start();else resize();
    }else {
      const scrollTop = session.listScrollTop ?? 0; restoringList = true;
      requestAnimationFrame(()=>{if(!disposed&&session.mode==='list')listView.scrollTop=scrollTop;
        requestAnimationFrame(()=>{restoringList=false;});});
    }
  }
  function update(nextModel, {frame = false, selectedId = session.selectedId} = {}) {
    const oldRegion=regionId; model=nextModel;regionId=model.regionId;
    regionSelect.replaceChildren(...model.regions.map(r=>el('option',{value:r.regionId},r.name)));
    regionSelect.value=regionId??'';regionSelect.disabled=!model.regions.length;
    resultCount.textContent=`${model.entries.length} results · ${model.mapEntries.length} on map`;
    session.selectedId=reconcileExploreSelection(entries(),selectedId);
    empty.hidden=!!model.mapEntries.length;activate.hidden=!!session.activated||!model.mapEntries.length;
    refreshChoices();renderCards();select(session.selectedId);
    if(!session.selectedId){cardPosition.textContent='0 / 0';previous.disabled=next.disabled=true;syncSelection();}
    controller?.update({points:points(),selectedId:session.selectedId,
      regionName:bundle.regions.find(r=>r.regionId===regionId)?.name??'Region',
      camera:oldRegion!==regionId?session.cameras[regionId]:null,fit:frame||oldRegion!==regionId});
    if(session.activated&&!controller&&currentMode==='map'&&model.mapEntries.length)start();
  }
  region.append(el('div',{class:'explore-top'},el('h1',{},'Explore'),
    el('div',{class:'pilot-switch',role:'group','aria-label':'Map or place list'},mapButton,listButton)),
    options.filters,el('div',{class:'pilot-context'},regionSelect,resultCount,placePicker),failure,mapView,listView,selected);
  controls.hidden=true;canvas.hidden=true;update(model);
  requestAnimationFrame(()=>{if(!disposed){mode(session.mode??'map');if(session.returnFocusId){
    const id=session.returnFocusId;session.returnFocusId=null;
    const target=session.mode==='list'?[...listView.querySelectorAll('[data-entry]')].find(n=>n.dataset.entry===id)?.querySelector('.place-select'):
      cards.find(c=>c.dataset.entry===id)?.querySelector('button');target?.focus({preventScroll:true});
  }}});
  return {element:region,select,syncSelection,update,
    dispose(){if(currentMode==='list')session.listScrollTop=listView.scrollTop;
      disposed=true;clearTimeout(scrollTimer);observer.disconnect();controller?.dispose();}};
}
