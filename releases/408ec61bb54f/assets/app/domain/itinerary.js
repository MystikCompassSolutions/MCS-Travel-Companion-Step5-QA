const DAY_MS = 24 * 60 * 60 * 1000;

function selectionIds(state, group) {
  const saved = state.optionSelections[group.optionGroupId];
  if (saved !== undefined) {
    const valid = saved.filter(id => group.optionIds.includes(id) && id !== group.baseOptionId);
    if (valid.length || !group.requiredSelection) return valid;
  }
  return group.defaultOptionId ? [group.defaultOptionId] : [];
}

export function selectedOptions(bundle, state, group) {
  return selectionIds(state, group)
    .filter(id => group.optionIds.includes(id))
    .map(id => bundle.options.find(option => option.optionId === id))
    .filter(Boolean);
}

export function effectiveOptions(bundle, state, group, kind = 'schedule') {
  const mode = kind === 'budget' ? group.budgetImpactMode : group.scheduleImpactMode;
  const ids = selectionIds(state, group).filter(id => group.optionIds.includes(id));
  if ((mode === 'insert' || mode === 'add') && group.baseOptionId) ids.unshift(group.baseOptionId);
  return [...new Set(ids)].map(id => bundle.options.find(option => option.optionId === id));
}

export function chooseOption(bundle, state, groupId, optionIds) {
  const group = bundle.optionGroups.find(candidate => candidate.optionGroupId === groupId);
  if (!group || !Array.isArray(optionIds) || new Set(optionIds).size !== optionIds.length ||
      optionIds.some(id => !group.optionIds.includes(id) || id === group.baseOptionId) ||
      (group.requiredSelection && !optionIds.length) ||
      (group.selectionMode === 'single' && optionIds.length > 1)) {
    throw new Error('Invalid option selection');
  }
  return {...state, optionSelections: {...state.optionSelections, [groupId]: optionIds}};
}

export function optionScheduleItems(option, anchor) {
  const entries = option.scheduleItems?.length ? option.scheduleItems : [
    ...option.transportIds.map(id => ({itemType: 'transport', referencedEntityId: id})),
    ...option.activityIds.map(id => ({itemType: 'activity', referencedEntityId: id}))
  ];
  return entries.map((entry, index) => ({
    ...anchor, ...entry,
    dayId: anchor.dayId,
    scheduleItemId: `${anchor.scheduleItemId}_${option.optionId}_${index}`,
    optionId: option.optionId,
    optionGroupId: anchor.referencedEntityId
  }));
}

export function resolveDay(bundle, state, day) {
  return day.scheduleItems.flatMap(item => {
    if (item.itemType !== 'option_group') return [item];
    const group = bundle.optionGroups.find(candidate => candidate.optionGroupId === item.referencedEntityId);
    if (!group) throw new Error(`Missing option group ${item.referencedEntityId}`);
    return effectiveOptions(bundle, state, group).flatMap(option => optionScheduleItems(option, item));
  });
}

export function calendarDay(startDate, dayNumber) {
  if (!startDate) return null;
  const date = new Date(`${startDate}T12:00:00Z`);
  if (Number.isNaN(date.valueOf())) return null;
  date.setUTCDate(date.getUTCDate() + dayNumber - 1);
  return date.toISOString().slice(0, 10);
}

export function dateInTimeZone(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function currentTripDay(startDate, durationDays, timeZone, now = new Date()) {
  if (!startDate) return {index: 0, phase: 'unscheduled'};
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const today = Date.parse(`${dateInTimeZone(now, timeZone)}T00:00:00Z`);
  const offset = Math.round((today - start) / DAY_MS);
  if (offset < 0) return {index: 0, phase: 'upcoming'};
  if (offset >= durationDays) return {index: durationDays - 1, phase: 'past'};
  return {index: offset, phase: 'active'};
}
