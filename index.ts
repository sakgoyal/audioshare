import { serveDir, serveFile } from 'jsr:@std/http/file-server';
import { Server } from 'npm:socket.io';
import { glob } from 'node:fs/promises';
import { parseFile } from 'music-metadata';

const musicDir = 'C:/Users/Saksham/Music/Echo';

const files = glob('*.{mp3,wav,aac,flac,ogg,opus}', { cwd: musicDir });
const fileNames = await Array.fromAsync(files);
// limit to 10 files
fileNames.splice(10);
console.log('Files:', fileNames);

Deno.serve({ port: 80 }, (req) => {
	const pathname = decodeURI(new URL(req.url).pathname);
	if (fileNames.some((name) => pathname.endsWith(name))) {
		const filePath = `${musicDir}/${pathname.split('/').pop()}`;
		return serveFile(req, filePath);
	}
	return serveDir(req, { fsRoot: ".", quiet: true })
});


const io = new Server<ClientToServerEvents, ServerToClientEvents>(3000, {
	serveClient: false,
	cors: { origin: '*' },
	pingInterval: 1000,
	pingTimeout: 3000,
});

const groupStates = new Map<string, GlobalState>(); // map roomID to GlobalState (the state for that room)
const clientGroups = new Map<string, string>(); // map clientID to roomID (used to track which room a client is in)

io.on('connection', (socket) => {
	console.log(`Socket connected: ${socket.id}`);

	socket.on('register', async (roomID) => {
		await socket.join(roomID);
		clientGroups.set(socket.id, roomID);
		console.log(`Socket ${socket.id} joined room: ${roomID}`);

		// socket.rooms.

		// Initialize group state if it doesn't exist
		if (!groupStates.has(roomID)) {
			groupStates.set(roomID, {
				isPlaying: false,
				currentTrack: null,
				currentTime: 0,
				activeClientID: null,
			});
		}

		const otherSockets = (await io.in(roomID).fetchSockets()).map((s) => s.id);

		socket.emit('clientList', otherSockets);

		socket.broadcast.to(roomID).emit('clientList', otherSockets);

		// Send current global state to the new client
		const currentState = groupStates.get(roomID);
		if (currentState) {
			socket.emit('globalState', currentState);
		}
		socket.emit('filesList', fileNames);
	});

	socket.on('play', async (data) => {
		const roomID = clientGroups.get(socket.id);
		if (roomID) {
			const state = groupStates.get(roomID);
			if (state) {
				state.isPlaying = true;
				state.currentTrack = data.filename;
				state.currentTime = data.time;
				state.activeClientID = socket.id;

				io.to(roomID).emit('globalState', state);
				console.log(`Play: ${socket.id} playing ${data.filename} at ${data.time}`);
				const metadata = await parseFile(`C:/Users/Saksham/Music/Echo/${decodeURI(data.filename)}`);
				const title = metadata.common.title;
				const artist = metadata.common.artist;
				const album = metadata.common.album;
				const lyrics = metadata.common.lyrics;
				const picture = metadata.common.picture ? metadata.common.picture[0] : null;
				// const { data: pictureData, format, name, type } = picture!;
				console.log({ title, artist, album, lyrics });
				socket.emit('musicMetadata', { title, artist, album, lyrics });
			}
		}
	});

	socket.on('pause', (data) => {
		const roomID = clientGroups.get(socket.id);
		if (roomID) {
			const state = groupStates.get(roomID);
			if (state) {
				state.isPlaying = false;
				state.currentTime = data.time;

				io.to(roomID).emit('globalState', state);
				console.log(`Pause: ${socket.id} paused at ${data.time}`);
			}
		}
	});

	socket.on('seeked', (data) => {
		const roomID = clientGroups.get(socket.id);
		if (roomID) {
			const state = groupStates.get(roomID);
			if (state && state.activeClientID === socket.id) {
				state.currentTime = data.time;

				io.to(roomID).emit('globalState', state);
				console.log(`Seek: ${socket.id} seeked to ${data.time}`);
			}
		}
	});

	socket.on('transferRequest', ({ targetClientID, state: clientState }) => {
		const roomID = clientGroups.get(socket.id);
		if (roomID) {
			const state = groupStates.get(roomID);
			if (state) {
				state.isPlaying = clientState.isPlaying;
				state.currentTrack = clientState.filename;
				state.currentTime = clientState.time;
				state.activeClientID = targetClientID;

				io.to(roomID).emit('globalState', state);
				console.log(`Transfer: from ${socket.id} to ${targetClientID}`);
			}
		}
	});

	socket.on('pullRequest', ({ sourceClientID }) => {
		const roomID = clientGroups.get(socket.id);
		if (roomID) {
			const state = groupStates.get(roomID);
			if (state) {
				if (sourceClientID === 'any') {
					if (state.isPlaying && state.activeClientID) {
						io.to(state.activeClientID).emit('requestCurrentState', socket.id);
						console.log(`Pull request: ${socket.id} requesting from active client ${state.activeClientID}`);
					} else {
						console.log(`Pull request: ${socket.id} requested but no active playback`);
					}
				} else {
					io.to(sourceClientID).emit('requestCurrentState', socket.id);
					console.log(`Pull request: ${socket.id} requesting from ${sourceClientID}`);
				}
			}
		}
	});

	socket.on('disconnect', async () => {
		const roomID = clientGroups.get(socket.id);
		if (roomID) {
			const state = groupStates.get(roomID);
			if (state && state.activeClientID === socket.id) {
				// If the disconnecting client was the active one, clear the state
				state.isPlaying = false;
				state.activeClientID = null;
				io.to(roomID).emit('globalState', state);
			}

			const sockets = await io.in(roomID).fetchSockets();
			const clients = sockets.map((s) => s.id);

			io.to(roomID).emit('clientList', clients);
			clientGroups.delete(socket.id);
		}
		console.log(`Socket disconnected: ${socket.id}`);
	});
});
