export {};

declare global {
  interface Window {
    desktopApp?: {
      isElectron: boolean;
    };
    desktopApi?: {
      invoke: <T = unknown>(channel: string, payload?: unknown) => Promise<T>;
    };
  }
}
