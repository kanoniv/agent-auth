-- Seed data for Agent Trust Observatory demo
-- 7 agents with varied profiles, delegations, provenance, outcomes, and memory

-- Agents
INSERT INTO agents (name, did, status, capabilities, description, reputation) VALUES
  ('coordinator', 'did:agent:coord-8f3a2b1c', 'online', ARRAY['orchestrate', 'delegate', 'plan'], 'Orchestration specialist - manages multi-agent workflows',
   '{"composite_score": 85, "total_actions": 47, "success_rate": 0.91, "tenure_days": 45, "action_diversity": 6, "feedback_score": 0.7}'),
  ('researcher', 'did:agent:res-4e7d9c0a', 'online', ARRAY['search', 'analyze', 'summarize'], 'Deep research agent - web search and data analysis',
   '{"composite_score": 82, "total_actions": 63, "success_rate": 0.89, "tenure_days": 38, "action_diversity": 5, "feedback_score": 0.65}'),
  ('reviewer', 'did:agent:rev-1b5f8e3d', 'idle', ARRAY['review', 'validate', 'approve', 'admin'], 'QA and validation - highest trust agent in the system',
   '{"composite_score": 88, "total_actions": 35, "success_rate": 0.94, "tenure_days": 52, "action_diversity": 4, "feedback_score": 0.8}'),
  ('analyst', 'did:agent:ana-6c2a4f7b', 'online', ARRAY['analyze', 'report', 'visualize'], 'Data analysis and reporting agent',
   '{"composite_score": 75, "total_actions": 28, "success_rate": 0.82, "tenure_days": 30, "action_diversity": 3, "feedback_score": 0.5}'),
  ('writer', 'did:agent:wrt-9d1e3b5c', 'online', ARRAY['write', 'edit', 'format'], 'Content creation and editing agent',
   '{"composite_score": 61, "total_actions": 41, "success_rate": 0.68, "tenure_days": 25, "action_diversity": 3, "feedback_score": 0.3}'),
  ('social-manager', 'did:agent:soc-7a8b2c4d', 'idle', ARRAY['post', 'schedule', 'engage', 'moderate'], 'Social media management agent',
   '{"composite_score": 67, "total_actions": 22, "success_rate": 0.73, "tenure_days": 20, "action_diversity": 4, "feedback_score": 0.4}'),
  ('ad-buyer', 'did:agent:adb-3f5e1a9c', 'offline', ARRAY['bid', 'target', 'optimize'], 'Advertising and media buying agent - still learning',
   '{"composite_score": 45, "total_actions": 15, "success_rate": 0.47, "tenure_days": 12, "action_diversity": 2, "feedback_score": -0.2}')
ON CONFLICT (name) DO NOTHING;

-- Delegations: coordinator -> researcher, writer, analyst. reviewer gets admin from system. researcher -> analyst (subset).
INSERT INTO delegations (grantor_name, agent_name, scopes, caveats) VALUES
  ('coordinator', 'researcher', ARRAY['read', 'execute', 'write'], '{"max_cost": 50, "purpose": "Research tasks"}'),
  ('coordinator', 'writer', ARRAY['write', 'execute'], '{"max_cost": 20}'),
  ('coordinator', 'analyst', ARRAY['read', 'execute'], '{}'),
  ('system', 'reviewer', ARRAY['admin', 'read', 'write', 'execute', 'delegate'], '{"system_grant": true}'),
  ('researcher', 'analyst', ARRAY['read'], '{"delegated_subset": true}'),
  ('coordinator', 'social-manager', ARRAY['write', 'execute'], '{"channels": ["twitter", "linkedin"]}'),
  ('coordinator', 'ad-buyer', ARRAY['execute'], '{"budget_limit": 100}')
ON CONFLICT DO NOTHING;

