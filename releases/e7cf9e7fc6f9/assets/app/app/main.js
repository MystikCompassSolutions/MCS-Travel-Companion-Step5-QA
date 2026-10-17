import {el, button, card, field} from './dom.js';
import {loadSamplePack} from '../domain/content.js';
import {chooseOption, resolveDay, selectedOptions, effectiveOptions, optionScheduleItems,
  calendarDay, currentTripDay} from '../domain/itinerary.js';
import {adjacentDayIndex, swipeDayDirection} from './day-navigation.js';
import {exploreFilterChoices} from './explore-navigation.js';
import {exploreMapPreview, previewLocationNote} from './explore-map-preview.js';
import {projectExplore} from '../domain/explore.js';
import {actualBudget, formatMoney, formatHomeMoney} from '../domain/budget.js';
import {budgetView} from './budget-view.js';
import {newTravelerState, createTravelerStore, reconcileContent, serializeTravelerState,
  parseTravelerExport, EXPORT_LIMIT_BYTES, STATE_VERSION, ConflictError, CorruptStateError} from '../storage/traveler-state.js';
import {createTabCoordinator} from '../storage/tab-coordination.js';
import {loadRuntimeContracts} from './runtime-contracts.js';
import {registerOffline, repairAppFiles} from '../offline/register.js';
import {icon, mediaImage, mediaCredits, homeHeroMediaId, budgetProgress} from './visual.js';
import {activityCostPresentation, copyAddressText, editorialText, activityPresentationVariant, activityPresentationFamily,
  activityEditorialContent, nearbyInspirationItems, curatedCollection} from './activity-detail.js';
import {homeTripPresentation} from './home-trip.js';
import {primaryHeaderSurfaces, updateHeaderSurface} from './shared-header.js';
import {loadSamplePhrasebook} from '../domain/phrases.js';
import {travelInfoView} from './travel-info-view.js';
import {myTripView} from './my-trip-view.js';
import {itineraryContext} from '../domain/itinerary-context.js';
import {flightContextView, lodgingContextView} from './itinerary-context-view.js';

const main = document.querySelector('#main');
const appScroll = document.querySelector('#app-scroll');
const dialog = document.querySelector('#personal');
const personal = document.querySelector('#personal-content');
const connection = document.querySelector('#connection');
const sync = document.querySelector('#sync');
const appUpdate = document.querySelector('#app-update');
const myTripButton = document.querySelector('#my-trip');
const appHeader = document.querySelector('#app-header');
let bundle, state, store, coordinator, schemas = {}, view = 'Home', dayIndex = 0;
let phrasebook = null, phraseError = false, infoTopic = null, infoReturnScroll = 0, infoFromHome = false;
let packName = 'japan', saveQueue = Promise.resolve(), offlineStatus = '', storageIssue = null;
let itineraryScrollTop = 0;
let homePreviewIndex = null;
let exploreScope = {dayId: null, category: 'all', regionId: null};
let personalPageScrollTop = 0;
let tripSession = {page: 'overview', edit: null, scroll: {}};
let collectionMapContext = null;
let activeMapPreview = null;
let exploreSession = {mode: 'map', activated: false, selectedId: null, camera: null, listScrollTop: 0};
let exploreReturn = null;

