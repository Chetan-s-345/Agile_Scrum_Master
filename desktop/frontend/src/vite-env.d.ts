/// <reference types="vite/client" />

interface DesktopApi {
	invoke<T = unknown>(channel: string, payload?: unknown): Promise<T>;
	on(channel: string, listener: (payload: unknown) => void): () => void;
}

interface DesktopAppInfo {
	isElectron: boolean;
}

interface Window {
	desktopApi: DesktopApi;
	desktopApp?: DesktopAppInfo;
}
