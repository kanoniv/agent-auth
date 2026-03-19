import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Globe,
  CheckCircle2,
  Clock,
  Shield,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Copy,
  Check,
  KeyRound,
  Scale,
  Activity,
  Eye,
  Play,
  Loader2,
  XCircle,
  Fingerprint,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { GOLD } from '@/lib/constants';

// ---------------------------------------------------------------------------
// Crypto helpers - Ed25519 verification in the browser via WebCrypto
// ---------------------------------------------------------------------------

function b64urlToBytes(s: string): Uint8Array {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  return bytes;
}

function canonicalJson(obj: Record<string, unknown>, compact = true): string {
  const sep = compact ? [',', ':'] : [', ', ': '];
  const keys = Object.keys(obj).sort();
  const parts = keys.map(k => {
    const val = obj[k];
    const serialized = typeof val === 'object' && val !== null
      ? canonicalJson(val as Record<string, unknown>, compact)
      : JSON.stringify(val);
    return `${JSON.stringify(k)}${sep[1]}${serialized}`;
  });
  return `{${parts.join(sep[0])}}`;
}

type VerifyResult = { verified: true; ms: number } | { verified: false; error: string };

async function verifyEd25519(
  pubBytes: Uint8Array,
  sigBytes: Uint8Array,
  payloadBytes: Uint8Array,
): Promise<VerifyResult> {
  const start = performance.now();
  try {
    const key = await crypto.subtle.importKey('raw', pubBytes.buffer as ArrayBuffer, { name: 'Ed25519' } as Algorithm, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'Ed25519' } as Algorithm, key, sigBytes.buffer as ArrayBuffer, payloadBytes.buffer as ArrayBuffer);
    const ms = performance.now() - start;
    if (ok) return { verified: true, ms: Math.round(ms * 100) / 100 };
    return { verified: false, error: 'Signature invalid' };
  } catch (e) {
    return { verified: false, error: e instanceof Error ? e.message : 'WebCrypto Ed25519 not supported' };
  }
}

// ---------------------------------------------------------------------------
// Verifiable delegation data from the actual interop thread
// ---------------------------------------------------------------------------

interface VerifiableChain {
  engine: string;
  delegations: {
    label: string;
    publicKey: string;
    keyEncoding: 'base64url' | 'hex';
    signature: string;
    sigEncoding: 'base64url' | 'hex';
    payload: Record<string, unknown>;
    compact: boolean;
  }[];
  scopeNarrowing: { parent: string[]; child: string[] };
}