function fitDetailOverlays() {
  if (main.dataset.screen === 'Home') {
    const notice = document.querySelector('.notice'), root = document.documentElement;
    root.style.setProperty('--home-notice-top', `${appHeader.offsetHeight + 8}px`);
    root.style.setProperty('--home-connection-top', `${notice.offsetTop + notice.offsetHeight + 8}px`);
    const last = navigator.onLine ? notice : connection;
    root.style.setProperty('--home-overlay-clearance', `${last.offsetTop + last.offsetHeight + 12}px`);
    return;
  }
  if (!main.dataset.screen?.startsWith('detail-')) return;
  const header = document.querySelector('header'), notice = document.querySelector('.notice');
  const root = document.documentElement;
  const coverHeaderHeight = appHeader.dataset.surface === 'dark-media' ? header.offsetHeight : 0;
  root.style.setProperty('--detail-notice-top', `${coverHeaderHeight + 8}px`);
  const noticeBottom = notice?.offsetHeight ? notice.offsetTop + notice.offsetHeight : coverHeaderHeight;
  root.style.setProperty('--detail-connection-top', `${noticeBottom + 8}px`);
  const last = navigator.onLine ? notice : connection;
  const overlayBottom = last?.offsetHeight ? last.offsetTop + last.offsetHeight : coverHeaderHeight;
  root.style.setProperty('--detail-overlay-clearance', `${overlayBottom + 12}px`);
}
// Observe rendered text rather than guessing banner height at large text sizes.
const detailOverlayObserver = new ResizeObserver(fitDetailOverlays);
for (const overlay of [document.querySelector('header'), document.querySelector('.notice'), connection])
  detailOverlayObserver.observe(overlay);

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
  connection.dataset.state = navigator.onLine ? 'online' : 'offline';
  connection.textContent = navigator.onLine ? (offlineStatus.replace(/^Sample content/, 'Content') || 'Preparing offline content…') :
    'Offline · Saved content and local trip data are available. Outside links and maps need internet.';
}
addEventListener('online', status);
addEventListener('offline', status);
dialog.addEventListener('close', () => {
  appScroll.style.overflowY = '';
  appScroll.scrollTop = personalPageScrollTop;
  myTripButton.focus({preventScroll: true});
  // Native focus restoration and text-resize layout can finish after `close`.
  requestAnimationFrame(() => {
    if (!dialog.open && document.activeElement === myTripButton) appScroll.scrollTop = personalPageScrollTop;
  });
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
function resetDay() {dayIndex = currentDay().index; homePreviewIndex = null;}

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

function go(name) {if(name==='Info'){infoTopic=null;infoFromHome=false;} view = name; render(); appScroll.scrollTop = 0; main.focus({preventScroll: true});}
function disclosure(title, body, {id, open = false, className = ''} = {}) {
  return el('details', {class: `compact-disclosure ${className}`, 'data-section': id, open},
    el('summary', {}, el('span', {class: 'disclosure-title'}, title)), el('div', {class: 'disclosure-body'}, body));
}
function badges(activity, className = '') {
  return el('div', {class: `badge-list ${className}`.trim()}, activity.badgeIds.slice(0, 3).map(id =>
    {const badge = bundle.badges.find(badge => badge.badgeId === id);
      return el('span', {class: `badge badge-${badge.semanticType}`}, badge.label);}));
}
function experienceTags(activity, light) {
  const tagIcons = {Historic: 'culture', Peaceful: 'leaf', Photogenic: 'camera', Outdoor: 'tree',
    Attraction: 'compass', Playful: 'leaf', Mixed: 'map'};
  return activity.experienceTags?.length ? el('div', {class: 'experience-tags', role: 'group',
    'aria-label': 'Experience characteristics'}, activity.experienceTags.map(tag =>
    el('span', {class: 'experience-tag'}, light && tagIcons[tag] ? icon(tagIcons[tag]) : null,
      el('span', {class: 'experience-tag-label'}, tag)))) : null;
}
function dayLabel(day) {
  const date = calendarDay(state.tripStartDate, day.dayNumber);
  return `Day ${day.dayNumber}${date ? ' · ' + date : ''} — ${editorialText(day.title)}`;
}
function home() {
  const presentation = homeTripPresentation(state.tripStartDate, bundle.days.length,
    bundle.trip.defaultTimezone, homePreviewIndex);
  const today = presentation.lifecycle; const day = bundle.days[presentation.index];
  const personalBudget = actualBudget(state);
  const personalProgress = budgetProgress(personalBudget.spentMinor, state.budgetPlan.totalMinor);
  const hasPersonalBudget = state.budgetPlan.totalMinor > 0;
  const showHomeBudget = state.preferences?.homeBudgetVisible !== false;
  const upcoming = resolveDay(bundle, state, day)
    .map(item => bundle.activities.find(activity => activity.activityId === item.referencedEntityId))
    .find(activity => activity?.reservationInfo?.reservationLevel !== undefined &&
      activity.reservationInfo.reservationLevel !== 'none');
  const activities = resolveDay(bundle, state, day).map(item =>
    bundle.activities.find(activity => activity.activityId === item.referencedEntityId)).filter(Boolean);
  const defaultHeroMediaId = bundle.media[0]?.mediaId;
  const heroMediaId = homeHeroMediaId(bundle, today);
  const budgetSnapshot = showHomeBudget ? el('section',
    {class: `compact-section home-snapshot home-budget-card${hasPersonalBudget ? '' : ' home-budget-empty'}`},
    el('a', {class: 'home-budget-link', href: '#budget', 'aria-label': hasPersonalBudget ?
      'Open my trip budget' : 'Set my trip budget', onClick: event => {event.preventDefault(); go('Budget');}},
    icon('Budget', 'snapshot-icon'),
    el('div', {class: 'home-budget-copy'}, el('p', {class: 'section-kicker'}, `My Trip Budget · ${state.homeCurrency}`),
      el('h2', {}, hasPersonalBudget ?
        `${formatHomeMoney(personalBudget.spentMinor, state.homeCurrency)} spent / ${formatHomeMoney(state.budgetPlan.totalMinor, state.homeCurrency)} budget` :
        'Set my budget'),
      hasPersonalBudget ? el('progress', {class: 'home-budget-progress', max: 100, value: personalProgress.arc,
        'aria-label': personalProgress.label}) : null,
      hasPersonalBudget ? el('p', {class: 'home-budget-meta'},
        el('span', {}, `${personalProgress.percent}% spent`),
        el('span', {}, personalBudget.remainingMinor >= 0 ?
          `${formatHomeMoney(personalBudget.remainingMinor, state.homeCurrency)} remaining` :
          `${formatHomeMoney(Math.abs(personalBudget.remainingMinor), state.homeCurrency)} over budget`)) :
        el('p', {class: 'day-meta'}, 'Set a personal budget to see spending progress.'))),
    button('Hide', () => commit(current => ({...current, preferences: {...current.preferences,
      homeBudgetVisible: false}})).catch(() => {}), {class: 'home-budget-hide',
      'aria-label': 'Hide budget card from Home', disabled: !!storageIssue})) : null;
  return [el('section', {class: 'home-hero', 'aria-labelledby': 'home-destination-title'},
    mediaImage(bundle, heroMediaId, 'hero-image', false, defaultHeroMediaId),
    el('div', {class: 'hero-content'},
      el('h1', {id: 'home-destination-title'}, bundle.trip.title), el('p', {class: 'hero-subtitle'},
        `${bundle.days.length} days · ${bundle.regions.map(region => region.name).join(' + ')}`),
      presentation.progress !== null ? el('progress', {class: 'trip-progress', max: bundle.days.length,
        value: presentation.progress, 'aria-label': 'Trip day progress'}) :
        el('div', {class: 'trip-lifecycle-rule', 'aria-hidden': 'true'}),
      el('p', {class: 'progress-caption'}, presentation.caption))),
  el('div', {class: 'home-content'},
    el('section', {class: 'compact-section home-day'},
      el('div', {class: 'home-day-copy'}, el('p', {class: 'section-kicker'}, presentation.kicker),
        el('h2', {}, editorialText(day.title)), el('p', {class: 'day-meta home-plan-status'},
          presentation.statusParts ? presentation.statusParts.map((part, index) =>
            [index ? ' ' : '', el('span', {class: 'home-status-part'}, `${index ? '· ' : ''}${part}`)]) : presentation.status)),
      activities[0] ? mediaImage(bundle, activities[0].heroMediaId, 'day-feature-image') : null,
      button(presentation.cta, () => {dayIndex = presentation.index; go('Itinerary');}, {class: 'primary gold-action'})),
    budgetSnapshot,
    upcoming ? el('section', {class: 'compact-section home-upcoming'},
      mediaImage(bundle, upcoming.heroMediaId, 'reservation-thumbnail', true),
      el('div', {}, el('p', {class: 'section-kicker'}, today.phase === 'past' ? 'Saved booking guidance' : 'Reservation to review'),
        button(editorialText(upcoming.name), () => detail(upcoming), {class: 'text-action'}),
        el('p', {class: 'day-meta'}, 'Review authored booking guidance')))
      : el('section', {class: 'compact-section home-upcoming home-upcoming-empty'}, icon('compass'),
        el('div', {}, el('p', {class: 'section-kicker'}, 'A little room to breathe'),
          el('p', {}, 'No reservation attention item for this day.'))),
    el('div', {class: 'row home-help'}, button('Emergency Help', () => info(true), {class: 'text-action'})),
    disclosure('Itinerary packs', field('Choose a content pack', el('select', {onChange: event => {void switchPack(event.target.value);}},
      ['japan', 'iceland'].map(name => el('option', {value: name, selected: name === packName},
        name === 'japan' ? 'Japan' : 'Iceland')))), {id: 'sample-packs'}))];
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
    })), el('small', {}, 'Selections stay on this device and update the schedule and estimate.'));
}

