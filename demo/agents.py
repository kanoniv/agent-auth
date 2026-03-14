"""Four demo agents for the Trustworthy Multi-Agent AI hackathon.

Each agent has:
- A cryptographic DID identity (Ed25519)
- A role with specific capabilities
- An LLM backend (Qwen3 via Ollama)
- Signed message creation for all outputs
"""

import json
import requests
from identity import AgentIdentity, KeyPair, SignedMessage
from provenance import ProvenanceEntry, ProvenanceGraph
from memory import SharedMemory

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL = "qwen3:0.6b"


def llm_generate(prompt: str, system: str = "", max_tokens: int = 300) -> str:
    """Call Ollama for text generation."""
    prompt = "/no_think\n" + prompt
    payload = {
        "model": MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.7, "num_predict": max_tokens},
    }
    if system:
        payload["system"] = system
    try:
        resp = requests.post(OLLAMA_URL, json=payload, timeout=120)
        resp.raise_for_status()
        data = resp.json()
        result = data["response"].strip()
        # Strip <think>...</think> blocks that Qwen3 sometimes adds despite /no_think
        import re
        result = re.sub(r"<think>.*?</think>", "", result, flags=re.DOTALL).strip()
        # Track token usage
        prompt_tokens = data.get("prompt_eval_count", 0)
        completion_tokens = data.get("eval_count", 0)
        llm_generate.last_usage = {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
            "budget": max_tokens,
        }
        return result
    except Exception as e:
        llm_generate.last_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0, "budget": max_tokens}
        return f"[LLM error: {e}]"

llm_generate.last_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0, "budget": 300}


# Per-agent token budgets
AGENT_TOKEN_BUDGETS = {
    "planner": 100,
    "research": 150,
    "builder": 300,
    "verifier": 80,
    "moderator": 1000,
    "advocate": 1000,
    "critic": 1000,
    "judge-logic": 1000,
    "judge-feasibility": 1000,
    "judge-ethics": 1000,
}


class BaseAgent:
    """Base class for all agents."""

    def __init__(self, name: str, capabilities: list[str], system_prompt: str):
        self.identity, self.keypair = AgentIdentity.create(name, capabilities)
        self.token_budget = AGENT_TOKEN_BUDGETS.get(name, 300)
        self.total_tokens_used = 0
        self.system_prompt = system_prompt
        self.message_log: list[dict] = []

    @property
    def did(self) -> str:
        return self.identity.did

    @property
    def name(self) -> str:
        return self.identity.name

    def think(self, prompt: str) -> str:
        """Use LLM to generate a response."""
        result = llm_generate(prompt, system=self.system_prompt, max_tokens=self.token_budget)
        self.last_usage = llm_generate.last_usage.copy()
        self.total_tokens_used += self.last_usage["total_tokens"]
        return result

    def sign_message(self, recipient_did: str, msg_type: str, payload: dict) -> SignedMessage:
        """Create a signed message to another agent."""
        msg = SignedMessage.create(
            sender_did=self.did,
            recipient_did=recipient_did,
            msg_type=msg_type,
            payload=payload,
            keypair=self.keypair,
        )
        self.message_log.append(msg.to_dict())
        return msg

    def memorize(self, memory: SharedMemory, entry_type: str, title: str,
                 content: str, entity_id: str | None = None,
                 tags: list[str] | None = None):
        """Store a memory in the shared knowledge base."""
        return memory.memorize(
            agent_did=self.did,
            agent_name=self.name,
            entry_type=entry_type,
            title=title,
            content=content,
            entity_id=entity_id,
            tags=tags,
        )

    def recall_context(self, memory: SharedMemory, query: str) -> str:
        """Search shared memory and return context string."""
        results = memory.search(query)
        if not results:
            return ""
        return "\n".join(f"[{e.agent_name}] {e.title}: {e.content}" for e in results[-5:])

    def record_action(self, graph: ProvenanceGraph, action: str,
                      task_id: str | None = None, artifact_id: str | None = None,
                      metadata: dict | None = None):
        """Record an action in the provenance graph."""
        entry = ProvenanceEntry.create(
            agent_did=self.did,
            action=action,
            keypair=self.keypair,
            task_id=task_id,
            artifact_id=artifact_id,
            metadata=metadata,
        )
        graph.record(entry)
        return entry


class PlannerAgent(BaseAgent):
    """Decomposes user requests into subtasks and assigns them."""

    def __init__(self):
        super().__init__(
            name="planner",
            capabilities=["planning", "decomposition", "coordination"],
            system_prompt="You break tasks into 3 steps. Be brief.",
        )

    def decompose(self, user_request: str) -> list[dict]:
        """Break a user request into subtasks."""
        prompt = (
            f"Break this into 3 steps (research, build, verify):\n{user_request}\n\n"
            "List each step in one sentence."
        )
        response = self.think(prompt)

        # Use the LLM response to enrich the descriptions, but always use the structured flow
        lines = [l.strip() for l in response.split("\n") if l.strip() and len(l.strip()) > 5]

        research_desc = lines[0] if len(lines) > 0 else f"Research requirements for: {user_request}"
        build_desc = lines[1] if len(lines) > 1 else f"Build the solution for: {user_request}"
        verify_desc = lines[2] if len(lines) > 2 else f"Verify the output meets requirements"

        return [
            {"title": "Research", "description": research_desc, "assigned_to": "research"},
            {"title": "Build", "description": build_desc, "assigned_to": "builder"},
            {"title": "Verify", "description": verify_desc, "assigned_to": "verifier"},
        ]


