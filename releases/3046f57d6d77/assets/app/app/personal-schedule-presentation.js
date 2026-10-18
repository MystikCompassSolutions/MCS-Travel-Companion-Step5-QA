import {plannedDuration} from '../domain/personal-itinerary.js';

// Display a recommendation only when a saved plan changed a known authored time.
// These are wall-clock labels; formatting must not convert time zones.
export function originalTimeNote(item) {
  const original = item.original?.suggestedStartTime;
  if (!item.override || original === item.suggestedStartTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(original ?? '')) return null;
  const hour = Number(original.slice(0, 2));
  return `MCS originally suggested ${hour % 12 || 12}:${original.slice(3)} ${hour >= 12 ? 'PM' : 'AM'}`;
}

export function hasPersonalScheduleChanges(bundle, item) {
  const o = item.override, original = item.original;
  return !!(o && original && (o.dayId !== original.dayId || o.startTime !== (original.suggestedStartTime ?? '') ||
    o.durationMinutes !== plannedDuration(bundle, original) || o.mode || o.notes || o.skipped));
}

export function personalScheduleMenu(item, customized) {
  const transport = item.itemType === 'transport';
  if (item.personal) return {heading: transport ? 'Your personal transportation' : 'Your personal activity', entries: [
    {id: 'edit', label: transport ? 'Edit transportation' : 'Edit activity'}, {id: 'remove', label: 'Remove personal item'}]};
  return {heading: transport ? 'Personalize transportation' : 'Personalize this stop', entries: [
    {id: 'edit', label: transport ? 'Edit transportation' : 'Edit schedule'},
    ...(customized ? [{id: 'reset', label: transport ? 'Reset to MCS recommendation' : 'Reset to MCS plan'}] : []),
    {id: 'skip', label: transport ? 'Skip transportation' : 'Skip this stop'}]};
}
