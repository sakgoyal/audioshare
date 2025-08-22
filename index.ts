import { serveDir, serveFile } from "jsr:@std/http/file-server";

Deno.serve({ port: 80 }, (req) => {
  const pathname = new URL(req.url).pathname;
  if (pathname === "/") {
    return serveFile(req, "index.html");
  }
  return serveDir(req, {
    fsRoot: "./public",
    showDirListing: true,
    enableCors: false,
  });
});

Deno.serve({ port: 8080 }, (req) => {
  if (req.headers.get("upgrade") != "websocket") {
    return new Response(null, { status: 426 });
  }
  const { socket, response } = Deno.upgradeWebSocket(req);
  socket.onopen = () => console.log("WS connected");
  socket.onmessage = (e) => socket.send(`echo: ${e.data}`);
  socket.onclose = () => console.log("WS closed");
  socket.onerror = (e) => console.error("WS error:", e);
  return response;
});