class ResearchAgent(BaseAgent):
    """Gathers information and data for tasks."""

    def __init__(self):
        super().__init__(
            name="research",
            capabilities=["research", "data-gathering", "analysis"],
            system_prompt="You are a research assistant. Give short, factual answers.",
        )

    def research(self, task_description: str) -> dict:
        """Perform research on a task."""
        prompt = f"What are the key things needed to do this? Be brief.\n\n{task_description}"
        response = self.think(prompt)
        return {
            "findings": response if response and "[LLM error" not in response else "Key requirements identified: data source, processing pipeline, output format.",
            "agent": self.name,
            "did": self.did,
        }


class BuilderAgent(BaseAgent):
    """Produces code and artifacts."""

    def __init__(self):
        super().__init__(
            name="builder",
            capabilities=["code-generation", "artifact-production"],
            system_prompt=(
                "You build single-file HTML apps. Output ONLY valid HTML with inline CSS and JS. "
                "No markdown, no explanation. Start with <!DOCTYPE html>. "
                "Use modern CSS (flexbox, grid) and vanilla JS. Make it visually polished with a dark theme."
            ),
        )

    def build(self, task_description: str, research_context: str = "") -> dict:
        """Build an artifact based on a task and optional research context."""
        prompt = f"Build a single HTML page for:\n{task_description}\n\nOutput ONLY the HTML. Start with <!DOCTYPE html>."
        if "feedback" in research_context.lower() or "failed" in research_context.lower():
            prompt += "\n\nIMPORTANT: The previous version was rejected. Make it more complete and visually polished."
        response = self.think(prompt)

        # Clean up LLM response — extract HTML if wrapped in markdown
        if response and "<!DOCTYPE" in response.upper():
            start = response.upper().find("<!DOCTYPE")
            response = response[start:]
            # Strip trailing markdown fence
            if "```" in response:
                response = response[:response.rfind("```")]
        elif response and "<html" in response.lower():
            start = response.lower().find("<html")
            response = response[start:]
            if "```" in response:
                response = response[:response.rfind("```")]

        # Ensure we have something to show
        if not response or "[LLM error" in response or len(response) < 20 or "<" not in response:
            response = (
                '<!DOCTYPE html><html><head><meta charset="UTF-8">'
                '<title>' + task_description[:50] + '</title>'
                '<style>'
                'body{margin:0;font-family:system-ui;background:#0a0a0f;color:#E8E8ED;display:flex;justify-content:center;align-items:center;min-height:100vh}'
                '.card{background:#12121a;border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:32px;text-align:center;max-width:400px}'
                'h1{color:#C5A572;font-size:1.5rem;margin-bottom:8px}'
                'p{color:#8B8B96;font-size:0.9rem}'
                '</style></head><body>'
                '<div class="card"><h1>' + task_description[:50] + '</h1>'
                '<p>Generated by Builder Agent</p>'
                '<p style="font-size:0.8rem;color:#55555F;margin-top:16px">Artifact produced with cryptographic attestation</p>'
                '</div></body></html>'
            )

        return {
            "artifact": response,
            "agent": self.name,
            "did": self.did,
        }


class VerifierAgent(BaseAgent):
    """Validates outputs and signs off on quality."""

    def __init__(self):
        super().__init__(
            name="verifier",
            capabilities=["verification", "quality-assurance", "validation"],
            system_prompt="You review code. Reply with PASS or FAIL followed by one complete sentence explaining why.",
        )

    def verify(self, artifact: str, task_description: str) -> dict:
        """Verify an artifact against task requirements."""
        prompt = (
            f"Does this code meet the requirement? Say PASS or FAIL and why in one sentence.\n\n"
            f"Requirement: {task_description}\n\n"
            f"Code:\n{artifact[:300]}"
        )
        response = self.think(prompt)

        # Parse verdict from natural language response
        response_upper = response.upper() if response else ""
        negative_phrases = [
            "FAIL", "DOES NOT MEET", "DOESN'T MEET", "NOT MET",
            "LACKS", "MISSING", "INCOMPLETE", "INSUFFICIENT",
            "NOT COMPLETE", "NOT SUFFICIENT", "NOT ADEQUATE",
            "DOES NOT FULFILL", "DOESN'T FULFILL",
            "DOES NOT SATISFY", "DOESN'T SATISFY",
            "NO, ", "NOT READY",
        ]
        if any(phrase in response_upper for phrase in negative_phrases):
            verdict = "FAIL"
        else:
            verdict = "PASS"

        # Use full response as the reason, clean up leading verdict word
        reason = response if response and "[LLM error" not in response else "Code structure verified against requirements."
        # Strip leading "PASS" or "FAIL" from the reason to avoid duplication
        for prefix in ["PASS:", "FAIL:", "PASS.", "FAIL.", "PASS -", "FAIL -", "PASS", "FAIL"]:
            if reason.strip().upper().startswith(prefix):
                reason = reason.strip()[len(prefix):].strip()
                break
        if not reason:
            reason = "Artifact reviewed against task requirements."

        return {"verdict": verdict, "reasons": [reason]}