function timelineTime(item) {
  if (item.suggestedStartTime) return el('time', {dateTime: item.suggestedStartTime}, item.suggestedStartTime);
  return el('span', {}, item.timeWindowLabel ?? (item.suggestedTimeMode === 'all_day' ? 'All day' : 'Flexible'));
}

function timelineRow(item, choice = null) {
  const activity = ['activity', 'meal'].includes(item.itemType) ?
    bundle.activities.find(candidate => candidate.activityId === item.referencedEntityId) : null;
  const transport = item.itemType === 'transport' ?
    bundle.transport.find(candidate => candidate.transportId === item.referencedEntityId) : null;
  let content;
  if (choice) {
    content = choice;
  } else if (activity) {
    const completed = state.activityCompletion[activity.activityId] ?? false;
    const title = button(editorialText(activity.name), () => {itineraryScrollTop = appScroll.scrollTop; detail(activity);},
      {class: 'timeline-title'});
    const complete = button(completed ? '✓ Completed' : '○ Complete', () => {
      const scroll = appScroll.scrollTop;
      commit(current => ({...current, activityCompletion: {...current.activityCompletion,
        [activity.activityId]: !completed}})).then(() => {
        appScroll.scrollTop = scroll;
        [...main.querySelectorAll('[data-completion-id]')]
          .find(control => control.getAttribute('data-completion-id') === activity.activityId)?.focus({preventScroll: true});
      }).catch(() => {});
    }, {class: 'timeline-complete', 'aria-label': `Complete ${editorialText(activity.name)}`,
      'aria-pressed': String(completed), 'data-completion-id': activity.activityId, disabled: !!storageIssue});
    complete.replaceChildren(icon(completed ? 'done' : 'incomplete'));
    complete.title = completed ? 'Completed · Tap to undo' : 'Mark complete';
    content = el('div', {class: 'timeline-content'},
      mediaImage(bundle, activity.heroMediaId, 'timeline-thumbnail', true),
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
    const context = itineraryContext(state, day.dayNumber);
    previous.disabled = dayIndex === 0;
    next.disabled = dayIndex === total - 1;
    chips.forEach((chip, index) => chip.setAttribute('aria-pressed', String(index === dayIndex)));
    panel.replaceChildren(...[el('h2', {id: 'day-panel-title'}, dayLabel(day)),
      day.pace || day.expectedWalkingLevel ? el('p', {class: 'day-meta'},
        [day.pace, day.expectedWalkingLevel ? `${day.expectedWalkingLevel} walking` : null].filter(Boolean).join(' · ')) : null,
      day.weatherNotes || day.summary ? el('p', {class: 'day-summary'}, day.weatherNotes ?? day.summary) : null,
      flightContextView(context), dayTimeline(day), lodgingContextView(context)].filter(Boolean));
    if (announce) status.textContent = `Showing Day ${day.dayNumber} of ${total}: ${editorialText(day.title)}`;
    requestAnimationFrame(() => {
      const chip = chips[dayIndex];
      strip.scrollLeft = chip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2;
    });
  }
  function selectDay(index, focusChip = false) {
    homePreviewIndex = index;
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
    return field(`${editorialText(cost.label)} · ${formatMoney(cost.fixedMinor ?? cost.minimumMinor ?? 0, cost.currency)} ${cost.basis.replaceAll('_', ' ')}`,
      el('input', {type: 'checkbox', checked: selected, disabled: !!storageIssue,
        onChange: event => {
          const checked = event.target.checked;
          commit(current => ({...current, selectedUpgradeIds: checked ?
            [...new Set([...current.selectedUpgradeIds, id])] : current.selectedUpgradeIds.filter(value => value !== id)}))
            .then(() => {if (dialog.open) myTrip();}).catch(() => {});
        }}));
  });
}

function detailDuration(minutes) {
  if (!minutes) return null;
  const hours = Math.floor(minutes / 60), remainder = minutes % 60;
  return [hours ? `${hours} hr` : '', remainder ? `${remainder} min` : ''].filter(Boolean).join(' ');
}

function detailCost(activity) {
  const cost = activity.costIds.map(id => bundle.costs.find(candidate => candidate.costId === id)).find(Boolean);
  if (!cost) return null;
  const presentation = activityCostPresentation(cost, state);
  return {icon: 'Budget', label: 'Cost', value: presentation.primary,
    secondary: presentation.approximate ?? (presentation.conversionUnavailable ?
      `Home-currency estimate unavailable · set a planning rate in Budget` : null),
    className: 'detail-fact-cost'};
}

