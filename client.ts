/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/// <reference lib="esnext" />
// @ts-types="npm:socket.io-client"
import { io, type Socket } from './socket.io.esm.min.js';

function setupPassword() {
	if (!localStorage.getItem('groupID')) {
		const val = prompt('Enter a complicated ascii password:');
		if (val) localStorage.setItem('groupID', val);
	}
	return localStorage.getItem('groupID');
}

const groupID = setupPassword();
if (!groupID) throw new Error('Group ID is required')

const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io('ws://localhost:3000');
let isProgrammaticChange = false;
let myPlayAction = false; // Track when I initiated a play action
let connectedClients = new Set<string>();
let globalState: GlobalState = {
	isPlaying: false,
	currentTrack: null,
	currentTime: 0,
	activeClientID: null,
};

function getActiveAudio(): HTMLAudioElement | undefined {
	return [...document.querySelectorAll('audio')].find((a) => !a.paused);
}

function renderClients() {
	const clientsList = document.getElementById('clients-list') as HTMLDivElement;
	clientsList.innerHTML = '';

	const sortedClientIDs = Array.from(connectedClients).sort();

	for (const clientID of sortedClientIDs) {
		const isSelf = clientID === socket.id;
		const isActive = globalState.activeClientID === clientID;
		const shortID = clientID.substring(0, 8);

		const row = document.createElement('div');
		row.className = `row client-row ${isActive ? 'playing' : ''}`;

		const statusText = isActive && globalState.isPlaying ? `Playing: ${globalState.currentTrack}` : 'Idle';

		row.innerHTML = `<div><strong>${isSelf ? 'This Device - ' : ''}</strong> ${shortID}<br><small style="color: ${isActive && globalState.isPlaying ? '#4CAF50' : '#999'}">${statusText}</small></div>`;

		row.onclick = () => {
			if (isSelf) {
				socket.emit('pullRequest', { sourceClientID: 'any' });
			} else {
				const activeAudio = getActiveAudio();
				if (activeAudio) {
					socket.emit('transferRequest', {
						targetClientID: clientID,
						state: {
							filename: activeAudio.ariaLabel!,
							time: activeAudio.currentTime,
							isPlaying: !activeAudio.paused,
						},
					});
				}
			}
		};

		clientsList.appendChild(row);
	}
}

function applyGlobalState() {
	if (!globalState.currentTrack) {
		// If no track is playing, pause all audio
		document.querySelectorAll('audio').forEach((a) => {
			a.pause();
		});
		renderClients();
		return;
	}

	const targetAudio = [...document.querySelectorAll('audio')].find(
		(a) => a.ariaLabel === globalState.currentTrack,
	);

	if (!targetAudio) return;

	isProgrammaticChange = true;

	// Pause all other audio elements
	document.querySelectorAll('audio').forEach((a) => {
		if (a !== targetAudio) {
			a.pause();
			a.currentTime = 0;
		}
	});

	// Apply state to target audio
	targetAudio.currentTime = globalState.currentTime;

	if (globalState.isPlaying) {
		if (globalState.activeClientID === socket.id) {
			// Only this client should actually play audio
			targetAudio.play().catch((e) => console.error('Play failed:', e));
		} else {
			// Other clients just seek to the position but don't play
			targetAudio.pause();
		}
	} else {
		targetAudio.pause();
	}

	setTimeout(() => isProgrammaticChange = false, 100);
	renderClients();
}

socket.on('connect', () => {
	if (groupID) {
		socket.emit('register', groupID);
	}
});

socket.on('clientList', (clientList) => {
	console.log('ClientList=', clientList);
	connectedClients = new Set(clientList);
	renderClients();
});

socket.on('globalState', (newState) => {
	console.log('Received global state:', JSON.stringify(newState, null, 2));
	console.log('Previous global state:', JSON.stringify(globalState, null, 2));
	console.log('myPlayAction:', myPlayAction, 'newState.activeClientID === socket.id:', newState.activeClientID === socket.id);

	// Always update the global state
	globalState = { ...newState };

	// If this was my own play action, don't apply it to audio elements (they're already correct)
	if (myPlayAction && newState.activeClientID === socket.id) {
		console.log('This was my play action, skipping audio application but updating UI');
		renderClients();
	} else {
		// Apply state for other clients' actions or state changes
		applyGlobalState();
	}
});

socket.on('filesList', (files) => {
	const audioContainer = document.getElementById('audio-container') as HTMLDivElement;
	audioContainer.innerHTML = '';
	for (const file of files) {
		const row = document.createElement('div');
		row.innerHTML = `
			<div class="row">
				<h2>${file}</h2>
				<audio controls src="/${file}" preload="none" aria-label="${file}"></audio>
			</div>
		`;
		const audio = row.querySelector('audio') as HTMLAudioElement;
		audio.onplay = onplay;
		audio.onpause = onpause;
		audio.onseeked = onseeked;
		audioContainer.appendChild(row);
	}
});

socket.on('requestCurrentState', (requestingClientID) => {
	const activeAudio = getActiveAudio();
	if (activeAudio) {
		const state = { filename: activeAudio.ariaLabel!, time: activeAudio.currentTime, isPlaying: !activeAudio.paused };
		socket.emit('transferRequest', { targetClientID: requestingClientID, state });
	}
});

function sendStateUpdate(event: Event, type: keyof ClientToServerEvents) {
	if (isProgrammaticChange) return;
	const { currentTime, ariaLabel } = event.target as HTMLAudioElement;
	socket.emit(type, { time: currentTime, filename: ariaLabel });
}

const onseeked = (event: Event) => sendStateUpdate(event, 'seeked');

const onplay = (event: Event) => {
	if (isProgrammaticChange) return;
	const targetAudio = event.target as HTMLAudioElement;

	console.log('User initiated play:', {
		filename: targetAudio.ariaLabel,
		currentTime: targetAudio.currentTime,
		myPlayAction: myPlayAction,
	});

	// Mark that this is my action
	myPlayAction = true;

	// Set programmatic change flag to prevent pause events from other audio elements
	isProgrammaticChange = true;

	// Immediately pause other audio elements to prevent conflicts
	document.querySelectorAll('audio').forEach((audio) => {
		if (audio !== targetAudio) {
			audio.pause();
			audio.currentTime = 0;
		}
	});

	// Reset programmatic change flag
	isProgrammaticChange = false;

	// Update local state optimistically
	globalState.isPlaying = true;
	globalState.currentTrack = targetAudio.ariaLabel;
	globalState.currentTime = targetAudio.currentTime;
	globalState.activeClientID = socket.id!;

	console.log('Updated local globalState optimistically:', globalState);

	sendStateUpdate(event, 'play');
	renderClients();

	// Reset the flag after a short delay
	setTimeout(() => {
		console.log('Resetting myPlayAction flag');
		myPlayAction = false;
	}, 500); // Increased timeout to be safer
};

const onpause = (event: Event) => {
	if (isProgrammaticChange) return;

	const {ariaLabel, currentTime} = event.target as HTMLAudioElement;

	console.log('User initiated pause:', { filename: ariaLabel, currentTime: currentTime });

	sendStateUpdate(event, 'pause');
};

socket.on('musicMetadata', (metadata) => {
	console.log('Received music metadata:', metadata);
	navigator.mediaSession.metadata = new MediaMetadata({
		title: metadata.title ?? globalState.currentTrack ?? 'Unknown Title',
		artist: metadata.artist ?? 'Unknown Artist',
		album: metadata.album ?? 'Unknown Album',
		// artwork: metadata.artwork,
	});
});