const CHAINS: Record<string, VerifiableChain> = {
  kanoniv: {
    engine: 'Kanoniv',
    delegations: [
      {
        label: 'Human -> Coordinator',
        publicKey: 'O8l3UUd1AyylJd8AYG_PMq_3yx1y18JRCUJSqJYFbxo=',
        keyEncoding: 'base64url',
        signature: 'o1TcsSfrSwdnbDhrNOsMoPaPHKDnjynJas4upOWmwrWAPpwBxOw0TJ44fsVzDiJtKUA4fM8DotcLv95ra6azAw==',
        sigEncoding: 'base64url',
        payload: {
          created_at: '2026-03-18T20:24:36.000Z',
          delegate: 'did:key:z6Mkw7QgaQRzrookrBMqXieZKYG8DoT8KjUJkFhDYjMZyEEK',
          delegator: 'did:key:z6MkiUeH31224B5RxNFWsg4zVoQ4udGhEoTnvka9fKUK6MzR',
          expires_at: '2026-03-25T20:24:36.000Z',
          scopes: ['search', 'memory.read', 'memory.write', 'resolve', 'delegate'],
        },
        compact: false,
      },
      {
        label: 'Coordinator -> Researcher',
        publicKey: '94DUBnHhZl6javmYK67Os4l-gSpU8wJyBVV_ZkXv4Rg=',
        keyEncoding: 'base64url',
        signature: 'g4EKkWQGXyNU9dUW4pRyBzQTKbADTUEuZZ_iJuvlG4dNBx3wQUYZ74QXUR5a6I16gEb9MdN85WVt06SfBRQ8DQ==',
        sigEncoding: 'base64url',
        payload: {
          created_at: '2026-03-18T20:24:36.000Z',
          delegate: 'did:key:z6MkiEVa7rFTL9RKreitJXH6qqLv6Gqdrc9TjBcyS8aW7FAU',
          delegator: 'did:key:z6Mkw7QgaQRzrookrBMqXieZKYG8DoT8KjUJkFhDYjMZyEEK',
          expires_at: '2026-03-19T20:24:36.000Z',
          parent_delegation: 'del-1',
          scopes: ['search', 'memory.read'],
        },
        compact: false,
      },
    ],
    scopeNarrowing: {
      parent: ['search', 'memory.read', 'memory.write', 'resolve', 'delegate'],
      child: ['search', 'memory.read'],
    },
  },
  aps: {
    engine: 'APS',
    delegations: [
      {
        label: 'Human -> Coordinator',
        publicKey: '0c8cde5278f7c806c6f8e3a61e1ce213f63295fde1bc0cc101c4a6cfcb108494',
        keyEncoding: 'hex',
        signature: '7878762446a61a2039bf5d70839c0adbddcff0c6771a90172383737e56aadc2a1613f7368897d9e456916abf42e0db9d89c14f9912b5a7de6dd3057bbfc6e300',
        sigEncoding: 'hex',
        payload: {
          createdAt: '2026-03-18T19:46:25.092Z',
          currentDepth: 0,
          delegatedBy: '0c8cde5278f7c806c6f8e3a61e1ce213f63295fde1bc0cc101c4a6cfcb108494',
          delegatedTo: '428c9697e9eda0aef0ddece63b5754a47f58c741db777bc434723ea439c9696e',
          delegationId: 'del_57f949a7-d49',
          expiresAt: '2026-03-25T19:46:25.092Z',
          maxDepth: 2,
          scope: ['search', 'memory.read', 'memory.write', 'analysis'],
          spendLimit: 1000,
          spentAmount: 0,
        },
        compact: true,
      },
      {
        label: 'Coordinator -> Researcher',
        publicKey: '428c9697e9eda0aef0ddece63b5754a47f58c741db777bc434723ea439c9696e',
        keyEncoding: 'hex',
        signature: '359f8dfbc4f2371978b119dee7c539b88a7cdd2e6a6c2ee460eeb474bce1a6c84205423d1f2b755641c6997e1dad1b97d616f16e9384f10a60154d86dbe94f0c',
        sigEncoding: 'hex',
        payload: {
          createdAt: '2026-03-18T19:46:25.094Z',
          currentDepth: 1,
          delegatedBy: '428c9697e9eda0aef0ddece63b5754a47f58c741db777bc434723ea439c9696e',
          delegatedTo: '93fefbc439378f2128c15b7b106ad3a8b1c52cf27b4de08cf26aa79fd4138368',
          delegationId: 'del_a6450f39-58e',
          expiresAt: '2026-03-19T19:46:25.094Z',
          maxDepth: 2,
          scope: ['search', 'memory.read'],
          spendLimit: 200,
          spentAmount: 0,
        },
        compact: true,
      },
    ],
    scopeNarrowing: {
      parent: ['search', 'memory.read', 'memory.write', 'analysis'],
      child: ['search', 'memory.read'],
    },
  },
  aip: {
    engine: 'AIP',
    delegations: [
      {
        label: 'Root -> Coordinator',
        publicKey: '0p0YbBBzefDTm_tT6GPPGzVoPzCvBWONxomKYINw-kY=',
        keyEncoding: 'base64url',
        signature: 'tdCiDn0FtniK6HTOlF9Tpf__apY_raWyy6LA6yP9Ly4Vxc-8sE2SopW_ueIgCxbFRDHdQ7YDVWzOV_c8qCQ2Ag==',
        sigEncoding: 'base64url',
        payload: {
          created_at: '2026-03-19T00:05:41.000Z',
          delegate: 'did:key:z6MkmYMQbq5NG4wKEcwdSiXLo1CSvTRqESFrj21ef26oe55Q',
          delegator: 'did:aip:c1965a89866ecbfaad49803e6ced70fb',
          expires_at: '2026-03-26T00:05:41.000Z',
          scopes: ['resolve', 'verify', 'vouch', 'message', 'handshake'],
        },
        compact: false,
      },
      {
        label: 'Coordinator -> Researcher',
        publicKey: 'aU_GkB5sVBrjJcQ7YxUv343pJbfZX91sovK1-pDAAJc=',
        keyEncoding: 'base64url',
        signature: 'Dim060UtdvCg9Z4pWKrDJgpd02kXU8yHFRSZqAzp-nSnWsHA7JWYJlHH8VH2ufUzODLu5Ve9fAF-BghBhjppCA==',
        sigEncoding: 'base64url',
        payload: {
          created_at: '2026-03-19T00:05:41.000Z',
          delegate: 'did:key:z6MkjDMcsiec8GNzKHQBixej7gFUgMgNvRuCmmMYqXtLRziy',
          delegator: 'did:key:z6MkmYMQbq5NG4wKEcwdSiXLo1CSvTRqESFrj21ef26oe55Q',
          expires_at: '2026-03-20T00:05:41.000Z',
          parent_delegation: 'del-1',
          scopes: ['resolve', 'verify'],
        },
        compact: false,
      },
    ],
    scopeNarrowing: {
      parent: ['resolve', 'verify', 'vouch', 'message', 'handshake'],
      child: ['resolve', 'verify'],
    },
  },
};

