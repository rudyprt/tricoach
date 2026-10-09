import "dotenv/config";
import { createApp } from "./app.js";
import { env } from "./env.js";

const { PORT } = env();
createApp().listen(PORT, () => {
  console.log(`Outil de gestion TriCoach : http://localhost:${PORT}`);
});
