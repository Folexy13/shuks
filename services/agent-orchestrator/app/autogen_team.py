import base64
import json
import os
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncGenerator, Mapping, Sequence

import httpx
from autogen_agentchat.agents import AssistantAgent
from autogen_agentchat.messages import TextMessage
from autogen_agentchat.teams import RoundRobinGroupChat
from autogen_core import CancellationToken
from autogen_core.models import (
    ChatCompletionClient,
    CreateResult,
    LLMMessage,
    ModelCapabilities,
    ModelFamily,
    ModelInfo,
    RequestUsage,
    SystemMessage,
)
from dotenv import load_dotenv

load_dotenv()


def has_llm_api_key() -> bool:
    return bool(
        os.environ.get("GEMINI_API_KEY", "").strip()
        or os.environ.get("OPENAI_API_KEY", "").strip()
    )


def _strip_json_fences(raw: str) -> str:
    text = raw.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        return "\n".join(lines).strip()
    return text


def _compress_audio_bytes_to_mp3_b64(raw_bytes: bytes) -> tuple[str, str]:
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as src, tempfile.NamedTemporaryFile(
        suffix=".mp3", delete=True
    ) as dst:
        src.write(raw_bytes)
        src.flush()
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                src.name,
                "-ar",
                "16000",
                "-ac",
                "1",
                "-b:a",
                "64k",
                dst.name,
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        mp3_bytes = Path(dst.name).read_bytes()
        return base64.b64encode(mp3_bytes).decode("ascii"), "audio/mp3"


async def transcribe_meeting_audio_with_gemini(
    audio_base64: str | None,
    mime_type: str,
    artisan_name: str,
    recording_file: str | None = None,
) -> list[dict[str, Any]]:
    gemini_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not gemini_key:
        raise RuntimeError("GEMINI_API_KEY is not configured.")

    if recording_file:
        safe_name = Path(recording_file).name
        base_dir = Path(__file__).resolve().parent.parent
        file_path = base_dir / "data" / "recordings" / safe_name
        if not file_path.exists():
            file_path = (
                base_dir.parent.parent
                / "apps"
                / "web"
                / "public"
                / "recordings"
                / safe_name
            )
        if not file_path.exists():
            raise RuntimeError(f"Recording file not found: {safe_name}")
        raw_bytes = file_path.read_bytes()
        final_b64, clean_mime = _compress_audio_bytes_to_mp3_b64(raw_bytes)
    elif audio_base64:
        raw_bytes = base64.b64decode(audio_base64)
        if len(raw_bytes) > 3 * 1024 * 1024:
            final_b64, clean_mime = _compress_audio_bytes_to_mp3_b64(raw_bytes)
        else:
            final_b64 = audio_base64
            clean_mime = (
                mime_type.split(";")[0].strip() if mime_type else "audio/webm"
            )
    else:
        return []

    model = os.environ.get("GEMINI_MODEL", "gemini-3.8-flash").strip()
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

    prompt = (
        f"Transcribe this meeting audio between a Customer (buyer) and {artisan_name} (artisan). "
        "Do NOT invent any words that were not spoken in the audio. If the audio is silent or unintelligible, "
        'return {"utterances": []}. Otherwise return JSON: '
        '{"utterances": [{"speaker": "buyer" | "artisan", "speakerName": str, "text": str}]}'
    )

    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": prompt},
                    {
                        "inlineData": {
                            "mimeType": clean_mime,
                            "data": final_b64,
                        }
                    },
                ],
            }
        ],
        "generationConfig": {
            "temperature": 0.0,
            "responseMimeType": "application/json",
        },
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(url, params={"key": gemini_key}, json=payload)
        if resp.status_code in (401, 403) and not gemini_key.startswith("AIza"):
            resp = await client.post(
                url,
                headers={"Authorization": f"Bearer {gemini_key}"},
                json=payload,
            )
        if not resp.is_success:
            raise RuntimeError(
                f"Gemini audio transcription error ({resp.status_code}): {resp.text[:300]}"
            )
        data = resp.json()
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        parsed = json.loads(_strip_json_fences(text))
        utterances = parsed.get("utterances") or []
        now_iso = datetime.now(timezone.utc).isoformat()
        return [
            {
                "id": f"utt-audio-{idx}-{int(datetime.now(timezone.utc).timestamp() * 1000)}",
                "speaker": u.get("speaker") if u.get("speaker") in ("buyer", "artisan") else "buyer",
                "speakerName": u.get("speakerName") or ("Customer" if u.get("speaker") == "buyer" else artisan_name),
                "text": str(u.get("text", "")).strip(),
                "timestampIso": now_iso,
            }
            for idx, u in enumerate(utterances)
            if str(u.get("text", "")).strip()
        ]


