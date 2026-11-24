import { formatFloorspace } from './floorspace.js';

/**
 * Every free cell of a floor's zones (zone-gap columns are not slots); a rack covers `span` columns.
 * @param {{level:number, zones?:{id:string,colOffset:number,rows:number,cols:number}[], racks:{row:number,col:number,span?:number}[]}} floor
 * @returns {{row:number, col:number, floorspace:string}[]}
 */
export function emptySlots(floor) {
  const taken = new Set();
  for (const r of floor.racks) for (let k = 0; k < (r.span || 1); k++) taken.add(`${r.row},${r.col + k}`);
  const out = [];
  for (const z of floor.zones || [])
    for (let row = 1; row <= z.rows; row++)
      for (let seq = 1; seq <= z.cols; seq++) {
        const col = z.colOffset + seq;
        if (!taken.has(`${row},${col}`)) out.push({ row, col, floorspace: formatFloorspace({ floor: floor.level, zone: z.id, row, seq }) });
      }
  return out;
}

/** Number of cells over all zones of a floor. */
export const slotCount = (floor) => (floor.zones || []).reduce((a, z) => a + z.rows * z.cols, 0);
