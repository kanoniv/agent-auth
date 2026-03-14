"""Hospital AI Delegation Demo - Trustworthy Healthcare Agents.

Demonstrates cryptographic delegation in a healthcare setting:

  Dr. Chen (Human)
    |-- delegates to Clinical AI Orchestrator
    |     caveats: department=cardiology, max_cost=$500, end_of_shift
    |
    |-- Orchestrator delegates to Diagnostic Agent
    |     caveats: actions=[read_records, order_labs]
    |     (tries to prescribe -> BLOCKED)
    |
    |-- Orchestrator delegates to Treatment Agent
    |     caveats: actions=[prescribe, check_interactions]
    |     (tries to access billing -> BLOCKED)
    |
    |-- Orchestrator delegates to Discharge Agent
          caveats: actions=[generate_summary, schedule_followup]
          (tries to read other patients -> BLOCKED by resource caveat)

Every action is cryptographically signed, delegation-verified,
and recorded in a provenance DAG.
"""

import json
import uuid
from datetime import datetime, timezone, timedelta

from identity import AgentIdentity, KeyPair, SignedMessage
from provenance import ProvenanceEntry, ProvenanceGraph
from memory import SharedMemory
from agents import BaseAgent, llm_generate, AGENT_TOKEN_BUDGETS
from kanoniv_agent_auth import (
    Delegation, Invocation, verify_invocation,
)

# Override budgets for hospital agents
AGENT_TOKEN_BUDGETS.update({
    "orchestrator": 800,
    "diagnostic": 1000,
    "treatment": 1000,
    "discharge": 800,
})


class HospitalAgent(BaseAgent):
    """Base class for hospital agents with delegation support."""

    def __init__(self, name, capabilities, system_prompt):
        super().__init__(name, capabilities, system_prompt)
        self.delegation = None
        self.authority_manager = None

    def execute_with_delegation(self, action, args, provenance_graph=None):
        """Execute an action and verify delegation.

        Returns (result, delegation_info) where delegation_info contains
        the verification chain for UI display.
        """
        if self.delegation is None:
            return None, {
                "status": "DENIED",
                "reason": f"Agent '{self.name}' has no delegation",
                "action": action,
            }

        # Check revocation
        if self.authority_manager and self.authority_manager.is_revoked(self.delegation.content_hash()):
            return None, {
                "status": "REVOKED",
                "reason": f"Agent '{self.name}' delegation has been revoked",
                "action": action,
            }

        try:
            invocation = Invocation.create(
                self.keypair.inner, action, json.dumps(args), self.delegation
            )
            result = verify_invocation(
                invocation,
                self.keypair.inner.identity(),
                self.authority_manager.root_identity,
            )
            delegation_info = {
                "status": "VERIFIED",
                "action": action,
                "chain": result[2],
                "depth": result[3],
                "invoker_did": result[0],
                "root_did": result[1],
            }

            # Record in provenance
            if provenance_graph:
                self.record_action(
                    provenance_graph, f"delegated_{action}",
                    metadata={"action": action, "args": args, "chain_depth": result[3]},
                )

            return True, delegation_info

        except ValueError as e:
            return None, {
                "status": "DENIED",
                "reason": str(e),
                "action": action,
            }


class OrchestratorAgent(HospitalAgent):
    """Clinical AI Orchestrator - coordinates hospital agents."""

    def __init__(self):
        super().__init__(
            name="orchestrator",
            capabilities=["coordination", "triage", "delegation"],
            system_prompt=(
                "You are a Clinical AI Orchestrator in a cardiology department. "
                "You triage patient cases and coordinate diagnostic, treatment, and discharge agents. "
                "Be clinical, precise, and brief."
            ),
        )

    def triage(self, patient_case):
        prompt = (
            f"Patient case: {patient_case}\n\n"
            "Briefly triage this case. What diagnostic tests are needed? "
            "What treatment considerations? Output 2-3 sentences."
        )
        return self.think(prompt)

    def delegate_to_agent(self, agent, actions, max_cost=None, resources=None):
        """Sub-delegate to a hospital agent with caveats."""
        caveats = [{"type": "action_scope", "value": actions}]
        if max_cost is not None:
            caveats.append({"type": "max_cost", "value": max_cost})
        if resources:
            for r in resources:
                caveats.append({"type": "resource", "value": r})

        delegation = Delegation.delegate(
            self.keypair.inner,
            agent.keypair.inner.identity().did,
            json.dumps(caveats),
            self.delegation,
        )
        agent.delegation = delegation
        agent.authority_manager = self.authority_manager
        return delegation


