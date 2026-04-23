const express = require('express');
const { z } = require('zod');
const { authMiddleware } = require('../middleware/auth');
const { orgDbMiddleware } = require('../middleware/orgDb');
const controller = require('../controllers/githubActivity.controller');
const {
	createIngestJob,
	getIngestJob,
	runIngestJob,
	clearRepoEmbeddings,
	getStoredGithubAccessToken,
} = require('../../server/lib/githubIngestion');

const router = express.Router();
router.use(authMiddleware, orgDbMiddleware);

router.post('/ingest', async (req, res, next) => {
	try {
		const bodySchema = z.object({
			projectId: z.string().uuid(),
			owner: z.string().min(1),
			repo: z.string().min(1),
		});
		const parsed = bodySchema.safeParse(req.body || {});
		if (!parsed.success) {
			return res.status(400).json({ error: 'Validation failed', code: 400, detail: 'projectId, owner, and repo are required.' });
		}

		const token = await getStoredGithubAccessToken(req.orgDb);
		const { projectId, owner, repo } = parsed.data;
		const jobId = createIngestJob({ projectId, owner, repo });

		void runIngestJob({ jobId, projectId, owner, repo, token });
		return res.status(202).json({ jobId });
	} catch (err) {
		return next(err);
	}
});

router.get('/ingest/:jobId', async (req, res) => {
	const jobId = String(req.params.jobId || '').trim();
	if (!jobId) {
		return res.status(400).json({ error: 'Invalid jobId', code: 400, detail: 'jobId is required.' });
	}
	const job = getIngestJob(jobId);
	if (!job) {
		return res.status(404).json({ error: 'Job not found', code: 404, detail: 'No ingestion job found for this id.' });
	}
	return res.status(200).json(job);
});

router.post('/ingest/:projectId/resync', async (req, res, next) => {
	try {
		const paramsSchema = z.object({ projectId: z.string().uuid() });
		const bodySchema = z.object({ owner: z.string().min(1).optional(), repo: z.string().min(1).optional() });

		const paramsParsed = paramsSchema.safeParse(req.params || {});
		if (!paramsParsed.success) {
			return res.status(400).json({ error: 'Validation failed', code: 400, detail: 'projectId must be a valid UUID.' });
		}
		const bodyParsed = bodySchema.safeParse(req.body || {});
		if (!bodyParsed.success) {
			return res.status(400).json({ error: 'Validation failed', code: 400, detail: 'owner and repo must be strings.' });
		}

		const projectId = paramsParsed.data.projectId;
		let owner = String(bodyParsed.data.owner || '').trim();
		let repo = String(bodyParsed.data.repo || '').trim();

		if (!owner || !repo) {
			const projectResp = await req.orgDb.query('SELECT github_repo FROM projects WHERE id = $1 LIMIT 1', [projectId]);
			const fullRepo = String(projectResp.rows[0]?.github_repo || '').trim();
			const [fallbackOwner, fallbackRepo] = fullRepo.split('/');
			owner = owner || String(fallbackOwner || '').trim();
			repo = repo || String(fallbackRepo || '').trim();
		}

		if (!owner || !repo) {
			return res.status(400).json({
				error: 'Repository not configured',
				code: 400,
				detail: 'Provide owner/repo in body or configure projects.github_repo as owner/repo.',
			});
		}

		const token = await getStoredGithubAccessToken(req.orgDb);
		await clearRepoEmbeddings(projectId);

		const jobId = createIngestJob({ projectId, owner, repo });
		void runIngestJob({ jobId, projectId, owner, repo, token });

		return res.status(202).json({ jobId });
	} catch (err) {
		return next(err);
	}
});

router.get('/overview', controller.overview);
router.get('/commits', controller.commits);
router.get('/pull-requests', controller.pullRequests);
router.get('/issues', controller.issues);
router.post('/issues', controller.createIssue);
router.get('/workflows', controller.workflows);
router.get('/branches', controller.branches);
router.post('/issues/:id/import', controller.importIssue);
router.post('/prs/:id/link-task', controller.linkTask);
router.delete('/branches/:repo/:branch', controller.deleteBranch);

module.exports = router;
