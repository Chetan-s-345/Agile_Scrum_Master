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
          if (mountedRef.current && !closed) {
            setIsTranscribing(false);
          }
          return;
        }

        const key = await fetchDeepgramKey();

        const deepgram = new DeepgramClient({ apiKey: key });
        const connection = await deepgram.listen.v1.connect({
          Authorization: `Token ${key}`,
          model: "nova-2",
          language: "en",
          punctuate: "true",
          interim_results: "true",
        });

        dgConnection = connection as typeof dgConnection;

        connection.on("open", () => {
          if (!mountedRef.current || closed) return;
          setIsTranscribing(true);
          scheduleNoDataRecovery(start);
        });

        connection.on("message", (message: unknown) => {
          const payload = message as DeepgramTranscriptPayload;
          if (payload?.type !== "Results") return;
          const text = String(payload?.channel?.alternatives?.[0]?.transcript || "").trim();
          if (!text || !payload?.is_final || !mountedRef.current || closed) return;
          clearNoDataTimer();

          setTranscript((prev) => {
            if (!prev) return text;
            return `${prev}\n${text}`;
          });
        });

        connection.on("error", () => {
          if (!mountedRef.current || closed) return;
          setIsTranscribing(false);
        });

        connection.on("close", () => {
          if (!mountedRef.current || closed) return;
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
          if (!event.data || event.data.size === 0 || !dgConnection || closed) return;
          const chunk = await event.data.arrayBuffer();
          bytesSent += chunk.byteLength;
          dgConnection.sendMedia(chunk);
        };

        recorder.start(350);
      } catch {
        if (!mountedRef.current || closed) return;
        setIsTranscribing(false);
      }
    }

    void start();

    return () => {
      closed = true;
      setIsTranscribing(false);
      clearNoDataTimer();

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
