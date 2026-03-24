-- Escalation requests from agents that hit delegation limits.
-- Created when an agent is denied (amount exceeded, low vendor confidence, etc.)
-- Managers approve/deny via Observatory UI.

CREATE TABLE IF NOT EXISTS escalations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_did TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    action TEXT NOT NULL,
    amount NUMERIC(12,2),
    vendor TEXT,
    vendor_confidence NUMERIC(4,3),
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
    invoice_data JSONB,
    approved_by TEXT,
    denial_reason TEXT,
    -- Single-use approval token (base64, 5-min TTL)
    approval_token TEXT,
    approval_token_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '12 hours'),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_escalations_status ON escalations(status);
CREATE INDEX IF NOT EXISTS idx_escalations_agent ON escalations(agent_did, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_escalations_created ON escalations(created_at DESC);
