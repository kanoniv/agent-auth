"""Coordinator — orchestrates the 4-agent task flow with provenance tracking."""

import json
import uuid
from identity import AgentIdentity
from agents import PlannerAgent, ResearchAgent, BuilderAgent, VerifierAgent, AGENT_TOKEN_BUDGETS
from provenance import ProvenanceGraph, ProvenanceEntry
from memory import SharedMemory


class Coordinator:
    """Orchestrates the multi-agent workflow with full provenance."""

    def __init__(self):
        self.planner = PlannerAgent()
        self.research = ResearchAgent()
        self.builder = BuilderAgent()
        self.verifier = VerifierAgent()
        self.provenance = ProvenanceGraph()
        self.memory = SharedMemory()

        self.agents = {
            self.planner.did: self.planner,
            self.research.did: self.research,
            self.builder.did: self.builder,
            self.verifier.did: self.verifier,
        }

    def _event(self, event_type: str, message: str, agent_name: str = "system",
               details: dict | None = None, prov_entry: dict | None = None,
               memory_entry: dict | None = None, signed_msg: dict | None = None) -> dict:
        return {
            "type": event_type,
            "agent": agent_name,
            "message": message,
            "details": details or {},
            "prov_entry": prov_entry,
            "memory_entry": memory_entry,
            "signed_msg": signed_msg,
        }

    def run_stream(self, user_request: str):
        """Execute the workflow, yielding events as they happen."""
        task_id = str(uuid.uuid4())

        # Register agents
        for agent in [self.planner, self.research, self.builder, self.verifier]:
            entry = agent.record_action(
                self.provenance, "agent_registered",
                metadata={"name": agent.name, "capabilities": agent.identity.capabilities},
            )
            yield self._event("system", f"Agent registered: {agent.name} ({agent.did[:30]}...)",
                              agent_name=agent.name, prov_entry=entry.to_dict())

        # Step 1: Planner decomposes
        yield self._event("thinking", "Decomposing request into subtasks...", agent_name="planner")

        entry = self.planner.record_action(
            self.provenance, "task_created", task_id=task_id,
            metadata={"title": user_request},
        )
        yield self._event("provenance", "task_created", agent_name="planner", prov_entry=entry.to_dict())

        subtasks = self.planner.decompose(user_request)
        yield self._event("token_usage", f"Used {self.planner.last_usage['completion_tokens']}/{self.planner.token_budget} tokens",
                          agent_name="planner", details={"usage": self.planner.last_usage})

        # Planner memorizes the decomposition
        mem = self.planner.memorize(
            self.memory, "decision",
            title=f"Task decomposition: {user_request[:60]}",
            content=f"Decomposed into {len(subtasks)} subtasks: {', '.join(st['title'] for st in subtasks)}",
            entity_id=task_id,
            tags=["planning", "decomposition"],
        )
        yield self._event("memory", f"Memorized task plan ({len(subtasks)} subtasks)",
                          agent_name="planner", memory_entry=mem.to_dict())

        # Send signed assignments with explanation
        for st in subtasks:
            assigned_to = st.get("assigned_to", "builder")
            target_agent = self._agent_by_name(assigned_to)
            if target_agent:
                msg = self.planner.sign_message(
                    target_agent.did, "task_assignment",
                    {"subtask": st, "parent_task_id": task_id},
                )
                verified = msg.verify(self.planner.keypair.public_key_bytes)

                entry = self.planner.record_action(
                    self.provenance, "task_assigned", task_id=task_id,
                    metadata={"subtask": st["title"], "assigned_to": assigned_to},
                )

                # Show the assignment with task description
                desc = st.get("description", st["title"])
                yield self._event("message",
                                  f"Assigned '{st['title']}' to {assigned_to}: {desc} "
                                  f"[sig: {'valid' if verified else 'INVALID'}]",
                                  agent_name="planner",
                                  details={"signature": msg.signature[:20] + "...", "verified": verified},
                                  prov_entry=entry.to_dict(),
                                  signed_msg=msg.to_dict())

        # Planner allocates token budgets to agents
        budgets = {a.name: a.token_budget for a in [self.research, self.builder, self.verifier]}
        yield self._event("token_budget", "Allocated token budgets to agents",
                          agent_name="planner",
                          details={"budgets": budgets, "total_pool": sum(budgets.values())})

        yield self._event("status", f"Created {len(subtasks)} subtasks", agent_name="planner")

        # Step 2: Research
        research_context = ""
        for st in subtasks:
            if st.get("assigned_to") == "research":
                yield self._event("thinking", f"Researching: {st['title']}...", agent_name="research")

                entry = self.research.record_action(
                    self.provenance, "task_started", task_id=task_id,
                    metadata={"subtask": st["title"]},
                )
                yield self._event("provenance", "task_started", agent_name="research", prov_entry=entry.to_dict())

                # Research agent recalls any existing knowledge
                prior = self.research.recall_context(self.memory, user_request)
                if prior:
                    prior_entries = self.memory.search(user_request)
                    source_agents = list({e.agent_name for e in prior_entries})
                    attribution = ", ".join(source_agents) if source_agents else "shared memory"
                    yield self._event("memory", f"Recalled {len(prior_entries)} prior memories from {attribution}",
                                      agent_name="research")

                result = self.research.research(st["description"])
                yield self._event("token_usage", f"Used {self.research.last_usage['completion_tokens']}/{self.research.token_budget} tokens",
                                  agent_name="research", details={"usage": self.research.last_usage})
                research_context += result["findings"] + "\n\n"

                # Research memorizes findings for builder to recall
                mem = self.research.memorize(
                    self.memory, "investigation",
                    title=f"Research findings: {st['title']}",
                    content=result["findings"][:500],
                    entity_id=task_id,
                    tags=["research", "findings"],
                )
                yield self._event("memory", f"Memorized research findings",
                                  agent_name="research", memory_entry=mem.to_dict())

                artifact_id = str(uuid.uuid4())
                entry = self.research.record_action(
                    self.provenance, "artifact_produced", task_id=task_id,
                    artifact_id=artifact_id,
                    metadata={"type": "research_findings", "subtask": st["title"]},
                )
                yield self._event("provenance", "artifact_produced", agent_name="research", prov_entry=entry.to_dict())

                msg = self.research.sign_message(
                    self.builder.did, "task_result",
                    {"findings": result["findings"][:500]},
                )
                verified = msg.verify(self.research.keypair.public_key_bytes)
                yield self._event("message",
                                  f"Sent research findings to builder [sig: {'valid' if verified else 'INVALID'}]",
                                  agent_name="research",
                                  details={"verified": verified},
                                  signed_msg=msg.to_dict())

                entry = self.research.record_action(
                    self.provenance, "task_completed", task_id=task_id,
                    metadata={"subtask": st["title"]},
                )
                yield self._event("status", f"Completed: {st['title']}", agent_name="research",
                                  prov_entry=entry.to_dict())

        # Steps 3+4: Build → Verify → Retry loop (max 3 attempts)
        max_attempts = 3
        final_verdict = "PASS"
        build_task = None
        for st in subtasks:
            if st.get("assigned_to") == "builder":
                build_task = st
                break

        if build_task:
            last_artifact = None
            last_feedback = ""
            final_verdict = "FAIL"

            for attempt in range(1, max_attempts + 1):
                # === Build ===
                if attempt == 1:
                    # Builder recalls research findings from shared memory
                    recalled = self.builder.recall_context(self.memory, "research findings")
                    if recalled:
                        sources = self.memory.search("research findings")
                        source_agents = list({e.agent_name for e in sources[-5:]})
                        attribution = ", ".join(source_agents) if source_agents else "shared memory"
                        yield self._event("memory",
                                          f"Recalled research findings memorized by {attribution}",
                                          agent_name="builder")
                    yield self._event("thinking", f"Building: {build_task['title']}...", agent_name="builder")
                else:
                    yield self._event("thinking",
                                      f"Revising artifact (attempt {attempt}/{max_attempts}) based on feedback...",
                                      agent_name="planner")
                    # Planner sends feedback to builder
                    msg = self.planner.sign_message(
                        self.builder.did, "revision_request",
                        {"feedback": last_feedback, "attempt": attempt},
                    )
                    verified = msg.verify(self.planner.keypair.public_key_bytes)
                    yield self._event("message",
                                      f"Requesting revision from builder: {last_feedback} "
                                      f"[sig: {'valid' if verified else 'INVALID'}]",
                                      agent_name="planner",
                                      details={"signature": msg.signature[:20] + "...", "verified": verified},
                                      signed_msg=msg.to_dict())

                    yield self._event("thinking",
                                      f"Rebuilding with feedback: {last_feedback[:80]}...",
                                      agent_name="builder")

                entry = self.builder.record_action(
                    self.provenance, "task_started", task_id=task_id,
                    metadata={"subtask": build_task["title"], "attempt": attempt},
                )
                yield self._event("provenance", "task_started", agent_name="builder", prov_entry=entry.to_dict())

                # Build (with feedback context on retries)
                build_context = research_context
                if last_feedback:
                    build_context += f"\n\nPrevious attempt failed. Feedback: {last_feedback}"
                result = self.builder.build(build_task["description"], build_context)
                yield self._event("token_usage", f"Used {self.builder.last_usage['completion_tokens']}/{self.builder.token_budget} tokens",
                                  agent_name="builder", details={"usage": self.builder.last_usage})
                last_artifact = result

                artifact_id = str(uuid.uuid4())
                entry = self.builder.record_action(
                    self.provenance, "artifact_produced", task_id=task_id,
                    artifact_id=artifact_id,
                    metadata={"type": "code", "subtask": build_task["title"], "attempt": attempt},
                )
                yield self._event("artifact", result["artifact"], agent_name="builder", prov_entry=entry.to_dict())

                msg = self.builder.sign_message(
                    self.verifier.did, "task_result",
                    {"artifact": result["artifact"][:500]},
                )
                verified = msg.verify(self.builder.keypair.public_key_bytes)
                yield self._event("message",
                                  f"Sent artifact to verifier [sig: {'valid' if verified else 'INVALID'}]",
                                  agent_name="builder",
                                  details={"verified": verified},
                                  signed_msg=msg.to_dict())

                entry = self.builder.record_action(
                    self.provenance, "task_completed", task_id=task_id,
                    metadata={"subtask": build_task["title"], "attempt": attempt},
                )
                yield self._event("status", f"Build complete (attempt {attempt})", agent_name="builder",
                                  prov_entry=entry.to_dict())

                # === Verify ===
                yield self._event("thinking", "Verifying artifact...", agent_name="verifier")

                entry = self.verifier.record_action(
                    self.provenance, "task_started", task_id=task_id,
                    metadata={"attempt": attempt},
                )
                yield self._event("provenance", "task_started", agent_name="verifier", prov_entry=entry.to_dict())

                verification = self.verifier.verify(result["artifact"], user_request)
                yield self._event("token_usage", f"Used {self.verifier.last_usage['completion_tokens']}/{self.verifier.token_budget} tokens",
                                  agent_name="verifier", details={"usage": self.verifier.last_usage})

                entry = self.verifier.record_action(
                    self.provenance, "artifact_verified", task_id=task_id,
                    metadata={"verdict": verification.get("verdict", "UNKNOWN"),
                               "reasons": verification.get("reasons", []),
                               "attempt": attempt},
                )

                msg = self.verifier.sign_message(
                    self.planner.did, "verification_result", verification,
                )
                verified = msg.verify(self.verifier.keypair.public_key_bytes)

                verdict = verification.get("verdict", "UNKNOWN")
                reasons = ", ".join(verification.get("reasons", []))
                yield self._event("message",
                                  f"Verification: {verdict} [sig: {'valid' if verified else 'INVALID'}]",
                                  agent_name="verifier",
                                  details={"verdict": verification, "verified": verified},
                                  prov_entry=entry.to_dict(),
                                  signed_msg=msg.to_dict())

                yield self._event("verdict", reasons, agent_name="verifier")

                # Verifier memorizes the verdict
                mem = self.verifier.memorize(
                    self.memory, "decision",
                    title=f"Verification verdict (attempt {attempt}): {verdict}",
                    content=reasons,
                    entity_id=task_id,
                    tags=["verification", verdict.lower()],
                )
                yield self._event("memory", f"Memorized verdict: {verdict}",
                                  agent_name="verifier", memory_entry=mem.to_dict())

                final_verdict = verdict
                if verdict == "PASS":
                    yield self._event("status", f"Artifact approved on attempt {attempt}", agent_name="planner")
                    break
                elif attempt < max_attempts:
                    last_feedback = reasons
                    # Planner memorizes the rejection for future reference
                    mem = self.planner.memorize(
                        self.memory, "pattern",
                        title=f"Revision needed (attempt {attempt})",
                        content=f"Builder output rejected: {reasons}. Sending back for revision.",
                        entity_id=task_id,
                        tags=["revision", "feedback"],
                    )
                    yield self._event("memory", f"Memorized rejection feedback for builder",
                                      agent_name="planner", memory_entry=mem.to_dict())
                    yield self._event("status",
                                      f"Artifact rejected (attempt {attempt}/{max_attempts}). Sending back to builder.",
                                      agent_name="planner")
                else:
                    yield self._event("status",
                                      f"Artifact rejected after {max_attempts} attempts. Completing with best effort.",
                                      agent_name="planner")

        # Done
        status = "passed" if final_verdict == "PASS" else "failed_after_retries"
        entry = self.planner.record_action(
            self.provenance, "task_completed", task_id=task_id,
            metadata={"status": status, "subtask_count": len(subtasks)},
        )

        # Token usage summary
        token_summary = {
            a.name: {"used": a.total_tokens_used, "budget": a.token_budget}
            for a in [self.planner, self.research, self.builder, self.verifier]
        }
        total_used = sum(v["used"] for v in token_summary.values())
        total_budget = sum(v["budget"] for v in token_summary.values())
        yield self._event("token_summary", f"Total tokens: {total_used} used across all agents",
                          agent_name="planner",
                          details={"agents": token_summary, "total_used": total_used, "total_budget": total_budget})

        prov_export = self.provenance.export()
        prov_export["memory"] = self.memory.all_entries()
        prov_export["memory_count"] = self.memory.count()
        msg = f"Task completed — {'all checks passed' if final_verdict == 'PASS' else 'completed with issues'}"
        yield self._event("complete", msg, agent_name="planner",
                          details={"provenance": prov_export},
                          prov_entry=entry.to_dict())

    def _agent_by_name(self, name: str):
        for agent in self.agents.values():
            if agent.name == name:
                return agent
        return None
