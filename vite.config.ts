import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    // Auch im lokalen Netz erreichbar, damit sich die App auf dem Telefon
    // testen laesst. Ohne das hoert Vite nur auf localhost, und localhost
    // zeigt auf dem Telefon auf das Telefon selbst.
    host: true,
  },
});
