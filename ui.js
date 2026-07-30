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

    $('btn-start').addEventListener('click', () => {
      hide(overlayStart);
      window.DiceMergeGame.startGame(true);
    });

    $('btn-howto').addEventListener('click', () => show(overlayHowto));
    $('btn-close-howto').addEventListener('click', () => hide(overlayHowto));

    $('btn-pause').addEventListener('click', () => {
      const g = window.DiceMergeGame;
      if (!g.state.started || g.state.gameOver) return;
      g.state.paused = true;
      show(overlayPause);
    });

    $('btn-resume').addEventListener('click', () => {
      window.DiceMergeGame.state.paused = false;
      hide(overlayPause);
    });

    $('btn-restart-pause').addEventListener('click', () => {
      window.DiceMergeGame.state.paused = false;
      hide(overlayPause);
      window.DiceMergeGame.newGame();
    });

    $('btn-restart').addEventListener('click', () => {
      hide(overlayGameOver);
      window.DiceMergeGame.newGame();
    });

    $('btn-sound').addEventListener('click', () => {
      soundOn = !soundOn;
      $('btn-sound').classList.toggle('muted', !soundOn);
    });

    // power-up buttons
    ['bomb', 'undo', 'cannon'].forEach((key) => {
      $(`power-${key}`).addEventListener('click', () => {
        window.DiceMergeGame.activatePower(key);
      });
    });

    // prevent default touch scrolling/zooming on the whole app
    document.getElementById('app').addEventListener('touchmove', (e) => {
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('gesturestart', (e) => e.preventDefault());
  });
})();
