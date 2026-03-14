const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { orgDbMiddleware } = require('../middleware/orgDb');

const developerController = require('../controllers/developer.controller');

const router = express.Router();
router.use(authMiddleware, orgDbMiddleware);

router.get('/', developerController.listDevelopers);
router.get('/leaderboard', developerController.leaderboard);
router.get('/:developerId', developerController.getDeveloper);
router.post('/', developerController.createDeveloper);
router.patch('/:developerId', developerController.updateDeveloper);
router.get('/:developerId/availability', developerController.getAvailability);
router.post('/:developerId/availability', developerController.addAvailability);
router.delete('/:developerId/availability/:availabilityId', developerController.deleteAvailability);
router.get('/:developerId/performance', developerController.performance);

module.exports = router;
