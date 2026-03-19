-- Agent Trust - self-contained identity and reputation schema
-- This is the minimal schema needed for the observatory to work standalone.

-- Agents registry
CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    did TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'idle', 'offline')),
    capabilities TEXT[] NOT NULL DEFAULT '{}',
    description TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    reputation JSONB NOT NULL DEFAULT '{"composite_score": 50, "total_actions": 0, "success_rate": 1.0, "tenure_days": 0}',
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    registered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Delegations between agents
CREATE TABLE IF NOT EXISTS delegations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grantor_name TEXT NOT NULL,
    agent_name TEXT NOT NULL REFERENCES agents(name),
    scopes TEXT[] NOT NULL DEFAULT '{}',
    source_restrictions TEXT[],
    caveats JSONB NOT NULL DEFAULT '{}',
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_delegations_agent ON delegations(agent_name);
CREATE INDEX IF NOT EXISTS idx_delegations_grantor ON delegations(grantor_name);

-- Provenance entries - signed audit trail of agent actions
CREATE TABLE IF NOT EXISTS provenance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_name TEXT NOT NULL,
    agent_did TEXT,
    action TEXT NOT NULL,
    entity_ids TEXT[] NOT NULL DEFAULT '{}',
    parent_ids TEXT[] NOT NULL DEFAULT '{}',
    metadata JSONB NOT NULL DEFAULT '{}',
    signature TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provenance_agent ON provenance(agent_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_provenance_time ON provenance(created_at DESC);

-- Memory - decisions, outcomes, tasks, knowledge
CREATE TABLE IF NOT EXISTS memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_type TEXT NOT NULL CHECK (entry_type IN ('decision', 'investigation', 'pattern', 'knowledge', 'outcome', 'task')),
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    metadata JSONB NOT NULL DEFAULT '{}',
    linked_agents TEXT[] NOT NULL DEFAULT '{}',
    subject_did TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'resolved', 'archived')),
    author TEXT NOT NULL DEFAULT 'system',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_type ON memory(entry_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_author ON memory(author, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_status ON memory(status);
CREATE INDEX IF NOT EXISTS idx_memory_subject_did ON memory(subject_did, created_at DESC) WHERE subject_did IS NOT NULL;

-- Chat conversations
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT,
    agent_name TEXT NOT NULL DEFAULT 'observatory',
    messages JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed a system agent
INSERT INTO agents (name, description, capabilities, reputation)
VALUES ('system', 'Kanoniv system agent', ARRAY['admin'], '{"composite_score": 100, "total_actions": 0, "success_rate": 1.0, "tenure_days": 0}')
ON CONFLICT (name) DO NOTHING;
