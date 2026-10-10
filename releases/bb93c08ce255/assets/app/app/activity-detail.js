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
