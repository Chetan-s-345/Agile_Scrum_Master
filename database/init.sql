-- Initialize database with tables
-- This will be run automatically by Docker

-- IMPORTANT:
-- This schema is used by `npm run init:app-db`.
-- Your repo also has an API Gateway schema (backend/api-gateway/init.sql) that creates tables in `public`.
-- If DATABASE_URL points to the same Neon database as the gateway, creating tables in `public` here will
-- collide (and foreign keys can fail with "cannot be implemented").
--
-- Fix: keep the Next.js app tables inside a dedicated schema `app`.
DROP SCHEMA IF EXISTS app CASCADE;
CREATE SCHEMA app;

CREATE TABLE IF NOT EXISTS app.users (
  id VARCHAR(255) PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  password VARCHAR(255),
  role VARCHAR(50) DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app.developers (
  id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  slack_id VARCHAR(255),
  role VARCHAR(50) DEFAULT 'engineer',
  tech_stack TEXT[] DEFAULT ARRAY[]::TEXT[],
  merit_score FLOAT DEFAULT 50,
  current_sprint_load INT DEFAULT 0,
  max_sprint_capacity INT DEFAULT 40,
  status VARCHAR(50) DEFAULT 'available',
  leave_dates TIMESTAMP[] DEFAULT ARRAY[]::TIMESTAMP[],
  daily_hours INT DEFAULT 8,
  avg_completion_rate FLOAT DEFAULT 0.8,
  avg_code_quality FLOAT DEFAULT 0.75,
  avg_pr_review_hours FLOAT DEFAULT 24,
  sprints_over_capacity INT DEFAULT 0,
  peer_rating FLOAT DEFAULT 0,
  burnout_risk BOOLEAN DEFAULT FALSE,
  burnout_risk_level FLOAT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app.sprints (
  id VARCHAR(255) PRIMARY KEY,
  jira_sprint_id VARCHAR(255) UNIQUE,
  name VARCHAR(255) NOT NULL,
  goal TEXT,
  start_date TIMESTAMP NOT NULL,
  end_date TIMESTAMP NOT NULL,
  status VARCHAR(50) DEFAULT 'active',
  velocity INT DEFAULT 0,
  completion_rate FLOAT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app.tasks (
  id VARCHAR(255) PRIMARY KEY,
  jira_issue_id VARCHAR(255) UNIQUE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  tech_tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  story_points INT,
  status VARCHAR(50) DEFAULT 'todo',
  priority VARCHAR(50) DEFAULT 'medium',
  sprint_id VARCHAR(255),
  assignee_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sprint_id) REFERENCES app.sprints(id) ON DELETE SET NULL,
  FOREIGN KEY (assignee_id) REFERENCES app.developers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS app.performance_history (
  id VARCHAR(255) PRIMARY KEY,
  developer_id VARCHAR(255) NOT NULL,
  sprint_id VARCHAR(255) NOT NULL,
  story_points_assigned INT,
  story_points_completed INT,
  completion_rate FLOAT,
  code_quality FLOAT,
  pr_review_avg_hours FLOAT,
  peer_rating FLOAT,
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (developer_id) REFERENCES app.developers(id) ON DELETE CASCADE,
  FOREIGN KEY (sprint_id) REFERENCES app.sprints(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app.assignment_log (
  id VARCHAR(255) PRIMARY KEY,
  task_id VARCHAR(255) NOT NULL,
  developer_id VARCHAR(255) NOT NULL,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reason TEXT,
  merit_score_at_assignment FLOAT,
  tech_match_score FLOAT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES app.tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (developer_id) REFERENCES app.developers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app.delay_alerts (
  id VARCHAR(255) PRIMARY KEY,
  sprint_id VARCHAR(255) NOT NULL,
  task_id VARCHAR(255),
  alert_type VARCHAR(50) NOT NULL,
  severity VARCHAR(50) NOT NULL,
  predicted_delay_days INT,
  suggestion TEXT,
  acknowledged BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  acknowledged_at TIMESTAMP,
  FOREIGN KEY (sprint_id) REFERENCES app.sprints(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES app.tasks(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS app.skill_gap_log (
  id VARCHAR(255) PRIMARY KEY,
  task_id VARCHAR(255) NOT NULL,
  required_skill VARCHAR(255) NOT NULL,
  assignment_failed_reason TEXT,
  logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES app.tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app.jira_sync_status (
  id VARCHAR(255) PRIMARY KEY,
  last_sync_time TIMESTAMP,
  last_sync_status VARCHAR(50),
  items_synced INT DEFAULT 0,
  error_message TEXT,
  next_sync_time TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tasks_sprint_id ON app.tasks(sprint_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_id ON app.tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_developers_merit_score ON app.developers(merit_score DESC);
CREATE INDEX IF NOT EXISTS idx_performance_history_developer ON app.performance_history(developer_id);
CREATE INDEX IF NOT EXISTS idx_assignment_log_task ON app.assignment_log(task_id);
CREATE INDEX IF NOT EXISTS idx_delay_alerts_sprint ON app.delay_alerts(sprint_id);
