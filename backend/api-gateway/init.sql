-- ============================================================================
-- AI SPRINT MANAGER — COMPLETE SQL SCHEMA
-- Multi-Organization Architecture (Salesforce-style)
-- Universal Database + Per-Org Tenant Database
-- ============================================================================
-- ARCHITECTURE:
--   universal_db     → Master registry: orgs, billing, plans, global config
--   org_{org_id}_db  → Per-org isolated DB: developers, sprints, tasks, AI data
-- ============================================================================

-- ============================================================================
-- ██████████████████████████████████████████████████████████████████████████
-- PART 1: UNIVERSAL DATABASE  (universal_db)
-- Contains: Organizations, Plans, Billing, Global Users, Auth, Admin
-- ██████████████████████████████████████████████████████████████████████████
-- ============================================================================

-- Run this on your universal_db database
-- CREATE DATABASE universal_db;
-- \c universal_db;

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- ============================================================================
-- 1.1  SUBSCRIPTION PLANS
-- ============================================================================
CREATE TABLE plans (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                VARCHAR(50) NOT NULL UNIQUE,         -- Free, Starter, Pro, Enterprise
    slug                VARCHAR(50) NOT NULL UNIQUE,         -- free, starter, pro, enterprise
    price_monthly       DECIMAL(10,2) DEFAULT 0.00,
    price_yearly        DECIMAL(10,2) DEFAULT 0.00,
    max_members         INT DEFAULT 5,
    max_projects        INT DEFAULT 3,
    max_sprints_per_mo  INT DEFAULT 10,
    max_storage_gb      INT DEFAULT 5,
    ai_requests_per_day INT DEFAULT 100,
    features            JSONB DEFAULT '{}',                  -- feature flags per plan
    is_active           BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

INSERT INTO plans (name, slug, price_monthly, price_yearly, max_members, max_projects, max_sprints_per_mo, max_storage_gb, ai_requests_per_day, features) VALUES
('Free',       'free',       0.00,   0.00,    5,   2,   4,   2,   50,   '{"auto_assign":false,"burnout_detect":false,"ai_reporter":false,"skill_gap":false}'),
('Starter',    'starter',    49.00,  490.00,  15,  10,  20,  20,  500,  '{"auto_assign":true,"burnout_detect":false,"ai_reporter":true,"skill_gap":true}'),
('Pro',        'pro',        199.00, 1990.00, 50,  40,  80,  100, 2500, '{"auto_assign":true,"burnout_detect":true,"ai_reporter":true,"skill_gap":true}'),
('Enterprise', 'enterprise', 999.00, 9990.00, 500, 500, 500, 2000,20000,'{"auto_assign":true,"burnout_detect":true,"ai_reporter":true,"skill_gap":true,"custom_domain":true,"sso":true,"audit_log":true}')
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    price_monthly = EXCLUDED.price_monthly,
    price_yearly = EXCLUDED.price_yearly,
    max_members = EXCLUDED.max_members,
    max_projects = EXCLUDED.max_projects,
    max_sprints_per_mo = EXCLUDED.max_sprints_per_mo,
    max_storage_gb = EXCLUDED.max_storage_gb,
    ai_requests_per_day = EXCLUDED.ai_requests_per_day,
    features = EXCLUDED.features,
    updated_at = NOW();

-- ============================================================================
-- 1.2  ORGANIZATIONS (Tenants)
-- ============================================================================
CREATE TABLE organizations (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                VARCHAR(150) NOT NULL,
    slug                VARCHAR(100) NOT NULL UNIQUE,        -- used in URL: app.sprintai.com/org/acme
    display_name        VARCHAR(200),
    logo_url            TEXT,
    website             TEXT,
    industry            VARCHAR(100),
    size                VARCHAR(50),                         -- 1-10, 11-50, 51-200, 201-500, 500+
    country             VARCHAR(100),
    timezone            VARCHAR(100) DEFAULT 'UTC',
    plan_id             UUID REFERENCES plans(id),
    plan_status         VARCHAR(30) DEFAULT 'active',        -- active, trial, suspended, cancelled
    trial_ends_at       TIMESTAMP,
    db_name             VARCHAR(100) UNIQUE,                 -- org_{id}_db
    db_host             VARCHAR(200),                        -- isolated DB host (for enterprise)
    neon_branch_id      VARCHAR(200),                        -- Neon project id for this org (legacy column name)
    db_connection_string TEXT,                               -- Tenant DB connection string for this org
    db_provisioned      BOOLEAN DEFAULT FALSE,
    domain              VARCHAR(200),                        -- custom domain for SSO
    is_active           BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 1.2.1  TENANTS (Canonical multi-tenant handle)
-- NOTE: This system historically uses organizations as tenants. We keep that,
-- but also create a tenants table (1:1 mapping) to support clean SaaS billing.
-- ============================================================================
CREATE TABLE tenants (
        id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        org_id              UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
        created_at          TIMESTAMP DEFAULT NOW()
);

-- Auto-create a tenant row whenever an organization is created.
CREATE OR REPLACE FUNCTION ensure_tenant_for_org() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO tenants (org_id) VALUES (NEW.id)
    ON CONFLICT (org_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ensure_tenant_for_org ON organizations;
CREATE TRIGGER trg_ensure_tenant_for_org
AFTER INSERT ON organizations
FOR EACH ROW
EXECUTE PROCEDURE ensure_tenant_for_org();

-- ============================================================================
-- 1.3  GLOBAL USERS (Identity — one per person, many orgs)
-- ============================================================================
CREATE TABLE global_users (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email               CITEXT NOT NULL UNIQUE,
    email_verified      BOOLEAN DEFAULT FALSE,
    full_name           VARCHAR(200) NOT NULL,
    avatar_url          TEXT,
    phone               VARCHAR(30),
    password_hash       TEXT,                                -- NULL if SSO only
    auth_provider       VARCHAR(50) DEFAULT 'email',        -- email, google, github, jira, saml
    auth_provider_id    VARCHAR(200),                        -- external provider user ID
    is_active           BOOLEAN DEFAULT TRUE,
    is_super_admin      BOOLEAN DEFAULT FALSE,               -- platform-level admin
    last_login_at       TIMESTAMP,
    last_login_ip       INET,
    failed_login_count  INT DEFAULT 0,
    locked_until        TIMESTAMP,
    mfa_enabled         BOOLEAN DEFAULT FALSE,
    mfa_secret          TEXT,
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 1.4  ORG MEMBERSHIPS (User ↔ Org relationship)
-- ============================================================================
CREATE TABLE org_members (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
    role                VARCHAR(50) NOT NULL DEFAULT 'member',  -- owner, admin, manager, member, viewer
    is_active           BOOLEAN DEFAULT TRUE,
    invited_by          UUID REFERENCES global_users(id),
    invited_at          TIMESTAMP,
    joined_at           TIMESTAMP,
    last_active_at      TIMESTAMP,
    created_at          TIMESTAMP DEFAULT NOW(),
    UNIQUE(org_id, user_id)
);

-- ============================================================================
-- 1.5  INVITATIONS
-- ============================================================================
CREATE TABLE invitations (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email               CITEXT NOT NULL,
    role                VARCHAR(50) DEFAULT 'member',
    token               VARCHAR(200) NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
    invited_by          UUID REFERENCES global_users(id),
    status              VARCHAR(30) DEFAULT 'pending',       -- pending, accepted, expired, cancelled
    expires_at          TIMESTAMP DEFAULT (NOW() + INTERVAL '7 days'),
    accepted_at         TIMESTAMP,
    created_at          TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 1.6  AUTH SESSIONS & TOKENS
-- ============================================================================
CREATE TABLE auth_sessions (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
    org_id              UUID REFERENCES organizations(id),
    token_hash          TEXT NOT NULL UNIQUE,
    refresh_token_hash  TEXT UNIQUE,
    device_info         JSONB DEFAULT '{}',
    ip_address          INET,
    user_agent          TEXT,
    is_active           BOOLEAN DEFAULT TRUE,
    expires_at          TIMESTAMP NOT NULL,
    created_at          TIMESTAMP DEFAULT NOW(),
    last_used_at        TIMESTAMP DEFAULT NOW()
);

CREATE TABLE password_resets (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
    token_hash          TEXT NOT NULL UNIQUE,
    used                BOOLEAN DEFAULT FALSE,
    expires_at          TIMESTAMP DEFAULT (NOW() + INTERVAL '1 hour'),
    created_at          TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 1.7  BILLING & SUBSCRIPTIONS
-- ============================================================================
CREATE TABLE coupons (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code                VARCHAR(80) NOT NULL UNIQUE,
    description         TEXT,
    discount_type       VARCHAR(20) NOT NULL CHECK (discount_type IN ('percent','fixed')),
    discount_value      DECIMAL(10,2) NOT NULL CHECK (discount_value >= 0),
    applicable_plan_slugs TEXT[] DEFAULT NULL, -- NULL/empty => all plans
    is_active           BOOLEAN DEFAULT TRUE,
    starts_at           TIMESTAMP DEFAULT NOW(),
    expires_at          TIMESTAMP,
    max_redemptions     INT,
    redeemed_count      INT DEFAULT 0,
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

-- Seed enterprise coupon used by the app docs
INSERT INTO coupons (code, description, discount_type, discount_value, applicable_plan_slugs, is_active)
VALUES ('ENT-2026-SCALE-40', '100% off Enterprise billing (full discount).', 'percent', 100, ARRAY['enterprise'], TRUE)
ON CONFLICT (code) DO UPDATE
SET description = EXCLUDED.description,
    discount_type = EXCLUDED.discount_type,
    discount_value = EXCLUDED.discount_value,
    applicable_plan_slugs = EXCLUDED.applicable_plan_slugs,
    is_active = TRUE,
    updated_at = NOW();

CREATE TABLE subscriptions (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id               UUID REFERENCES tenants(id) ON DELETE SET NULL,
    org_id                  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    plan_id                 UUID NOT NULL REFERENCES plans(id),
    billing_cycle           VARCHAR(20) DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly','yearly')),
    status                  VARCHAR(30) DEFAULT 'trial' CHECK (status IN ('trial','pending','active','cancelled','past_due','paused')),

    -- Provider metadata (fixes missing provider column issue)
    provider                VARCHAR(30) NOT NULL DEFAULT 'stripe', -- stripe, mock
    provider_customer_id    TEXT,
    provider_subscription_id TEXT,

    -- Coupon + pricing snapshot
    coupon_id               UUID REFERENCES coupons(id) ON DELETE SET NULL,
    base_amount             DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    discount_amount         DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    final_amount            DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    currency                VARCHAR(10) DEFAULT 'USD',

    current_period_start    TIMESTAMP,
    current_period_end      TIMESTAMP,
    cancel_at_period_end    BOOLEAN DEFAULT FALSE,
    cancelled_at            TIMESTAMP,
    trial_start             TIMESTAMP,
    trial_end               TIMESTAMP,

    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_org_created ON subscriptions(org_id, created_at DESC);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);

CREATE TABLE payments (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id                  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    subscription_id         UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
    provider                VARCHAR(30) NOT NULL DEFAULT 'stripe',
    provider_transaction_id TEXT,
    payment_status          VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','succeeded','failed','cancelled')),
    amount                  DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    currency                VARCHAR(10) DEFAULT 'USD',
    metadata                JSONB DEFAULT '{}',
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW(),
    paid_at                 TIMESTAMP
);

CREATE INDEX idx_payments_org_created ON payments(org_id, created_at DESC);
CREATE INDEX idx_payments_status ON payments(payment_status);

-- ============================================================================
-- 1.7.1 BILLING MIGRATIONS (idempotent upgrades for existing universal DBs)
-- ============================================================================
-- When running scripts/init-universal-db.js against an existing database, CREATE TABLE statements
-- might be skipped (duplicate_table). These ALTERs ensure required columns exist for the current
-- billing code paths.

-- subscriptions upgrades
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(20) DEFAULT 'monthly';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'trial';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS provider VARCHAR(30) NOT NULL DEFAULT 'stripe';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS provider_customer_id TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS provider_subscription_id TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS coupon_id UUID;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS base_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS final_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'USD';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMP;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMP;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN DEFAULT FALSE;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS trial_start TIMESTAMP;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS trial_end TIMESTAMP;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- payments upgrades
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider VARCHAR(30) NOT NULL DEFAULT 'stripe';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_transaction_id TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_status VARCHAR(30) NOT NULL DEFAULT 'pending';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount DECIMAL(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'USD';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
ALTER TABLE payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE payments ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP;

-- Indexes (safe to re-run)
CREATE INDEX IF NOT EXISTS idx_subscriptions_org_created ON subscriptions(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_payments_org_created ON payments(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(payment_status);

CREATE TABLE invoices (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES organizations(id),
    subscription_id     UUID REFERENCES subscriptions(id),
    stripe_invoice_id   TEXT UNIQUE,
    amount_due          DECIMAL(10,2),
    amount_paid         DECIMAL(10,2),
    currency            VARCHAR(10) DEFAULT 'USD',
    status              VARCHAR(30),                         -- draft, open, paid, void, uncollectible
    invoice_pdf_url     TEXT,
    period_start        TIMESTAMP,
    period_end          TIMESTAMP,
    paid_at             TIMESTAMP,
    created_at          TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 1.8  GLOBAL AUDIT LOG (platform-level)
-- ============================================================================
CREATE TABLE global_audit_log (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_user_id       UUID REFERENCES global_users(id),
    org_id              UUID REFERENCES organizations(id),
    action              VARCHAR(100) NOT NULL,               -- org.created, user.login, plan.upgraded
    resource_type       VARCHAR(50),
    resource_id         UUID,
    metadata            JSONB DEFAULT '{}',
    ip_address          INET,
    user_agent          TEXT,
    created_at          TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 1.9  AI USAGE METERING (per org)
-- ============================================================================
CREATE TABLE ai_usage_log (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id             UUID REFERENCES global_users(id),
    feature             VARCHAR(100) NOT NULL,               -- assignment_engine, story_generator, etc.
    model_used          VARCHAR(100),                        -- gpt-4, claude-3, xgboost
    tokens_used         INT DEFAULT 0,
    cost_usd            DECIMAL(10,6) DEFAULT 0,
    duration_ms         INT,
    success             BOOLEAN DEFAULT TRUE,
    error_message       TEXT,
    created_at          TIMESTAMP DEFAULT NOW()
);

CREATE TABLE ai_usage_daily (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    date                DATE NOT NULL,
    total_requests      INT DEFAULT 0,
    total_tokens        INT DEFAULT 0,
    total_cost_usd      DECIMAL(10,4) DEFAULT 0,
    UNIQUE(org_id, date)
);

-- ============================================================================
-- 1.10 SSO CONFIGURATION (Enterprise)
-- ============================================================================
CREATE TABLE sso_configs (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
    provider            VARCHAR(50) NOT NULL,                -- saml, oidc, google, github
    entity_id           TEXT,
    sso_url             TEXT,
    certificate         TEXT,
    attribute_mapping   JSONB DEFAULT '{}',
    is_active           BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 1.11 ORG DATABASE PROVISIONING LOG
-- ============================================================================
CREATE TABLE db_provisioning_log (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES organizations(id),
    db_name             VARCHAR(100) NOT NULL,
    action              VARCHAR(50) NOT NULL,                -- create, migrate, backup, drop
    status              VARCHAR(30) DEFAULT 'pending',       -- pending, running, success, failed
    error_message       TEXT,
    migration_version   VARCHAR(50),
    started_at          TIMESTAMP DEFAULT NOW(),
    completed_at        TIMESTAMP
);

-- ============================================================================
-- Universal DB — Indexes
-- ============================================================================
CREATE INDEX idx_global_users_email       ON global_users(email);
CREATE INDEX idx_org_members_org_id       ON org_members(org_id);
CREATE INDEX idx_org_members_user_id      ON org_members(user_id);
CREATE INDEX idx_auth_sessions_user_id    ON auth_sessions(user_id);
CREATE INDEX idx_auth_sessions_token      ON auth_sessions(token_hash);
CREATE INDEX idx_invitations_token        ON invitations(token);
CREATE INDEX idx_invitations_email        ON invitations(email);
CREATE INDEX idx_ai_usage_org_date        ON ai_usage_log(org_id, created_at);
CREATE INDEX idx_global_audit_actor       ON global_audit_log(actor_user_id);
CREATE INDEX idx_global_audit_org         ON global_audit_log(org_id);
CREATE INDEX idx_organizations_slug       ON organizations(slug);
CREATE INDEX idx_subscriptions_org_id     ON subscriptions(org_id);


-- ============================================================================
-- ██████████████████████████████████████████████████████████████████████████
-- PART 2: PER-ORGANIZATION DATABASE  (org_{org_id}_db)
-- Contains: Developers, Projects, Sprints, Tasks, AI Agents, Assignments,
--           Merit Scores, Reports, Integrations, Notifications, Audit
-- ██████████████████████████████████████████████████████████████████████████
-- This schema is provisioned fresh for EVERY new organization that signs up.
-- Replace {ORG_ID} with the actual org UUID when provisioning.
-- ============================================================================

-- CREATE DATABASE org_{org_id}_db;
-- \c org_{org_id}_db;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- ============================================================================
-- 2.1  ORG SETTINGS & CONFIGURATION
-- ============================================================================
CREATE TABLE org_settings (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id                  UUID NOT NULL UNIQUE,            -- mirrors universal_db org id
    sprint_duration_weeks   INT DEFAULT 2,
    default_story_points    INT[] DEFAULT '{1,2,3,5,8,13}', -- Fibonacci scale
    working_hours_per_day   INT DEFAULT 8,
    working_days_per_week   INT DEFAULT 5,
    delay_alert_threshold   DECIMAL(5,2) DEFAULT 20.00,     -- % behind to trigger alert
    burnout_sprint_threshold INT DEFAULT 2,                  -- consecutive overloaded sprints
    merit_weights           JSONB DEFAULT '{
                                "tech_stack_match": 0.25,
                                "completion_rate": 0.25,
                                "code_quality": 0.20,
                                "pr_review_speed": 0.15,
                                "peer_rating": 0.15
                            }',
    ai_provider             VARCHAR(50) DEFAULT 'openai',   -- openai, anthropic
    jira_base_url           TEXT,
    jira_project_key        VARCHAR(50),
    github_org              VARCHAR(100),
    slack_workspace_id      VARCHAR(100),
    slack_standup_channel   VARCHAR(100),
    notification_settings   JSONB DEFAULT '{}',
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 2.2  TEAM MEMBERS (mirrored from org_members in universal_db)
-- ============================================================================
CREATE TABLE team_members (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    global_user_id      UUID NOT NULL UNIQUE,               -- FK to universal_db.global_users
    email               VARCHAR(200) NOT NULL UNIQUE,
    full_name           VARCHAR(200) NOT NULL,
    avatar_url          TEXT,
    role                VARCHAR(50) NOT NULL DEFAULT 'developer',  -- owner, admin, manager, developer, qa, designer, viewer
    department          VARCHAR(100),
    job_title           VARCHAR(150),
    slack_user_id       VARCHAR(100),
    github_username     VARCHAR(100),
    jira_account_id     VARCHAR(200),
    is_active           BOOLEAN DEFAULT TRUE,
    joined_at           TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 2.3  DEVELOPER PROFILES (AI Assignment Engine core data)
-- ============================================================================
CREATE TABLE developer_profiles (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    member_id               UUID NOT NULL UNIQUE REFERENCES team_members(id) ON DELETE CASCADE,
    tech_stack              TEXT[] NOT NULL DEFAULT '{}',    -- ["React","Node.js","PostgreSQL"]
    skill_levels            JSONB DEFAULT '{}',              -- {"React":"expert","Node.js":"intermediate"}
    primary_role            VARCHAR(100),                    -- Frontend, Backend, Fullstack, QA, DevOps
    years_experience        INT DEFAULT 0,
    certifications          TEXT[] DEFAULT '{}',
    preferred_task_types    TEXT[] DEFAULT '{}',             -- ["feature","bug","refactor"]
    -- Sprint Capacity
    max_sprint_capacity     INT DEFAULT 20,                  -- max story points per sprint
    current_sprint_load     INT DEFAULT 0,                   -- story points currently assigned
    -- Merit Score (composite)
    merit_score             DECIMAL(5,2) DEFAULT 50.00,      -- 0-100
    merit_score_updated_at  TIMESTAMP,
    -- Availability
    availability_status     VARCHAR(30) DEFAULT 'available', -- available, on_leave, at_capacity, inactive
    -- Performance Averages (rolling)
    avg_completion_rate     DECIMAL(5,2) DEFAULT 0.00,       -- % tasks finished on time
    avg_code_quality_score  DECIMAL(5,2) DEFAULT 0.00,       -- SonarQube normalized 0-100
    avg_pr_review_hours     DECIMAL(6,2) DEFAULT 0.00,       -- average hours to review + merge
    avg_peer_rating         DECIMAL(5,2) DEFAULT 0.00,       -- 0-100 from retros
    -- Burnout tracking
    consecutive_over_capacity INT DEFAULT 0,
    burnout_risk_flag       BOOLEAN DEFAULT FALSE,
    assignment_weight       DECIMAL(5,2) DEFAULT 1.00,       -- multiplier 0.0-1.0
    -- GitHub metrics
    total_commits           INT DEFAULT 0,
    total_prs_merged        INT DEFAULT 0,
    total_code_reviews      INT DEFAULT 0,
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 2.4  DEVELOPER AVAILABILITY / LEAVE CALENDAR
-- ============================================================================
CREATE TABLE developer_availability (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    developer_id        UUID NOT NULL REFERENCES developer_profiles(id) ON DELETE CASCADE,
    leave_type          VARCHAR(50) DEFAULT 'vacation',      -- vacation, sick, holiday, training, conference
    start_date          DATE NOT NULL,
    end_date            DATE NOT NULL,
    reason              TEXT,
    approved            BOOLEAN DEFAULT FALSE,
    approved_by         UUID REFERENCES team_members(id),
    created_at          TIMESTAMP DEFAULT NOW(),
    CHECK (end_date >= start_date)
);

-- ============================================================================
-- 2.5  PROJECTS
-- ============================================================================
CREATE TABLE projects (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                VARCHAR(200) NOT NULL,
    slug                VARCHAR(100) NOT NULL UNIQUE,
    description         TEXT,
    status              VARCHAR(30) DEFAULT 'active',        -- active, on_hold, completed, archived
    priority            VARCHAR(20) DEFAULT 'medium',        -- low, medium, high, critical
    start_date          DATE,
    target_end_date     DATE,
    actual_end_date     DATE,
    tech_stack          TEXT[] DEFAULT '{}',
    jira_project_key    VARCHAR(50),
    github_repo         VARCHAR(200),
    confluence_space    VARCHAR(100),
    owner_id            UUID REFERENCES team_members(id),
    created_by          UUID REFERENCES team_members(id),
    color               VARCHAR(7) DEFAULT '#2563EB',
    avatar_emoji        VARCHAR(10) DEFAULT '🚀',
    settings            JSONB DEFAULT '{}',
    space_order         INT DEFAULT 0,
    is_space_archived   BOOLEAN DEFAULT FALSE,
    is_default_space    BOOLEAN DEFAULT FALSE,
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS space_order INT DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_space_archived BOOLEAN DEFAULT FALSE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_default_space BOOLEAN DEFAULT FALSE;

CREATE TABLE project_members (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    member_id           UUID NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
    role                VARCHAR(50) DEFAULT 'developer',
    added_at            TIMESTAMP DEFAULT NOW(),
    UNIQUE(project_id, member_id)
);

-- ============================================================================
-- 2.6  EPICS
-- ============================================================================
CREATE TABLE epics (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title               VARCHAR(300) NOT NULL,
    description         TEXT,
    jira_epic_id        VARCHAR(100),
    status              VARCHAR(30) DEFAULT 'open',          -- open, in_progress, done, cancelled
    priority            VARCHAR(20) DEFAULT 'medium',
    start_date          DATE,
    target_date         DATE,
    color               VARCHAR(7) DEFAULT '#7C3AED',
    owner_id            UUID REFERENCES team_members(id),
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 2.7  SPRINTS
-- ============================================================================
CREATE TABLE sprints (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name                VARCHAR(200) NOT NULL,
    goal                TEXT,
    sprint_number       INT NOT NULL,
    status              VARCHAR(30) DEFAULT 'planning',      -- planning, active, completed, cancelled
    start_date          DATE NOT NULL,
    end_date            DATE NOT NULL,
    -- Capacity
    total_capacity_pts  INT DEFAULT 0,                       -- sum of all dev capacity
    planned_points      INT DEFAULT 0,
    completed_points    INT DEFAULT 0,
    carried_over_points INT DEFAULT 0,
    -- AI metrics
    ai_risk_score       DECIMAL(5,2),                        -- 0-100 sprint risk at start
    ai_risk_factors     JSONB DEFAULT '{}',
    predicted_velocity  DECIMAL(6,2),
    actual_velocity     DECIMAL(6,2),
    -- Jira
    jira_sprint_id      VARCHAR(100),
    -- Retrospective
    retro_summary       TEXT,
    retro_generated_by  VARCHAR(20) DEFAULT 'ai',
    created_by          UUID REFERENCES team_members(id),
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW(),
    UNIQUE(project_id, sprint_number)
);

-- ============================================================================
-- 2.8  BACKLOG ITEMS
-- ============================================================================
CREATE TABLE backlog_items (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    epic_id             UUID REFERENCES epics(id),
    title               VARCHAR(500) NOT NULL,
    description         TEXT,
    type                VARCHAR(30) DEFAULT 'story',         -- story, bug, task, spike, chore, epic
    priority            VARCHAR(20) DEFAULT 'medium',        -- critical, high, medium, low
    status              VARCHAR(30) DEFAULT 'backlog',       -- backlog, ready, in_sprint, done
    story_points        INT,
    ai_estimated_points INT,                                 -- AI-predicted story points
    business_value      INT DEFAULT 0,                       -- 0-100 business priority score
    tech_tags           TEXT[] DEFAULT '{}',                 -- required skills for this task
    acceptance_criteria TEXT,
    jira_issue_id       VARCHAR(100) UNIQUE,
    jira_issue_key      VARCHAR(50),
    github_issue_number INT,
    github_issue_url    TEXT,
    reporter_id         UUID REFERENCES team_members(id),
    sprint_id           UUID REFERENCES sprints(id),
    sort_order          INT DEFAULT 0,
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 2.9  TASKS (Sprint items — detailed)
-- ============================================================================
CREATE TABLE tasks (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    backlog_item_id     UUID REFERENCES backlog_items(id),
    sprint_id           UUID NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES projects(id),
    title               VARCHAR(500) NOT NULL,
    description         TEXT,
    type                VARCHAR(30) DEFAULT 'task',
    status              VARCHAR(30) DEFAULT 'todo',          -- todo, in_progress, in_review, blocked, done, cancelled
    priority            VARCHAR(20) DEFAULT 'medium',
    story_points        INT DEFAULT 0,
    ai_estimated_points INT,
    tech_tags           TEXT[] DEFAULT '{}',
    acceptance_criteria TEXT,
    -- Assignment
    assignee_id         UUID REFERENCES developer_profiles(id),
    assigned_by         VARCHAR(30) DEFAULT 'ai',            -- ai, manual
    assigned_at         TIMESTAMP,
    -- Dates
    due_date            DATE,
    started_at          TIMESTAMP,
    completed_at        TIMESTAMP,
    -- Dependencies
    blocked_by          UUID[],                              -- array of task IDs blocking this
    -- Tracking
    estimated_hours     DECIMAL(6,2),
    logged_hours        DECIMAL(6,2) DEFAULT 0,
    progress            INT DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    -- Jira
    jira_issue_id       VARCHAR(100) UNIQUE,
    jira_issue_key      VARCHAR(50),
    jira_synced         BOOLEAN DEFAULT TRUE,
    github_issue_number INT,
    github_issue_url    TEXT,
    github_pr_number    INT,
    github_pr_url       TEXT,
    -- AI flags
    ai_delay_risk       BOOLEAN DEFAULT FALSE,
    ai_risk_score       DECIMAL(5,2),
    created_by          UUID REFERENCES team_members(id),
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 2.10  TASK COMMENTS & ACTIVITY
-- ============================================================================
CREATE TABLE task_comments (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id             UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    author_id           UUID REFERENCES team_members(id),
    content             TEXT NOT NULL,
    is_ai_generated     BOOLEAN DEFAULT FALSE,
    comment_type        VARCHAR(30) DEFAULT 'comment',       -- comment, status_change, assignment, blocker
    metadata            JSONB DEFAULT '{}',
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

CREATE TABLE task_time_logs (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id             UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    developer_id        UUID REFERENCES developer_profiles(id),
    hours               DECIMAL(6,2) NOT NULL,
    work_date           DATE NOT NULL,
    description         TEXT,
    created_at          TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 2.11  SMART ASSIGNMENT ENGINE
-- ============================================================================
CREATE TABLE assignment_log (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id                     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    developer_id                UUID NOT NULL REFERENCES developer_profiles(id),
    assigned_at                 TIMESTAMP DEFAULT NOW(),
    assigned_by                 VARCHAR(20) DEFAULT 'ai',    -- ai, manual, reassign
    -- Scores at time of assignment
    merit_score_snapshot        DECIMAL(5,2),
    tech_match_score            DECIMAL(5,2),                -- % of required tags matched
    availability_score          DECIMAL(5,2),
    workload_score              DECIMAL(5,2),
    final_ranking_score         DECIMAL(5,2),
    -- Decision details
    total_candidates            INT DEFAULT 0,               -- how many devs were evaluated
    filtered_by_tech            INT DEFAULT 0,               -- removed in tech filter
    filtered_by_availability    INT DEFAULT 0,               -- removed in availability filter
    assignment_reason           TEXT,
    -- Outcome (filled post-sprint)
    was_completed_on_time       BOOLEAN,
    actual_story_points         INT,
    completion_quality          DECIMAL(5,2),                -- code quality score after completion
    updated_at                  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE assignment_failures (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id             UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    failed_at           TIMESTAMP DEFAULT NOW(),
    reason_code         VARCHAR(50) NOT NULL,                -- no_tech_match, all_on_leave, all_at_capacity, no_developers
    required_tech_tags  TEXT[] DEFAULT '{}',
    available_devs      INT DEFAULT 0,
    matched_tech_devs   INT DEFAULT 0,
    suggestion          TEXT,
    resolved            BOOLEAN DEFAULT FALSE,
    resolved_at         TIMESTAMP,
    resolved_by         UUID REFERENCES team_members(id)
);

-- ============================================================================
-- 2.12  MERIT SCORES
-- ============================================================================
CREATE TABLE merit_score_history (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    developer_id            UUID NOT NULL REFERENCES developer_profiles(id) ON DELETE CASCADE,
    sprint_id               UUID NOT NULL REFERENCES sprints(id),
    -- Raw factors
    tech_stack_match_score  DECIMAL(5,2) DEFAULT 0,
    completion_rate_score   DECIMAL(5,2) DEFAULT 0,
    code_quality_score      DECIMAL(5,2) DEFAULT 0,
    pr_review_speed_score   DECIMAL(5,2) DEFAULT 0,
    peer_rating_score       DECIMAL(5,2) DEFAULT 0,
    -- Final
    calculated_merit_score  DECIMAL(5,2) NOT NULL,
    previous_merit_score    DECIMAL(5,2),
    score_delta             DECIMAL(5,2),
    weights_used            JSONB NOT NULL,
    calculation_notes       TEXT,
    calculated_at           TIMESTAMP DEFAULT NOW()
);

CREATE TABLE peer_ratings (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sprint_id           UUID NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    ratee_developer_id  UUID NOT NULL REFERENCES developer_profiles(id),
    rater_member_id     UUID NOT NULL REFERENCES team_members(id),
    rating              INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    feedback            TEXT,
    is_anonymous        BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMP DEFAULT NOW(),
    UNIQUE(sprint_id, ratee_developer_id, rater_member_id)
);

-- ============================================================================
-- 2.13  DEVELOPER PERFORMANCE (per sprint)
-- ============================================================================
CREATE TABLE sprint_performance (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    developer_id                UUID NOT NULL REFERENCES developer_profiles(id) ON DELETE CASCADE,
    sprint_id                   UUID NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    -- Story points
    story_points_assigned       INT DEFAULT 0,
    story_points_completed      INT DEFAULT 0,
    story_points_carried_over   INT DEFAULT 0,
    -- Task stats
    tasks_assigned              INT DEFAULT 0,
    tasks_completed             INT DEFAULT 0,
    tasks_completed_on_time     INT DEFAULT 0,
    bugs_introduced             INT DEFAULT 0,
    -- Code metrics (from GitHub/SonarQube)
    commits_count               INT DEFAULT 0,
    prs_opened                  INT DEFAULT 0,
    prs_merged                  INT DEFAULT 0,
    prs_reviewed                INT DEFAULT 0,
    avg_pr_review_hours         DECIMAL(6,2),
    code_quality_score          DECIMAL(5,2),
    lines_added                 INT DEFAULT 0,
    lines_removed               INT DEFAULT 0,
    -- Hours
    estimated_hours             DECIMAL(7,2),
    logged_hours                DECIMAL(7,2),
    -- Capacity
    max_capacity_pts            INT,
    over_capacity               BOOLEAN DEFAULT FALSE,
    -- Derived
    completion_rate             DECIMAL(5,2),                -- %
    avg_peer_rating             DECIMAL(5,2),
    created_at                  TIMESTAMP DEFAULT NOW(),
    UNIQUE(developer_id, sprint_id)
);

-- ============================================================================
-- 2.14  BURNOUT DETECTION
-- ============================================================================
CREATE TABLE burnout_alerts (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    developer_id                UUID NOT NULL REFERENCES developer_profiles(id) ON DELETE CASCADE,
    triggered_at                TIMESTAMP DEFAULT NOW(),
    consecutive_over_sprints    INT NOT NULL,
    avg_overload_percentage     DECIMAL(5,2),
    alert_level                 VARCHAR(20) DEFAULT 'warning', -- warning, critical
    notified_manager            BOOLEAN DEFAULT FALSE,
    notified_at                 TIMESTAMP,
    manager_id                  UUID REFERENCES team_members(id),
    action_taken                TEXT,
    resolved                    BOOLEAN DEFAULT FALSE,
    resolved_at                 TIMESTAMP
);

-- ============================================================================
-- 2.15  AI AGENTS — REQUIREMENT PROCESSING
-- ============================================================================
CREATE TABLE raw_requirements (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    sprint_id           UUID REFERENCES sprints(id),
    submitted_by        UUID REFERENCES team_members(id),
    title               VARCHAR(300),
    raw_text            TEXT NOT NULL,                       -- original PM requirement
    source              VARCHAR(50) DEFAULT 'manual',        -- manual, jira, email, slack
    jira_issue_id       VARCHAR(100),
    processing_status   VARCHAR(30) DEFAULT 'pending',       -- pending, processing, done, failed
    processed_at        TIMESTAMP,
    stories_generated   INT DEFAULT 0,
    created_at          TIMESTAMP DEFAULT NOW()
);

CREATE TABLE generated_stories (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    requirement_id          UUID NOT NULL REFERENCES raw_requirements(id) ON DELETE CASCADE,
    backlog_item_id         UUID REFERENCES backlog_items(id),
    title                   VARCHAR(500) NOT NULL,
    description             TEXT,
    acceptance_criteria     TEXT,
    tech_tags               TEXT[] DEFAULT '{}',
    ai_estimated_points     INT,
    ai_confidence_score     DECIMAL(5,2),
    jira_pushed             BOOLEAN DEFAULT FALSE,
    jira_issue_id           VARCHAR(100),
    created_at              TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 2.16  STORY POINT ESTIMATION — ML MODEL TRACKING
-- ============================================================================
CREATE TABLE story_point_predictions (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id                 UUID REFERENCES tasks(id) ON DELETE CASCADE,
    backlog_item_id         UUID REFERENCES backlog_items(id),
    model_version           VARCHAR(50) NOT NULL,
    predicted_points        INT NOT NULL,
    confidence_score        DECIMAL(5,2),
    feature_vector          JSONB,                           -- input features used
    actual_points           INT,                             -- filled after sprint completion
    prediction_error        DECIMAL(5,2),                   -- |actual - predicted|
    created_at              TIMESTAMP DEFAULT NOW()
);

CREATE TABLE ml_model_versions (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_name              VARCHAR(100) NOT NULL,           -- story_point_estimator, delay_predictor
    version                 VARCHAR(50) NOT NULL,
    algorithm               VARCHAR(100),                    -- XGBoost, RandomForest, etc.
    training_sprints        INT,                             -- how many sprints used for training
    training_data_size      INT,
    mae                     DECIMAL(6,4),                    -- mean absolute error
    rmse                    DECIMAL(6,4),
    accuracy_pct            DECIMAL(5,2),
    model_path              TEXT,
    is_active               BOOLEAN DEFAULT FALSE,
    trained_at              TIMESTAMP DEFAULT NOW(),
    activated_at            TIMESTAMP,
    created_at              TIMESTAMP DEFAULT NOW(),
    UNIQUE(model_name, version)
);

-- ============================================================================
-- 2.17  SPRINT MONITORING & DELAY PREDICTION
-- ============================================================================
CREATE TABLE sprint_progress_snapshots (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sprint_id               UUID NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    snapshot_date           DATE NOT NULL,
    day_number              INT NOT NULL,                    -- day 1, 2, 3... of sprint
    -- Ideal vs actual
    ideal_points_remaining  DECIMAL(6,2),
    actual_points_remaining DECIMAL(6,2),
    points_completed_today  INT DEFAULT 0,
    -- Velocity
    current_velocity        DECIMAL(6,2),
    required_velocity       DECIMAL(6,2),
    velocity_gap_pct        DECIMAL(5,2),                   -- % behind required velocity
    -- Task counts
    tasks_total             INT DEFAULT 0,
    tasks_done              INT DEFAULT 0,
    tasks_in_progress       INT DEFAULT 0,
    tasks_blocked           INT DEFAULT 0,
    -- AI prediction
    predicted_completion_date DATE,
    delay_risk_score        DECIMAL(5,2),                   -- 0-100
    delay_predicted_days    INT DEFAULT 0,
    created_at              TIMESTAMP DEFAULT NOW(),
    UNIQUE(sprint_id, snapshot_date)
);

CREATE TABLE delay_alerts (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sprint_id               UUID NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    task_id                 UUID REFERENCES tasks(id),
    developer_id            UUID REFERENCES developer_profiles(id),
    alert_type              VARCHAR(50) NOT NULL,            -- sprint_delay, task_overdue, velocity_drop, blocker
    severity                VARCHAR(20) DEFAULT 'warning',   -- info, warning, critical
    title                   VARCHAR(300) NOT NULL,
    message                 TEXT NOT NULL,
    predicted_delay_days    INT DEFAULT 0,
    suggestion              TEXT,
    suggestion_action       VARCHAR(50),                     -- move_to_next_sprint, reassign, reduce_scope
    target_task_id          UUID REFERENCES tasks(id),
    acknowledged            BOOLEAN DEFAULT FALSE,
    acknowledged_by         UUID REFERENCES team_members(id),
    acknowledged_at         TIMESTAMP,
    action_taken            TEXT,
    jira_updated            BOOLEAN DEFAULT FALSE,
    created_at              TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 2.18  STANDUP MEETINGS
-- ============================================================================
CREATE TABLE standup_entries (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sprint_id           UUID NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    developer_id        UUID NOT NULL REFERENCES developer_profiles(id),
    entry_date          DATE NOT NULL DEFAULT CURRENT_DATE,
    raw_input           TEXT NOT NULL,                       -- what dev wrote/said
    input_channel       VARCHAR(30) DEFAULT 'slack',         -- slack, web, teams, voice
    -- AI extracted fields
    completed_work      TEXT,
    planned_work        TEXT,
    blockers            TEXT,
    ai_summary          TEXT,
    has_blockers        BOOLEAN DEFAULT FALSE,
    blocker_task_ids    UUID[] DEFAULT '{}',
    processed           BOOLEAN DEFAULT FALSE,
    processed_at        TIMESTAMP,
    created_at          TIMESTAMP DEFAULT NOW(),
    UNIQUE(sprint_id, developer_id, entry_date)
);

CREATE TABLE standup_summaries (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sprint_id           UUID NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    summary_date        DATE NOT NULL DEFAULT CURRENT_DATE,
    total_members       INT DEFAULT 0,
    members_reported    INT DEFAULT 0,
    team_summary        TEXT NOT NULL,
    key_blockers        TEXT,
    key_achievements    TEXT,
    action_items        TEXT,
    jira_tickets_created INT DEFAULT 0,
    slack_posted        BOOLEAN DEFAULT FALSE,
    slack_message_ts    VARCHAR(50),
    generated_at        TIMESTAMP DEFAULT NOW(),
    UNIQUE(sprint_id, summary_date)
);

-- ============================================================================
-- 2.19  SPRINT REPORTS
-- ============================================================================
CREATE TABLE sprint_reports (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sprint_id                   UUID NOT NULL UNIQUE REFERENCES sprints(id),
    generated_by                VARCHAR(20) DEFAULT 'ai',
    -- Summary stats
    total_story_points          INT DEFAULT 0,
    completed_story_points      INT DEFAULT 0,
    completion_rate             DECIMAL(5,2),
    velocity                    DECIMAL(6,2),
    avg_velocity_last_3         DECIMAL(6,2),
    -- Quality
    bugs_found                  INT DEFAULT 0,
    bugs_resolved               INT DEFAULT 0,
    -- Team
    most_productive_developer   UUID REFERENCES developer_profiles(id),
    biggest_blocker_task        UUID REFERENCES tasks(id),
    -- AI narrative
    executive_summary           TEXT,
    achievements                TEXT,
    challenges                  TEXT,
    retrospective_notes         TEXT,
    recommendations             TEXT,
    -- Charts data (stored as JSON for rendering)
    burndown_data               JSONB DEFAULT '[]',
    velocity_trend_data         JSONB DEFAULT '[]',
    developer_contribution_data JSONB DEFAULT '[]',
    task_distribution_data      JSONB DEFAULT '[]',
    -- Export
    pdf_url                     TEXT,
    confluence_page_url         TEXT,
    published                   BOOLEAN DEFAULT FALSE,
    published_at                TIMESTAMP,
    created_at                  TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 2.20  SKILL GAP ANALYSIS
-- ============================================================================
CREATE TABLE skill_gap_log (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id          UUID REFERENCES projects(id),
    task_id             UUID REFERENCES tasks(id) ON DELETE CASCADE,
    required_skill      VARCHAR(100) NOT NULL,
    gap_type            VARCHAR(50) DEFAULT 'no_developer',  -- no_developer, no_capacity, no_availability
    occurrence_count    INT DEFAULT 1,
    business_impact     VARCHAR(50) DEFAULT 'medium',
    logged_at           TIMESTAMP DEFAULT NOW()
);

CREATE TABLE skill_gap_reports (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id              UUID REFERENCES projects(id),
    period_start            DATE NOT NULL,
    period_end              DATE NOT NULL,
    missing_skills          JSONB NOT NULL DEFAULT '[]',     -- [{skill, count, impact, recommendation}]
    total_affected_tasks    INT DEFAULT 0,
    total_affected_sprints  INT DEFAULT 0,
    ai_recommendations      TEXT,
    hiring_suggestions      JSONB DEFAULT '[]',
    training_suggestions    JSONB DEFAULT '[]',
    generated_at            TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 2.21  JIRA INTEGRATION
-- ============================================================================
CREATE TABLE jira_integration (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    base_url            VARCHAR(300) NOT NULL,
    project_key         VARCHAR(50) NOT NULL,
    auth_type           VARCHAR(30) DEFAULT 'api_token',     -- api_token, oauth2
    api_token_encrypted TEXT,
    oauth_access_token  TEXT,
    oauth_refresh_token TEXT,
    oauth_expires_at    TIMESTAMP,
    is_active           BOOLEAN DEFAULT TRUE,
    last_sync_at        TIMESTAMP,
    sync_status         VARCHAR(30) DEFAULT 'idle',          -- idle, syncing, error
    sync_error          TEXT,
    field_mappings      JSONB DEFAULT '{}',                  -- custom Jira field → internal field
    webhook_id          VARCHAR(100),
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

CREATE TABLE jira_sync_log (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sync_type           VARCHAR(50) NOT NULL,                -- full_sync, incremental, webhook
    direction           VARCHAR(20) NOT NULL,                -- inbound, outbound, bidirectional

    -- Per-action (outbound task sync) details (optional)
    action              VARCHAR(80),                         -- createIssue, updateStatus, etc
    task_id             UUID,
    jira_issue_key      VARCHAR(60),
    request_payload     JSONB,
    response_payload    JSONB,
    error_message       TEXT,

    records_synced      INT DEFAULT 0,
    records_failed      INT DEFAULT 0,
    status              VARCHAR(30) DEFAULT 'success',       -- success, partial, failed
    error_details       JSONB DEFAULT '[]',
    started_at          TIMESTAMP DEFAULT NOW(),
    completed_at        TIMESTAMP,
    duration_ms         INT
);

-- Tracks last sync per Jira project/board (for multi-project incremental sync UI)
CREATE TABLE jira_project_sync_state (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_key     VARCHAR(50) NOT NULL,
    board_id        VARCHAR(50) NOT NULL DEFAULT '',
    last_synced_at  TIMESTAMP,
    last_mode       VARCHAR(30),
    last_status     VARCHAR(30),
    last_error      TEXT,
    updated_at      TIMESTAMP DEFAULT NOW(),
    UNIQUE(project_key, board_id)
);

-- Stores a single daily auto-sync schedule for Jira (per org tenant DB)
CREATE TABLE jira_sync_schedule (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    enabled         BOOLEAN DEFAULT FALSE,
    project_key     VARCHAR(50),
    board_id        VARCHAR(50),
    mode            VARCHAR(30) DEFAULT 'incremental',
    time_of_day     TIME DEFAULT '09:00',
    timezone        VARCHAR(50) DEFAULT 'UTC',
    updated_at      TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 2.22  GITHUB INTEGRATION
-- ============================================================================
CREATE TABLE github_integration (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    github_org          VARCHAR(200) NOT NULL,
    repo_name           VARCHAR(200),
    access_token_enc    TEXT,
    webhook_secret_enc  TEXT,
    is_active           BOOLEAN DEFAULT TRUE,
    last_event_at       TIMESTAMP,
    created_at          TIMESTAMP DEFAULT NOW()
);

CREATE TABLE github_repos (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    github_repo_id      BIGINT,
    owner_connection_id UUID REFERENCES github_integration(id) ON DELETE SET NULL,
    name                VARCHAR(200) NOT NULL,
    full_name           VARCHAR(260) NOT NULL,
    description         TEXT,
    private             BOOLEAN DEFAULT FALSE,
    language            VARCHAR(80),
    stars               INT DEFAULT 0,
    html_url            TEXT,
    synced_at           TIMESTAMP,
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW(),
    UNIQUE(full_name)
);

CREATE TABLE goals (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title               VARCHAR(300) NOT NULL,
    description         TEXT,
    status              VARCHAR(30) NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','completed')),
    priority            VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (priority IN ('high','medium','low')),
    quarter             VARCHAR(10),
    category            VARCHAR(80),
    due_date            DATE,
    progress            INT NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    project_id          UUID REFERENCES projects(id) ON DELETE SET NULL,
    created_by          UUID REFERENCES team_members(id),
    key_results         JSONB DEFAULT '[]'::jsonb,
    activity_log        JSONB DEFAULT '[]'::jsonb,
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

CREATE TABLE goal_assignees (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    goal_id             UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
    created_at          TIMESTAMP DEFAULT NOW(),
    UNIQUE(goal_id, user_id)
);

CREATE TABLE goal_repos (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    goal_id             UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    repo_id             UUID NOT NULL REFERENCES github_repos(id) ON DELETE CASCADE,
    created_at          TIMESTAMP DEFAULT NOW(),
    UNIQUE(goal_id, repo_id)
);

CREATE TABLE goal_sprints (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    goal_id             UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    sprint_id           UUID NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    created_at          TIMESTAMP DEFAULT NOW(),
    UNIQUE(goal_id, sprint_id)
);

CREATE TABLE github_events (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type          VARCHAR(50) NOT NULL,                -- push, pull_request, review, issue
    repo_name           VARCHAR(200),
    developer_id        UUID REFERENCES developer_profiles(id),
    task_id             UUID REFERENCES tasks(id),
    github_pr_number    INT,
    github_commit_sha   VARCHAR(60),
    branch_name         VARCHAR(200),
    additions           INT DEFAULT 0,
    deletions           INT DEFAULT 0,
    review_state        VARCHAR(30),                         -- approved, changes_requested, commented
    event_at            TIMESTAMP NOT NULL,
    raw_payload         JSONB DEFAULT '{}',
    created_at          TIMESTAMP DEFAULT NOW()
);

CREATE TABLE github_pr_events (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pr_number           INT NOT NULL,
    repo                VARCHAR(200) NOT NULL,
    author              VARCHAR(120),
    reviewer            VARCHAR(120),
    opened_at           TIMESTAMP,
    review_requested_at TIMESTAMP,
    first_review_at     TIMESTAMP,
    approved_at         TIMESTAMP,
    merged_at           TIMESTAMP,
    sprint_id           UUID REFERENCES sprints(id),
    task_id             UUID REFERENCES tasks(id),
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW(),
    UNIQUE(repo, pr_number)
);

CREATE TABLE pr_review_weekly_summary (
    id                                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    week_start                          TIMESTAMP NOT NULL,
    week_end                            TIMESTAMP NOT NULL,
    group_by                            VARCHAR(30) NOT NULL,   -- reviewer, project, sprint
    group_key                           VARCHAR(200) NOT NULL,
    avg_time_to_first_review_minutes    DECIMAL(10,2),
    avg_time_to_approval_minutes        DECIMAL(10,2),
    avg_time_to_merge_minutes           DECIMAL(10,2),
    sample_size                         INT DEFAULT 0,
    created_at                          TIMESTAMP DEFAULT NOW(),
    updated_at                          TIMESTAMP DEFAULT NOW(),
    UNIQUE(week_start, week_end, group_by, group_key)
);

CREATE TABLE github_auto_task_rules (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    create_from_issues      BOOLEAN DEFAULT TRUE,
    create_from_unlinked_prs BOOLEAN DEFAULT TRUE,
    sprint_ready_label      VARCHAR(80) DEFAULT 'sprint-ready',
    label_mappings          JSONB DEFAULT '{"bug":"bug","enhancement":"story","task":"task"}',
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW()
);

CREATE TABLE developer_api_keys (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                    VARCHAR(140) NOT NULL,
    key_prefix              VARCHAR(20) NOT NULL,
    key_last4               VARCHAR(8) NOT NULL,
    key_value               TEXT NOT NULL,
    created_by              UUID REFERENCES team_members(id) ON DELETE SET NULL,
    last_used_at            TIMESTAMP,
    is_active               BOOLEAN DEFAULT TRUE,
    revoked_at              TIMESTAMP,
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW()
);

CREATE TABLE developer_webhooks (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    endpoint_url            TEXT NOT NULL,
    events                  TEXT[] DEFAULT '{}',
    is_active               BOOLEAN DEFAULT TRUE,
    last_triggered_at       TIMESTAMP,
    created_by              UUID REFERENCES team_members(id) ON DELETE SET NULL,
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 2.23  NOTIFICATIONS
-- ============================================================================
CREATE TABLE notifications (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recipient_member_id UUID NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
    type                VARCHAR(50) NOT NULL,                -- task_assigned, delay_alert, sprint_started, report_ready, burnout_alert
    title               VARCHAR(300) NOT NULL,
    body                TEXT,
    action_url          TEXT,
    reference_id        UUID,
    reference_type      VARCHAR(50),
    is_read             BOOLEAN DEFAULT FALSE,
    read_at             TIMESTAMP,
    channel             VARCHAR(30) DEFAULT 'in_app',        -- in_app, email, slack
    channel_sent        BOOLEAN DEFAULT FALSE,
    channel_sent_at     TIMESTAMP,
    created_at          TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 2.24  ORG-LEVEL AUDIT LOG
-- ============================================================================
CREATE TABLE org_audit_log (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_member_id     UUID REFERENCES team_members(id),
    action              VARCHAR(100) NOT NULL,
    resource_type       VARCHAR(50),
    resource_id         UUID,
    old_value           JSONB,
    new_value           JSONB,
    ip_address          INET,
    user_agent          TEXT,
    created_at          TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 2.25  SELF-LEARNING — RETRAINING PIPELINE LOGS
-- ============================================================================
CREATE TABLE model_retraining_jobs (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_name          VARCHAR(100) NOT NULL,
    trigger_type        VARCHAR(50) DEFAULT 'scheduled',     -- scheduled, manual, sprint_end
    trigger_sprint_id   UUID REFERENCES sprints(id),
    status              VARCHAR(30) DEFAULT 'pending',       -- pending, running, success, failed
    sprints_in_dataset  INT,
    new_model_version   VARCHAR(50),
    old_model_version   VARCHAR(50),
    old_mae             DECIMAL(6,4),
    new_mae             DECIMAL(6,4),
    improvement_pct     DECIMAL(5,2),
    model_activated     BOOLEAN DEFAULT FALSE,
    error_message       TEXT,
    started_at          TIMESTAMP,
    completed_at        TIMESTAMP,
    created_at          TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 2.26  WEBHOOK EVENTS (inbound)
-- ============================================================================
CREATE TABLE webhook_events (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source              VARCHAR(50) NOT NULL,                -- jira, github, slack
    event_type          VARCHAR(100) NOT NULL,
    payload             JSONB NOT NULL,
    processed           BOOLEAN DEFAULT FALSE,
    retry_count         INT DEFAULT 0,
    max_retries         INT DEFAULT 3,
    next_retry_at       TIMESTAMP,
    dlq                 BOOLEAN DEFAULT FALSE,
    processed_at        TIMESTAMP,
    processing_error    TEXT,
    created_at          TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 2.27  SEARCH INDEX (full-text search across tasks)
-- ============================================================================
CREATE TABLE search_index (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resource_type       VARCHAR(50) NOT NULL,                -- task, backlog_item, sprint, developer
    resource_id         UUID NOT NULL,
    title               TEXT,
    body                TEXT,
    tags                TEXT[] DEFAULT '{}',
    search_vector       TSVECTOR,
    updated_at          TIMESTAMP DEFAULT NOW(),
    UNIQUE(resource_type, resource_id)
);

-- ============================================================================
-- Per-Org DB — ALL INDEXES
-- ============================================================================

-- Developer profiles
CREATE INDEX idx_dev_profiles_member        ON developer_profiles(member_id);
CREATE INDEX idx_dev_profiles_merit         ON developer_profiles(merit_score DESC);
CREATE INDEX idx_dev_profiles_status        ON developer_profiles(availability_status);
CREATE INDEX idx_dev_profiles_tech          ON developer_profiles USING GIN(tech_stack);
CREATE INDEX idx_dev_availability_dates     ON developer_availability(developer_id, start_date, end_date);

-- Tasks
CREATE INDEX idx_tasks_sprint               ON tasks(sprint_id);
CREATE INDEX idx_tasks_assignee             ON tasks(assignee_id);
CREATE INDEX idx_tasks_status               ON tasks(status);
CREATE INDEX idx_tasks_project              ON tasks(project_id);
CREATE INDEX idx_tasks_tech_tags            ON tasks USING GIN(tech_tags);
CREATE INDEX idx_tasks_jira                 ON tasks(jira_issue_id);
CREATE UNIQUE INDEX uq_tasks_project_issue  ON tasks(project_id, github_issue_number) WHERE github_issue_number IS NOT NULL;
CREATE UNIQUE INDEX uq_tasks_project_pr     ON tasks(project_id, github_pr_number) WHERE github_pr_number IS NOT NULL;

-- Sprints
CREATE INDEX idx_sprints_project            ON sprints(project_id);
CREATE INDEX idx_sprints_status             ON sprints(status);

-- Backlog
CREATE INDEX idx_backlog_project            ON backlog_items(project_id);
CREATE INDEX idx_backlog_sprint             ON backlog_items(sprint_id);
CREATE INDEX idx_backlog_tech_tags          ON backlog_items USING GIN(tech_tags);
CREATE UNIQUE INDEX uq_backlog_project_issue ON backlog_items(project_id, github_issue_number) WHERE github_issue_number IS NOT NULL;

-- Assignment
CREATE INDEX idx_assignment_log_task        ON assignment_log(task_id);
CREATE INDEX idx_assignment_log_dev         ON assignment_log(developer_id);
CREATE INDEX idx_assignment_failures_skill  ON assignment_failures USING GIN(required_tech_tags);

-- Merit
CREATE INDEX idx_merit_history_dev          ON merit_score_history(developer_id, calculated_at DESC);
CREATE INDEX idx_sprint_perf_dev            ON sprint_performance(developer_id);
CREATE INDEX idx_sprint_perf_sprint         ON sprint_performance(sprint_id);

-- Monitoring
CREATE INDEX idx_progress_sprint_date       ON sprint_progress_snapshots(sprint_id, snapshot_date);
CREATE INDEX idx_delay_alerts_sprint        ON delay_alerts(sprint_id, created_at DESC);

-- Standup
CREATE INDEX idx_standup_entries_sprint     ON standup_entries(sprint_id, entry_date);
CREATE INDEX idx_standup_entries_dev        ON standup_entries(developer_id);

-- Notifications
CREATE INDEX idx_notifications_recipient    ON notifications(recipient_member_id, is_read, created_at DESC);

-- Audit
CREATE INDEX idx_org_audit_action           ON org_audit_log(action, created_at DESC);
CREATE INDEX idx_org_audit_actor            ON org_audit_log(actor_member_id);

-- GitHub events
CREATE INDEX idx_github_events_dev          ON github_events(developer_id, event_at DESC);
CREATE INDEX idx_github_events_task         ON github_events(task_id);
CREATE INDEX idx_github_pr_events_repo_pr   ON github_pr_events(repo, pr_number);
CREATE INDEX idx_github_pr_events_reviewer  ON github_pr_events(reviewer);
CREATE INDEX idx_github_pr_events_task      ON github_pr_events(task_id);
CREATE INDEX idx_pr_review_weekly_group     ON pr_review_weekly_summary(group_by, group_key);
CREATE INDEX idx_github_repos_owner         ON github_repos(owner_connection_id);

-- Goals
CREATE INDEX idx_goals_status               ON goals(status);
CREATE INDEX idx_goals_project              ON goals(project_id);
CREATE INDEX idx_goal_assignees_goal        ON goal_assignees(goal_id);
CREATE INDEX idx_goal_sprints_goal          ON goal_sprints(goal_id);
CREATE INDEX idx_goal_repos_goal            ON goal_repos(goal_id);
CREATE INDEX idx_projects_space_order       ON projects(space_order, created_at DESC);
CREATE INDEX idx_projects_space_archived    ON projects(is_space_archived);
CREATE INDEX idx_projects_default_space     ON projects(is_default_space);
CREATE INDEX idx_dev_api_keys_active        ON developer_api_keys(is_active, created_at DESC);
CREATE INDEX idx_dev_webhooks_active        ON developer_webhooks(is_active, created_at DESC);
CREATE INDEX idx_webhook_events_retry_due   ON webhook_events(next_retry_at) WHERE processed = FALSE AND dlq = FALSE;
CREATE INDEX idx_webhook_events_dlq         ON webhook_events(dlq, created_at DESC);

-- Skill gap
CREATE INDEX idx_skill_gap_skill            ON skill_gap_log(required_skill, logged_at DESC);

-- Search
CREATE INDEX idx_search_vector             ON search_index USING GIN(search_vector);
CREATE INDEX idx_search_resource           ON search_index(resource_type, resource_id);

-- ============================================================================
-- HELPER VIEWS
-- ============================================================================

-- Active sprint summary
CREATE VIEW v_active_sprint_summary AS
SELECT
    s.id,
    s.project_id,
    s.name,
    s.sprint_number,
    s.start_date,
    s.end_date,
    s.planned_points,
    s.completed_points,
    s.ai_risk_score,
    ROUND((s.completed_points::DECIMAL / NULLIF(s.planned_points, 0)) * 100, 2) AS completion_pct,
    COUNT(t.id) AS total_tasks,
    COUNT(t.id) FILTER (WHERE t.status = 'done') AS done_tasks,
    COUNT(t.id) FILTER (WHERE t.status = 'blocked') AS blocked_tasks,
    (s.end_date - CURRENT_DATE) AS days_remaining
FROM sprints s
LEFT JOIN tasks t ON t.sprint_id = s.id
WHERE s.status = 'active'
GROUP BY s.id;

-- Developer leaderboard
CREATE VIEW v_developer_leaderboard AS
SELECT
    dp.id,
    tm.full_name,
    tm.avatar_url,
    dp.primary_role,
    dp.tech_stack,
    dp.merit_score,
    dp.avg_completion_rate,
    dp.avg_code_quality_score,
    dp.avg_pr_review_hours,
    dp.avg_peer_rating,
    dp.current_sprint_load,
    dp.max_sprint_capacity,
    ROUND((dp.current_sprint_load::DECIMAL / NULLIF(dp.max_sprint_capacity, 0)) * 100, 2) AS load_pct,
    dp.burnout_risk_flag,
    dp.availability_status
FROM developer_profiles dp
JOIN team_members tm ON tm.id = dp.member_id
WHERE tm.is_active = TRUE
ORDER BY dp.merit_score DESC;

-- Sprint burndown data
CREATE VIEW v_sprint_burndown AS
SELECT
    sprint_id,
    snapshot_date,
    day_number,
    ideal_points_remaining,
    actual_points_remaining,
    delay_risk_score,
    delay_predicted_days,
    velocity_gap_pct
FROM sprint_progress_snapshots
ORDER BY sprint_id, day_number;

-- Skill gap frequency
CREATE VIEW v_skill_gap_frequency AS
SELECT
    required_skill,
    COUNT(*) AS total_gaps,
    MAX(logged_at) AS last_occurred,
    SUM(occurrence_count) AS total_occurrences
FROM skill_gap_log
WHERE logged_at >= NOW() - INTERVAL '90 days'
GROUP BY required_skill
ORDER BY total_occurrences DESC;

-- Team capacity overview
CREATE VIEW v_team_capacity AS
SELECT
    tm.full_name,
    dp.primary_role,
    dp.tech_stack,
    dp.max_sprint_capacity,
    dp.current_sprint_load,
    (dp.max_sprint_capacity - dp.current_sprint_load) AS remaining_capacity,
    ROUND((dp.current_sprint_load::DECIMAL / NULLIF(dp.max_sprint_capacity, 0)) * 100, 2) AS utilization_pct,
    dp.availability_status,
    dp.merit_score,
    dp.burnout_risk_flag
FROM developer_profiles dp
JOIN team_members tm ON tm.id = dp.member_id
WHERE tm.is_active = TRUE
  AND dp.availability_status = 'available'
ORDER BY remaining_capacity DESC;

-- ============================================================================
-- STORED PROCEDURES
-- ============================================================================

-- Recalculate merit score for a developer after a sprint
CREATE OR REPLACE FUNCTION calculate_merit_score(
    p_developer_id UUID,
    p_sprint_id UUID
) RETURNS DECIMAL AS $$
DECLARE
    v_weights       JSONB;
    v_tech_score    DECIMAL := 0;
    v_comp_rate     DECIMAL := 0;
    v_code_qual     DECIMAL := 0;
    v_pr_speed      DECIMAL := 0;
    v_peer_rating   DECIMAL := 0;
    v_final_score   DECIMAL := 0;
    v_prev_score    DECIMAL := 0;
    v_sp            sprint_performance%ROWTYPE;
BEGIN
    SELECT merit_weights INTO v_weights FROM org_settings LIMIT 1;

    SELECT * INTO v_sp
    FROM sprint_performance
    WHERE developer_id = p_developer_id AND sprint_id = p_sprint_id;

    -- Completion rate (0-100)
    v_comp_rate := COALESCE(v_sp.completion_rate, 0);

    -- Code quality (0-100)
    v_code_qual := COALESCE(v_sp.code_quality_score, 0);

    -- PR review speed: normalize (lower hours = higher score)
    IF COALESCE(v_sp.avg_pr_review_hours, 0) = 0 THEN
        v_pr_speed := 50;
    ELSE
        v_pr_speed := LEAST(100, 100 / v_sp.avg_pr_review_hours * 8);
    END IF;

    -- Peer rating (1-5 → 0-100)
    v_peer_rating := COALESCE(v_sp.avg_peer_rating, 50) * 20;

    -- Tech stack match (pulled from last assignment average)
    SELECT COALESCE(AVG(tech_match_score), 50) INTO v_tech_score
    FROM assignment_log
    WHERE developer_id = p_developer_id
    AND assigned_at >= NOW() - INTERVAL '90 days';

    -- Weighted final score
    v_final_score := (
        v_tech_score  * (v_weights->>'tech_stack_match')::DECIMAL  +
        v_comp_rate   * (v_weights->>'completion_rate')::DECIMAL   +
        v_code_qual   * (v_weights->>'code_quality')::DECIMAL      +
        v_pr_speed    * (v_weights->>'pr_review_speed')::DECIMAL   +
        v_peer_rating * (v_weights->>'peer_rating')::DECIMAL
    );

    -- Get previous score
    SELECT merit_score INTO v_prev_score
    FROM developer_profiles WHERE id = p_developer_id;

    -- Store in history
    INSERT INTO merit_score_history (
        developer_id, sprint_id,
        tech_stack_match_score, completion_rate_score,
        code_quality_score, pr_review_speed_score, peer_rating_score,
        calculated_merit_score, previous_merit_score, score_delta, weights_used
    ) VALUES (
        p_developer_id, p_sprint_id,
        v_tech_score, v_comp_rate, v_code_qual, v_pr_speed, v_peer_rating,
        v_final_score, v_prev_score, (v_final_score - v_prev_score), v_weights
    );

    -- Update developer profile
    UPDATE developer_profiles
    SET merit_score = v_final_score,
        merit_score_updated_at = NOW(),
        avg_completion_rate = v_comp_rate,
        avg_code_quality_score = v_code_qual,
        avg_pr_review_hours = v_sp.avg_pr_review_hours,
        avg_peer_rating = v_peer_rating / 20,
        updated_at = NOW()
    WHERE id = p_developer_id;

    RETURN v_final_score;
END;
$$ LANGUAGE plpgsql;

-- Check burnout risk after each sprint
CREATE OR REPLACE FUNCTION check_burnout_risk(p_developer_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_threshold     INT;
    v_consecutive   INT := 0;
    v_avg_overload  DECIMAL := 0;
    v_is_burnout    BOOLEAN := FALSE;
BEGIN
    SELECT burnout_sprint_threshold INTO v_threshold FROM org_settings LIMIT 1;

    SELECT
        COUNT(*),
        AVG(ROUND((story_points_assigned::DECIMAL / NULLIF(max_capacity_pts, 0)) * 100, 2))
    INTO v_consecutive, v_avg_overload
    FROM (
        SELECT story_points_assigned, max_capacity_pts
        FROM sprint_performance
        WHERE developer_id = p_developer_id
          AND over_capacity = TRUE
        ORDER BY created_at DESC
        LIMIT v_threshold
    ) recent;

    IF v_consecutive >= v_threshold THEN
        v_is_burnout := TRUE;

        UPDATE developer_profiles
        SET burnout_risk_flag = TRUE,
            consecutive_over_capacity = v_consecutive,
            assignment_weight = 0.70,
            updated_at = NOW()
        WHERE id = p_developer_id;

        INSERT INTO burnout_alerts (
            developer_id, consecutive_over_sprints,
            avg_overload_percentage, alert_level
        ) VALUES (
            p_developer_id, v_consecutive,
            v_avg_overload,
            CASE WHEN v_consecutive >= v_threshold * 2 THEN 'critical' ELSE 'warning' END
        );
    END IF;

    RETURN v_is_burnout;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tasks_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_developer_profiles_updated_at
    BEFORE UPDATE ON developer_profiles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_sprints_updated_at
    BEFORE UPDATE ON sprints
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Auto-update search index on task insert/update
CREATE OR REPLACE FUNCTION update_task_search_index()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO search_index (resource_type, resource_id, title, body, tags, search_vector)
    VALUES (
        'task', NEW.id,
        NEW.title, NEW.description, NEW.tech_tags,
        to_tsvector('english', COALESCE(NEW.title,'') || ' ' || COALESCE(NEW.description,''))
    )
    ON CONFLICT (resource_type, resource_id) DO UPDATE
    SET title = NEW.title,
        body = NEW.description,
        tags = NEW.tech_tags,
        search_vector = to_tsvector('english', COALESCE(NEW.title,'') || ' ' || COALESCE(NEW.description,'')),
        updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tasks_search_index
    AFTER INSERT OR UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION update_task_search_index();

-- ============================================================================
-- SAMPLE SEED DATA (Org DB)
-- ============================================================================

-- Org settings
INSERT INTO org_settings (org_id, sprint_duration_weeks, working_hours_per_day)
VALUES ('00000000-0000-0000-0000-000000000001', 2, 8);

-- Sample team members
INSERT INTO team_members (global_user_id, email, full_name, role, job_title, github_username) VALUES
('00000000-0000-0000-0000-000000000010', 'alice@company.com',   'Alice Kumar',   'developer', 'Senior Frontend Developer', 'alice-dev'),
('00000000-0000-0000-0000-000000000011', 'bob@company.com',     'Bob Martin',    'developer', 'Backend Engineer',          'bob-backend'),
('00000000-0000-0000-0000-000000000012', 'charlie@company.com', 'Charlie Singh', 'developer', 'Full Stack Developer',      'charlie-fs'),
('00000000-0000-0000-0000-000000000013', 'diana@company.com',   'Diana Patel',   'qa',        'QA Engineer',               'diana-qa'),
('00000000-0000-0000-0000-000000000014', 'evan@company.com',    'Evan Lee',      'manager',   'Engineering Manager',       'evan-mgr');

-- Sample developer profiles
INSERT INTO developer_profiles (member_id, tech_stack, skill_levels, primary_role, max_sprint_capacity, merit_score, avg_completion_rate)
SELECT id, '{"React","TypeScript","Tailwind","GraphQL"}', '{"React":"expert","TypeScript":"expert"}', 'Frontend', 20, 87.4, 94.0 FROM team_members WHERE email='alice@company.com';

INSERT INTO developer_profiles (member_id, tech_stack, skill_levels, primary_role, max_sprint_capacity, merit_score, avg_completion_rate)
SELECT id, '{"Node.js","Python","PostgreSQL","Redis","Docker"}', '{"Node.js":"expert","Python":"intermediate"}', 'Backend', 20, 91.2, 96.0 FROM team_members WHERE email='bob@company.com';

INSERT INTO developer_profiles (member_id, tech_stack, skill_levels, primary_role, max_sprint_capacity, merit_score, avg_completion_rate)
SELECT id, '{"React","Node.js","TypeScript","MongoDB","AWS"}', '{"React":"intermediate","Node.js":"expert"}', 'Fullstack', 18, 79.8, 88.0 FROM team_members WHERE email='charlie@company.com';

INSERT INTO developer_profiles (member_id, tech_stack, skill_levels, primary_role, max_sprint_capacity, merit_score, avg_completion_rate)
SELECT id, '{"Selenium","Cypress","Jest","Postman","Python"}', '{"Selenium":"expert","Cypress":"expert"}', 'QA', 16, 83.1, 91.0 FROM team_members WHERE email='diana@company.com';

-- ============================================================================
-- END OF SQL SCHEMA
-- Architecture: universal_db + org_{id}_db per tenant
-- Total Tables: 45 | Views: 5 | Functions: 2 | Triggers: 5
-- ============================================================================
