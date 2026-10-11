import {convertPlanningEstimate, formatHomeMoney} from '../domain/budget.js';

// Presentation-only aliases for existing fixture copy. Never change authored
// records, verification status, provenance, or arbitrary future content.
const editorialLabels = new Map([
  ['Shibuya + Harajuku sample day', 'Shibuya + Harajuku'],
  ['Osaka + Universal sample day', 'Osaka + Universal'],
  ['Osaka sample neighborhood day', 'Osaka neighborhood day'],
  ['Universal Studios Japan — Super Nintendo World sample visit', 'Universal Studios Japan — Super Nintendo World'],
  ['Geothermal spa sample', 'Geothermal spa'],
  ['Flexible city walk sample', 'Flexible city walk'],
  ['Optional café stop sample', 'Optional café stop'],
  ['Optional spa add-on sample', 'Optional spa add-on'],
  ['Sample transit', 'Transit'],
  ['Representative sample from approved design materials.', ''],
  ['Owner-supplied sample activity. Admission, access, operating details and scheduling remain unverified.',
    'Admission, access, operating details and scheduling need confirmation.'],
  ['Illustrative sample guidance; confirm current admission and booking requirements on the official venue site.',
    'Confirm current admission and booking requirements on the official venue site.'],
  ['The experience is intentionally map-free. Leave room to wander, and use the visit as the late-afternoon anchor for this sample day.',
    'The experience is intentionally map-free. Leave room to wander, and use the visit as the late-afternoon anchor for this day.']
]);
export function editorialText(text) { return editorialLabels.get(text) ?? text; }

export function activityPresentationVariant(activity) {
  return ['immersive', 'editorial', 'standard'].includes(activity?.presentationVariant) ?
    activity.presentationVariant : 'standard';
}

// Keep published variant tokens compatible while sharing just two visual families.
export function activityPresentationFamily(activity) {
  return activityPresentationVariant(activity) === 'immersive' ? 'immersive' : 'light';
}

export function activityEditorialContent(activity) {
  return {
    description: editorialText(activity.description ?? activity.summary)?.trim() || null,
    note: editorialText(activity.mcsNote)?.trim() || null,
    booking: editorialText(activity.reservationInfo?.bookAheadGuidance)?.trim() || null
  };
}

// A missing target leaves readable editorial content, never a dead link. Local
// media is optional, and external discovery never needs to load to render a card.
export function nearbyInspirationItems(activity, bundle, online = true) {
  return (activity.nearbyInspiration ?? []).filter(item => item.title?.trim() && item.description?.trim())
    .map(item => {
      const target = bundle.activities.find(candidate => candidate.activityId === item.activityId);
      let url = null;
      try {if (['https:', 'http:'].includes(new URL(item.url).protocol)) url = item.url;} catch { /* No external action. */ }
      return {...item, target, url: online ? url : null, needsInternet: !target && !!url && !online};
    });
}

// Only authored collections opt into the shared anatomy. Categories never select
// a destination-specific template; unverified URLs cannot become card actions.
export function curatedCollection(activity, bundle, online = true) {
  const value = activity.collection;
  if (!value?.heading?.trim() || !['shopping','food','other'].includes(value.kind)) return null;
  const items = (value.items ?? []).flatMap(item => {
    const place = bundle.places.find(place => place.placeId === item.placeId);
    if (!place || place.status !== 'active' || !item.description?.trim()) return [];
    const target = bundle.activities.find(a => a.activityId === item.activityId &&
      a.activityId !== activity.activityId && a.placeId === place.placeId);
    const link = (place.externalLinks ?? []).find(link => link.service === 'google' &&
      isGooglePlaceListing(link.url) && (place.verificationRecordIds ?? []).some(id =>
        bundle.verification.some(record => record.verificationId === id && record.targetType === 'place' &&
          record.targetId === place.placeId && record.fieldPath === 'externalLinks.google' &&
          record.status === 'verified' && (record.sourceIds ?? []).some(sourceId =>
            bundle.sources.some(source => source.sourceId === sourceId && source.active && source.url === link.url)))));
    const url = link?.url ?? null;
    return [{...item,place,target,url:online ? url : null,needsInternet:!target && !!url && !online}];
  });
  return items.length ? {...value,items} : null;
}

// Exact listing links only, not search results, directions or coordinate-only pins.
// Verification must additionally identify the correct business/branch and URL.
export function isGooglePlaceListing(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (
      (url.hostname === 'maps.app.goo.gl' && /^\/[A-Za-z0-9]+$/.test(url.pathname)) ||
      (url.hostname === 'goo.gl' && /^\/maps\/[A-Za-z0-9]+$/.test(url.pathname)) ||
      (url.hostname === 'www.google.com' && url.pathname.startsWith('/maps/place/') &&
        /!1s0x[0-9a-f]+:0x[0-9a-f]+/i.test(decodeURIComponent(url.pathname))));
  } catch { return false; }
}

function basisLabel(basis) {
  return basis?.replaceAll('_', ' ') ?? '';
}

export function activityCostPresentation(cost, state) {
  if (!cost) return null;
  const amount = cost.fixedMinor ?? cost.minimumMinor;
  if (amount === undefined) return {
    primary: 'Open-ended estimate', approximate: null, conversionUnavailable: false
  };
  if (amount === 0) return {primary: 'Free', approximate: null, conversionUnavailable: false};
  const primary = `${formatHomeMoney(amount, cost.currency)}${basisLabel(cost.basis) ? ` ${basisLabel(cost.basis)}` : ''}`;
  if (!state?.homeCurrency || state.homeCurrency === cost.currency) {
    return {primary, approximate: null, conversionUnavailable: false};
  }
  const rate = state.planningRate;
  if (rate?.fromCurrency !== cost.currency || rate.toCurrency !== state.homeCurrency) {
    return {primary, approximate: null, conversionUnavailable: true};
  }
  const converted = convertPlanningEstimate(amount, cost.currency, state.homeCurrency,
    rate.homePerDestination);
  return {primary,
    approximate: `Approx. ${formatHomeMoney(converted, state.homeCurrency)} ${state.homeCurrency}`,
    conversionUnavailable: false};
}

export async function copyAddressText(address, clipboard) {
  if (!address || typeof clipboard?.writeText !== 'function') return false;
  try {
    await clipboard.writeText(address);
    return true;
  } catch {
    return false;
  }
}
