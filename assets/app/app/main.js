import {el, button, card, field} from './dom.js';
import {loadSamplePack} from '../domain/content.js';
import {chooseOption, resolveDay, selectedOptions, calendarDay, currentTripDay} from '../domain/itinerary.js';
import {plannedBudget, actualBudget, availableUpgradeCosts, formatMoney, parseMoney, currencyDigits} from '../domain/budget.js';
import {newTravelerState, createTravelerStore, reconcileContent, serializeTravelerState,
  parseTravelerExport, EXPORT_LIMIT_BYTES, ConflictError, CorruptStateError} from '../storage/traveler-state.js';
import {createTabCoordinator} from '../storage/tab-coordination.js';
import {loadRuntimeContracts} from './runtime-contracts.js';
import {registerOffline} from '../offline/register.js';

const main = document.querySelector('#main');
const dialog = document.querySelector('#personal');
const personal = document.querySelector('#personal-content');
const connection = document.querySelector('#connection');
const sync = document.querySelector('#sync');
const myTripButton = document.querySelector('#my-trip');
let bundle, state, store, coordinator, schemas = {}, view = 'Home', dayIndex = 0;
let packName = 'japan', saveQueue = Promise.resolve(), offlineStatus = '', storageIssue = null;

function status() {
  connection.textContent = navigator.onLine ? (offlineStatus || 'Preparing offline sample…') :
    'Offline · Saved sample content and local trip data are available. Outside links and maps need internet.';
}
addEventListener('online', status);
addEventListener('offline', status);
dialog.addEventListener('close', () => myTripButton.focus());
dialog.addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const focusable = [...dialog.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]')]
    .filter(element => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length);
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

function go(name) {view = name; if (name === 'Home') resetDay(); render(); main.focus();}
function badges(activity) {
  return el('div', {}, activity.badgeIds.slice(0, 3).map(id =>
    el('span', {class: 'badge'}, bundle.badges.find(badge => badge.badgeId === id).label)));
}
function estimates() {
  return Object.entries(plannedBudget(bundle, state)).map(([currency, total]) => {
    const range = total.maximumMinor === null ? `from ${formatMoney(total.minimumMinor, currency)}` :
      `${formatMoney(total.minimumMinor, currency)}${total.maximumMinor !== total.minimumMinor ?
        '–' + formatMoney(total.maximumMinor, currency) : ''}`;
    return el('p', {}, `MCS sample estimate: ${range} for ${state.partySize} ${state.partySize === 1 ? 'traveler' : 'travelers'}.`,
      total.unknownCosts ? ` ${total.unknownCosts} unpriced cost${total.unknownCosts === 1 ? '' : 's'} excluded.` : '',
      ' No automatic currency conversion.');
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
  return [el('p', {class: 'eyebrow'}, bundle.trip.title),
    el('h1', {}, 'Your trip is already planned.'), el('p', {}, 'Make it yours.'),
    card(el('h2', {}, dayLabel(day)), el('p', {}, phase), el('p', {}, day.pace ?? day.dayType),
      button('Continue Today’s Plan', () => {dayIndex = today.index; go('Itinerary');}, {class: 'primary'})),
    upcoming ? card(el('h2', {}, 'Booking to consider'), button(upcoming.name, () => detail(upcoming)),
      el('p', {}, upcoming.reservationInfo.bookAheadGuidance)) : null,
    card(el('h2', {}, 'Budget snapshot'), ...estimates(),
      el('p', {}, `My spending: ${formatMoney(actualBudget(state).spentMinor, state.homeCurrency)}`)),
    button('Emergency Help', () => info(true)), el('h2', {}, 'Architecture samples'),
    field('Choose a content pack', el('select', {onChange: event => {void switchPack(event.target.value);}},
      ['japan', 'iceland'].map(name => el('option', {value: name, selected: name === packName},
        name === 'japan' ? 'Japan sample' : 'Iceland sample'))))];
}

function optionGroup(group) {
  const chosen = selectedOptions(bundle, state, group).map(option => option.optionId);
  const choices = group.optionIds.filter(id => id !== group.baseOptionId);
  return card(el('h2', {}, group.title),
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
      }, {'aria-pressed': pressed, disabled: !!storageIssue});
    })), el('small', {}, 'Selections stay on this device and update the schedule and sample estimate.'));
}

