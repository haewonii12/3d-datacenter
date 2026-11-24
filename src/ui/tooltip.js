import { rackLabel, rackCellsLabel, unitRangeLabel, deviceLabel } from '../domain/layout.js';
import { usedU } from '../domain/occupancy.js';

/** `RI20261120 · 3A0401–02 · 31/42U (74%)` (+ ` · ⚠ 위반` when flagged) */
export function rackTooltipText(rack) {
  const used = usedU(rack);
  const warn = rack.violation ? ' · ⚠ 위반' : '';
  return `${rackLabel(rack)} · ${rackCellsLabel(rack)} · ${used}/${rack.total_u}U (${Math.round((used / rack.total_u) * 100)}%)${warn}`;
}

/** `device_name · company · U29–31` */
export function serverTooltipText(server) {
  return [deviceLabel(server), server.company, unitRangeLabel(server)].filter(Boolean).join(' · ') + (server.violation ? ' · ⚠ 위반' : '');
}

/** #tooltip near the cursor; text via textContent only. */
export function createTooltip(root, store) {
  function hide() {
    root.hidden = true;
  }
  /** @param {{kind:string,id:string}|null} hit @param {{x:number,y:number}|null} at */
  function update(hit, at) {
    const mode = store.mode();
    let text = null;
    if (hit && at) {
      if (hit.kind === 'rack' && (mode === 'overview' || mode === 'floor')) {
        const r = store.getRack(hit.id);
        if (r) text = rackTooltipText(r.rack);
      } else if (hit.kind === 'server' && (mode === 'rack' || mode === 'server')) {
        const s = store.getServer(hit.id);
        if (s) text = serverTooltipText(s.server);
      }
    }
    if (text == null) return hide();
    root.textContent = text;
    root.style.left = `${at.x + 14}px`;
    root.style.top = `${at.y + 16}px`;
    root.hidden = false;
  }
  return { update, hide };
}
