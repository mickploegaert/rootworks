/** Colour of the light at key points of the day (multiplied over the world). */
const KEYS: readonly { at: number; color: [number, number, number]; night: number; label: string }[] = [
  { at: 0.0, color: [255, 236, 214], night: 0, label: 'Morning' },
  { at: 0.12, color: [255, 255, 255], night: 0, label: 'Day' },
  { at: 0.5, color: [255, 250, 240], night: 0, label: 'Afternoon' },
  { at: 0.6, color: [255, 206, 166], night: 0.15, label: 'Dusk' },
  { at: 0.68, color: [140, 128, 190], night: 0.8, label: 'Night' },
  { at: 0.86, color: [126, 120, 186], night: 1, label: 'Night' },
  { at: 0.95, color: [236, 196, 196], night: 0.3, label: 'Dawn' },
  { at: 1.0, color: [255, 236, 214], night: 0, label: 'Morning' },
];

export interface Daylight {
  /** 0xRRGGBB multiply tint for the world. */
  tint: number;
  /** 0 in full daylight .. 1 at the darkest point of the night. */
  night: number;
  label: string;
}

/** A slow day/night cycle. Purely presentational: the simulation does not depend on it. */
export class DayNight {
  constructor(readonly period = 480, private readonly startAt = 0.05) {}

  at(t: number): Daylight {
    const p = ((t / this.period + this.startAt) % 1 + 1) % 1;
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].at <= p) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const k = (p - a.at) / (b.at - a.at);
    const s = k * k * (3 - 2 * k);
    const c = a.color.map((v, j) => Math.round(v + (b.color[j] - v) * s));
    return { tint: (c[0] << 16) | (c[1] << 8) | c[2], night: a.night + (b.night - a.night) * s, label: k < 0.5 ? a.label : b.label };
  }
}
