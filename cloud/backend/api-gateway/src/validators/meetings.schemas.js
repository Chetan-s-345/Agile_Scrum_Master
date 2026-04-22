const { z } = require('zod');

const uuidSchema = z.string().uuid();
const meetingTypeSchema = z.enum(['daily', 'planning', 'review', 'retro', 'weekly', 'retrospective', 'business']);
const meetingStatusSchema = z.enum(['scheduled', 'in_progress', 'completed', 'archived']);
const dailyJoinUrlRegex = /^https:\/\/[a-z0-9-]+\.daily\.co\/[a-z0-9-]+(?:[/?#].*)?$/i;

const listMeetingsQuerySchema = z.object({
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
  provider: z.enum(['daily', 'zoom', 'teams']).optional(),
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
    provider: z.enum(['daily', 'zoom', 'teams']).optional(),
    providerMeetingId: z.string().max(200).optional(),
    joinUrl: z.string().url().max(1200).optional(),
  })
  .superRefine((value, ctx) => {
    const provider = value.provider || 'daily';
    const joinUrl = String(value.joinUrl || '').trim();
    if (provider === 'daily' && joinUrl && !dailyJoinUrlRegex.test(joinUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['joinUrl'],
        message: 'joinUrl must be a valid https://*.daily.co/... URL when provider is daily.',
      });
    }
  });

const uploadMeetingTranscriptSchema = z.object({
  sourceType: z.enum(['manual_upload', 'daily', 'zoom', 'teams', 'other']).optional(),
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
};
