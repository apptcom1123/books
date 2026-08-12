import { createApp } from "./app.js";

const port = Number(process.env.PORT || 3001);
createApp({ serveStatic: true })
  .then((app) => app.listen(port, () => console.log(`Mystery Commons: http://localhost:${port}`)))
  .catch((error) => {
    console.error("Failed to start:", error);
    process.exit(1);
  });
