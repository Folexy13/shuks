import asyncio
import json
import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .autogen_team import (
    evaluate_change_order_with_gemini,
    evaluate_dispute_with_gemini,
    has_llm_api_key,
    transcribe_meeting_audio_with_gemini,
    verify_milestone_proof_with_gemini,
)
from .db import (
    claim_artisan_contract,
    find_user_by_email,
    get_artisan,
    get_job_state,
    init_db,
    insert_artisan_user,
    insert_chat_message,
    insert_client_user,
    list_all_artisans,
    list_chat_messages,
    record_paypal_ledger_entry,
    reset_job_session,
    save_job_checkpoint,
)
from .graph import langgraph_engine
from .meeting_bot import (
    dispatch_meeting_bot,
    get_meeting_bot_status,
    stop_meeting_bot,
)
from .schemas import (
    AgentChatTurnPayload,
    AnalyzeCallPayload,
    ArtisanOnboardingPayload,
    BotJoinPayload,
    ChangeOrderPayload,
    ChatMessageCreatePayload,
    ClaimContractPayload,
    ClientOnboardingPayload,
    DisputePayload,
    GrantPermissionPayload,
    LoginPayload,
    PayPalLedgerPayload,
    ProofVerificationPayload,
)

_job_completion_events: dict[str, asyncio.Event] = {}


def _get_job_event(artisan_id: str) -> asyncio.Event:
    ev = _job_completion_events.get(artisan_id)
    if ev is None:
        ev = asyncio.Event()
        _job_completion_events[artisan_id] = ev
    return ev


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="Shuks LangGraph + AutoGen Orchestrator",
    version="1.6.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "shuks-agent-orchestrator",
        "agentAvailable": has_llm_api_key(),
        "geminiConfigured": bool(os.environ.get("GEMINI_API_KEY", "").strip()),
    }


@app.get("/agent/status")
def agent_status() -> dict[str, Any]:
    return {
        "agentAvailable": has_llm_api_key(),
        "geminiConfigured": bool(os.environ.get("GEMINI_API_KEY", "").strip()),
    }


@app.get("/artisans")
def get_artisans() -> dict[str, Any]:
    return {"artisans": list_all_artisans()}


@app.get("/jobs/{artisan_id}/state")
def get_job_session_state(artisan_id: str) -> dict[str, Any]:
    return get_job_state(artisan_id)


@app.post("/jobs/{artisan_id}/bot/join")
async def join_external_meeting_bot(
    artisan_id: str, payload: BotJoinPayload
) -> dict[str, Any]:
    if not has_llm_api_key():
        raise HTTPException(
            status_code=503,
            detail="Shuks AI Meeting Bot requires GEMINI_API_KEY to be configured.",
        )
    return await dispatch_meeting_bot(
        artisan_id=artisan_id,
        raw_url=payload.meetingUrl,
    )


@app.get("/jobs/{artisan_id}/bot/status")
def external_meeting_bot_status(artisan_id: str) -> dict[str, Any]:
    return get_meeting_bot_status(artisan_id)


