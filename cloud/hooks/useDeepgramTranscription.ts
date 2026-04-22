"use client";

import { useEffect, useRef, useState } from "react";
import { DeepgramClient } from "@deepgram/sdk";

type DeepgramTokenResponse = {
  key?: string;
};

type DeepgramTranscriptPayload = {
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
      setIsTranscribing(false);
      return;
    }

    let closed = false;
    let recorder: MediaRecorder | null = null;
    let clonedTrack: MediaStreamTrack | null = null;
    let dgConnection: {
      on: (event: string, cb: (...args: unknown[]) => void) => void;
      send: (chunk: ArrayBuffer) => void;
      finish: () => void;
    } | null = null;

    async function start() {
      try {
        const tokenResp = await fetch("/api/meetings/deepgram-token", { cache: "no-store" });
        const tokenData = (await tokenResp.json().catch(() => null)) as DeepgramTokenResponse | null;
        const key = String(tokenData?.key || "").trim();
        if (!tokenResp.ok || !key) {
          throw new Error("Deepgram token unavailable");
        }

        const deepgram = new DeepgramClient({ apiKey: key });
        const connection = await deepgram.listen.live({
          model: "nova-2",
          language: "en",
          punctuate: true,
          interim_results: false,
        });

        dgConnection = connection as typeof dgConnection;

        connection.on("Open", () => {
          if (!mountedRef.current || closed) return;
          setIsTranscribing(true);
        });

        connection.on("Transcript", (message: unknown) => {
          const payload = message as DeepgramTranscriptPayload;
          const text = String(payload?.channel?.alternatives?.[0]?.transcript || "").trim();
          if (!text || !payload?.is_final || !mountedRef.current || closed) return;

          setTranscript((prev) => {
            if (!prev) return text;
            return `${prev}\n${text}`;
          });
        });

        connection.on("Error", () => {
          if (!mountedRef.current || closed) return;
          setIsTranscribing(false);
        });

        connection.on("Close", () => {
          if (!mountedRef.current || closed) return;
          setIsTranscribing(false);
        });

        clonedTrack = audioTrack.clone();
        const stream = new MediaStream([clonedTrack]);
        const preferredType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm";

        recorder = new MediaRecorder(stream, { mimeType: preferredType });
        recorder.ondataavailable = async (event) => {
          if (!event.data || event.data.size === 0 || !dgConnection || closed) return;
          const chunk = await event.data.arrayBuffer();
          dgConnection.send(chunk);
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

      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }

      if (clonedTrack) {
        clonedTrack.stop();
      }

      if (dgConnection) {
        dgConnection.finish();
      }
    };
  }, [audioTrack]);

  return { transcript, isTranscribing };
}
