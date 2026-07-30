/* ui.js — overlay screens, buttons, menu wiring */

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  let soundOn = true;

  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  window.addEventListener('DOMContentLoaded', () => {
    const overlayStart = $('overlay-start');
    const overlayHowto = $('overlay-howto');
    const overlayPause = $('overlay-pause');
    const overlayGameOver = $('overlay-gameover');

    // Browsers require a user gesture before audio can play — unlock the
    // Web Audio context on the very first touch/click anywhere in the app.
    const unlockAudio = () => {
      window.Sound && window.Sound.unlock();
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('touchstart', unlockAudio, { once: true });

    $('btn-start').addEventListener('click', () => {
      window.Sound && window.Sound.click();
      hide(overlayStart);
      window.DiceMergeGame.startGame(true);
    });

    $('btn-howto').addEventListener('click', () => { window.Sound && window.Sound.click(); show(overlayHowto); });
    $('btn-close-howto').addEventListener('click', () => { window.Sound && window.Sound.click(); hide(overlayHowto); });

    $('btn-pause').addEventListener('click', () => {
      const g = window.DiceMergeGame;
      if (!g.state.started || g.state.gameOver) return;
      window.Sound && window.Sound.click();
      g.state.paused = true;
      show(overlayPause);
    });

    $('btn-resume').addEventListener('click', () => {
      window.Sound && window.Sound.click();
      window.DiceMergeGame.state.paused = false;
      hide(overlayPause);
    });

    $('btn-restart-pause').addEventListener('click', () => {
      window.Sound && window.Sound.click();
      window.DiceMergeGame.state.paused = false;
      hide(overlayPause);
      window.DiceMergeGame.newGame();
    });

    $('btn-restart').addEventListener('click', () => {
      window.Sound && window.Sound.click();
      hide(overlayGameOver);
      window.DiceMergeGame.newGame();
    });

    $('btn-sound').addEventListener('click', () => {
      soundOn = !soundOn;
      window.Sound && window.Sound.setEnabled(soundOn);
      if (soundOn) window.Sound && window.Sound.click();
      $('btn-sound').classList.toggle('muted', !soundOn);
    });

    // power-up buttons
    ['bomb', 'undo', 'cannon'].forEach((key) => {
      $(`power-${key}`).addEventListener('click', () => {
        const g = window.DiceMergeGame;
        if (g.state.powerups[key] <= 0) {
          window.Sound && window.Sound.invalid();
          return;
        }
        g.activatePower(key);
        if (key !== 'undo' && window.Sound) {
          window.Sound.powerSelect(g.state.activePower === key);
        }
      });
    });

    // prevent default touch scrolling/zooming on the whole app
    document.getElementById('app').addEventListener('touchmove', (e) => {
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('gesturestart', (e) => e.preventDefault());
  });
})();
