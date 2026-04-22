const express = require('express');

const { authMiddleware } = require('../middleware/auth');
const { orgDbMiddleware } = require('../middleware/orgDb');
const meetingsController = require('../controllers/meetings.controller');

const router = express.Router();
router.get('/health', meetingsController.meetingsHealth);
router.use(authMiddleware, orgDbMiddleware);

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