-- Provenance entries (30 entries)
INSERT INTO provenance (agent_name, agent_did, action, entity_ids, metadata) VALUES
  ('coordinator', 'did:agent:coord-8f3a2b1c', 'delegate', '{}', '{"delegated_to": "researcher", "scopes": ["read", "execute", "write"]}'),
  ('coordinator', 'did:agent:coord-8f3a2b1c', 'delegate', '{}', '{"delegated_to": "writer", "scopes": ["write", "execute"]}'),
  ('coordinator', 'did:agent:coord-8f3a2b1c', 'delegate', '{}', '{"delegated_to": "analyst", "scopes": ["read", "execute"]}'),
  ('system', NULL, 'delegate', '{}', '{"delegated_to": "reviewer", "scopes": ["admin"]}'),
  ('researcher', 'did:agent:res-4e7d9c0a', 'resolve', ARRAY['ent-001', 'ent-002'], '{"query": "competitor analysis", "sources": 5}'),
  ('researcher', 'did:agent:res-4e7d9c0a', 'resolve', ARRAY['ent-003'], '{"query": "market sizing", "sources": 3}'),
  ('researcher', 'did:agent:res-4e7d9c0a', 'merge', ARRAY['ent-001', 'ent-004'], '{"confidence": 0.92, "reason": "same entity"}'),
  ('reviewer', 'did:agent:rev-1b5f8e3d', 'resolve', ARRAY['ent-005'], '{"reviewed": true, "approved": true}'),
  ('analyst', 'did:agent:ana-6c2a4f7b', 'resolve', ARRAY['ent-006', 'ent-007'], '{"analysis_type": "trend", "data_points": 150}'),
  ('writer', 'did:agent:wrt-9d1e3b5c', 'mutate', ARRAY['ent-008'], '{"field": "summary", "action": "generate"}'),
  ('writer', 'did:agent:wrt-9d1e3b5c', 'mutate', ARRAY['ent-009'], '{"field": "description", "action": "rewrite"}'),
  ('social-manager', 'did:agent:soc-7a8b2c4d', 'mutate', ARRAY['ent-010'], '{"platform": "twitter", "action": "schedule_post"}'),
  ('ad-buyer', 'did:agent:adb-3f5e1a9c', 'mutate', ARRAY['ent-011'], '{"campaign": "spring-2026", "action": "set_bid"}'),
  ('coordinator', 'did:agent:coord-8f3a2b1c', 'resolve', ARRAY['ent-012'], '{"workflow": "content-pipeline", "step": "initiate"}'),
  ('researcher', 'did:agent:res-4e7d9c0a', 'resolve', ARRAY['ent-013', 'ent-014'], '{"query": "customer feedback analysis"}'),
  ('reviewer', 'did:agent:rev-1b5f8e3d', 'resolve', ARRAY['ent-015'], '{"reviewed": true, "approved": false, "reason": "low confidence"}'),
  ('analyst', 'did:agent:ana-6c2a4f7b', 'resolve', ARRAY['ent-016'], '{"analysis_type": "cohort"}'),
  ('coordinator', 'did:agent:coord-8f3a2b1c', 'delegate', '{}', '{"delegated_to": "social-manager", "scopes": ["write", "execute"]}'),
  ('writer', 'did:agent:wrt-9d1e3b5c', 'mutate', ARRAY['ent-017'], '{"field": "blog_post", "action": "draft"}'),
  ('researcher', 'did:agent:res-4e7d9c0a', 'resolve', ARRAY['ent-018'], '{"query": "pricing analysis", "sources": 8}'),
  ('social-manager', 'did:agent:soc-7a8b2c4d', 'mutate', ARRAY['ent-019'], '{"platform": "linkedin", "action": "publish"}'),
  ('ad-buyer', 'did:agent:adb-3f5e1a9c', 'mutate', ARRAY['ent-020'], '{"campaign": "spring-2026", "action": "adjust_targeting"}'),
  ('coordinator', 'did:agent:coord-8f3a2b1c', 'resolve', ARRAY['ent-021'], '{"workflow": "weekly-report"}'),
  ('reviewer', 'did:agent:rev-1b5f8e3d', 'resolve', ARRAY['ent-022'], '{"reviewed": true, "approved": true}'),
  ('researcher', 'did:agent:res-4e7d9c0a', 'merge', ARRAY['ent-023', 'ent-024'], '{"confidence": 0.87}'),
  ('analyst', 'did:agent:ana-6c2a4f7b', 'resolve', ARRAY['ent-025'], '{"analysis_type": "funnel"}'),
  ('writer', 'did:agent:wrt-9d1e3b5c', 'mutate', ARRAY['ent-026'], '{"field": "email_copy", "action": "generate"}'),
  ('coordinator', 'did:agent:coord-8f3a2b1c', 'delegate', '{}', '{"delegated_to": "ad-buyer", "scopes": ["execute"]}'),
  ('social-manager', 'did:agent:soc-7a8b2c4d', 'mutate', ARRAY['ent-027'], '{"platform": "twitter", "action": "engage"}'),
  ('ad-buyer', 'did:agent:adb-3f5e1a9c', 'mutate', ARRAY['ent-028'], '{"campaign": "retarget-q2", "action": "create"}')
