import {el} from './dom.js';
import {icon} from './visual.js';
import {contextDate} from '../domain/itinerary-context.js';

function block(kind, title, cards) {
  if (!cards.length) return null;
  return el('aside', {class: `itinerary-context itinerary-${kind}`, 'aria-labelledby': `context-${kind}-title`},
    el('div', {class: 'context-heading'}, icon(kind === 'flights' ? 'flight' : 'lodging'),
      el('h3', {id: `context-${kind}-title`}, title), el('span', {class: 'context-source'}, 'My Trip')),
    cards, kind === 'flights' ? el('p', {class: 'context-time-note'}, 'Local times as saved in My Trip.') : null);
}
function endpoint(label, place, value, today, date) {
  return el('div', {class: 'context-endpoint'},
    el('span', {class: 'context-caption'}, label),
    el('strong', {class: 'context-place'}, place?.trim() || (label === 'Departure' ? 'Origin not added' : 'Destination not added')),
    value ? el('time', {datetime: `${value.date}T${value.time}`, class: today ? 'context-time is-today' : 'context-time'},
      value.time, value.date !== date ? el('small', {}, contextDate(value.date)) : null) :
      el('span', {class: 'context-missing'}, 'Time not added'));
}
export function flightContextView({date, flights}) {
  return block('flights', 'Your flights', flights.map(({entry, departure, arrival, departsToday, arrivesToday}) =>
    el('article', {class: 'context-card'},
      el('div', {class: 'context-card-heading'}, el('h4', {}, entry.name?.trim() || 'Flight'),
        el('span', {class: 'context-badge'}, departsToday && arrivesToday ? 'Departure & arrival today' :
          departsToday ? 'Departs today' : 'Arrives today')),
      entry.airline?.trim() || entry.flightNumber?.trim() ? el('p', {class: 'context-detail'},
        [entry.airline?.trim(), entry.flightNumber?.trim()].filter(Boolean).join(' · ')) : null,
      el('div', {class: 'context-route'}, endpoint('Departure', entry.origin, departure, departsToday, date),
        icon('arrow', 'ui-icon context-route-arrow'), endpoint('Arrival', entry.destination, arrival, arrivesToday, date)))));
}
export function lodgingContextView({lodging}) {
  return block('lodging', 'Your stay', lodging.map(({entry, checkIn, checkOut, status}) =>
    el('article', {class: 'context-card'},
      el('div', {class: 'context-card-heading'}, el('h4', {}, entry.name?.trim() || 'Lodging'),
        el('span', {class: 'context-badge'}, status)),
      el('p', {class: 'context-stay-dates'},
        checkIn ? `Check-in ${contextDate(checkIn)}` : 'Check-in not added', ' · ',
        checkOut ? `Check-out ${contextDate(checkOut)}` : 'Check-out not added'),
      entry.address?.trim() ? el('p', {class: 'context-address'}, icon('Explore'), el('span', {}, entry.address)) : null)));
}
