export type TradeCategory =
  | "Plumbing"
  | "Electrical"
  | "Carpentry"
  | "HVAC & Cooling"
  | "Appliance Repair"
  | "Locksmith";

export type JobLifecycleState =
  | "DISCOVERY"
  | "IN_CALL"
  | "ANALYZING_CALL"
  | "AWAITING_DRAFT_PERMISSION"
  | "AWAITING_BUYER_FUNDING"
  | "ESCROW_FUNDED"
  | "IN_PROGRESS"
  | "COMPLETED";

export type ActivePersona = "buyer" | "artisan";

export type SpeakerRole = "buyer" | "artisan" | "agent";

export interface GeoCoordinates {
  lat: number;
  lng: number;
}

export interface ArtisanProfile {
  id: string;
  name: string;
  businessName: string;
  trade: TradeCategory;
  rating: number;
  completedJobsCount: number;
  responseMinutes: number;
  hourlyRateCents: number;
  baseCalloutCents: number;
  neighborhood: string;
  city: string;
  coordinates: GeoCoordinates;
  paypalEmail: string;
  verifiedBadges: string[];
  bio: string;
  skills: string[];
  avatarHue: string;
  availableNow: boolean;
}

export interface TranscriptUtterance {
  id: string;
  speaker: SpeakerRole;
  speakerName: string;
  text: string;
  timestampIso: string;
}

export type MilestoneStatus =
  | "PENDING_FUNDING"
  | "ESCROW_LOCKED"
  | "WORK_SUBMITTED"
  | "RELEASED_VIA_PAYPAL"
  | "DISPUTED"
  | "RESOLVED_SPLIT";

export interface ProofOfWorkVerification {
  verified: boolean;
  confidenceScore: number;
  summary: string;
  checkedAtIso: string;
  artisanNotes?: string;
  imageDataUrl?: string | null;
}

export interface DisputeRuling {
  milestoneId: string;
  rulingSummary: string;
  recommendedArtisanPayoutCents: number;
  recommendedBuyerRefundCents: number;
  evidenceCited: string[];
  decidedAtIso: string;
}

export interface EscrowMilestone {
  id: string;
  title: string;
  description: string;
  dueTrigger: string;
  amountCents: number;
  status: MilestoneStatus;
  isAmendment?: boolean;
  paypalPayoutBatchId?: string;
  releasedAtIso?: string;
  proofVerification?: ProofOfWorkVerification | null;
  disputeRuling?: DisputeRuling | null;
}

export interface PaymentPlanProposal {
  id: string;
  currency: "USD";
  totalCents: number;
  milestones: EscrowMilestone[];
  paypalOrderId?: string;
  paypalCaptureId?: string;
  escrowFundedAtIso?: string;
}

export interface AgentMeetingAnalysis {
  callId: string;
  paymentMentioned?: boolean;
  agreementReached: boolean;
  confidenceScore: number;
  summary: string;
  scheduledWindow: string;
  locationNotes: string;
  unresolvedQuestions: string[];
  buyerActionItems: string[];
  artisanActionItems: string[];
  suggestedRangeMinCents: number;
  suggestedRangeMaxCents: number;
  proposedPaymentPlan: PaymentPlanProposal;
  carvedTranscript?: TranscriptUtterance[];
  autogenReasoningLog: {
    agentName: string;
    role: string;
    observation: string;
    timestampIso: string;
  }[];
}

export interface ChatMessage {
  id: string;
  sender: SpeakerRole;
  senderName: string;
  text: string;
  createdAtIso: string;
  attachmentType?: string | null;
}

export interface OnboardedUserAccount {
  id: string;
  role: "buyer" | "artisan";
  name: string;
  email: string;
  phone: string;
  paypalEmail: string;
  locationLabel: string;
  coordinates: GeoCoordinates;
  linkedArtisanId?: string;
}

export interface JobWorkspaceSession {
  jobId: string;
  artisanId: string;
  title: string;
  lifecycleState: JobLifecycleState;
  activePersona: ActivePersona;
  callActive: boolean;
  callDurationSeconds: number;
  callScenarioMode: "agreed_on_call" | "needs_post_call_permission";
  transcript: TranscriptUtterance[];
  meetingAnalysis: AgentMeetingAnalysis | null;
  buyerGrantedDraftPermission: boolean;
  artisanAcceptedOffer: boolean;
  messages: ChatMessage[];
}

export interface SpeechRecognitionEventResult {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      0: { transcript: string };
    };
  };
}

export interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventResult) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