// ---------------------------------------------------------------------------
// Engine metadata
// ---------------------------------------------------------------------------

interface Engine {
  id: string;
  name: string;
  didMethod: string;
  keyEncoding: string;
  sigEncoding: string;
  canonicalForm: string;
  trustSignal: string;
  trustDescription: string;
  color: string;
}

const ENGINES: Engine[] = [
  {
    id: 'kanoniv', name: 'Kanoniv', didMethod: 'did:key',
    keyEncoding: 'base64url', sigEncoding: 'base64url',
    canonicalForm: 'sort_keys, spaced JSON',
    trustSignal: 'Outcome-based reputation',
    trustDescription: 'Provenance-derived score from verified action history',
    color: '#C5A572',
  },
  {
    id: 'aps', name: 'APS', didMethod: 'did:aps',
    keyEncoding: 'hex', sigEncoding: 'hex',
    canonicalForm: 'sort_keys, compact JSON, camelCase',
    trustSignal: 'Structural authorization',
    trustDescription: 'Delegation chain depth + spend budget constraints',
    color: '#60A5FA',
  },
  {
    id: 'aip', name: 'AIP', didMethod: 'did:aip',
    keyEncoding: 'base64url', sigEncoding: 'base64url',
    canonicalForm: 'sort_keys, spaced JSON',
    trustSignal: 'Behavioral trust (PDR)',
    trustDescription: 'Promise-Delivery Ratio + vouch chain depth',
    color: '#A78BFA',
  },
];

function getEngine(id: string): Engine {
  return ENGINES.find(e => e.id === id)!;
}

// ---------------------------------------------------------------------------
// Decision artifacts
// ---------------------------------------------------------------------------

interface DecisionArtifact {
  scenario: string;
  action: string;
  resource: string;
  decision: 'permit' | 'deny';
  reason: string;
  trustContext: Record<string, unknown>;
}

const DECISIONS: DecisionArtifact[] = [
  {
    scenario: 'round-x-001-permit', action: 'data:read', resource: 'dataset:alpha',
    decision: 'permit',
    reason: 'Scope covers requested action + reputation above threshold (0.82 >= 0.5)',
    trustContext: { reputation_score: 0.82, reputation_threshold: 0.5, total_outcomes: 147 },
  },
  {
    scenario: 'round-x-002-deny', action: 'admin:delete', resource: 'dataset:alpha',
    decision: 'deny',
    reason: 'admin:delete not in granted scopes [data:read, data:write, search]',
    trustContext: { reputation_score: 0.82, note: 'Reputation sufficient but scope check failed first' },
  },
];

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------

const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.06 } } };
const fadeUp = { hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0 } };

// ---------------------------------------------------------------------------
// Live Verification Panel
// ---------------------------------------------------------------------------

interface DelegationResult {
  label: string;
  status: 'idle' | 'running' | 'pass' | 'fail';
  ms?: number;
  error?: string;
  payload?: string;
}