class GeminiChatCompletionClient(ChatCompletionClient):
    def __init__(self) -> None:
        self._gemini_key = os.environ.get("GEMINI_API_KEY", "").strip()
        self._model = os.environ.get("GEMINI_MODEL", "gemini-3.8-flash").strip()
        self._usage = RequestUsage(prompt_tokens=0, completion_tokens=0)

    async def create(
        self,
        messages: Sequence[LLMMessage],
        *,
        tools: Sequence[Any] = [],
        json_output: bool | None = None,
        extra_create_args: Mapping[str, Any] = {},
        cancellation_token: CancellationToken | None = None,
    ) -> CreateResult:
        if not self._gemini_key:
            raise RuntimeError("GEMINI_API_KEY is not configured.")

        system_parts: list[str] = []
        user_parts: list[str] = []
        for msg in messages:
            content_str = (
                msg.content
                if isinstance(msg.content, str)
                else json.dumps(msg.content)
            )
            if isinstance(msg, SystemMessage):
                system_parts.append(content_str)
            else:
                source = getattr(msg, "source", "user")
                user_parts.append(f"[{source}]: {content_str}")

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self._model}:generateContent"
        payload: dict[str, Any] = {
            "contents": [
                {"role": "user", "parts": [{"text": "\n\n".join(user_parts)}]}
            ],
            "generationConfig": {
                "temperature": 0.1,
                "responseMimeType": "application/json",
            },
        }
        if system_parts:
            payload["systemInstruction"] = {
                "parts": [{"text": "\n".join(system_parts)}]
            }

        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                url,
                params={"key": self._gemini_key},
                json=payload,
            )
            if resp.status_code in (401, 403) and not self._gemini_key.startswith(
                "AIza"
            ):
                resp = await client.post(
                    url,
                    headers={"Authorization": f"Bearer {self._gemini_key}"},
                    json=payload,
                )

            if not resp.is_success:
                raise RuntimeError(
                    f"Gemini API error ({resp.status_code}): {resp.text[:300]}"
                )

            data = resp.json()
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            usage_meta = data.get("usageMetadata", {})
            step_usage = RequestUsage(
                prompt_tokens=int(usage_meta.get("promptTokenCount", 0)),
                completion_tokens=int(
                    usage_meta.get("candidatesTokenCount", 0)
                ),
            )
            self._usage = RequestUsage(
                prompt_tokens=self._usage.prompt_tokens
                + step_usage.prompt_tokens,
                completion_tokens=self._usage.completion_tokens
                + step_usage.completion_tokens,
            )
            return CreateResult(
                finish_reason="stop",
                content=_strip_json_fences(text),
                usage=step_usage,
                cached=False,
            )

    def create_stream(
        self,
        messages: Sequence[LLMMessage],
        *,
        tools: Sequence[Any] = [],
        json_output: bool | None = None,
        extra_create_args: Mapping[str, Any] = {},
        cancellation_token: CancellationToken | None = None,
    ) -> AsyncGenerator[str | CreateResult, None]:
        async def _gen() -> AsyncGenerator[str | CreateResult, None]:
            res = await self.create(
                messages,
                tools=tools,
                json_output=json_output,
                extra_create_args=extra_create_args,
                cancellation_token=cancellation_token,
            )
            yield res

        return _gen()

    def actual_usage(self) -> RequestUsage:
        return self._usage

    def total_usage(self) -> RequestUsage:
        return self._usage

    def count_tokens(
        self, messages: Sequence[LLMMessage], *, tools: Sequence[Any] = []
    ) -> int:
        return sum(len(str(m.content)) // 4 for m in messages)

    def remaining_tokens(
        self, messages: Sequence[LLMMessage], *, tools: Sequence[Any] = []
    ) -> int:
        return 128000 - self.count_tokens(messages, tools=tools)

    @property
    def capabilities(self) -> ModelCapabilities:
        return ModelCapabilities(
            vision=False, function_calling=False, json_output=True
        )

    @property
    def model_info(self) -> ModelInfo:
        return ModelInfo(
            vision=False,
            function_calling=False,
            json_output=True,
            family=ModelFamily.UNKNOWN,
        )


async def run_autogen_group_chat(
    artisan: dict[str, Any],
    transcript: list[dict[str, Any]],
    meeting_platform: str = "in_app",
) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, str]]]:
    spoken = [
        u
        for u in transcript
        if u.get("speaker") in ("buyer", "artisan")
        and str(u.get("text", "")).strip()
    ]
    formatted_lines = [
        f"[{u.get('speaker', 'participant').upper()}] {u.get('speakerName', '')}: {u.get('text', '')}"
        for u in spoken
    ]
    transcript_block = "\n".join(formatted_lines)

    model_client = GeminiChatCompletionClient()

    scribe_agent = AssistantAgent(
        name="ScribeAgent",
        model_client=model_client,
        system_message=(
            f"You are ScribeAgent, a silent meeting note-taker who listened to a {meeting_platform} call "
            f"between a customer and {artisan['name']} ({artisan['trade']}). "
            "Extract ONLY what was actually discussed on the call. Never invent facts not in the transcript. "
            "Set paymentMentioned=true ONLY if money, price, cost, budget, or dollar amounts were explicitly discussed; "
            "otherwise set paymentMentioned=false. "
            "Return valid JSON with keys: scheduledWindow (str), scopeSummary (str), paymentMentioned (bool), "
            "buyerActionItems (list[str]), artisanActionItems (list[str]), unresolvedQuestions (list[str])."
        ),
    )

    contract_agent = AssistantAgent(
        name="ContractMediatorAgent",
        model_client=model_client,
        system_message=(
            f"You are ContractMediatorAgent for {artisan['name']} ({artisan['businessName']}, "
            f"baseCalloutCents={artisan['baseCalloutCents']}, hourlyRateCents={artisan['hourlyRateCents']}). "
            "Read the call transcript and ScribeAgent's JSON notes. "
            "1. Set paymentMentioned=true ONLY if pricing/money was explicitly discussed on the call; otherwise false. "
            "2. Set agreementReached=true ONLY if both parties explicitly agreed on a price during the call; otherwise false. "
            "3. Prepare a 2-milestone payment plan in `milestones` (using integer `amountCents` > 0 from the call if payment was mentioned, "
            "or a suggested financial budget based on baseCalloutCents + hourlyRateCents if payment was NOT mentioned) so it is ready "
            "ONLY AFTER the buyer gives permission in chat. "
            "4. Write `postCallChatMessageToBuyer`: a natural, helpful message from Shuks AI to the Buyer in chat that: "
            "   - Summarizes what was discussed on the call and lists the action items. "
            "   - If paymentMentioned is true: asks the Buyer if they want Shuks AI to create this milestone payment plan to hold their money in PayPal Escrow and send the actionable checklist + offer to the Artisan. "
            "   - If paymentMentioned is false: tells the Buyer that payment wasn't mentioned on the call, and asks if they want help planning the financial budget & milestones and sending the offer to the Artisan. "
            "Return valid JSON with keys: paymentMentioned (bool), agreementReached (bool), confidenceScore (float), "
            "postCallChatMessageToBuyer (str), suggestedRangeMinCents (int), suggestedRangeMaxCents (int), totalCents (int), "
            "milestones (list of objects with id, title, description, dueTrigger, amountCents, status='PENDING_FUNDING')."
        ),
    )

    team = RoundRobinGroupChat(
        participants=[scribe_agent, contract_agent],
        max_turns=2,
    )
    task_result = await team.run(task=f"Call Transcript:\n{transcript_block}")

    scribe_notes: dict[str, Any] = {}
    contract_plan: dict[str, Any] = {}
    reasoning_logs: list[dict[str, str]] = []
    now_iso = datetime.now(timezone.utc).isoformat()

    for msg in task_result.messages:
        if not isinstance(msg, TextMessage) or msg.source == "user":
            continue
        parsed = json.loads(_strip_json_fences(msg.content))
        if msg.source == "ScribeAgent":
            scribe_notes = parsed
            reasoning_logs.append(
                {
                    "agentName": "ScribeAgent",
                    "role": "Silent Call Note-Taker",
                    "observation": (
                        f"Captured notes from {len(spoken)} statements "
                        f"(paymentMentioned={scribe_notes.get('paymentMentioned')})."
                    ),
                    "timestampIso": now_iso,
                }
            )
        elif msg.source == "ContractMediatorAgent":
            milestones = parsed.get("milestones") or []
            for idx, ms in enumerate(milestones):
                ms["id"] = ms.get("id") or f"ms-{idx + 1}"
                ms["amountCents"] = max(500, int(ms.get("amountCents", 2500)))
                ms["status"] = "PENDING_FUNDING"
            total_c = sum(int(m["amountCents"]) for m in milestones)
            parsed["milestones"] = milestones
            parsed["totalCents"] = total_c
            parsed.setdefault("confidenceScore", 0.95)
            parsed.setdefault("suggestedRangeMinCents", total_c)
            parsed.setdefault("suggestedRangeMaxCents", total_c)
            contract_plan = parsed
            reasoning_logs.append(
                {
                    "agentName": "ContractMediatorAgent",
                    "role": "Budget & Milestone Planner",
                    "observation": (
                        f"paymentMentioned={contract_plan.get('paymentMentioned')}, "
                        f"agreementReached={contract_plan.get('agreementReached')}, "
                        f"proposedTotalCents={total_c}."
                    ),
                    "timestampIso": now_iso,
                }
            )

    return scribe_notes, contract_plan, reasoning_logs


