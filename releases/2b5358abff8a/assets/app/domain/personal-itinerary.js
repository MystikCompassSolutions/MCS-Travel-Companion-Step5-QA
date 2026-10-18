import {resolveDay, optionScheduleItems, calendarDay} from './itinerary.js';

export const emptyPersonalization = () => ({overrides: [], items: []});
const data = state => state.itineraryPersonalization ?? emptyPersonalization();
const minutes = time => time ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) : null;
export function plannedDuration(bundle, item) {
  return item.durationMinutes ?? bundle.activities.find(a => a.activityId === item.referencedEntityId)?.recommendedDurationMinutes ??
    bundle.transport.find(t => t.transportId === item.referencedEntityId)?.durationMinutes ?? 0;
}
export function scheduleName(bundle, item) {
  return item.personal?.name ?? bundle.activities.find(a => a.activityId === item.referencedEntityId)?.name ??
    item.displayLabelOverride ?? bundle.transport.find(t => t.transportId === item.referencedEntityId)?.mode ??
    item.itemType.replaceAll('_', ' ');
}

// Catalog inactive authored options too, but never use this catalog to choose them.
// The existing authored resolver remains the sole authority for active options.
export function scheduleCatalog(bundle) {
  return bundle.days.flatMap(day => day.scheduleItems.flatMap(anchor => {
    if (anchor.itemType !== 'option_group') return [{...anchor, key: `s:${day.dayId}:${anchor.scheduleItemId}`}];
    const group = bundle.optionGroups.find(g => g.optionGroupId === anchor.referencedEntityId);
    return [...new Set([...(group?.optionIds ?? []), group?.baseOptionId].filter(Boolean))].flatMap(id => {
      const option = bundle.options.find(o => o.optionId === id);
      if (!option) return [];
      return optionScheduleItems(option, anchor).map((item, index) => ({...item,
        key: `o:${day.dayId}:${anchor.scheduleItemId}:${id}:${option.scheduleItems?.length ? option.scheduleItems[index].scheduleItemId : `${item.itemType}:${item.referencedEntityId}:${index}`}`,
        positionalReference: !option.scheduleItems?.length}));
    });
  }));
}
export function sourceReference(bundle, item) {
  return {key: item.key, dayId: item.dayId, scheduleItemId: item.scheduleItemId, itemType: item.itemType,
    entityId: item.referencedEntityId ?? '', optionId: item.optionId ?? '', optionGroupId: item.optionGroupId ?? '',
    contentVersion: bundle.trip.contentVersion, startTime: item.suggestedStartTime ?? '',
    durationMinutes: plannedDuration(bundle, item)};
}
function boundSource(bundle, source, catalog) {
  const item = catalog.find(i => i.key === source.key);
  if (!item || item.dayId !== source.dayId || item.itemType !== source.itemType ||
      (item.referencedEntityId ?? '') !== source.entityId || (item.optionId ?? '') !== source.optionId ||
      (item.optionGroupId ?? '') !== source.optionGroupId) return null;
  // Explicit option-entry IDs survive reordering. Legacy positional references
  // cannot be rebound across an edition update without an owner-reviewed mapping.
  if (item.positionalReference && source.contentVersion !== bundle.trip.contentVersion) return null;
  return item;
}
export function personalizationIssues(bundle, state) {
  const catalog = scheduleCatalog(bundle), days = new Set(bundle.days.map(d => d.dayId));
  const issues = [];
  for (const override of data(state).overrides) {
    const original = boundSource(bundle, override.source, catalog);
    if (!original || !days.has(override.dayId)) issues.push({key: override.source.key, suspended: true,
      message: 'An authored item or day changed in this edition. Its saved customization is retained but cannot safely be applied.'});
    else if (override.source.startTime !== (original.suggestedStartTime ?? '') ||
        override.source.durationMinutes !== plannedDuration(bundle, original)) issues.push({key: override.source.key,
      message: 'MCS changed its suggested timing. Your personal plan is retained; review the current recommendation.'});
  }
  for (const item of data(state).items) if (!days.has(item.dayId)) issues.push({key: `p:${item.id}`, suspended: true,
    message: `${item.name}: its day is no longer available. Edit the saved entry to choose an existing day.`});
  return issues;
}
export function assertPersonalization(state) {
  const {overrides, items} = data(state);
  if (new Set(overrides.map(o => o.source.key)).size !== overrides.length ||
      new Set(items.map(i => i.id)).size !== items.length || items.some(i => !i.name.trim()))
    throw new Error('Personal itinerary records need unique references and nonempty names.');
  return state;
}
export function setScheduleOverride(bundle, state, original, changes) {
  const previous = data(state).overrides.find(o => o.source.key === original.key);
  const override = {...(previous ?? {source: sourceReference(bundle, original), dayId: original.dayId,
    startTime: original.suggestedStartTime ?? '', durationMinutes: plannedDuration(bundle, original),
    skipped: false, mode: '', notes: ''}), ...changes};
  if (!bundle.days.some(d => d.dayId === override.dayId)) throw new Error('Choose an existing trip day.');
  return {...state, itineraryPersonalization: {...data(state), overrides:
    [...data(state).overrides.filter(o => o.source.key !== original.key), override]}};
}
export function restoreScheduleItem(state, key) {
  return {...state, itineraryPersonalization: {...data(state), overrides: data(state).overrides.filter(o => o.source.key !== key)}};
}
export function savePersonalItem(bundle, state, item) {
  if (!item.name.trim() || !bundle.days.some(d => d.dayId === item.dayId)) throw new Error('Enter a name and choose an existing trip day.');
  return {...state, itineraryPersonalization: {...data(state), items: [...data(state).items.filter(i => i.id !== item.id), {...item, name: item.name.trim()}]}};
}
export function removePersonalItem(state, id) {
  return {...state, itineraryPersonalization: {...data(state), items: data(state).items.filter(i => i.id !== id)}};
}
export function restoreScheduleDay(state, dayId) {
  return {...state, itineraryPersonalization: {overrides: data(state).overrides.filter(o => o.dayId !== dayId && o.source.dayId !== dayId),
    items: data(state).items.filter(i => i.dayId !== dayId)}};
}
export function resolvePersonalDay(bundle, state, day) {
  const catalog = scheduleCatalog(bundle), changes = data(state);
  const rows = []; let sequence = 0;
  for (const sourceDay of bundle.days) {
    let anchor = -1;
    for (const item of resolveDay(bundle, state, sourceDay)) {
      const original = catalog.find(i => i.dayId === sourceDay.dayId && i.scheduleItemId === item.scheduleItemId);
      if (!original) continue;
      const override = changes.overrides.find(o => o.source.key === original.key && boundSource(bundle, o.source, catalog) && bundle.days.some(d => d.dayId === o.dayId));
      const target = override?.dayId ?? sourceDay.dayId;
      const start = override ? override.startTime : item.suggestedStartTime ?? '';
      const timed = minutes(start);
      if (timed !== null) anchor = timed;
      if (target !== day.dayId || override?.skipped) continue;
      rows.push({...item, key: original.key, original, override, dayId: target,
        suggestedStartTime: start, suggestedTimeMode: start ? 'exact' : 'flexible',
        timeWindowLabel: override ? '' : item.timeWindowLabel,
        durationMinutes: override ? override.durationMinutes : plannedDuration(bundle, item),
        sortTime: timed ?? (sourceDay.dayId === target ? anchor + 0.01 : Infinity), order: sequence++});
    }
  }
  for (const personal of changes.items.filter(i => i.dayId === day.dayId)) rows.push({key: `p:${personal.id}`,
    scheduleItemId: personal.id, dayId: personal.dayId, itemType: personal.itemType, personal,
    suggestedStartTime: personal.startTime, suggestedTimeMode: personal.startTime ? 'exact' : 'flexible',
    durationMinutes: personal.durationMinutes, sortTime: minutes(personal.startTime) ?? Infinity, order: sequence++});
  // Keep authored alternative controls even when all their active children moved.
  for (const item of day.scheduleItems.filter(i => i.itemType === 'option_group')) rows.push({...item,
    sortTime: minutes(item.suggestedStartTime) ?? Infinity, order: -1});
  return rows.sort((a, b) => a.sortTime - b.sortTime || a.order - b.order);
}
export function scheduleWarnings(bundle, state, day, rows = resolvePersonalDay(bundle, state, day)) {
  const warnings = [];
  const timed = rows.filter(i => i.itemType !== 'option_group' && i.suggestedStartTime && i.durationMinutes > 0);
  for (let index = 0; index < timed.length; index++) {
    const a = timed[index], end = minutes(a.suggestedStartTime) + a.durationMinutes;
    if (end > 1440) warnings.push(`${scheduleName(bundle, a)} continues beyond this calendar day. Review the next day too.`);
    for (const b of timed.slice(index + 1)) if (minutes(b.suggestedStartTime) < end)
      warnings.push(`${scheduleName(bundle, a)} overlaps ${scheduleName(bundle, b)}. Times are your plan; no routing accuracy is implied.`);
  }
  for (const item of rows.filter(i => i.override)) {
    const reservations = state.personalReservations.filter(r => r.activityId && item.referencedEntityId && r.activityId === item.referencedEntityId);
    for (const reservation of reservations) {
      const date = calendarDay(state.tripStartDate, day.dayNumber);
      if (!date || !reservation.dateTime || reservation.dateTime.slice(0, 10) !== date ||
          (item.suggestedStartTime && reservation.dateTime.slice(11, 16) !== item.suggestedStartTime))
        warnings.push(`Review the related reservation for ${scheduleName(bundle, item)}${reservation.dateTime ? ` (${reservation.dateTime.replace('T', ' ')})` : ''}. Its saved booking has not changed.`);
    }
  }
  return [...new Set(warnings)];
}
