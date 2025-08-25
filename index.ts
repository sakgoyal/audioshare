import { serveDir } from 'jsr:@std/http/file-server';
import { Server } from 'npm:socket.io';
import { glob } from 'node:fs/promises';

Deno.serve({ port: 80 }, (req) => {
	return serveDir(req, {
		fsRoot: '.',
		quiet: true,
	});
});

const io = new Server(3000, {
	cors: { origin: '*' },
	pingInterval: 5000,
});

type ClientState = {
	isPlaying: boolean;
	currentTrack: string | null;
};

const clientStates = new Map<string, ClientState>();

io.on('connection', (socket) => {
	console.log(`Socket connected: ${socket.id}`);
	let groupID: string | null = null;

	socket.on('register', async (id: string) => {
		groupID = id;
		await socket.join(groupID);
		console.log(`Socket ${socket.id} joined group ${groupID}`);

		clientStates.set(socket.id, { isPlaying: false, currentTrack: null });

		const otherSockets = await io.in(groupID).fetchSockets();
		const existingClients = otherSockets
			.map((s) => s.id)
			.filter((id) => id !== socket.id);

		socket.emit('registered', {
			clientID: socket.id,
			existingClients,
		});

		socket.broadcast.to(groupID).emit('newClient', socket.id);

		// Send current states to all clients
		const allStates: Record<string, ClientState> = {};
		for (const [clientID, state] of clientStates) {
			allStates[clientID] = state;
		}
		io.to(groupID).emit('clientStates', allStates);

		const files = glob('*.{mp3,wav,aac,flac,ogg,opus}', { cwd: Deno.cwd() });
		const fileNames = await Array.fromAsync(files);
		socket.emit('filesList', fileNames);
	});

	socket.on('play', (state: { filename: string; time: number }) => {
		if (groupID) {
			const clientState = clientStates.get(socket.id);
			if (clientState) {
				clientState.isPlaying = true;
				clientState.currentTrack = state.filename;
			}
			socket.broadcast.to(groupID).emit('stateUpdate', { type: 'play', ...state, clientID: socket.id });
			broadcastStates(groupID);
		}
	});

	socket.on('pause', (state: { filename: string; time: number }) => {
		if (groupID) {
			const clientState = clientStates.get(socket.id);
			if (clientState) {
				clientState.isPlaying = false;
				clientState.currentTrack = null;
			}
			socket.broadcast.to(groupID).emit('stateUpdate', { type: 'pause', ...state, clientID: socket.id });
			broadcastStates(groupID);
		}
	});

	socket.on('seeked', (state: { filename: string; time: number }) => {
		if (groupID) {
			socket.broadcast.to(groupID).emit('stateUpdate', { type: 'seeked', ...state, clientID: socket.id });
		}
	});

	socket.on('transferRequest', ({ targetClientID, state }) => {
		const sourceState = clientStates.get(socket.id);
		const targetState = clientStates.get(targetClientID);

		if (sourceState) {
			sourceState.isPlaying = false;
			sourceState.currentTrack = null;
		}

		if (targetState) {
			targetState.isPlaying = true;
			targetState.currentTrack = state.filename;
		}

		io.to(targetClientID).emit('applyState', state);
		socket.emit('pausePlayback');

		if (groupID) broadcastStates(groupID);
		console.log(`Transferring playback from ${socket.id} to ${targetClientID}`);
	});

	socket.on('pullRequest', ({ sourceClientID }) => {
		if (sourceClientID === 'any') {
			for (const [clientID, state] of clientStates) {
				if (state.isPlaying && clientID !== socket.id) {
					io.to(clientID).emit('requestCurrentState', socket.id);
					console.log(`${socket.id} requesting playback from any playing client: ${clientID}`);
					return;
				}
			}
			console.log(`${socket.id} requested pull but no clients are playing`);
		} else {
			io.to(sourceClientID).emit('requestCurrentState', socket.id);
			console.log(`${socket.id} requesting playback from ${sourceClientID}`);
		}
	});

	socket.on('disconnect', () => {
		if (groupID) {
			io.to(groupID).emit('clientLeft', socket.id);
			clientStates.delete(socket.id);
			broadcastStates(groupID);
		}
		console.log(`Socket disconnected: ${socket.id}`);
	});

	function broadcastStates(groupID: string) {
		const allStates: Record<string, ClientState> = {};
		for (const [clientID, state] of clientStates) {
			allStates[clientID] = state;
		}
		io.to(groupID).emit('clientStates', allStates);
	}
});
