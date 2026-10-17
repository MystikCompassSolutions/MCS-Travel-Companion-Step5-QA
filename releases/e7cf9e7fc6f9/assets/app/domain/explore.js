import {resolveDay, effectiveOptions, optionScheduleItems, currentTripDay} from './itinerary.js';

// Discovery groups are deliberately broader than the preserved editorial category.
export const EXPLORE_CATEGORIES = Object.freeze({
  food: {label: 'Food & Drink', group: 'food'},
  shopping: {label: 'Shopping & Markets', group: 'shopping'},
  attraction: {label: 'Attractions', group: 'attraction'},
  history_culture: {label: 'History & Culture', group: 'attraction'},
  arts_museums: {label: 'Arts & Museums', group: 'attraction'},
  nature: {label: 'Nature & Outdoors', group: 'attraction'},
  other: {label: 'Other', group: 'other'}
});
export function exploreCategory(value) {
  const key = String(value ?? '').toLowerCase().replace(/\s*&\s*|[ -]/g, '_');
  const aliases = {restaurant: 'food', cafe: 'food', food_venue: 'food', food_drink: 'food',
    store: 'shopping', shopping_markets: 'shopping', history__culture: 'history_culture',
    arts__museums: 'arts_museums', museum: 'arts_museums', cultural: 'history_culture',
    attractions: 'attraction', nature_outdoors: 'nature'};
  const normalized = aliases[key] ?? key;
  return EXPLORE_CATEGORIES[normalized] ?? {label: value || 'Other', group: 'other'};
}
export function isMcsPick(bundle, activity) {
  return (activity?.badgeIds ?? []).some(id => bundle.badges.some(b => b.badgeId === id &&
    (b.classificationKey === 'mcs_pick' || (!b.classificationKey && b.label.trim().toUpperCase() === 'MCS PICK'))));
}
export function verifiedCoordinates(bundle, place) {
  return !!place && place.status === 'active' && Number.isFinite(place.latitude) && Number.isFinite(place.longitude) &&
    ['latitude', 'longitude'].every(field => bundle.verification.some(v =>
      place.verificationRecordIds?.includes(v.verificationId) && v.targetId === place.placeId &&
      v.fieldPath === field && v.status === 'verified' && v.sourceIds.some(id => bundle.sources.some(s => s.sourceId === id && s.active))));
}

const indexes = new WeakMap();
// A validated content bundle is immutable for its lifetime. A new pack/version
// receives a new index; traveler state and filter results are never cached here.
export function exploreIndex(bundle) {
  if (!indexes.has(bundle)) indexes.set(bundle, {
    activities: new Map(bundle.activities.filter(a => !['retired', 'archived'].includes(a.status)).map(a => [a.activityId, a])),
    places: new Map(bundle.places.filter(p => p.status === 'active').map(p => [p.placeId, p])),
    days: [...bundle.days].sort((a, b) => a.dayNumber - b.dayNumber)
  });
  return indexes.get(bundle);
}

