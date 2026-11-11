/**
 * Where the sun is, worked out on this machine: the moments it crosses a
 * given height above or below the horizon on a day, at a place. The usual
 * low-precision solar formulas (mean anomaly, equation of centre, the
 * sunrise equation), good to a minute or two away from the poles, which is
 * finer than golden hour needs.
 *
 * Heights, in degrees: sunrise and sunset are -0.833 (the disc's top edge,
 * with refraction); golden hour is the sun between -4 and 6; blue hour
 * between -6 and -4.
 */

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2440588;
const J2000 = 2451545;
/** The Earth's tilt. */
const OBLIQUITY = RAD * 23.4397;
const J0 = 0.0009;

const toJulian = (date: Date) => date.getTime() / DAY_MS - 0.5 + J1970;
const fromJulian = (j: number) => new Date((j + 0.5 - J1970) * DAY_MS);
const toDays = (date: Date) => toJulian(date) - J2000;

const meanAnomaly = (d: number) => RAD * (357.5291 + 0.98560028 * d);

function eclipticLongitude(m: number): number {
  const centre =
    RAD *
    (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m));
  const perihelion = RAD * 102.9372;
  return m + centre + perihelion + Math.PI;
}

const declination = (l: number) => Math.asin(Math.sin(OBLIQUITY) * Math.sin(l));
const julianCycle = (d: number, lw: number) =>
  Math.round(d - J0 - lw / (2 * Math.PI));
const approxTransit = (ht: number, lw: number, n: number) =>
  J0 + (ht + lw) / (2 * Math.PI) + n;
const solarTransitJ = (ds: number, m: number, l: number) =>
  J2000 + ds + 0.0053 * Math.sin(m) - 0.0069 * Math.sin(2 * l);

function hourAngle(h: number, phi: number, dec: number): number {
  return Math.acos(
    (Math.sin(h) - Math.sin(phi) * Math.sin(dec)) /
      (Math.cos(phi) * Math.cos(dec))
  );
}

export interface SunCrossing {
  /** When the rising sun passes the height; null if it never does that day. */
  rising: Date | null;
  /** When the setting sun passes it. */
  setting: Date | null;
}

/**
 * The day's solar noon at a place and the moments the sun crosses each of
 * `heights`. `day` is any moment on the place's day; the nearest solar noon
 * is the one used.
 */
export function sunCrossings(
  day: Date,
  lat: number,
  lng: number,
  heights: readonly number[]
): { noon: Date; crossings: Map<number, SunCrossing> } {
  const lw = RAD * -lng;
  const phi = RAD * lat;
  const d = toDays(day);
  const n = julianCycle(d, lw);
  const ds = approxTransit(0, lw, n);
  const m = meanAnomaly(ds);
  const l = eclipticLongitude(m);
  const dec = declination(l);
  const noon = solarTransitJ(ds, m, l);

  const crossings = new Map<number, SunCrossing>();
  for (const height of heights) {
    const w = hourAngle(height * RAD, phi, dec);
    if (Number.isNaN(w)) {
      // The sun stays above (or below) this height all day: polar summer or night.
      crossings.set(height, { rising: null, setting: null });
      continue;
    }
    const set = solarTransitJ(approxTransit(w, lw, n), m, l);
    const rise = noon - (set - noon);
    crossings.set(height, {
      rising: fromJulian(rise),
      setting: fromJulian(set),
    });
  }
  return { noon: fromJulian(noon), crossings };
}

export const SUNRISE = -0.833;
export const GOLDEN_TOP = 6;
export const BLUE_TOP = -4;
export const BLUE_BOTTOM = -6;

export interface LightWindow {
  kind: "golden" | "blue";
  part: "morning" | "evening";
  start: Date;
  end: Date;
}

/** The day's golden and blue hours at a place, those the sun makes at all. */
export function lightWindows(
  day: Date,
  lat: number,
  lng: number
): LightWindow[] {
  const { crossings } = sunCrossings(day, lat, lng, [
    GOLDEN_TOP,
    BLUE_TOP,
    BLUE_BOTTOM,
  ]);
  const golden = crossings.get(GOLDEN_TOP)!;
  const blue = crossings.get(BLUE_TOP)!;
  const dark = crossings.get(BLUE_BOTTOM)!;
  const out: LightWindow[] = [];
  const add = (
    kind: LightWindow["kind"],
    part: LightWindow["part"],
    a: Date | null,
    b: Date | null
  ) => {
    if (a && b && b > a) out.push({ kind, part, start: a, end: b });
  };
  add("blue", "morning", dark.rising, blue.rising);
  add("golden", "morning", blue.rising, golden.rising);
  add("golden", "evening", golden.setting, blue.setting);
  add("blue", "evening", blue.setting, dark.setting);
  return out;
}

/** A place typed as "lat, lng" ("40.7128, -74.0060"), or null when it isn't one. */
export function parsePlace(text: string): { lat: number; lng: number } | null {
  const match = text
    .trim()
    .match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
