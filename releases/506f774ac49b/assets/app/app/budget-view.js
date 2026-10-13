import {el, button, field} from './dom.js';
import {icon, budgetProgress, budgetRing, spendingCategories} from './visual.js';
import {actualBudget, travelerEstimate, availableUpgradeCosts, dailySpending,
  moneyInputValue, formatHomeMoney, formatMoney, parseMoney,
  normalizePlanningRate, convertPlanningEstimate} from '../domain/budget.js';

const categories = {
  lodging: ['Accommodation', 'Home'], food: ['Food & Drink', 'food'],
  transport: ['Transport', 'transit'], activity: ['Activities', 'compass'],
  shopping: ['Shopping', 'shopping'], other: ['Other', 'Budget']
};
const categoryName = key => categories[key]?.[0] ?? key;
const currencyChoices = home => [...new Set([home, 'USD', 'JPY', 'ISK', 'EUR', 'GBP', 'CAD', 'AUD'])];
function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function dateLabel(date) {
  return new Intl.DateTimeFormat('en-US', {month: 'short', day: 'numeric', year: 'numeric'})
    .format(new Date(`${date}T12:00:00`));
}
function amountInput(minor, currency) {
  return el('input', {type: 'text', inputmode: 'decimal', required: true,
    value: minor === undefined ? '' : moneyInputValue(minor, currency)});
}

