/**
 * wakeLock.js — Keeps the phone screen on during play.
 *
 * Method 1: Screen Wake Lock API (Chrome 84+, Safari 16.4+), with auto
 *           re-request when the OS releases it and the page is still visible.
 * Method 2: NoSleep-style fallback — an invisible looping video fed from a
 *           canvas captureStream. A playing video prevents screen sleep on
 *           browsers without the Wake Lock API.
 */

export class WakeLock {
  constructor() {
    this.lock = null;
    this.isActive = false;
    this.retryTimeout = null;
    this.fallbackVideo = null;
    this.fallbackTimer = null;
    this.onChange = null;   // (isActive: boolean) => void
  }

  #notify() { this.onChange?.(this.isActive); }

  async request() {
    // Method 1: Screen Wake Lock API
    if ('wakeLock' in navigator) {
      try {
        this.lock = await navigator.wakeLock.request('screen');
        this.isActive = true;
        this.lock.addEventListener('release', () => {
          this.isActive = false;
          this.#notify();
          // Auto re-request if the page is still visible
          if (document.visibilityState === 'visible') {
            this.retryTimeout = setTimeout(() => this.request(), 2000);
          }
        });
        console.log('[wakeLock] Wake lock active');
        this.#notify();
        return true;
      } catch (err) {
        console.warn('[wakeLock] Wake Lock API failed, trying fallback', err);
      }
    }

    // Method 2: NoSleep fallback
    this.startNoSleepFallback();
    return false;
  }

  startNoSleepFallback() {
    if (this.fallbackVideo) { this.isActive = true; this.#notify(); return; }

    // Tiny canvas → captureStream → looping muted video keeps the screen on.
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const ctx = canvas.getContext('2d');

    const video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.muted = true;
    video.style.position = 'fixed';
    video.style.top = '-9999px';
    video.style.width = '1px';
    video.style.height = '1px';

    if (canvas.captureStream) {
      video.srcObject = canvas.captureStream(1);
    }
    video.play().catch(() => {});
    document.body.appendChild(video);

    // Redraw a pixel every second so the stream never stalls.
    let flip = false;
    this.fallbackTimer = setInterval(() => {
      flip = !flip;
      ctx.fillStyle = flip ? '#000' : '#010101';
      ctx.fillRect(0, 0, 2, 2);
    }, 1000);

    this.fallbackVideo = video;
    this.isActive = true;
    this.#notify();
    console.log('[wakeLock] NoSleep fallback active');
  }

  release() {
    if (this.lock) { this.lock.release().catch(() => {}); this.lock = null; }
    if (this.fallbackVideo) {
      this.fallbackVideo.pause();
      this.fallbackVideo.remove();
      this.fallbackVideo = null;
    }
    if (this.fallbackTimer) { clearInterval(this.fallbackTimer); this.fallbackTimer = null; }
    if (this.retryTimeout) clearTimeout(this.retryTimeout);
    this.isActive = false;
    this.#notify();
  }

  /** Re-request when the user switches tabs and comes back. */
  listenForVisibilityChange() {
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' && !this.isActive) {
        await this.request();
      }
    });
  }
}

export default WakeLock;
