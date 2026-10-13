// A1 sample configuration only. No traveler state enters this projection.
export const TOKYO_PILOT_IDS = Object.freeze(['place_nezu', 'place_borderless',
  'place_shibuya109', 'place_nintendo_tokyo', 'place_hands_shibuya']);

export function placeTarget(bundle, placeId) {
  const direct = bundle.activities.find(a => a.placeId === placeId);
  if (direct) return {activity: direct, member: null};
  for (const activity of bundle.activities) {
    const member = activity.collection?.items.find(item => item.placeId === placeId);
    if (member) return {activity: bundle.activities.find(a => a.activityId === member.activityId) ?? activity, member};
  }
  return null;
}

export function tokyoPilot(bundle) {
  if (bundle.manifest.classification !== 'sample') return [];
  return TOKYO_PILOT_IDS.flatMap(id => {
    const place = bundle.places.find(p => p.placeId === id && p.status === 'active');
    const target = placeTarget(bundle, id);
    if (!place || !target || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) return [];
    const verified = ['latitude', 'longitude'].every(field => bundle.verification.some(v =>
      place.verificationRecordIds?.includes(v.verificationId) && v.targetId === id && v.fieldPath === field &&
      v.status === 'verified' && v.sourceIds.some(sourceId => bundle.sources.some(s => s.sourceId === sourceId && s.active))));
    if (!verified) return [];
    const pick = target.activity.badgeIds.some(id => bundle.badges.some(b => b.badgeId === id && b.label === 'MCS PICK'));
    return [{place, ...target, label: target.member ? (pick ? 'From MCS Pick collection' : 'Curated collection') :
      (pick ? 'MCS Pick' : 'MCS curated place'), region: bundle.regions.find(r => r.regionId === place.regionId)?.name ?? '',
      thumbnail: target.member?.heroMediaId ?? (target.member ? null : target.activity.heroMediaId)}];
  });
}