ON CONFLICT DO NOTHING;

-- Outcome records (40 entries across agents)
INSERT INTO memory (entry_type, slug, title, content, metadata, author, subject_did) VALUES
  -- Coordinator outcomes
  ('outcome', 'out-coord-01', 'orchestrate: completed', 'Managed 3-agent research workflow', '{"action": "orchestrate", "result": "success", "reward_signal": 0.8}', 'agent:coordinator', 'did:agent:coord-8f3a2b1c'),
  ('outcome', 'out-coord-02', 'delegate: completed', 'Assigned research to researcher', '{"action": "delegate", "result": "success", "reward_signal": 0.7}', 'agent:coordinator', 'did:agent:coord-8f3a2b1c'),
  ('outcome', 'out-coord-03', 'plan: completed', 'Created content pipeline plan', '{"action": "plan", "result": "success", "reward_signal": 0.9}', 'agent:coordinator', 'did:agent:coord-8f3a2b1c'),
  ('outcome', 'out-coord-04', 'orchestrate: failed', 'Timeout waiting for writer response', '{"action": "orchestrate", "result": "failure", "reward_signal": -0.3}', 'agent:coordinator', 'did:agent:coord-8f3a2b1c'),
  ('outcome', 'out-coord-05', 'delegate: completed', 'Delegated to analyst successfully', '{"action": "delegate", "result": "success", "reward_signal": 0.6}', 'agent:coordinator', 'did:agent:coord-8f3a2b1c'),
  ('outcome', 'out-coord-06', 'orchestrate: completed', 'Multi-step workflow succeeded', '{"action": "orchestrate", "result": "success", "reward_signal": 0.85}', 'agent:coordinator', 'did:agent:coord-8f3a2b1c'),
  -- Researcher outcomes
  ('outcome', 'out-res-01', 'search: completed', 'Found 5 relevant sources', '{"action": "search", "result": "success", "reward_signal": 0.9}', 'agent:researcher', 'did:agent:res-4e7d9c0a'),
  ('outcome', 'out-res-02', 'analyze: completed', 'Competitive analysis report', '{"action": "analyze", "result": "success", "reward_signal": 0.85}', 'agent:researcher', 'did:agent:res-4e7d9c0a'),
  ('outcome', 'out-res-03', 'search: completed', 'Market sizing research', '{"action": "search", "result": "success", "reward_signal": 0.7}', 'agent:researcher', 'did:agent:res-4e7d9c0a'),
  ('outcome', 'out-res-04', 'summarize: partial', 'Summary was too verbose', '{"action": "summarize", "result": "partial", "reward_signal": 0.2}', 'agent:researcher', 'did:agent:res-4e7d9c0a'),
  ('outcome', 'out-res-05', 'analyze: completed', 'Customer feedback analysis', '{"action": "analyze", "result": "success", "reward_signal": 0.8}', 'agent:researcher', 'did:agent:res-4e7d9c0a'),
  ('outcome', 'out-res-06', 'search: failed', 'API rate limited', '{"action": "search", "result": "failure", "reward_signal": -0.5}', 'agent:researcher', 'did:agent:res-4e7d9c0a'),
  ('outcome', 'out-res-07', 'search: completed', 'Pricing analysis 8 sources', '{"action": "search", "result": "success", "reward_signal": 0.75}', 'agent:researcher', 'did:agent:res-4e7d9c0a'),
  -- Reviewer outcomes
  ('outcome', 'out-rev-01', 'review: completed', 'Approved research findings', '{"action": "review", "result": "success", "reward_signal": 0.95}', 'agent:reviewer', 'did:agent:rev-1b5f8e3d'),
  ('outcome', 'out-rev-02', 'validate: completed', 'Validated data pipeline', '{"action": "validate", "result": "success", "reward_signal": 0.9}', 'agent:reviewer', 'did:agent:rev-1b5f8e3d'),
  ('outcome', 'out-rev-03', 'review: completed', 'Caught data quality issue', '{"action": "review", "result": "success", "reward_signal": 1.0}', 'agent:reviewer', 'did:agent:rev-1b5f8e3d'),
  ('outcome', 'out-rev-04', 'approve: completed', 'Approved workflow results', '{"action": "approve", "result": "success", "reward_signal": 0.8}', 'agent:reviewer', 'did:agent:rev-1b5f8e3d'),
  ('outcome', 'out-rev-05', 'review: partial', 'Flagged merge with low confidence', '{"action": "review", "result": "partial", "reward_signal": 0.4}', 'agent:reviewer', 'did:agent:rev-1b5f8e3d'),
  -- Analyst outcomes
  ('outcome', 'out-ana-01', 'analyze: completed', 'Trend analysis report', '{"action": "analyze", "result": "success", "reward_signal": 0.7}', 'agent:analyst', 'did:agent:ana-6c2a4f7b'),
  ('outcome', 'out-ana-02', 'report: completed', 'Weekly metrics report', '{"action": "report", "result": "success", "reward_signal": 0.8}', 'agent:analyst', 'did:agent:ana-6c2a4f7b'),
  ('outcome', 'out-ana-03', 'analyze: failed', 'Insufficient data for cohort analysis', '{"action": "analyze", "result": "failure", "reward_signal": -0.4}', 'agent:analyst', 'did:agent:ana-6c2a4f7b'),
  ('outcome', 'out-ana-04', 'visualize: completed', 'Generated funnel chart', '{"action": "visualize", "result": "success", "reward_signal": 0.6}', 'agent:analyst', 'did:agent:ana-6c2a4f7b'),
  ('outcome', 'out-ana-05', 'analyze: completed', 'Funnel analysis report', '{"action": "analyze", "result": "success", "reward_signal": 0.75}', 'agent:analyst', 'did:agent:ana-6c2a4f7b'),
  -- Writer outcomes
  ('outcome', 'out-wrt-01', 'write: completed', 'Blog post draft', '{"action": "write", "result": "success", "reward_signal": 0.5}', 'agent:writer', 'did:agent:wrt-9d1e3b5c'),
  ('outcome', 'out-wrt-02', 'edit: completed', 'Edited summary', '{"action": "edit", "result": "success", "reward_signal": 0.6}', 'agent:writer', 'did:agent:wrt-9d1e3b5c'),
  ('outcome', 'out-wrt-03', 'write: failed', 'Generated off-topic content', '{"action": "write", "result": "failure", "reward_signal": -0.7}', 'agent:writer', 'did:agent:wrt-9d1e3b5c'),
  ('outcome', 'out-wrt-04', 'write: failed', 'Tone mismatch', '{"action": "write", "result": "failure", "reward_signal": -0.5}', 'agent:writer', 'did:agent:wrt-9d1e3b5c'),
  ('outcome', 'out-wrt-05', 'format: completed', 'Formatted report', '{"action": "format", "result": "success", "reward_signal": 0.4}', 'agent:writer', 'did:agent:wrt-9d1e3b5c'),
  ('outcome', 'out-wrt-06', 'write: partial', 'Email copy needed revision', '{"action": "write", "result": "partial", "reward_signal": 0.1}', 'agent:writer', 'did:agent:wrt-9d1e3b5c'),
  -- Social manager outcomes
  ('outcome', 'out-soc-01', 'post: completed', 'Scheduled Twitter thread', '{"action": "post", "result": "success", "reward_signal": 0.7}', 'agent:social-manager', 'did:agent:soc-7a8b2c4d'),
  ('outcome', 'out-soc-02', 'engage: completed', 'Responded to mentions', '{"action": "engage", "result": "success", "reward_signal": 0.6}', 'agent:social-manager', 'did:agent:soc-7a8b2c4d'),
  ('outcome', 'out-soc-03', 'schedule: failed', 'API auth expired', '{"action": "schedule", "result": "failure", "reward_signal": -0.4}', 'agent:social-manager', 'did:agent:soc-7a8b2c4d'),
  ('outcome', 'out-soc-04', 'post: completed', 'LinkedIn article published', '{"action": "post", "result": "success", "reward_signal": 0.8}', 'agent:social-manager', 'did:agent:soc-7a8b2c4d'),
  ('outcome', 'out-soc-05', 'moderate: completed', 'Flagged spam comments', '{"action": "moderate", "result": "success", "reward_signal": 0.5}', 'agent:social-manager', 'did:agent:soc-7a8b2c4d'),
  -- Ad buyer outcomes
  ('outcome', 'out-adb-01', 'bid: completed', 'Set initial campaign bid', '{"action": "bid", "result": "success", "reward_signal": 0.3}', 'agent:ad-buyer', 'did:agent:adb-3f5e1a9c'),
  ('outcome', 'out-adb-02', 'target: failed', 'Wrong audience segment', '{"action": "target", "result": "failure", "reward_signal": -0.8}', 'agent:ad-buyer', 'did:agent:adb-3f5e1a9c'),
  ('outcome', 'out-adb-03', 'optimize: failed', 'Overspent daily budget', '{"action": "optimize", "result": "failure", "reward_signal": -0.9}', 'agent:ad-buyer', 'did:agent:adb-3f5e1a9c'),
  ('outcome', 'out-adb-04', 'bid: partial', 'Bid accepted but low CTR', '{"action": "bid", "result": "partial", "reward_signal": -0.1}', 'agent:ad-buyer', 'did:agent:adb-3f5e1a9c'),
  ('outcome', 'out-adb-05', 'target: completed', 'Retargeting campaign setup', '{"action": "target", "result": "success", "reward_signal": 0.5}', 'agent:ad-buyer', 'did:agent:adb-3f5e1a9c'),
  ('outcome', 'out-adb-06', 'optimize: failed', 'CPA above threshold', '{"action": "optimize", "result": "failure", "reward_signal": -0.6}', 'agent:ad-buyer', 'did:agent:adb-3f5e1a9c')