function detailFacts(activity) {
  const cost = detailCost(activity);
  const reservation = activity.reservationInfo?.reservationLevel;
  return [
    activity.recommendedDurationMinutes ? {icon: 'clock', label: 'Duration',
      value: detailDuration(activity.recommendedDurationMinutes)} : null,
    activity.indoorOutdoor ? {icon: 'compass', label: 'Setting', value: activity.indoorOutdoor} : null,
    cost,
    reservation && reservation !== 'none' ? {icon: 'documents', label: 'Reservation',
      value: reservation === 'required' ? 'Required' : 'Book ahead'} : null,
    activity.bestFor?.trim() ? {icon: 'walk', label: 'Best For', value: activity.bestFor} : null,
    activity.walkingLevel ? {icon: 'walk', label: 'Walking', value: activity.walkingLevel} : null
  ].filter(Boolean);
}

function verifiedAddress(place) {
  if (!place?.address) return null;
  const verified = (place.verificationRecordIds ?? []).some(id => {
    const record = bundle.verification.find(candidate => candidate.verificationId === id);
    return record?.status === 'verified' && record.fieldPath === 'address';
  });
  return verified ? place.address : null;
}

function addressControl(activity, address) {
  if (!address) return null;
  const statusId = `address-copy-${activity.activityId}`;
  const feedback = el('span', {id: statusId, class: 'address-copy-status', role: 'status',
    'aria-live': 'polite'});
  const control = el('button', {type: 'button', class: 'detail-address-copy',
    'aria-label': `Copy address: ${address}`, 'aria-describedby': statusId,
    title: 'Copy address', onClick: async () => {
      const copied = await copyAddressText(address, navigator.clipboard);
      feedback.textContent = copied ? 'Address copied' : 'Copy unavailable. Select the address and copy it.';
    }}, icon('copy'));
  return el('div', {class: 'detail-address'},
    el('div', {class: 'detail-address-row'}, el('p', {class: 'detail-address-text'}, address), control), feedback);
}

function detailActions(activity, place, className = 'detail-actions', editorial = false) {
  const officialWebsite = activity.officialWebsite ?? place?.officialWebsite;
  const collection = curatedCollection(activity, bundle);
  const actions = [place || collection ? button(editorial ? [icon('map'), 'Open Map'] : 'Open Map', () => {
    collectionMapContext = collection ? {title:activity.name,placeIds:collection.items.map(item=>item.place.placeId)} : null;
    if (collection) exploreScope = {dayId: null, category: 'all', regionId: null};
    go('Explore');
  },
    {class: 'primary gold-action', 'aria-label': `Open ${editorialText(activity.name)} in Explore map`}) : null,
  officialWebsite && navigator.onLine ? el('a', {class: 'secondary-action', href: officialWebsite,
    target: '_blank', rel: 'noopener noreferrer',
    'aria-label': `Open the official ${editorialText(activity.name)} website in a new tab`}, icon('external'), 'Official Site') :
    officialWebsite ? el('span', {class: 'unavailable-action'}, 'Official Site · Internet required') : null]
    .filter(Boolean);
  return actions.length ? el('div', {class: className}, actions) : null;
}

function collectionCards(activity, collection) {
  if (!collection) return null;
  const list = el('ol', {class:'collection-list'});
  const cards = collection.items.map(item => {
    const image = mediaImage(bundle, item.heroMediaId, 'collection-image', true);
    if (image) image.addEventListener('error', () => image.remove(), {once:true});
    const visual = el('span', {class:'collection-visual', 'aria-hidden':'true'},
      icon(collection.kind === 'food' ? 'food' : collection.kind === 'shopping' ? 'shopping' : 'Explore'),image);
    const children = [visual,el('span',{class:'collection-copy'},el('strong',{},item.place.name),
      item.place.neighborhood ? el('span',{class:'collection-location'},item.place.neighborhood) : null,
      el('span',{class:'collection-rationale'},item.description),
      item.needsInternet ? el('span',{class:'unavailable-action'},'Google Maps · Internet required') : null),
      item.target || item.url ? icon(item.target ? 'arrow' : 'external','ui-icon collection-arrow') : null];
    const props = {class:'collection-card'};
    const card = item.target ? button(children,()=>detail(item.target),{...props,'aria-label':`Explore ${item.place.name}`}) :
      item.url ? el('a',{...props,href:item.url,target:'_blank',rel:'noopener noreferrer',
        'aria-label':`Open ${item.place.name} on Google Maps in a new tab`},children) : el('div',props,children);
    return el('li',{},card);
  });
  list.append(...cards);
  // Never show a decorative See All control with no additional authored entries.
  const toggle = cards.length > 4 ? button(`Show all ${cards.length} places`,()=>{
    const expanded=toggle.getAttribute('aria-expanded')!=='true';
    cards.slice(4).forEach(card=>{card.hidden=!expanded;});
    toggle.setAttribute('aria-expanded',String(expanded));
    toggle.textContent=expanded ? 'Show fewer places' : `Show all ${cards.length} places`;
  },{class:'text-action collection-more','aria-expanded':'false','aria-controls':`collection-list-${activity.activityId}`}) : null;
  list.id=`collection-list-${activity.activityId}`;
  cards.slice(4).forEach(card=>{card.hidden=true;});
  return el('section',{class:'curated-collection','aria-labelledby':`collection-${activity.activityId}`},
    el('h2',{id:`collection-${activity.activityId}`},collection.heading),list,toggle);
}

