import {calendarDay} from './itinerary.js';

// A display-only fallback: never write a generated nickname into Traveler State.
export function flightDisplayName(entry) {
  const name = entry.name?.trim();
  if (name) return name;
  const identity = [entry.airline?.trim(), entry.flightNumber?.trim()].filter(Boolean).join(' · ');
  if (identity) return identity;
  const origin = entry.origin?.trim(), destination = entry.destination?.trim();
  if (origin && destination) return `${origin} → ${destination}`;
  if (destination) return `Flight to ${destination}`;
  if (origin) return `Flight from ${origin}`;
  return 'Flight';
}

// Bookings contain local wall-clock values, without timezone metadata. Never
// reinterpret them in the device timezone or infer a date for an undated entry.
function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value ? value : null;
}
export function localFlightTime(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d{1,3})?)?$/.exec(value);
  return match && dateOnly(match[1]) ? {date: match[1], time: `${match[2]}:${match[3]}`} : null;
}

export function itineraryContext(state, dayNumber) {
  const date = dateOnly(state.tripStartDate) && Number.isInteger(dayNumber) && dayNumber > 0 ?
    calendarDay(state.tripStartDate, dayNumber) : null;
  if (!date) return {date: null, flights: [], lodging: []};
  const flights = (state.personalFlights ?? []).flatMap(entry => {
    const departure = localFlightTime(entry.departureDateTime);
    const arrival = localFlightTime(entry.arrivalDateTime);
    const departsToday = departure?.date === date, arrivesToday = arrival?.date === date;
    if (!departsToday && !arrivesToday) return [];
    return [{entry, departure, arrival, departsToday, arrivesToday,
      sortTime: departsToday && arrivesToday ? [departure.time, arrival.time].sort()[0] :
        departsToday ? departure.time : arrival.time}];
  }).sort((a, b) => a.sortTime.localeCompare(b.sortTime));
  const lodging = (state.personalLodging ?? []).flatMap(entry => {
    const checkIn = dateOnly(entry.checkInDate), checkOut = dateOnly(entry.checkOutDate);
    // A partial stay is useful only on its known boundary, never open-ended.
    if (checkIn && checkOut ? checkOut < checkIn || date < checkIn || date > checkOut :
      date !== checkIn && date !== checkOut) return [];
    return [{entry, checkIn, checkOut, status: date === checkIn && date === checkOut ? 'Check-in & check-out' :
      date === checkOut ? 'Check-out today' : date === checkIn ? 'Check-in today' : 'Staying here'}];
  }).sort((a, b) => (a.checkIn ?? a.checkOut).localeCompare(b.checkIn ?? b.checkOut));
  return {date, flights, lodging};
}

export function contextDate(date) {
  return new Intl.DateTimeFormat('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'})
    .format(new Date(`${date}T12:00:00Z`));
}
