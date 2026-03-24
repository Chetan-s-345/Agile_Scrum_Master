const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { orgDbMiddleware } = require('../middleware/orgDb');
const controller = require('../controllers/space.controller');

const router = express.Router();
router.use(authMiddleware, orgDbMiddleware);

router.get('/', controller.listSpaces);
router.patch('/reorder', controller.reorderSpaces);
router.patch('/:id/rename', controller.renameSpace);
router.post('/:id/duplicate', controller.duplicateSpace);
router.patch('/:id/archive', controller.archiveSpace);
router.patch('/:id/default', controller.setDefaultSpace);
router.delete('/:id', controller.deleteSpace);

module.exports = router;