function detailNearby(activity) {
  const items = nearbyInspirationItems(activity, bundle, navigator.onLine);
  if (!items.length) return null;
  return el('section', {class: 'detail-nearby', 'aria-labelledby': `nearby-${activity.activityId}`},
    el('h2', {id: `nearby-${activity.activityId}`}, 'Nearby Inspiration'), items.map(item => {
      const image = mediaImage(bundle, item.heroMediaId, 'nearby-image', true);
      const visual = el('span', {class: 'nearby-visual', 'aria-hidden': 'true'}, icon('Explore'), image);
      // A missing/broken derivative reveals a neutral location icon, not a
      // substitute photograph claiming to depict the recommended place.
      if (image) image.addEventListener('error', () => image.remove(), {once: true});
      const children = [visual, el('span', {class: 'nearby-copy'},
        el('strong', {}, item.title), item.locationLabel ? el('span', {class: 'nearby-location'}, item.locationLabel) : null,
        el('span', {class: 'nearby-rationale'}, item.description),
        item.needsInternet ? el('span', {class: 'unavailable-action'}, 'More about this place · Internet required') : null),
        item.target || item.url ? icon(item.target ? 'arrow' : 'external', 'ui-icon nearby-arrow') : null];
      if (item.target) return button(children, () => detail(item.target),
        {class: 'nearby-card', 'aria-label': `Explore ${item.title}`});
      if (item.url) return el('a', {class: 'nearby-card', href: item.url, target: '_blank',
        rel: 'noopener noreferrer', 'aria-label': `Explore ${item.title} in a new tab`}, children);
      return el('div', {class: 'nearby-card'}, children);
    }));
}

function detailDiscovery(activity) {
  if (!activity.externalLinks?.length) return null;
  return el('section', {class: 'detail-discovery', 'aria-labelledby': `discovery-${activity.activityId}`},
    el('h2', {id: `discovery-${activity.activityId}`}, 'Discover more'),
    navigator.onLine ? el('div', {class: 'detail-discovery-links'}, activity.externalLinks.map(link =>
      el('a', {class: 'text-action', href: link.url, target: '_blank', rel: 'noopener noreferrer',
        'aria-label': `${link.label} for ${editorialText(activity.name)} in a new tab`}, link.label, icon('external')))) :
      el('p', {class: 'unavailable-action'}, 'External discovery links require internet.'));
}

function detailAlternative(group, activity) {
  const chosen = selectedOptions(bundle, state, group).map(option => option.optionId);
  const candidateOption = group.optionIds.map(id => bundle.options.find(option => option.optionId === id))
    .find(option => option && !option.activityIds.includes(activity.activityId));
  const candidate = bundle.activities.find(item => candidateOption?.activityIds.includes(item.activityId));
  if (!candidateOption || !candidate) return null;
  const pressed = chosen.includes(candidateOption.optionId);
  const metadata = [detailDuration(candidate.recommendedDurationMinutes), candidate.indoorOutdoor].filter(Boolean);
  return el('section', {class: 'detail-alternative', 'aria-labelledby': `alternative-${group.optionGroupId}`},
    el('p', {class: 'section-kicker'}, 'Looking for an alternative?'),
    el('button', {type: 'button', onClick: () => {
      commit(current => chooseOption(bundle, current, group.optionGroupId, [candidateOption.optionId]))
        .catch(() => {});
    }, class: 'alternative-card', 'aria-pressed': String(pressed),
      'aria-label': `${pressed ? 'Selected' : 'Choose'} ${editorialText(candidate.name)}`,
      disabled: pressed || !!storageIssue},
      mediaImage(bundle, candidate.heroMediaId, 'alternative-image', true),
      el('div', {class: 'alternative-copy'},
        el('strong', {id: `alternative-${group.optionGroupId}`}, editorialText(candidate.name)),
        el('p', {}, candidateOption.subtitle ?? candidate.description ??
          'An MCS-authored option for the same itinerary slot.'),
        metadata.length ? el('p', {class: 'alternative-meta'}, metadata.join(' · ')) : null,
        pressed ? el('span', {class: 'alternative-selected'}, 'Selected for my trip') : null),
      el('span', {class: 'alternative-chevron', 'aria-hidden': 'true'}, '›')));
}

