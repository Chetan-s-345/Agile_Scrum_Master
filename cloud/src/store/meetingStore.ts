"use client";

import { create } from "zustand";
import type { MeetingRoomItem } from "@/components/meetings/types";

type MeetingStore = {
  currentRoom: string;
  transcript: string;
  summary: string;
  meetings: MeetingRoomItem[];
  isInMeeting: boolean;
  setRoom: (roomName: string) => void;
  appendTranscript: (chunk: string) => void;
  setSummary: (summary: string) => void;
  setMeetings: (meetings: MeetingRoomItem[]) => void;
  endMeeting: () => void;
};

export const useMeetingStore = create<MeetingStore>((set) => ({
  currentRoom: "",
  transcript: "",
  summary: "",
  meetings: [],
  isInMeeting: false,
  setRoom: (roomName) =>
    set({
      currentRoom: String(roomName || "").trim(),
      transcript: "",
      summary: "",
      isInMeeting: Boolean(String(roomName || "").trim()),
    }),
  appendTranscript: (chunk) =>
    set((state) => {
      const text = String(chunk || "").trim();
      if (!text) return state;
      return {
        transcript: state.transcript ? `${state.transcript}\n${text}` : text,
      };
    }),
  setSummary: (summary) => set({ summary: String(summary || "") }),
  setMeetings: (meetings) => set({ meetings: Array.isArray(meetings) ? meetings : [] }),
  endMeeting: () => set({ currentRoom: "", isInMeeting: false }),
}));
