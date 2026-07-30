/* board.js — grid data model for Dice Merge */

class Board {
  constructor(size = 5) {
    this.size = size;
    this.cells = new Array(size * size).fill(null); // each cell: { value } or null
  }

  index(row, col) {
    return row * this.size + col;
  }

  inBounds(row, col) {
    return row >= 0 && row < this.size && col >= 0 && col < this.size;
  }

  get(row, col) {
    if (!this.inBounds(row, col)) return undefined;
    return this.cells[this.index(row, col)];
  }

  set(row, col, cellData) {
    if (!this.inBounds(row, col)) return;
    this.cells[this.index(row, col)] = cellData;
  }

  clear(row, col) {
    this.set(row, col, null);
  }

  isEmpty(row, col) {
    return this.get(row, col) === null;
  }

  isFull() {
    return this.cells.every(c => c !== null);
  }

  countEmpty() {
    return this.cells.filter(c => c === null).length;
  }

  getEmptyCells() {
    const out = [];
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        if (this.isEmpty(r, c)) out.push({ row: r, col: c });
      }
    }
    return out;
  }

  neighbors(row, col) {
    const deltas = [
      [-1, 0], [1, 0], [0, -1], [0, 1],   // orthogonal
      [-1, -1], [-1, 1], [1, -1], [1, 1], // diagonal
    ];
    const out = [];
    for (const [dr, dc] of deltas) {
      const nr = row + dr, nc = col + dc;
      if (this.inBounds(nr, nc)) out.push({ row: nr, col: nc });
    }
    return out;
  }

  clone() {
    const b = new Board(this.size);
    b.cells = this.cells.map(c => (c ? { ...c } : null));
    return b;
  }

  // Returns true if any connected group of 3+ same-value cells exists
  // (matches the merge rule in merge.js: merges require 3+ connected dice,
  // not just an adjacent pair).
  hasAnyMergeAvailable() {
    const visited = new Set();
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        const key = `${r},${c}`;
        if (visited.has(key)) continue;
        const cell = this.get(r, c);
        if (!cell) continue;
        // flood-fill this connected same-value group, marking all cells
        // visited so we don't redo the same group from another starting cell
        const value = cell.value;
        const stack = [{ row: r, col: c }];
        const group = [];
        while (stack.length) {
          const cur = stack.pop();
          const k = `${cur.row},${cur.col}`;
          if (visited.has(k)) continue;
          visited.add(k);
          const cc = this.get(cur.row, cur.col);
          if (!cc || cc.value !== value) continue;
          group.push(cur);
          for (const n of this.neighbors(cur.row, cur.col)) {
            const nk = `${n.row},${n.col}`;
            if (!visited.has(nk)) stack.push(n);
          }
        }
        if (group.length >= 3) return true;
      }
    }
    return false;
  }

  toJSON() {
    return { size: this.size, cells: this.cells.map(c => (c ? { ...c } : null)) };
  }

  static fromJSON(json) {
    const b = new Board(json.size);
    b.cells = json.cells.map(c => (c ? { ...c } : null));
    return b;
  }
}

if (typeof module !== 'undefined') module.exports = { Board };
