# AI Service

This directory contains the FastAPI-based AI service for the Automated Agentic Scrum Master (AASM) platform. It provides endpoints for agentic operations, machine learning inference, autonomous team management, and generative AI features.

## What is Implemented

Currently, the AI service implements the following capabilities:

### 1. Generative AI Features (Groq-powered)
- **Ticket Enrichment**: Streaming endpoints for enhancing and detailing task descriptions (`/ticket-enrichment`).
- **Standup Summarization**: Generating cohesive summaries from daily standup updates (`/standup-summarizer`).
- **Retrospective Generation**: Automated sprint retrospective insights (`/retrospective-generator`).
- **Risk Narration**: Narrative generation for potential sprint risks (`/risk-narrator`).

### 2. Machine Learning Core
- **Merit Scorer**: Predicts developer merit/suitability for tasks based on historical context (`/merit/predict`, `/merit/train`).
- **Velocity Predictor**: Forecasts team and individual velocity metrics (`/velocity/predict`, `/velocity/train`).
- **Complexity Classifier**: Uses NLP/Transformers to classify the complexity of tasks/user stories (`/complexity/predict`, `/complexity/train`).
- **Burndown Anomaly Detection**: Analyzes burndown patterns to identify anomalies and delivery drift (`/burndown/detect`, `/burndown/train`).

### 3. Agentic & Autonomous Workflows
- **Agentic Sprint Build**: Automated scoping and creation of sprint tasks (`/agentic-sprint/build`).
- **Autopilot**: Autonomous sprint steering and management.
- **Team Rebalancing**: Automated recommendations for rebalancing workload among team members.
- **Sprint Briefing**: Generation of sprint health and kickoff briefings.
- **Sprint Planning**: AI-assisted sprint planning and scope compilation.

### 4. Underlying Agents (Integration Layer)
- **Project Bootstrap Agent**: AutoGen-based orchestration to set up project schemas/scopes.
- **Sprint Scope Agent**: AutoGen-based orchestration to manage sprint workflows.
- **Sprint Planning Graph**: LangGraph/Agent-based graphs for coordinating planning logic.

## What is Next (Upcoming Implementation)

Based on the AASM architectural roadmap, the upcoming features inside the AI Service will focus on enhanced RAG, monitoring accuracy, and deep integrations:

1. **Task Generation Agent with RAG Pipeline**:
   - Expanding Duplicate Task Prevention using Pinecone Vector DB to prevent redundant GitHub issue conversions.
   - Injecting high-fidelity context for task proposals.
2. **Auto Assignment Agent Improvements**:
   - Refining the merit scorer with live load counters from Redis.
   - Deep skills-matching integration across tech stacks.
3. **Continuous Monitoring Agent**:
   - Live blocker detection loops triggered via Inngest.
   - SLA risk analysis and auto-reassignment workflows based on real-time task inactivity.
4. **Enhanced Feedback Loops**:
   - Allowing users to approve/reject AI assignments and retraining ML models dynamically from `/train` endpoints based on real feedback.

## Setup & Running
1. `pip install -r requirements.txt`
2. Configure `.env` based on `.env.example`
3. `uvicorn app.main:app --reload --port 8000`