async def run_conversational_chat_agent(
    artisan: dict[str, Any],
    buyer_name: str,
    buyer_message: str,
    current_analysis: dict[str, Any] | None,
) -> dict[str, Any]:
    model_client = GeminiChatCompletionClient()
    assistant = AssistantAgent(
        name="ShuksChatMediator",
        model_client=model_client,
        system_message=(
            f"You are the Shuks AI Mediator assisting {buyer_name} (the Buyer) in a chat workspace "
            f"with {artisan['name']} ({artisan['businessName']}, {artisan['trade']}; "
            f"base callout ${artisan['baseCalloutCents'] / 100:.0f}, hourly rate ${artisan['hourlyRateCents'] / 100:.0f}/hr). "
            "After a call ends, you wait for the Buyer's permission before activating a milestone payment plan or sending it to the Artisan. "
            "Analyze the Buyer's chat message and the current meeting analysis (if any): "
            "- If the Buyer is approving/asking you to create the milestone plan, help plan the financial budget, or send the plan to the Artisan "
            "(e.g., 'yes', 'go ahead', 'create the plan', 'help me plan the budget', 'do $40 and $80', 'send to artisan'), "
            "set `activatePaymentPlan`: true, `sendOfferToArtisan`: true, and return the finalized `milestones` array (with integer `amountCents` > 0) "
            "plus a clear `agentReplyText` confirming the milestone breakdown and instructing the Buyer to fund PayPal Escrow to lock the money. "
            "- If the Buyer is asking a question or adjusting numbers before approving, answer helpfully in `agentReplyText` and update `milestones` accordingly. "
            "Return valid JSON with keys: agentReplyText (str), activatePaymentPlan (bool), sendOfferToArtisan (bool), "
            "milestones (list of objects with id, title, description, dueTrigger, amountCents, status='PENDING_FUNDING')."
        ),
    )

    context_str = (
        f"Current Call Analysis: {json.dumps(current_analysis)}\n"
        f"Buyer ({buyer_name}) says: {buyer_message}"
    )
    res = await assistant.on_messages(
        [TextMessage(source="user", content=context_str)],
        CancellationToken(),
    )
    chat_msg = res.chat_message
    content_text = chat_msg.content if isinstance(chat_msg, TextMessage) else "{}"
    parsed = json.loads(_strip_json_fences(content_text))

    milestones = parsed.get("milestones") or (
        current_analysis.get("proposedPaymentPlan", {}).get("milestones", [])
        if current_analysis
        else []
    )
    for idx, ms in enumerate(milestones):
        ms["id"] = ms.get("id") or f"ms-{idx + 1}"
        ms["amountCents"] = max(500, int(ms.get("amountCents", 2500)))
        ms["status"] = "PENDING_FUNDING"

    total_cents = sum(int(m["amountCents"]) for m in milestones)
    parsed["milestones"] = milestones
    parsed["totalCents"] = total_cents
    return parsed


