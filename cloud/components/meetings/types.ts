export type MeetingRoomItem = {
  id: string;
  orgId: string;
  roomName: string;
  createdBy: string;
  transcript: string;
  summary: string;
  mySummary?: string;
  mySummaryGeneratedAt?: string | null;
  status: string;
  createdAt: string;
  endedAt?: string | null;
};

export type MeetingRoomParticipant = {
  id: string;
  roomId: string;
  orgId: string;
  userId: string;
  participantName: string;
  identity?: string | null;
  role: string;
  status: "active" | "left" | "removed";
  joinedAt: string;
  leftAt?: string | null;
  lastSeenAt: string;
  participationNotes?: string;
};

export type IndividualMeetingSummary = {
  id: string;
  roomId: string;
  participantId?: string | null;
  userId: string;
  participantName: string;
  summary: string;
  actionItems?: string;
  generatedAt: string;
  updatedAt: string;
};
