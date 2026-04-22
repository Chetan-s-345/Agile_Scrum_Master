const { z } = require('zod');

const uuidSchema = z.string().uuid();
const meetingTypeSchema = z.enum(['daily', 'planning', 'review', 'retro', 'weekly', 'retrospective', 'business']);
const meetingStatusSchema = z.enum(['scheduled', 'in_progress', 'completed', 'archived']);
const livekitJoinUrlRegex = /^(wss?:\/\/|https?:\/\/).+/i;

const listMeetingsQuerySchema = z.object({
  kind: z.enum(['session', 'room']).optional(),
  type: meetingTypeSchema.optional(),
  status: meetingStatusSchema.optional(),
  sprintId: uuidSchema.optional(),
  projectId: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const meetingIdParamsSchema = z.object({
  meetingId: uuidSchema,
});

const createMeetingSchema = z.object({
  type: meetingTypeSchema,
  title: z.string().min(2).max(300),
  sprintId: uuidSchema.optional(),
  projectId: uuidSchema.optional(),
  scheduledStart: z.string().min(1),
  scheduledEnd: z.string().min(1).optional(),
  description: z.string().max(20000).optional(),
  attendeeDeveloperIds: z.array(uuidSchema).max(200).optional(),
  createJoinUrl: z.boolean().optional(),
  provider: z.enum(['livekit', 'zoom', 'teams']).optional(),
});

const updateMeetingSchema = z
  .object({
    title: z.string().min(2).max(300).optional(),
    status: meetingStatusSchema.optional(),
    scheduledStart: z.string().min(1).optional(),
    scheduledEnd: z.string().min(1).optional(),
    description: z.string().max(20000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'No fields to update' });

const setMeetingAttendeesSchema = z.object({
  attendeeDeveloperIds: z.array(uuidSchema).max(500),
});

const createMeetingNoteSchema = z.object({
  content: z.string().min(1).max(40000),
  isAiGenerated: z.boolean().optional(),
});

const updateMeetingDescriptionSchema = z.object({
  description: z.string().max(40000).optional(),
  sourceText: z.string().max(40000).optional(),
  autoGenerate: z.boolean().optional(),
});

const startMeetingSchema = z
  .object({
    provider: z.enum(['livekit', 'zoom', 'teams']).optional(),
    providerMeetingId: z.string().max(200).optional(),
    joinUrl: z.string().url().max(1200).optional(),
  })
  .superRefine((value, ctx) => {
    const provider = value.provider || 'livekit';
    const joinUrl = String(value.joinUrl || '').trim();
    if (provider === 'livekit' && joinUrl && !livekitJoinUrlRegex.test(joinUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['joinUrl'],
        message: 'joinUrl must be a valid ws://, wss://, or https:// URL when provider is livekit.',
      });
    }
  });

const uploadMeetingTranscriptSchema = z.object({
  sourceType: z.enum(['manual_upload', 'livekit', 'zoom', 'teams', 'other']).optional(),
  fileName: z.string().max(260).optional(),
  mimeType: z.string().max(120).optional(),
  language: z.string().max(20).optional(),
  transcriptText: z.string().min(1).max(200000),
  speakerSegments: z
    .array(
      z.object({
        speaker: z.string().max(120).optional(),
        start: z.number().min(0).optional(),
        end: z.number().min(0).optional(),
        text: z.string().max(5000).optional(),
      })
    )
    .max(10000)
    .optional(),
});

const summarizeMeetingSchema = z.object({
  sourceText: z.string().max(200000).optional(),
  includeNotes: z.boolean().optional(),
  updateDescription: z.boolean().optional(),
});

const meetingRoomNameSchema = z
  .string()
  .min(3)
  .max(180)
  .regex(/^[a-zA-Z0-9._:-]+$/, 'roomName contains unsupported characters');

const createMeetingRoomTokenSchema = z.object({
  roomName: meetingRoomNameSchema,
  participantName: z.string().min(1).max(120),
});

const createMeetingRoomSchema = z.object({
  roomName: meetingRoomNameSchema,
});

const meetingRoomParamsSchema = z.object({
  roomName: meetingRoomNameSchema,
});

const saveMeetingRoomTranscriptSchema = z.object({
  transcript: z.string().min(1).max(500000),
});

const meetingRoomParticipantIdParamsSchema = z.object({
  roomName: meetingRoomNameSchema,
  participantId: z.string().uuid(),
});

const joinMeetingRoomSchema = z.object({
  participantName: z.string().min(1).max(120),
  identity: z.string().max(200).optional(),
  role: z.string().min(1).max(40).optional(),
});

const leaveMeetingRoomSchema = z.object({
  userId: z.string().min(1).max(120).optional(),
});

const updateMeetingRoomParticipantSchema = z
  .object({
    role: z.string().min(1).max(40).optional(),
    status: z.enum(['active', 'left', 'removed']).optional(),
    participationNotes: z.string().max(5000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'No participant fields to update' });

const generateIndividualMeetingRoomSummarySchema = z.object({
  participantId: z.string().uuid().optional(),
  focus: z.string().max(800).optional(),
});

module.exports = {
  listMeetingsQuerySchema,
  meetingIdParamsSchema,
  createMeetingSchema,
  updateMeetingSchema,
  setMeetingAttendeesSchema,
  createMeetingNoteSchema,
  updateMeetingDescriptionSchema,
  startMeetingSchema,
  uploadMeetingTranscriptSchema,
  summarizeMeetingSchema,
  createMeetingRoomTokenSchema,
  createMeetingRoomSchema,
  meetingRoomParamsSchema,
  saveMeetingRoomTranscriptSchema,
  meetingRoomParticipantIdParamsSchema,
  joinMeetingRoomSchema,
  leaveMeetingRoomSchema,
  updateMeetingRoomParticipantSchema,
  generateIndividualMeetingRoomSummarySchema,
};
