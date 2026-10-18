import {el} from './dom.js';

// Native controls normalize dates/select values; preserve text and textarea content,
// including intentional whitespace. Focus alone is never a change.
export function formValues(form) {
  return [...form.elements].filter(n => /^(INPUT|SELECT|TEXTAREA)$/.test(n.tagName) &&
    !['submit', 'button', 'reset', 'file'].includes(n.type)).map(n =>
    n.type === 'checkbox' || n.type === 'radio' ? n.checked :
      n.multiple ? [...n.selectedOptions].map(o => o.value) : n.value.replace(/\r\n/g, '\n'));
}
function restoreValues(form, values) {
  let index = 0;
  for (const n of [...form.elements].filter(n => /^(INPUT|SELECT|TEXTAREA)$/.test(n.tagName) &&
    !['submit', 'button', 'reset', 'file'].includes(n.type))) {
    const value = values[index++];
    if (value === undefined) continue;
    if (n.type === 'checkbox' || n.type === 'radio') n.checked = value;
    else if (n.multiple) for (const o of n.options) o.selected = value.includes(o.value);
    else n.value = value;
  }
}
export const valuesDiffer = (a, b) => JSON.stringify(a) !== JSON.stringify(b);

export function createEditProtection({prompt, changed = () => {}, invalid = () => {}, failed = () => {}}) {
  const records = new Map(), drafts = new Map(), definitions = new WeakMap();
  let leaving = false;
  const active = () => [...records.values()].filter(r => r.form.isConnected && r.form.getClientRects().length);
  const dirty = record => valuesDiffer(formValues(record.form), record.baseline);
  const refresh = () => changed(active()[0] ?? null);
  function saved(form) {
    const record = [...records.values()].find(r => r.form === form);
    if (!record) return;
    record.baseline = record.submitted ?? formValues(form); drafts.delete(record.key);
  }
  async function submit(record) {
    if (record.busy) return false;
    if (!record.form.reportValidity()) {invalid(record.form); return false;}
    record.busy = true; record.submitted = formValues(record.form);
    const controls = [...record.form.elements].map(n => [n, n.disabled]);
    controls.forEach(([n]) => n.disabled = true); refresh();
    let success = false;
    try {
      const result = await record.submit();
      if (result === false) return false;
      saved(record.form); success = true; return true;
    } catch (error) {failed(record.form, error); return false;}
    finally {
      controls.forEach(([n, disabled]) => n.disabled = disabled);
      if (!success) record.form.querySelector('[aria-invalid="true"]')?.focus();
      record.busy = false; record.submitted = null; refresh();
    }
  }
  return {
    register(form, {key, title, submit: perform}) {
      form.noValidate = true;
      const previous = drafts.get(key);
      const record = {key, title, form, submit: perform, baseline: previous?.baseline ?? formValues(form), busy: false};
      if (previous) restoreValues(form, previous.values);
      records.set(form, record);
      definitions.set(form, record);
      form.addEventListener('submit', event => {event.preventDefault(); void submit(record);});
      form.addEventListener('input', refresh); form.addEventListener('change', refresh);
      return form;
    },
    capture() {
      for (const r of active()) {
        if (dirty(r)) drafts.set(r.key, {baseline: r.baseline, values: formValues(r.form)});
        else drafts.delete(r.key);
      }
    },
    async leave(action) {
      if (leaving || active().some(r => r.busy)) return false;
      leaving = true;
      try {
        for (const record of active().filter(dirty)) {
          const choice = await prompt(record.title);
          if (choice === 'keep') return false;
          if (choice === 'save') {if (!await submit(record)) return false;}
          else {drafts.delete(record.key); record.baseline = formValues(record.form);}
        }
        action(); return true;
      } finally {leaving = false; refresh();}
    },
    saved, refresh,
    reset(form) {
      const record = definitions.get(form);
      if (record) {records.set(form, record); record.baseline = formValues(form); drafts.delete(record.key);}
    },
    submit: () => {const record = active()[0]; return record ? submit(record) : Promise.resolve(false);},
    get active() {return active()[0] ?? null;},
    clear() {records.clear(); drafts.clear(); refresh();}
  };
}

// Header, bottom Save and the leave-confirmation Save all reach this one handler.
export function editingForm(edits, key, title, {onSubmit, ...attrs}, ...children) {
  const form = el('form', attrs, ...children);
  return edits.register(form, {key, title, submit: () => onSubmit({preventDefault() {}, currentTarget: form})});
}
