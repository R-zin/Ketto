import { buildApp } from "./app.js";
const app = await buildApp();
await app.listen({
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 8787),
});
for (const event of ["SIGINT", "SIGTERM"])
  process.on(event, () => {
    void app.close();
  });