async def verify_milestone_proof_with_gemini(
    artisan: dict[str, Any],
    milestone: dict[str, Any],
    call_analysis: dict[str, Any],
    image_base64: str,
    image_mime_type: str,
    artisan_notes: str = "",
) -> dict[str, Any]:
    gemini_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not gemini_key:
        raise RuntimeError("GEMINI_API_KEY is not configured.")

    model = os.environ.get("GEMINI_MODEL", "gemini-3.8-flash").strip()
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

    carved_transcript = call_analysis.get("carvedTranscript") or []
    transcript_str = "\n".join(
        f"[{u.get('speakerName', 'Speaker')}]: {u.get('text', '')}"
        for u in carved_transcript
    )

    prompt = (
        f"You are the Shuks Proof-of-Work Escrow Inspector verifying work submitted by {artisan['name']} "
        f"({artisan['businessName']}, {artisan['trade']}).\n"
        f"Milestone to verify: {milestone.get('title')} — {milestone.get('description')}\n"
        f"Release trigger: {milestone.get('dueTrigger')}\n"
        f"Artisan's submission note: {artisan_notes or 'None provided'}\n"
        f"Original Call Transcript:\n{transcript_str}\n\n"
        "Inspect the uploaded photo carefully. Determine whether the image visually demonstrates "
        "relevant progress, tools, parts, or completed trade work consistent with the milestone (or if it is an "
        "unrelated/blank image). Return valid JSON with keys: "
        '{"verified": bool, "confidenceScore": float, "summary": str}'
    )

    clean_mime = (
        image_mime_type.split(";")[0].strip() if image_mime_type else "image/jpeg"
    )
    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": prompt},
                    {
                        "inlineData": {
                            "mimeType": clean_mime,
                            "data": image_base64,
                        }
                    },
                ],
            }
        ],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json",
        },
    }

    async with httpx.AsyncClient(timeout=25.0) as client:
        resp = await client.post(url, params={"key": gemini_key}, json=payload)
        if resp.status_code in (401, 403) and not gemini_key.startswith("AIza"):
            resp = await client.post(
                url,
                headers={"Authorization": f"Bearer {gemini_key}"},
                json=payload,
            )
        if not resp.is_success:
            raise RuntimeError(
                f"Gemini Vision verification failed ({resp.status_code}): {resp.text[:300]}"
            )
        data = resp.json()
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        parsed = json.loads(_strip_json_fences(text))
        return {
            "verified": bool(parsed.get("verified", True)),
            "confidenceScore": float(parsed.get("confidenceScore", 0.92)),
            "summary": str(parsed.get("summary", "Visual inspection completed.")),
            "checkedAtIso": datetime.now(timezone.utc).isoformat(),
            "artisanNotes": artisan_notes,
        }


