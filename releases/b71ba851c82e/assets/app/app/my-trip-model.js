import {calendarDay, dateInTimeZone, selectedOptions} from '../domain/itinerary.js';
import {localFlightTime, contextDate} from '../domain/itinerary-context.js';

export const bookingTypes = {
  personalFlights: {title: 'Flights', singular: 'Flight', icon: 'flight', fields: [
    ['name', 'Flight label', 'text'], ['airline', 'Airline', 'text'], ['flightNumber', 'Flight number', 'text'],
    ['origin', 'Origin', 'text'], ['destination', 'Destination', 'text'],
    ['departureDateTime', 'Departure date and time', 'datetime-local'], ['arrivalDateTime', 'Arrival date and time', 'datetime-local'],
    ['confirmationCode', 'Confirmation code', 'text'], ['notes', 'Notes', 'textarea']]},
  personalLodging: {title: 'Lodging', singular: 'Stay', icon: 'lodging', fields: [
    ['name', 'Lodging label', 'text'], ['address', 'Address', 'text'], ['checkInDate', 'Check-in date', 'date'],
    ['checkOutDate', 'Check-out date', 'date'], ['phone', 'Phone', 'tel'], ['confirmationCode', 'Confirmation code', 'text'], ['notes', 'Notes', 'textarea']]},
  personalReservations: {title: 'Reservations', singular: 'Reservation', icon: 'documents', fields: [
    ['name', 'Reservation label', 'text'], ['dateTime', 'Reservation date and time', 'datetime-local'],
    ['activityId', 'Related activity (optional)', 'activity'], ['paymentStatus', 'Payment status', 'text'],
    ['confirmationCode', 'Confirmation code', 'text'], ['notes', 'Notes', 'textarea']]}
};
export function savedDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return calendarDay(value, 1) === value ? value : null;
}
export function readableDate(value) {return savedDate(value) ? contextDate(value) : 'Date not added';}
export function readableTime(value) {
  const parsed = localFlightTime(value);
  return parsed ? `${contextDate(parsed.date)} · ${parsed.time}` : 'Date / time not added';
}
export function tripSummary(bundle, state, now = new Date()) {
  const today = dateInTimeZone(now, bundle.trip.defaultTimezone);
  const start = savedDate(state.tripStartDate), end = start ? calendarDay(start, bundle.days.length) : null;
  const flights = state.personalFlights.map(entry => ({entry, time: [localFlightTime(entry.departureDateTime), localFlightTime(entry.arrivalDateTime)]
    .filter(time => time && time.date >= today).sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`))[0]}))
    .filter(x => x.time && x.time.date >= today).sort((a, b) => `${a.time.date}T${a.time.time}`.localeCompare(`${b.time.date}T${b.time.time}`));
  const currentStays = state.personalLodging.filter(e => savedDate(e.checkInDate) && savedDate(e.checkOutDate) && e.checkInDate <= today && today <= e.checkOutDate);
  const nextStay = [...state.personalLodging].filter(e => savedDate(e.checkInDate) && e.checkInDate >= today && (!savedDate(e.checkOutDate) || e.checkOutDate >= e.checkInDate))
    .sort((a, b) => a.checkInDate.localeCompare(b.checkInDate))[0];
  const reservations = state.personalReservations.map(entry => ({entry, time: localFlightTime(entry.dateTime)}))
    .filter(x => x.time && x.time.date >= today).sort((a, b) => `${a.time.date}T${a.time.time}`.localeCompare(`${b.time.date}T${b.time.time}`));
  const choices = bundle.optionGroups.flatMap(g => selectedOptions(bundle, state, g));
  const attention = [
    !start ? 'Add travel dates to connect your bookings to Itinerary.' : null,
    state.personalFlights.some(e => !localFlightTime(e.departureDateTime) || !localFlightTime(e.arrivalDateTime)) ? 'Some flights need a departure or arrival date.' : null,
    state.personalLodging.some(e => !savedDate(e.checkInDate) || !savedDate(e.checkOutDate) || e.checkOutDate < e.checkInDate) ? 'Some stays need their dates reviewed.' : null,
    state.personalReservations.some(e => !localFlightTime(e.dateTime)) ? 'Some reservations need a date and time.' : null
  ].filter(Boolean);
  return {today, start, end, nextFlight: flights[0], currentStays, nextStay,
    nextReservation: reservations[0], packed: state.packingChecklist.filter(e => e.checked).length,
    packingTotal: state.packingChecklist.length, choices, attention};
}
