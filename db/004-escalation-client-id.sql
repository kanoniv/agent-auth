-- Add client_id to escalations for per-client filtering.
-- Nullable because historical escalations and escalations from
-- unassigned agents won't have a client context.

ALTER TABLE escalations ADD COLUMN IF NOT EXISTS client_id UUID;
CREATE INDEX IF NOT EXISTS idx_escalations_client_id ON escalations(client_id, created_at DESC);
