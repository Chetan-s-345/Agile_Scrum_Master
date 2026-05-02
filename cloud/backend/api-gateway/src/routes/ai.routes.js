const express = require('express');

const { authMiddleware } = require('../middleware/auth');
const { orgDbMiddleware } = require('../middleware/orgDb');

const aiController = require('../controllers/ai.controller');

const router = express.Router();
router.use(authMiddleware);

// Scope finalization (AutoGen) + assignment optimization (LangGraph)
router.post('/sprint-planning/scope', aiController.finalizeScope);
router.post('/sprint-planning/plan', aiController.planSprint);

// Autonomous planning and intelligence
router.get('/sprint-plan', orgDbMiddleware, aiController.sprintPlan);
router.post('/sprint-plan/start', orgDbMiddleware, aiController.startSprintPlan);
router.post('/rebalance', orgDbMiddleware, aiController.rebalance);
router.get('/briefing', orgDbMiddleware, aiController.briefing);

// Agentic: project details -> generated backlog -> plan/assign
router.post('/agentic/sprint-build', aiController.agenticSprintBuild);

// Autonomous command-center endpoints
router.post('/autonomous/autopilot', aiController.autonomousAutopilot);
router.post('/autonomous/team-rebalance', aiController.autonomousTeamRebalance);
router.post('/autonomous/briefing', aiController.autonomousBriefing);

// GitNexus repository intelligence
router.post('/git-nexus/analyze', aiController.gitNexusAnalyze);
router.get('/git-nexus/status', aiController.gitNexusStatus);
router.get('/git-nexus/tasks', aiController.gitNexusTasks);
router.post('/git-nexus/import-tasks', aiController.gitNexusImportTasks);

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

// RAG Chat + history
router.post('/chat', orgDbMiddleware, aiController.chat);
router.post('/confirm-action', orgDbMiddleware, aiController.confirmAction);
router.get('/history', orgDbMiddleware, aiController.history);

module.exports = router;
