from typing import Any, Literal
from pydantic import BaseModel, Field


class CoordinatesPayload(BaseModel):
    lat: float
    lng: float


class ClientOnboardingPayload(BaseModel):
    name: str = Field(..., min_length=1)
    email: str = Field(..., min_length=3)
    phone: str = ""
    paypalEmail: str = Field(..., min_length=3)
    locationLabel: str = Field(..., min_length=1)
    coordinates: CoordinatesPayload


class ArtisanOnboardingPayload(BaseModel):
    name: str = Field(..., min_length=1)
    businessName: str = Field(..., min_length=1)
    email: str = Field(..., min_length=3)
    phone: str = ""
    paypalEmail: str = Field(..., min_length=3)
    trade: str = Field(..., min_length=1)
    hourlyRateCents: int = Field(..., gt=0)
    baseCalloutCents: int = Field(..., gt=0)
    responseMinutes: int = Field(default=10, gt=0)
    bio: str = Field(..., min_length=1)
    skills: list[str] = Field(default_factory=list)
    locationLabel: str = Field(..., min_length=1)
    coordinates: CoordinatesPayload


class LoginPayload(BaseModel):
    email: str = Field(..., min_length=3)


class AnalyzeCallPayload(BaseModel):
    artisanId: str = Field(..., min_length=1)
    scenarioMode: str = "agreed_on_call"
    meetingPlatform: str = "in_app"
    meetingUrl: str | None = None
    recordingFile: str | None = None
    transcript: list[dict[str, Any]] = Field(default_factory=list)
    audioBase64: str | None = None
    audioMimeType: str | None = None


class GrantPermissionPayload(BaseModel):
    artisanId: str = Field(..., min_length=1)
    sendToArtisan: bool = True
    analysis: dict[str, Any] | None = None


class AgentChatTurnPayload(BaseModel):
    artisanId: str = Field(..., min_length=1)
    buyerName: str = Field(..., min_length=1)
    buyerMessage: str = Field(..., min_length=1)
    currentAnalysis: dict[str, Any] | None = None


class ChatMessageCreatePayload(BaseModel):
    sender: Literal["buyer", "artisan", "agent"]
    senderName: str = Field(..., min_length=1)
    text: str = Field(..., min_length=1)
    attachmentType: str | None = None


class PayPalLedgerPayload(BaseModel):
    jobId: str = Field(..., min_length=1)
    eventType: str = Field(..., min_length=1)
    paypalReferenceId: str = Field(..., min_length=1)
    amountCents: int = Field(..., gt=0)
    milestoneId: str | None = None
    recipientPayPalEmail: str | None = None


class ProofVerificationPayload(BaseModel):
    milestoneId: str = Field(..., min_length=1)
    imageBase64: str = Field(..., min_length=10)
    imageMimeType: str = "image/jpeg"
    artisanNotes: str = ""


class ClaimContractPayload(BaseModel):
    artisanName: str = Field(..., min_length=1)
    paypalEmail: str = Field(..., min_length=3)


class ChangeOrderPayload(BaseModel):
    requestedBy: Literal["buyer", "artisan"] = "artisan"
    description: str = Field(..., min_length=3)
    requestedAmountCents: int = Field(..., gt=0)
    audioBase64: str | None = None
    audioMimeType: str | None = None


class DisputePayload(BaseModel):
    milestoneId: str = Field(..., min_length=1)
    reason: str = Field(..., min_length=3)
    evidenceImageBase64: str | None = None
    evidenceMimeType: str | None = None


class BotJoinPayload(BaseModel):
    meetingUrl: str = Field(..., min_length=5)
    transcript: list[dict[str, Any]] = Field(default_factory=list)


class ProofOfWorkVerificationSchema(BaseModel):
    verified: bool
    confidenceScore: float
    summary: str
    checkedAtIso: str
    artisanNotes: str = ""
    imageDataUrl: str | None = None


class DisputeRulingSchema(BaseModel):
    milestoneId: str
    rulingSummary: str
    recommendedArtisanPayoutCents: int
    recommendedBuyerRefundCents: int
    evidenceCited: list[str]
    decidedAtIso: str


class EscrowMilestoneSchema(BaseModel):
    id: str
    title: str
    description: str
    dueTrigger: str
    amountCents: int = Field(..., gt=0)
    status: Literal[
        "PENDING_FUNDING",
        "ESCROW_LOCKED",
        "WORK_SUBMITTED",
        "RELEASED_VIA_PAYPAL",
        "DISPUTED",
        "RESOLVED_SPLIT",
    ] = "PENDING_FUNDING"
    isAmendment: bool = False
    paypalPayoutBatchId: str | None = None
    releasedAtIso: str | None = None
    proofVerification: ProofOfWorkVerificationSchema | None = None
    disputeRuling: DisputeRulingSchema | None = None


class PaymentPlanProposalSchema(BaseModel):
    id: str
    currency: Literal["USD"] = "USD"
    totalCents: int = Field(..., gt=0)
    milestones: list[EscrowMilestoneSchema]
    paypalOrderId: str | None = None
    paypalCaptureId: str | None = None
    escrowFundedAtIso: str | None = None
