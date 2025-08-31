type GlobalState = {
	isPlaying: boolean;
	filename: string | null;
	time: number;
	activeClientID: string | null;
};

interface ServerToClientEvents {
	clientList: (clientID: string[]) => void;
	globalState: (state: GlobalState) => void;
	filesList: (files: string[]) => void;
	requestCurrentState: (requestingClientID: string) => void;
	musicMetadata: (metadata: { title?: string; artist?: string; album?: string; lyrics?: ILyricsTag[] }) => void;
}

interface ClientToServerEvents {
	register: (groupID: string) => void;
	play: (data: { filename: string; time: number }) => void;
	pause: (data: { filename: string; time: number }) => void;
	seeked: (data: { filename: string; time: number }) => void;
	transferRequest: (data: { targetClientID: string; state: { filename: string; time: number; isPlaying: boolean } }) => void;
	pullRequest: (data: { sourceClientID: string }) => void;
}
