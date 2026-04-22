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
  createMeetingRoomTokenSchema,
  createMeetingRoomSchema,
  meetingRoomParamsSchema,
  saveMeetingRoomTranscriptSchema,
  meetingRoomParticipantIdParamsSchema,
  joinMeetingRoomSchema,
  leaveMeetingRoomSchema,
  updateMeetingRoomParticipantSchema,
  generateIndividualMeetingRoomSummarySchema,
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

    if (parsed.data.kind === 'room') {
      const items = await meetingsService.listMeetingRooms(req);
      return res.status(200).json({ items });
    }

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

async function createMeetingRoomToken(req, res, next) {
  try {
    const parsed = createMeetingRoomTokenSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const item = await meetingsService.createMeetingRoomToken(req, parsed.data);
    return res.status(200).json(item);
  } catch (err) {
    return next(err);
  }
}

async function createMeetingRoom(req, res, next) {
  try {
    const parsed = createMeetingRoomSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const item = await meetingsService.createMeetingRoom(req, parsed.data);
    return res.status(201).json({ item });
  } catch (err) {
    return next(err);
  }
}

async function saveMeetingRoomTranscript(req, res, next) {
  try {
    const parsedParams = meetingRoomParamsSchema.safeParse(req.params || {});
    if (!parsedParams.success) return validationError(res, parsedParams);

    const parsed = saveMeetingRoomTranscriptSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const result = await meetingsService.saveMeetingRoomTranscript(req, {
      roomName: parsedParams.data.roomName,
      transcript: parsed.data.transcript,
    });
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function joinMeetingRoomParticipant(req, res, next) {
  try {
    const parsedParams = meetingRoomParamsSchema.safeParse(req.params || {});
    if (!parsedParams.success) return validationError(res, parsedParams);

    const parsed = joinMeetingRoomSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const item = await meetingsService.joinMeetingRoomParticipant(req, {
      roomName: parsedParams.data.roomName,
      participantName: parsed.data.participantName,
      identity: parsed.data.identity,
      role: parsed.data.role,
    });
    return res.status(200).json({ item });
  } catch (err) {
    return next(err);
  }
}

async function listMeetingRoomParticipants(req, res, next) {
  try {
    const parsedParams = meetingRoomParamsSchema.safeParse(req.params || {});
    if (!parsedParams.success) return validationError(res, parsedParams);

    const items = await meetingsService.listMeetingRoomParticipants(req, parsedParams.data.roomName);
    return res.status(200).json({ items });
  } catch (err) {
    return next(err);
  }
}

async function updateMeetingRoomParticipant(req, res, next) {
  try {
    const parsedParams = meetingRoomParticipantIdParamsSchema.safeParse(req.params || {});
    if (!parsedParams.success) return validationError(res, parsedParams);

    const parsed = updateMeetingRoomParticipantSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const item = await meetingsService.updateMeetingRoomParticipant(
      req,
      parsedParams.data.roomName,
      parsedParams.data.participantId,
      parsed.data
    );
    return res.status(200).json({ item });
  } catch (err) {
    return next(err);
  }
}

async function removeMeetingRoomParticipant(req, res, next) {
  try {
    const parsedParams = meetingRoomParticipantIdParamsSchema.safeParse(req.params || {});
    if (!parsedParams.success) return validationError(res, parsedParams);

    const item = await meetingsService.removeMeetingRoomParticipant(
      req,
      parsedParams.data.roomName,
      parsedParams.data.participantId
    );
    return res.status(200).json({ item });
  } catch (err) {
    return next(err);
  }
}

async function leaveMeetingRoomParticipant(req, res, next) {
  try {
    const parsedParams = meetingRoomParamsSchema.safeParse(req.params || {});
    if (!parsedParams.success) return validationError(res, parsedParams);

    const parsed = leaveMeetingRoomSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const item = await meetingsService.leaveMeetingRoomParticipant(req, parsedParams.data.roomName, parsed.data);
    return res.status(200).json({ item });
  } catch (err) {
    return next(err);
  }
}

async function generateIndividualMeetingRoomSummary(req, res, next) {
  try {
    const parsedParams = meetingRoomParamsSchema.safeParse(req.params || {});
    if (!parsedParams.success) return validationError(res, parsedParams);

    const parsed = generateIndividualMeetingRoomSummarySchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const item = await meetingsService.generateIndividualMeetingRoomSummary(req, {
      roomName: parsedParams.data.roomName,
      participantId: parsed.data.participantId,
      focus: parsed.data.focus,
    });
    return res.status(200).json({ item });
  } catch (err) {
    return next(err);
  }
}

async function listIndividualMeetingRoomSummaries(req, res, next) {
  try {
    const parsedParams = meetingRoomParamsSchema.safeParse(req.params || {});
    if (!parsedParams.success) return validationError(res, parsedParams);

    const items = await meetingsService.listMeetingRoomIndividualSummaries(req, parsedParams.data.roomName);
    return res.status(200).json({ items });
  } catch (err) {
    return next(err);
  }
}

async function endMeetingRoom(req, res, next) {
  try {
    const parsedParams = meetingRoomParamsSchema.safeParse(req.params || {});
    if (!parsedParams.success) return validationError(res, parsedParams);

    const item = await meetingsService.endMeetingRoom(req, parsedParams.data.roomName);
    return res.status(200).json({ item });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  meetingsHealth,
  createMeetingRoomToken,
  createMeetingRoom,
  joinMeetingRoomParticipant,
  listMeetingRoomParticipants,
  updateMeetingRoomParticipant,
  removeMeetingRoomParticipant,
  leaveMeetingRoomParticipant,
  saveMeetingRoomTranscript,
  generateIndividualMeetingRoomSummary,
  listIndividualMeetingRoomSummaries,
  endMeetingRoom,
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
