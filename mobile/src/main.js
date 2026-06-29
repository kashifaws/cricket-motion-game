/**
 * main.js — Entry point for the mobile cricket bat controller.
 *
 * Boot sequence:
 *   1. Parse ?room= from URL.
 *   2. Mount the 4-screen UI.
 *   3. Connect to the relay server as role=mobile.
 *   4. On 'paired': advance to Screen 2 (Grip Guide).
 *   5. On "I'm ready": request motion permission + start listeners.
 *   6. On "Calibrate": capture baseline orientation.
 *   7. Relay swings to the server; update HUD from DOM events.
 */

import { io } from 'socket.io-client';
import { mountUI } from './ui.js';
import { captureBaseline, startListening, setDebugCallback, emitSwing } from './motion.js';
import './style.css';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || `http://${window.location.hostname}:3001`;

function getRoomId() {
  return new URLSearchParams(window.location.search).get('room');
}

async function boot() {
  const roomId = getRoomId();
  const ui = mountUI();

  if (!roomId) {
    ui.setStatus('No room ID — scan the QR code from the desktop.');
    return;
  }

  const socket = io(SERVER_URL, {
    query: { role: 'mobile', room: roomId },
    transports: ['polling', 'websocket'],
  });

  socket.on('connect', () => {
    ui.setConnected(true);
  });

  socket.on('connect_error', (err) => {
    ui.setStatus(`Connection failed: ${err.message}`);
  });

  socket.on('error', ({ message }) => {
    if (message.includes('not found')) {
      ui.setStatus('Room expired — refresh the desktop page and scan the new QR code.');
    } else {
      ui.setStatus(`Error: ${message}`);
    }
  });

  // Server confirmed both sides are present — show the grip guide.
  socket.on('paired', () => {
    ui.goToScreen(2);
  });

  // "I'm ready" tap → request iOS motion permission → jump straight to HUD.
  // Auto-calibration fires 600 ms after startListening (see motion.js).
  ui.onReady(async () => {
    try {
      setDebugCallback(({ mag, state, sent }) => ui.updateDebug({ mag, state, sent }));
      await startListening(socket, roomId);
      ui.goToScreen(4);   // skip manual calibration — auto-calibrate handles it
    } catch (err) {
      ui.goToScreen(1);
      ui.setStatus(`Motion permission denied: ${err.message}`);
    }
  });

  // Manual calibrate from HUD "Re-calibrate" button.
  ui.onCalibrate(() => {
    captureBaseline();
  });

  // Re-calibrate → ui.js navigates to Screen 3 for the countdown, then back to Screen 4.
  ui.onRecalibrate(() => captureBaseline());

  // motion.js dispatches this on every completed swing.
  window.addEventListener('swing-detected', (e) => {
    ui.updateHUD(e.detail);
  });

  // Tap fallback — works when DeviceMotion is blocked (HTTP non-localhost).
  ui.onTapSwing(() => emitSwing(Math.floor(Math.random() * 40) + 45));

  // Server-side game events (six, wicket) forwarded from desktop → server → mobile.
  socket.on('game-event', ({ type }) => {
    if (type === 'six')    navigator.vibrate?.([200]);
    if (type === 'wicket') navigator.vibrate?.([100, 50, 100]);
  });

  socket.on('peer-disconnected', () => {
    ui.setConnected(false);
    ui.setStatus('Desktop disconnected. Reload and scan again.');
  });

  socket.on('disconnect', () => {
    ui.setConnected(false);
  });
}

boot();