class DiagnosticAgent(HospitalAgent):
    """Reads patient records and orders lab tests."""

    def __init__(self):
        super().__init__(
            name="diagnostic",
            capabilities=["read_records", "order_labs", "interpret_results"],
            system_prompt=(
                "You are a Diagnostic AI agent in cardiology. "
                "You read patient records and order appropriate lab tests. "
                "Be clinical and evidence-based. Output 2-3 sentences."
            ),
        )

    def read_records(self, patient_id):
        prompt = (
            f"Patient {patient_id} presents with chest pain and shortness of breath. "
            "History: hypertension, type 2 diabetes. Current meds: metformin, lisinopril. "
            "Summarize the key findings relevant to cardiac workup."
        )
        return self.think(prompt)

    def order_labs(self, patient_id, tests):
        prompt = (
            f"Order the following labs for patient {patient_id}: {', '.join(tests)}. "
            "Briefly justify each test for a cardiac workup."
        )
        return self.think(prompt)


class TreatmentAgent(HospitalAgent):
    """Prescribes medications and checks interactions."""

    def __init__(self):
        super().__init__(
            name="treatment",
            capabilities=["prescribe", "check_interactions", "dosage_calc"],
            system_prompt=(
                "You are a Treatment AI agent in cardiology. "
                "You prescribe medications and check for drug interactions. "
                "Always consider patient history. Be precise about dosages."
            ),
        )

    def prescribe(self, patient_id, medication, dosage):
        prompt = (
            f"Prescribe {medication} {dosage} for patient {patient_id}. "
            f"Patient is on metformin and lisinopril. "
            "Check for interactions and confirm the prescription is appropriate. 2-3 sentences."
        )
        return self.think(prompt)

    def check_interactions(self, medications):
        prompt = (
            f"Check for drug interactions between: {', '.join(medications)}. "
            "Flag any critical interactions. Be brief."
        )
        return self.think(prompt)


class DischargeAgent(HospitalAgent):
    """Generates discharge summaries and schedules follow-ups."""

    def __init__(self):
        super().__init__(
            name="discharge",
            capabilities=["generate_summary", "schedule_followup"],
            system_prompt=(
                "You are a Discharge AI agent. "
                "You generate discharge summaries and schedule follow-up appointments. "
                "Be thorough but concise."
            ),
        )

    def generate_summary(self, patient_id, diagnosis, treatment):
        prompt = (
            f"Generate a discharge summary for patient {patient_id}.\n"
            f"Diagnosis: {diagnosis}\n"
            f"Treatment: {treatment}\n"
            "Include follow-up instructions. 3-4 sentences."
        )
        return self.think(prompt)

    def schedule_followup(self, patient_id, specialty, timeframe):
        prompt = (
            f"Schedule a {specialty} follow-up for patient {patient_id} within {timeframe}. "
            "Include what the follow-up should cover."
        )
        return self.think(prompt)


class HospitalAuthorityManager:
    """Root authority (the physician) that delegates to hospital agents."""

    def __init__(self, physician_keypair):
        self.physician_keypair = physician_keypair
        self.root_identity = physician_keypair.inner.identity()
        self._revoked = set()

    def delegate_to_orchestrator(self, orchestrator, department, max_cost, expires_in_hours):
        caveats = [
            {"type": "action_scope", "value": [
                "coordinate", "triage", "delegate",
                "read_records", "order_labs", "prescribe",
                "check_interactions", "generate_summary", "schedule_followup",
            ]},
            {"type": "max_cost", "value": max_cost},
            {"type": "context", "value": {"key": "department", "value": department}},
        ]
        expiry = (datetime.now(timezone.utc) + timedelta(hours=expires_in_hours)).strftime(
            "%Y-%m-%dT%H:%M:%S.000Z"
        )
        caveats.append({"type": "expires_at", "value": expiry})

        delegation = Delegation.create_root(
            self.physician_keypair.inner,
            orchestrator.keypair.inner.identity().did,
            json.dumps(caveats),
        )
        orchestrator.delegation = delegation
        orchestrator.authority_manager = self
        return delegation

    def revoke(self, agent):
        if agent.delegation:
            self._revoked.add(agent.delegation.content_hash())

    def is_revoked(self, hash):
        return hash in self._revoked


