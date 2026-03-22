import { useState, useCallback } from 'react';
import { ShieldCheck, ShieldX, ChevronRight, Clock, Loader2 } from 'lucide-react';

interface ChainLink {
  issuer_did?: string;
  delegate_did?: string;
  agent_did?: string;
  issuer_public_key?: number[];
  caveats?: Array<{ type: string; value: unknown }>;
  proof?: {
    nonce?: string;
    payload?: Record<string, unknown>;
    signature?: string;
    signer_did?: string;
    timestamp?: string;
  };
}

interface VerifyResult {
  valid: boolean;
  agent_did?: string;
  root_did?: string;
  scopes?: string[];
  chain?: ChainLink[];
  chain_depth?: number;
  expires_at?: number;
  ttl_remaining?: number;
  error?: string;
  signature_verified?: boolean;
}

function decodeToken(token: string): Record<string, unknown> | null {
  try {
    let padded = token.trim();
    while (padded.length % 4 !== 0) padded += '=';
    const json = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

async function verifyEd25519Signature(
  publicKeyBytes: Uint8Array,
  message: Uint8Array,
  signatureHex: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      publicKeyBytes.buffer as ArrayBuffer,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    const sig = hexToBytes(signatureHex);
    return await crypto.subtle.verify('Ed25519', key, sig.buffer as ArrayBuffer, message.buffer as ArrayBuffer);
  } catch {
    return false;
  }
}

async function verifyChainLink(link: ChainLink): Promise<{ valid: boolean; error?: string }> {
  const proof = link.proof;
  if (!proof || !proof.signature || !proof.payload) {
    return { valid: false, error: 'missing proof' };
  }

  const pubKeyArray = link.issuer_public_key;
  if (!pubKeyArray || !Array.isArray(pubKeyArray) || pubKeyArray.length !== 32) {
    return { valid: false, error: 'missing or invalid issuer_public_key' };
  }

  // Reconstruct canonical envelope: {nonce, payload, signer_did, timestamp}
  const canonical = {
    nonce: proof.nonce || '',
    payload: proof.payload,
    signer_did: proof.signer_did || link.issuer_did || '',
    timestamp: proof.timestamp || '',
  };

  // Sort keys for deterministic JSON (matching Rust BTreeMap serialization)
  const sortedJson = JSON.stringify(canonical, Object.keys(canonical).sort());
  // Use compact separators matching Rust's serde_json
  const compactJson = JSON.stringify(JSON.parse(sortedJson));

  const message = new TextEncoder().encode(compactJson);
  const pubKey = new Uint8Array(pubKeyArray);

  const valid = await verifyEd25519Signature(pubKey, message, proof.signature);
  return { valid, error: valid ? undefined : 'signature verification failed' };
}

async function verifyToken(token: string): Promise<VerifyResult> {
  const data = decodeToken(token);
  if (!data) return { valid: false, error: 'Invalid token format. Paste a base64-encoded delegation token.' };

  const chain = (data.chain || data.delegation_chain || []) as ChainLink[];
  const scopes = (data.scopes || []) as string[];
  const agent_did = data.agent_did as string | undefined;
  const expires_at = data.expires_at as number | undefined;

  if (chain.length === 0) return { valid: false, error: 'Token has no delegation chain.' };

  // Check expiry
  if (expires_at) {
    const now = Date.now() / 1000;
    if (now > expires_at) {
      const ago = now - expires_at;
      return {
        valid: false,
        error: `Token expired ${formatDuration(ago)} ago.`,
        chain, scopes, agent_did, chain_depth: chain.length, expires_at,
      };
    }
  }

  // Verify each chain link signature
  let signatureVerified = true;
  let sigError: string | undefined;
  for (let i = 0; i < chain.length; i++) {
    const result = await verifyChainLink(chain[i]);
    if (!result.valid) {
      signatureVerified = false;
      sigError = `Chain link ${i}: ${result.error}`;
      break;
    }
  }

  const root_did = chain[0]?.issuer_did;
  const ttl_remaining = expires_at ? expires_at - Date.now() / 1000 : undefined;

  if (!signatureVerified) {
    return {
      valid: false,
      error: sigError,
      chain, scopes, agent_did, chain_depth: chain.length, expires_at,
      signature_verified: false,
    };
  }

  return {
    valid: true,
    agent_did,
    root_did,
    scopes,
    chain,
    chain_depth: chain.length,
    expires_at,
    ttl_remaining,
    signature_verified: true,
  };
}

function formatDuration(secs: number): string {
  if (secs < 60) return `${Math.round(secs)}s`;
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  return `${(secs / 3600).toFixed(1)}h`;
}

function truncateDid(did: string, len = 28): string {
  return did.length > len ? did.slice(0, len - 3) + '...' : did;
}

const EXAMPLE_HINT = 'Paste a delegation token or execution envelope (base64 JSON from kanoniv-auth delegate)';

export const VerifyPage: React.FC = () => {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);

  const handleVerify = useCallback(async () => {
    if (!input.trim()) return;
    setVerifying(true);
    try {
      const r = await verifyToken(input.trim());
      setResult(r);
    } finally {
      setVerifying(false);
    }
  }, [input]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleVerify();
  }, [handleVerify]);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-2">Verify Delegation</h1>
        <p className="text-[#8b949e]">
          Paste a delegation token or execution envelope. Verification happens entirely
          in your browser using WebCrypto Ed25519 - nothing is sent to any server.
        </p>
      </div>

      {/* Input */}
      <div className="mb-4">
        <textarea
          className="w-full h-32 bg-[#0d1117] border border-[#30363d] rounded-lg p-4 text-sm font-mono text-[#c9d1d9] placeholder-[#484f58] focus:border-[#f0c674] focus:outline-none resize-none"
          placeholder={EXAMPLE_HINT}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>

      <div className="flex gap-3 mb-8">
        <button
          onClick={handleVerify}
          disabled={!input.trim() || verifying}
          className="px-4 py-2 bg-[#f0c674] text-[#0d1117] rounded-lg font-medium text-sm hover:bg-[#f0d694] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {verifying && <Loader2 className="w-4 h-4 animate-spin" />}
          Verify
        </button>
        <button
          onClick={() => { setInput(''); setResult(null); }}
          className="px-4 py-2 bg-[#21262d] text-[#c9d1d9] rounded-lg text-sm hover:bg-[#30363d] transition-colors"
        >
          Clear
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className={`border rounded-lg p-6 ${
          result.valid
            ? 'border-[#238636] bg-[#0d1117]'
            : 'border-[#da3633] bg-[#0d1117]'
        }`}>
          {/* Status */}
          <div className="flex items-center gap-3 mb-6">
            {result.valid ? (
              <>
                <ShieldCheck className="w-8 h-8 text-[#3fb950]" />
                <div>
                  <span className="text-2xl font-bold text-[#3fb950]">VERIFIED</span>
                  {result.signature_verified && (
                    <span className="ml-3 text-xs text-[#3fb950] bg-[#0d1117] border border-[#238636] px-2 py-0.5 rounded">
                      Ed25519 signatures valid
                    </span>
                  )}
                </div>
              </>
            ) : (
              <>
                <ShieldX className="w-8 h-8 text-[#f85149]" />
                <span className="text-2xl font-bold text-[#f85149]">FAILED</span>
              </>
            )}
          </div>

          {result.error && (
            <p className="text-[#f85149] mb-4 text-sm">{result.error}</p>
          )}

          {/* Details table */}
          {(result.agent_did || result.scopes) && (
            <div className="space-y-3 mb-6">
              {result.agent_did && (
                <div className="flex justify-between text-sm">
                  <span className="text-[#8b949e]">Agent DID</span>
                  <code className="text-[#c9d1d9] bg-[#161b22] px-2 py-0.5 rounded">
                    {truncateDid(result.agent_did, 40)}
                  </code>
                </div>
              )}
              {result.root_did && (
                <div className="flex justify-between text-sm">
                  <span className="text-[#8b949e]">Root DID</span>
                  <code className="text-[#c9d1d9] bg-[#161b22] px-2 py-0.5 rounded">
                    {truncateDid(result.root_did, 40)}
                  </code>
                </div>
              )}
              {result.scopes && result.scopes.length > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-[#8b949e]">Scopes</span>
                  <div className="flex gap-1.5 flex-wrap justify-end">
                    {result.scopes.map(s => (
                      <span key={s} className="bg-[#161b22] text-[#f0c674] px-2 py-0.5 rounded text-xs font-mono">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {result.chain_depth !== undefined && (
                <div className="flex justify-between text-sm">
                  <span className="text-[#8b949e]">Chain Depth</span>
                  <span className="text-[#c9d1d9]">{result.chain_depth} link(s)</span>
                </div>
              )}
              {result.ttl_remaining !== undefined && result.ttl_remaining > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-[#8b949e]">Expires</span>
                  <span className="text-[#3fb950] flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {formatDuration(result.ttl_remaining)} remaining
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Chain tree */}
          {result.chain && result.chain.length > 0 && (
            <div className="border-t border-[#21262d] pt-4">
              <h3 className="text-sm font-medium text-[#8b949e] mb-3">Delegation Chain</h3>
              <div className="font-mono text-xs space-y-1">
                {result.chain.map((link, i) => {
                  const issuer = link.issuer_did || '?';
                  const delegate = link.delegate_did || link.agent_did || '?';
                  const scopes = link.caveats
                    ?.filter(c => c.type === 'action_scope')
                    .flatMap(c => (c.value as string[]) || []) || [];

                  return (
                    <div key={i}>
                      {i === 0 && (
                        <div className="text-[#8b949e]">
                          {truncateDid(issuer, 36)} <span className="text-[#484f58]">(root)</span>
                        </div>
                      )}
                      <div className="flex items-center" style={{ paddingLeft: `${(i + 1) * 16}px` }}>
                        <ChevronRight className="w-3 h-3 text-[#484f58] mr-1 flex-shrink-0" />
                        <span className="text-[#c9d1d9]">{truncateDid(delegate, 36)}</span>
                        {scopes.length > 0 && (
                          <span className="text-[#484f58] ml-2">[{scopes.join(', ')}]</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <p className="text-[#484f58] text-xs mt-4">
            Verified in browser using WebCrypto Ed25519. No server call.
            {result.signature_verified && ' All chain signatures cryptographically verified.'}
          </p>
        </div>
      )}
    </div>
  );
};
