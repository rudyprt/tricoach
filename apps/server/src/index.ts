import "dotenv/config";
import { createApp } from "./app.js";
import { env } from "./lib/env.js";

// Une configuration incomplète doit arrêter le démarrage ici, avec un message
// lisible, plutôt que produire des erreurs 500 à la première requête.
let config: ReturnType<typeof env>;
try {
  config = env();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

createApp().listen(config.PORT, () => {
  console.log(`Serveur API démarré sur http://localhost:${config.PORT}`);
});