@app.post("/jobs/{artisan_id}/bot/leave", status_code=202)
async def leave_external_meeting_bot(
    artisan_id: str,
    background_tasks: BackgroundTasks,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    bot_info = get_meeting_bot_status(artisan_id)
    platform = str(bot_info.get("platform") or "External Meeting")
    meeting_url = bot_info.get("meetingUrl")
    audio_path, was_in_call = await stop_meeting_bot(artisan_id)

    if not was_in_call or not audio_path:
        current = get_job_state(artisan_id)
        insert_chat_message(
            artisan_id=artisan_id,
            sender="agent",
            sender_name="Shuks AI",
            text=f"Shuks AI Bot left {platform} before being admitted into the call, so no new meeting summary was generated.",
            attachment_type=None,
        )
        _get_job_event(artisan_id).set()
        return {
            "status": "not_admitted",
            "jobId": f"job-{artisan_id}",
            "lifecycleState": current.get("lifecycleState", "DISCOVERY"),
        }

    save_job_checkpoint(
        artisan_id=artisan_id,
        lifecycle_state="ANALYZING_CALL",
        transcript=[],
        analysis=None,
        buyer_granted_permission=False,
    )
    ev = _get_job_event(artisan_id)
    ev.clear()

    analyze_payload = AnalyzeCallPayload(
        artisanId=artisan_id,
        scenarioMode="agreed_on_call",
        meetingPlatform=platform,
        meetingUrl=meeting_url,
        recordingFile=audio_path.name,
        transcript=[],
    )
    background_tasks.add_task(_run_call_analysis_background, analyze_payload)

    return {
        "status": "accepted",
        "jobId": f"job-{artisan_id}",
        "lifecycleState": "ANALYZING_CALL",
    }


@app.post("/jobs/{artisan_id}/reset")
def reset_job(artisan_id: str) -> dict[str, Any]:
    return reset_job_session(artisan_id)


@app.post("/jobs/{artisan_id}/claim-contract")
def claim_contract(
    artisan_id: str, payload: ClaimContractPayload
) -> dict[str, Any]:
    state = claim_artisan_contract(
        artisan_id=artisan_id,
        artisan_name=payload.artisanName,
        paypal_email=payload.paypalEmail,
    )
    _get_job_event(artisan_id).set()
    return state


@app.post("/jobs/{artisan_id}/sync-escrow")
def sync_escrow_state(
    artisan_id: str, payload: dict[str, Any]
) -> dict[str, Any]:
    current = get_job_state(artisan_id)
    analysis = payload.get("analysis") or current.get("analysis")
    lifecycle = payload.get("lifecycleState") or current.get("lifecycleState") or "ESCROW_FUNDED"
    save_job_checkpoint(
        artisan_id=artisan_id,
        lifecycle_state=lifecycle,
        transcript=[],
        analysis=analysis,
        buyer_granted_permission=True,
    )
    if payload.get("systemMessage"):
        insert_chat_message(
            artisan_id=artisan_id,
            sender=str(payload.get("sender") or "agent"),
            sender_name=str(payload.get("senderName") or "Shuks AI"),
            text=str(payload["systemMessage"]),
            attachment_type=payload.get("attachmentType"),
        )
    _get_job_event(artisan_id).set()
    return get_job_state(artisan_id)


@app.post("/jobs/{artisan_id}/verify-proof")
async def verify_milestone_proof(
    artisan_id: str, payload: ProofVerificationPayload
) -> dict[str, Any]:
    if not has_llm_api_key():
        raise HTTPException(
            status_code=503,
            detail="Shuks AI Vision is offline because GEMINI_API_KEY is not configured.",
        )

    current = get_job_state(artisan_id)
    analysis = current.get("analysis")
    if not analysis or "proposedPaymentPlan" not in analysis:
        raise HTTPException(
            status_code=400,
            detail="No active milestone plan exists for this job.",
        )

    artisan = get_artisan(artisan_id)
    milestones = analysis["proposedPaymentPlan"].get("milestones", [])
    target_ms = next(
        (m for m in milestones if m["id"] == payload.milestoneId), None
    )
    if not target_ms:
        raise HTTPException(status_code=404, detail="Milestone not found.")

    try:
        verification = await verify_milestone_proof_with_gemini(
            artisan=artisan,
            milestone=target_ms,
            call_analysis=analysis,
            image_base64=payload.imageBase64,
            image_mime_type=payload.imageMimeType,
            artisan_notes=payload.artisanNotes,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    clean_mime = (
        payload.imageMimeType.split(";")[0].strip()
        if payload.imageMimeType
        else "image/jpeg"
    )
    verification["imageDataUrl"] = f"data:{clean_mime};base64,{payload.imageBase64}"

    for m in milestones:
        if m["id"] == payload.milestoneId:
            m["proofVerification"] = verification
            m["status"] = "WORK_SUBMITTED"

    save_job_checkpoint(
        artisan_id=artisan_id,
        lifecycle_state="IN_PROGRESS",
        transcript=[],
        analysis=analysis,
        buyer_granted_permission=True,
    )

    verdict_badge = "VERIFIED" if verification["verified"] else "FLAGGED FOR REVIEW"
    artisan_note_text = (
        f"Submitted Proof-of-Work for {target_ms['title']}: {payload.artisanNotes.strip()}"
        if payload.artisanNotes.strip()
        else f"Submitted Proof-of-Work photo for {target_ms['title']}. Ready for your review and escrow release."
    )
    insert_chat_message(
        artisan_id=artisan_id,
        sender="artisan",
        sender_name=artisan["name"],
        text=artisan_note_text,
        attachment_type=verification["imageDataUrl"],
    )
    insert_chat_message(
        artisan_id=artisan_id,
        sender="agent",
        sender_name="Shuks AI Vision Inspector",
        text=(
            f"Proof-of-Work [{verdict_badge}] for {target_ms['title']} "
            f"(Confidence: {int(verification['confidenceScore'] * 100)}%): {verification['summary']}"
        ),
        attachment_type="meeting_notes",
    )
    _get_job_event(artisan_id).set()
    return get_job_state(artisan_id)


@app.post("/jobs/{artisan_id}/change-order")
async def create_change_order(
    artisan_id: str, payload: ChangeOrderPayload
) -> dict[str, Any]:
    if not has_llm_api_key():
        raise HTTPException(
            status_code=503,
            detail="Shuks AI is offline because GEMINI_API_KEY is not configured.",
        )

    current = get_job_state(artisan_id)
    analysis = current.get("analysis")
    if not analysis or "proposedPaymentPlan" not in analysis:
        raise HTTPException(
            status_code=400,
            detail="Cannot create a mid-job change order before an initial contract exists.",
        )

    artisan = get_artisan(artisan_id)
    try:
        evaluated = await evaluate_change_order_with_gemini(
            artisan=artisan,
            current_analysis=analysis,
            description=payload.description,
            requested_amount_cents=payload.requestedAmountCents,
            audio_base64=payload.audioBase64,
            audio_mime_type=payload.audioMimeType,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    milestones = analysis["proposedPaymentPlan"].get("milestones", [])
    new_idx = len(milestones) + 1
    has_funded_escrow = bool(analysis["proposedPaymentPlan"].get("paypalOrderId"))

    new_milestone = {
        "id": f"ms-amend-{new_idx}-{int(os.times().elapsed * 1000)}",
        "title": evaluated.get("title") or f"Milestone {new_idx} (Amendment)",
        "description": evaluated.get("description") or payload.description,
        "dueTrigger": evaluated.get("dueTrigger") or "Completion of additional work",
        "amountCents": int(evaluated["amountCents"]),
        "status": "ESCROW_LOCKED" if has_funded_escrow else "PENDING_FUNDING",
        "isAmendment": True,
    }

    milestones.append(new_milestone)
    analysis["proposedPaymentPlan"]["milestones"] = milestones
    analysis["proposedPaymentPlan"]["totalCents"] = sum(
        int(m["amountCents"]) for m in milestones
    )

    save_job_checkpoint(
        artisan_id=artisan_id,
        lifecycle_state=current.get("lifecycleState") or "IN_PROGRESS",
        transcript=[],
        analysis=analysis,
        buyer_granted_permission=bool(current.get("buyerGrantedDraftPermission", True)),
    )

    insert_chat_message(
        artisan_id=artisan_id,
        sender="agent",
        sender_name="Shuks AI Change-Order Mediator",
        text=(
            f"Mid-Job Change Order Added (+${new_milestone['amountCents'] / 100:.2f} USD): "
            f"{evaluated.get('explanationMessage', new_milestone['description'])}"
        ),
        attachment_type="payment_plan",
    )
    _get_job_event(artisan_id).set()
    return get_job_state(artisan_id)


@app.post("/jobs/{artisan_id}/dispute")
async def arbitrate_dispute(
    artisan_id: str, payload: DisputePayload
) -> dict[str, Any]:
    if not has_llm_api_key():
        raise HTTPException(
            status_code=503,
            detail="Shuks AI Arbiter is offline because GEMINI_API_KEY is not configured.",
        )

    current = get_job_state(artisan_id)
    analysis = current.get("analysis")
    if not analysis or "proposedPaymentPlan" not in analysis:
        raise HTTPException(
            status_code=400,
            detail="No active milestone plan exists for dispute arbitration.",
        )

    artisan = get_artisan(artisan_id)
    milestones = analysis["proposedPaymentPlan"].get("milestones", [])
    target_ms = next(
        (m for m in milestones if m["id"] == payload.milestoneId), None
    )
    if not target_ms:
        raise HTTPException(status_code=404, detail="Milestone not found.")

    try:
        ruling = await evaluate_dispute_with_gemini(
            artisan=artisan,
            current_analysis=analysis,
            milestone=target_ms,
            reason=payload.reason,
            evidence_image_base64=payload.evidenceImageBase64,
            evidence_mime_type=payload.evidenceMimeType,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    for m in milestones:
        if m["id"] == payload.milestoneId:
            m["status"] = "DISPUTED"
            m["disputeRuling"] = ruling

    save_job_checkpoint(
        artisan_id=artisan_id,
        lifecycle_state="IN_PROGRESS",
        transcript=[],
        analysis=analysis,
        buyer_granted_permission=True,
    )

    art_usd = ruling["recommendedArtisanPayoutCents"] / 100.0
    buy_usd = ruling["recommendedBuyerRefundCents"] / 100.0
    insert_chat_message(
        artisan_id=artisan_id,
        sender="agent",
        sender_name="Shuks AI Dispute Arbiter",
        text=(
            f"Dispute Ruling on {target_ms['title']}: Recommended Split -> "
            f"${art_usd:.2f} USD to {artisan['name']} | ${buy_usd:.2f} USD Refund to Buyer. "
            f"Reasoning: {ruling['rulingSummary']}"
        ),
        attachment_type="payout_receipt",
    )
    _get_job_event(artisan_id).set()
    return get_job_state(artisan_id)


@app.get("/jobs/{artisan_id}/events")
async def stream_job_events(artisan_id: str) -> StreamingResponse:
    async def _event_generator():
        ev = _get_job_event(artisan_id)
        try:
            await asyncio.wait_for(ev.wait(), timeout=45.0)
        except asyncio.TimeoutError:
            pass
        state = get_job_state(artisan_id)
        yield f"data: {json.dumps(state)}\n\n"

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@app.get("/jobs/{artisan_id}/messages")
def get_job_messages(artisan_id: str) -> dict[str, Any]:
    return {"messages": list_chat_messages(artisan_id)}


@app.post("/jobs/{artisan_id}/messages", status_code=201)
def post_job_message(
    artisan_id: str, payload: ChatMessageCreatePayload
) -> dict[str, Any]:
    msg = insert_chat_message(
        artisan_id=artisan_id,
        sender=payload.sender,
        sender_name=payload.senderName,
        text=payload.text,
        attachment_type=payload.attachmentType,
    )
    _get_job_event(artisan_id).set()
    return {"message": msg}


@app.post("/jobs/{artisan_id}/agent-chat")
async def post_agent_chat_turn(
    artisan_id: str, payload: AgentChatTurnPayload
) -> dict[str, Any]:
    if not has_llm_api_key():
        raise HTTPException(
            status_code=503,
            detail="Shuks AI is offline because GEMINI_API_KEY is not configured.",
        )
    try:
        res = await langgraph_engine.handle_buyer_chat_turn(
            artisan_id=artisan_id,
            buyer_name=payload.buyerName,
            buyer_message=payload.buyerMessage,
            current_analysis=payload.currentAnalysis,
        )
        _get_job_event(artisan_id).set()
        return res
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/auth/login")
def login_user(payload: LoginPayload) -> dict[str, Any]:
    account = find_user_by_email(payload.email)
    if not account:
        raise HTTPException(
            status_code=404,
            detail=f"No account found for {payload.email}. Please create an account first.",
        )
    return {"account": account}


@app.post("/onboarding/client", status_code=201)
def onboard_client(payload: ClientOnboardingPayload) -> dict[str, Any]:
    account = insert_client_user(payload.model_dump())
    return {"account": account}


@app.post("/onboarding/artisan", status_code=201)
def onboard_artisan(payload: ArtisanOnboardingPayload) -> dict[str, Any]:
    return insert_artisan_user(payload.model_dump())


async def _run_call_analysis_background(payload: AnalyzeCallPayload) -> None:
    artisan_id = payload.artisanId
    ev = _get_job_event(artisan_id)
    ev.clear()

    try:
        artisan = get_artisan(artisan_id)
        spoken = [
            u
            for u in payload.transcript
            if u.get("speaker") in ("buyer", "artisan")
            and str(u.get("text", "")).strip()
        ]

        if not spoken and (payload.audioBase64 or payload.recordingFile):
            spoken = await transcribe_meeting_audio_with_gemini(
                audio_base64=payload.audioBase64,
                mime_type=payload.audioMimeType or "audio/wav",
                artisan_name=artisan["name"],
                recording_file=payload.recordingFile,
            )

        if not spoken:
            save_job_checkpoint(
                artisan_id=artisan_id,
                lifecycle_state="DISCOVERY",
                transcript=[],
                analysis=None,
                buyer_granted_permission=False,
            )
            insert_chat_message(
                artisan_id=artisan_id,
                sender="agent",
                sender_name="Shuks AI",
                text="Your call ended, but no spoken conversation was detected on the audio stream.",
                attachment_type=None,
            )
            ev.set()
            return

        await langgraph_engine.invoke_call_analysis(
            artisan_id=artisan_id,
            scenario_mode=payload.scenarioMode,
            transcript=spoken,
            meeting_platform=payload.meetingPlatform,
            meeting_url=payload.meetingUrl,
        )
        ev.set()
    except Exception as exc:
        save_job_checkpoint(
            artisan_id=artisan_id,
            lifecycle_state="DISCOVERY",
            transcript=[],
            analysis=None,
            buyer_granted_permission=False,
        )
        insert_chat_message(
            artisan_id=artisan_id,
            sender="agent",
            sender_name="Shuks AI",
            text=f"Could not summarize the call: {exc}",
            attachment_type=None,
        )
        ev.set()


@app.post("/analyze-call", status_code=202)
async def analyze_call(
    payload: AnalyzeCallPayload, background_tasks: BackgroundTasks
) -> dict[str, Any]:
    if not has_llm_api_key():
        raise HTTPException(
            status_code=503,
            detail="AI Mediator is offline because GEMINI_API_KEY is not configured.",
        )

    save_job_checkpoint(
        artisan_id=payload.artisanId,
        lifecycle_state="ANALYZING_CALL",
        transcript=payload.transcript,
        analysis=None,
        buyer_granted_permission=False,
    )
    ev = _get_job_event(payload.artisanId)
    ev.clear()

    background_tasks.add_task(_run_call_analysis_background, payload)

    return {
        "status": "accepted",
        "jobId": f"job-{payload.artisanId}",
        "lifecycleState": "ANALYZING_CALL",
    }


@app.post("/grant-permission")
async def grant_permission(payload: GrantPermissionPayload) -> dict[str, Any]:
    res = await langgraph_engine.resume_after_buyer_permission(
        artisan_id=payload.artisanId,
        send_to_artisan=payload.sendToArtisan,
        analysis=payload.analysis,
    )
    _get_job_event(payload.artisanId).set()
    return res


@app.post("/paypal/ledger", status_code=201)
def create_paypal_ledger(payload: PayPalLedgerPayload) -> dict[str, Any]:
    entry = record_paypal_ledger_entry(
        job_id=payload.jobId,
        event_type=payload.eventType,
        paypal_reference_id=payload.paypalReferenceId,
        amount_cents=payload.amountCents,
        milestone_id=payload.milestoneId,
        recipient_paypal_email=payload.recipientPayPalEmail,
    )
    return {"entry": entry}