function detail(activity) {
  exploreReturn = view === 'Explore' ? {scrollTop: appScroll.scrollTop} : null;
  activeMapPreview?.dispose(); activeMapPreview = null;
  if (view !== 'Itinerary') itineraryScrollTop = 0;
  view = 'Itinerary'; renderNav();
  const place = bundle.places.find(candidate => candidate.placeId === activity.placeId);
  const collection = curatedCollection(activity, bundle, navigator.onLine);
  const tone = collection ? 'editorial' : activityPresentationVariant(activity);
  const light = collection || activityPresentationFamily(activity) === 'light';
  const editorial = activityEditorialContent(activity);
  main.dataset.screen = `detail-${tone}`;
  document.documentElement.dataset.screen = main.dataset.screen;
  // Every Detail cover has its own dark scrim/fallback, independent of the content family below.
  updateHeaderSurface(appHeader, 'dark-media');
  const media = bundle.media.find(asset => asset.mediaId === activity.heroMediaId);
  const region = bundle.regions.find(candidate => candidate.regionId === activity.regionId);
  const groups = bundle.optionGroups.filter(group => group.optionIds.some(id =>
    bundle.options.find(option => option.optionId === id)?.activityIds.includes(activity.activityId)));
  const facts = collection ? [] : detailFacts(activity);
  const address = verifiedAddress(place);
  const location = [place?.neighborhood, region?.name].filter((item, index, all) =>
    item && all.indexOf(item) === index).join(' · ');
  const primaryActions = detailActions(activity, place,
    light ? 'detail-actions editorial-actions' : editorial.note ? 'mcs-note-actions' : 'detail-actions',
    light);
  const heroImage = mediaImage(bundle, activity.heroMediaId, 'hero-image');
  if (collection && heroImage) heroImage.addEventListener('error',()=>heroImage.remove(),{once:true});
  const nodes = [el('section', {class: `detail-hero detail-hero-${tone}${collection ? ' collection-hero' : ''}`}, heroImage,
    collection && !heroImage ? el('span',{class:'collection-cover-symbol','aria-hidden':'true'},icon(collection.kind==='food'?'food':'shopping')) : null,
    button('‹', () => {
      const fromExplore = exploreReturn;
      go(fromExplore ? 'Explore' : 'Itinerary');
      appScroll.scrollTop = fromExplore?.scrollTop ?? itineraryScrollTop;
    }, {class: 'detail-back', 'aria-label': 'Back to itinerary day', title: 'Back to itinerary day',
      ...(exploreReturn ? {'aria-label': 'Back to Explore', title: 'Back to Explore'} : {})}),
    el('div', {class: 'hero-content'}, el('h1', {}, editorialText(activity.name)),
      location ? el('p', {class: 'detail-location'}, location) : null,
      addressControl(activity, address), collection ? el('span',{class:'badge collection-category'},collection.categoryLabel) :
        activity.badgeIds.length ? badges(activity, 'operational-badges') : null),
    media?.type === 'illustration' ? el('p', {class: 'image-placeholder-label'},
      'Illustrative placeholder · Not a photograph of this experience') : null),
    editorial.description || activity.experienceTags?.length || facts.length ?
      el('section', {class: 'detail-intro'}, experienceTags(activity, light),
      editorial.description ? el('p', {class: 'detail-summary'}, editorial.description) : null,
      facts.length ? el('div', {class: 'detail-facts', 'aria-label': 'Activity quick facts'}, facts.map(fact =>
        el('div', {class: `detail-fact ${fact.className ?? ''}`.trim()}, icon(fact.icon), el('span', {},
          el('small', {}, fact.label), el('strong', {}, fact.value),
          fact.secondary ? el('span', {class: 'detail-fact-secondary'}, fact.secondary) : null,
          fact.note ? el('span', {class: 'detail-fact-note'}, fact.note) : null)))) : null) : null,
    collectionCards(activity, collection),
    editorial.note ? el('section', {class: 'compact-section mcs-note'},
      el('h2', {}, icon('compass'), light ? 'MCS Note' : 'MCS note'),
      el('p', {}, editorial.note), light ? null : primaryActions) : light ? null : primaryActions,
    light ? primaryActions : null,
    ...groups.map(group => detailAlternative(group, activity)),
    detailNearby(activity),
    detailDiscovery(activity),
    place?.address && !address ? disclosure('Location', el('p', {}, place.address),
      {id: 'location'}) : null,
    editorial.booking ? disclosure('Booking', el('p', {}, editorial.booking), {id: 'booking'}) : null,
    activity.whatToBring?.length ? disclosure('What to bring',
      el('ul', {}, activity.whatToBring.map(item => el('li', {}, item))), {id: 'bring'}) : null,
    activity.inclusions?.length ? disclosure('Included',
      el('ul', {}, activity.inclusions.map(item => el('li', {}, item))), {id: 'inclusions'}) : null,
    activity.exclusions?.length ? disclosure('Not included',
      el('ul', {}, activity.exclusions.map(item => el('li', {}, item))), {id: 'exclusions'}) : null,
    activity.accessibilityNotes ? disclosure('Accessibility',
      el('p', {}, activity.accessibilityNotes), {id: 'accessibility'}) : null,
    activity.optionalUpgradeIds?.length ? disclosure('Optional upgrades',
      [el('p', {}, 'Confirm current availability and prices.'), ...upgradeChoices(activity)],
      {id: 'upgrades'}) : null,
    media?.sourceOwnership === 'external' ? disclosure('Image credit',
      mediaCredits({...bundle, media: [media]}), {id: 'image-credit'}) : null];
  main.replaceChildren(...nodes.filter(Boolean)); fitDetailOverlays();
  appScroll.scrollTop = 0; main.focus({preventScroll: true});
}