const LiveVerifier: React.FC<{ engineId: string; onClose: () => void }> = ({ engineId, onClose }) => {
  const chain = CHAINS[engineId];
  const engine = getEngine(engineId);
  const [results, setResults] = useState<DelegationResult[]>(
    chain.delegations.map(d => ({ label: d.label, status: 'idle' as const }))
  );
  const [scopeOk, setScopeOk] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);

  const runVerification = useCallback(async () => {
    setRunning(true);
    setScopeOk(null);
    const newResults: DelegationResult[] = [];

    for (let i = 0; i < chain.delegations.length; i++) {
      const d = chain.delegations[i];
      setResults(prev => prev.map((r, j) => j === i ? { ...r, status: 'running' as const } : r));

      // Decode key and signature
      const pubBytes = d.keyEncoding === 'hex' ? hexToBytes(d.publicKey) : b64urlToBytes(d.publicKey);
      const sigBytes = d.sigEncoding === 'hex' ? hexToBytes(d.signature) : b64urlToBytes(d.signature);
      const payloadStr = canonicalJson(d.payload as Record<string, unknown>, d.compact);
      const payloadBytes = new TextEncoder().encode(payloadStr);

      const result = await verifyEd25519(pubBytes, sigBytes, payloadBytes);

      const entry: DelegationResult = {
        label: d.label,
        status: result.verified ? 'pass' : 'fail',
        ms: result.verified ? result.ms : undefined,
        error: !result.verified ? result.error : undefined,
        payload: payloadStr,
      };
      newResults.push(entry);
      setResults(prev => prev.map((r, j) => j === i ? entry : r));

      // Small delay for visual effect
      await new Promise(r => setTimeout(r, 150));
    }

    // Scope narrowing check
    const parentSet = new Set(chain.scopeNarrowing.parent);
    const childScopes = chain.scopeNarrowing.child;
    const narrowingOk = childScopes.every(s => parentSet.has(s));
    setScopeOk(narrowingOk);
    setRunning(false);
  }, [chain]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="rounded-xl bg-[#0e0e16] border border-white/[.07] p-5"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Fingerprint className="w-4 h-4" style={{ color: engine.color }} />
          <span className="text-sm font-semibold text-[#E8E8ED]">
            Verify {engine.name} chain
          </span>
          <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-white/[.04] text-zinc-500">
            {engine.didMethod}
          </span>
        </div>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-400 transition-colors text-xs">
          Close
        </button>
      </div>

      {/* Delegation results */}
      <div className="space-y-3 mb-4">
        {results.map((r, i) => (
          <div key={i} className="rounded-lg bg-white/[.02] border border-white/[.04] p-3">
            <div className="flex items-center gap-2 mb-1">
              {r.status === 'idle' && <div className="w-3.5 h-3.5 rounded-full border border-zinc-700" />}
              {r.status === 'running' && <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />}
              {r.status === 'pass' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
              {r.status === 'fail' && <XCircle className="w-3.5 h-3.5 text-red-400" />}
              <span className="text-xs font-medium text-zinc-300">{r.label}</span>
              {r.ms !== undefined && (
                <span className="text-[9px] font-mono text-zinc-600 ml-auto">{r.ms}ms</span>
              )}
            </div>
            {r.payload && (
              <div className="mt-2 rounded bg-black/30 px-2.5 py-1.5 overflow-x-auto">
                <code className="text-[9px] text-zinc-500 font-mono whitespace-nowrap block">
                  {r.payload.length > 120 ? r.payload.slice(0, 120) + '...' : r.payload}
                </code>
              </div>
            )}
            {r.error && (
              <div className="mt-1 text-[10px] text-red-400">{r.error}</div>
            )}
          </div>
        ))}
      </div>

      {/* Scope narrowing */}
      {scopeOk !== null && (
        <div className="rounded-lg bg-white/[.02] border border-white/[.04] p-3 mb-4">
          <div className="flex items-center gap-2">
            {scopeOk
              ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              : <XCircle className="w-3.5 h-3.5 text-red-400" />}
            <span className="text-xs text-zinc-300">Scope narrowing</span>
          </div>
          <div className="mt-1.5 text-[9px] font-mono text-zinc-600">
            {`{${chain.scopeNarrowing.child.join(', ')}}`}
            {' \u2286 '}
            {`{${chain.scopeNarrowing.parent.join(', ')}}`}
          </div>
        </div>
      )}

      {/* Run button */}
      <button
        onClick={runVerification}
        disabled={running}
        className={cn(
          'w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-semibold transition-all',
          running
            ? 'bg-white/[.04] text-zinc-500 cursor-not-allowed'
            : 'bg-[#C5A572]/15 text-[#C5A572] hover:bg-[#C5A572]/25',
        )}
      >
        {running ? (
          <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Verifying...</>
        ) : (
          <><Play className="w-3.5 h-3.5" /> Run Ed25519 verification in browser</>
        )}
      </button>
    </motion.div>
  );
};

