type GlobalState = {
	isPlaying: boolean;
	currentTrack: string | null;
	currentTime: number;
	activeClientID: string | null;
};

interface ServerToClientEvents {
	clientList: (clientID: string[]) => void;
	globalState: (state: GlobalState) => void;
	filesList: (files: string[]) => void;
	requestCurrentState: (requestingClientID: string) => void;
}

interface ClientToServerEvents {
	register: (groupID: string) => void;
	play: (data: { filename: string; time: number }) => void;
	pause: (data: { filename: string; time: number }) => void;
	seeked: (data: { filename: string; time: number }) => void;
	transferRequest: (data: { targetClientID: string; state: { filename: string; time: number; isPlaying: boolean } }) => void;
	pullRequest: (data: { sourceClientID: string }) => void;
}
