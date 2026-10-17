import {el, button, field} from './dom.js';
import {editingForm} from './edit-protection.js';
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

// Presentation only: retain authored estimates and the existing minor-unit converter.
export function budgetEstimatePresentation(total, currency, homeCurrency, planningRate) {
  const range = (min, max, format) => max === null ? `from ${format(min)}` :
    `${format(min)}${max !== min ? `–${format(max)}` : ''}`;
  const original = range(total.minimumMinor, total.maximumMinor, value => formatMoney(value, currency));
  if (currency === homeCurrency) return {primary: range(total.minimumMinor, total.maximumMinor,
    value => formatHomeMoney(value, homeCurrency)), original, approximate: false, unavailable: null};
  if (planningRate?.fromCurrency !== currency || planningRate.toCurrency !== homeCurrency)
    return {primary: null, original, approximate: false, unavailable: 'Add a planning rate'};
  try {
    const min = convertPlanningEstimate(total.minimumMinor, currency, homeCurrency, planningRate.homePerDestination);
    const max = total.maximumMinor === null ? null : convertPlanningEstimate(total.maximumMinor, currency, homeCurrency, planningRate.homePerDestination);
    return {primary: range(min, max, value => formatHomeMoney(value, homeCurrency)), original, approximate: true, unavailable: null};
  } catch {return {primary: null, original, approximate: false, unavailable: 'Planning conversion unavailable'};}
}

