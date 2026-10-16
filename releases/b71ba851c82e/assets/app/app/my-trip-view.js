import {el, button, field} from './dom.js';
import {icon} from './visual.js';
import {destinationLabel} from '../domain/travel-info.js';
import {chooseOption, selectedOptions} from '../domain/itinerary.js';
import {copyAddressText, editorialText} from './activity-detail.js';
import {bookingTypes, tripSummary, readableDate, readableTime} from './my-trip-model.js';

export function myTripView({bundle, state, session, redraw, commit, settings, onBasicsSaved}) {
  const summary = tripSummary(bundle, state);
  const page = session.page;
  const focus = value => ({'data-trip-focus': value});
  const go = (target, edit = null, returnFocus = null) => {
    session.scroll[page] = document.querySelector('#personal-content').scrollTop;
    session.page = target; session.edit = edit; session.returnFocus = returnFocus;
    redraw({focus: edit ? 'editor-title' : 'page-title'});
  };
  const save = (transform, message, targetFocus, after) => {
    if (!session.edit) session.scroll[page] = document.querySelector('#personal-content').scrollTop;
    const form = document.activeElement?.closest('form');
    const controls = [...(form?.querySelectorAll('button') ?? [])]; controls.forEach(n => n.disabled = true);
    commit(transform).then(() => {
      session.edit = null; after?.(); redraw({message, focus: targetFocus});
    }).catch(() => {}).finally(() => controls.forEach(n => n.disabled = false));
  };
  const heading = (title, description, action) => el('div', {class: 'trip-page-heading'},
    el('div', {}, el('h3', {tabindex: '-1', ...focus('page-title')}, title), description ? el('p', {}, description) : null), action);
  const addButton = key => button(`Add ${bookingTypes[key].singular.toLowerCase()}`, () => go(key, {key, id: null}, `add-${key}`),
    {class: 'trip-primary', ...focus(`add-${key}`)});
  const empty = (text, action) => el('div', {class: 'trip-empty'}, el('p', {}, text), action);
  const back = page !== 'overview' ? button(session.edit ? 'Back to saved details' : 'Back to My Trip', () => {
    if (session.edit) {const target = session.returnFocus; session.edit = null; redraw({focus: target});}
    else {session.scroll[page] = document.querySelector('#personal-content').scrollTop; session.page = 'overview'; redraw({focus: `tile-${page}`});}
  }, {class: 'trip-back'}) : null;

  function tile(target, title, detail, count, symbol) {
    return el('button', {type: 'button', class: 'trip-tile', onClick: () => go(target), ...focus(`tile-${target}`)},
        el('span', {class: 'trip-tile-top'}, icon(symbol), el('span', {class: 'trip-tile-count'}, count)),
        el('strong', {}, title), el('span', {class: 'trip-tile-detail'}, detail),
        target === 'packing' && summary.packingTotal ? el('progress', {max: summary.packingTotal, value: summary.packed, 'aria-label': 'Packing progress'}) : null,
        el('span', {class: 'trip-tile-action'}, count === '0 saved' ? `Add your first ${target === 'personalFlights' ? 'flight' : target === 'personalLodging' ? 'stay' : 'reservation'}` : 'View & manage', icon('arrow')));
  }
  function overview() {
    const flight = summary.nextFlight, reservation = summary.nextReservation;
    return [el('section', {class: 'trip-journey'}, el('p', {class: 'trip-kicker'}, 'Your personal journey'),
      el('h3', {tabindex: '-1', ...focus('page-title')}, destinationLabel(bundle)),
      el('p', {class: 'trip-dates'}, summary.start ? `${readableDate(summary.start)} — ${readableDate(summary.end)}` : 'Your dates, your journey'),
      el('span', {class: 'trip-local'}, icon('lock'), 'Saved on this device')),
    el('div', {class: 'trip-basics-bar'}, el('span', {}, summary.start ? `${bundle.days.length} days · ${state.homeCurrency}` : `Travel dates not set · ${state.homeCurrency}`),
      button('Edit trip basics', () => go('basics'), {class: 'trip-text-action', ...focus('tile-basics')})),
    el('div', {class: 'trip-tiles'},
      tile('personalFlights', 'Flights', flight ? `${flight.entry.name} · ${readableTime(`${flight.time.date}T${flight.time.time}`)}` :
        state.personalFlights.length ? 'Your saved flight details' : 'Keep your journey close at hand', `${state.personalFlights.length} saved`, 'flight'),
      tile('personalLodging', 'Lodging', summary.currentStays.length > 1 ? `${summary.currentStays.length} stays cover today · review all` :
        summary.currentStays[0]?.name ?? summary.nextStay?.name ?? (state.personalLodging.length ? 'Your saved places to stay' : 'A place to arrive and unwind'), `${state.personalLodging.length} saved`, 'lodging'),
      tile('personalReservations', 'Reservations', reservation ? `${reservation.entry.name} · ${readableTime(reservation.entry.dateTime)}` :
        state.personalReservations.length ? 'Your saved reservation details' : 'Keep important plans together', `${state.personalReservations.length} saved`, 'documents'),
      tile('packing', 'Packing', summary.packingTotal ? `${summary.packed} of ${summary.packingTotal} packed` : 'A little preparation, a lighter journey', `${summary.packingTotal} items`, 'done'),
      tile('notes', 'Personal notes', state.notes.trip ? state.notes.trip.slice(0, 100) : 'Ideas and reminders, just for you', state.notes.trip ? 'Saved' : 'Add a note', 'Info'),
      tile('alternatives', 'Chosen alternatives', summary.choices.map(o => editorialText(o.title)).join(' · ') || 'Explore the authored choices for your trip', `${summary.choices.length} chosen`, 'compass')),
    summary.attention.length ? el('section', {class: 'trip-attention'}, el('h4', {}, 'A few details to finish'),
      ...summary.attention.map(text => el('p', {}, text))) : null,
    button('Trip Data & Settings', () => go('settings'), {class: 'trip-settings-link', ...focus('tile-settings')},),
    el('p', {class: 'trip-privacy-note'}, 'Export a backup before switching browsers or devices. Your personal details stay on this device; backups do not automatically synchronize.')];
  }

  function bookings(key) {
    const type = bookingTypes[key];
    return [heading(type.title, `${state[key].length} saved on this device`, state[key].length ? addButton(key) : null),
      ...(state[key].length ? state[key].map(entry => {
        const title = entry.name?.trim() || type.singular;
        const activity = bundle.activities.find(a => a.activityId === entry.activityId);
        const feedback = el('p', {class: 'trip-copy-feedback', role: 'status'});
        return el('article', {class: 'trip-booking', 'data-booking-id': entry.id},
          el('div', {class: 'trip-booking-title'}, icon(type.icon), el('h4', {}, title)),
          key === 'personalFlights' ? [entry.airline || entry.flightNumber ? el('p', {class: 'trip-booking-meta'}, [entry.airline, entry.flightNumber].filter(Boolean).join(' · ')) : null,
            el('p', {class: 'trip-flight-route'}, entry.origin || 'Origin not added', el('span', {'aria-label': 'to'}, ' → '), entry.destination || 'Destination not added'),
            el('dl', {class: 'trip-booking-dates'}, el('div', {}, el('dt', {}, 'Departure'), el('dd', {}, readableTime(entry.departureDateTime))),
              el('div', {}, el('dt', {}, 'Arrival'), el('dd', {}, readableTime(entry.arrivalDateTime))))] :
          key === 'personalLodging' ? [el('dl', {class: 'trip-booking-dates'}, el('div', {}, el('dt', {}, 'Check-in'), el('dd', {}, readableDate(entry.checkInDate))),
            el('div', {}, el('dt', {}, 'Check-out'), el('dd', {}, readableDate(entry.checkOutDate)))),
            entry.address ? el('p', {class: 'trip-address'}, entry.address) : null, entry.phone ? el('p', {class: 'trip-booking-meta'}, `Contact · ${entry.phone}`) : null] :
          [el('p', {class: 'trip-booking-meta'}, readableTime(entry.dateTime)), entry.activityId ? el('p', {}, `Related activity · ${activity ? editorialText(activity.name) : 'Previously linked activity (not in this edition)'}`) : null,
            el('p', {class: 'trip-booking-meta'}, `Payment · ${entry.paymentStatus || 'Not recorded'}`)],
          entry.confirmationCode?.trim() ? el('p', {class: 'trip-confirmation'}, icon('lock'), 'Confirmation saved') : null,
          el('div', {class: 'trip-card-actions'}, button('Edit', () => go(key, {key, id: entry.id}, `edit-${entry.id}`),
            {'aria-label': `Edit ${type.singular.toLowerCase()}: ${title}`, ...focus(`edit-${entry.id}`)}),
            key === 'personalLodging' && entry.address ? button('Copy address', async () => {
              const copied = await copyAddressText(entry.address, navigator.clipboard);
              feedback.textContent = copied ? 'Address copied.' : 'Copy unavailable. Select the address above and copy it.';
            }) : null,
            button('Remove', () => {
              if (confirm(`Remove this ${type.singular.toLowerCase()} entry from this device?`)) save(current => ({...current, [key]: current[key].filter(e => e.id !== entry.id)}), `${type.singular} removed.`, `add-${key}`);
            }, {class: 'trip-remove', 'aria-label': `Remove ${type.singular.toLowerCase()}: ${title}`})), feedback);
      }) : [empty(`Add your first ${type.singular.toLowerCase()} to keep its details together.`, addButton(key))])];
  }

  function bookingEditor() {
    const {key, id} = session.edit, type = bookingTypes[key], existing = state[key].find(e => e.id === id);
    const controls = new Map();
    const fields = type.fields.map(([name, caption, kind]) => {
      const input = kind === 'textarea' ? el('textarea', {value: existing?.[name] ?? '', maxLength: 10000}) :
        kind === 'activity' ? el('select', {}, el('option', {value: ''}, 'None'),
          existing?.activityId && !bundle.activities.some(a => a.activityId === existing.activityId) ? el('option', {value: existing.activityId, selected: true}, 'Previously linked activity') : null,
          ...bundle.activities.map(a => el('option', {value: a.activityId, selected: existing?.activityId === a.activityId}, editorialText(a.name)))) :
          el('input', {type: kind, value: existing?.[name] ?? '', maxLength: 10000, required: name === 'name'});
      input.setAttribute('aria-label', caption);
      controls.set(name, {input, initial: input.value});
      return field(caption, input);
    });
    return [el('h3', {tabindex: '-1', ...focus('editor-title')}, `${existing ? 'Edit' : 'Add'} ${type.singular.toLowerCase()}`),
      key === 'personalFlights' ? el('p', {class: 'trip-help'}, 'Enter local departure and arrival times as shown on your booking. No time zone conversion is applied.') : null,
      el('form', {class: 'trip-editor', onSubmit: event => {
        event.preventDefault();
        const entry = {...existing, id: existing?.id ?? `personal_${crypto.randomUUID()}`};
        for (const [name, {input, initial}] of controls) {
          if (existing && input.value === initial) continue;
          if (input.value.trim()) entry[name] = input.value.trim(); else delete entry[name];
        }
        if (key === 'personalLodging' && entry.checkInDate && entry.checkOutDate && entry.checkOutDate < entry.checkInDate) {
          error.textContent = 'Check-out must be on or after check-in.'; error.focus(); return;
        }
        if (key === 'personalReservations' && entry.activityId && entry.activityId !== existing?.activityId && !bundle.activities.some(a => a.activityId === entry.activityId)) {
          error.textContent = 'Choose an activity from this itinerary or leave it blank.'; error.focus(); return;
        }
        save(current => ({...current, [key]: existing ? current[key].map(e => e.id === existing.id ? entry : e) : [...current[key], entry]}), `${type.singular} saved on this device.`, `edit-${entry.id}`);
      }}, ...fields, error,
      el('div', {class: 'trip-form-actions'}, el('button', {type: 'submit', class: 'trip-primary'}, `Save ${type.singular.toLowerCase()}`),
        button('Cancel', () => {const target = session.returnFocus; session.edit = null; redraw({focus: target});})))];
  }
  const error = el('p', {role: 'alert', tabindex: '-1', class: 'error'});

  function basics() {
    const date = el('input', {type: 'date', value: state.tripStartDate ?? ''});
    const currency = el('select', {'aria-label': 'Home currency'}, [...new Set([state.homeCurrency, 'USD', 'JPY', 'ISK', 'EUR', 'GBP', 'CAD', 'AUD'])].map(code => el('option', {value: code, selected: code === state.homeCurrency}, code)));
    return [heading('Trip basics', 'Set your dates and home currency.'), el('form', {class: 'trip-editor', onSubmit: event => {
      event.preventDefault();
      if (currency.value !== state.homeCurrency && (state.budgetPlan.totalMinor > 0 || state.actualExpenses.length || Object.values(state.budgetPlan.categoryMinor).some(value => value > 0))) {
        error.textContent = 'Clear your budget and expenses before changing home currency; amounts are never automatically converted.'; error.focus(); return;
      }
      save(current => {
        const next = {...current, homeCurrency: currency.value};
        if (currency.value !== current.homeCurrency) delete next.planningRate;
        if (date.value) next.tripStartDate = date.value; else delete next.tripStartDate;
        return next;
      }, 'Trip basics saved on this device.', 'tile-basics', () => {onBasicsSaved(); session.page = 'overview';});
    }}, field('Trip start date (optional)', date), field('Home currency', currency),
      el('p', {class: 'trip-help'}, 'Your MCS estimates stay in destination currency. Personal amounts are never automatically converted.'), error,
      el('button', {type: 'submit', class: 'trip-primary'}, 'Save trip basics'))];
  }
  function notes() {
    const input = el('textarea', {value: state.notes.trip ?? '', maxLength: 10000, rows: 9});
    return [heading('Personal notes', 'Ideas, reminders and the little details.'), el('form', {class: 'trip-editor', onSubmit: event => {
      event.preventDefault(); save(current => ({...current, notes: {...current.notes, trip: input.value}}), 'Personal notes saved on this device.', 'tile-notes', () => {session.page = 'overview';});
    }}, field('Personal notes', input), el('button', {type: 'submit', class: 'trip-primary'}, 'Save personal notes'))];
  }
  function packing() {
    const input = el('input', {required: true, maxLength: 1000, placeholder: 'What do you need to bring?', ...focus('packing-input')});
    return [heading('Packing checklist', summary.packingTotal ? `${summary.packed} of ${summary.packingTotal} packed` : 'Make room for a little peace of mind.'),
      summary.packingTotal ? el('progress', {max: summary.packingTotal, value: summary.packed, 'aria-label': 'Packing progress'}) : null,
      el('div', {class: 'trip-packing-list', role: 'group', 'aria-label': 'Packing items'}, state.packingChecklist.map(item =>
        el('div', {class: 'trip-packing-row'},
          el('label', {}, el('input', {type: 'checkbox', checked: item.checked, ...focus(`pack-${item.id}`), onChange: event => {
            const checked = event.target.checked;
            session.scroll[page] = document.querySelector('#personal-content').scrollTop;
            save(current => ({...current, packingChecklist: current.packingChecklist.map(e => e.id === item.id ? {...e, checked} : e)}), `${item.label}: ${checked ? 'packed' : 'not packed'}.`, `pack-${item.id}`);
          }}), el('span', {}, item.label)),
          button('Remove', () => {
            if (confirm(`Remove ${item.label} from your packing list?`)) {
              session.scroll[page] = document.querySelector('#personal-content').scrollTop;
              save(current => ({...current, packingChecklist: current.packingChecklist.filter(e => e.id !== item.id)}), 'Packing item removed.', 'packing-input');
            }
          }, {class: 'trip-remove', 'aria-label': `Remove packing item: ${item.label}`})))),
      el('form', {class: 'trip-packing-add', onSubmit: event => {
        event.preventDefault(); if (!input.value.trim()) return;
        session.scroll[page] = document.querySelector('#personal-content').scrollTop;
        const entry = {id: `packing_${crypto.randomUUID()}`, label: input.value.trim(), checked: false};
        save(current => ({...current, packingChecklist: [...current.packingChecklist, entry]}), 'Packing item added.', 'packing-input');
      }}, field('Packing item', input), el('button', {type: 'submit', class: 'trip-primary'}, 'Add item'))];
  }
  function alternatives() {
    return [heading('Chosen alternatives', 'Your authored choices update the schedule and estimate.'),
      ...bundle.optionGroups.map(group => {
        const chosen = selectedOptions(bundle, state, group).map(o => o.optionId);
        return el('section', {class: 'trip-booking'}, el('h4', {}, group.title),
          group.travelerPrompt ? el('p', {}, group.travelerPrompt) : null,
          group.baseOptionId ? el('p', {class: 'trip-help'}, `Included primary plan · ${bundle.options.find(o => o.optionId === group.baseOptionId)?.title}`) : null,
          group.optionIds.filter(id => id !== group.baseOptionId).map(id => {
            const option = bundle.options.find(o => o.optionId === id), active = chosen.includes(id);
            return button('', () => {
              if (active && group.selectionMode === 'single') return;
              const ids = group.selectionMode === 'single' ? [id] : active ? chosen.filter(value => value !== id) : [...chosen, id];
              session.scroll[page] = document.querySelector('#personal-content').scrollTop;
              save(current => chooseOption(bundle, current, group.optionGroupId, ids), 'Chosen alternatives saved. Schedule and estimate updated.', `option-${id}`);
            }, {class: `trip-option ${active ? 'is-selected' : ''}`, 'aria-pressed': String(active), ...focus(`option-${id}`), 'aria-label': `${option.title}${id === group.defaultOptionId ? ' · Primary plan' : ''}${active ? ' · Current choice' : ' · Switch choice'}`});
          }).map((control, i) => {
            const option = bundle.options.find(o => o.optionId === group.optionIds.filter(id => id !== group.baseOptionId)[i]);
            control.append(el('strong', {}, editorialText(option.title)), el('span', {},
              [option.optionId === group.defaultOptionId ? 'Primary plan' : 'Authored alternative', chosen.includes(option.optionId) ? 'Current choice' : 'Switch to this choice'].join(' · ')));
            return control;
          }));
      }), !bundle.optionGroups.length ? empty('This itinerary has no authored alternatives to choose.', null) : null];
  }
  const content = session.edit ? bookingEditor() : bookingTypes[page] ? bookings(page) :
    page === 'basics' ? basics() : page === 'notes' ? notes() : page === 'packing' ? packing() :
    page === 'alternatives' ? alternatives() : page === 'settings' ? [heading('Trip Data & Settings', 'Backups, browser storage and app maintenance.'), settings()] : overview();
  return el('div', {class: 'my-trip-dashboard', 'data-trip-page': page}, back, content);
}
