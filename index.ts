import { serveDir } from "jsr:@std/http/file-server";
import { glob } from "node:fs/promises";
Deno.serve({ port: 80 }, (req) => {
  return serveDir(req, {
    showDirListing: false,
    enableCors: false,
  });
});

Deno.serve({ port: 8080 }, (req) => {
  if (req.headers.get("upgrade") != "websocket") {
    return new Response(null, { status: 426 });
  }
  const { socket, response } = Deno.upgradeWebSocket(req);
  socket.onopen = () => {console.log("WS connected"); sendFilesList(socket);};
  socket.onmessage = (e) => handleOnMessage(e, socket, response);
  socket.onclose = () => console.log("WS closed");
  socket.onerror = (e) => console.error("WS error:", e);
  return response;
});


function handleOnMessage(event: MessageEvent, socket: WebSocket, _response: Response) {
  console.log("Message received:", event.data);
  socket.send(`${event.data}`);
}

async function sendFilesList(socket: WebSocket) {
  const files = glob("*.{mp3,wav,aac,flac,ogg,opus}", { cwd: Deno.cwd() });
  const fileNames = (await Array.fromAsync(files));
  console.log("Sending files list:", fileNames);
  socket.send(JSON.stringify({ type: "filesList", files: fileNames }));
}
