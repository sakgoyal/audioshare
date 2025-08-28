import { serveDir } from 'jsr:@std/http/file-server';
import { Server } from 'npm:socket.io';
import { glob } from 'node:fs/promises';

Deno.serve({ port: 80 }, (req) =>
	serveDir(req, {
		fsRoot: '.',
		quiet: true,
	}));

const io = new Server<ClientToServerEvents, ServerToClientEvents>(3000, {
	serveClient: false,
	cors: { origin: '*' },
	pingInterval: 1000,
	pingTimeout: 3000,
});

const groupStates = new Map<string, GlobalState>();
const clientGroups = new Map<string, string>();

io.on('connection', (socket) => {
	console.log(`Socket connected: ${socket.id}`);

	socket.on('register', async (groupID) => {
		await socket.join(groupID);
		clientGroups.set(socket.id, groupID);
		console.log(`Socket ${socket.id} joined group ${groupID}`);

		// Initialize group state if it doesn't exist
		if (!groupStates.has(groupID)) {
			groupStates.set(groupID, {
				isPlaying: false,
				currentTrack: null,
				currentTime: 0,
				activeClientID: null,
			});
		}

		const otherSockets = (await io.in(groupID).fetchSockets()).map((s) => s.id)

		socket.emit('clientList', otherSockets);

		socket.broadcast.to(groupID).emit('clientList', otherSockets);

		// Send current global state to the new client
		const currentState = groupStates.get(groupID);
		if (currentState) {
			socket.emit('globalState', currentState);
		}

		const files = glob('*.{mp3,wav,aac,flac,ogg,opus}', { cwd: 'C:/Users/Saksham/Music/' });
		const fileNames = await Array.fromAsync(files);
		// limit to 10 files
		fileNames.splice(10);
		socket.emit('filesList', fileNames);
	});

	socket.on('play', (data) => {
		const groupID = clientGroups.get(socket.id);
		if (groupID) {
			const state = groupStates.get(groupID);
			if (state) {
				state.isPlaying = true;
				state.currentTrack = data.filename;
				state.currentTime = data.time;
				state.activeClientID = socket.id;

				io.to(groupID).emit('globalState', state);
				console.log(`Play: ${socket.id} playing ${data.filename} at ${data.time}`);
			}
		}
	});

	socket.on('pause', (data) => {
		const groupID = clientGroups.get(socket.id);
		if (groupID) {
			const state = groupStates.get(groupID);
			if (state) {
				state.isPlaying = false;
				state.currentTime = data.time;

				io.to(groupID).emit('globalState', state);
				console.log(`Pause: ${socket.id} paused at ${data.time}`);
			}
		}
	});

	socket.on('seeked', (data) => {
		const groupID = clientGroups.get(socket.id);
		if (groupID) {
			const state = groupStates.get(groupID);
			if (state && state.activeClientID === socket.id) {
				state.currentTime = data.time;

				io.to(groupID).emit('globalState', state);
				console.log(`Seek: ${socket.id} seeked to ${data.time}`);
			}
		}
	});

	socket.on('transferRequest', ({ targetClientID, state: clientState }) => {
		const groupID = clientGroups.get(socket.id);
		if (groupID) {
			const state = groupStates.get(groupID);
			if (state) {
				state.isPlaying = clientState.isPlaying;
				state.currentTrack = clientState.filename;
				state.currentTime = clientState.time;
				state.activeClientID = targetClientID;

				io.to(groupID).emit('globalState', state);
				console.log(`Transfer: from ${socket.id} to ${targetClientID}`);
			}
		}
	});

	socket.on('pullRequest', ({ sourceClientID }) => {
		const groupID = clientGroups.get(socket.id);
		if (groupID) {
			const state = groupStates.get(groupID);
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
		const groupID = clientGroups.get(socket.id);
		if (groupID) {
			const state = groupStates.get(groupID);
			if (state && state.activeClientID === socket.id) {
				// If the disconnecting client was the active one, clear the state
				state.isPlaying = false;
				state.activeClientID = null;
				io.to(groupID).emit('globalState', state);
			}

			const sockets = await io.in(groupID).fetchSockets()
			const clients = sockets.map(s => s.id);

			io.to(groupID).emit('clientList', clients);
			clientGroups.delete(socket.id);
		}
		console.log(`Socket disconnected: ${socket.id}`);
	});
});
