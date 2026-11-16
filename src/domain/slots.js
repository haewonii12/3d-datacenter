/**
 * Every 1-based grid slot without a rack.
 * @param {{rows:number, cols:number, racks:{row:number,col:number}[]}} floor
 * @returns {{row:number, col:number}[]}
 */
export function emptySlots(floor) {
  const taken = new Set(floor.racks.map((r) => `${r.row},${r.col}`));
  const out = [];
  for (let row = 1; row <= floor.rows; row++) {
    for (let col = 1; col <= floor.cols; col++) {
      if (!taken.has(`${row},${col}`)) out.push({ row, col });
    }
  }
  return out;
}
