import { serveDir } from "jsr:@std/http/file-server";
import { glob } from "node:fs/promises";

Deno.serve({ port: 80 }, (req) => {
  return serveDir(req, {
    showDirListing: false,
    enableCors: false,
  });
});

const clients = new Map<string, Map<string, WebSocket>>();

function broadcast(groupID: string, message: object, excludeClientID?: string) {
  const group = clients.get(groupID);
  if (!group) return;
  const stringifiedMessage = JSON.stringify(message);
  for (const [clientID, socket] of group.entries()) {
    if (clientID !== excludeClientID && socket.readyState === WebSocket.OPEN) {
      socket.send(stringifiedMessage);
    }
  }
}

Deno.serve({ port: 8080 }, (req) => {
  if (req.headers.get("upgrade") != "websocket") {
    return new Response(null, { status: 426 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);
  let clientID: string | null = null;
  let groupID: string | null = null;

  socket.onopen = () => console.log("WS connected");

  socket.onmessage = async (e) => {
    const message = JSON.parse(e.data);

    switch (message.type) {
      case "register": {
        clientID = crypto.randomUUID();
        groupID = message.groupID;

        if (!clients.has(groupID)) {
          clients.set(groupID, new Map());
        }
        const group = clients.get(groupID)!;

        broadcast(groupID, { type: "newClient", clientID });

        socket.send(JSON.stringify({
          type: "registered",
          clientID,
          existingClients: Array.from(group.keys()),
        }));

        group.set(clientID, socket);

        const files = glob("*.{mp3,wav,aac,flac,ogg,opus}", {
          cwd: Deno.cwd(),
        });
        const fileNames = await Array.fromAsync(files);
        socket.send(JSON.stringify({ type: "filesList", files: fileNames }));
        console.log(`Client ${clientID} registered to group ${groupID}`);
        break;
      }
      case "transferRequest": {
        const { targetClientID, state } = message;
        const targetGroup = clients.get(message.groupID);
        const targetSocket = targetGroup?.get(targetClientID);
        if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
          targetSocket.send(JSON.stringify({ type: "applyState", state }));
          socket.send(JSON.stringify({ type: "pausePlayback" }));
        }
        break;
      }
      default: {
        if (message.groupID && clientID) {
          broadcast(message.groupID, {
            type: "stateUpdate",
            state: {
              type: message.type,
              time: message.time,
              filename: message.filename,
            },
          }, clientID);
        }
        break;
      }
    }
  };

  socket.onclose = () => {
    if (groupID && clientID) {
      const group = clients.get(groupID);
      if (group) {
        group.delete(clientID);
        if (group.size === 0) {
          clients.delete(groupID);
        }
      }
      broadcast(groupID, { type: "clientLeft", clientID });
    }
    console.log("WS closed");
  };

  socket.onerror = (e) => console.error("WS error:", e);

  return response;
});
