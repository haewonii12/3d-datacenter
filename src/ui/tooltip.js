import { rackLabel, unitRangeLabel } from '../domain/layout.js';
import { usedU } from '../domain/occupancy.js';

/** `R03-C12 · 2F · 31/42U (74%)` */
export function rackTooltipText(rack, floorId) {
  const used = usedU(rack);
  return `${rackLabel(rack)} · ${floorId} · ${used}/${rack.total_u}U (${Math.round((used / rack.total_u) * 100)}%)`;
}

/** `hostname · U10–11` */
export function serverTooltipText(server) {
  return `${server.hostname} · ${unitRangeLabel(server)}`;
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
        if (r) text = rackTooltipText(r.rack, r.floor.id);
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
