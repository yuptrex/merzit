/* dice.js — dice values, images, spawn logic */

const DICE_MAX_VALUE = 10;
const DICE_IMAGE_CACHE = {};

function loadDiceImages() {
  for (let v = 1; v <= DICE_MAX_VALUE; v++) {
    const img = new Image();
    img.src = `assets/dice/die_${v}.png`;
    DICE_IMAGE_CACHE[v] = img;
  }
}

function getDiceImage(value) {
  const clamped = Math.min(Math.max(value, 1), DICE_MAX_VALUE);
  return DICE_IMAGE_CACHE[clamped];
}

/**
 * Weighted random spawn value for new dice entering the tray.
 * Hard-mode weighting: values are much closer to equally likely across the
 * unlocked range (only a mild bias toward lower values), and the range
 * itself opens up faster and goes wider than before — so it's much harder
 * to stockpile three matching low dice for an easy merge.
 * `maxUnlocked` limits spawns to values the player has already reached,
 * capped at 6 as the highest spawnable base (was 4).
 */
function randomSpawnValue(maxUnlocked = 3) {
  const cap = Math.min(Math.max(maxUnlocked, 3), 6);
  const weights = [];
  for (let v = 1; v <= cap; v++) {
    // mild taper instead of the old steep 0.6^(v-1) drop-off — higher
    // values now show up often enough to break easy same-value clusters
    weights.push({ v, w: Math.pow(0.88, v - 1) });
  }
  const total = weights.reduce((s, x) => s + x.w, 0);
  let r = Math.random() * total;
  for (const { v, w } of weights) {
    if (r < w) return v;
    r -= w;
  }
  return 1;
}

class DiceQueue {
  constructor(size = 3) {
    this.size = size;
    this.queue = [];
    this.maxUnlocked = 4;
    this.fill();
  }

  fill() {
    while (this.queue.length < this.size) {
      this.queue.push(randomSpawnValue(this.maxUnlocked));
    }
  }

  peekNext() {
    return this.queue[0];
  }

  popNext() {
    const v = this.queue.shift();
    this.fill();
    return v;
  }

  updateUnlockedFromValue(mergedValue) {
    // as the player merges higher dice, raise the spawn ceiling faster than
    // before so the spawn pool keeps widening and matching stays hard
    const unlockThreshold = Math.max(1, mergedValue - 1);
    if (unlockThreshold > this.maxUnlocked) {
      this.maxUnlocked = Math.min(unlockThreshold, 6);
    }
  }

  toJSON() {
    return { size: this.size, queue: [...this.queue], maxUnlocked: this.maxUnlocked };
  }

  static fromJSON(json) {
    const q = new DiceQueue(json.size);
    q.queue = [...json.queue];
    q.maxUnlocked = json.maxUnlocked;
    return q;
  }
}

if (typeof module !== 'undefined') module.exports = { DiceQueue, randomSpawnValue, DICE_MAX_VALUE };
