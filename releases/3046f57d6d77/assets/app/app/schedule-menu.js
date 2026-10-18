import {el, button} from './dom.js';

export function menuPlacement(anchor, box, viewport) {
  const gap = 8, edge = 12;
  const width = Math.min(box.width, Math.max(1, viewport.width - edge * 2));
  const height = Math.min(box.height, Math.max(1, viewport.height - edge * 2));
  const left = Math.max(viewport.left + edge, Math.min(anchor.right - width, viewport.left + viewport.width - width - edge));
  const below = anchor.bottom + gap;
  const preferred = below + height <= viewport.top + viewport.height - edge ? below : anchor.top - height - gap;
  return {left, top: Math.max(viewport.top + edge, Math.min(preferred, viewport.top + viewport.height - height - edge))};
}

// A single non-modal action menu owns transient focus/position only. Commands
// are supplied by the existing view; this component never writes traveler data.
export function createScheduleMenu() {
  const popup = el('div', {id: 'schedule-item-menu', class: 'schedule-menu', role: 'menu',
    'aria-labelledby': 'schedule-menu-heading', hidden: true});
  let native = typeof popup.showPopover === 'function', active = null;
  if (native) popup.setAttribute('popover', 'manual');
  document.body.append(popup);
  function close(restore = true) {
    if (!active) return;
    const trigger = active.trigger; active = null;
    trigger.setAttribute('aria-expanded', 'false');
    if (native && popup.matches(':popover-open')) popup.hidePopover();
    popup.hidden = true; popup.replaceChildren();
    if (restore && trigger.isConnected) trigger.focus({preventScroll: true});
  }
  function position() {
    if (!active) return;
    if (!active.trigger.isConnected) {close(false); return;}
    const visual = window.visualViewport;
    const viewport = {left: visual?.offsetLeft ?? 0, top: visual?.offsetTop ?? 0,
      width: visual?.width ?? innerWidth, height: visual?.height ?? innerHeight};
    popup.style.maxWidth = Math.max(1, viewport.width - 24) + 'px';
    popup.style.maxHeight = Math.max(1, viewport.height - 24) + 'px';
    const point = menuPlacement(active.trigger.getBoundingClientRect(), popup.getBoundingClientRect(), viewport);
    popup.style.left = point.left + 'px'; popup.style.top = point.top + 'px';
  }
  function open(trigger, heading, commands, last = false) {
    close(false); active = {trigger};
    popup.replaceChildren(el('p', {id: 'schedule-menu-heading', class: 'schedule-menu-heading'}, heading),
      ...commands.map(command => button(command.label, () => {
        // Existing editors capture their invoking control for Save/Close return.
        close(true); command.action();
      }, {role: 'menuitem', tabindex: '-1'})));
    popup.hidden = false; trigger.setAttribute('aria-expanded', 'true');
    if (native) try {popup.showPopover();} catch {native = false; popup.removeAttribute('popover');}
    position();
    const items = popup.querySelectorAll('[role="menuitem"]');
    items[last ? items.length - 1 : 0]?.focus({preventScroll: true});
  }
  popup.addEventListener('keydown', event => {
    const items = [...popup.querySelectorAll('[role="menuitem"]')], index = items.indexOf(document.activeElement);
    let next;
    if (event.key === 'ArrowDown') next = items[(index + 1) % items.length];
    if (event.key === 'ArrowUp') next = items[(index - 1 + items.length) % items.length];
    if (event.key === 'Home') next = items[0];
    if (event.key === 'End') next = items.at(-1);
    if (next) {event.preventDefault(); next.focus(); return;}
    if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); close(true);}
    if (event.key === 'Tab' && active) {
      const trigger = active.trigger;
      const controls = [...document.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]')]
        .filter(n => !popup.contains(n) && !n.disabled && n.tabIndex >= 0 && n.getClientRects().length &&
          (!n.closest('details:not([open])') || n.closest('details').querySelector(':scope > summary') === n));
      const target = controls[controls.indexOf(trigger) + (event.shiftKey ? -1 : 1)] ?? trigger;
      event.preventDefault(); close(false); target.focus({preventScroll: true});
    }
  });
  document.addEventListener('pointerdown', event => {
    if (active && !popup.contains(event.target) && event.target !== active.trigger && !active.trigger.contains(event.target)) close(true);
  }, true);
  document.addEventListener('focusin', event => {
    if (active && !popup.contains(event.target) && event.target !== active.trigger) close(false);
  });
  document.addEventListener('scroll', event => {
    if (!active || popup.contains(event.target)) return;
    const rect = active.trigger.getBoundingClientRect(), top = window.visualViewport?.offsetTop ?? 0;
    const bottom = top + (window.visualViewport?.height ?? innerHeight);
    if (rect.bottom <= top || rect.top >= bottom) close(false); else position();
  }, true);
  window.addEventListener('resize', position);
  window.visualViewport?.addEventListener('resize', position);
  window.visualViewport?.addEventListener('scroll', position);
  return {close, control({key, name, heading, commands, disabled}) {
    const trigger = button(el('span', {'aria-hidden': true}, '···'), () => {
      if (active?.trigger === trigger) close(true); else open(trigger, heading, commands);
    }, {class: 'schedule-menu-trigger', 'aria-label': `Personalize ${name}`, 'aria-haspopup': 'menu',
      'aria-expanded': 'false', 'aria-controls': popup.id, 'data-schedule-focus': key, disabled});
    trigger.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) {event.preventDefault(); open(trigger, heading, commands, event.key === 'ArrowUp');}
    });
    return trigger;
  }};
}