export function budgetView(bundle, state, {commit, storageIssue, disclosure, upgradeChoices, openHomeCurrency}) {
  const actual = actualBudget(state), progress = budgetProgress(actual.spentMinor, state.budgetPlan.totalMinor);
  const money = value => formatHomeMoney(value, state.homeCurrency);
  const disabled = !!storageIssue;
  function openSection(id, focus) {
    const section = document.querySelector(`details[data-section="${id}"]`);
    if (!section) return;
    section.open = true;
    (focus ?? section.querySelector('input') ?? section.querySelector('summary'))?.focus();
  }
  function saved(message, section) {
    const status = document.querySelector('#budget-status');
    if (!status) return;
    status.textContent = message;
    if (section) openSection(section, document.querySelector(`details[data-section="${section}"] > summary`));
    else document.querySelector('.personal-budget-title')?.focus({preventScroll: true});
  }
  function errorFor(id, inputs) {
    const error = el('p', {id, class: 'error', role: 'alert'});
    for (const input of inputs) {
      input.setAttribute('aria-describedby', id);
      input.addEventListener('input', () => {error.textContent = ''; input.removeAttribute('aria-invalid');});
    }
    return {node: error, show(errorMessage, input) {
      error.textContent = errorMessage; input.setAttribute('aria-invalid', 'true'); input.focus();
    }};
  }
  const total = amountInput(state.budgetPlan.totalMinor, state.homeCurrency);
  const totalError = errorFor('budget-total-error', [total]);
  const budgetForm = el('form', {novalidate: true, onSubmit: event => {
    event.preventDefault();
    try {
      const value = parseMoney(total.value.trim(), state.homeCurrency);
      commit(current => ({...current, budgetPlan: {...current.budgetPlan, totalMinor: value}}))
        .then(() => saved('Personal budget saved on this device.')).catch(() => {});
    } catch (error) {totalError.show(error.message, total);}
  }}, field(`My total budget (${state.homeCurrency})`, total), totalError.node,
  el('button', {type: 'submit', disabled}, 'Save budget'));

  let editingId = null;
  const amount = amountInput(undefined, state.homeCurrency);
  const expenseCurrency = el('select', {}, currencyChoices(state.homeCurrency).map(value =>
    el('option', {value, selected: value === state.homeCurrency}, value)));
  const converted = el('input', {type: 'text', inputmode: 'decimal'});
  const convertedField = field(`Manual converted amount in ${state.homeCurrency} (optional)`, converted);
  const conversionHelp = el('p', {class: 'budget-support'},
    'Only an explicit Home Currency amount is included in your spending totals. Use your recorded charge; the planning rate never converts actual expenses.');
  const amountLabel = field(`Expense amount (${state.homeCurrency})`, amount);
  function currencyChanged() {
    amountLabel.firstChild.textContent = `Expense amount (${expenseCurrency.value})`;
    convertedField.hidden = conversionHelp.hidden = expenseCurrency.value === state.homeCurrency;
  }
  expenseCurrency.addEventListener('change', currencyChanged); currencyChanged();
  const category = el('select', {}, Object.entries(categories).map(([value, [label]]) => el('option', {value}, label)));
  const date = el('input', {type: 'date', required: true, value: localDate()});
  const note = el('input', {type: 'text', maxLength: 10000});
  const expenseError = errorFor('expense-error', [amount, converted, date]);
  const expenseSubmit = el('button', {type: 'submit', disabled}, 'Save expense');
  const cancelEdit = button('Cancel edit', () => {
    editingId = null; amount.value = converted.value = note.value = '';
    expenseCurrency.value = state.homeCurrency; currencyChanged(); date.value = localDate();
    expenseSubmit.textContent = 'Save expense'; cancelEdit.hidden = true;
    expenseError.node.textContent = ''; amount.focus();
  }, {hidden: true});
  const expenseForm = el('form', {novalidate: true, onSubmit: event => {
    event.preventDefault();
    let invalid = amount;
    try {
      const currency = expenseCurrency.value;
      const amountMinor = parseMoney(amount.value.trim(), currency);
      invalid = converted;
      const convertedHomeMinor = currency !== state.homeCurrency && converted.value.trim() ?
        parseMoney(converted.value.trim(), state.homeCurrency) : undefined;
      invalid = date;
      if (!date.value || !date.validity.valid) throw new Error('Enter a valid expense date. A trip start date is not required.');
      const id = editingId;
      const expense = {id: id ?? `expense_${crypto.randomUUID()}`, date: date.value,
        category: category.value, amountMinor, currency, note: note.value,
        ...(convertedHomeMinor !== undefined ? {convertedHomeMinor} : {})};
      commit(current => {
        if (id && !current.actualExpenses.some(entry => entry.id === id)) throw new Error('This expense was removed. Reload before editing it.');
        return {...current, actualExpenses: id ? current.actualExpenses.map(entry => entry.id === id ? expense : entry) :
          [...current.actualExpenses, expense]};
      }).then(() => saved(id ? 'Expense updated on this device.' : 'Expense saved on this device.', 'expenses')).catch(() => {});
    } catch (error) {expenseError.show(error.message, invalid);}
  }}, el('p', {class: 'budget-support'}, 'Record only your personal share of a purchase.'),
  amountLabel, field('Expense currency', expenseCurrency), convertedField, conversionHelp,
  field('Category', category), field('Expense date', date), field('Expense note', note), expenseError.node,
  el('div', {class: 'row'}, expenseSubmit, cancelEdit));
  function editExpense(expense) {
    editingId = expense.id;
    if (!currencyChoices(state.homeCurrency).includes(expense.currency)) expenseCurrency.append(el('option', {value: expense.currency}, expense.currency));
    if (!Object.hasOwn(categories, expense.category) && ![...category.options].some(o => o.value === expense.category))
      category.append(el('option', {value: expense.category}, expense.category));
    expenseCurrency.value = expense.currency; currencyChanged();
    amount.value = moneyInputValue(expense.amountMinor, expense.currency);
    converted.value = expense.convertedHomeMinor === undefined ? '' : moneyInputValue(expense.convertedHomeMinor, state.homeCurrency);
    category.value = expense.category; date.value = expense.date; note.value = expense.note ?? '';
    expenseSubmit.textContent = 'Save changes'; cancelEdit.hidden = false; openSection('add-expense', amount);
  }
  const history = el('ul', {class: 'budget-history'}, state.actualExpenses.map(expense => {
    const value = expense.currency === state.homeCurrency ? expense.amountMinor : expense.convertedHomeMinor;
    return el('li', {}, el('div', {class: 'budget-history-heading'},
      el('strong', {}, categoryName(expense.category)), el('strong', {}, value === undefined ? 'Conversion needed' : money(value))),
      el('p', {class: 'budget-support'}, expense.date, expense.currency !== state.homeCurrency ?
        ` · Original ${formatHomeMoney(expense.amountMinor, expense.currency)} ${expense.currency}${value === undefined ? ' · Not included in totals' : ' · Explicit conversion'}` : '',
        expense.note ? ` · ${expense.note}` : ''),
      el('div', {class: 'row'}, button('Edit', () => editExpense(expense), {disabled, 'aria-label': `Edit ${categoryName(expense.category)} expense on ${expense.date}`}),
      button('Remove', () => {
        if (confirm('Remove this expense from this device?')) commit(current => ({...current,
          actualExpenses: current.actualExpenses.filter(entry => entry.id !== expense.id)}))
          .then(() => saved('Expense removed from this device.', 'expenses')).catch(() => {});
      }, {disabled, 'aria-label': `Remove ${categoryName(expense.category)} expense on ${expense.date}`})));
  }));

  const estimate = travelerEstimate(bundle, state), upgrades = availableUpgradeCosts(bundle, state);
  const destinationCurrency = Object.keys(estimate)[0] ?? bundle.costs[0]?.currency;
  const activeRate = state.planningRate?.fromCurrency === destinationCurrency &&
    state.planningRate.toCurrency === state.homeCurrency ? state.planningRate : null;
  const rateInput = el('input', {type: 'text', inputmode: 'decimal', 'aria-required': 'true',
    placeholder: 'e.g. 0.0063', value: activeRate?.homePerDestination ?? ''});
  const rateError = errorFor('planning-rate-error', [rateInput]);
  const rateForm = destinationCurrency && destinationCurrency !== state.homeCurrency ? el('form', {novalidate: true, onSubmit: event => {
    event.preventDefault();
    try {
      const rate = normalizePlanningRate(rateInput.value);
      convertPlanningEstimate(1, destinationCurrency, state.homeCurrency, rate);
      commit(current => ({...current, planningRate: {fromCurrency: destinationCurrency, toCurrency: current.homeCurrency,
        homePerDestination: rate, recordedAt: new Date().toISOString()}}))
        .then(() => saved('Planning rate saved on this device.', 'planning-rate')).catch(() => {});
    } catch (error) {rateError.show(error.message, rateInput);}
  }}, field(`Planning rate: 1 ${destinationCurrency} equals how many ${state.homeCurrency}?`, rateInput),
  rateError.node, el('button', {type: 'submit', disabled}, activeRate ? 'Update rate' : 'Save rate')) : null;
  const estimateRows = Object.entries(estimate).map(([currency, total]) => {
    const range = total.maximumMinor === null ? `from ${formatMoney(total.minimumMinor, currency)}` :
      `${formatMoney(total.minimumMinor, currency)}${total.maximumMinor !== total.minimumMinor ? `–${formatMoney(total.maximumMinor, currency)}` : ''}`;
    let conversion = null;
    if (activeRate?.fromCurrency === currency) {
      try {
        const min = convertPlanningEstimate(total.minimumMinor, currency, state.homeCurrency, activeRate.homePerDestination);
        const max = total.maximumMinor === null ? null : convertPlanningEstimate(total.maximumMinor, currency, state.homeCurrency, activeRate.homePerDestination);
        conversion = el('p', {class: 'planning-conversion'}, `≈ ${money(min)}${max !== null && max !== min ? `–${money(max)}` : ''} ${state.homeCurrency} · approximate`);
      } catch {conversion = el('p', {}, 'This estimate is too large to convert with the recorded rate. Original estimate retained.');}
    }
    return el('div', {class: 'estimate-row'}, el('p', {class: 'section-kicker'}, 'MCS estimate · per traveler'),
      el('p', {class: 'compact-value'}, `${range} ${currency}`), conversion,
      total.unknownCosts ? el('small', {}, `${total.unknownCosts} unpriced item${total.unknownCosts === 1 ? '' : 's'}`) : null,
      total.openEndedCosts ? el('p', {class: 'budget-support'}, `${total.openEndedCosts} open-ended cost${total.openEndedCosts === 1 ? '' : 's'}; final total unknown.`) : null);
  });
  const spending = spendingCategories(state);
  const daily = dailySpending(state);
  const remaining = actual.remainingMinor >= 0 ? `${money(actual.remainingMinor)} remaining` : `${money(-actual.remainingMinor)} over budget`;
  const summary = `${money(actual.spentMinor)} spent of ${money(state.budgetPlan.totalMinor)} personal budget. ${progress.label}. ${remaining}. Home Currency ${state.homeCurrency}.`;
  return [el('div', {class: 'personal-budget-page'},
    el('div', {class: 'personal-budget-header'}, el('div', {}, el('h1', {class: 'personal-budget-title', tabindex: '-1'}, 'My Trip Budget'),
      el('p', {class: 'budget-destination'}, bundle.trip.title),
      el('p', {class: 'budget-currency'}, `Home Currency · ${state.homeCurrency}`)),
      button(icon('settings'), () => openSection('set-budget'), {class: 'budget-settings', 'aria-label': 'Budget settings'})),
    el('p', {id: 'budget-status', role: 'status'}),
    el('section', {class: 'personal-budget-overview', 'aria-label': 'Personal budget overview'},
      progress.percent === null ? el('div', {class: 'personal-budget-empty'},
        el('h2', {}, 'Make room for your trip'), el('p', {}, 'Set your personal budget to see how much is left.'),
        el('p', {class: 'budget-spent'}, `${money(actual.spentMinor)} spent`),
        button('Set my budget', () => openSection('set-budget'), {class: 'budget-set-action'})) :
        el('div', {class: 'personal-budget-figure', role: 'img', 'aria-label': summary}, budgetRing(progress),
          el('div', {class: 'personal-budget-center', 'aria-hidden': 'true'},
            el('p', {class: 'budget-spent'}, money(actual.spentMinor)), el('p', {class: 'budget-spent-label'}, 'spent'),
            el('p', {class: 'budget-of'}, `of ${money(state.budgetPlan.totalMinor)} budget`),
            el('p', {class: 'budget-percent'}, `${progress.percent}%`))),
      progress.percent !== null ? el('p', {class: `budget-remaining${actual.remainingMinor < 0 ? ' is-over-budget' : ''}`}, remaining) : null,
      actual.unconverted.length ? el('p', {class: 'budget-support budget-unconverted'},
        `${actual.unconverted.length} foreign expense${actual.unconverted.length === 1 ? '' : 's'} awaiting an explicit Home Currency amount; excluded from totals. Review Spending history.`) : null),
    button([el('span', {'aria-hidden': 'true'}, '+'), ' Add Expense'], () => openSection('add-expense', amount),
      {class: 'primary budget-add', disabled}),
    el('section', {class: 'personal-budget-categories'}, el('h2', {}, 'Spending by category'),
      spending.length ? [el('ul', {class: 'personal-category-list'}, spending.map(([key, value]) => el('li', {},
        el('span', {class: `personal-category-icon category-${Object.hasOwn(categories, key) ? key : 'other'}`}, icon(categories[key]?.[1] ?? 'Budget')),
        el('span', {class: 'personal-category-name'}, categoryName(key)), el('strong', {}, money(value)),
        actual.spentMinor > 0 ? el('span', {class: 'personal-category-share'}, `${Math.round(value / actual.spentMinor * 100)}%`) : null))),
        actual.spentMinor > 0 ? el('p', {class: 'budget-support'}, 'Shares of recorded personal spending.') : null] :
        el('p', {class: 'budget-support'}, 'No personal expenses yet. Your first purchase will appear here.')),
    disclosure('View Daily Breakdown', [el('p', {class: 'budget-support'}, `Recorded personal spending in ${state.homeCurrency}. No trip start date needed.`),
      daily.days.length ? el('ul', {class: 'budget-daily-list'}, daily.days.map(([day, value]) => el('li', {},
        el('time', {datetime: day}, dateLabel(day)), el('strong', {}, money(value))))) :
        el('p', {}, 'No dated Home Currency spending is available yet.'),
      daily.undatedMinor ? el('p', {}, `${money(daily.undatedMinor)} without a usable date remains in your spending total.`) : null], {id: 'daily-breakdown', className: 'budget-daily'}),
    disclosure('Add actual spending', expenseForm, {id: 'add-expense'}),
    disclosure(`Spending history · ${state.actualExpenses.length}`, state.actualExpenses.length ? history : el('p', {}, 'Your recorded purchases will appear here.'), {id: 'expenses'}),
    disclosure('Set my budget', budgetForm, {id: 'set-budget'}),
    disclosure('Currency & Planning Rate', [el('p', {}, `Home Currency: ${state.homeCurrency}. Personal amounts use this currency.`),
      button('Manage Home Currency in My Trip', openHomeCurrency),
      el('p', {class: 'budget-support'}, rateForm ? 'Record a positive planning rate with up to eight decimals. Estimates are approximate, not live or bank-guaranteed; actual spending is separate.' :
        'Home and destination currencies match; no planning conversion is needed.'), rateForm,
      activeRate ? el('p', {class: 'budget-support'}, `1 ${destinationCurrency} = ${activeRate.homePerDestination} ${state.homeCurrency} · Recorded ${activeRate.recordedAt.slice(0, 10)}`) : null], {id: 'planning-rate'}),
    disclosure('MCS Trip Estimate', [el('p', {class: 'budget-support'}, 'Per-traveler authored planning costs. Separate from your budget and actual spending.'),
      ...estimateRows, !activeRate && destinationCurrency !== state.homeCurrency ? el('p', {class: 'budget-support'}, 'Add a planning rate for an approximate Home Currency equivalent.') : null,
      el('p', {class: 'budget-support'}, 'Authored group, one-way and round-trip costs retain their full value. Shared costs are never automatically split. Unpriced and open-ended costs remain unknown.'),
      upgrades.length ? disclosure('Optional upgrades', [el('p', {}, 'Only upgrades for selected activities appear here.'), ...upgrades.flatMap(entry => upgradeChoices(entry.activity))], {id: 'upgrades'}) : null], {id: 'mcs-estimate'}),
    state.preferences?.homeBudgetVisible === false ? el('section', {class: 'budget-home-preference'},
      el('p', {}, 'Your personal budget card is hidden from Home.'), button('Show budget card on Home', () => commit(current => ({...current,
        preferences: {...current.preferences, homeBudgetVisible: true}})).catch(() => {}), {disabled})) : null)];
}
