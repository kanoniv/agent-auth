import { apiFetch } from '@/lib/api';

interface SeedResult {
  success: boolean;
  error?: string;
}

const DEMO_AGENTS = [
  {
    name: 'coordinator',
    capabilities: ['orchestration', 'planning', 'delegation'],
    description: 'Central orchestrator that plans multi-step workflows and delegates to specialist agents',
    did: 'did:agent:coord-9f3a1b',
  },
  {
    name: 'researcher',
    capabilities: ['web-search', 'data-collection', 'summarization'],
    description: 'Gathers information from web sources, APIs, and documents',
    did: 'did:agent:research-4e7c2d',
  },
  {
    name: 'reviewer',
    capabilities: ['code-review', 'quality-check', 'approval'],
    description: 'Reviews outputs for accuracy, safety, and quality before release',
    did: 'did:agent:review-8b1f5a',
  },
  {
    name: 'analyst',
    capabilities: ['data-analysis', 'visualization', 'statistics'],
    description: 'Performs quantitative analysis, builds charts, and extracts insights from data',
    did: 'did:agent:analyst-2d6e9c',
  },
  {
    name: 'writer',
    capabilities: ['content-creation', 'editing', 'formatting'],
    description: 'Drafts long-form content, reports, and documentation',
    did: 'did:agent:writer-7a4b3f',
  },
  {
    name: 'social-manager',
    capabilities: ['social-media', 'scheduling', 'engagement'],
    description: 'Manages social media presence, schedules posts, and monitors engagement',
    did: 'did:agent:social-1c8d5e',
  },
  {
    name: 'ad-buyer',
    capabilities: ['ad-buying', 'budget-management', 'targeting'],
    description: 'Manages advertising spend, audience targeting, and campaign optimization',
    did: 'did:agent:adbuy-6f2a7b',
  },
];

const DEMO_DELEGATIONS = [
  { grantor: 'coordinator', agent: 'researcher', scopes: ['search', 'memory.read', 'memory.write'] },
  { grantor: 'coordinator', agent: 'writer', scopes: ['memory.read', 'memory.write'] },
  { grantor: 'coordinator', agent: 'analyst', scopes: ['memory.read', 'memory.write', 'resolve'] },
  { grantor: 'system', agent: 'reviewer', scopes: ['resolve', 'search', 'merge', 'memory.read', 'memory.write', 'events'] },
  { grantor: 'researcher', agent: 'analyst', scopes: ['memory.read'] },
  { grantor: 'coordinator', agent: 'social-manager', scopes: ['memory.read', 'memory.write'] },
  { grantor: 'coordinator', agent: 'ad-buyer', scopes: ['memory.read', 'resolve'] },
];

