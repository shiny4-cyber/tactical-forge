// Keyboard, mouse and pointer lock. One place turns browser events into the state the loop
// reads; the game asks for lock only from a real click, never from a timer.
export function createInput(canvas, callbacks = {}) {
  const keys = new Set();
  const state = { keys, locked: false, firing: false, lookX: 0, lookY: 0, plantHeld: false, throwQueued: false };
  const pressHandlers = new Map();
  const releaseHandlers = new Map();

  function onKeyDown(event) {
    if (event.repeat) {
      if (event.code === 'Space') event.preventDefault();
      return;
    }
    keys.add(event.code);
    if (event.code === 'Space' || event.code === 'Tab') event.preventDefault();
    const handler = pressHandlers.get(event.code);
    if (handler) handler();
  }

  function onKeyUp(event) {
    keys.delete(event.code);
    const handler = releaseHandlers.get(event.code);
    if (handler) handler();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => {
    keys.clear();
    state.firing = false;
  });
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (!state.locked) return;
    if (event.button === 0) state.firing = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
  });
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      state.firing = false;
      state.plantHeld = false;
    }
    callbacks.onLockChange?.(state.locked);
  });

  return {
    state,
    requestLock() {
      const result = canvas.requestPointerLock?.();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    },
    exitLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    takeLook() {
      const look = { x: state.lookX, y: state.lookY };
      state.lookX = 0;
      state.lookY = 0;
      return look;
    },
    onPress(code, handler) {
      pressHandlers.set(code, handler);
    },
    onRelease(code, handler) {
      releaseHandlers.set(code, handler);
    },
    // Used by the test hooks: press a key without a browser keyboard event.
    press(code) {
      keys.add(code);
      pressHandlers.get(code)?.();
    },
    release(code) {
      keys.delete(code);
      releaseHandlers.get(code)?.();
    },
  };
}