async def evaluate_change_order_with_gemini(
    artisan: dict[str, Any],
    current_analysis: dict[str, Any],
    description: str,
    requested_amount_cents: int,
    audio_base64: str | None = None,
    audio_mime_type: str | None = None,
) -> dict[str, Any]:
    extra_audio_text = ""
    if audio_base64:
        utterances = await transcribe_meeting_audio_with_gemini(
            audio_base64=audio_base64,
            mime_type=audio_mime_type or "audio/webm",
            artisan_name=artisan["name"],
        )
        extra_audio_text = " ".join(u["text"] for u in utterances)

    combined_desc = f"{description} {extra_audio_text}".strip()
    model_client = GeminiChatCompletionClient()
    change_agent = AssistantAgent(
        name="ChangeOrderMediator",
        model_client=model_client,
        system_message=(
            f"You are the Shuks Mid-Job Change-Order Mediator for a job with {artisan['name']} ({artisan['trade']}). "
            "Compare the newly discovered mid-job issue against the original call summary and existing milestones. "
            "Structure an Amendment Milestone (`isAmendment: true`) for the additional work and explain the delta "
            "clearly to the Buyer so they can approve it without voiding existing milestones. "
            "Return valid JSON with keys: title (str), description (str), dueTrigger (str), "
            "amountCents (int), explanationMessage (str)."
        ),
    )

    context = (
        f"Existing Analysis & Milestones: {json.dumps(current_analysis)}\n"
        f"Requested Extra Work Description: {combined_desc}\n"
        f"Requested Extra Amount (cents): {requested_amount_cents}"
    )
    res = await change_agent.on_messages(
        [TextMessage(source="user", content=context)],
        CancellationToken(),
    )
    chat_msg = res.chat_message
    content_text = chat_msg.content if isinstance(chat_msg, TextMessage) else "{}"
    parsed = json.loads(_strip_json_fences(content_text))
    parsed["amountCents"] = max(500, int(parsed.get("amountCents", requested_amount_cents)))
    return parsed


