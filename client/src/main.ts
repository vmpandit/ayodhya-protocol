// ── Ayodhya Protocol: Lanka Reforged ── Client Entry ──

import { Game } from './Game';

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
const game = new Game(canvas);

// Show the correct control instructions (touch vs desktop)
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const instrDesktop = document.getElementById('instrDesktop')!;
const instrTouch = document.getElementById('instrTouch')!;
if (isTouch) {
  instrDesktop.style.display = 'none';
} else {
  instrTouch.style.display = 'none';
}

// Initialize the renderer (shows loading screen)
game.init().then(() => {
  // Hide loading, show instructions
  document.getElementById('loadingScreen')!.classList.add('hidden');
  document.getElementById('instructionsScreen')!.classList.add('visible');

  // Start button
  document.getElementById('startBtn')!.addEventListener('click', () => {
    document.getElementById('instructionsScreen')!.classList.remove('visible');
    canvas.focus();
    game.start();
  });

  // Also allow touch-tap on start button
  document.getElementById('startBtn')!.addEventListener('touchend', (e) => {
    e.preventDefault();
    document.getElementById('instructionsScreen')!.classList.remove('visible');
    canvas.focus();
    game.start();
  }, { passive: false });

}).catch((err) => {
  console.error('Failed to initialize game:', err);
  document.getElementById('loadingScreen')!.innerHTML =
    `<div style="color:#ff4444;font-size:18px;padding:20px;text-align:center;">Failed to start: ${err.message}</div>`;
});
