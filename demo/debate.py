"""Debate Coordinator — orchestrates a structured agent debate with signed arguments.

Flow:
1. Moderator frames the topic
2. Two rounds: Advocate argues FOR, Critic argues AGAINST
3. Three judges evaluate independently (logic, feasibility, ethics)
4. Moderator announces the winner

Every argument, rebuttal, and verdict is cryptographically signed.
"""

import uuid
from agents import (
    ModeratorAgent, AdvocateAgent, CriticAgent, JudgeAgent,
    AGENT_TOKEN_BUDGETS, llm_generate,
)
from provenance import ProvenanceGraph
from memory import SharedMemory


class DebateCoordinator:
    """Orchestrates a multi-agent debate with full provenance."""

    def __init__(self):
        self.moderator = ModeratorAgent()
        self.advocate = AdvocateAgent()
        self.critic = CriticAgent()
        self.judge_logic = JudgeAgent("judge-logic", "logic", "logic and evidence")
        self.judge_feasibility = JudgeAgent("judge-feasibility", "feasibility", "practical feasibility")
        self.judge_ethics = JudgeAgent("judge-ethics", "ethics", "ethics and societal impact")
        self.provenance = ProvenanceGraph()
        self.memory = SharedMemory()

        self.all_agents = [
            self.moderator, self.advocate, self.critic,
            self.judge_logic, self.judge_feasibility, self.judge_ethics,
        ]

    def _event(self, event_type, message, agent_name="system",
               details=None, prov_entry=None, memory_entry=None, signed_msg=None):
        return {
            "type": event_type,
            "agent": agent_name,
            "message": message,
            "details": details or {},
            "prov_entry": prov_entry,
            "memory_entry": memory_entry,
            "signed_msg": signed_msg,
        }

    def run_stream(self, user_topic):
        """Execute the debate, yielding events as they happen."""
        debate_id = str(uuid.uuid4())
        rounds = 2

        # === Register all agents ===
        for agent in self.all_agents:
            entry = agent.record_action(
                self.provenance, "agent_registered",
                metadata={"name": agent.name, "capabilities": agent.identity.capabilities},
            )
            yield self._event("system", f"Agent registered: {agent.name} ({agent.did[:30]}...)",
                              agent_name=agent.name, prov_entry=entry.to_dict())

        # === Token budget allocation ===
        budgets = {a.name: a.token_budget for a in self.all_agents}
        yield self._event("token_budget", "Allocated token budgets to agents",
                          agent_name="moderator",
                          details={"budgets": budgets, "total_pool": sum(budgets.values())})

        # === Step 1: Moderator frames the topic ===
        yield self._event("thinking", "Framing the debate proposition...", agent_name="moderator")

        entry = self.moderator.record_action(
            self.provenance, "task_created", task_id=debate_id,
            metadata={"title": user_topic, "type": "debate"},
        )
        yield self._event("provenance", "debate_created", agent_name="moderator",
                          prov_entry=entry.to_dict())

        framing = self.moderator.frame_topic(user_topic)
        topic = framing["proposition"]
        side_for = framing["side_for"]
        side_against = framing["side_against"]

        yield self._event("token_usage",
                          f"Used {self.moderator.last_usage['completion_tokens']}/{self.moderator.token_budget} tokens",
                          agent_name="moderator", details={"usage": self.moderator.last_usage})

        # Sign and broadcast the topic with named sides
        msg = self.moderator.sign_message(
            self.advocate.did, "debate_topic",
            {"topic": topic, "side_for": side_for, "side_against": side_against, "debate_id": debate_id},
        )
        yield self._event("message",
                          f"Topic: {topic}\nFOR ({side_for}) vs AGAINST ({side_against})",
                          agent_name="moderator",
                          details={"signature": msg.signature[:20] + "...",
                                   "verified": msg.verify(self.moderator.keypair.public_key_bytes),
                                   "side_for": side_for, "side_against": side_against},
                          signed_msg=msg.to_dict())

        mem = self.moderator.memorize(
            self.memory, "decision",
            title="Debate topic framed",
            content=f"{topic} | FOR: {side_for} | AGAINST: {side_against}",
            entity_id=debate_id,
            tags=["debate", "topic"],
        )
        yield self._event("memory", f"Memorized debate topic",
                          agent_name="moderator", memory_entry=mem.to_dict())

        # === Step 2: Debate rounds ===
        advocate_args = []
        critic_args = []
        transcript = ""

        for round_num in range(1, rounds + 1):
            yield self._event("status", f"Round {round_num} of {rounds}", agent_name="moderator")

            # --- Advocate's turn ---
            yield self._event("thinking", f"Round {round_num}: Arguing for {side_for}...",
                              agent_name="advocate")

            entry = self.advocate.record_action(
                self.provenance, "task_started", task_id=debate_id,
                metadata={"round": round_num, "side": "for"},
            )
            yield self._event("provenance", "argument_started", agent_name="advocate",
                              prov_entry=entry.to_dict())

            # On round 2+, advocate responds to critic's last argument
            context = critic_args[-1] if critic_args else ""
            argument = self.advocate.argue(topic, context)
            advocate_args.append(argument)
            transcript += f"\n[Round {round_num}] ADVOCATE: {argument}\n"

            yield self._event("token_usage",
                              f"Used {self.advocate.last_usage['completion_tokens']}/{self.advocate.token_budget} tokens",
                              agent_name="advocate", details={"usage": self.advocate.last_usage})

            # Sign the argument and send to all
            msg = self.advocate.sign_message(
                self.critic.did, "debate_argument",
                {"argument": argument, "round": round_num, "side": "for"},
            )
            verified = msg.verify(self.advocate.keypair.public_key_bytes)

            entry = self.advocate.record_action(
                self.provenance, "artifact_produced", task_id=debate_id,
                artifact_id=str(uuid.uuid4()),
                metadata={"type": "argument", "round": round_num, "side": "for"},
            )

            yield self._event("argument", argument, agent_name="advocate",
                              details={"round": round_num, "side": "for",
                                       "signature": msg.signature[:20] + "...", "verified": verified},
                              prov_entry=entry.to_dict(),
                              signed_msg=msg.to_dict())

            mem = self.advocate.memorize(
                self.memory, "argument",
                title=f"Round {round_num} argument FOR",
                content=argument[:300],
                entity_id=debate_id,
                tags=["debate", "for", f"round-{round_num}"],
            )
            yield self._event("memory", f"Memorized argument",
                              agent_name="advocate", memory_entry=mem.to_dict())

            # --- Critic's turn ---
            yield self._event("thinking", f"Round {round_num}: Arguing for {side_against}...",
                              agent_name="critic")

            entry = self.critic.record_action(
                self.provenance, "task_started", task_id=debate_id,
                metadata={"round": round_num, "side": "against"},
            )
            yield self._event("provenance", "argument_started", agent_name="critic",
                              prov_entry=entry.to_dict())

            # Critic responds to advocate's argument
            argument_against = self.critic.argue(topic, advocate_args[-1])
            critic_args.append(argument_against)
            transcript += f"[Round {round_num}] CRITIC: {argument_against}\n"

            yield self._event("token_usage",
                              f"Used {self.critic.last_usage['completion_tokens']}/{self.critic.token_budget} tokens",
                              agent_name="critic", details={"usage": self.critic.last_usage})

            msg = self.critic.sign_message(
                self.advocate.did, "debate_argument",
                {"argument": argument_against, "round": round_num, "side": "against"},
            )
            verified = msg.verify(self.critic.keypair.public_key_bytes)

            entry = self.critic.record_action(
                self.provenance, "artifact_produced", task_id=debate_id,
                artifact_id=str(uuid.uuid4()),
                metadata={"type": "argument", "round": round_num, "side": "against"},
            )

            yield self._event("argument", argument_against, agent_name="critic",
                              details={"round": round_num, "side": "against",
                                       "signature": msg.signature[:20] + "...", "verified": verified},
                              prov_entry=entry.to_dict(),
                              signed_msg=msg.to_dict())

            mem = self.critic.memorize(
                self.memory, "argument",
                title=f"Round {round_num} argument AGAINST",
                content=argument_against[:300],
                entity_id=debate_id,
                tags=["debate", "against", f"round-{round_num}"],
            )
            yield self._event("memory", f"Memorized counter-argument",
                              agent_name="critic", memory_entry=mem.to_dict())

        # === Step 3: Judges evaluate ===
        yield self._event("status", "Debate concluded. Judges deliberating...", agent_name="moderator")

        advocate_full = "\n".join(advocate_args)
        critic_full = "\n".join(critic_args)
        verdicts = []

        for judge in [self.judge_logic, self.judge_feasibility, self.judge_ethics]:
            yield self._event("thinking", f"Evaluating through {judge.lens} lens...",
                              agent_name=judge.name)

            # Judge recalls the debate from memory
            recalled = judge.recall_context(self.memory, "debate argument")
            if recalled:
                yield self._event("memory", "Recalled debate arguments from shared memory",
                                  agent_name=judge.name)

            entry = judge.record_action(
                self.provenance, "task_started", task_id=debate_id,
                metadata={"role": "judge", "lens": judge.lens},
            )
            yield self._event("provenance", "judging_started", agent_name=judge.name,
                              prov_entry=entry.to_dict())

            verdict = judge.judge(topic, advocate_full, critic_full)
            verdicts.append(verdict)

            yield self._event("token_usage",
                              f"Used {judge.last_usage['completion_tokens']}/{judge.token_budget} tokens",
                              agent_name=judge.name, details={"usage": judge.last_usage})

            # Sign the verdict
            msg = judge.sign_message(
                self.moderator.did, "debate_verdict",
                verdict,
            )
            verified = msg.verify(judge.keypair.public_key_bytes)

            entry = judge.record_action(
                self.provenance, "artifact_verified", task_id=debate_id,
                metadata={"verdict": verdict["winner"], "lens": judge.lens},
            )

            winner_label = "Advocate (FOR)" if verdict["winner"] == "advocate" else "Critic (AGAINST)"
            yield self._event("verdict",
                              f"{verdict['reason']}",
                              agent_name=judge.name,
                              details={"winner": winner_label, "lens": judge.lens,
                                       "signature": msg.signature[:20] + "...", "verified": verified},
                              prov_entry=entry.to_dict(),
                              signed_msg=msg.to_dict())

            mem = judge.memorize(
                self.memory, "decision",
                title=f"Verdict ({judge.lens}): {winner_label}",
                content=verdict["reason"][:300],
                entity_id=debate_id,
                tags=["debate", "verdict", judge.lens],
            )
            yield self._event("memory", f"Memorized verdict",
                              agent_name=judge.name, memory_entry=mem.to_dict())

        # === Step 4: Moderator announces result ===
        yield self._event("thinking", "Tallying votes and announcing winner...",
                          agent_name="moderator")

        summary = self.moderator.summarize(transcript, verdicts)
        yield self._event("token_usage",
                          f"Used {self.moderator.last_usage['completion_tokens']}/{self.moderator.token_budget} tokens",
                          agent_name="moderator", details={"usage": self.moderator.last_usage})

        # Count votes
        advocate_votes = sum(1 for v in verdicts if v["winner"] == "advocate")
        critic_votes = len(verdicts) - advocate_votes
        if advocate_votes > critic_votes:
            winner = side_for
        elif critic_votes > advocate_votes:
            winner = side_against
        else:
            winner = "TIE"

        # Sign the final result
        final_result = {
            "winner": winner,
            "score": f"{advocate_votes}-{critic_votes}",
            "summary": summary,
            "side_for": side_for,
            "side_against": side_against,
            "verdicts": [
                {"judge": v["lens"], "winner": side_for if v["winner"] == "advocate" else side_against}
                for v in verdicts
            ],
        }
        for agent in self.all_agents:
            msg = self.moderator.sign_message(
                agent.did, "debate_result", final_result,
            )

        entry = self.moderator.record_action(
            self.provenance, "task_completed", task_id=debate_id,
            metadata={"winner": winner, "score": f"{advocate_votes}-{critic_votes}"},
        )

        yield self._event("result",
                          f"{winner} wins! ({advocate_votes}-{critic_votes})\n\n{summary}",
                          agent_name="moderator",
                          details=final_result,
                          prov_entry=entry.to_dict(),
                          signed_msg=msg.to_dict())

        # Token summary
        token_summary = {
            a.name: {"used": a.total_tokens_used, "budget": a.token_budget}
            for a in self.all_agents
        }
        total_used = sum(v["used"] for v in token_summary.values())
        yield self._event("token_summary", f"Total tokens: {total_used} used across all agents",
                          agent_name="moderator",
                          details={"agents": token_summary, "total_used": total_used,
                                   "total_budget": sum(v["budget"] for v in token_summary.values())})

        # Final complete event
        prov_export = self.provenance.export()
        prov_export["memory"] = self.memory.all_entries()
        prov_export["memory_count"] = self.memory.count()
        yield self._event("complete",
                          f"Debate concluded — {winner} wins ({advocate_votes}-{critic_votes})",
                          agent_name="moderator",
                          details={"provenance": prov_export},
                          prov_entry=entry.to_dict())
