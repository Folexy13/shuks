from datetime import datetime, timezone
from typing import Any, TypedDict

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from .autogen_team import (
    run_autogen_group_chat,
    run_conversational_chat_agent,
)
from .db import get_artisan, insert_chat_message, save_job_checkpoint
from .schemas import PaymentPlanProposalSchema


class JobGraphState(TypedDict):
    artisan_id: str
    scenario_mode: str
    meeting_platform: str
    meeting_url: str | None
    transcript: list[dict[str, Any]]
    scribe_notes: dict[str, Any]
    contract_plan: dict[str, Any]
    agent_messages: list[dict[str, str]]
    lifecycle_state: str
    buyer_granted_permission: bool
    sent_to_artisan: bool
    analysis: dict[str, Any] | None


async def autogen_groupchat_node(state: JobGraphState) -> dict[str, Any]:
    artisan = get_artisan(state["artisan_id"])
    scribe_notes, contract_plan, reasoning_logs = await run_autogen_group_chat(
        artisan=artisan,
        transcript=state["transcript"],
        meeting_platform=state.get("meeting_platform", "in_app"),
    )
    return {
        "scribe_notes": scribe_notes,
        "contract_plan": contract_plan,
        "agent_messages": reasoning_logs,
    }


def _assemble_analysis(state: JobGraphState) -> dict[str, Any]:
    artisan = get_artisan(state["artisan_id"])
    scribe = state["scribe_notes"]
    contract = state["contract_plan"]
    total_cents = sum(int(m["amountCents"]) for m in contract["milestones"])
    payment_mentioned = bool(
        contract.get("paymentMentioned", scribe.get("paymentMentioned", False))
    )
    agreement_reached = bool(contract.get("agreementReached", False))

    validated_plan = PaymentPlanProposalSchema(
        id=f"plan-{total_cents}-{state['artisan_id']}",
        currency="USD",
        totalCents=total_cents,
        milestones=contract["milestones"],
    )

    default_prompt = (
        f"Here is the summary of your call with {artisan['name']}: {scribe.get('scopeSummary', '')}. "
        + (
            f"Since you discussed pricing (${total_cents / 100:.2f} USD), would you like me to create a "
            f"PayPal Escrow milestone plan to hold your funds safely and send the actionable points + offer to {artisan['name']}?"
            if payment_mentioned
            else f"I noticed payment wasn't mentioned during the call. Would you like help planning a financial budget "
            f"and milestone plan (around ${total_cents / 100:.2f} USD based on {artisan['name']}'s rates) and sending it to {artisan['name']}?"
        )
    )

    chat_prompt = contract.get("postCallChatMessageToBuyer") or default_prompt

    return {
        "callId": f"call-{state['artisan_id']}-{int(datetime.now(timezone.utc).timestamp())}",
        "paymentMentioned": payment_mentioned,
        "agreementReached": agreement_reached,
        "confidenceScore": contract.get("confidenceScore", 0.95),
        "summary": chat_prompt,
        "scheduledWindow": scribe.get("scheduledWindow", "TBD"),
        "locationNotes": f"{artisan['neighborhood']}, {artisan['city']}",
        "unresolvedQuestions": scribe.get("unresolvedQuestions", []),
        "buyerActionItems": scribe.get("buyerActionItems", []),
        "artisanActionItems": scribe.get("artisanActionItems", []),
        "suggestedRangeMinCents": contract["suggestedRangeMinCents"],
        "suggestedRangeMaxCents": contract["suggestedRangeMaxCents"],
        "proposedPaymentPlan": validated_plan.model_dump(),
        "carvedTranscript": state["transcript"],
        "autogenReasoningLog": state.get("agent_messages", []),
    }


def post_call_permission_gate_node(state: JobGraphState) -> dict[str, Any]:
    analysis = _assemble_analysis(state)
    save_job_checkpoint(
        artisan_id=state["artisan_id"],
        lifecycle_state="AWAITING_DRAFT_PERMISSION",
        transcript=state["transcript"],
        analysis=analysis,
        buyer_granted_permission=False,
    )
    insert_chat_message(
        artisan_id=state["artisan_id"],
        sender="agent",
        sender_name="Shuks AI",
        text=analysis["summary"],
        attachment_type="permission_request",
    )
    return {
        "lifecycle_state": "AWAITING_DRAFT_PERMISSION",
        "buyer_granted_permission": False,
        "sent_to_artisan": False,
        "analysis": analysis,
    }


builder = StateGraph(JobGraphState)
builder.add_node("autogen_groupchat_node", autogen_groupchat_node)
builder.add_node("post_call_permission_gate_node", post_call_permission_gate_node)

builder.add_edge(START, "autogen_groupchat_node")
builder.add_edge("autogen_groupchat_node", "post_call_permission_gate_node")
builder.add_edge("post_call_permission_gate_node", END)

checkpointer = MemorySaver()
compiled_shuks_graph = builder.compile(checkpointer=checkpointer)


