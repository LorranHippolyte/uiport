import { startStaticServer } from "./lib.mjs";
export async function serve(options) {
  const server = await startStaticServer(options.directory, options.port);
  const ready = {
    command: "serve",
    status: "ready",
    directory: options.directory,
    url: server.url,
  };
  console.log(
    options.json
      ? JSON.stringify(ready)
      : `UIport serving ${server.url}\nPress Ctrl+C to stop.`,
  );
  await new Promise((resolve) => {
    const stop = async () => {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
      await server.close();
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return { command: "serve", status: "stopped" };
}
