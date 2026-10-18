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

// Option anchors remain resolver metadata, never interruption cards in the view.
export function timelineItems(rows) {return rows.filter(item => item.itemType !== 'option_group');}
export function itemAlternativeGroup(bundle, item) {
  return !item.personal && bundle.optionGroups.find(group => group.optionGroupId === item.optionGroupId);
}

export function personalScheduleMenu(item, customized, alternatives = false) {
  const transport = item.itemType === 'transport';
  if (item.personal) return {heading: transport ? 'Your personal transportation' : 'Your personal activity', entries: [
    {id: 'edit', label: transport ? 'Edit transportation' : 'Edit activity'}, {id: 'remove', label: 'Remove personal item'}]};
  return {heading: transport ? 'Personalize transportation' : 'Personalize this stop', entries: [
    {id: 'edit', label: transport ? 'Edit transportation' : 'Edit schedule'},
    ...(alternatives ? [{id: 'alternatives', label: 'View alternatives'}] : []),
    ...(customized ? [{id: 'reset', label: transport ? 'Reset to MCS recommendation' : 'Reset to MCS plan'}] : []),
    {id: 'skip', label: transport ? 'Skip transportation' : 'Skip this stop'}]};
}
