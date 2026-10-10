import {effectiveOptions, resolveDay} from './itinerary.js';

export function currencyDigits(currency) {
  return new Intl.NumberFormat('en-US', {style: 'currency', currency}).resolvedOptions().maximumFractionDigits;
}

export function formatMoney(minor, currency) {
  return new Intl.NumberFormat('en-US', {style: 'currency', currency}).format(minor / (10 ** currencyDigits(currency)));
}

export function formatHomeMoney(minor, currency) {
  const digits = currencyDigits(currency);
  const divisor = 10 ** digits;
  const wholeAmount = minor % divisor === 0;
  return new Intl.NumberFormat('en-US', {style: 'currency', currency,
    minimumFractionDigits: wholeAmount ? 0 : digits, maximumFractionDigits: digits}).format(minor / divisor);
}

export function parseMoney(input, currency) {
  const digits = currencyDigits(currency);
  const pattern = new RegExp(`^\\d{1,12}(?:\\.\\d{1,${Math.max(digits, 1)}})?$`);
  if (!pattern.test(input) || (digits === 0 && input.includes('.'))) {
    throw new Error('Enter a valid nonnegative amount for this currency.');
  }
  const [whole, fraction = ''] = input.split('.');
  const result = Number(whole) * (10 ** digits) + Number(fraction.padEnd(digits, '0'));
  if (!Number.isSafeInteger(result)) throw new Error('Amount is too large.');
  return result;
}

export function normalizePlanningRate(input) {
  const rate = typeof input === 'string' ? input.trim().replace(/^\./, '0.') : '';
  if (!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,8})?$/.test(rate) || Number(rate) <= 0) {
    throw new Error('Enter a rate greater than zero, such as 0.0063 or .0063, with up to 8 decimal places and 6 digits before the decimal.');
  }
  return rate;
}

export function convertPlanningEstimate(minor, fromCurrency, toCurrency, rate) {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error('Invalid amount to convert.');
  const [whole, fraction = ''] = normalizePlanningRate(rate).split('.');
  const numerator = BigInt(whole + fraction);
  const denominator = 10n ** BigInt(fraction.length);
  const scaled = BigInt(minor) * numerator * (10n ** BigInt(currencyDigits(toCurrency)));
  const divisor = denominator * (10n ** BigInt(currencyDigits(fromCurrency)));
  const rounded = (scaled + divisor / 2n) / divisor;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Planning conversion is too large.');
  return Number(rounded);
}

function costIdsForEntity(bundle, item) {
  const collection = item.itemType === 'transport' ? bundle.transport :
    item.itemType === 'lodging' ? bundle.lodgingGuidance : bundle.activities;
  const entity = collection.find(candidate =>
    (candidate.activityId ?? candidate.transportId ?? candidate.lodgingGuideId) === item.referencedEntityId);
  return entity?.costIds ?? entity?.fareCostIds ?? [];
}

function costIdsForOption(bundle, option) {
  const entries = option.scheduleItems?.length ? option.scheduleItems : [
    ...option.transportIds.map(id => ({itemType: 'transport', referencedEntityId: id})),
    ...option.activityIds.map(id => ({itemType: 'activity', referencedEntityId: id}))
  ];
  return [...entries.flatMap(item => costIdsForEntity(bundle, item)), ...option.costIds];
}

export function costMultiplier(cost, partySize) {
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 20) throw new Error('Party size must be 1–20.');
  const quantity = cost.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 366) throw new Error('Invalid cost quantity.');
  if (cost.basis === 'other') return null;
  return quantity * (cost.basis === 'per_person' ? partySize : 1);
}

export function availableUpgradeCosts(bundle, state) {
  const active = new Set(bundle.days.flatMap(day => resolveDay(bundle, state, day))
    .filter(item => item.itemType === 'activity').map(item => item.referencedEntityId));
  return bundle.activities.filter(activity => active.has(activity.activityId))
    .flatMap(activity => (activity.optionalUpgradeIds ?? []).map(id => ({
      activity, cost: bundle.costs.find(candidate => candidate.costId === id)
    })));
}

export function plannedBudget(bundle, state) {
  const ids = [];
  for (const day of bundle.days) {
    for (const item of day.scheduleItems) {
      if (item.itemType !== 'option_group') {
        ids.push(...costIdsForEntity(bundle, item));
        continue;
      }
      const group = bundle.optionGroups.find(candidate => candidate.optionGroupId === item.referencedEntityId);
      if (!group) throw new Error('Missing option group');
      for (const option of effectiveOptions(bundle, state, group, 'budget')) {
        ids.push(...costIdsForOption(bundle, option));
      }
    }
  }
  const selectedUpgrades = new Set(state.selectedUpgradeIds ?? []);
  for (const day of bundle.days) for (const item of resolveDay(bundle, state, day)) {
    if (item.itemType !== 'activity') continue;
    const activity = bundle.activities.find(candidate => candidate.activityId === item.referencedEntityId);
    ids.push(...(activity?.optionalUpgradeIds ?? []).filter(id => selectedUpgrades.has(id)));
  }
  const totals = {};
  for (const id of ids) {
    const cost = bundle.costs.find(candidate => candidate.costId === id);
    if (!cost) throw new Error(`Missing cost ${id}`);
    const total = totals[cost.currency] ??= {minimumMinor: 0, maximumMinor: 0, unknownCosts: 0, openEndedCosts: 0};
    const multiplier = costMultiplier(cost, state.partySize ?? 1);
    if (multiplier === null || cost.pricingModel === 'variable') {
      total.unknownCosts++;
      continue;
    }
    const minimum = cost.pricingModel === 'free' ? 0 : cost.fixedMinor ?? cost.minimumMinor;
    if (minimum === undefined) {total.unknownCosts++; continue;}
    const maximum = cost.pricingModel === 'from' ? null : cost.maximumMinor ?? minimum;
    const scaledMinimum = minimum * multiplier;
    const scaledMaximum = maximum === null ? null : maximum * multiplier;
    if (!Number.isSafeInteger(scaledMinimum) ||
        (scaledMaximum !== null && !Number.isSafeInteger(scaledMaximum))) throw new Error('Estimate overflow');
    total.minimumMinor += scaledMinimum;
    if (maximum === null) total.openEndedCosts++;
    else if (total.maximumMinor !== null) total.maximumMinor += scaledMaximum;
    if (total.openEndedCosts) total.maximumMinor = null;
    if (!Number.isSafeInteger(total.minimumMinor) ||
        (total.maximumMinor !== null && !Number.isSafeInteger(total.maximumMinor))) throw new Error('Estimate overflow');
  }
  return totals;
}

export function travelerEstimate(bundle, state) {
  return plannedBudget(bundle, {...state, partySize: 1});
}

export function actualBudget(state) {
  let spentMinor = 0;
  const unconverted = [];
  for (const expense of state.actualExpenses) {
    const value = expense.currency === state.homeCurrency ? expense.amountMinor : expense.convertedHomeMinor;
    if (value === undefined) unconverted.push(expense);
    else spentMinor += value;
  }
  if (!Number.isSafeInteger(spentMinor)) throw new Error('Expense total overflow');
  return {spentMinor, remainingMinor: state.budgetPlan.totalMinor - spentMinor, unconverted};
}
