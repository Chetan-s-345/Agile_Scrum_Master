const express = require('express');

const { authMiddleware } = require('../middleware/auth');

const aiController = require('../controllers/ai.controller');

const router = express.Router();
router.use(authMiddleware);

// Scope finalization (AutoGen) + assignment optimization (LangGraph)
router.post('/sprint-planning/scope', aiController.finalizeScope);
router.post('/sprint-planning/plan', aiController.planSprint);

// Agentic: project details -> generated backlog -> plan/assign
router.post('/agentic/sprint-build', aiController.agenticSprintBuild);

// Groq SSE streaming features
router.post('/ticket-enrichment/stream', aiController.ticketEnrichmentStream);
router.post('/standup-summarizer/stream', aiController.standupSummarizerStream);
router.post('/retrospective-generator/stream', aiController.retrospectiveGeneratorStream);
router.post('/risk-narrator/stream', aiController.riskNarratorStream);

// ML internal endpoints
router.post('/ml/merit/train', aiController.meritTrain);
router.post('/ml/merit/predict', aiController.meritPredict);

router.post('/ml/velocity/train', aiController.velocityTrain);
router.post('/ml/velocity/predict', aiController.velocityPredict);

router.post('/ml/complexity/train', aiController.complexityTrain);
router.post('/ml/complexity/predict', aiController.complexityPredict);

router.post('/ml/burndown/train', aiController.burndownTrain);
router.post('/ml/burndown/detect', aiController.burndownDetect);

module.exports = router;
