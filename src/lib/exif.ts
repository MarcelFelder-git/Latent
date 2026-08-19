/**
 * EXIF-Erhalt beim Export.
 *
 * canvas.toBlob() erzeugt ein frisches JPEG ohne jede Metainformation -
 * Kamera, Objektiv, Aufnahmedatum und vor allem der Urheberrechtsvermerk sind
 * weg. Fuer jemanden, der beruflich fotografiert, ist das disqualifizierend.
 *
 * Loesung ohne Bibliothek: das APP1-Segment (dort steckt EXIF) aus der
 * Originaldatei herausschneiden und in das erzeugte JPEG einsetzen. Die
 * Bilddaten selbst werden nicht angefasst.
 */

/** Zwei Bytes an einer Stelle als Big-Endian-Zahl lesen. */
function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, false);
}

/**
 * Liest das APP1-Segment (EXIF) aus einer JPEG-Datei.
 * Gibt null zurueck, wenn die Datei kein JPEG ist oder kein EXIF enthaelt -
 * beides ist normal und kein Fehler.
 */
export async function readExifSegment(file: File): Promise<Uint8Array | null> {
  if (!/jpe?g/i.test(file.type)) return null;

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // SOI - jedes JPEG faengt damit an.
  if (bytes.length < 4 || u16(view, 0) !== 0xffd8) return null;

  let offset = 2;
  while (offset + 4 <= bytes.length) {
    const marker = u16(view, offset);
    // Ab SOS kommen die Bilddaten, davor sind alle Segmente durch.
    if (marker === 0xffda) return null;
    // Marker ohne Laengenfeld (RSTn, TEM) - kann in diesem Bereich nicht
    // auftreten, aber lieber abbrechen als falsch weiterlaufen.
    if ((marker & 0xff00) !== 0xff00) return null;

    const length = u16(view, offset + 2);
    if (length < 2) return null;

    if (marker === 0xffe1) {
      return bytes.slice(offset, offset + 2 + length);
    }
    offset += 2 + length;
  }
  return null;
}

/**
 * Setzt ein APP1-Segment in ein frisch erzeugtes JPEG ein.
 *
 * Die Norm will APP1 hinter APP0 (JFIF) sehen - genau dort landet es hier,
 * falls ein APP0 vorhanden ist, sonst direkt hinter dem Dateikopf.
 */
export async function spliceExif(jpeg: Blob, app1: Uint8Array): Promise<Blob> {
  const buffer = await jpeg.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  if (bytes.length < 4 || u16(view, 0) !== 0xffd8) return jpeg;

  // Ein Segment belegt: 2 Byte Marker + `length` Byte, wobei length das
  // eigene Laengenfeld mitzaehlt. Das APP0 bei Offset 2 endet also bei
  // 2 + 2 + length. Hier war vorher ein Zweierversatz drin - eingefuegt wurde
  // mitten in den JFIF-Block, wodurch die Datei ab dort unlesbar wurde.
  let insertAt = 2;
  if (bytes.length >= 6 && u16(view, 2) === 0xffe0) {
    insertAt = 4 + u16(view, 4);
  }

  const out = new Uint8Array(bytes.length + app1.length);
  out.set(bytes.subarray(0, insertAt), 0);
  out.set(app1, insertAt);
  out.set(bytes.subarray(insertAt), insertAt + app1.length);
  return new Blob([out], { type: "image/jpeg" });
}