function explore() {
  const initial = projectExplore(bundle, state, exploreScope);
  if (initial.invalidToday) exploreScope.dayId = null;
  const todayIndex = initial.today ? bundle.days.findIndex(d => d.dayId === initial.today.dayId) : null;
  const selectedIndex = bundle.days.findIndex(d => d.dayId === exploreScope.dayId);
  const filters = exploreFilterChoices(bundle.days.length, todayIndex, selectedIndex < 0 ? null : selectedIndex);
  const chips = filters.map(filter => button(filter.label,
    () => filter.id === 'days' ? togglePicker() : chooseFilter(filter.id),
    {class: 'filter-chip', 'aria-pressed': 'false',
      'aria-label': filter.id === 'days' ? 'Choose itinerary day' : `Show ${filter.label} places`,
      ...(filter.id === 'days' ? {'aria-expanded': 'false', 'aria-controls': 'explore-day-picker'} : {})}));
  const strip = el('div', {class: 'filter-strip', role: 'group', 'aria-label': 'Explore place filters'}, chips);
  const daysChip = chips[filters.findIndex(f => f.id === 'days')];
  const picker = el('section', {id: 'explore-day-picker', class: 'explore-day-picker',
    'aria-label': 'Choose a day to filter places', hidden: true},
    el('div', {class: 'explore-day-picker-head'}, el('strong', {}, 'Itinerary days'),
      button('Clear day filter', () => {exploreScope.dayId = null; update(true, true); closePicker();}, {class:'text-action'})),
    el('div', {class:'explore-day-list'}, bundle.days.map(day =>
      button(`Day ${day.dayNumber} · ${editorialText(day.title)}`, () => {
        collectionMapContext = null; exploreScope.dayId = day.dayId; exploreScope.regionId = day.primaryRegionId;
        update(true, true); closePicker();
      }, {'aria-label':`Show places for Day ${day.dayNumber}: ${editorialText(day.title)}`}))));
  const scopeLabel = el('p', {class:'explore-scope-label'});
  const filterArea = el('div', {class:'explore-filters'}, strip, picker, scopeLabel);
  function closePicker() {picker.hidden = true; daysChip.setAttribute('aria-expanded','false'); daysChip.focus({preventScroll:true});}
  function togglePicker() {picker.hidden = !picker.hidden; daysChip.setAttribute('aria-expanded',String(!picker.hidden));
    if (!picker.hidden) picker.querySelector('button').focus({preventScroll:true});}
  picker.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();closePicker();}});
  const list = el('ul',{class:'place-list'});
  const results = el('p',{class:'visually-hidden',role:'status','aria-live':'polite'});
  const listView = el('section',{id:'explore-list-view',class:'explore-list-view','aria-label':'Curated places'},
    results,el('h2',{class:'place-list-heading'},'Places & activities'),
    el('p',{class:'day-meta'},'Available offline. Visit numbers follow the selected day. Curated recommendations and unselected alternatives are not numbered stops.'),list);
  let model;
  function projection() {
    return projectExplore(bundle,state,{...exploreScope,placeIds:collectionMapContext?.placeIds});
  }
  function renderList() {
    const scrollTop = listView.isConnected ? listView.scrollTop : null;
    const nodes = [];
    for (const region of model.regions) {
      nodes.push(el('li',{class:'explore-region-heading'},el('h2',{},region.name)));
      for (const entry of model.entries.filter(e=>e.regionId===region.regionId)) {
        const visit = entry.dayNumber ? `Day ${entry.dayNumber}${entry.visitOrdinal ? ` · Visit ${entry.visitOrdinal}` : entry.member ? ' · Curated option' : ' · Alternative'}` : '';
        nodes.push(el('li',{class:'place-row','data-entry':entry.id,'data-place':entry.placeId??''},
          el('span',{class:'place-number','aria-label':entry.markerNumber ? `Visit ${entry.markerNumber}` : 'Not a numbered itinerary stop'},
            entry.markerNumber ? String(entry.markerNumber) : entry.kind==='alternative' ? '◇' : '·'),
          el('div',{class:'place-copy'},el('h2',{tabindex:'-1'},entry.name),
            el('p',{},`${entry.category} · ${entry.neighborhood??entry.region}`),
            el('p',{},`${entry.editorial}${visit ? ' · '+visit : ''}`),
            el('p',{},entry.place?.address??'Address pending verification'),
            entry.member?.description ? el('p',{},entry.member.description) : null,
            el('p',{class:'place-location-note'},previewLocationNote(entry) ?? entry.locationNote),
            el('div',{class:'place-actions'},
              button('Select place',()=>activeMapPreview.select(entry.id,true),{class:'text-action place-select',
                'aria-label':`Select ${entry.name}${entry.markerNumber ? ' visit '+entry.markerNumber : ''}`,'aria-pressed':'false'}),
              entry.target ? button('Details',()=>{activeMapPreview.select(entry.id);exploreSession.returnFocusId=entry.id;detail(entry.target);},
                {class:'text-action','aria-label':`Activity detail: ${editorialText(entry.target.name)}`}) :
                el('small',{},'Activity detail unavailable')))));
      }
    }
    list.replaceChildren(...nodes);
    if (!model.entries.length) list.append(el('li',{class:'place-row'},'No places match this day/category. Try All to reset.'));
    if (scrollTop !== null) listView.scrollTop = scrollTop;
  }
  function update(announce = false, frame = false, requestedId) {
    const started = performance.now();
    const previouslySelected = exploreSession.selectedId;
    model = projection(); exploreScope.regionId = model.regionId;
    chips.forEach((chip,i)=>chip.setAttribute('aria-pressed',String(
      filters[i].id==='all' ? !exploreScope.dayId&&exploreScope.category==='all'&&!collectionMapContext :
      filters[i].id==='today' ? exploreScope.dayId==='today' :
      filters[i].id==='days' ? !!exploreScope.dayId&&exploreScope.dayId!=='today' : exploreScope.category===filters[i].id)));
    daysChip.textContent = model.day ? `Day ${model.day.dayNumber} ▾` : 'Days ▾';
    scopeLabel.textContent = collectionMapContext ? collectionMapContext.title :
      `${model.day ? 'Day '+model.day.dayNumber : 'All days'} · ${exploreScope.category==='all' ? 'All categories' : filters.find(f=>f.id===exploreScope.category)?.label??'All categories'}`;
    renderList();
    if (frame) {exploreSession.listScrollTop = 0; listView.scrollTop = 0;}
    activeMapPreview?.update(model,{frame,selectedId:requestedId??exploreSession.selectedId});
    activeMapPreview?.syncSelection();
    if (announce) results.textContent = `${model.entries.length} results. ${scopeLabel.textContent}. ${
      previouslySelected!==exploreSession.selectedId ? 'Selection updated. ' : ''}${model.entries.find(e=>e.id===exploreSession.selectedId)?.name??'No selected place'}.`;
    if (activeMapPreview?.element) activeMapPreview.element.dataset.updateMs = String(performance.now() - started);
  }
  function chooseFilter(id) {
    collectionMapContext=null;
    if (id==='all') exploreScope={dayId:null,category:'all',regionId:exploreScope.regionId};
    else if (id==='today') {exploreScope.dayId='today';exploreScope.regionId=initial.today?.primaryRegionId;}
    else exploreScope.category=exploreScope.category===id?'all':id;
    update(true,true);
  }
  strip.addEventListener('keydown',event=>{
    const current=chips.indexOf(document.activeElement);
    const next=event.key==='Home'?0:event.key==='End'?chips.length-1:
      event.key==='ArrowRight'?Math.min(chips.length-1,current+1):event.key==='ArrowLeft'?Math.max(0,current-1):-1;
    if(next>=0){event.preventDefault();chips[next].focus({preventScroll:true});chips[next].scrollIntoView({block:'nearest',inline:'nearest'});}
  });
  model=projection();exploreScope.regionId=model.regionId;renderList();
  activeMapPreview=exploreMapPreview(bundle,exploreSession,detail,listView,{model,filters:filterArea,
    onRegion:(id,entryId)=>{exploreScope.regionId=id;update(true,false,entryId);
      if (entryId && exploreSession.mode === 'list') requestAnimationFrame(() =>
        [...list.querySelectorAll('[data-entry]')].find(n => n.dataset.entry === entryId)?.querySelector('.place-select')?.focus({preventScroll:true}));}});
  update();
  return [activeMapPreview.element];
}

