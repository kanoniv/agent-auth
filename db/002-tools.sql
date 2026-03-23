-- Tool discovery table - stores MCP tools discovered from downstream servers
CREATE TABLE IF NOT EXISTS tools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    provider TEXT NOT NULL DEFAULT 'quickbooks',
    category TEXT NOT NULL DEFAULT 'unknown',
    risk_level TEXT DEFAULT 'low',
    risk_action TEXT,
    risk_consequences TEXT[],
    risk_compliance TEXT[],
    risk_remediation TEXT[],
    input_schema JSONB,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    call_count INTEGER NOT NULL DEFAULT 0,
    deny_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(name, provider)
);