ON CONFLICT (slug) DO NOTHING;

-- Memory entries
INSERT INTO memory (entry_type, slug, title, content, metadata, author, linked_agents) VALUES
  ('knowledge', 'know-workflow-patterns', 'Multi-agent workflow patterns',
   'The coordinator-researcher-reviewer pipeline achieves 91% success rate. Key insight: having reviewer validate before merging reduces errors by 40%.',
   '{"category": "workflow"}', 'agent:coordinator', ARRAY['coordinator', 'researcher', 'reviewer']),
  ('decision', 'dec-writer-scope', 'Limit writer to content tasks only',
   'Writer agent produces better output when scoped strictly to content. Avoid assigning data analysis tasks.',
   '{"reason": "mixed results on non-content tasks"}', 'agent:coordinator', ARRAY['writer']),
  ('pattern', 'pat-ad-buyer-struggles', 'Ad buyer learning curve is steep',
   'The ad-buyer agent struggles with budget optimization. Consider pairing with analyst for data-informed bidding.',
   '{"severity": "medium"}', 'agent:reviewer', ARRAY['ad-buyer', 'analyst']),
  ('investigation', 'inv-social-auth', 'Social media API auth investigation',
   'Social manager failed 3 scheduled posts due to expired OAuth tokens. Need to implement token refresh.',
   '{"status": "in_progress"}', 'agent:social-manager', ARRAY['social-manager']),
  ('knowledge', 'know-reputation-formula', 'Reputation score breakdown',
   'Composite score = 30% activity + 25% success rate + 20% feedback + 15% tenure + 10% diversity. Minimum 10 actions for reliable score.',
   '{"category": "system"}', 'system', '{}')
ON CONFLICT (slug) DO NOTHING;
