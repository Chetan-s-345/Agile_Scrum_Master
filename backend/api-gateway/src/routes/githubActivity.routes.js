const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { orgDbMiddleware } = require('../middleware/orgDb');
const controller = require('../controllers/githubActivity.controller');

const router = express.Router();
router.use(authMiddleware, orgDbMiddleware);

router.get('/overview', controller.overview);
router.get('/commits', controller.commits);
router.get('/pull-requests', controller.pullRequests);
router.get('/issues', controller.issues);
router.get('/workflows', controller.workflows);
router.get('/branches', controller.branches);
router.post('/issues/:id/import', controller.importIssue);
router.post('/prs/:id/link-task', controller.linkTask);
router.delete('/branches/:repo/:branch', controller.deleteBranch);

module.exports = router;
