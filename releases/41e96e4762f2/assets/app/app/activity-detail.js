import {convertPlanningEstimate, formatHomeMoney} from '../domain/budget.js';

function basisLabel(basis) {
  return basis?.replaceAll('_', ' ') ?? '';
}

export function activityCostPresentation(cost, state) {
  if (!cost) return null;
  const amount = cost.fixedMinor ?? cost.minimumMinor;
  if (amount === undefined) return {
    primary: 'Open-ended sample estimate', approximate: null, conversionUnavailable: false
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
