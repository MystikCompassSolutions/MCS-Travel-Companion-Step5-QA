import {el} from './dom.js';

// Original, dependency-free icons. Text remains the accessible name of controls.
export function icon(name, className = 'ui-icon') {
  const paths = {
    Home: 'M3 10 12 3l9 7v11h-6v-6H9v6H3z',
    Itinerary: 'M5 4h14v18H5z M9 2v4 M15 2v4 M8 10h8 M8 14h8 M8 18h5',
    Explore: 'M12 22s7-6 7-13a7 7 0 0 0-14 0c0 7 7 13 7 13z M12 7a2 2 0 1 0 0 4a2 2 0 1 0 0-4',
    Budget: 'M3 7h18v14H3z M3 7V4h15 M16 12h5 M16 15h2',
    Info: 'M5 3h14v18H5z M9 8h6 M9 12h6 M9 16h4',
    compass: 'M12 22a10 10 0 1 0 0-20a10 10 0 1 0 0 20z M16 8l-3 5-5 3 3-5z',
    clock: 'M12 22a10 10 0 1 0 0-20a10 10 0 1 0 0 20z M12 6v6l4 2',
    walk: 'M13 3a1 1 0 1 0 0 2a1 1 0 1 0 0-2 M9 22l3-7-2-4 M13 7l-3 4-4 1 M13 7l3 5 4 1 M13 7l-1 8 5 7',
    documents: 'M5 2h10l4 4v16H5z M14 2v5h5 M9 11h6 M9 15h6 M9 19h4',
    transit: 'M6 3h12l2 3v12H4V6z M4 11h16 M8 18l-2 4 M16 18l2 4 M8 15h.01 M16 15h.01',
    connectivity: 'M3 8a14 14 0 0 1 18 0 M6 12a9 9 0 0 1 12 0 M9 16a4 4 0 0 1 6 0 M12 20h.01',
    culture: 'M3 5h18 M6 5v16 M18 5v16 M3 10h18 M10 5V2 M14 5V2',
    help: 'M12 2l10 18H2z M12 8v5 M12 17h.01',
    lock: 'M5 10h14v12H5z M8 10V6a4 4 0 0 1 8 0v4 M12 15v3',
    arrow: 'M4 12h16 M14 6l6 6-6 6',
    external: 'M14 3h7v7 M21 3l-9 9 M10 3H3v18h18v-7',
    copy: 'M9 8h11v13H9z M5 16H3V3h12v2',
    close: 'M6 6l12 12 M6 18 18 6',
    done: 'M12 22a10 10 0 1 0 0-20a10 10 0 1 0 0 20z M7 12l3 3 7-7',
    incomplete: 'M12 22a10 10 0 1 0 0-20a10 10 0 1 0 0 20z',
    food: 'M4 2v7a3 3 0 0 0 6 0V2 M7 2v20 M20 22V2c-5 2-5 10 0 10',
    shopping: 'M4 7h16l1 15H3z M8 7V5a4 4 0 0 1 8 0v2'
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({class: className, viewBox: '0 0 24 24',
    fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round',
    'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false'})) svg.setAttribute(key, value);
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', paths[name] ?? paths.compass); svg.append(path);
  return svg;
}

function localMedia(bundle, mediaId) {
  const asset = bundle.media.find(media => media.mediaId === mediaId);
  // Only bundled relative media. No external image request or arbitrary imported URL.
  return asset && /^media\/[a-z0-9_-]+\.(webp|svg)$/.test(asset.webAssetReference) ? asset : null;
}

export function mediaImage(bundle, mediaId, className = '', decorative = false, fallbackMediaId = null) {
  const fallback = localMedia(bundle, fallbackMediaId);
  const asset = localMedia(bundle, mediaId) ?? fallback;
  if (!asset) return null;
  const image = el('img', {src: new URL(`../${asset.webAssetReference}`, import.meta.url).href,
    alt: decorative ? '' : asset.altText, class: className, decoding: 'async'});
  if (fallback && fallback.mediaId !== asset.mediaId) image.addEventListener('error', () => {
    if (image.dataset.fallbackApplied) return;
    image.dataset.fallbackApplied = 'true';
    image.src = new URL(`../${fallback.webAssetReference}`, import.meta.url).href;
    image.alt = decorative ? '' : fallback.altText;
  });
  return image;
}

export function homeHeroMediaId(bundle, currentDay) {
  const fallback = bundle.media[0]?.mediaId;
  if (!currentDay || !['active', 'past'].includes(currentDay.phase)) return fallback;
  const candidate = bundle.days[currentDay.index]?.heroMediaId;
  return candidate && bundle.media.some(media => media.mediaId === candidate) ? candidate : fallback;
}

export function mediaCredits(bundle) {
  return bundle.media.filter(asset => asset.type === 'photo').map(asset => asset.sourceOwnership === 'mcs_owned' ?
    el('p', {}, asset.requiredCreditText || asset.creator, ' · ', asset.license,
      asset.rightsReviewStatus === 'required_before_production' ? ' · QA use only; depicted-rights review required before production.' : '',
      ' · Resized, WebP conversion and display cropping.') :
    el('p', {},
      el('a', {href: asset.originalSourceUrl, target: '_blank', rel: 'noopener noreferrer'}, asset.requiredCreditText),
      ' · ', el('a', {href: asset.license === 'CC0' ? 'https://creativecommons.org/publicdomain/zero/1.0/' :
        `https://creativecommons.org/licenses/by/${asset.licenseVersion}/`, target: '_blank', rel: 'noopener noreferrer'},
      `${asset.license} ${asset.licenseVersion}`), ' · Resized, WebP conversion and display cropping.'));
}

export function budgetProgress(spent, total) {
  if (total <= 0) return {percent: null, arc: 0, label: 'Set a budget to track spending'};
  const percent = Math.round(spent / total * 100);
  return {percent, arc: Math.min(100, Math.max(0, percent)), label: `${percent}% of my budget spent`};
}

export function spendingCategories(state) {
  const totals = new Map();
  for (const expense of state.actualExpenses) {
    const amount = expense.currency === state.homeCurrency ? expense.amountMinor : expense.convertedHomeMinor;
    if (amount === undefined) continue;
    totals.set(expense.category, (totals.get(expense.category) ?? 0) + amount);
  }
  return [...totals.entries()];
}

export function budgetRing(progress) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 120 120'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'budget-ring');
  for (const [className, dash] of [['ring-track', null], ['ring-value', progress.arc]]) {
    if (dash === 0) continue;
    const circle = document.createElementNS(svg.namespaceURI, 'circle');
    for (const [key, value] of Object.entries({cx: 60, cy: 60, r: 51, fill: 'none',
      'stroke-width': 8, pathLength: 100, class: className,
      ...(dash !== null ? {'stroke-dasharray': `${dash} 100`, transform: 'rotate(-90 60 60)'} : {})}))
      circle.setAttribute(key, value);
    svg.append(circle);
  }
  return svg;
}

// Bounded diagram coordinates, deliberately unrelated to geographic positions.
export function schematicPositions(count) {
  const shown = Math.min(count, 8);
  return Array.from({length: shown}, (_, index) => ({
    x: 22 + (index % 2) * 53, y: 18 + Math.floor(index / 2) * (shown <= 4 ? 48 : 21)
  }));
}
