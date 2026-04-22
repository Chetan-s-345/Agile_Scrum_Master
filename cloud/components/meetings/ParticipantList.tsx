"use client";

import { useParticipants } from "@livekit/components-react";
import { Users } from "lucide-react";

export function ParticipantList() {
  const participants = useParticipants();

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-4">
      <div className="mb-3 flex items-center gap-2">
        <Users className="h-4 w-4 text-[var(--text-muted)]" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Participants</h3>
        <span className="ml-auto rounded-full bg-blue-500/20 px-2 py-0.5 text-xs font-medium text-blue-300">
          {participants.length}
        </span>
      </div>

      <div className="space-y-2">
        {participants.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">No participants yet</p>
        ) : (
          participants.map((participant) => (
            <div
              key={participant.identity}
              className="flex items-center gap-2 rounded-md bg-[var(--bg-secondary)] p-2 text-xs"
            >
              <div className="h-2 w-2 rounded-full bg-green-400" />
              <span className="text-[var(--text-primary)]">{participant.name || participant.identity}</span>
              {participant.isSpeaking ? (
                <span className="ml-auto text-xs text-orange-400">🎤 Speaking</span>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
