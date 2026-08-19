import { NEUTRAL, type Adjustments } from "./film/adjustments";

/**
 * Einen Look als Link weitergeben.
 *
 * Der ganze Zustand einer Einstellung sind rund zehn Zahlen und zwei Namen -
 * klein genug, um komplett in die Adresszeile zu passen. Damit laesst sich
 * eine Einstellung weitergeben, ohne dass irgendwo ein Server Zustand halten
 * muesste, und ein Link bleibt gueltig, solange die App existiert.
 */

export interface Look {
  stock: string;
  scanner: string;
  adjustments: Adjustments;
}

/** Drei Nachkommastellen reichen - alles darunter ist nicht sichtbar. */
const round = (v: number) => Math.round(v * 1000) / 1000;

function toBase64Url(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  return atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
}

export function encodeLook(look: Look): string {
  const kompakt = {
    s: look.stock,
    l: look.scanner,
    a: Object.fromEntries(
      Object.entries(look.adjustments).map(([k, v]) => [k, round(v)]),
    ),
  };
  return toBase64Url(JSON.stringify(kompakt));
}

/**
 * Gibt null zurueck, wenn im Fragment nichts Brauchbares steht. Das ist der
 * Normalfall - jemand hat einfach die nackte Adresse aufgerufen.
 */
export function decodeLook(fragment: string): Look | null {
  const roh = fragment.replace(/^#/, "");
  if (!roh) return null;
  try {
    const parsed = JSON.parse(fromBase64Url(roh));
    if (typeof parsed?.s !== "string" || typeof parsed?.l !== "string") return null;
    // Unbekannte oder fehlende Regler mit den Vorgaben auffuellen - ein alter
    // Link soll nicht kaputtgehen, nur weil spaeter eine Achse dazugekommen ist.
    const adjustments: Adjustments = { ...NEUTRAL };
    for (const key of Object.keys(NEUTRAL) as (keyof Adjustments)[]) {
      const wert = parsed?.a?.[key];
      if (typeof wert === "number" && Number.isFinite(wert)) adjustments[key] = wert;
    }
    return { stock: parsed.s, scanner: parsed.l, adjustments };
  } catch {
    return null;
  }
}

export function lookUrl(look: Look): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#${encodeLook(look)}`;
}
