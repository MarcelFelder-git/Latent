/*
 * Service Worker fuer den Offlinebetrieb.
 *
 * Die App hat kein Backend - sie rechnet alles auf dem Geraet. Damit gibt es
 * keinen Grund, warum sie ohne Netz nicht laufen sollte, und einmal auf dem
 * Homebildschirm erwartet man das auch.
 *
 * Bewusst von Hand statt mit Workbox: die App besteht aus einer HTML-Seite
 * und einer Handvoll Dateien mit Inhaltshash im Namen. Dafuer braucht es
 * keinen Generator, und ein selbst geschriebener Worker von sechzig Zeilen
 * ist nachvollziehbar - bei Caches ist genau das der Punkt, an dem es sonst
 * unangenehm wird.
 *
 * Zwei Strategien, und die Aufteilung folgt daraus, ob ein Name eindeutig ist:
 *
 *   /assets/*  Der Name enthaelt den Inhaltshash. Gleicher Name heisst
 *              garantiert gleicher Inhalt, also zuerst aus dem Cache. Nach
 *              einem Deploy fragt die neue HTML-Seite ohnehin neue Namen an.
 *
 *   Navigation Immer zuerst das Netz. Die HTML-Seite hat einen festen Namen
 *              und ist die Datei, die auf die aktuellen Hashes zeigt - sie
 *              aus dem Cache zu bedienen ist der Weg, auf dem man tagelang
 *              eine alte Version ausliefert.
 */

const CACHE = "latent-v1";

// Ohne diese Datei gaebe es offline nichts anzuzeigen. Der Rest kommt beim
// ersten Besuch von selbst in den Cache.
const SCHALE = ["/", "/manifest.webmanifest", "/favicon.svg", "/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      // Einzeln, damit eine fehlende Datei nicht die ganze Installation
      // scheitern laesst.
      .then((c) => Promise.all(SCHALE.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((namen) =>
        Promise.all(namen.filter((n) => n !== CACHE).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  );
});

/** Was gar nicht erst durch den Cache soll. */
function ueberspringen(url) {
  // Das WASM des Modells ist 23 MB gross und wird nur gebraucht, wenn jemand
  // die Szenenerkennung einschaltet. Das gehoert nicht in den Offlinevorrat
  // einer Foto-App - der HTTP-Cache des Browsers reicht dafuer.
  return url.pathname.endsWith(".wasm");
}

self.addEventListener("fetch", (e) => {
  const anfrage = e.request;
  if (anfrage.method !== "GET") return;

  const url = new URL(anfrage.url);
  // Fremde Herkunft nicht anfassen: das Modell laedt vom Hugging-Face-Hub und
  // bringt seinen eigenen Cache mit.
  if (url.origin !== self.location.origin) return;
  if (ueberspringen(url)) return;

  if (anfrage.mode === "navigate") {
    e.respondWith(
      fetch(anfrage)
        .then((antwort) => {
          const kopie = antwort.clone();
          caches.open(CACHE).then((c) => c.put("/", kopie));
          return antwort;
        })
        .catch(() => caches.match("/").then((t) => t || Response.error())),
    );
    return;
  }

  e.respondWith(
    caches.match(anfrage).then((treffer) => {
      if (treffer) return treffer;
      return fetch(anfrage).then((antwort) => {
        // Nur vollstaendige eigene Antworten ablegen. Ein Teilinhalt (206)
        // im Cache ergibt spaeter eine kaputte Datei.
        if (antwort.ok && antwort.status === 200 && antwort.type === "basic") {
          const kopie = antwort.clone();
          caches.open(CACHE).then((c) => c.put(anfrage, kopie));
        }
        return antwort;
      });
    }),
  );
});
