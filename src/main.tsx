import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/*
 * Nur im gebauten Stand anmelden. Waehrend der Entwicklung wuerde ein
 * Worker zwischen Vite und die Seite geraten und beim Nachladen alte
 * Dateien ausliefern - man debuggt dann den Cache statt den Code.
 *
 * Nach dem Laden, damit die Anmeldung nicht mit dem ersten Bildaufbau um
 * Bandbreite konkurriert.
 */
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline ist ein Zugewinn, keine Voraussetzung. Faellt die Anmeldung
      // aus - privater Modus, abgeschaltet -, laeuft die App normal weiter.
    });
  });
}