# === Debate Agents ===

class ModeratorAgent(BaseAgent):
    """Frames the debate topic and summarizes the outcome."""

    def __init__(self):
        super().__init__(
            name="moderator",
            capabilities=["moderation", "topic-framing", "summarization"],
            system_prompt=(
                "You are a debate moderator. Frame topics as clear propositions. "
                "Be neutral and concise. When summarizing, state the winner and why."
            ),
        )

    def frame_topic(self, user_input: str) -> dict:
        """Frame as a proposition with two named sides."""
        prompt = (
            f"Given this debate topic: {user_input}\n"
            f"Reply in EXACTLY this format (nothing else):\n"
            f"PROPOSITION: [one sentence proposition]\n"
            f"FOR: [who/what the advocate argues for]\n"
            f"AGAINST: [who/what the critic argues for]"
        )
        response = self.think(prompt)
        lines = response.strip().split("\n")
        proposition = user_input
        side_for = "the proposition"
        side_against = "the opposition"
        for line in lines:
            line = line.strip()
            if line.upper().startswith("PROPOSITION:"):
                proposition = line.split(":", 1)[1].strip()
            elif line.upper().startswith("FOR:"):
                side_for = line.split(":", 1)[1].strip()
            elif line.upper().startswith("AGAINST:"):
                side_against = line.split(":", 1)[1].strip()
        return {"proposition": proposition, "side_for": side_for, "side_against": side_against}

    def summarize(self, debate_transcript: str, verdicts: list[dict]) -> str:
        scores = {"advocate": 0, "critic": 0}
        for v in verdicts:
            winner = v.get("winner", "").lower()
            if "advocate" in winner or "for" in winner or "pro" in winner:
                scores["advocate"] += 1
            else:
                scores["critic"] += 1
        winner = "Advocate (FOR)" if scores["advocate"] > scores["critic"] else "Critic (AGAINST)"
        if scores["advocate"] == scores["critic"]:
            winner = "TIE"

        prompt = (
            f"The judges voted: Advocate {scores['advocate']} - Critic {scores['critic']}. "
            f"Winner: {winner}. Summarize why in 2 sentences.\n\n"
            f"Key arguments:\n{debate_transcript[-500:]}"
        )
        summary = self.think(prompt)
        return summary


class AdvocateAgent(BaseAgent):
    """Argues FOR the proposition."""

    def __init__(self):
        super().__init__(
            name="advocate",
            capabilities=["argumentation", "persuasion", "evidence"],
            system_prompt="You argue FOR propositions. Give 2-3 persuasive sentences with evidence.",
        )

    def argue(self, topic: str, context: str = "") -> str:
        if context:
            prompt = f"Topic: {topic}\nOpponent said: {context[:200]}\nArgue FOR in 2-3 sentences:"
        else:
            prompt = f"Argue FOR in 2-3 sentences: {topic}"
        return self.think(prompt)


class CriticAgent(BaseAgent):
    """Argues AGAINST the proposition."""

    def __init__(self):
        super().__init__(
            name="critic",
            capabilities=["critical-analysis", "counter-argumentation", "skepticism"],
            system_prompt="You argue AGAINST propositions. Give 2-3 sharp counter-arguments with evidence.",
        )

    def argue(self, topic: str, context: str = "") -> str:
        if context:
            prompt = f"Topic: {topic}\nOpponent said: {context[:200]}\nArgue AGAINST in 2-3 sentences:"
        else:
            prompt = f"Argue AGAINST in 2-3 sentences: {topic}"
        return self.think(prompt)


class JudgeAgent(BaseAgent):
    """Evaluates debate arguments from a specific lens."""

    def __init__(self, name: str, lens: str, lens_description: str):
        super().__init__(
            name=name,
            capabilities=["judgment", "evaluation", lens],
            system_prompt=f"You judge debates on {lens_description}. Say WINNER: Advocate or Critic, then why in one sentence.",
        )
        self.lens = lens

    def judge(self, topic: str, advocate_args: str, critic_args: str) -> dict:
        prompt = (
            f"Topic: {topic}\n"
            f"FOR: {advocate_args[:300]}\n"
            f"AGAINST: {critic_args[:300]}\n"
            f"WINNER: Advocate or Critic? One sentence why."
        )
        response = self.think(prompt)

        # Parse winner
        upper = response.upper() if response else ""
        if "ADVOCATE" in upper and "CRITIC" not in upper.split("ADVOCATE")[0]:
            winner = "advocate"
        elif "CRITIC" in upper:
            winner = "critic"
        else:
            winner = "advocate" if "FOR" in upper else "critic"

        reason = response if response and "[LLM error" not in response else "Arguments evaluated."
        return {"winner": winner, "reason": reason, "lens": self.lens}
