const express = require('express');

const { authMiddleware } = require('../middleware/auth');
const { orgDbMiddleware } = require('../middleware/orgDb');
const meetingsController = require('../controllers/meetings.controller');

const router = express.Router();
router.get('/health', meetingsController.meetingsHealth);
router.use(authMiddleware, orgDbMiddleware);

router.post('/token', meetingsController.createMeetingRoomToken);
router.post('/create', meetingsController.createMeetingRoom);
router.post('/:roomName/participants/join', meetingsController.joinMeetingRoomParticipant);
router.post('/:roomName/participants/leave', meetingsController.leaveMeetingRoomParticipant);
router.get('/:roomName/participants', meetingsController.listMeetingRoomParticipants);
router.patch('/:roomName/participants/:participantId', meetingsController.updateMeetingRoomParticipant);
router.delete('/:roomName/participants/:participantId', meetingsController.removeMeetingRoomParticipant);
router.post('/:roomName/transcript', meetingsController.saveMeetingRoomTranscript);
router.post('/:roomName/summaries/individual', meetingsController.generateIndividualMeetingRoomSummary);
router.get('/:roomName/summaries/individual', meetingsController.listIndividualMeetingRoomSummaries);
router.post('/:roomName/end', meetingsController.endMeetingRoom);

router.get('/', meetingsController.listMeetings);
router.post('/', meetingsController.createMeeting);
router.get('/:meetingId', meetingsController.getMeeting);
router.patch('/:meetingId', meetingsController.updateMeeting);
router.put('/:meetingId', meetingsController.updateMeeting);
router.delete('/:meetingId', meetingsController.deleteMeeting);
router.post('/:meetingId/attendees', meetingsController.setMeetingAttendees);
router.get('/:meetingId/notes', meetingsController.listMeetingNotes);
router.post('/:meetingId/notes', meetingsController.createMeetingNote);
router.post('/:meetingId/description', meetingsController.updateMeetingDescription);
router.post('/:meetingId/start', meetingsController.startMeeting);
router.get('/:meetingId/transcripts', meetingsController.listMeetingTranscripts);
router.post('/:meetingId/transcripts', meetingsController.uploadMeetingTranscript);
router.post('/:meetingId/summarize', meetingsController.summarizeMeeting);

module.exports = router;
