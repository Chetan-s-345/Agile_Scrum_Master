const {
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
} = require('../validators/meetings.schemas');
const { meetingsService } = require('../services/meetings.service');

async function meetingsHealth(req, res) {
  void req;
  const payload = meetingsService.getHealth();
  return res.status(200).json(payload);
}

function validationError(res, parsed) {
  const flat = parsed.error.flatten();
  const firstField = Object.entries(flat.fieldErrors || {}).find(([, msgs]) => Array.isArray(msgs) && msgs.length);
  const firstMessage =
    (Array.isArray(flat.formErrors) && flat.formErrors[0]) ||
    (firstField ? `${firstField[0]}: ${firstField[1][0]}` : null) ||
    'Validation error';

  return res.status(400).json({ error: firstMessage, code: 400, detail: firstMessage, details: flat });
}

async function listMeetings(req, res, next) {
  try {
    const parsed = listMeetingsQuerySchema.safeParse(req.query || {});
    if (!parsed.success) return validationError(res, parsed);

    const items = await meetingsService.list(req, parsed.data);
    return res.status(200).json({ items });
  } catch (err) {
    return next(err);
  }
}

async function getMeeting(req, res, next) {
  try {
    const parsed = meetingIdParamsSchema.safeParse(req.params || {});
    if (!parsed.success) return validationError(res, parsed);

    const item = await meetingsService.getById(req, parsed.data.meetingId);
    if (!item) return res.status(404).json({ error: 'Meeting not found', code: 404, detail: 'Meeting not found' });

    return res.status(200).json({ item });
  } catch (err) {
    return next(err);
  }
}

async function createMeeting(req, res, next) {
  try {
    const parsed = createMeetingSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const item = await meetingsService.create(req, parsed.data);
    return res.status(201).json({ item });
  } catch (err) {
    return next(err);
  }
}

async function updateMeeting(req, res, next) {
  try {
    const parsedId = meetingIdParamsSchema.safeParse(req.params || {});
    if (!parsedId.success) return validationError(res, parsedId);

    const parsed = updateMeetingSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const item = await meetingsService.update(req, parsedId.data.meetingId, parsed.data);
    return res.status(200).json({ item });
  } catch (err) {
    return next(err);
  }
}

async function deleteMeeting(req, res, next) {
  try {
    const parsedId = meetingIdParamsSchema.safeParse(req.params || {});
    if (!parsedId.success) return validationError(res, parsedId);

    const result = await meetingsService.delete(req, parsedId.data.meetingId);
    return res.status(200).json({ item: result });
  } catch (err) {
    return next(err);
  }
}

async function setMeetingAttendees(req, res, next) {
  try {
    const parsedId = meetingIdParamsSchema.safeParse(req.params || {});
    if (!parsedId.success) return validationError(res, parsedId);

    const parsed = setMeetingAttendeesSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const item = await meetingsService.setAttendees(req, parsedId.data.meetingId, parsed.data.attendeeDeveloperIds);
    return res.status(200).json({ item });
  } catch (err) {
    return next(err);
  }
}

async function listMeetingNotes(req, res, next) {
  try {
    const parsedId = meetingIdParamsSchema.safeParse(req.params || {});
    if (!parsedId.success) return validationError(res, parsedId);

    const items = await meetingsService.listNotes(req, parsedId.data.meetingId);
    return res.status(200).json({ items });
  } catch (err) {
    return next(err);
  }
}

async function createMeetingNote(req, res, next) {
  try {
    const parsedId = meetingIdParamsSchema.safeParse(req.params || {});
    if (!parsedId.success) return validationError(res, parsedId);

    const parsed = createMeetingNoteSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const item = await meetingsService.addNote(req, parsedId.data.meetingId, parsed.data);
    return res.status(201).json({ item });
  } catch (err) {
    return next(err);
  }
}

async function updateMeetingDescription(req, res, next) {
  try {
    const parsedId = meetingIdParamsSchema.safeParse(req.params || {});
    if (!parsedId.success) return validationError(res, parsedId);

    const parsed = updateMeetingDescriptionSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const item = await meetingsService.updateDescription(req, parsedId.data.meetingId, parsed.data);
    return res.status(200).json({ item });
  } catch (err) {
    return next(err);
  }
}

async function startMeeting(req, res, next) {
  try {
    const parsedId = meetingIdParamsSchema.safeParse(req.params || {});
    if (!parsedId.success) return validationError(res, parsedId);

    const parsed = startMeetingSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const item = await meetingsService.startMeeting(req, parsedId.data.meetingId, parsed.data);
    return res.status(200).json({ item });
  } catch (err) {
    return next(err);
  }
}

async function listMeetingTranscripts(req, res, next) {
  try {
    const parsedId = meetingIdParamsSchema.safeParse(req.params || {});
    if (!parsedId.success) return validationError(res, parsedId);

    const items = await meetingsService.listTranscripts(req, parsedId.data.meetingId);
    return res.status(200).json({ items });
  } catch (err) {
    return next(err);
  }
}

async function uploadMeetingTranscript(req, res, next) {
  try {
    const parsedId = meetingIdParamsSchema.safeParse(req.params || {});
    if (!parsedId.success) return validationError(res, parsedId);

    const parsed = uploadMeetingTranscriptSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const item = await meetingsService.uploadTranscript(req, parsedId.data.meetingId, parsed.data);
    return res.status(201).json({ item });
  } catch (err) {
    return next(err);
  }
}

async function summarizeMeeting(req, res, next) {
  try {
    const parsedId = meetingIdParamsSchema.safeParse(req.params || {});
    if (!parsedId.success) return validationError(res, parsedId);

    const parsed = summarizeMeetingSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const item = await meetingsService.summarizeMeeting(req, parsedId.data.meetingId, parsed.data);
    return res.status(200).json({ item });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  meetingsHealth,
  listMeetings,
  getMeeting,
  createMeeting,
  updateMeeting,
  deleteMeeting,
  setMeetingAttendees,
  listMeetingNotes,
  createMeetingNote,
  updateMeetingDescription,
  startMeeting,
  listMeetingTranscripts,
  uploadMeetingTranscript,
  summarizeMeeting,
};