class ShuksLangGraphEngine:
    async def invoke_call_analysis(
        self,
        artisan_id: str,
        scenario_mode: str,
        transcript: list[dict[str, Any]],
        meeting_platform: str = "in_app",
        meeting_url: str | None = None,
    ) -> JobGraphState:
        config = {"configurable": {"thread_id": f"job-{artisan_id}"}}
        result = await compiled_shuks_graph.ainvoke(
            {
                "artisan_id": artisan_id,
                "scenario_mode": scenario_mode,
                "meeting_platform": meeting_platform,
                "meeting_url": meeting_url,
                "transcript": transcript,
                "scribe_notes": {},
                "contract_plan": {},
                "agent_messages": [],
                "lifecycle_state": "IN_CALL",
                "buyer_granted_permission": False,
                "sent_to_artisan": False,
                "analysis": None,
            },
            config=config,
        )
        return result

    async def resume_after_buyer_permission(
        self,
        artisan_id: str,
        send_to_artisan: bool = True,
        analysis: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        artisan = get_artisan(artisan_id)
        config = {"configurable": {"thread_id": f"job-{artisan_id}"}}
        snapshot = await compiled_shuks_graph.aget_state(config)
        saved_analysis = (
            analysis
            or (snapshot.values.get("analysis") if snapshot and snapshot.values else None)
        )
        await compiled_shuks_graph.aupdate_state(
            config,
            {
                "lifecycle_state": "AWAITING_BUYER_FUNDING",
                "buyer_granted_permission": True,
                "sent_to_artisan": send_to_artisan,
                "analysis": saved_analysis,
            },
        )
        save_job_checkpoint(
            artisan_id=artisan_id,
            lifecycle_state="AWAITING_BUYER_FUNDING",
            transcript=[],
            analysis=saved_analysis,
            buyer_granted_permission=True,
        )

        total_usd = (
            saved_analysis["proposedPaymentPlan"]["totalCents"] / 100.0
            if saved_analysis and "proposedPaymentPlan" in saved_analysis
            else 0.0
        )
        reply_text = (
            f"I have created the ${total_usd:.2f} USD PayPal Escrow milestone plan"
            + (
                f" and shared the actionable meeting checklist and payment offer with {artisan['name']}. "
                if send_to_artisan
                else ". "
            )
            + "Approve and fund the escrow in the panel on the right to lock your funds safely until completion."
        )
        msg = insert_chat_message(
            artisan_id=artisan_id,
            sender="agent",
            sender_name="Shuks AI",
            text=reply_text,
            attachment_type="payment_plan",
        )
        return {
            "artisanId": artisan_id,
            "lifecycleState": "AWAITING_BUYER_FUNDING",
            "buyerGrantedDraftPermission": True,
            "sentToArtisan": send_to_artisan,
            "analysis": saved_analysis,
            "agentMessage": msg,
        }

    async def handle_buyer_chat_turn(
        self,
        artisan_id: str,
        buyer_name: str,
        buyer_message: str,
        current_analysis: dict[str, Any] | None,
    ) -> dict[str, Any]:
        artisan = get_artisan(artisan_id)
        config = {"configurable": {"thread_id": f"job-{artisan_id}"}}
        snapshot = await compiled_shuks_graph.aget_state(config)
        active_analysis = (
            current_analysis
            or (snapshot.values.get("analysis") if snapshot and snapshot.values else None)
        )

        decision = await run_conversational_chat_agent(
            artisan=artisan,
            buyer_name=buyer_name,
            buyer_message=buyer_message,
            current_analysis=active_analysis,
        )

        if active_analysis and decision.get("milestones"):
            validated_plan = PaymentPlanProposalSchema(
                id=f"plan-{decision['totalCents']}-{artisan_id}",
                currency="USD",
                totalCents=decision["totalCents"],
                milestones=decision["milestones"],
            )
            active_analysis = {
                **active_analysis,
                "proposedPaymentPlan": validated_plan.model_dump(),
            }

        activate = bool(decision.get("activatePaymentPlan"))
        send_to_artisan = bool(decision.get("sendOfferToArtisan", True))
        next_lifecycle = (
            "AWAITING_BUYER_FUNDING"
            if activate
            else (
                snapshot.values.get("lifecycle_state", "DISCOVERY")
                if snapshot and snapshot.values
                else "DISCOVERY"
            )
        )

        if active_analysis:
            await compiled_shuks_graph.aupdate_state(
                config,
                {
                    "lifecycle_state": next_lifecycle,
                    "buyer_granted_permission": activate,
                    "sent_to_artisan": send_to_artisan,
                    "analysis": active_analysis,
                },
            )
            save_job_checkpoint(
                artisan_id=artisan_id,
                lifecycle_state=next_lifecycle,
                transcript=[],
                analysis=active_analysis,
                buyer_granted_permission=activate,
            )

        agent_msg = insert_chat_message(
            artisan_id=artisan_id,
            sender="agent",
            sender_name="Shuks AI",
            text=decision["agentReplyText"],
            attachment_type="payment_plan" if activate else None,
        )

        return {
            "agentMessage": agent_msg,
            "activatePaymentPlan": activate,
            "sendOfferToArtisan": send_to_artisan,
            "lifecycleState": next_lifecycle,
            "analysis": active_analysis,
        }


langgraph_engine = ShuksLangGraphEngine()
