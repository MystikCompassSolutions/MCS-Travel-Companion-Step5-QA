import {el, button, card, field} from './dom.js';
import {loadSamplePack} from '../domain/content.js';
import {chooseOption, resolveDay, selectedOptions, effectiveOptions, optionScheduleItems,
  calendarDay, currentTripDay} from '../domain/itinerary.js';
import {adjacentDayIndex, swipeDayDirection} from './day-navigation.js';
import {exploreFilterChoices} from './explore-navigation.js';
import {travelerEstimate, actualBudget, availableUpgradeCosts, formatMoney, parseMoney, currencyDigits,
  convertPlanningEstimate} from '../domain/budget.js';
import {newTravelerState, createTravelerStore, reconcileContent, serializeTravelerState,
  parseTravelerExport, EXPORT_LIMIT_BYTES, STATE_VERSION, ConflictError, CorruptStateError} from '../storage/traveler-state.js';
import {createTabCoordinator} from '../storage/tab-coordination.js';
import {loadRuntimeContracts} from './runtime-contracts.js';
import {registerOffline, repairAppFiles} from '../offline/register.js';

const main = document.querySelector('#main');
const appScroll = document.querySelector('#app-scroll');
const dialog = document.querySelector('#personal');
const personal = document.querySelector('#personal-content');
const connection = document.querySelector('#connection');
const sync = document.querySelector('#sync');
const appUpdate = document.querySelector('#app-update');
const myTripButton = document.querySelector('#my-trip');
let bundle, state, store, coordinator, schemas = {}, view = 'Home', dayIndex = 0;
let packName = 'japan', saveQueue = Promise.resolve(), offlineStatus = '', storageIssue = null;
let itineraryScrollTop = 0;
let exploreFilter = 'all', personalPageScrollTop = 0;

function keepFocusedFieldVisible() {
  const field = document.activeElement;
  if (!field?.matches?.('input, select, textarea')) return;
  const inTrip = dialog.open && dialog.contains(field);
  const scroll = inTrip ? personal : appScroll;
  if (!scroll.contains(field)) return;
  const viewport = window.visualViewport;
  if (viewport?.scale > 1.01) return; // Leave deliberate pinch zoom under the traveler's control.
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportBottom = viewportTop + (viewport?.height ?? innerHeight);
  const bounds = scroll.getBoundingClientRect();
  const headerBottom = inTrip ? dialog.querySelector('.personal-header').getBoundingClientRect().bottom : bounds.top;
  const top = Math.max(bounds.top, headerBottom, viewportTop) + 12;
  const navTop = inTrip ? Infinity : document.querySelector('#nav').getBoundingClientRect().top;
  const bottom = Math.min(bounds.bottom, viewportBottom, navTop) - 12;
  const rect = field.getBoundingClientRect();
  if (bottom <= top) return;
  if (rect.bottom > bottom) scroll.scrollTop += rect.bottom - bottom;
  else if (rect.top < top) scroll.scrollTop -= top - rect.top;
}
document.addEventListener('focusin', event => {
  if (event.target.matches?.('input, select, textarea')) requestAnimationFrame(keepFocusedFieldVisible);
});
window.visualViewport?.addEventListener('resize', () => requestAnimationFrame(keepFocusedFieldVisible));
window.visualViewport?.addEventListener('scroll', () => requestAnimationFrame(keepFocusedFieldVisible));

function status() {
  connection.textContent = navigator.onLine ? (offlineStatus || 'Preparing offline sample…') :
    'Offline · Saved sample content and local trip data are available. Outside links and maps need internet.';
}
addEventListener('online', status);
addEventListener('offline', status);
dialog.addEventListener('close', () => {
  appScroll.style.overflowY = '';
  appScroll.scrollTop = personalPageScrollTop;
  myTripButton.focus({preventScroll: true});
});
dialog.addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const focusable = [...dialog.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]')]
    .filter(element => {
      const closed = element.closest('details:not([open])');
      return !element.disabled && element.tabIndex >= 0 && element.getClientRects().length &&
        (!closed || closed.querySelector(':scope > summary') === element);
    });
  if (!focusable.length) return;
  const first = focusable[0], last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last.focus();}
  else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first.focus();}
});

function alert(message, target = dialog.open ? personal : main) {
  target.prepend(el('p', {class: 'error', role: 'alert'}, message));
}
function syncNotice(message, actions = []) {
  sync.replaceChildren(el('p', {role: 'alert'}, message), ...actions);
}
function clearSync() {sync.replaceChildren();}
function currentDay() {
  return currentTripDay(state.tripStartDate, bundle.days.length, bundle.trip.defaultTimezone);
}
function resetDay() {dayIndex = currentDay().index;}

async function reloadLatest() {
  await saveQueue.catch(() => {});
  const loaded = await store.load(bundle.trip.tripId);
  state = reconcileContent(loaded ?? newTravelerState(bundle), bundle).state;
  storageIssue = null;
  resetDay(); clearSync(); render();
  if (dialog.open) myTrip();
}

async function handleSaveFailure(error, transform) {
  if (error instanceof ConflictError) {
    try {
      await reloadLatest();
      syncNotice(error.message, [button('Retry my change', () => {
        clearSync(); commit(transform).then(() => {if (dialog.open) myTrip();}).catch(() => {});
      }), button('Keep latest trip', clearSync)]);
    } catch (reloadError) {alert(reloadError.message);}
    return;
  }
  alert(error.message);
}

function commit(transform) {
  const operation = saveQueue.catch(() => {}).then(async () => {
    if (storageIssue) throw new Error('This trip is read-only until local storage is available or recovered.');
    const next = transform(state);
    const saved = await store.save(next);
    state = saved;
    coordinator?.publish(saved.revision);
    render();
    return saved;
  });
  saveQueue = operation;
  operation.catch(error => {void handleSaveFailure(error, transform);});
  return operation;
}

