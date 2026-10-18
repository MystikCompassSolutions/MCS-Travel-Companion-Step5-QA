import {tripLifecycle} from '../domain/itinerary.js';

export function readableTripDate(date, locale) {
  // Format the stored calendar date, not a device-local departure instant.
  return new Intl.DateTimeFormat(locale, {month: 'short', day: 'numeric', year: 'numeric',
    timeZone: 'UTC'}).format(new Date(`${date}T00:00:00Z`));
}

export function homeTripPresentation(startDate, durationDays, timeZone, previewIndex = null, now = new Date(), locale) {
  const lifecycle = tripLifecycle(startDate, durationDays, timeZone, now);
  const preview = Number.isInteger(previewIndex) && previewIndex >= 0 && previewIndex < durationDays;
  const index = lifecycle.phase === 'active' ? lifecycle.index : preview ? previewIndex : lifecycle.index;
  const dayNumber = index + 1;
  const common = {lifecycle, index, progress: null, kicker: 'Your plan'};
  if (lifecycle.phase === 'active') return {...common, progress: dayNumber, kicker: 'Today',
    caption: `Day ${dayNumber} of ${durationDays}`, status: 'Current day in the destination time zone.',
    cta: 'Continue Today’s Plan →'};
  if (lifecycle.phase === 'upcoming') return {...common,
    caption: `${lifecycle.daysUntil} ${lifecycle.daysUntil === 1 ? 'day' : 'days'} until your trip`,
    status: `Starts ${readableTripDate(startDate, locale)} · Day ${dayNumber} preview`,
    statusParts: [`Starts ${readableTripDate(startDate, locale)}`, `Day\u00a0${dayNumber} preview`],
    cta: `View Day ${dayNumber}’s Plan →`};
  if (lifecycle.phase === 'past') return {...common, caption: 'Your trip dates have ended',
    status: `Revisit Day\u00a0${dayNumber}. Your saved trip details are still here.`,
    cta: `Revisit Day ${dayNumber}’s Plan →`};
  return {...common, caption: 'Explore your trip · Start date not set',
    status: `Previewing Day\u00a0${dayNumber}. Browse freely or add a start date in My Trip.`,
    cta: `View Day ${dayNumber}’s Plan →`};
}
