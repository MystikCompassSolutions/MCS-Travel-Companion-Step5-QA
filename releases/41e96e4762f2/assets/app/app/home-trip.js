import {tripLifecycle} from '../domain/itinerary.js';

export function homeTripPresentation(startDate, durationDays, timeZone, previewIndex = null, now = new Date()) {
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
    status: `Trip starts ${startDate} · Previewing Day ${dayNumber}.`, cta: `View Day ${dayNumber}’s Plan →`};
  if (lifecycle.phase === 'past') return {...common, caption: 'Your trip dates have ended',
    status: `Revisit Day ${dayNumber}. Your saved trip details are still here.`,
    cta: `Revisit Day ${dayNumber}’s Plan →`};
  return {...common, caption: 'Explore your trip · Start date not set',
    status: `Previewing Day ${dayNumber}. Browse freely or add a start date in My Trip.`,
    cta: `View Day ${dayNumber}’s Plan →`};
}