function itinerary() {
  const day = bundle.days[dayIndex];
  const select = el('select', {onChange: event => {dayIndex = Number(event.target.value); render(); main.querySelector('select')?.focus();}},
    bundle.days.map((candidate, index) => el('option', {value: index, selected: index === dayIndex}, dayLabel(candidate))));
  const timeline = resolveDay(bundle, state, day).map(item => {
    const activity = bundle.activities.find(candidate => candidate.activityId === item.referencedEntityId);
    const transport = bundle.transport.find(candidate => candidate.transportId === item.referencedEntityId);
    return el('li', {}, card(el('strong', {}, item.suggestedStartTime ?? 'Flexible'),
      activity ? el('div', {}, button(activity.name, () => detail(activity)), badges(activity),
        field(`${activity.name} completed`, el('input', {type: 'checkbox',
          checked: state.activityCompletion[activity.activityId] ?? false, disabled: !!storageIssue,
          onChange: event => {
            const checked = event.target.checked;
            commit(current => ({...current, activityCompletion: {...current.activityCompletion,
              [activity.activityId]: checked}})).catch(() => {});
          }}))) : el('p', {}, transport ?
        `${transport.mode} · ${transport.durationMinutes} min (sample estimate). ${transport.routeSummary ?? ''}` :
        item.displayLabelOverride ?? item.itemType)));
  });
  return [el('h1', {}, 'Itinerary'), field('Itinerary day', select),
    el('p', {}, day.weatherNotes ?? day.summary ?? ''),
    ...day.scheduleItems.filter(item => item.itemType === 'option_group')
      .map(item => optionGroup(bundle.optionGroups.find(group => group.optionGroupId === item.referencedEntityId))),
    el('ol', {}, timeline)];
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
  view = 'Itinerary'; renderNav();
  const place = bundle.places.find(candidate => candidate.placeId === activity.placeId);
  const nodes = [button('Back to day', () => go('Itinerary')), el('h1', {}, activity.name), badges(activity),
    el('p', {}, activity.summary),
    el('p', {}, `${activity.recommendedDurationMinutes ?? 'Flexible'}${activity.recommendedDurationMinutes ? ' minutes' : ''} · ${activity.indoorOutdoor ?? 'Environment not verified'}`),
    card(el('h2', {}, 'MCS note'), el('p', {}, activity.mcsNote ?? 'Detailed guidance pending content research.')),
    place ? card(el('h2', {}, 'Location'), el('p', {}, place.address), button('Open Explore', () => go('Explore'))) : null,
    activity.reservationInfo ? card(el('h2', {}, 'Booking'), el('p', {}, activity.reservationInfo.bookAheadGuidance)) : null,
    activity.optionalUpgradeIds?.length ? card(el('h2', {}, 'Optional sample upgrades'),
      el('p', {}, 'These are fictional planning costs; availability and prices are unverified.'), ...upgradeChoices(activity)) : null,
    ...bundle.optionGroups.filter(group => group.optionIds.some(id =>
      bundle.options.find(option => option.optionId === id)?.activityIds.includes(activity.activityId))).map(optionGroup)];
  main.replaceChildren(...nodes.filter(Boolean)); main.focus();
}

