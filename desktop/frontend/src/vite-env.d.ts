/// <reference types="vite/client" />

interface DesktopApi {
	invoke<T = unknown>(channel: string, payload?: unknown): Promise<T>;
}

interface Window {
	desktopApi: DesktopApi;
}
