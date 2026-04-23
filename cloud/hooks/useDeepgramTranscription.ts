"use client";

import { useEffect, useRef, useState } from "react";
import { DeepgramClient } from "@deepgram/sdk";

type DeepgramTokenResponse = {
  key?: string;
};

type DeepgramTranscriptPayload = {
  type?: string;
  is_final?: boolean;
  channel?: {
    alternatives?: Array<{ transcript?: string }>;
  };
};

export function useDeepgramTranscription(audioTrack: MediaStreamTrack | null) {
  const [transcript, setTranscript] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!audioTrack) {
      return;
    }

    let closed = false;
    let recorder: MediaRecorder | null = null;
    let clonedTrack: MediaStreamTrack | null = null;
    let bytesSent = 0;
    let hasRetriedOnNoData = false;
    let noDataTimer: ReturnType<typeof setTimeout> | null = null;
    let dgConnection: {
      on: (event: string, cb: (...args: unknown[]) => void) => void;
      sendMedia: (chunk: ArrayBufferLike | Blob | ArrayBufferView) => void;
      sendCloseStream: (payload: unknown) => void;
      connect: () => void;
      close: () => void;
    } | null = null;

    function clearNoDataTimer() {
      if (!noDataTimer) return;
      clearTimeout(noDataTimer);
      noDataTimer = null;
    }

    function scheduleNoDataRecovery(restart: () => Promise<void>) {
      clearNoDataTimer();
      noDataTimer = setTimeout(() => {
        if (closed || bytesSent > 0 || hasRetriedOnNoData) return;
        hasRetriedOnNoData = true;
        if (dgConnection) {
          try {
            dgConnection.sendCloseStream({ type: "CloseStream" });
          } catch {
            // no-op
          }
          dgConnection.close();
          dgConnection = null;
        }
        void restart();
      }, 10000);
    }

    async function fetchDeepgramKey() {
      let attempt = 0;
      let waitMs = 350;

      while (attempt < 3) {
        try {
          const tokenResp = await fetch("/api/meetings/deepgram-token", { cache: "no-store" });
          const tokenData = (await tokenResp.json().catch(() => null)) as DeepgramTokenResponse | null;
          const key = String(tokenData?.key || "").trim();
          if (tokenResp.ok && key) return key;
        } catch {
          // retry
        }
        attempt += 1;
        if (attempt >= 3) break;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        waitMs *= 2;
      }

      throw new Error("Deepgram token unavailable");
    }

    async function start() {
      try {
        clearNoDataTimer();
        bytesSent = 0;

        const currentTrack = audioTrack;
        if (!currentTrack) {
          console.warn("[Deepgram] No audio track available yet");
          if (mountedRef.current && !closed) {
            setIsTranscribing(false);
          }
          return;
        }

        console.log("[Deepgram] Starting transcription...");
        const key = await fetchDeepgramKey();
        console.log("[Deepgram] Token fetched, connecting...");

        const deepgram = new DeepgramClient({ apiKey: key });
        const connection = await deepgram.listen.v1.connect({
          Authorization: `Token ${key}`,
          model: "nova-2",
          language: "en",
          punctuate: "true",
          interim_results: "true",
        });

        dgConnection = connection as typeof dgConnection;
        let isConnectionReady = false;
        const audioChunksBuffer: ArrayBuffer[] = [];

        connection.on("open", () => {
          if (!mountedRef.current || closed) return;
          console.log("[Deepgram] Connection opened, streaming audio...");
          isConnectionReady = true;
          setIsTranscribing(true);
          scheduleNoDataRecovery(start);

          // Flush any buffered audio chunks
          while (audioChunksBuffer.length > 0) {
            const bufferedChunk = audioChunksBuffer.shift();
            if (bufferedChunk && dgConnection) {
              try {
                dgConnection.sendMedia(bufferedChunk);
                bytesSent += bufferedChunk.byteLength;
                console.log(`[Deepgram] Flushed buffered ${bufferedChunk.byteLength} bytes (total: ${bytesSent})`);
              } catch (err) {
                console.warn("[Deepgram] Failed to send buffered chunk:", err instanceof Error ? err.message : String(err));
              }
            }
          }
        });

        connection.on("message", (message: unknown) => {
          const payload = message as DeepgramTranscriptPayload;
          if (payload?.type !== "Results") return;
          const text = String(payload?.channel?.alternatives?.[0]?.transcript || "").trim();
          if (!text || !payload?.is_final || !mountedRef.current || closed) return;
          clearNoDataTimer();
          console.log("[Deepgram] Transcript received:", text);

          setTranscript((prev) => {
            if (!prev) return text;
            return `${prev}\n${text}`;
          });
        });

        connection.on("error", () => {
          if (!mountedRef.current || closed) return;
          console.error("[Deepgram] Connection error");
          setIsTranscribing(false);
        });

        connection.on("close", () => {
          if (!mountedRef.current || closed) return;
          console.warn("[Deepgram] Connection closed");
          setIsTranscribing(false);
        });

        connection.connect();

        clonedTrack = currentTrack.clone();
        const stream = new MediaStream([clonedTrack]);
        const preferredType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm";

        recorder = new MediaRecorder(stream, { mimeType: preferredType });
        recorder.ondataavailable = async (event) => {
          if (!event.data || event.data.size === 0 || closed) return;
          const chunk = await event.data.arrayBuffer();

          if (!isConnectionReady) {
            console.log(`[Deepgram] Connection not ready, buffering ${chunk.byteLength} bytes`);
            audioChunksBuffer.push(chunk);
            return;
          }

          if (!dgConnection) return;

          try {
            bytesSent += chunk.byteLength;
            console.log(`[Deepgram] Sending ${chunk.byteLength} bytes (total: ${bytesSent})`);
            dgConnection.sendMedia(chunk);
          } catch (err) {
            console.warn("[Deepgram] Failed to send media:", err instanceof Error ? err.message : String(err));
          }
        };

        recorder.start(350);
      } catch (err) {
        console.error("[Deepgram] Failed to start:", err instanceof Error ? err.message : String(err));
        if (!mountedRef.current || closed) return;
        setIsTranscribing(false);
      }
    }

    void start();

    return () => {
      closed = true;
      setIsTranscribing(false);
      clearNoDataTimer();
      console.log(`[Deepgram] Cleanup: ${bytesSent} bytes sent total`);

      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }

      if (clonedTrack) {
        clonedTrack.stop();
      }

      if (dgConnection) {
        try {
          dgConnection.sendCloseStream({ type: "CloseStream" });
        } catch {
          // no-op
        }
        dgConnection.close();
      }
    };
  }, [audioTrack]);

  return { transcript, isTranscribing };
}