async def evaluate_dispute_with_gemini(
    artisan: dict[str, Any],
    current_analysis: dict[str, Any],
    milestone: dict[str, Any],
    reason: str,
    evidence_image_base64: str | None = None,
    evidence_mime_type: str | None = None,
) -> dict[str, Any]:
    milestone_cents = int(milestone.get("amountCents", 5000))
    model_client = GeminiChatCompletionClient()
    arbiter_agent = AssistantAgent(
        name="DisputeArbiterAgent",
        model_client=model_client,
        system_message=(
            f"You are the Shuks AI Escrow Dispute Arbiter mediating a dispute on milestone "
            f"'{milestone.get('title')}' (value: {milestone_cents} cents / ${milestone_cents / 100:.2f} USD) "
            f"between the Buyer and {artisan['name']} ({artisan['businessName']}). "
            "Cross-examine: (1) the original diarized call transcript (`carvedTranscript`), "
            "(2) the agreed action checklists, (3) the Artisan's proof-of-work verification, and "
            "(4) the Buyer's dispute claim. "
            f"Compute a fair, objective split in integer cents where `recommendedArtisanPayoutCents` + "
            f"`recommendedBuyerRefundCents` MUST equal exactly {milestone_cents}. "
            "Return valid JSON with keys: rulingSummary (str), recommendedArtisanPayoutCents (int), "
            "recommendedBuyerRefundCents (int), evidenceCited (list[str])."
        ),
    )

    context = (
        f"Original Call Analysis & Transcript: {json.dumps(current_analysis)}\n"
        f"Disputed Milestone: {json.dumps(milestone)}\n"
        f"Buyer's Dispute Claim: {reason}\n"
        f"Buyer attached photo evidence: {bool(evidence_image_base64)}"
    )
    res = await arbiter_agent.on_messages(
        [TextMessage(source="user", content=context)],
        CancellationToken(),
    )
    chat_msg = res.chat_message
    content_text = chat_msg.content if isinstance(chat_msg, TextMessage) else "{}"
    parsed = json.loads(_strip_json_fences(content_text))

    art_cents = max(
        0,
        min(
            milestone_cents,
            int(parsed.get("recommendedArtisanPayoutCents", milestone_cents // 2)),
        ),
    )
    buyer_cents = milestone_cents - art_cents

    return {
        "milestoneId": milestone["id"],
        "rulingSummary": str(
            parsed.get(
                "rulingSummary",
                "Arbitration completed based on call transcript and milestone evidence.",
            )
        ),
        "recommendedArtisanPayoutCents": art_cents,
        "recommendedBuyerRefundCents": buyer_cents,
        "evidenceCited": list(parsed.get("evidenceCited") or []),
        "decidedAtIso": datetime.now(timezone.utc).isoformat(),
    }
