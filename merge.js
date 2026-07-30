/* merge.js — merge resolution logic for Dice Merge
   Rule: when a die is placed, check its neighbors (orthogonal + diagonal).
   If 3+ connected same-value dice form a group (including the placed one),
   they all merge into ONE die of value+1 at the placed position.
   This can cascade: the resulting die may itself trigger a further merge
   with ITS neighbors, producing combo chains.
*/

/**
 * Finds the connected group of same-value cells starting at (row,col).
 */
function findConnectedGroup(board, row, col) {
  const start = board.get(row, col);
  if (!start) return [];
  const value = start.value;
  const visited = new Set();
  const stack = [{ row, col }];
  const group = [];

  while (stack.length) {
    const cur = stack.pop();
    const key = `${cur.row},${cur.col}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const cell = board.get(cur.row, cur.col);
    if (!cell || cell.value !== value) continue;
    group.push(cur);
    for (const n of board.neighbors(cur.row, cur.col)) {
      const nk = `${n.row},${n.col}`;
      if (!visited.has(nk)) stack.push(n);
    }
  }
  return group;
}

/**
 * Resolves all merge chains starting from an origin cell after a placement.
 * Returns a list of "steps" describing each merge event for animation purposes:
 * { group: [{row,col}], resultCell: {row,col}, fromValue, toValue }
 * Mutates the board in place to reflect the final resolved state.
 */
function resolveMerges(board, originRow, originCol) {
  const steps = [];
  let comboCount = 0;
  let cur = { row: originRow, col: originCol };

  while (true) {
    const cell = board.get(cur.row, cur.col);
    if (!cell) break;
    const MIN_MERGE_GROUP = 3;
    const group = findConnectedGroup(board, cur.row, cur.col);
    if (group.length < MIN_MERGE_GROUP) break;

    const fromValue = cell.value;
    const toValue = Math.min(fromValue + 1, DICE_MAX_VALUE_MERGE);

    // clear all cells in group
    for (const g of group) board.clear(g.row, g.col);

    // place merged die at the origin of this step (use the last-placed cell if within group, else first)
    const target = group.find(g => g.row === cur.row && g.col === cur.col) || group[0];
    board.set(target.row, target.col, { value: toValue, mergedAt: Date.now() });

    steps.push({
      group,
      resultCell: { row: target.row, col: target.col },
      fromValue,
      toValue,
      comboIndex: comboCount,
    });

    comboCount++;
    cur = target;

    // stop cascading once at max value
    if (toValue >= DICE_MAX_VALUE_MERGE) break;
    // stop if this new value can't merge further right now (checked at loop top)
  }

  return steps;
}

const DICE_MAX_VALUE_MERGE = 10;

/**
 * Checks whether placing `value` at (row,col) would create an immediate
 * merge (i.e. would form a connected group of 3+ same-value dice).
 */
function wouldMerge(board, row, col, value) {
  const clone = board.clone();
  clone.set(row, col, { value });
  return findConnectedGroup(clone, row, col).length >= 3;
}

if (typeof module !== 'undefined') {
  module.exports = { findConnectedGroup, resolveMerges, wouldMerge };
}