// Outcomes keyed by agent name -> array of { action, result, reward }
// Varied counts and results to produce different reputation scores
const DEMO_OUTCOMES: Array<{
  agent_name: string;
  action: string;
  result: 'success' | 'failure' | 'partial';
  reward: number;
}> = [
  // Coordinator - mostly success, high score
  { agent_name: 'coordinator', action: 'orchestration', result: 'success', reward: 0.9 },
  { agent_name: 'coordinator', action: 'delegation', result: 'success', reward: 0.85 },
  { agent_name: 'coordinator', action: 'planning', result: 'success', reward: 0.8 },
  { agent_name: 'coordinator', action: 'orchestration', result: 'failure', reward: -0.3 },
  { agent_name: 'coordinator', action: 'delegation', result: 'success', reward: 0.7 },
  { agent_name: 'coordinator', action: 'orchestration', result: 'success', reward: 0.88 },
  // Researcher - strong performer
  { agent_name: 'researcher', action: 'web-search', result: 'success', reward: 0.92 },
  { agent_name: 'researcher', action: 'data-collection', result: 'success', reward: 0.85 },
  { agent_name: 'researcher', action: 'summarization', result: 'success', reward: 0.78 },
  { agent_name: 'researcher', action: 'web-search', result: 'success', reward: 0.88 },
  { agent_name: 'researcher', action: 'data-collection', result: 'failure', reward: -0.5 },
  { agent_name: 'researcher', action: 'summarization', result: 'success', reward: 0.82 },
  { agent_name: 'researcher', action: 'web-search', result: 'success', reward: 0.75 },
  // Reviewer - highest trust, rarely fails
  { agent_name: 'reviewer', action: 'code-review', result: 'success', reward: 0.97 },
  { agent_name: 'reviewer', action: 'quality-check', result: 'success', reward: 0.95 },
  { agent_name: 'reviewer', action: 'approval', result: 'success', reward: 0.9 },
  { agent_name: 'reviewer', action: 'code-review', result: 'success', reward: 0.88 },
  { agent_name: 'reviewer', action: 'quality-check', result: 'partial', reward: 0.4 },
  // Analyst - moderate
  { agent_name: 'analyst', action: 'data-analysis', result: 'success', reward: 0.8 },
  { agent_name: 'analyst', action: 'visualization', result: 'failure', reward: -0.4 },
  { agent_name: 'analyst', action: 'statistics', result: 'success', reward: 0.75 },
  { agent_name: 'analyst', action: 'data-analysis', result: 'success', reward: 0.7 },
  // Writer - mixed results
  { agent_name: 'writer', action: 'content-creation', result: 'success', reward: 0.6 },
  { agent_name: 'writer', action: 'editing', result: 'failure', reward: -0.7 },
  { agent_name: 'writer', action: 'formatting', result: 'success', reward: 0.5 },
  { agent_name: 'writer', action: 'content-creation', result: 'failure', reward: -0.5 },
  { agent_name: 'writer', action: 'editing', result: 'success', reward: 0.65 },
  { agent_name: 'writer', action: 'content-creation', result: 'partial', reward: 0.1 },
  // Social manager - improving
  { agent_name: 'social-manager', action: 'scheduling', result: 'success', reward: 0.7 },
  { agent_name: 'social-manager', action: 'engagement', result: 'failure', reward: -0.4 },
  { agent_name: 'social-manager', action: 'social-media', result: 'success', reward: 0.75 },
  { agent_name: 'social-manager', action: 'scheduling', result: 'success', reward: 0.8 },
  // Ad buyer - struggling
  { agent_name: 'ad-buyer', action: 'ad-buying', result: 'failure', reward: -0.8 },
  { agent_name: 'ad-buyer', action: 'targeting', result: 'failure', reward: -0.6 },
  { agent_name: 'ad-buyer', action: 'budget-management', result: 'partial', reward: -0.1 },
  { agent_name: 'ad-buyer', action: 'ad-buying', result: 'success', reward: 0.5 },
  { agent_name: 'ad-buyer', action: 'targeting', result: 'failure', reward: -0.9 },
];

export async function seedDemoData(): Promise<SeedResult> {
  try {
    // 1. Register agents (with DIDs)
    for (const agent of DEMO_AGENTS) {
      const res = await apiFetch('/v1/agents/register', {
        method: 'POST',
        body: JSON.stringify({
          name: agent.name,
          capabilities: agent.capabilities,
          description: agent.description,
          did: agent.did,
        }),
      });
      if (!res.ok && res.status !== 409) {
        const text = await res.text();
        return { success: false, error: `Failed to register "${agent.name}": ${text}` };
      }
    }

    // 2. Create delegation chains
    for (const del of DEMO_DELEGATIONS) {
      await apiFetch('/v1/delegations', {
        method: 'POST',
        headers: { 'X-Agent-Name': del.grantor },
        body: JSON.stringify({
          agent_name: del.agent,
          scopes: del.scopes,
        }),
      });
    }

    // 3. Build DID lookup from registered agents
    const didMap = new Map<string, string>();
    for (const agent of DEMO_AGENTS) {
      didMap.set(agent.name, agent.did);
    }

    // 4. Record outcomes using subject_did (what the API actually requires)
    for (const outcome of DEMO_OUTCOMES) {
      const did = didMap.get(outcome.agent_name);
      if (!did) continue;
      await apiFetch('/v1/memory/feedback', {
        method: 'POST',
        body: JSON.stringify({
          subject_did: did,
          action: outcome.action,
          result: outcome.result,
          reward_signal: outcome.reward,
        }),
      });
      // Small delay so slugs don't collide (they use Date.now())
      await new Promise(r => setTimeout(r, 5));
    }

    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error seeding demo data',
    };
  }
}