export function budgetView(bundle, state, {commit, storageIssue, disclosure, upgradeChoices, openHomeCurrency, edits, openEditor, finishEditor, closeEditor}) {
  const actual = actualBudget(state), progress = budgetProgress(actual.spentMinor, state.budgetPlan.totalMinor);
  const money = value => formatHomeMoney(value, state.homeCurrency);
  const disabled = !!storageIssue;
  function openSection(id, focus) {
    if (editors[id]) {const entry = editors[id]; void openEditor(entry.title, entry.content, entry.form); return;}
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
  const budgetForm = editingForm(edits, 'budget:total', 'My budget', {novalidate: true, onSubmit: event => {
    event.preventDefault();
    try {
      const value = parseMoney(total.value.trim(), state.homeCurrency);
      return commit(current => ({...current, budgetPlan: {...current.budgetPlan, totalMinor: value}}))
        .then(() => finishEditor(event.currentTarget, 'Personal budget saved on this device.'));
    } catch (error) {totalError.show(error.message, total); return false;}
  }}, field(`My total budget (${state.homeCurrency})`, total), totalError.node,
  el('button', {type: 'submit', disabled}, 'Save budget'));

  let editingId = null;
  const amount = amountInput(undefined, state.homeCurrency);
  const expenseCurrency = el('select', {'aria-label': 'Expense currency'}, currencyChoices(state.homeCurrency).map(value =>
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
  const category = el('select', {'aria-label': 'Category'}, Object.entries(categories).map(([value, [label]]) => el('option', {value}, label)));
  const date = el('input', {type: 'date', class: 'budget-expense-date', required: true, value: localDate()});
  const note = el('input', {type: 'text', maxLength: 10000});
  const expenseError = errorFor('expense-error', [amount, converted, date]);
  const expenseSubmit = el('button', {type: 'submit', disabled}, 'Save expense');
  const cancelEdit = button('Cancel edit', closeEditor, {hidden: true});
  const expenseForm = editingForm(edits, 'budget:expense', 'Actual spending', {novalidate: true, onSubmit: event => {
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
      return commit(current => {
        if (id && !current.actualExpenses.some(entry => entry.id === id)) throw new Error('This expense was removed. Reload before editing it.');
        return {...current, actualExpenses: id ? current.actualExpenses.map(entry => entry.id === id ? expense : entry) :
          [...current.actualExpenses, expense]};
      }).then(() => finishEditor(event.currentTarget, id ? 'Expense updated on this device.' : 'Expense saved on this device.', 'expenses'));
    } catch (error) {expenseError.show(error.message, invalid); return false;}
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
      el('div', {class: 'row'}, button('Edit', () => editExpense(expense), {disabled, 'data-budget-action': `edit-${expense.id}`, 'aria-label': `Edit ${categoryName(expense.category)} expense on ${expense.date}`}),
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
  const rateForm = destinationCurrency && destinationCurrency !== state.homeCurrency ? editingForm(edits, 'budget:rate', 'Currency & planning rate', {novalidate: true, onSubmit: event => {
    event.preventDefault();
    try {
      const rate = normalizePlanningRate(rateInput.value);
      convertPlanningEstimate(1, destinationCurrency, state.homeCurrency, rate);
      return commit(current => ({...current, planningRate: {fromCurrency: destinationCurrency, toCurrency: current.homeCurrency,
        homePerDestination: rate, recordedAt: new Date().toISOString()}}))
        .then(() => finishEditor(event.currentTarget, 'Planning rate saved on this device.'));
    } catch (error) {rateError.show(error.message, rateInput); return false;}
  }}, field(`Planning rate: 1 ${destinationCurrency} equals how many ${state.homeCurrency}?`, rateInput),
  rateError.node, el('button', {type: 'submit', disabled}, activeRate ? 'Update rate' : 'Save rate')) : null;
  const estimateRows = Object.entries(estimate).map(([currency, total]) => {
    const display = budgetEstimatePresentation(total, currency, state.homeCurrency, activeRate);
    const flags = [total.unknownCosts ? `${total.unknownCosts} unpriced` : '',
      total.openEndedCosts ? `${total.openEndedCosts} open-ended` : ''].filter(Boolean).join(' · ');
    return el('div', {class: 'estimate-row budget-estimate-row'},
      el('p', {class: 'section-kicker'}, `MCS estimate · per traveler · ${state.homeCurrency}`),
      display.primary !== null ? el('p', {class: `compact-value estimate-primary${display.approximate ? ' planning-conversion' : ''}`},
        `${display.approximate ? '≈ ' : ''}${display.primary}`) :
        button(display.unavailable, () => openSection('planning-rate', rateInput), {class: 'estimate-rate-action'}),
      currency !== state.homeCurrency ? el('p', {class: 'budget-support estimate-original'}, `Original ${display.original} ${currency}`) : null,
      display.approximate ? el('p', {class: 'budget-support estimate-rate-note'}, 'Approximate · recorded planning rate') : null,
      flags ? el('p', {class: 'budget-support estimate-cost-flags'}, flags) : null);
  });
  const editors = {
    'add-expense': {title: 'Add Actual Spending', content: expenseForm, form: expenseForm},
    'set-budget': {title: 'My Budget', content: budgetForm, form: budgetForm},
    'planning-rate': {title: 'Currency & Planning Rate', content: el('div', {}, ...[el('p', {}, `Home Currency: ${state.homeCurrency}. Personal amounts use this currency.`),
      button('Manage Home Currency in My Trip', openHomeCurrency),
      el('p', {class: 'budget-support'}, rateForm ? 'Record a positive planning rate with up to eight decimals. Estimates are approximate, not live or bank-guaranteed; actual spending is separate.' :
        'Home and destination currencies match; no planning conversion is needed.'), rateForm,
      activeRate ? el('p', {class: 'budget-support'}, `1 ${destinationCurrency} = ${activeRate.homePerDestination} ${state.homeCurrency} · Recorded ${activeRate.recordedAt.slice(0, 10)}`) : null]), form: rateForm}
  };
  const spending = spendingCategories(state);
  const daily = dailySpending(state);
  editors['daily-breakdown'] = {title: 'Daily Spending', content: el('div', {}, ...[el('p', {class: 'budget-support'}, `Recorded personal spending in ${state.homeCurrency}. No trip start date needed.`),
      daily.days.length ? el('ul', {class: 'budget-daily-list'}, daily.days.map(([day, value]) => el('li', {},
        el('time', {datetime: day}, dateLabel(day)), el('strong', {}, money(value))))) :
        el('p', {}, 'No dated Home Currency spending is available yet.'),
      daily.undatedMinor ? el('p', {}, `${money(daily.undatedMinor)} without a usable date remains in your spending total.`) : null]), form: null};
  function managementCard(id, title, preview, symbol) {
    return button([icon(symbol), el('strong', {}, title), el('span', {class: 'budget-card-preview'}, preview),
      el('span', {class: 'budget-card-action'}, 'View & manage', icon('arrow'))], () => openSection(id),
      {class: 'budget-management-card', 'data-budget-action': id, disabled: id !== 'daily-breakdown' && disabled});
  }
  const remaining = actual.remainingMinor >= 0 ? `${money(actual.remainingMinor)} remaining` : `${money(-actual.remainingMinor)} over budget`;
  const summary = `${money(actual.spentMinor)} spent of ${money(state.budgetPlan.totalMinor)} personal budget. ${progress.label}. ${remaining}. Home Currency ${state.homeCurrency}.`;
  return [el('div', {class: 'personal-budget-page'},
    el('div', {class: 'personal-budget-header'}, el('div', {}, el('h1', {class: 'personal-budget-title', tabindex: '-1'}, 'My Trip Budget'),
      el('p', {class: 'budget-destination'}, bundle.trip.title),
      el('p', {class: 'budget-currency'}, `Home Currency · ${state.homeCurrency}`))),
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
      {class: 'primary budget-add', 'data-budget-action': 'add-expense', disabled}),
    el('section', {class: 'personal-budget-categories'}, el('h2', {}, 'Spending by category'),
      spending.length ? [el('ul', {class: 'personal-category-list'}, spending.map(([key, value]) => el('li', {},
        el('span', {class: `personal-category-icon category-${Object.hasOwn(categories, key) ? key : 'other'}`}, icon(categories[key]?.[1] ?? 'Budget')),
        el('span', {class: 'personal-category-name'}, categoryName(key)), el('strong', {}, money(value)),
        actual.spentMinor > 0 ? el('span', {class: 'personal-category-share'}, `${Math.round(value / actual.spentMinor * 100)}%`) : null))),
        actual.spentMinor > 0 ? el('p', {class: 'budget-support'}, 'Shares of recorded personal spending.') : null] :
        el('p', {class: 'budget-support'}, 'No personal expenses yet. Your first purchase will appear here.')),
    el('section', {class: 'budget-management', 'aria-labelledby': 'manage-money-title'},
      el('p', {class: 'section-kicker'}, 'Your personal finances'),
      el('h2', {id: 'manage-money-title'}, 'Manage Your Money'),
      el('div', {class: 'budget-management-grid'},
        managementCard('add-expense', 'Add Spending', 'Record a new expense', 'documents'),
        managementCard('set-budget', 'My Budget', state.budgetPlan.totalMinor > 0 ? money(state.budgetPlan.totalMinor) + ' · ' + state.homeCurrency : 'Set your personal total', 'Budget'),
        managementCard('planning-rate', 'Currency & Rate', state.homeCurrency + (activeRate ? ' · Planning rate recorded' : ' · Review planning settings'), 'exchange'),
        managementCard('daily-breakdown', 'Daily Spending', daily.days.length ? daily.days.length + ' spending day' + (daily.days.length === 1 ? '' : 's') + ' recorded' : 'Review your dated spending', 'chart'))),
    disclosure(`Spending history · ${state.actualExpenses.length}`, state.actualExpenses.length ? history : el('p', {}, 'Your recorded purchases will appear here.'), {id: 'expenses'}),
    disclosure('MCS Trip Estimate', [el('p', {class: 'budget-support estimate-intro'}, 'Planning estimate · separate from your budget and spending.'),
      ...estimateRows,
      upgrades.length ? disclosure('Optional upgrades', upgrades.flatMap(entry => upgradeChoices(entry.activity)), {id: 'upgrades'}) : null], {id: 'mcs-estimate'}),
    state.preferences?.homeBudgetVisible === false ? el('section', {class: 'budget-home-preference'},
      el('p', {}, 'Your personal budget card is hidden from Home.'), button('Show budget card on Home', () => commit(current => ({...current,
        preferences: {...current.preferences, homeBudgetVisible: true}})).catch(() => {}), {disabled})) : null)];
}
