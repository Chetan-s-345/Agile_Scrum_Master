# AI Service Reference & Implementation Guide

This document is part of the Automated Agentic Scrum Master (AASM) platform documentation. It details the capabilities and roadmap of the FastAPI-based AI Service (`backend/ai-service`).

## 1. Overview and Architecture

The AI Service is the central intelligence hub of the AASM ecosystem. It processes structured and unstructured project data to power:
- Natural Language Generation (via Groq/LLMs)
- Autonomous Team Operations (Agentic frameworks, AutoGen)
- Predictive Machine Learning (Merit, Velocity, Complexity classification)

It acts as the backend processor called by the Next.js frontend (via REST API calls) and orchestrated asynchronously by Inngest.

## 2. Current Implementations

As of the current phase, the `ai-service` repository implements a robust set of features across routing, modeling, and autonomous agents:

### Generative Features (`routes/groq_features.py`)
- **Ticket Enrichment**: Enhances raw title or short descriptions into comprehensive Agile task structures via streaming.
- **Standup Summarization**: Takes raw developer notes and rolls them up into a concise chronological team standup.
- **Retrospective Generator**: Aggregates sprint notes, PR comments, and metrics into a sprint retrospective document.
- **Risk Narrator**: Produces warnings and explanations for why specific sprints/tasks are at risk.

### Agentic & Autonomous Core (`routes/autonomous.py`, `routes/agentic_sprint.py`)
- **Agentic Sprint Build (`/agentic-sprint/build`)**: Core endpoint for initializing self-driving sprint scopes.
- **Autopilot (`/autopilot`)**: Orchestration for continuous Agile operations.
- **Team Rebalance (`/team-rebalance`)**: Dynamic adjustments to assignment loads to prevent delivery risk.
- **Briefing (`/briefing`)**: Automated briefing generations combining team status.

### Machine Learning Pipelines (`routes/ml.py`, `ml/`)
- MLOps endpoints that offer both `train` and `predict` capabilities:
  - **Merit Scorer** (`app/ml/merit_scorer.py`): Recommends the best developer for a given task.
  - **Velocity Predictor** (`app/ml/velocity_predictor.py`): Estimates how rapidly a team will burn down tasks.
  - **Complexity Classifier** (`app/ml/complexity_classifier.py`): Classifies user story complexity (e.g., Fibonnaci scale).
  - **Burndown Anomaly** (`app/ml/burndown_anomaly.py`): Detects unusual project velocity slow-downs.

### Agents Layer (`agents/`)
- **AutoGen Scaffolding**: Setup for conversational AI agents predicting scopes (`autogen_project_bootstrap.py`, `autogen_sprint_scope.py`).
- **Sprint Planning Graph**: Logic for sprint mapping workflows (`sprint_planning_graph.py`).

## 3. Upcoming Implementations (Roadmap)

In reference to the overall AASM platform strategy (from the `aasm-project-bible.md`), the AI Service will next focus on deepening workflow integration, system reliability, and advanced ML use cases:

### A. Advanced RAG & Context Augmentation
- **Task Deduction**: Implementing the `Task Generation Agent` which reads commits, pull requests, and PR reviews. 
- **Duplicate Task Prevention**: Connecting Pinecone Vector search to identify if an incoming issue context already exists in the semantic space, preventing redundant ticket creation.

### B. Persistent Agent Monitoring
- **Monitoring Agent Deployment**: Deploying the monitoring script as a persistent service/cron worker connected to GitHub APIs to continuously score SLA risks and blocker tags without user prompts.
- **Auto Reassignment Logic**: Deep integration with Inngest to dynamically swap slow-moving or blocked tasks to appropriate engineers using the active ML Merit Scorer model in real-time.

### C. Enhanced LLM Orchestration
- **Pinecone Integrations**: Utilizing `text-embedding-3-small` from OpenAI or equivalent embeddings to better retrieve project historical data for the Prompts utilized by Groq endpoints.
- **Confidence Scoring for Agent Actions**: Incorporating confidence thresholds before the Autopilot agent executes write actions (like moving a ticket across columns).

### D. Model Training Pipelines
- Solidifying the persistence loop for `train` endpoints. Storing user approvals and rejections into PostgreSQL training tables, and fine-tuning models on a chron job to build personalized team AI algorithms.

## 4. Environment and Dependencies

The service uses Python 3.10+ and standard FastAPI architecture:
- **Framework**: `FastAPI` + `Uvicorn`
- **Data Layers**: Interfaces with `Redis` and `PostgreSQL` (via `asyncpg` / generic DB routers).
- **ML Tooling**: `torch`, `transformers`, `scikit-learn` integration pathways for complexity models.
- **Agents**: Uses `pyautogen`.

### Starting the Service
```bash
cd backend/ai-service
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```