class HospitalCoordinator:
    """Orchestrates the hospital demo, yielding SSE events."""

    def __init__(self):
        self.physician_kp = KeyPair.generate()
        self.authority = HospitalAuthorityManager(self.physician_kp)

        self.orchestrator = OrchestratorAgent()
        self.diagnostic = DiagnosticAgent()
        self.treatment = TreatmentAgent()
        self.discharge = DischargeAgent()

        self.provenance = ProvenanceGraph()
        self.memory = SharedMemory()

        self.all_agents = [self.orchestrator, self.diagnostic, self.treatment, self.discharge]

    def _event(self, event_type, message, agent_name="system",
               details=None, prov_entry=None, memory_entry=None,
               signed_msg=None, delegation_info=None):
        return {
            "type": event_type,
            "agent": agent_name,
            "message": message,
            "details": details or {},
            "prov_entry": prov_entry,
            "memory_entry": memory_entry,
            "signed_msg": signed_msg,
            "delegation_info": delegation_info,
        }

    def run_stream(self, patient_case):
        """Execute the hospital workflow, yielding events."""
        patient_id = f"PT-{uuid.uuid4().hex[:8].upper()}"

        # === Register agents ===
        for agent in self.all_agents:
            entry = agent.record_action(
                self.provenance, "agent_registered",
                metadata={"name": agent.name, "capabilities": agent.identity.capabilities},
            )
            yield self._event(
                "system", f"Agent registered: {agent.name} ({agent.did[:30]}...)",
                agent_name=agent.name, prov_entry=entry.to_dict(),
            )

        # === Step 1: Physician delegates to orchestrator ===
        yield self._event("status", "Dr. Chen starting shift - delegating to Clinical AI...",
                          agent_name="physician")

        self.authority.delegate_to_orchestrator(
            self.orchestrator, department="cardiology", max_cost=500.0, expires_in_hours=8,
        )
        yield self._event(
            "delegation",
            "Dr. Chen delegated to Orchestrator: cardiology dept, $500 budget, 8hr shift",
            agent_name="physician",
            delegation_info={
                "status": "CREATED",
                "issuer": f"Dr. Chen ({self.physician_kp.inner.identity().did[:20]}...)",
                "delegate": f"Orchestrator ({self.orchestrator.did[:20]}...)",
                "caveats": ["department=cardiology", "max_cost=$500", "expires=8hr"],
            },
        )

        # === Step 2: Orchestrator sub-delegates ===
        self.orchestrator.delegate_to_agent(
            self.diagnostic, actions=["read_records", "order_labs"], max_cost=100.0,
            resources=[f"patient:{patient_id}:*"],
        )
        yield self._event(
            "delegation",
            f"Orchestrator delegated to Diagnostic: read_records + order_labs for {patient_id}",
            agent_name="orchestrator",
            delegation_info={
                "status": "CREATED",
                "issuer": f"Orchestrator ({self.orchestrator.did[:20]}...)",
                "delegate": f"Diagnostic ({self.diagnostic.did[:20]}...)",
                "caveats": ["actions=read_records,order_labs", "max_cost=$100", f"resource=patient:{patient_id}:*"],
            },
        )

        self.orchestrator.delegate_to_agent(
            self.treatment, actions=["prescribe", "check_interactions"], max_cost=200.0,
            resources=[f"patient:{patient_id}:*"],
        )
        yield self._event(
            "delegation",
            f"Orchestrator delegated to Treatment: prescribe + check_interactions for {patient_id}",
            agent_name="orchestrator",
            delegation_info={
                "status": "CREATED",
                "issuer": f"Orchestrator ({self.orchestrator.did[:20]}...)",
                "delegate": f"Treatment ({self.treatment.did[:20]}...)",
                "caveats": ["actions=prescribe,check_interactions", "max_cost=$200", f"resource=patient:{patient_id}:*"],
            },
        )

        self.orchestrator.delegate_to_agent(
            self.discharge, actions=["generate_summary", "schedule_followup"], max_cost=50.0,
            resources=[f"patient:{patient_id}:*"],
        )
        yield self._event(
            "delegation",
            f"Orchestrator delegated to Discharge: summary + followup for {patient_id}",
            agent_name="orchestrator",
            delegation_info={
                "status": "CREATED",
                "issuer": f"Orchestrator ({self.orchestrator.did[:20]}...)",
                "delegate": f"Discharge ({self.discharge.did[:20]}...)",
                "caveats": ["actions=generate_summary,schedule_followup", "max_cost=$50", f"resource=patient:{patient_id}:*"],
            },
        )

        # === Step 3: Triage ===
        yield self._event("thinking", f"Triaging patient {patient_id}...", agent_name="orchestrator")

        triage_result = self.orchestrator.triage(patient_case)

        msg = self.orchestrator.sign_message(
            self.diagnostic.did, "triage_result",
            {"patient_id": patient_id, "triage": triage_result},
        )
        yield self._event(
            "message", f"Triage: {triage_result}", agent_name="orchestrator",
            details={"patient_id": patient_id},
            signed_msg=msg.to_dict(),
        )

        # === Step 4: Diagnostic reads records (ALLOWED) ===
        yield self._event("thinking", "Reading patient records...", agent_name="diagnostic")

        ok, deleg_info = self.diagnostic.execute_with_delegation(
            "read_records", {"cost": 10.0, "resource": f"patient:{patient_id}:records"},
            self.provenance,
        )
        yield self._event(
            "delegation_check",
            "read_records - VERIFIED" if ok else f"read_records - {deleg_info['status']}",
            agent_name="diagnostic", delegation_info=deleg_info,
        )

        if ok:
            records = self.diagnostic.read_records(patient_id)
            msg = self.diagnostic.sign_message(
                self.orchestrator.did, "records_result",
                {"patient_id": patient_id, "findings": records},
            )
            yield self._event("message", f"Records: {records}", agent_name="diagnostic",
                              signed_msg=msg.to_dict())

            mem = self.diagnostic.memorize(
                self.memory, "clinical_finding", title=f"Patient {patient_id} records",
                content=records[:300], entity_id=patient_id, tags=["records", "cardiology"],
            )
            yield self._event("memory", "Stored patient records in shared memory",
                              agent_name="diagnostic", memory_entry=mem.to_dict())

        # === Step 5: Diagnostic orders labs (ALLOWED) ===
        yield self._event("thinking", "Ordering cardiac labs...", agent_name="diagnostic")

        ok, deleg_info = self.diagnostic.execute_with_delegation(
            "order_labs", {"cost": 45.0, "resource": f"patient:{patient_id}:labs"},
            self.provenance,
        )
        yield self._event(
            "delegation_check",
            "order_labs - VERIFIED" if ok else f"order_labs - {deleg_info['status']}",
            agent_name="diagnostic", delegation_info=deleg_info,
        )

        if ok:
            labs = self.diagnostic.order_labs(patient_id, ["Troponin", "BNP", "CBC", "BMP", "ECG"])
            msg = self.diagnostic.sign_message(
                self.orchestrator.did, "labs_ordered",
                {"patient_id": patient_id, "tests": labs},
            )
            yield self._event("message", f"Labs ordered: {labs}", agent_name="diagnostic",
                              signed_msg=msg.to_dict())

        # === Step 6: Diagnostic tries to PRESCRIBE (BLOCKED) ===
        yield self._event("thinking", "Attempting to prescribe medication directly...",
                          agent_name="diagnostic")

        ok, deleg_info = self.diagnostic.execute_with_delegation(
            "prescribe", {"cost": 20.0, "resource": f"patient:{patient_id}:rx"},
            self.provenance,
        )
        yield self._event(
            "delegation_check",
            "prescribe - DENIED (not in diagnostic scope)",
            agent_name="diagnostic", delegation_info=deleg_info,
        )

        # === Step 7: Treatment checks interactions (ALLOWED) ===
        yield self._event("thinking", "Checking drug interactions...", agent_name="treatment")

        ok, deleg_info = self.treatment.execute_with_delegation(
            "check_interactions", {"cost": 15.0, "resource": f"patient:{patient_id}:rx"},
            self.provenance,
        )
        yield self._event(
            "delegation_check",
            "check_interactions - VERIFIED" if ok else f"check_interactions - {deleg_info['status']}",
            agent_name="treatment", delegation_info=deleg_info,
        )

        if ok:
            interactions = self.treatment.check_interactions(
                ["Metformin", "Lisinopril", "Aspirin", "Atorvastatin"]
            )
            msg = self.treatment.sign_message(
                self.orchestrator.did, "interaction_check",
                {"medications": ["Metformin", "Lisinopril", "Aspirin", "Atorvastatin"],
                 "result": interactions},
            )
            yield self._event("message", f"Interactions: {interactions}", agent_name="treatment",
                              signed_msg=msg.to_dict())

        # === Step 8: Treatment prescribes (ALLOWED) ===
        yield self._event("thinking", "Prescribing medication...", agent_name="treatment")

        ok, deleg_info = self.treatment.execute_with_delegation(
            "prescribe", {"cost": 30.0, "resource": f"patient:{patient_id}:rx"},
            self.provenance,
        )
        yield self._event(
            "delegation_check",
            "prescribe - VERIFIED" if ok else f"prescribe - {deleg_info['status']}",
            agent_name="treatment", delegation_info=deleg_info,
        )

        if ok:
            rx = self.treatment.prescribe(patient_id, "Aspirin", "81mg daily")
            msg = self.treatment.sign_message(
                self.orchestrator.did, "prescription",
                {"patient_id": patient_id, "medication": "Aspirin 81mg daily", "details": rx},
            )
            yield self._event("message", f"Prescription: {rx}", agent_name="treatment",
                              signed_msg=msg.to_dict())

            mem = self.treatment.memorize(
                self.memory, "treatment_decision", title=f"Rx for {patient_id}",
                content=f"Aspirin 81mg daily - {rx[:200]}", entity_id=patient_id,
                tags=["prescription", "cardiology"],
            )
            yield self._event("memory", "Stored prescription in shared memory",
                              agent_name="treatment", memory_entry=mem.to_dict())

        # === Step 9: Treatment tries to access BILLING (BLOCKED) ===
        yield self._event("thinking", "Attempting to access billing system...",
                          agent_name="treatment")

        ok, deleg_info = self.treatment.execute_with_delegation(
            "access_billing", {"cost": 5.0, "resource": f"patient:{patient_id}:billing"},
            self.provenance,
        )
        yield self._event(
            "delegation_check",
            "access_billing - DENIED (not in treatment scope)",
            agent_name="treatment", delegation_info=deleg_info,
        )

        # === Step 10: Discharge generates summary (ALLOWED) ===
        yield self._event("thinking", "Generating discharge summary...", agent_name="discharge")

        ok, deleg_info = self.discharge.execute_with_delegation(
            "generate_summary", {"cost": 25.0, "resource": f"patient:{patient_id}:discharge"},
            self.provenance,
        )
        yield self._event(
            "delegation_check",
            "generate_summary - VERIFIED" if ok else f"generate_summary - {deleg_info['status']}",
            agent_name="discharge", delegation_info=deleg_info,
        )

        if ok:
            summary = self.discharge.generate_summary(
                patient_id,
                "Acute chest pain - cardiac workup negative",
                "Aspirin 81mg daily, lifestyle modifications",
            )
            msg = self.discharge.sign_message(
                self.orchestrator.did, "discharge_summary",
                {"patient_id": patient_id, "summary": summary},
            )
            yield self._event("message", f"Discharge: {summary}", agent_name="discharge",
                              signed_msg=msg.to_dict())

        # === Step 11: Discharge tries to read ANOTHER patient (BLOCKED by resource) ===
        yield self._event("thinking", "Attempting to access another patient's records...",
                          agent_name="discharge")

        ok, deleg_info = self.discharge.execute_with_delegation(
            "generate_summary", {"cost": 10.0, "resource": "patient:PT-OTHER999:discharge"},
            self.provenance,
        )
        yield self._event(
            "delegation_check",
            "access other patient - DENIED (resource pattern mismatch)",
            agent_name="discharge", delegation_info=deleg_info,
        )

        # === Step 12: Revoke treatment agent mid-shift ===
        yield self._event("status", "Dr. Chen revokes Treatment Agent (concern flagged)...",
                          agent_name="physician")

        self.authority.revoke(self.treatment)

        yield self._event(
            "delegation",
            "Treatment Agent delegation REVOKED by Dr. Chen",
            agent_name="physician",
            delegation_info={
                "status": "REVOKED",
                "agent": f"Treatment ({self.treatment.did[:20]}...)",
                "reason": "Physician concern flagged",
            },
        )

        # Treatment tries to prescribe again (BLOCKED - revoked)
        yield self._event("thinking", "Attempting to prescribe after revocation...",
                          agent_name="treatment")

        ok, deleg_info = self.treatment.execute_with_delegation(
            "prescribe", {"cost": 20.0, "resource": f"patient:{patient_id}:rx"},
            self.provenance,
        )
        yield self._event(
            "delegation_check",
            "prescribe after revocation - REVOKED",
            agent_name="treatment", delegation_info=deleg_info,
        )

        # === Complete ===
        prov_export = self.provenance.export()
        prov_export["memory"] = self.memory.all_entries()
        prov_export["memory_count"] = self.memory.count()

        yield self._event(
            "complete",
            f"Hospital workflow complete for patient {patient_id}. "
            f"All actions cryptographically verified with delegation chains.",
            agent_name="orchestrator",
            details={
                "patient_id": patient_id,
                "provenance": prov_export,
                "agents": [
                    {"name": a.name, "did": a.did, "actions_taken": len(a.message_log)}
                    for a in self.all_agents
                ],
            },
        )