// ---------------------------------------------------------------------------
// Verification Matrix
// ---------------------------------------------------------------------------

const VerificationMatrix: React.FC<{
  onCellClick: (verifier: string, chain: string) => void;
  activeCell: string | null;
}> = ({ onCellClick, activeCell }) => {

  return (
    <motion.div variants={fadeUp} className="rounded-xl bg-[#12121a] border border-white/[.07] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4" style={{ color: GOLD }} />
          <span className="text-sm font-semibold text-[#E8E8ED]">Verification Matrix</span>
          <span className="text-[10px] text-emerald-400/80 bg-emerald-500/10 px-2 py-0.5 rounded-full font-medium">
            6/6 verified
          </span>
        </div>
        <span className="text-[9px] text-zinc-600">Click a cell to verify</span>
      </div>

      <div className="grid grid-cols-4 gap-1">
        {/* Header */}
        <div className="p-2" />
        {ENGINES.map(e => (
          <div key={e.id} className="p-2 text-center">
            <span className="text-[10px] font-semibold" style={{ color: e.color }}>{e.name}</span>
            <div className="text-[9px] text-zinc-600 mt-0.5">{e.didMethod}</div>
          </div>
        ))}

        {/* Rows */}
        {ENGINES.map(verifier => (
          <React.Fragment key={verifier.id}>
            <div className="p-2 flex items-center">
              <span className="text-[10px] font-semibold" style={{ color: verifier.color }}>
                {verifier.name}
              </span>
            </div>
            {ENGINES.map(chain => {
              const isSelf = verifier.id === chain.id;
              const cellKey = `${verifier.id}-${chain.id}`;
              const isActive = activeCell === chain.id;

              return (
                <button
                  key={cellKey}
                  disabled={isSelf}
                  onClick={() => !isSelf && onCellClick(verifier.id, chain.id)}
                  className={cn(
                    'p-3 flex items-center justify-center rounded-lg transition-all duration-200',
                    isSelf && 'bg-white/[.01] cursor-default',
                    !isSelf && 'bg-emerald-500/[.04] border border-emerald-500/10 cursor-pointer hover:bg-emerald-500/[.08] hover:border-emerald-500/20',
                    isActive && !isSelf && 'ring-1 ring-[#C5A572]/40 bg-emerald-500/[.08]',
                  )}
                >
                  {isSelf ? (
                    <span className="text-[10px] text-zinc-700">--</span>
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  )}
                </button>
              );
            })}
          </React.Fragment>
        ))}
      </div>

      <div className="flex items-center gap-4 mt-4 pt-3 border-t border-white/[.04]">
        <div className="flex items-center gap-1.5 text-[10px] text-zinc-600">
          <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Ed25519 cross-verified
        </div>
        <a
          href="https://github.com/kanoniv/agent-auth/issues/2"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto flex items-center gap-1 text-[10px] text-zinc-600 hover:text-[#C5A572] transition-colors"
        >
          View thread <ExternalLink className="w-2.5 h-2.5" />
        </a>
      </div>
    </motion.div>
  );
};

// ---------------------------------------------------------------------------
// Engine Cards
// ---------------------------------------------------------------------------

const EngineCard: React.FC<{ engine: Engine; expanded: boolean; onToggle: () => void }> = ({
  engine, expanded, onToggle,
}) => (
  <motion.div
    variants={fadeUp}
    className={cn(
      'rounded-xl border border-white/[.07] overflow-hidden transition-colors',
      expanded && 'border-white/[.12]',
    )}
  >
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/[.02] transition-colors"
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
        style={{ backgroundColor: engine.color + '20', color: engine.color }}
      >
        {engine.name[0]}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-[#E8E8ED]">{engine.name}</div>
        <div className="text-[10px] text-zinc-500">{engine.trustSignal}</div>
      </div>
      <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-white/[.04] text-zinc-500">
        {engine.didMethod}
      </span>
      {expanded ? <ChevronDown className="w-3.5 h-3.5 text-zinc-600" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />}
    </button>
    <AnimatePresence>
      {expanded && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
          <div className="px-4 pb-4 grid grid-cols-2 gap-2">
            <MiniDetail label="Key encoding" value={engine.keyEncoding} />
            <MiniDetail label="Sig encoding" value={engine.sigEncoding} />
            <div className="col-span-2">
              <MiniDetail label="Canonical form" value={engine.canonicalForm} />
            </div>
            <div className="col-span-2 rounded-lg bg-black/20 p-3">
              <div className="text-[9px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">Trust signal</div>
              <div className="text-xs text-zinc-300">{engine.trustDescription}</div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  </motion.div>
);

const MiniDetail: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-lg bg-black/20 px-3 py-2">
    <div className="text-[8px] font-semibold text-zinc-600 uppercase tracking-wider">{label}</div>
    <div className="text-[11px] text-zinc-400 mt-0.5 font-mono">{value}</div>
  </div>
);

// ---------------------------------------------------------------------------
// Decision Cards
// ---------------------------------------------------------------------------

const DecisionCard: React.FC<{ artifact: DecisionArtifact; index: number }> = ({ artifact, index }) => {
  const isPermit = artifact.decision === 'permit';
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(artifact, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      variants={fadeUp}
      className={cn(
        'rounded-xl border p-4',
        isPermit ? 'bg-emerald-500/[.03] border-emerald-500/10' : 'bg-red-500/[.03] border-red-500/10',
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={cn(
            'w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold',
            isPermit ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400',
          )}>
            {index + 1}
          </div>
          <span className="text-sm font-semibold text-[#E8E8ED]">{isPermit ? 'Permit' : 'Deny'}</span>
          <span className={cn(
            'text-[9px] font-mono px-2 py-0.5 rounded-full',
            isPermit ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400',
          )}>
            {artifact.action}
          </span>
        </div>
        <button onClick={handleCopy} className="text-zinc-600 hover:text-zinc-400 transition-colors" title="Copy JSON">
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
      <div className="rounded-lg bg-black/20 px-3 py-2.5 mb-2">
        <div className="text-[9px] font-semibold text-zinc-600 uppercase tracking-wider mb-1">Reason</div>
        <div className="text-xs text-zinc-300">{artifact.reason}</div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(artifact.trustContext).map(([key, val]) => (
          <span key={key} className="text-[9px] font-mono px-2 py-1 rounded-md bg-white/[.03] text-zinc-500">
            {key}: {typeof val === 'number' ? val : String(val)}
          </span>
        ))}
      </div>
    </motion.div>
  );
};

// ---------------------------------------------------------------------------
// Provenance Explainer
// ---------------------------------------------------------------------------

const ProvenanceExplainer: React.FC = () => {
  const signals = [
    { name: 'Activity', desc: 'Signed provenance entries', value: 0.9, icon: Activity },
    { name: 'Success rate', desc: 'Verified outcomes', value: 0.95, icon: CheckCircle2 },
    { name: 'Feedback', desc: 'External labels', value: 0.7, icon: Scale },
    { name: 'Tenure', desc: 'Time since first entry', value: 0.6, icon: Clock },
    { name: 'Diversity', desc: 'Action type entropy', value: 0.85, icon: KeyRound },
  ];

  return (
    <motion.div variants={fadeUp} className="rounded-xl bg-[#12121a] border border-white/[.07] p-5">
      <div className="flex items-center gap-2 mb-3">
        <Eye className="w-4 h-4" style={{ color: GOLD }} />
        <span className="text-sm font-semibold text-[#E8E8ED]">How Reputation is Derived</span>
      </div>
      <p className="text-[11px] text-zinc-500 leading-relaxed mb-4">
        Computed from the agent's signed provenance chain. Any verifier can request
        the chain and recompute the score independently. The reputation is auditable, not declared.
      </p>
      <div className="space-y-2.5">
        {signals.map(s => (
          <div key={s.name} className="flex items-center gap-3">
            <s.icon className="w-3 h-3 text-zinc-600 shrink-0" />
            <div className="flex-1">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] text-zinc-400">{s.name}</span>
                <span className="text-[9px] font-mono text-zinc-600">{s.value.toFixed(2)}</span>
              </div>
              <div className="h-1 rounded-full bg-white/[.04] overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${s.value * 100}%` }}
                  transition={{ duration: 0.8, delay: 0.3 }}
                  className="h-full rounded-full"
                  style={{ backgroundColor: GOLD }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 pt-3 border-t border-white/[.04] flex items-center justify-between">
        <span className="text-[10px] text-zinc-600">Composite</span>
        <span className="text-sm font-bold text-emerald-400 font-mono">0.82</span>
      </div>
    </motion.div>
  );
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export const InteropPage: React.FC = () => {
  const [expandedEngine, setExpandedEngine] = useState<string | null>(null);
  const [verifyingChain, setVerifyingChain] = useState<string | null>(null);

  const handleCellClick = (_verifier: string, chain: string) => {
    setVerifyingChain(prev => prev === chain ? null : chain);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {/* Convergence thesis - prominent, not buried */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-[#C5A572]/15 bg-[#C5A572]/[.03] px-6 py-5"
      >
        <div className="flex items-start gap-4">
          <Globe className="w-6 h-6 shrink-0 mt-0.5" style={{ color: GOLD }} />
          <div>
            <h1 className="text-lg font-bold text-[#E8E8ED] mb-1">Cross-Engine Interop</h1>
            <p className="text-xs text-zinc-400 leading-relaxed max-w-2xl">
              Three independent engines verified each other's Ed25519 delegation chains using
              different DID methods, encodings, and canonical forms.
              When they independently evaluate the same scenario and arrive at the same decision
              using different trust signals, that is not just interop — that is
              <span className="text-[#C5A572] font-medium"> independent trust systems converging on the same outcome</span>.
            </p>
            <div className="flex items-center gap-4 mt-3">
              {ENGINES.map(e => (
                <div key={e.id} className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: e.color }} />
                  <span className="text-[10px] font-medium" style={{ color: e.color }}>{e.name}</span>
                  <span className="text-[9px] text-zinc-600 font-mono">{e.didMethod}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Main layout */}
      <motion.div initial="hidden" animate="visible" variants={stagger} className="grid grid-cols-5 gap-4">
        {/* Left: Matrix + Live Verify + Engines (3 cols) */}
        <div className="col-span-3 space-y-4">
          <VerificationMatrix onCellClick={handleCellClick} activeCell={verifyingChain} />

          <AnimatePresence mode="wait">
            {verifyingChain && CHAINS[verifyingChain] && (
              <LiveVerifier
                key={verifyingChain}
                engineId={verifyingChain}
                onClose={() => setVerifyingChain(null)}
              />
            )}
          </AnimatePresence>

          <motion.div variants={fadeUp}>
            <div className="flex items-center gap-2 mb-3">
              <KeyRound className="w-3.5 h-3.5" style={{ color: GOLD }} />
              <span className="text-xs font-semibold text-zinc-400">Engines</span>
            </div>
            <div className="space-y-2">
              {ENGINES.map(e => (
                <EngineCard
                  key={e.id}
                  engine={e}
                  expanded={expandedEngine === e.id}
                  onToggle={() => setExpandedEngine(prev => prev === e.id ? null : e.id)}
                />
              ))}
            </div>
          </motion.div>
        </div>

        {/* Right: Decisions + Provenance (2 cols) */}
        <div className="col-span-2 space-y-4">
          <motion.div variants={fadeUp}>
            <div className="flex items-center gap-2 mb-3">
              <Scale className="w-3.5 h-3.5" style={{ color: GOLD }} />
              <span className="text-xs font-semibold text-zinc-400">Decision Artifacts</span>
              <span className="text-[10px] text-zinc-600 bg-zinc-800/50 px-2 py-0.5 rounded-full">Round X</span>
            </div>
            <div className="space-y-3">
              {DECISIONS.map((a, i) => (
                <DecisionCard key={a.scenario} artifact={a} index={i} />
              ))}
            </div>
          </motion.div>

          <ProvenanceExplainer />

          {/* Spec link */}
          <motion.div variants={fadeUp} className="rounded-xl bg-[#12121a] border border-white/[.07] p-4">
            <div className="text-[9px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">Specification</div>
            <a
              href="https://github.com/kanoniv/agent-auth/blob/main/spec/CROSS-ENGINE-VERIFICATION.md"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs text-[#C5A572] hover:text-[#D4BC94] transition-colors"
            >
              CROSS-ENGINE-VERIFICATION.md
              <ExternalLink className="w-3 h-3" />
            </a>
            <p className="text-[10px] text-zinc-600 mt-1.5">
              Formal spec documenting canonical forms, verification protocol, DID method interop,
              and the decision artifact shape.
            </p>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
};