function explore() {
  const dayPlaces = new Set(resolveDay(bundle, state, bundle.days[dayIndex])
    .map(item => bundle.activities.find(activity => activity.activityId === item.referencedEntityId)?.placeId)
    .filter(Boolean));
  const filter = el('select', {}, ['today', 'all', 'shopping', 'attraction'].map(value =>
    el('option', {value}, {today: 'Selected day’s stops', all: 'All places', shopping: 'Shopping', attraction: 'Attractions'}[value])));
  const list = el('ol');
  function update() {
    const places = bundle.places.filter(place => filter.value === 'all' ||
      (filter.value === 'today' && dayPlaces.has(place.placeId)) || place.category === filter.value);
    list.replaceChildren(...places.map(place => el('li', {}, card(el('h2', {}, place.name),
      el('p', {}, place.address ?? 'Address pending verification'),
      ...bundle.activities.filter(activity => activity.placeId === place.placeId)
        .map(activity => button(`Activity details: ${activity.name}`, () => detail(activity))),
      navigator.onLine ? el('a', {href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name + ' ' + (place.address ?? ''))}`,
        target: '_blank', rel: 'noopener noreferrer'}, 'Open external map (internet required)') :
        el('small', {}, 'External maps require internet.')))));
    if (!places.length) list.append(el('li', {}, 'No mapped places in this sample.'));
  }
  filter.addEventListener('change', update); update();
  return [el('h1', {}, 'Explore'), el('p', {}, 'Saved place list and itinerary order work offline. Sample addresses are unverified.'),
    field('Filter places', filter), list];
}

function budget() {
  const actual = actualBudget(state);
  const party = el('input', {type: 'number', min: 1, max: 20, step: 1, required: true, value: state.partySize});
  const partyForm = el('form', {onSubmit: event => {
    event.preventDefault(); const size = Number(party.value);
    if (!Number.isInteger(size) || size < 1 || size > 20) {alert('Party size must be 1–20.'); return;}
    commit(current => ({...current, partySize: size})).catch(() => {});
  }}, field('Travelers in the sample estimate (1–20)', party), el('button', {type: 'submit', disabled: !!storageIssue}, 'Save party size'));
  const total = el('input', {type: 'text', inputmode: 'decimal', required: true,
    value: String(state.budgetPlan.totalMinor / (10 ** currencyDigits(state.homeCurrency)))});
  const form = el('form', {onSubmit: event => {
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
  return [el('h1', {}, 'Budget'), card(el('h2', {}, 'MCS itinerary estimate'), ...estimates(),
    el('p', {}, 'Sample amounts are fictional. Per-person costs use your party size. Group, one-way and round-trip costs apply once per stop; daily and nightly costs use the listed quantity. Unpriced and open-ended costs are marked.'), partyForm),
  upgrades.length ? card(el('h2', {}, 'Optional upgrades'),
    el('p', {}, 'Available only for activities in your selected itinerary. Unverified sample values.'),
    ...upgrades.map(entry => upgradeChoices(entry.activity))) : null,
  card(el('h2', {}, 'My budget · stored on this device'), form,
    el('p', {}, `Spent: ${formatMoney(actual.spentMinor, state.homeCurrency)} · Remaining: ${formatMoney(actual.remainingMinor, state.homeCurrency)}`),
    actual.unconverted.length ? el('p', {}, `${actual.unconverted.length} expenses in other currencies are excluded until you enter a manual conversion.`) : null),
  card(el('h2', {}, 'Add actual spending'), expenseForm), expenses].filter(Boolean);
}

function info(emergencyOnly = false) {
  if (emergencyOnly) {view = 'Info'; renderNav();}
  const nodes = [el('h1', {}, emergencyOnly ? 'Emergency Help' : 'Travel Info'),
    el('p', {}, bundle.trip.internationalBuyerNotice),
    el('p', {}, 'Sample resources are unverified. Verification dates and authoritative links are required before release.'),
    ...(!emergencyOnly ? bundle.travelInfo.map(article => card(el('h2', {}, article.title),
      ...article.contentBlocks.map(block => el('p', {}, block.text ?? block.items?.join(' · ') ?? '')))) : []),
    ...bundle.emergencyResources.map(resource => card(el('h2', {}, resource.organizationName),
      el('p', {}, resource.instructions), el('strong', {}, 'Pending verification · No emergency number is supplied.')))];
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
  return card(el('h2', {}, label),
    ...state[key].map(entry => el('div', {class: 'booking-entry'},
      el('strong', {}, entry.name ?? entry.id),
      el('details', {}, el('summary', {}, `Edit ${entry.name ?? label}`), bookingForm(key, label, entry)),
      button(`Remove ${entry.name ?? label}`, () => {
        if (confirm(`Remove this ${label.toLowerCase()} entry from this device?`))
          commit(current => ({...current, [key]: current[key].filter(item => item.id !== entry.id)}))
            .then(myTrip).catch(() => {});
      }))),
    el('details', {}, el('summary', {}, `Add ${label.toLowerCase()}`), bookingForm(key, label)));
}

function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], {type: 'application/json'}));
  const link = el('a', {href: url, download: filename}); link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function myTrip() {
  personal.replaceChildren(el('h1', {id: 'personal-title'}, 'My Trip'),
    el('p', {}, 'Stored on this device. No MCS account or cloud sync. Anyone using this browser profile may be able to read your entries. Keep exported backups private.'),
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
    if (!dialog.open) dialog.showModal();
    return;
  }
  const note = el('textarea', {maxLength: 10000, value: state.notes.trip ?? ''});
  const start = el('input', {type: 'date', value: state.tripStartDate ?? ''});
  const currency = el('select', {}, ['USD', 'JPY', 'ISK', 'EUR', 'GBP', 'CAD', 'AUD'].map(value =>
    el('option', {value, selected: value === state.homeCurrency}, value)));
  personal.append(el('form', {onSubmit: event => {
    event.preventDefault();
    if (currency.value !== state.homeCurrency &&
        (state.budgetPlan.totalMinor > 0 || state.actualExpenses.length ||
          Object.values(state.budgetPlan.categoryMinor).some(value => value > 0))) {
      alert('Clear your budget and expenses before changing home currency; amounts are never automatically converted.', personal);
      return;
    }
    commit(current => {
      const next = {...current, notes: {...current.notes, trip: note.value}, homeCurrency: currency.value};
      if (start.value) next.tripStartDate = start.value; else delete next.tripStartDate;
      return next;
    }).then(() => {resetDay(); render(); myTrip(); document.querySelector('#save-status').textContent = 'Saved on this device.';}).catch(() => {});
  }}, field('Trip start date (optional)', start), field('Home currency', currency),
  field('Personal notes', note), el('button', {type: 'submit'}, 'Save My Trip')));
  for (const [key, label] of [['personalFlights', 'Flights'], ['personalLodging', 'Lodging'],
    ['personalReservations', 'Reservations']]) personal.append(bookingSection(key, label));
  const packing = el('input', {required: true, maxLength: 1000});
  personal.append(card(el('h2', {}, 'Packing checklist'),
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
    }}, field('Packing item', packing), el('button', {type: 'submit'}, 'Add item'))));
  personal.append(el('h2', {}, 'Chosen alternatives'), ...bundle.optionGroups.map(optionGroup));
  personal.append(button('Export My Trip', () => {
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
      personal.append(preview);
    } catch (error) {alert(error.message, personal);}
  }});
  personal.append(field('Import My Trip · review before replacing', file));
  personal.append(button('Delete this trip’s local data', () => {
    if (confirm('Delete this trip’s personal data from this browser? Export a backup first if you want to keep it.'))
      commit(current => ({...newTravelerState(bundle), revision: current.revision})).then(myTrip).catch(() => {});
  }));
  if (navigator.storage?.persist) personal.append(button('Ask browser to keep local trip data', async () => {
    try {const granted = await navigator.storage.persist();
      document.querySelector('#save-status').textContent = granted ?
        'This browser granted persistent local storage. Backups are still recommended.' :
        'Persistent storage was not granted. Export backups regularly.';
    } catch {document.querySelector('#save-status').textContent = 'Persistent storage could not be requested. Export backups regularly.';}
  }));
  if (!dialog.open) dialog.showModal();
}

function renderNav() {
  document.querySelector('#nav').replaceChildren(...['Home', 'Itinerary', 'Explore', 'Budget', 'Info']
    .map(name => button(name, () => go(name), {'aria-current': view === name ? 'page' : undefined})));
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
    bundle = next; state = result.state; packName = name; view = 'Home';
    try {localStorage.setItem('mcs-active-sample', name);} catch {}
    resetDay(); clearSync(); render();
    coordinator = createTabCoordinator(bundle.trip.tripId, revision => {
      if (revision !== state.revision) syncNotice('Another tab changed this trip. Reload before making more edits.',
        [button('Reload latest trip', () => {void reloadLatest().catch(error => alert(error.message));})]);
    });
    if (storageIssue) alert(storageIssue.message);
    if (result.changedItems.length) alert('Some saved items changed in this content revision. Previous choices remain in exports.');
  } catch (error) {alert(error.message);}
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
    try {await registerOffline(message => {offlineStatus = message; status();});}
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
    alert(error.message, main);
    connection.textContent = 'The sample could not start. Reopen it while connected.';
  }
}
start();