function go(name) {view = name; if (name === 'Home') resetDay(); render(); appScroll.scrollTop = 0; main.focus();}
function disclosure(title, body, {id, open = false, className = ''} = {}) {
  return el('details', {class: `compact-disclosure ${className}`, 'data-section': id, open},
    el('summary', {}, title), el('div', {class: 'disclosure-body'}, body));
}
function badges(activity) {
  return el('div', {}, activity.badgeIds.slice(0, 3).map(id =>
    el('span', {class: 'badge'}, bundle.badges.find(badge => badge.badgeId === id).label)));
}
function estimates() {
  return Object.entries(travelerEstimate(bundle, state)).map(([currency, total]) => {
    const range = total.maximumMinor === null ? `from ${formatMoney(total.minimumMinor, currency)}` :
      `${formatMoney(total.minimumMinor, currency)}${total.maximumMinor !== total.minimumMinor ?
        '–' + formatMoney(total.maximumMinor, currency) : ''}`;
    return el('p', {}, `MCS estimate per traveler: ${range} ${currency}`,
      total.unknownCosts ? ` · ${total.unknownCosts} unpriced` : '');
  });
}
function dayLabel(day) {
  const date = calendarDay(state.tripStartDate, day.dayNumber);
  return `Day ${day.dayNumber}${date ? ' · ' + date : ''} — ${day.title}`;
}
function home() {
  const today = currentDay(); const day = bundle.days[today.index];
  const upcoming = resolveDay(bundle, state, day)
    .map(item => bundle.activities.find(activity => activity.activityId === item.referencedEntityId))
    .find(activity => activity?.reservationInfo?.reservationLevel !== undefined &&
      activity.reservationInfo.reservationLevel !== 'none');
  const phase = {unscheduled: 'Set a start date in My Trip to show your current day.',
    upcoming: 'Your trip has not started yet.', active: 'Current day in the destination time zone.',
    past: 'Your trip dates have passed; showing the final day.'}[today.phase];
  return [el('section', {class: 'home-hero'}, el('p', {class: 'section-kicker'}, bundle.trip.title),
    el('h1', {}, 'Your trip, day by day.')),
  el('section', {class: 'compact-section home-day'},
    el('p', {class: 'section-kicker'}, today.phase === 'active' ? 'Today' : 'Your plan'),
    el('h2', {}, dayLabel(day)), el('p', {}, phase),
    button('Continue Today’s Plan', () => {dayIndex = today.index; go('Itinerary');}, {class: 'primary'})),
  upcoming ? el('section', {class: 'compact-section'}, el('p', {class: 'section-kicker'}, 'Next reservation to review'),
    button(upcoming.name, () => detail(upcoming), {class: 'text-action'})) : null,
  el('section', {class: 'compact-section'}, el('h2', {}, 'Budget at a glance'), ...estimates(),
    el('p', {}, `Spent: ${formatMoney(actualBudget(state).spentMinor, state.homeCurrency)}`)),
  el('div', {class: 'row'}, button('Emergency Help', () => info(true), {class: 'text-action'})),
  disclosure('Sample content packs', field('Choose a content pack', el('select', {onChange: event => {void switchPack(event.target.value);}},
    ['japan', 'iceland'].map(name => el('option', {value: name, selected: name === packName},
      name === 'japan' ? 'Japan sample' : 'Iceland sample')))), {id: 'sample-packs'})];
}

function optionGroup(group, headingTag = 'h2') {
  const chosen = selectedOptions(bundle, state, group).map(option => option.optionId);
  const choices = group.optionIds.filter(id => id !== group.baseOptionId);
  return card(el(headingTag, {}, group.title),
    el('p', {}, group.travelerPrompt ?? 'Choose an authored alternative.'),
    group.baseOptionId ? el('p', {}, `Included: ${bundle.options.find(option => option.optionId === group.baseOptionId).title}`) : null,
    el('div', {class: 'row'}, choices.map(id => {
      const option = bundle.options.find(candidate => candidate.optionId === id);
      const pressed = chosen.includes(id);
      return button(option.title, () => {
        const ids = group.selectionMode === 'single' ? [id] :
          pressed ? chosen.filter(value => value !== id) : [...chosen, id];
        commit(current => chooseOption(bundle, current, group.optionGroupId, ids))
          .then(() => {if (dialog.open) myTrip();}).catch(() => {});
      }, {'aria-pressed': String(pressed), disabled: !!storageIssue});
    })), el('small', {}, 'Selections stay on this device and update the schedule and sample estimate.'));
}

function timelineTime(item) {
  if (item.suggestedStartTime) return el('time', {dateTime: item.suggestedStartTime}, item.suggestedStartTime);
  return el('span', {}, item.timeWindowLabel ?? (item.suggestedTimeMode === 'all_day' ? 'All day' : 'Flexible'));
}

function timelineRow(item, choice = null) {
  const activity = item.itemType === 'activity' ?
    bundle.activities.find(candidate => candidate.activityId === item.referencedEntityId) : null;
  const transport = item.itemType === 'transport' ?
    bundle.transport.find(candidate => candidate.transportId === item.referencedEntityId) : null;
  let content;
  if (choice) {
    content = choice;
  } else if (activity) {
    const completed = state.activityCompletion[activity.activityId] ?? false;
    const title = button(activity.name, () => {itineraryScrollTop = appScroll.scrollTop; detail(activity);},
      {class: 'timeline-title'});
    const complete = button(completed ? '✓ Completed' : '○ Complete', () => {
      const scroll = appScroll.scrollTop;
      commit(current => ({...current, activityCompletion: {...current.activityCompletion,
        [activity.activityId]: !completed}})).then(() => {
        appScroll.scrollTop = scroll;
        [...main.querySelectorAll('[data-completion-id]')]
          .find(control => control.getAttribute('data-completion-id') === activity.activityId)?.focus({preventScroll: true});
      }).catch(() => {});
    }, {class: 'timeline-complete', 'aria-label': `Complete ${activity.name}`,
      'aria-pressed': String(completed), 'data-completion-id': activity.activityId, disabled: !!storageIssue});
    content = el('div', {class: 'timeline-content'},
      el('div', {class: 'timeline-activity-header'}, el('h3', {}, title), complete),
      el('p', {class: 'timeline-meta'},
        activity.recommendedDurationMinutes ? `${activity.recommendedDurationMinutes} min` : 'Flexible duration',
        activity.indoorOutdoor ? ` · ${activity.indoorOutdoor}` : ''), badges(activity));
  } else if (transport) {
    content = el('div', {class: 'timeline-content'},
      el('span', {class: 'timeline-kind'}, 'Transport'),
      el('h3', {class: 'timeline-transition-title'}, item.displayLabelOverride ?? transport.mode),
      el('p', {class: 'timeline-meta'},
        transport.durationMinutes ? `Approx. ${transport.durationMinutes} min` : 'Travel time flexible',
        transport.routeSummary ? ` · ${transport.routeSummary}` : ''));
  } else {
    const lodging = item.itemType === 'lodging' ?
      bundle.lodgingGuidance.find(candidate => candidate.lodgingGuideId === item.referencedEntityId) : null;
    const title = item.displayLabelOverride ?? lodging?.name ??
      ({meal: 'Meal break', free_time: 'Free time', note: 'Day note', lodging: 'Lodging'}[item.itemType] ?? 'Flexible stop');
    content = el('div', {class: 'timeline-content'},
      el('span', {class: 'timeline-kind'}, item.itemType.replaceAll('_', ' ')),
      el('strong', {class: 'timeline-quiet-title'}, title),
      item.transitionNotes ? el('p', {class: 'timeline-meta'}, item.transitionNotes) : null);
  }
  return el('li', {class: `timeline-item timeline-${choice ? 'choice' : item.itemType.replaceAll('_', '-')}`,
    'data-item-type': item.itemType},
  el('div', {class: 'timeline-time'}, timelineTime(item)),
  el('span', {class: 'timeline-rail', 'aria-hidden': true}, el('span', {class: 'timeline-dot'})), content);
}