// Pure projection. Occurrence IDs keep repeat visits separate; recommendations
// retain collection/day context without inheriting visit ordinals or endorsements.
export function projectExplore(bundle, state, filter = {}, now = new Date()) {
  const {activities, places, days} = exploreIndex(bundle);
  const lifecycle = currentTripDay(state.tripStartDate, bundle.trip.durationDays, bundle.trip.defaultTimezone, now);
  const today = lifecycle.phase === 'active' ? days[lifecycle.index] : null;
  const day = filter.dayId === 'today' ? today : days.find(d => d.dayId === filter.dayId);
  const category = filter.category ?? 'all';
  const entries = [];
  const usedPlaces = new Set();
  function add(activity, context, member = null, parent = null) {
    const place = places.get(member?.placeId ?? activity?.placeId);
    const own = member ? activities.get(member.activityId) : activity;
    const taxonomy = exploreCategory(member ? (own?.primaryCategory ?? own?.category ?? place?.placeType ?? place?.category ?? parent?.collection?.kind) : (activity?.primaryCategory ?? activity?.category));
    const pick = isMcsPick(bundle, own);
    const parentPick = member && isMcsPick(bundle, parent);
    const regionId = place?.regionId ?? activity?.regionId ?? context.day?.primaryRegionId;
    const id = member ? `${context.id}:member:${member.placeId}` : context.id;
    if (place) usedPlaces.add(place.placeId);
    entries.push({id, placeId: place?.placeId ?? null, place: place ?? null, activity: own ?? activity ?? null,
      target: own ?? parent ?? activity ?? null, name: place?.name ?? activity?.name ?? 'Activity unavailable',
      regionId, region: bundle.regions.find(r => r.regionId === regionId)?.name ?? 'Region not specified',
      neighborhood: place?.neighborhood, category: taxonomy.label, categoryGroup: taxonomy.group,
      experienceTags: own?.experienceTags ?? [], pick, parentPick: !!parentPick, member, parent,
      kind: member ? 'recommendation' : context.kind, dayId: context.day?.dayId ?? null,
      dayNumber: context.day?.dayNumber ?? null, visitOrdinal: member ? null : context.ordinal ?? null,
      // Only a single-day scope presents visit numbers on markers.
      markerNumber: day && !member && context.kind === 'stop' ? context.ordinal : null,
      parentVisitOrdinal: member ? context.ordinal ?? null : null,
      isAlternative: !!context.isAlternative, optionId: context.optionId ?? null,
      mapped: verifiedCoordinates(bundle, place),
      locationNote: !place ? 'No authored place anchor' : !verifiedCoordinates(bundle, place) ? 'Location not verified for the map' :
        place.coordinatePrecision === 'building' ? 'Building anchor · not an entrance' :
        place.coordinatePrecision === 'site' ? 'Site anchor · not an entrance' : 'Venue position · not an entrance',
      thumbnail: member?.heroMediaId ?? (member ? own?.heroMediaId : activity?.heroMediaId) ?? null,
      description: member?.description ?? activity?.description ?? activity?.summary ?? '',
      editorial: member ? (parentPick ? 'From MCS Pick collection' : 'Curated recommendation') :
        context.kind === 'alternative' ? 'Available alternative · not scheduled' : pick ? 'MCS Pick' : 'MCS curated activity'});
    for (const child of member ? [] : activity?.collection?.items ?? []) add(activities.get(child.activityId) ?? activity, context, child, activity);
  }
  for (const current of day ? [day] : days) {
    let ordinal = 0;
    const resolved = resolveDay(bundle, state, current);
    for (const item of resolved) {
      if (!['activity', 'meal'].includes(item.itemType) || !item.referencedEntityId) continue;
      ordinal++;
      const activity = activities.get(item.referencedEntityId);
      const group = bundle.optionGroups.find(g => g.optionGroupId === item.optionGroupId);
      add(activity, {id: `visit:${current.dayId}:${item.scheduleItemId}`, day: current, ordinal, kind: 'stop',
        optionId: item.optionId, isAlternative: !!group && item.optionId !== group.defaultOptionId && item.optionId !== group.baseOptionId});
    }
    for (const anchor of current.scheduleItems.filter(i => i.itemType === 'option_group')) {
      const group = bundle.optionGroups.find(g => g.optionGroupId === anchor.referencedEntityId);
      if (!group) continue;
      const effective = new Set(effectiveOptions(bundle, state, group).filter(Boolean).map(o => o.optionId));
      for (const option of bundle.options.filter(o => group.optionIds.includes(o.optionId) && !effective.has(o.optionId))) {
        for (const item of optionScheduleItems(option, anchor)) {
          if (!['activity', 'meal'].includes(item.itemType) || !item.referencedEntityId) continue;
          add(activities.get(item.referencedEntityId), {id: `alternative:${current.dayId}:${item.scheduleItemId}`,
            day: current, kind: 'alternative', isAlternative: true, optionId: option.optionId});
        }
      }
    }
  }
  if (!day) for (const place of places.values()) if (!usedPlaces.has(place.placeId)) {
    const activity = [...activities.values()].find(a => a.placeId === place.placeId);
    if (activity) add(activity, {id: `discovery:${place.placeId}`, kind: 'discovery'});
    else entries.push({id: `discovery:${place.placeId}`, placeId: place.placeId, place, name: place.name,
      regionId: place.regionId, region: bundle.regions.find(r => r.regionId === place.regionId)?.name ?? '',
      category: exploreCategory(place.placeType ?? place.category).label,
      categoryGroup: exploreCategory(place.placeType ?? place.category).group, mapped: verifiedCoordinates(bundle, place),
      kind: 'discovery', editorial: 'Authored place', locationNote: 'No activity detail linked'});
  }
  const results = entries.filter(e => (!filter.placeIds || filter.placeIds.includes(e.placeId)) &&
    (category === 'all' || category === 'picks' ? category !== 'picks' || e.pick :
      category === 'alternatives' ? e.isAlternative : e.categoryGroup === category));
  const regions = bundle.regions.filter(r => results.some(e => e.regionId === r.regionId));
  const regionId = regions.some(r => r.regionId === filter.regionId) ? filter.regionId :
    regions.some(r => r.regionId === day?.primaryRegionId) ? day.primaryRegionId : regions[0]?.regionId ?? null;
  return {entries: results, regions, regionId, day: day ?? null, today,
    mapEntries: results.filter(e => e.mapped && e.regionId === regionId),
    missingLocations: results.filter(e => !e.mapped), category,
    invalidToday: filter.dayId === 'today' && !today};
}

export function reconcileExploreSelection(entries, selectedId) {
  return entries.some(e => e.id === selectedId) ? selectedId : entries[0]?.id ?? null;
}

// Bounded card window: distant results remain reachable through the complete List
// and native previous/next controls, without hundreds of live image/card nodes.
export function exploreCardWindow(entries, selectedId, limit = 15) {
  const index = Math.max(0, entries.findIndex(e => e.id === selectedId));
  const start = Math.max(0, Math.min(index - Math.floor(limit / 2), entries.length - limit));
  return entries.slice(start, start + limit);
}

// Screen-space collision groups; never displace stored geographic positions.
export function overlappingPoints(points, project, threshold = 44) {
  const groups = [];
  for (const point of points) {
    const pixel = project([point.longitude, point.latitude]);
    const matches = groups.filter(g => g.some(p => Math.hypot(p.pixel.x - pixel.x, p.pixel.y - pixel.y) < threshold));
    const group = matches[0] ?? [];
    if (!matches.length) groups.push(group);
    for (const merged of matches.slice(1)) {group.push(...merged); groups.splice(groups.indexOf(merged), 1);}
    group.push({point, pixel});
  }
  return groups.map(g => g.map(p => p.point));
}
