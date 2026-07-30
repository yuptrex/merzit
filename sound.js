/* sound.js — procedural sound design for Dice Merge.
   Everything here is synthesized in real time with the Web Audio API:
   oscillators, filtered noise bursts, envelopes and a small algorithmic
   reverb. There are no external audio files, so there's nothing to load,
   nothing to license, and every sound can react to game state (combo
   depth, die value, etc.) instead of playing one flat "click".

   Public API (window.Sound):
     Sound.unlock()            - call on first user gesture (ui.js does this)
     Sound.setEnabled(bool)    - mute/unmute
     Sound.place()              - die placed on board
     Sound.merge(comboIndex, toValue) - a merge resolves
     Sound.superMerge()         - reaching the max die value
     Sound.newBest()            - beating the high score
     Sound.bomb()                - bomb power-up
     Sound.cannon()              - cannon power-up
     Sound.undo()                 - undo power-up
     Sound.click()                - generic UI button
     Sound.powerSelect(on)       - toggling a power-up's aim mode
     Sound.gameOver()             - run ends
     Sound.invalid()              - rejected action (nothing to undo, etc.)
*/

(function () {
  'use strict';

  let ctx = null;
  let masterGain = null;
  let dryBus = null;
  let wetBus = null;
  let noiseBuffer = null;
  let enabled = true;

  function ensureContext() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();

    masterGain = ctx.createGain();
    masterGain.gain.value = 0.85;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-20, ctx.currentTime);
    compressor.knee.setValueAtTime(18, ctx.currentTime);
    compressor.ratio.setValueAtTime(4, ctx.currentTime);
    compressor.attack.setValueAtTime(0.003, ctx.currentTime);
    compressor.release.setValueAtTime(0.22, ctx.currentTime);

    masterGain.connect(compressor);
    compressor.connect(ctx.destination);
    dryBus = masterGain;

    // Small algorithmic reverb (decaying filtered noise impulse) gives
    // chimes/fanfares a little air without needing an IR sample file.
    const convolver = ctx.createConvolver();
    convolver.buffer = buildImpulse(1.6, 2.4);
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 0.25;
    convolver.connect(reverbReturn);
    reverbReturn.connect(masterGain);
    wetBus = convolver;

    return ctx;
  }

  function buildImpulse(duration, decay) {
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * duration);
    const impulse = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return impulse;
  }

  function getNoiseBuffer() {
    if (noiseBuffer) return noiseBuffer;
    const length = ctx.sampleRate * 2;
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return noiseBuffer;
  }

  // Route a node dry + (optionally) into the reverb send.
  function out(node, wetAmount) {
    node.connect(dryBus);
    if (wetAmount) {
      const send = ctx.createGain();
      send.gain.value = wetAmount;
      node.connect(send);
      send.connect(wetBus);
    }
  }

  function envelope(startTime, attack, hold, release, peak) {
    const g = ctx.createGain();
    const t = startTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    return g;
  }

  /**
   * A short pitched tone with its own envelope + optional pitch slide.
   * type: oscillator waveform. freq/endFreq: Hz. gain: peak volume 0-1.
   */
  function tone({ freq, endFreq, type = 'sine', start = 0, attack = 0.005,
                  hold = 0.02, release = 0.15, gain = 0.3, wet = 0.15, detune = 0 }) {
    const t = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.detune.value = detune;
    if (endFreq && endFreq !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t + attack + hold + release);
    }
    const env = envelope(t, attack, hold, release, gain);
    osc.connect(env);
    out(env, wet);
    osc.start(t);
    osc.stop(t + attack + hold + release + 0.05);
  }

  /**
   * Filtered noise burst — used for taps, whooshes, explosions.
   */
  function noiseBurst({ start = 0, duration = 0.15, attack = 0.002, release,
                         filterType = 'bandpass', freq = 1200, freqEnd, Q = 1,
                         gain = 0.3, wet = 0.1 }) {
    const t = ctx.currentTime + start;
    const rel = release !== undefined ? release : duration;
    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuffer();
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(freq, t);
    filter.Q.value = Q;
    if (freqEnd) filter.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + duration);
    const env = envelope(t, attack, Math.max(0, duration - attack - rel), rel, gain);
    src.connect(filter);
    filter.connect(env);
    out(env, wet);
    src.start(t);
    src.stop(t + duration + rel + 0.05);
  }

  // A tiny two-oscillator "bell" — a fundamental + a slightly detuned,
  // quieter partial an octave+fifth up. Reads as a chime rather than a beep.
  function bell({ start = 0, freq = 660, gain = 0.28, release = 0.35, wet = 0.28 }) {
    tone({ freq, type: 'sine', start, attack: 0.004, hold: 0.01, release, gain, wet });
    tone({ freq: freq * 2.4, type: 'sine', start, attack: 0.003, hold: 0.005, release: release * 0.6, gain: gain * 0.35, wet });
    tone({ freq: freq * 1.003, type: 'triangle', start, attack: 0.004, hold: 0.01, release, gain: gain * 0.4, wet });
  }

  function schedule(fn) {
    if (!enabled) return;
    const c = ensureContext();
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    fn();
  }

  // ---------------- Public sound events ----------------

  const Sound = {
    unlock() {
      const c = ensureContext();
      if (c && c.state === 'suspended') c.resume();
    },

    setEnabled(v) {
      enabled = v;
    },

    isEnabled() {
      return enabled;
    },

    // Die placed on the board — soft dice-on-felt tock.
    place() {
      schedule(() => {
        noiseBurst({ filterType: 'bandpass', freq: 900, freqEnd: 400, Q: 2.2, duration: 0.05, gain: 0.22, wet: 0.05 });
        tone({ freq: 220, endFreq: 150, type: 'sine', attack: 0.002, hold: 0.01, release: 0.08, gain: 0.18, wet: 0.05 });
      });
    },

    // A merge resolves. comboIndex 0 = first merge in the chain, higher =
    // deeper into a combo. toValue = the resulting die's pip value, used to
    // pitch the chime up as dice climb toward the max value.
    merge(comboIndex = 0, toValue = 2) {
      schedule(() => {
        const base = 392 * Math.pow(2, (toValue - 2) / 12); // pitches up gently per value
        const comboLift = Math.pow(2, Math.min(comboIndex, 6) / 12);
        const freq = base * comboLift;
        bell({ freq, gain: 0.3, release: 0.4 + Math.min(comboIndex, 4) * 0.04, wet: 0.3 });
        noiseBurst({ filterType: 'highpass', freq: 4000, duration: 0.09, gain: 0.12, wet: 0.2 });
        if (comboIndex > 0) {
          // a little arpeggio flourish stacks on top for chained combos
          tone({
            freq: freq * 1.5, type: 'triangle', start: 0.05,
            attack: 0.004, hold: 0.01, release: 0.22, gain: 0.16, wet: 0.3,
          });
        }
      });
    },

    // Reaching the highest die value on the board.
    superMerge() {
      schedule(() => {
        const root = 523.25; // C5
        const chord = [0, 4, 7, 12, 16]; // major chord + octave sparkle
        chord.forEach((semi, i) => {
          bell({
            freq: root * Math.pow(2, semi / 12),
            start: i * 0.045,
            gain: 0.24 - i * 0.02,
            release: 0.9,
            wet: 0.4,
          });
        });
        noiseBurst({ filterType: 'highpass', freq: 6000, duration: 0.5, release: 0.6, gain: 0.1, wet: 0.4 });
      });
    },

    newBest() {
      schedule(() => {
        [0, 4, 7, 12].forEach((semi, i) => {
          tone({
            freq: 440 * Math.pow(2, semi / 12), type: 'triangle',
            start: i * 0.09, attack: 0.005, hold: 0.03, release: 0.35,
            gain: 0.26, wet: 0.35,
          });
        });
      });
    },

    // Bomb power-up: low boom + debris crackle.
    bomb() {
      schedule(() => {
        tone({ freq: 140, endFreq: 40, type: 'sine', attack: 0.004, hold: 0.02, release: 0.35, gain: 0.5, wet: 0.15 });
        noiseBurst({ filterType: 'lowpass', freq: 2200, freqEnd: 200, Q: 0.7, duration: 0.28, gain: 0.4, wet: 0.2 });
        noiseBurst({ start: 0.03, filterType: 'bandpass', freq: 3000, Q: 3, duration: 0.15, gain: 0.12, wet: 0.25 });
      });
    },

    // Cannon power-up: rising whoosh into an impact thud.
    cannon() {
      schedule(() => {
        noiseBurst({ filterType: 'bandpass', freq: 300, freqEnd: 2600, Q: 0.9, duration: 0.22, gain: 0.28, wet: 0.15 });
        tone({ freq: 90, endFreq: 55, type: 'square', start: 0.18, attack: 0.003, hold: 0.02, release: 0.22, gain: 0.35, wet: 0.15 });
        noiseBurst({ start: 0.18, filterType: 'lowpass', freq: 1800, freqEnd: 300, duration: 0.18, gain: 0.3, wet: 0.2 });
      });
    },

    // Undo: a quick reverse-swoosh, distinct from cannon's forward blast.
    undo() {
      schedule(() => {
        noiseBurst({ filterType: 'bandpass', freq: 2200, freqEnd: 500, Q: 1.4, duration: 0.18, gain: 0.22, wet: 0.15 });
        tone({ freq: 500, endFreq: 260, type: 'sine', attack: 0.005, hold: 0.01, release: 0.16, gain: 0.16, wet: 0.1 });
      });
    },

    // Generic UI click for menu/overlay buttons.
    click() {
      schedule(() => {
        tone({ freq: 720, endFreq: 640, type: 'triangle', attack: 0.002, hold: 0.005, release: 0.06, gain: 0.14, wet: 0.05 });
      });
    },

    // Toggling a power-up into "aim" mode vs. cancelling it.
    powerSelect(on) {
      schedule(() => {
        const f = on ? 500 : 380;
        tone({ freq: f, endFreq: f * (on ? 1.4 : 0.75), type: 'triangle', attack: 0.003, hold: 0.01, release: 0.12, gain: 0.18, wet: 0.15 });
      });
    },

    gameOver() {
      schedule(() => {
        [0, -3, -7].forEach((semi, i) => {
          tone({
            freq: 330 * Math.pow(2, semi / 12), type: 'sine',
            start: i * 0.12, attack: 0.008, hold: 0.05, release: 0.5,
            gain: 0.22, wet: 0.3,
          });
        });
      });
    },

    // Rejected action — nothing to undo, invalid drop, etc.
    invalid() {
      schedule(() => {
        tone({ freq: 180, type: 'square', attack: 0.002, hold: 0.03, release: 0.09, gain: 0.14, wet: 0 });
      });
    },
  };

  window.Sound = Sound;
})();