function dayTimeline(day) {
  const rows = day.scheduleItems.flatMap(item => {
    if (item.itemType !== 'option_group') return [timelineRow(item)];
    const group = bundle.optionGroups.find(candidate => candidate.optionGroupId === item.referencedEntityId);
    const selection = optionGroup(group, 'h3');
    selection.classList.add(group.requiredSelection ? 'timeline-choice-card' : 'timeline-choice-inline');
    return [timelineRow(item, selection),
      ...effectiveOptions(bundle, state, group).flatMap(option => optionScheduleItems(option, item).map(entry => timelineRow(entry)))];
  });
  return el('ol', {class: 'timeline', 'aria-label': `Day ${day.dayNumber} timeline`}, rows);
}

function itinerary() {
  const total = bundle.days.length;
  const today = currentDay();
  const previous = button('‹', () => selectDay(adjacentDayIndex(dayIndex, -1, total), true),
    {class: 'day-arrow', 'aria-label': 'Previous day'});
  const next = button('›', () => selectDay(adjacentDayIndex(dayIndex, 1, total), true),
    {class: 'day-arrow', 'aria-label': 'Next day'});
  const chips = bundle.days.map((day, index) => {
    const chip = button('', () => selectDay(index), {class: 'day-chip'});
    chip.append(el('span', {}, `Day ${day.dayNumber}`));
    if (today.phase === 'active' && today.index === index) {
      chip.append(el('small', {}, 'Today'));
      chip.setAttribute('aria-current', 'date');
    }
    return chip;
  });
  const strip = el('div', {class: 'day-strip', role: 'group', 'aria-label': 'Itinerary days'}, chips);
  const navigator = el('div', {class: 'day-navigator', 'aria-label': 'Choose an itinerary day'}, previous, strip, next);
  const status = el('p', {class: 'visually-hidden', role: 'status', 'aria-live': 'polite'});
  const panel = el('section', {class: 'day-panel', 'aria-labelledby': 'day-panel-title'});

  function paint(announce = false) {
    const day = bundle.days[dayIndex];
    previous.disabled = dayIndex === 0;
    next.disabled = dayIndex === total - 1;
    chips.forEach((chip, index) => chip.setAttribute('aria-pressed', String(index === dayIndex)));
    panel.replaceChildren(...[el('h2', {id: 'day-panel-title'}, dayLabel(day)),
      day.pace || day.expectedWalkingLevel ? el('p', {class: 'day-meta'},
        [day.pace, day.expectedWalkingLevel ? `${day.expectedWalkingLevel} walking` : null].filter(Boolean).join(' · ')) : null,
      day.weatherNotes || day.summary ? el('p', {class: 'day-summary'}, day.weatherNotes ?? day.summary) : null,
      dayTimeline(day)].filter(Boolean));
    if (announce) status.textContent = `Showing Day ${day.dayNumber} of ${total}: ${day.title}`;
    requestAnimationFrame(() => {
      const chip = chips[dayIndex];
      strip.scrollLeft = chip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2;
    });
  }
  function selectDay(index, focusChip = false) {
    if (index === dayIndex) return;
    dayIndex = index;
    paint(true);
    appScroll.scrollTop = 0;
    if (focusChip) chips[dayIndex].focus({preventScroll: true});
  }
  strip.addEventListener('keydown', event => {
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!direction && !['Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? total - 1 :
      adjacentDayIndex(dayIndex, direction, total);
    selectDay(index, true);
  });
  function enableSwipe(target, includeControls = false) {
    let start = null;
    target.addEventListener('touchstart', event => {
      if (event.touches.length !== 1 || (!includeControls && event.target.closest('button, input, select, textarea, a'))) return;
      start = {x: event.touches[0].clientX, y: event.touches[0].clientY};
    }, {passive: true});
    target.addEventListener('touchend', event => {
      if (!start || !event.changedTouches.length) return;
      const direction = swipeDayDirection(start,
        {x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY});
      start = null;
      if (direction) selectDay(adjacentDayIndex(dayIndex, direction, total));
    }, {passive: true});
    target.addEventListener('touchcancel', () => {start = null;});
  }
  enableSwipe(strip, true);
  enableSwipe(panel);
  paint();
  return [el('h1', {}, 'Itinerary'), navigator, status, panel];
}

function upgradeChoices(activity) {
  return (activity.optionalUpgradeIds ?? []).map(id => {
    const cost = bundle.costs.find(candidate => candidate.costId === id);
    const selected = state.selectedUpgradeIds.includes(id);
    return field(`${cost.label} · ${formatMoney(cost.fixedMinor ?? cost.minimumMinor ?? 0, cost.currency)} ${cost.basis.replaceAll('_', ' ')}`,
      el('input', {type: 'checkbox', checked: selected, disabled: !!storageIssue,
        onChange: event => {
          const checked = event.target.checked;
          commit(current => ({...current, selectedUpgradeIds: checked ?
            [...new Set([...current.selectedUpgradeIds, id])] : current.selectedUpgradeIds.filter(value => value !== id)}))
            .then(() => {if (dialog.open) myTrip();}).catch(() => {});
        }}));
  });
}

function detail(activity) {
  if (view !== 'Itinerary') itineraryScrollTop = 0;
  view = 'Itinerary'; renderNav();
  const place = bundle.places.find(candidate => candidate.placeId === activity.placeId);
  const nodes = [button('Back to day', () => {go('Itinerary'); appScroll.scrollTop = itineraryScrollTop;}),
    el('h1', {}, activity.name), badges(activity),
    el('p', {class: 'detail-summary'}, activity.summary),
    el('div', {class: 'detail-facts'},
      el('span', {}, activity.recommendedDurationMinutes ? `${activity.recommendedDurationMinutes} minutes` : 'Flexible duration'),
      el('span', {}, activity.indoorOutdoor ?? 'Environment not verified')),
    el('div', {class: 'detail-actions'},
      place ? button('See in Explore', () => go('Explore'), {class: 'text-action'}) : null,
      place && navigator.onLine ? el('a', {class: 'text-action',
        href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name + ' ' + (place.address ?? ''))}`,
        target: '_blank', rel: 'noopener noreferrer'}, 'Open external map') : null),
    el('section', {class: 'compact-section'}, el('h2', {}, 'MCS note'),
      el('p', {}, activity.mcsNote ?? 'Detailed guidance pending content research.')),
    place ? disclosure('Location', el('p', {}, place.address ?? 'Address pending verification'), {id: 'location'}) : null,
    activity.reservationInfo ? disclosure('Booking', el('p', {}, activity.reservationInfo.bookAheadGuidance), {id: 'booking'}) : null,
    activity.whatToBring?.length ? disclosure('What to bring',
      el('ul', {}, activity.whatToBring.map(item => el('li', {}, item))), {id: 'bring'}) : null,
    activity.inclusions?.length ? disclosure('Included',
      el('ul', {}, activity.inclusions.map(item => el('li', {}, item))), {id: 'inclusions'}) : null,
    activity.exclusions?.length ? disclosure('Not included',
      el('ul', {}, activity.exclusions.map(item => el('li', {}, item))), {id: 'exclusions'}) : null,
    activity.accessibilityNotes ? disclosure('Accessibility',
      el('p', {}, activity.accessibilityNotes), {id: 'accessibility'}) : null,
    activity.optionalUpgradeIds?.length ? disclosure('Optional sample upgrades',
      [el('p', {}, 'Fictional planning values; confirm current availability and prices.'), ...upgradeChoices(activity)],
      {id: 'upgrades'}) : null,
    ...bundle.optionGroups.filter(group => group.optionIds.some(id =>
      bundle.options.find(option => option.optionId === id)?.activityIds.includes(activity.activityId)))
      .map(group => disclosure(group.title, optionGroup(group), {id: `option-${group.optionGroupId}`}))];
  main.replaceChildren(...nodes.filter(Boolean)); main.focus();
}

function explore() {
  const today = currentDay();
  const todayIndex = today.phase === 'active' ? today.index : null;
  let selectedDay = exploreFilter.startsWith('day:') ? Number(exploreFilter.slice(4)) : null;
  if (selectedDay !== null && (!Number.isInteger(selectedDay) || selectedDay < 0 || selectedDay >= bundle.days.length)) {
    exploreFilter = 'all'; selectedDay = null;
  }
  if (exploreFilter === 'today' && todayIndex === null) exploreFilter = 'all';
  const filters = exploreFilterChoices(bundle.days.length, todayIndex, selectedDay);
  if (!filters.some(filter => filter.id === exploreFilter) && selectedDay === null) exploreFilter = 'all';
  const picks = new Set(bundle.badges.filter(badge => badge.label === 'MCS PICK').map(badge => badge.badgeId));
  const alternatives = new Set(bundle.optionGroups.flatMap(group => group.optionIds
    .filter(id => id !== group.defaultOptionId && id !== group.baseOptionId)
    .flatMap(id => bundle.options.find(option => option.optionId === id)?.activityIds ?? [])));
  const chips = filters.map(filter => button(filter.label,
    () => filter.id === 'days' ? togglePicker() : select(filter.id),
    {class: 'filter-chip', 'aria-pressed': String(filter.id === exploreFilter ||
      (filter.id === 'days' && exploreFilter.startsWith('day:'))),
      'aria-label': filter.id === 'days' ? 'Choose itinerary day' : `Show ${filter.label} places`,
      ...(filter.id === 'days' ? {'aria-expanded': 'false', 'aria-controls': 'explore-day-picker'} : {})}));
  const strip = el('div', {class: 'filter-strip', role: 'group', 'aria-label': 'Explore place filters'}, chips);
  const daysChip = chips[filters.findIndex(filter => filter.id === 'days')];
  const picker = el('section', {id: 'explore-day-picker', class: 'explore-day-picker',
    'aria-label': 'Choose a day to filter places', hidden: true},
    el('div', {class: 'explore-day-picker-head'}, el('strong', {}, 'Itinerary days'),
      button('Clear day filter', () => {select('all', true);closePicker();}, {class: 'text-action'})),
    el('div', {class: 'explore-day-list'}, bundle.days.map((day, index) =>
      button(`Day ${day.dayNumber} · ${day.title}`, () => {
        selectedDay = index; select(`day:${index}`, true); closePicker();
      }, {'aria-label': `Show places for Day ${day.dayNumber}: ${day.title}`}))));
  const activeDay = el('p', {class: 'explore-active-day', hidden: true});
  function closePicker() {picker.hidden = true;daysChip.setAttribute('aria-expanded', 'false');daysChip.focus({preventScroll: true});}
  function togglePicker() {
    picker.hidden = !picker.hidden;
    daysChip.setAttribute('aria-expanded', String(!picker.hidden));
    if (!picker.hidden) picker.querySelector('button').focus({preventScroll: true});
  }
  picker.addEventListener('keydown', event => {if (event.key === 'Escape') {event.preventDefault();closePicker();}});
  const list = el('ul', {class: 'place-list'});
  const results = el('p', {class: 'visually-hidden', role: 'status', 'aria-live': 'polite'});
  function matches(place) {
    const activities = bundle.activities.filter(activity => activity.placeId === place.placeId);
    if (exploreFilter === 'all') return true;
    if (exploreFilter.startsWith('day:') || exploreFilter === 'today') {
      const index = exploreFilter === 'today' ? todayIndex : Number(exploreFilter.slice(4));
      return resolveDay(bundle, state, bundle.days[index]).some(item =>
        activities.some(activity => activity.activityId === item.referencedEntityId));
    }
    if (exploreFilter === 'picks') return activities.some(activity => activity.badgeIds.some(id => picks.has(id)));
    if (exploreFilter === 'alternatives') return activities.some(activity => alternatives.has(activity.activityId));
    return place.category === exploreFilter;
  }
  function update(announce = false) {
    chips.forEach((chip, index) => chip.setAttribute('aria-pressed', String(filters[index].id === exploreFilter ||
      (filters[index].id === 'days' && exploreFilter.startsWith('day:')))));
    daysChip.textContent = selectedDay === null ? 'Days ▾' : `Day ${bundle.days[selectedDay].dayNumber} ▾`;
    activeDay.hidden = !exploreFilter.startsWith('day:');
    if (!activeDay.hidden) activeDay.replaceChildren(`Showing Day ${bundle.days[selectedDay].dayNumber}: ${bundle.days[selectedDay].title} · `,
      button('Clear filter', () => select('all', true), {class: 'text-action'}));
    const places = bundle.places.filter(matches);
    list.replaceChildren(...places.map(place => {
      const activities = bundle.activities.filter(activity => activity.placeId === place.placeId);
      return el('li', {class: 'place-row'}, el('h2', {}, place.name),
        el('p', {}, place.address ?? 'Address pending verification'),
        el('div', {class: 'place-actions'},
          ...activities.map(activity => button(activities.length === 1 ? 'Details' : activity.name, () => detail(activity),
            {class: 'text-action', 'aria-label': `Activity detail: ${activity.name}`})),
          navigator.onLine ? el('a', {class: 'text-action',
            href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name + ' ' + (place.address ?? ''))}`,
            target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Open external map for ${place.name}`}, 'Map ↗') :
            el('small', {}, 'Map needs internet')));
    }));
    if (!places.length) list.append(el('li', {class: 'place-row'}, 'No mapped places in this sample filter.'));
    if (announce) results.textContent = `${places.length} ${places.length === 1 ? 'place' : 'places'} for ${
      exploreFilter.startsWith('day:') ? `Day ${bundle.days[selectedDay].dayNumber}` :
        filters.find(filter => filter.id === exploreFilter).label}.`;
  }
  function select(id, focus = false) {
    if (!id.startsWith('day:')) selectedDay = null;
    exploreFilter = id; update(true);
    const index = filters.findIndex(filter => filter.id === (id.startsWith('day:') ? 'days' : id));
    const chip = chips[index];
    strip.scrollLeft = chip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2;
    if (focus) chip.focus({preventScroll: true});
  }
  strip.addEventListener('keydown', event => {
    const index = filters.findIndex(filter => filter.id ===
      (exploreFilter.startsWith('day:') ? 'days' : exploreFilter));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? filters.length - 1 :
      event.key === 'ArrowRight' ? Math.min(filters.length - 1, index + 1) :
      event.key === 'ArrowLeft' ? Math.max(0, index - 1) : -1;
    if (next < 0) return;
    event.preventDefault();
    if (filters[next].id === 'days') {chips[next].focus({preventScroll: true});return;}
    select(filters[next].id, true);
  });
  update();
  requestAnimationFrame(() => {const chip = chips[filters.findIndex(filter => filter.id ===
    (exploreFilter.startsWith('day:') ? 'days' : exploreFilter))];
    strip.scrollLeft = chip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2;});
  return [el('h1', {}, 'Explore'), strip, picker, activeDay, results, list];
}

function budgetEstimate(total, currency, activeRate) {
  const range = total.maximumMinor === null ? `from ${formatMoney(total.minimumMinor, currency)}` :
    `${formatMoney(total.minimumMinor, currency)}${total.maximumMinor !== total.minimumMinor ?
      `–${formatMoney(total.maximumMinor, currency)}` : ''}`;
  let conversion = null;
  if (activeRate?.fromCurrency === currency) {
    const min = convertPlanningEstimate(total.minimumMinor, currency, state.homeCurrency,
      activeRate.homePerDestination);
    const max = total.maximumMinor === null ? null : convertPlanningEstimate(total.maximumMinor,
      currency, state.homeCurrency, activeRate.homePerDestination);
    conversion = el('p', {class: 'planning-conversion'}, `≈ ${formatMoney(min, state.homeCurrency)}${
      max !== null && max !== min ? `–${formatMoney(max, state.homeCurrency)}` : ''} ${state.homeCurrency}`);
  }
  return el('div', {class: 'estimate-row'},
    el('p', {class: 'section-kicker'}, 'MCS estimate · per traveler'),
    el('p', {class: 'compact-value'}, `${range} ${currency}`), conversion,
    total.unknownCosts ? el('small', {}, `${total.unknownCosts} unpriced item${total.unknownCosts === 1 ? '' : 's'}`) : null);
}

function budget() {
  const actual = actualBudget(state);
  const total = el('input', {type: 'text', inputmode: 'decimal', required: true,
    value: String(state.budgetPlan.totalMinor / (10 ** currencyDigits(state.homeCurrency)))});
  const form = el('form', {class: 'inline-form', onSubmit: event => {
    event.preventDefault();
    try {const value = parseMoney(total.value, state.homeCurrency);
      commit(current => ({...current, budgetPlan: {...current.budgetPlan, totalMinor: value}})).catch(() => {});
    } catch (error) {alert(error.message);}
  }}, field(`My total budget (${state.homeCurrency})`, total),
  el('button', {type: 'submit', disabled: !!storageIssue}, 'Save budget'));
  const amount = el('input', {type: 'text', inputmode: 'decimal', required: true});
  const expenseCurrency = el('select', {}, ['USD', 'JPY', 'ISK', 'EUR', 'GBP', 'CAD', 'AUD'].map(value =>
    el('option', {value, selected: value === state.homeCurrency}, value)));
  const converted = el('input', {type: 'text', inputmode: 'decimal'});
  const note = el('input', {type: 'text', maxLength: 1000});
  const category = el('select', {}, ['activity', 'transport', 'lodging', 'food', 'shopping', 'other'].map(value =>
    el('option', {value}, value)));
  const expenseForm = el('form', {onSubmit: event => {
    event.preventDefault();
    try {
      const currency = expenseCurrency.value;
      const expense = {id: `expense_${crypto.randomUUID()}`, date: new Date().toISOString().slice(0, 10),
        category: category.value, amountMinor: parseMoney(amount.value, currency), currency, note: note.value};
      if (currency !== state.homeCurrency && converted.value) expense.convertedHomeMinor = parseMoney(converted.value, state.homeCurrency);
      commit(current => ({...current, actualExpenses: [...current.actualExpenses, expense]})).catch(() => {});
    } catch (error) {alert(error.message);}
  }}, field('Expense amount', amount), field('Expense currency', expenseCurrency),
  field(`Manual converted amount in ${state.homeCurrency} (optional)`, converted),
  field('Category', category), field('Expense note', note),
  el('button', {type: 'submit', disabled: !!storageIssue}, 'Add expense'));
  const expenses = el('ul', {}, state.actualExpenses.map(expense => el('li', {},
    `${expense.category}: ${formatMoney(expense.amountMinor, expense.currency)} · ${expense.note ?? ''}`,
    button(`Remove ${expense.category} expense`, () => {
      if (confirm('Remove this expense from this device?')) commit(current => ({...current,
        actualExpenses: current.actualExpenses.filter(entry => entry.id !== expense.id)})).catch(() => {});
    }, {disabled: !!storageIssue}))));
  const upgrades = availableUpgradeCosts(bundle, state);
  const estimate = travelerEstimate(bundle, state);
  const destinationCurrency = Object.keys(estimate)[0] ?? bundle.costs[0]?.currency;
  const activeRate = state.planningRate?.fromCurrency === destinationCurrency &&
    state.planningRate.toCurrency === state.homeCurrency ? state.planningRate : null;
  const rateInput = el('input', {type: 'text', inputmode: 'decimal', pattern: '(?:0|[1-9][0-9]{0,5})(?:\\.[0-9]{1,8})?',
    placeholder: 'e.g. 0.0067', required: true, value: activeRate?.homePerDestination ?? ''});
  const rateForm = destinationCurrency && destinationCurrency !== state.homeCurrency ?
    el('form', {class: 'inline-form', onSubmit: event => {
      event.preventDefault();
      try {
        convertPlanningEstimate(1, destinationCurrency, state.homeCurrency, rateInput.value.trim());
        commit(current => ({...current, planningRate: {fromCurrency: destinationCurrency,
          toCurrency: current.homeCurrency, homePerDestination: rateInput.value.trim(),
          recordedAt: new Date().toISOString()}})).catch(() => {});
      } catch (error) {alert(error.message);}
    }}, field(`Planning rate: 1 ${destinationCurrency} equals how many ${state.homeCurrency}?`, rateInput),
    el('button', {type: 'submit', disabled: !!storageIssue}, activeRate ? 'Update rate' : 'Save rate')) : null;
  const estimateRows = Object.entries(estimate).map(([currency, total]) =>
    budgetEstimate(total, currency, activeRate));
  return [el('h1', {}, 'Budget'),
    el('section', {class: 'budget-overview'},
      el('div', {class: 'budget-estimates'}, estimateRows),
      activeRate ? el('p', {class: 'day-meta'}, `Using planning rate 1 ${destinationCurrency} = ${activeRate.homePerDestination} ${state.homeCurrency} · Recorded ${activeRate.recordedAt.slice(0, 10)}. Approximate; not a current bank or card rate.`) : null,
      el('div', {class: 'my-budget-total'}, el('p', {class: 'section-kicker'}, `My budget · ${state.homeCurrency}`),
        el('p', {class: 'compact-value'}, formatMoney(state.budgetPlan.totalMinor, state.homeCurrency))),
      el('dl', {class: 'budget-metrics'},
        el('div', {}, el('dt', {}, 'Spent'), el('dd', {}, formatMoney(actual.spentMinor, state.homeCurrency))),
        el('div', {}, el('dt', {}, 'Remaining'), el('dd', {}, formatMoney(actual.remainingMinor, state.homeCurrency)))),
      actual.unconverted.length ? el('p', {class: 'day-meta'}, `${actual.unconverted.length} other-currency expense${actual.unconverted.length === 1 ? '' : 's'} not included yet.`) : null,
    ),
    disclosure('Set my budget', form, {id: 'set-budget'}),
    disclosure('Planning rate / currency settings', [
      el('p', {}, 'Home currency is set in My Trip. Destination estimates stay in their authored currency.'),
      rateForm ? el('p', {}, 'Use a rate you recorded for planning. Converted amounts are approximate and can differ from bank or card charges.') :
        el('p', {}, 'Your home and destination currency match; no conversion is needed.'),
      rateForm], {id: 'planning-rate'}),
    disclosure('How estimates work', [el('p', {}, 'Sample costs are fictional. This is a solo-traveler planning estimate. Authored group, one-way and round-trip costs are shown at their full value; no shared cost is automatically split.'),
      el('p', {}, 'My budget, spent and remaining are individual amounts in Home Currency. For shared lodging, transport or meals, record only your personal share as an actual expense. Unpriced and open-ended costs are flagged.')], {id: 'estimate-rules'}),
    upgrades.length ? disclosure('Optional upgrades', [el('p', {}, 'Only upgrades for selected activities appear here.'),
      ...upgrades.flatMap(entry => upgradeChoices(entry.activity))], {id: 'upgrades'}) : null,
    disclosure('Add actual spending', [el('p', {}, 'For a shared cost, enter only your personal share. No automatic splitting.'), expenseForm], {id: 'add-expense'}),
    disclosure(`Spending history · ${state.actualExpenses.length}`, expenses, {id: 'expenses'})].filter(Boolean);
}

function info(emergencyOnly = false) {
  if (emergencyOnly) {view = 'Info'; renderNav();}
  const nodes = [el('h1', {}, emergencyOnly ? 'Emergency Help' : 'Travel Info'),
    el('p', {class: 'day-meta'}, 'Sample information is unverified; confirm current official guidance before travel.'),
    ...bundle.emergencyResources.map(resource => el('section', {class: 'compact-section'},
      el('p', {class: 'section-kicker'}, 'Emergency help'), el('h2', {}, resource.organizationName),
      el('p', {}, resource.instructions), el('strong', {}, 'Pending verification · No emergency number is supplied.'))),
    ...(!emergencyOnly ? [disclosure('Traveler requirements', el('p', {}, bundle.trip.internationalBuyerNotice), {id: 'traveler-requirements'}),
      ...bundle.travelInfo.map(article => disclosure(article.title,
        article.contentBlocks.map(block => el('p', {}, block.text ?? block.items?.join(' · ') ?? '')),
        {id: article.articleId}))] : [])];
  if (emergencyOnly) {main.replaceChildren(...nodes); main.focus();}
  return nodes;
}

const bookingFields = {
  personalFlights: [['name', 'Flight label', 'text'], ['airline', 'Airline', 'text'],
    ['flightNumber', 'Flight number', 'text'], ['origin', 'Origin', 'text'], ['destination', 'Destination', 'text'],
    ['departureDateTime', 'Departure date and time', 'datetime-local'], ['arrivalDateTime', 'Arrival date and time', 'datetime-local'],
    ['confirmationCode', 'Confirmation code', 'text'], ['notes', 'Notes', 'textarea']],
  personalLodging: [['name', 'Lodging label', 'text'], ['address', 'Address', 'text'],
    ['checkInDate', 'Check-in date', 'date'], ['checkOutDate', 'Check-out date', 'date'],
    ['phone', 'Phone', 'tel'], ['confirmationCode', 'Confirmation code', 'text'], ['notes', 'Notes', 'textarea']],
  personalReservations: [['name', 'Reservation label', 'text'], ['dateTime', 'Reservation date and time', 'datetime-local'],
    ['activityId', 'Related activity (optional)', 'activity'], ['paymentStatus', 'Payment status', 'text'],
    ['confirmationCode', 'Confirmation code', 'text'], ['notes', 'Notes', 'textarea']]
};

function bookingForm(key, label, existing = null) {
  const inputs = Object.fromEntries(bookingFields[key].map(([name, caption, type]) => {
    const input = type === 'textarea' ? el('textarea', {maxLength: 10000, value: existing?.[name] ?? ''}) :
      type === 'activity' ? el('select', {}, el('option', {value: ''}, 'None'),
        bundle.activities.map(activity => el('option', {value: activity.activityId,
          selected: existing?.[name] === activity.activityId}, activity.name))) :
        el('input', {type, value: existing?.[name] ?? '', maxLength: 1000, required: name === 'name'});
    return [name, {caption, input}];
  }));
  return el('form', {onSubmit: event => {
    event.preventDefault();
    const entry = {...existing, id: existing?.id ?? `personal_${crypto.randomUUID()}`};
    for (const [name, {input}] of Object.entries(inputs)) {
      if (input.value.trim()) entry[name] = input.value.trim(); else delete entry[name];
    }
    if (key === 'personalFlights' && entry.departureDateTime && entry.arrivalDateTime &&
        entry.arrivalDateTime < entry.departureDateTime) {alert('Arrival must be after departure.', personal); return;}
    if (key === 'personalLodging' && entry.checkInDate && entry.checkOutDate &&
        entry.checkOutDate < entry.checkInDate) {alert('Check-out must be after check-in.', personal); return;}
    if (key === 'personalReservations' && entry.activityId &&
        !bundle.activities.some(activity => activity.activityId === entry.activityId)) {
      alert('Choose an activity from this sample or leave it blank.', personal); return;
    }
    commit(current => ({...current, [key]: existing ? current[key].map(item => item.id === existing.id ? entry : item) :
      [...current[key], entry]})).then(myTrip).catch(() => {});
  }}, ...Object.values(inputs).map(({caption, input}) => field(caption, input)),
  el('button', {type: 'submit'}, existing ? `Save ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`));
}

function bookingSection(key, label) {
  return disclosure(el('span', {}, label, el('small', {}, ` · ${state[key].length} saved`)), [
    ...state[key].map(entry => el('div', {class: 'booking-entry'},
      el('strong', {}, entry.name ?? entry.id),
      el('details', {}, el('summary', {}, `Edit ${entry.name ?? label}`), bookingForm(key, label, entry)),
      button(`Remove ${entry.name ?? label}`, () => {
        if (confirm(`Remove this ${label.toLowerCase()} entry from this device?`))
          commit(current => ({...current, [key]: current[key].filter(item => item.id !== entry.id)}))
            .then(myTrip).catch(() => {});
      }))),
    el('details', {}, el('summary', {}, `Add ${label.toLowerCase()}`), bookingForm(key, label))],
  {id: key, className: 'trip-disclosure'});
}

function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], {type: 'application/json'}));
  const link = el('a', {href: url, download: filename}); link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function showPersonal() {
  if (dialog.open) return;
  personalPageScrollTop = appScroll.scrollTop;
  appScroll.style.overflowY = 'hidden';
  dialog.showModal();
  dialog.querySelector('.close').focus({preventScroll: true});
}

function myTrip() {
  const openSections = new Set([...personal.querySelectorAll('details[data-section][open]')]
    .map(section => section.dataset.section));
  const scroll = dialog.open ? personal.scrollTop : 0;
  personal.replaceChildren(el('p', {class: 'day-meta'}, 'Private to this device · Export a backup before changing browsers.'),
    el('p', {id: 'save-status', role: 'status'}, ''));
  if (storageIssue) {
    personal.append(el('p', {class: 'error', role: 'alert'}, storageIssue.message));
    if (storageIssue instanceof CorruptStateError) personal.append(
      button('Download unreadable data for recovery', () =>
        downloadText(`${bundle.trip.tripId}.recovery.json`, JSON.stringify(storageIssue.raw, null, 2))),
      button('Reset unreadable data for this trip', async () => {
        if (!confirm('Reset this trip’s unreadable local data? Download a recovery copy first if you may need it.')) return;
        try {await store.remove(bundle.trip.tripId); storageIssue = null; state = newTravelerState(bundle);
          coordinator?.publish(0); clearSync(); render(); myTrip();} catch (error) {alert(error.message, personal);}
      }));
    else personal.append(button('Retry local storage', () => {
      reloadLatest().then(myTrip).catch(error => alert(error.message, personal));
    }));
    personal.append(button('Repair app files (keep My Trip data)', () => {
      repairAppFiles().catch(error => alert(error.message, personal));
    }));
    showPersonal();
    return;
  }
  const note = el('textarea', {maxLength: 10000, value: state.notes.trip ?? ''});
  const start = el('input', {type: 'date', value: state.tripStartDate ?? ''});
  const currency = el('select', {}, ['USD', 'JPY', 'ISK', 'EUR', 'GBP', 'CAD', 'AUD'].map(value =>
    el('option', {value, selected: value === state.homeCurrency}, value)));
  personal.append(el('form', {class: 'personal-essentials', onSubmit: event => {
    event.preventDefault();
    if (currency.value !== state.homeCurrency &&
        (state.budgetPlan.totalMinor > 0 || state.actualExpenses.length ||
          Object.values(state.budgetPlan.categoryMinor).some(value => value > 0))) {
      alert('Clear your budget and expenses before changing home currency; amounts are never automatically converted.', personal);
      return;
    }
    commit(current => {
      const next = {...current, notes: {...current.notes, trip: note.value}, homeCurrency: currency.value};
      if (currency.value !== current.homeCurrency) delete next.planningRate;
      if (start.value) next.tripStartDate = start.value; else delete next.tripStartDate;
      return next;
    }).then(() => {resetDay(); render(); myTrip(); document.querySelector('#save-status').textContent = 'Saved on this device.';}).catch(() => {});
  }}, field('Trip start date (optional)', start), field('Home currency', currency),
  field('Personal notes', note), el('button', {type: 'submit'}, 'Save My Trip')));
  for (const [key, label] of [['personalFlights', 'Flights'], ['personalLodging', 'Lodging'],
    ['personalReservations', 'Reservations']]) personal.append(bookingSection(key, label));
  const packing = el('input', {required: true, maxLength: 1000});
  personal.append(disclosure(el('span', {}, 'Packing Checklist', el('small', {},
    ` · ${state.packingChecklist.filter(item => item.checked).length} / ${state.packingChecklist.length}`)), [
    ...state.packingChecklist.map(item => el('div', {class: 'packing-row'},
      field(item.label, el('input', {type: 'checkbox', checked: item.checked, onChange: event => {
        const checked = event.target.checked;
        commit(current => ({...current, packingChecklist: current.packingChecklist.map(entry =>
          entry.id === item.id ? {...entry, checked} : entry)})).then(myTrip).catch(() => {});
      }})), button(`Remove ${item.label}`, () => {
        if (confirm(`Remove ${item.label} from your packing list?`))
          commit(current => ({...current, packingChecklist: current.packingChecklist.filter(entry => entry.id !== item.id)}))
            .then(myTrip).catch(() => {});
      }))),
    el('form', {onSubmit: event => {
      event.preventDefault(); const item = {id: `packing_${crypto.randomUUID()}`, label: packing.value, checked: false};
      commit(current => ({...current, packingChecklist: [...current.packingChecklist, item]})).then(myTrip).catch(() => {});
    }}, field('Packing item', packing), el('button', {type: 'submit'}, 'Add item'))],
  {id: 'packing', className: 'trip-disclosure'}));
  personal.append(disclosure('Chosen Alternatives', bundle.optionGroups.map(group => optionGroup(group)),
    {id: 'alternatives', className: 'trip-disclosure'}));
  const backupBody = el('div');
  backupBody.append(button('Export My Trip', () => {
    try {downloadText(`${state.tripId}.traveler-state.json`, serializeTravelerState(state, schemas.export));}
    catch (error) {alert(error.message, personal);}
  }));
  const file = el('input', {type: 'file', accept: '.json,application/json', onChange: async event => {
    try {
      const selected = event.target.files[0]; if (!selected) return;
      if (selected.size > EXPORT_LIMIT_BYTES) throw new Error('Import exceeds the 2 MiB limit.');
      const imported = parseTravelerExport(await selected.text(), bundle.trip.tripId, schemas.export,
        schemas.legacyExport, schemas.legacyTraveler);
      const preview = card(el('h2', {}, 'Review import'),
        el('p', {}, `This replaces this trip’s local data with a backup for ${imported.tripId}. ${imported.actualExpenses.length} expenses and ${imported.personalReservations.length} reservations.`),
        button('Replace local trip with this backup', () => commit(current =>
          reconcileContent({...imported, revision: current.revision}, bundle).state).then(myTrip).catch(() => {})),
        button('Cancel import', () => preview.remove()));
      backupBody.append(preview);
    } catch (error) {alert(error.message, personal);}
  }});
  backupBody.append(field('Import My Trip · review before replacing', file));
  backupBody.append(button('Delete this trip’s local data', () => {
    if (confirm('Delete this trip’s personal data from this browser? Export a backup first if you want to keep it.'))
      commit(current => ({...newTravelerState(bundle), revision: current.revision})).then(myTrip).catch(() => {});
  }));
  if (navigator.storage?.persist) backupBody.append(button('Ask browser to keep local trip data', async () => {
    try {const granted = await navigator.storage.persist();
      document.querySelector('#save-status').textContent = granted ?
        'This browser granted persistent local storage. Backups are still recommended.' :
        'Persistent storage was not granted. Export backups regularly.';
    } catch {document.querySelector('#save-status').textContent = 'Persistent storage could not be requested. Export backups regularly.';}
  }));
  backupBody.append(button('Repair app files (keep My Trip data)', () => {
    repairAppFiles().catch(error => alert(error.message, personal));
  }));
  personal.append(disclosure('Backup / Export / Import', backupBody, {id: 'backup', className: 'trip-disclosure'}));
  personal.append(disclosure('About this app', el('p', {},
    `App build ${document.querySelector('meta[name="mcs-build-version"]')?.content ?? 'development'} · Traveler State ${STATE_VERSION}`),
  {id: 'about', className: 'trip-disclosure'}));
  for (const section of personal.querySelectorAll('details[data-section]'))
    if (openSections.has(section.dataset.section)) section.open = true;
  showPersonal();
  personal.scrollTop = scroll;
}

function navIcon(name) {
  const paths = {
    Home: 'M3 10 12 3l9 7v11h-6v-6H9v6H3z',
    Itinerary: 'M4 5h16v16H4z M4 10h16 M8 3v4 M16 3v4',
    Explore: 'M12 21s7-5.5 7-12a7 7 0 0 0-14 0c0 6.5 7 12 7 12z M12 9a2 2 0 1 0 0 4a2 2 0 1 0 0-4',
    Budget: 'M3 7h18v14H3z M3 7V4h15 M16 12h5 M16 15h2',
    Info: 'M12 22a10 10 0 1 0 0-20a10 10 0 1 0 0 20z M12 11v6 M12 7h.01'
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'nav-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', paths[name]);
  svg.append(path);
  return svg;
}
function renderNav() {
  document.querySelector('#nav').replaceChildren(...['Home', 'Itinerary', 'Explore', 'Budget', 'Info']
    .map(name => {
      const tab = button(name, () => go(name), {'aria-current': view === name ? 'page' : undefined});
      tab.replaceChildren(navIcon(name), el('span', {class: 'nav-label'}, name));
      return tab;
    }));
}
function render() {
  if (!bundle) return;
  document.documentElement.dataset.theme = bundle.trip.defaultThemeId;
  renderNav();
  main.replaceChildren(...({Home: home, Itinerary: itinerary, Explore: explore, Budget: budget, Info: info}[view] ?? home)()
    .filter(Boolean));
}

async function switchPack(name) {
  try {
    await saveQueue.catch(() => {});
    const next = await loadSamplePack(name, schemas.content);
    coordinator?.close();
    let loaded; storageIssue = null;
    try {loaded = await store.load(next.trip.tripId);} catch (error) {storageIssue = error;}
    const result = reconcileContent(loaded ?? newTravelerState(next), next);
    bundle = next; state = result.state; packName = name; view = 'Home'; exploreFilter = 'all';
    try {localStorage.setItem('mcs-active-sample', name);} catch {}
    resetDay(); clearSync(); render();
    coordinator = createTabCoordinator(bundle.trip.tripId, revision => {
      if (revision !== state.revision) syncNotice('Another tab changed this trip. Reload before making more edits.',
        [button('Reload latest trip', () => {void reloadLatest().catch(error => alert(error.message));})]);
    });
    if (storageIssue) alert(storageIssue.message);
    if (result.changedItems.length) alert('Some saved items changed in this content revision. Previous choices remain in exports.');
  } catch (error) {if (!bundle) throw error; alert(error.message);}
}

async function start() {
  try {
    schemas = await loadRuntimeContracts();
    store = createTravelerStore(schemas.traveler, globalThis.indexedDB, schemas.legacyTraveler);
    try {const remembered = localStorage.getItem('mcs-active-sample');
      if (['japan', 'iceland'].includes(remembered)) packName = remembered;
    } catch {}
    await switchPack(packName);
    myTripButton.addEventListener('click', () => {saveQueue.then(myTrip).catch(error => alert(error.message));});
    try {await registerOffline(message => {offlineStatus = message; status();}, apply => {
      appUpdate.hidden = false;
      appUpdate.replaceChildren(el('span', {}, 'New version available · Your saved trip stays on this device.'),
        button('Update now', () => {
          saveQueue.then(apply).catch(error => alert(error.message));
        }), button('Later', () => {appUpdate.hidden = true;}));
    }, message => syncNotice(message,
      [button('Repair app files', () => repairAppFiles().catch(error => alert(error.message)))]));}
    catch (error) {offlineStatus = `Offline setup failed: ${error.message}`;}
    status();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !storageIssue && bundle) {
        store.load(bundle.trip.tripId).then(latest => {
          if (latest && latest.revision !== state.revision)
            syncNotice('Another tab changed this trip. Reload before making more edits.',
              [button('Reload latest trip', () => {void reloadLatest().catch(error => alert(error.message));})]);
        }).catch(error => alert(error.message));
        if (view === 'Home') {resetDay(); render();}
      }
    });
  } catch (error) {
    main.replaceChildren(el('h1', {}, 'The app could not start'),
      el('p', {class: 'error', role: 'alert'}, error.message),
      el('p', {}, 'Your local trip data has not been cleared.'),
      button('Repair app files (keep My Trip data)', () => repairAppFiles().catch(repairError => alert(repairError.message))));
    connection.textContent = 'Reconnect to repair the app files. Your trip data stays on this device.';
  }
}
start();
