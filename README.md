<div align="center">

<!-- Animated Header Banner -->
<img width="100%" src="https://capsule-render.vercel.app/api?type=waving&color=0:0D1B2A,50:2563EB,100:06B6D4&height=200&section=header&text=AI%20Sprint%20Manager&fontSize=52&fontColor=ffffff&fontAlignY=38&desc=Agentic%20Scrum%20Master%20with%20Jira%20Integration&descAlignY=60&descSize=18&animation=fadeIn" />

<br/>

<!-- Badges Row 1 -->
[![Made With Love](https://img.shields.io/badge/Made%20with-%E2%9D%A4-red?style=for-the-badge)](https://github.com/deekshithgowda85)
[![AI Powered](https://img.shields.io/badge/AI-Powered-2563EB?style=for-the-badge&logo=openai&logoColor=white)](https://github.com/deekshithgowda85/ai-sprint-manager)
[![License MIT](https://img.shields.io/badge/License-MIT-06B6D4?style=for-the-badge)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-Welcome-10B981?style=for-the-badge)](CONTRIBUTING.md)

<!-- Badges Row 2 -->
[![Next.js](https://img.shields.io/badge/Next.js-14-black?style=for-the-badge&logo=nextdotjs)](https://nextjs.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-Python-009688?style=for-the-badge&logo=fastapi)](https://fastapi.tiangolo.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Database-336791?style=for-the-badge&logo=postgresql&logoColor=white)](https://postgresql.org)
[![Docker](https://img.shields.io/badge/Docker-Containerized-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://docker.com)

<br/>

<!-- Stats Badges -->
![GitHub Stars](https://img.shields.io/github/stars/deekshithgowda85/Agile_Scrum_Master?style=social)
![GitHub Forks](https://img.shields.io/github/forks/deekshithgowda85/Agile_Scrum_Master?style=social)
![GitHub Watchers](https://img.shields.io/github/watchers/deekshithgowda85/Agile_Scrum_Master?style=social)
![GitHub Issues](https://img.shields.io/github/issues/deekshithgowda85/Agile_Scrum_Masterai-sprint-manager?color=red)
![GitHub Last Commit](https://img.shields.io/github/last-commit/deekshithgowda85/Agile_Scrum_Master?color=2563EB)

</div>

---

## 🧠 What Is AI Sprint Manager?

> **AI Sprint Manager** is an intelligent, multi-agent system that acts as a **virtual Scrum Master** — automating every Agile workflow from sprint planning to retrospective reporting. It connects deeply with **Jira**, **GitHub**, and **Slack** to eliminate manual coordination and make your engineering team **2x more efficient**.

Instead of humans manually planning sprints, estimating story points, assigning tasks, and writing reports — **AI agents do it all**, continuously and autonomously.

<br/>

<div align="center">

```
Product Manager writes requirement
           ↓
Requirement Agent parses intent
           ↓
Task Generator creates user stories
           ↓
Story Point Estimator assigns complexity
           ↓
Assignment Agent picks best developer  ←── Merit Score + Availability + Tech Stack
           ↓
Sprint Monitor tracks progress daily
           ↓
Delay Predictor fires early alerts
           ↓
Reporting Agent generates sprint summary
           ↓
Jira Sync Agent updates everything automatically
```

</div>

---

## ✨ Key Features

<table>
<tr>
<td width="50%">

### 🎯 Auto Employee Selector
Automatically assigns the **right developer** to every task based on:
- ✅ Verified tech stack match
- ✅ Real-time availability check
- ✅ Merit score ranking
- ✅ Current workload balancing

</td>
<td width="50%">

### 📋 Sprint Auto-Planner
Selects which backlog tasks go into the next sprint automatically:
- ✅ Business priority scoring
- ✅ Dependency mapping
- ✅ Team capacity awareness
- ✅ One-click plan confirmation

</td>
</tr>
<tr>
<td width="50%">

### 🧩 Requirement-to-Story Converter
PM writes one line → AI generates full Agile stories:
- ✅ LLM-powered understanding
- ✅ Auto-generated acceptance criteria
- ✅ Sub-task breakdown
- ✅ Direct push to Jira backlog

</td>
<td width="50%">

### 📏 Story Point Estimator
Predicts task complexity using ML on your team's history:
- ✅ XGBoost regression model
- ✅ Fibonacci scale output (1–13)
- ✅ Trained on your sprint data
- ✅ Auto-improves each sprint

</td>
</tr>
<tr>
<td width="50%">

### ⚠️ Delay Predictor
Warns about sprint delays **before** they happen:
- ✅ Daily velocity monitoring
- ✅ GitHub commit + PR tracking
- ✅ Specific corrective suggestions
- ✅ Auto Jira sprint adjustment

</td>
<td width="50%">

### 🔥 Burnout Detector
Protects developers from overload:
- ✅ Multi-sprint workload tracking
- ✅ Auto-reduces assignment weight
- ✅ Private manager alerts
- ✅ Sustainable capacity planning

</td>
</tr>
<tr>
<td width="50%">

### 🎙️ Standup Summarizer
Turns standups into structured logs automatically:
- ✅ Slack channel integration
- ✅ LLM blocker extraction
- ✅ Auto Jira blocker tickets
- ✅ Sprint activity archive

</td>
<td width="50%">

### 📊 Auto Sprint Reporter
Zero-effort sprint reports at every sprint end:
- ✅ Velocity and burndown charts
- ✅ Bottleneck analysis
- ✅ Team productivity metrics
- ✅ PDF or Confluence export

</td>
</tr>
<tr>
<td width="50%">

### 🏆 Merit Leaderboard
Transparent, data-driven developer performance:
- ✅ Auto-updated after every sprint
- ✅ Trend tracking (up/down/stable)
- ✅ Fair and bias-free scoring
- ✅ Priority on high-visibility tasks

</td>
<td width="50%">

### 🔄 Self-Learning Model
The AI gets smarter after every sprint:
- ✅ Automated model retraining
- ✅ Prediction accuracy tracking
- ✅ Model version management
- ✅ Zero manual retraining needed

</td>
</tr>
</table>

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AI SPRINT MANAGER                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌─────────────┐     ┌──────────────────────────────────────────┐ │
│   │  Next.js 14 │     │           Multi-Agent Core               │ │
│   │  Dashboard  │────▶│                                          │ │
│   │  Tailwind   │     │  ┌──────────┐    ┌────────────────────┐ │ │
│   │  Chart.js   │     │  │Requirement│───▶│  Task Generator    │ │ │
│   └─────────────┘     │  │  Agent   │    │      Agent         │ │ │
│                        │  └──────────┘    └────────────────────┘ │ │
│   ┌─────────────┐     │        │                  │              │ │
│   │   Node.js   │     │        ▼                  ▼              │ │
│   │  API Gateway│     │  ┌──────────┐    ┌────────────────────┐ │ │
│   │   Express   │────▶│  │Story Pt. │    │   Assignment       │ │ │
│   └─────────────┘     │  │Estimator │    │     Agent          │ │ │
│                        │  └──────────┘    └────────────────────┘ │ │
│   ┌─────────────┐     │        │                  │              │ │
│   │   FastAPI   │     │        ▼                  ▼              │ │
│   │ AI Services │────▶│  ┌──────────┐    ┌────────────────────┐ │ │
│   │  LangChain  │     │  │  Sprint  │    │    Reporting       │ │ │
│   └─────────────┘     │  │ Monitor  │    │      Agent         │ │ │
│                        │  └──────────┘    └────────────────────┘ │ │
│   ┌─────────────┐     │        │                  │              │ │
│   │  PostgreSQL │     │        └──────────┬────────┘             │ │
│   │    Redis    │     │                   ▼                      │ │
│   │    ES       │     │         ┌─────────────────┐             │ │
│   └─────────────┘     │         │  Jira Sync Agent│             │ │
│                        │         └─────────────────┘             │ │
│                        └──────────────────────────────────────────┘ │
│                                        │                            │
│                        ┌───────────────▼─────────────────────────┐ │
│                        │          External Integrations           │ │
│                        │   Jira API  │  GitHub API  │  Slack API  │ │
│                        └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🤖 Smart Assignment Engine

The flagship feature — when a task is created, the engine automatically finds and assigns the **perfect developer** in milliseconds.

### Merit Score Formula

```
Merit Score (0–100) =
  Tech Stack Match    × 25%   (verified skill alignment)
+ Completion Rate     × 25%   (% of tasks finished on time)
+ Code Quality Score  × 20%   (SonarQube + PR feedback)
+ PR Review Speed     × 15%   (inverse of avg merge hours)
+ Peer Rating         × 15%   (anonymous retrospective score)
```

### Assignment Flow

```
New Task Created
      │
      ▼
┌─────────────────────────────────────────────────────┐
│  Step 1: Tech Stack Filter                          │
│  → Keep only devs whose skills match task tags      │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│  Step 2: Availability Check                         │
│  → Remove devs on leave or at full capacity         │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│  Step 3: Merit Score Ranking                        │
│  → Sort eligible devs by merit score DESC           │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│  Step 4: Workload Balancing                         │
│  → Pick top-ranked dev with most remaining capacity  │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│  Step 5: Auto Assignment                            │
│  → Update Jira + Notify Slack + Log Decision        │
└─────────────────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

<div align="center">

### Frontend
![Next.js](https://img.shields.io/badge/Next.js_14-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)
![Chart.js](https://img.shields.io/badge/Chart.js-FF6384?style=for-the-badge&logo=chartdotjs&logoColor=white)
![Zustand](https://img.shields.io/badge/Zustand-State-brown?style=for-the-badge)

### Backend
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![Python](https://img.shields.io/badge/Python_3.11-3776AB?style=for-the-badge&logo=python&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)

### AI & ML
![OpenAI](https://img.shields.io/badge/OpenAI_GPT--4-412991?style=for-the-badge&logo=openai&logoColor=white)
![LangChain](https://img.shields.io/badge/LangChain-1C3C3C?style=for-the-badge&logo=langchain&logoColor=white)
![scikit-learn](https://img.shields.io/badge/scikit--learn-F7931E?style=for-the-badge&logo=scikitlearn&logoColor=white)
![XGBoost](https://img.shields.io/badge/XGBoost-ML-blue?style=for-the-badge)

### Database & Storage
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-336791?style=for-the-badge&logo=postgresql&logoColor=white)
![Elasticsearch](https://img.shields.io/badge/Elasticsearch-005571?style=for-the-badge&logo=elasticsearch&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white)

### DevOps & Integrations
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-2088FF?style=for-the-badge&logo=githubactions&logoColor=white)
![Jira](https://img.shields.io/badge/Jira-0052CC?style=for-the-badge&logo=jira&logoColor=white)
![Slack](https://img.shields.io/badge/Slack-4A154B?style=for-the-badge&logo=slack&logoColor=white)

</div>

---

## 📁 Project Structure

```
ai-sprint-manager/
├── 📁 frontend/                    # Next.js 14 App
│   ├── app/
│   │   ├── dashboard/              # Main sprint dashboard
│   │   ├── sprint/plan/            # Sprint planner
│   │   ├── tasks/                  # Kanban task board
│   │   ├── developers/             # Developer hub & leaderboard
│   │   ├── assign/                 # Assignment engine UI
│   │   ├── reports/                # Sprint reports viewer
│   │   └── settings/               # Configuration
│   ├── components/                 # Reusable UI components
│   └── lib/                        # API clients & utilities
│
├── 📁 backend/
│   ├── api-gateway/                # Node.js Express gateway
│   │   ├── routes/
│   │   ├── middleware/
│   │   └── webhooks/               # Jira + GitHub webhook handlers
│   └── ai-service/                 # Python FastAPI
│       ├── agents/
│       │   ├── requirement_agent.py
│       │   ├── task_generator.py
│       │   ├── story_point_estimator.py
│       │   ├── assignment_agent.py  ← Core feature
│       │   ├── sprint_monitor.py
│       │   ├── reporting_agent.py
│       │   └── jira_sync_agent.py
│       ├── models/                 # ML model files
│       └── services/               # Jira, GitHub, Slack clients
│
├── 📁 database/
│   ├── migrations/                 # Prisma migrations
│   └── seeds/                      # Sample developer data
│
├── 📁 ml/
│   ├── train_story_points.py       # XGBoost training script
│   ├── train_delay_predictor.py    # Delay classification model
│   └── retrain_pipeline.py         # Self-learning retraining job
│
├── 📁 docker/
│   ├── docker-compose.yml
│   ├── docker-compose.prod.yml
│   └── Dockerfile.*
│
└── 📁 docs/
    ├── API.md
    ├── ARCHITECTURE.md
    └── DEPLOYMENT.md
```

---

## 🚀 Getting Started

### Prerequisites

```bash
node >= 18.0.0
python >= 3.11
docker >= 24.0.0
docker-compose >= 2.0.0
```

### 1. Clone the Repository

```bash
git clone https://github.com/deekshithgowda85/ai-sprint-manager.git
cd ai-sprint-manager
```

### 2. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Jira
JIRA_BASE_URL=https://yourcompany.atlassian.net
JIRA_EMAIL=your@email.com
JIRA_API_TOKEN=your_jira_api_token
JIRA_PROJECT_KEY=PROJ

# GitHub
GITHUB_TOKEN=your_github_token
GITHUB_WEBHOOK_SECRET=your_webhook_secret

# AI APIs
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/sprint_manager
REDIS_URL=redis://localhost:6379

# Slack
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_STANDUP_CHANNEL=standup
```

### 3. Start with Docker (Recommended)

```bash
docker-compose up --build
```

Services started:
| Service | URL |
|---|---|
| Frontend Dashboard | http://localhost:3000 |
| API Gateway | http://localhost:4000 |
| AI Service | http://localhost:8000 |
| API Docs (Swagger) | http://localhost:8000/docs |

### 4. Manual Setup (Development)

```bash
# Frontend
cd frontend
npm install
npm run dev

# API Gateway
cd backend/api-gateway
npm install
npm run dev

# AI Service
cd backend/ai-service
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Database migrations
cd backend/api-gateway
npx prisma migrate dev
npx prisma db seed
```

---

## 📡 API Reference

### Developer Assignment

```http
POST /api/tasks/assign
Content-Type: application/json

{
  "task_id": "PROJ-123",
  "title": "Build OAuth login UI",
  "tech_tags": ["React", "TypeScript"],
  "story_points": 3,
  "priority": "high",
  "sprint_id": "sprint-42"
}
```

**Response:**
```json
{
  "assigned_to": {
    "developer_id": "DEV_042",
    "name": "Alice Kumar",
    "merit_score": 87.4,
    "tech_match": "100%",
    "remaining_capacity": 8
  },
  "jira_updated": true,
  "slack_notified": true,
  "assignment_reason": "Highest merit score among 3 matched React developers"
}
```

### Sprint Planning

```http
POST /api/sprints/plan
Content-Type: application/json

{
  "sprint_name": "Sprint 43",
  "start_date": "2025-01-20",
  "end_date": "2025-02-03"
}
```

### Generate Stories from Requirement

```http
POST /api/tasks/generate
Content-Type: application/json

{
  "requirement": "Add Google OAuth login with remember me functionality",
  "project_key": "PROJ"
}
```

---

## 🗄️ Database Schema

```sql
-- Core tables (simplified)

CREATE TABLE developers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(100) NOT NULL,
  email           VARCHAR(150) UNIQUE NOT NULL,
  tech_stack      TEXT[],
  merit_score     DECIMAL(5,2) DEFAULT 50.00,
  sprint_load     INT DEFAULT 0,
  max_capacity    INT DEFAULT 20,
  status          VARCHAR(20) DEFAULT 'available',
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE assignment_log (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id                 VARCHAR(50) NOT NULL,
  developer_id            UUID REFERENCES developers(id),
  assigned_at             TIMESTAMP DEFAULT NOW(),
  merit_score_snapshot    DECIMAL(5,2),
  tech_match_score        DECIMAL(5,2),
  assignment_reason       TEXT
);

CREATE TABLE merit_score_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id    UUID REFERENCES developers(id),
  sprint_id       VARCHAR(50),
  score           DECIMAL(5,2),
  factors         JSONB,
  calculated_at   TIMESTAMP DEFAULT NOW()
);
```

---

## 📅 Development Roadmap

```
2025 Q1 ████████████████████ Done
├── Week 1  ✅ Infrastructure & Auth
├── Week 2  ✅ Jira Integration Layer
├── Week 3  ✅ Requirement & Task Generator Agents
└── Week 4  ✅ Story Point Estimator & Developer Profiles

2025 Q2 ████████████░░░░░░░░ In Progress
├── Week 5  🔄 Smart Assignment Engine
├── Week 6  🔄 Sprint Monitor & Delay Prediction
├── Week 7  ⏳ Dashboard & Reporting Agent
└── Week 8  ⏳ Testing, Optimization & Launch

Future   ░░░░░░░░░░░░░░░░░░░░ Planned
├── v1.1  📌 Mobile app (React Native)
├── v1.2  📌 Linear & Asana integrations
├── v1.3  📌 Voice standup via Whisper API
└── v2.0  📌 Multi-team / Enterprise support
```

---

## 🤝 Contributing

Contributions are welcome! Please read the contributing guidelines before submitting a PR.

```bash
# 1. Fork the repository
# 2. Create your feature branch
git checkout -b feature/amazing-feature

# 3. Commit your changes
git commit -m "feat: add amazing feature"

# 4. Push to the branch
git push origin feature/amazing-feature

# 5. Open a Pull Request
```

### Commit Convention

| Prefix | Use For |
|---|---|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `docs:` | Documentation |
| `refactor:` | Code refactoring |
| `test:` | Tests |
| `chore:` | Build or tooling |

---

## 📊 GitHub Stats

<div align="center">

<img height="180em" src="https://github-readme-stats.vercel.app/api?username=deekshithgowda85&show_icons=true&theme=tokyonight&include_all_commits=true&count_private=true&hide_border=true&bg_color=0D1B2A&title_color=2563EB&icon_color=06B6D4&text_color=ffffff"/>

<img height="180em" src="https://github-readme-stats.vercel.app/api/top-langs/?username=deekshithgowda85&layout=compact&theme=tokyonight&hide_border=true&bg_color=0D1B2A&title_color=2563EB&text_color=ffffff"/>

</div>

<div align="center">

[![GitHub Streak](https://streak-stats.demolab.com?user=deekshithgowda85&theme=tokyonight&hide_border=true&background=0D1B2A&stroke=2563EB&ring=06B6D4&fire=F59E0B&currStreakLabel=ffffff&sideLabels=ffffff&dates=94A3B8)](https://github.com/deekshithgowda85)

</div>

---

## 👨‍💻 Author

<div align="center">

<img src="https://avatars.githubusercontent.com/u/deekshithgowda85?v=4" width="100" style="border-radius:50%"/>

### Deekshith Gowda
**Full Stack AI Developer**

[![GitHub](https://img.shields.io/badge/GitHub-deekshithgowda85-181717?style=for-the-badge&logo=github)](https://github.com/deekshithgowda85)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Connect-0A66C2?style=for-the-badge&logo=linkedin)](https://linkedin.com/in/deekshithgowda85)
[![Portfolio](https://img.shields.io/badge/Portfolio-Visit-2563EB?style=for-the-badge&logo=vercel)](https://github.com/deekshithgowda85)

</div>

---

## 📄 License

```
MIT License

Copyright (c) 2025 Deekshith Gowda (deekshithgowda85)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
```

---

<div align="center">

<img width="100%" src="https://capsule-render.vercel.app/api?type=waving&color=0:06B6D4,50:2563EB,100:0D1B2A&height=100&section=footer"/>

**⭐ Star this repo if you found it useful!**

`Built with AI · Powered by Agents · Made by` [**deekshithgowda85**](https://github.com/deekshithgowda85)

</div>