function budget() {
  return budgetView(bundle, state, {commit, storageIssue, disclosure, upgradeChoices,
    openHomeCurrency: () => {
      myTrip({page: 'basics', focus: 'page-title'});
    }});
}

function info(emergencyOnly = false) {
  if (emergencyOnly) {infoFromHome = view==='Home'; infoTopic='emergency'; view = 'Info'; renderNav();}
  main.dataset.screen = 'Info'; document.documentElement.dataset.screen = 'Info';
  updateHeaderSurface(appHeader, 'light');
  const nodes=travelInfoView({bundle,phrasebook,phraseError,topic:infoTopic,
    backLabel:infoFromHome?'Back to Home':'Back to Travel Info',
    onOpen:topic=>{
      infoReturnScroll=appScroll.scrollTop;infoFromHome=false;infoTopic=topic;
      main.replaceChildren(...info());appScroll.scrollTop=0;main.focus({preventScroll:true});
    },
    onBack:()=>{
      if(infoFromHome){infoFromHome=false;infoTopic=null;go('Home');return;}
      const previous=infoTopic;infoTopic=null;main.replaceChildren(...info());appScroll.scrollTop=infoReturnScroll;
      const target=previous==='emergency'?main.querySelector('.info-emergency'):main.querySelector(`[data-topic="${previous}"]`);
      target?.focus({preventScroll:true});
    }
  });
  if (emergencyOnly) {main.replaceChildren(...nodes); appScroll.scrollTop = 0; main.focus({preventScroll: true});}
  return nodes;
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
  myTripButton.focus({preventScroll: true});
  dialog.showModal();
  dialog.querySelector('.close').focus({preventScroll: true});
}

function tripDataSettings() {
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
          reconcileContent({...imported, revision: current.revision}, bundle).state).then(() => myTrip({message: 'Backup imported on this device.'})).catch(() => {})),
        button('Cancel import', () => {preview.remove(); file.focus();}));
      backupBody.append(preview);
      preview.querySelector('h2').tabIndex = -1;
      preview.querySelector('h2').focus();
    } catch (error) {alert(error.message, personal);}
  }});
  backupBody.append(field('Import My Trip · review before replacing', file));
  backupBody.append(button('Delete this trip’s local data', () => {
    if (confirm('Delete this trip’s personal data from this browser? Export a backup first if you want to keep it.'))
      commit(current => ({...newTravelerState(bundle), revision: current.revision})).then(() => myTrip({message: 'Local trip data deleted.'})).catch(() => {});
  }, {class: 'trip-destructive'}));
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

  return el('div', {class: 'trip-settings'},
    disclosure('Backup / Export / Import', backupBody, {id: 'backup', className: 'trip-disclosure'}),
    disclosure('About this app', el('p', {},
      `App build ${document.querySelector('meta[name="mcs-build-version"]')?.content ?? 'development'} · Traveler State ${STATE_VERSION}`),
      {id: 'about', className: 'trip-disclosure'}));
}

function myTrip(options = {}) {
  const openSections = new Set([...personal.querySelectorAll('details[data-section][open]')].map(n => n.dataset.section));
  if (!dialog.open) tripSession = {page: 'overview', edit: null, scroll: {}};
  if (options.page) {tripSession.page = options.page; tripSession.edit = null;}
  const status = el('p', {id: 'save-status', role: 'status', 'aria-live': 'polite'}, options.message ?? '');
  personal.replaceChildren(status);
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

  personal.append(myTripView({bundle, state, session: tripSession, redraw: myTrip, commit,
    settings: tripDataSettings, onBasicsSaved: () => {resetDay(); render();}}));
  for (const section of personal.querySelectorAll('details[data-section]'))
    if (openSections.has(section.dataset.section)) section.open = true;
  showPersonal();
  personal.scrollTop = tripSession.scroll[tripSession.page] ?? 0;
  if (options.focus) requestAnimationFrame(() => {
    const target = [...personal.querySelectorAll('[data-trip-focus]')].find(n => n.dataset.tripFocus === options.focus);
    target?.focus({preventScroll: true});
    if (target?.matches('input,select,textarea')) keepFocusedFieldVisible();
  });
}

function navIcon(name) {
  return icon(name, 'nav-icon');
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
  activeMapPreview?.dispose(); activeMapPreview = null;
  document.documentElement.dataset.theme = bundle.trip.defaultThemeId;
  document.documentElement.dataset.screen = view;
  main.dataset.screen = view;
  updateHeaderSurface(appHeader, primaryHeaderSurfaces[view]);
  renderNav();
  main.replaceChildren(...({Home: home, Itinerary: itinerary, Explore: explore, Budget: budget, Info: info}[view] ?? home)()
    .filter(Boolean));
  fitDetailOverlays();
}

async function switchPack(name) {
  try {
    await saveQueue.catch(() => {});
    const next = await loadSamplePack(name, schemas.content);
    let nextBook=null; phraseError=false;
    try {nextBook=await loadSamplePhrasebook(name,next,schemas.phrasebook);} catch {phraseError=true;}
    coordinator?.close();
    let loaded; storageIssue = null;
    try {loaded = await store.load(next.trip.tripId);} catch (error) {storageIssue = error;}
    const result = reconcileContent(loaded ?? newTravelerState(next), next);
    bundle = next; state = result.state; packName = name; view = 'Home'; exploreScope = {dayId: null, category: 'all', regionId: null};
    phrasebook=nextBook;infoTopic=null;infoFromHome=false;
    collectionMapContext = null;
    exploreSession = {mode: 'map', activated: false, selectedId: null, camera: null, listScrollTop: 0}; exploreReturn = null;
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
