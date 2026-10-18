import {el, button, field} from './dom.js';
import {editingForm} from './edit-protection.js';
import {calendarDay} from '../domain/itinerary.js';
import {plannedDuration, scheduleName, setScheduleOverride, savePersonalItem, scheduleWarnings} from '../domain/personal-itinerary.js';

export function scheduleEditor(bundle, state, {item, itemType = 'activity', day, edits, commit, finish, close}) {
  const personal = item?.personal;
  const original = item?.original;
  const isPersonal = !original;
  const type = original?.itemType ?? personal?.itemType ?? itemType;
  const title = `${item ? 'Edit' : 'Add'} ${type === 'transport' ? 'transportation' : 'activity'}`;
  const name = el('input', {type: 'text', required: true, maxLength: 200, value: personal?.name ?? ''});
  const days = el('select', {'aria-label': 'Trip day'}, bundle.days.map(d => el('option', {value: d.dayId,
    selected: d.dayId === (item?.dayId ?? day.dayId)}, `Day ${d.dayNumber} · ${d.title}${calendarDay(state.tripStartDate, d.dayNumber) ? ` · ${calendarDay(state.tripStartDate, d.dayNumber)}` : ''}`)));
  const time = el('input', {type: 'time', value: item?.suggestedStartTime ?? '', class: 'schedule-time'});
  const duration = el('input', {type: 'number', inputmode: 'numeric', min: 1, max: 1440, step: 1,
    value: item ? item.durationMinutes || '' : ''});
  const address = el('input', {type: 'text', maxLength: 1000, value: personal?.address ?? ''});
  const mode = el('select', {'aria-label': 'Transportation method'}, [ ['', isPersonal ? 'Not specified (optional)' : 'Use MCS recommendation'], ['walk', 'Walking'], ['train', 'Train'], ['metro', 'Metro'],
    ['bus', 'Bus'], ['taxi', 'Taxi'], ['rideshare', 'Rideshare'], ['drive', 'Rental car / driving'], ['ferry', 'Ferry'],
    ['flight', 'Flight'], ['shuttle', 'Shuttle'], ['bike', 'Bicycle'], ['other', 'Other'] ]
    .map(([value, label]) => el('option', {value,
      selected: value === (personal?.mode ?? item?.override?.mode ?? '')}, label)));
  const notes = el('textarea', {rows: 4, maxLength: 2000, value: personal?.notes ?? item?.override?.notes ?? ''});
  const preview = el('div', {class: 'schedule-warnings', 'aria-live': 'polite'});
  function values() {return {dayId: days.value, startTime: time.value, durationMinutes: duration.value ? Number(duration.value) : 0,
    mode: type === 'transport' ? mode.value : '', notes: notes.value};}
  function warnings() {
    if (!original) return;
    const next = setScheduleOverride(bundle, state, original, {...values(), skipped: false});
    const target = bundle.days.find(d => d.dayId === days.value);
    const messages = scheduleWarnings(bundle, next, target);
    // Skipped items have no timeline warnings, so preview their proposed restored plan.
    preview.replaceChildren(...messages.map(message => el('p', {}, message)));
  }
  const form = editingForm(edits, `schedule:${item?.key ?? 'new'}`, title, {class: 'schedule-form', onSubmit: async event => {
    if (isPersonal && !name.value.trim()) {name.setCustomValidity('Enter a name for your plan.'); name.reportValidity(); return false;}
    const changes = values();
    const id = personal?.id ?? `personal_${crypto.randomUUID().replaceAll('-', '')}`;
    await commit(current => isPersonal ? savePersonalItem(bundle, current, {id, itemType: type, name: name.value,
      ...changes, address: address.value}) : setScheduleOverride(bundle, current, original, {...changes, skipped: false}));
    finish(event.currentTarget, changes.dayId);
  }},
  el('p', {class: 'eyebrow'}, isPersonal ? 'Added by you · private on this device' : 'Your schedule · original MCS details stay intact'),
  original ? el('h3', {}, scheduleName(bundle, original)) : field('Name', name),
  original ? el('p', {}, `MCS recommendation: ${original.suggestedStartTime ?? 'Flexible time'} · ${plannedDuration(bundle, original) || 'Flexible'} min · Day ${bundle.days.find(d => d.dayId === original.dayId)?.dayNumber}`) : null,
  field('Trip day', days), field('Start time (optional)', time), field('Planned duration in minutes (optional)', duration),
  type === 'transport' ? field('Transportation method', mode) : null,
  type === 'transport' ? el('p', {class: 'muted'}, 'Your manually entered plan. Routes, times and fares are not calculated or verified.') : null,
  isPersonal ? field('Location or address (optional)', address) : null,
  field(type === 'transport' ? 'Personal route / transportation notes (optional)' : 'Personal notes (optional)', notes),
  preview, el('div', {class: 'schedule-actions'}, el('button', {type: 'submit', class: 'primary'}, 'Save'), button('Close', close)));
  name.addEventListener('input', () => name.setCustomValidity(''));
  form.addEventListener('input', warnings); form.addEventListener('change', warnings); warnings();
  return {title, content: form, form};
}
