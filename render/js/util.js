// Small deterministic helpers shared by every module.  Nothing here may use
// Math.random() or wall-clock time: every frame must be a pure function of t.
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, k) => a + (b - a) * k;
export const smooth = (k) => { k = clamp(k); return k * k * (3 - 2 * k); };
export const smoother = (k) => { k = clamp(k); return k * k * k * (k * (k * 6 - 15) + 10); };
export const easeOutBack = (k) => { k = clamp(k); const c = 1.70158; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
export const easeOut = (k) => 1 - Math.pow(1 - clamp(k), 3);
export const easeIn = (k) => Math.pow(clamp(k), 3);
export const ramp = (t, a, b) => clamp((t - a) / (b - a));
export const pulse = (t, a, b, f = 0.25) => smooth(ramp(t, a, a + f)) * (1 - smooth(ramp(t, b - f, b)));
export const TAU = Math.PI * 2;

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// keyframes: [[t, v], ...] with smooth (ease-in-out) interpolation
export function keys(t, kf, ease = smooth) {
  if (t <= kf[0][0]) return kf[0][1];
  for (let i = 1; i < kf.length; i++) {
    if (t <= kf[i][0]) {
      const [t0, v0] = kf[i - 1], [t1, v1] = kf[i];
      return lerp(v0, v1, ease((t - t0) / (t1 - t0 || 1)));
    }
  }
  return kf[kf.length - 1][1];
}

// position on a smooth start/stop move from x0 to x1 between t0 and t1
export const glide = (t, t0, t1, x0, x1) => lerp(x0, x1, smoother((t - t0) / (t1 - t0)));

// hop height for a parabolic jump of length d starting at t0
export const hop = (t, t0, d = 0.5, h = 1) => (t < t0 || t > t0 + d) ? 0 : h * 4 * ((t - t0) / d) * (1 - (t - t0) / d);

export function hexColor(h) { return parseInt(h.replace('#', ''), 16); }
