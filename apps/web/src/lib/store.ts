import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_BUYER_LOCATION, findArtisanInCatalog } from "./artisans";
import { sumMilestoneCents } from "./money";
import {
  AgentMeetingAnalysis,
  ArtisanProfile,
  ChatMessage,
  GeoCoordinates,
  JobWorkspaceSession,
  OnboardedUserAccount,
  TradeCategory,
  TranscriptUtterance,
} from "./types";

interface ShuksStoreState {
  currentUser: OnboardedUserAccount | null;
  artisansCatalog: ArtisanProfile[];
  buyerCoordinates: GeoCoordinates;
  buyerAddressLabel: string;
  selectedTrade: TradeCategory | "All";
  maxRadiusKm: number;
  searchQuery: string;
  sessionsByArtisanId: Record<string, JobWorkspaceSession>;

  setArtisansCatalog: (artisans: ArtisanProfile[]) => void;
  setCurrentUser: (account: OnboardedUserAccount) => void;
  registerClientAccount: (account: OnboardedUserAccount) => void;
  registerArtisanAccount: (
    account: OnboardedUserAccount,
    artisan: ArtisanProfile
  ) => void;
  signOutUser: () => void;

  setBuyerLocation: (coords: GeoCoordinates, label: string) => void;
  setSelectedTrade: (trade: TradeCategory | "All") => void;
  setMaxRadiusKm: (radiusKm: number) => void;
  setSearchQuery: (query: string) => void;

  getOrCreateSession: (artisanId: string) => JobWorkspaceSession;
  setSessionMessages: (artisanId: string, messages: ChatMessage[]) => void;
  sendChatMessage: (
    artisanId: string,
    sender: "buyer" | "artisan",
    senderName: string,
    text: string
  ) => void;
  startThreeWayCall: (artisanId: string) => void;
  markCallEndedAnalyzing: (artisanId: string) => void;
  leaveCallWithoutSummary: (artisanId: string) => void;
  syncJobStateFromServer: (
    artisanId: string,
    payload: {
      lifecycleState: JobWorkspaceSession["lifecycleState"];
      buyerGrantedDraftPermission: boolean;
      analysis: AgentMeetingAnalysis | null;
      messages: ChatMessage[];
    }
  ) => void;
  appendTranscriptUtterance: (
    artisanId: string,
    utterance: TranscriptUtterance
  ) => void;
  finalizeCallWithAnalysis: (
    artisanId: string,
    analysis: AgentMeetingAnalysis
  ) => void;
  applyAgentChatDecision: (
    artisanId: string,
    payload: {
      agentMessage: ChatMessage;
      activatePaymentPlan: boolean;
      analysis: AgentMeetingAnalysis | null;
    }
  ) => void;
  grantBuyerDraftPermission: (artisanId: string) => void;
  updateMilestoneAmountCents: (
    artisanId: string,
    milestoneId: string,
    newAmountCents: number
  ) => void;
  recordEscrowFunded: (
    artisanId: string,
    paypalOrderId: string,
    paypalCaptureId: string
  ) => void;
  markMilestoneWorkSubmitted: (artisanId: string, milestoneId: string) => void;
  recordMilestonePayoutReleased: (
    artisanId: string,
    milestoneId: string,
    paypalPayoutBatchId: string
  ) => void;
}

function createInitialSession(
  artisanId: string,
  catalog: readonly ArtisanProfile[]
): JobWorkspaceSession {
  const artisan = findArtisanInCatalog(artisanId, catalog);
  const title = artisan
    ? `${artisan.trade} — ${artisan.neighborhood}`
    : `Service — ${artisanId}`;

  return {
    jobId: `job-${artisanId}`,
    artisanId,
    title,
    lifecycleState: "DISCOVERY",
    activePersona: "buyer",
    callActive: false,
    callDurationSeconds: 0,
    callScenarioMode: "agreed_on_call",
    transcript: [],
    meetingAnalysis: null,
    buyerGrantedDraftPermission: false,
    artisanAcceptedOffer: false,
    messages: [],
  };
}

export const useShuksStore = create<ShuksStoreState>()(
  persist(
    (set, get) => ({
      currentUser: null,
      artisansCatalog: [],
      buyerCoordinates: DEFAULT_BUYER_LOCATION,
      buyerAddressLabel: "South Congress, Austin, TX",
      selectedTrade: "All",
      maxRadiusKm: 25,
      searchQuery: "",
      sessionsByArtisanId: {},

      setArtisansCatalog: (artisans) => set({ artisansCatalog: artisans }),

      setCurrentUser: (account) =>
        set({
          currentUser: account,
          buyerCoordinates: account.coordinates,
          buyerAddressLabel: account.locationLabel,
        }),

      registerClientAccount: (account) =>
        set({
          currentUser: account,
          buyerCoordinates: account.coordinates,
          buyerAddressLabel: account.locationLabel,
        }),

      registerArtisanAccount: (account, artisan) => {
        const updatedCatalog = [
          artisan,
          ...get().artisansCatalog.filter((a) => a.id !== artisan.id),
        ];
        set((state) => ({
          currentUser: account,
          artisansCatalog: updatedCatalog,
          buyerCoordinates: account.coordinates,
          buyerAddressLabel: account.locationLabel,
          sessionsByArtisanId: {
            ...state.sessionsByArtisanId,
            [artisan.id]: createInitialSession(artisan.id, updatedCatalog),
          },
        }));
      },

      signOutUser: () => set({ currentUser: null }),

      setBuyerLocation: (coords, label) =>
        set({ buyerCoordinates: coords, buyerAddressLabel: label }),

      setSelectedTrade: (trade) => set({ selectedTrade: trade }),

      setMaxRadiusKm: (radiusKm) => set({ maxRadiusKm: radiusKm }),

      setSearchQuery: (query) => set({ searchQuery: query }),

      getOrCreateSession: (artisanId) => {
        const existing = get().sessionsByArtisanId[artisanId];
        if (existing) return existing;
        return createInitialSession(artisanId, get().artisansCatalog);
      },

      setSessionMessages: (artisanId, messages) =>
        set((state) => {
          const current =
            state.sessionsByArtisanId[artisanId] ??
            createInitialSession(artisanId, state.artisansCatalog);
          return {
            sessionsByArtisanId: {
              ...state.sessionsByArtisanId,
              [artisanId]: {
                ...current,
                messages,
              },
            },
          };
        }),

      sendChatMessage: (artisanId, sender, senderName, text) =>
        set((state) => {
          const current =
            state.sessionsByArtisanId[artisanId] ??
            createInitialSession(artisanId, state.artisansCatalog);
          const nowIso = new Date().toISOString();

          return {
            sessionsByArtisanId: {
              ...state.sessionsByArtisanId,
              [artisanId]: {
                ...current,
                messages: [
                  ...current.messages,
                  {
                    id: `msg-${Date.now()}`,
                    sender,
                    senderName,
                    text,
                    createdAtIso: nowIso,
                  },
                ],
              },
            },
          };
        }),

      startThreeWayCall: (artisanId) =>
        set((state) => {
          const current =
            state.sessionsByArtisanId[artisanId] ??
            createInitialSession(artisanId, state.artisansCatalog);
          return {
            sessionsByArtisanId: {
              ...state.sessionsByArtisanId,
              [artisanId]: {
                ...current,
                lifecycleState: "IN_CALL",
                callActive: true,
                callDurationSeconds: 0,
                transcript: [],
              },
            },
          };
        }),

      markCallEndedAnalyzing: (artisanId) =>
        set((state) => {
          const current =
            state.sessionsByArtisanId[artisanId] ??
            createInitialSession(artisanId, state.artisansCatalog);
          return {
            sessionsByArtisanId: {
              ...state.sessionsByArtisanId,
              [artisanId]: {
                ...current,
                callActive: false,
                lifecycleState: "ANALYZING_CALL",
              },
            },
          };
        }),

      syncJobStateFromServer: (artisanId, payload) =>
        set((state) => {
          const current =
            state.sessionsByArtisanId[artisanId] ??
            createInitialSession(artisanId, state.artisansCatalog);
          return {
            sessionsByArtisanId: {
              ...state.sessionsByArtisanId,
              [artisanId]: {
                ...current,
                callActive: false,
                lifecycleState: payload.lifecycleState,
                buyerGrantedDraftPermission:
                  payload.buyerGrantedDraftPermission,
                meetingAnalysis: payload.analysis,
                messages: payload.messages,
              },
            },
          };
        }),

      leaveCallWithoutSummary: (artisanId) =>
        set((state) => {
          const current =
            state.sessionsByArtisanId[artisanId] ??
            createInitialSession(artisanId, state.artisansCatalog);
          return {
            sessionsByArtisanId: {
              ...state.sessionsByArtisanId,
              [artisanId]: {
                ...current,
                callActive: false,
                lifecycleState: current.meetingAnalysis
                  ? current.lifecycleState
                  : "DISCOVERY",
              },
            },
          };
        }),

      appendTranscriptUtterance: (artisanId, utterance) =>
        set((state) => {
          const current =
            state.sessionsByArtisanId[artisanId] ??
            createInitialSession(artisanId, state.artisansCatalog);
          if (current.transcript.some((u) => u.id === utterance.id)) {
            return state;
          }

          return {
            sessionsByArtisanId: {
              ...state.sessionsByArtisanId,
              [artisanId]: {
                ...current,
                transcript: [...current.transcript, utterance],
              },
            },
          };
        }),

      finalizeCallWithAnalysis: (artisanId, analysis) =>
        set((state) => {
          const current =
            state.sessionsByArtisanId[artisanId] ??
            createInitialSession(artisanId, state.artisansCatalog);
          const nowIso = new Date().toISOString();

          return {
            sessionsByArtisanId: {
              ...state.sessionsByArtisanId,
              [artisanId]: {
                ...current,
                callActive: false,
                lifecycleState: "AWAITING_DRAFT_PERMISSION",
                meetingAnalysis: analysis,
                buyerGrantedDraftPermission: false,
                messages: [
                  ...current.messages,
                  {
                    id: `msg-notes-${Date.now()}`,
                    sender: "agent",
                    senderName: "Shuks AI",
                    text: analysis.summary,
                    createdAtIso: nowIso,
                    attachmentType: "permission_request",
                  },
                ],
              },
            },
          };
        }),

      applyAgentChatDecision: (artisanId, payload) =>
        set((state) => {
          const current =
            state.sessionsByArtisanId[artisanId] ??
            createInitialSession(artisanId, state.artisansCatalog);

          return {
            sessionsByArtisanId: {
              ...state.sessionsByArtisanId,
              [artisanId]: {
                ...current,
                meetingAnalysis: payload.analysis ?? current.meetingAnalysis,
                buyerGrantedDraftPermission:
                  payload.activatePaymentPlan ||
                  current.buyerGrantedDraftPermission,
                lifecycleState: payload.activatePaymentPlan
                  ? "AWAITING_BUYER_FUNDING"
                  : current.lifecycleState,
                messages: [...current.messages, payload.agentMessage],
              },
            },
          };
        }),

      grantBuyerDraftPermission: (artisanId) =>
        set((state) => {
          const current = state.sessionsByArtisanId[artisanId];
          if (!current || !current.meetingAnalysis) return state;
          const nowIso = new Date().toISOString();

          return {
            sessionsByArtisanId: {
              ...state.sessionsByArtisanId,
              [artisanId]: {
                ...current,
                buyerGrantedDraftPermission: true,
                lifecycleState: "AWAITING_BUYER_FUNDING",
                messages: [
                  ...current.messages,
                  {
                    id: `msg-perm-${Date.now()}`,
                    sender: "agent",
                    senderName: "Shuks Mediator",
                    text: "Permission granted. The milestone payment plan is now ready for review and PayPal checkout.",
                    createdAtIso: nowIso,
                    attachmentType: "payment_plan",
                  },
                ],
              },
            },
          };
        }),

      updateMilestoneAmountCents: (artisanId, milestoneId, newAmountCents) =>
        set((state) => {
          const current = state.sessionsByArtisanId[artisanId];
          if (!current || !current.meetingAnalysis) return state;
          const safeAmount = Math.max(500, Math.round(newAmountCents));

          const updatedMilestones =
            current.meetingAnalysis.proposedPaymentPlan.milestones.map((ms) =>
              ms.id === milestoneId ? { ...ms, amountCents: safeAmount } : ms
            );
          const updatedTotalCents = sumMilestoneCents(
            updatedMilestones.map((m) => m.amountCents)
          );

          return {
            sessionsByArtisanId: {
              ...state.sessionsByArtisanId,
              [artisanId]: {
                ...current,
                meetingAnalysis: {
                  ...current.meetingAnalysis,
                  proposedPaymentPlan: {
                    ...current.meetingAnalysis.proposedPaymentPlan,
                    totalCents: updatedTotalCents,
                    milestones: updatedMilestones,
                  },
                },
              },
            },
          };
        }),

      recordEscrowFunded: (artisanId, paypalOrderId, paypalCaptureId) =>
        set((state) => {
          const current = state.sessionsByArtisanId[artisanId];
          if (!current || !current.meetingAnalysis) return state;
          const nowIso = new Date().toISOString();

          const updatedMilestones =
            current.meetingAnalysis.proposedPaymentPlan.milestones.map(
              (ms) => ({
                ...ms,
                status: "ESCROW_LOCKED" as const,
              })
            );

          return {
            sessionsByArtisanId: {
              ...state.sessionsByArtisanId,
              [artisanId]: {
                ...current,
                lifecycleState: "ESCROW_FUNDED",
                artisanAcceptedOffer: true,
                meetingAnalysis: {
                  ...current.meetingAnalysis,
                  proposedPaymentPlan: {
                    ...current.meetingAnalysis.proposedPaymentPlan,
                    paypalOrderId,
                    paypalCaptureId,
                    escrowFundedAtIso: nowIso,
                    milestones: updatedMilestones,
                  },
                },
                messages: [
                  ...current.messages,
                  {
                    id: `msg-escrow-${Date.now()}`,
                    sender: "agent",
                    senderName: "Shuks Mediator",
                    text: `PayPal Order #${paypalOrderId} captured (Capture #${paypalCaptureId}). Funds are locked in escrow.`,
                    createdAtIso: nowIso,
                  },
                ],
              },
            },
          };
        }),

      markMilestoneWorkSubmitted: (artisanId, milestoneId) =>
        set((state) => {
          const current = state.sessionsByArtisanId[artisanId];
          if (!current || !current.meetingAnalysis) return state;
          const artisan = findArtisanInCatalog(
            artisanId,
            state.artisansCatalog
          );
          const nowIso = new Date().toISOString();

          const updatedMilestones =
            current.meetingAnalysis.proposedPaymentPlan.milestones.map((ms) =>
              ms.id === milestoneId
                ? { ...ms, status: "WORK_SUBMITTED" as const }
                : ms
            );

          const submittedMilestone = updatedMilestones.find(
            (m) => m.id === milestoneId
          );

          return {
            sessionsByArtisanId: {
              ...state.sessionsByArtisanId,
              [artisanId]: {
                ...current,
                lifecycleState: "IN_PROGRESS",
                meetingAnalysis: {
                  ...current.meetingAnalysis,
                  proposedPaymentPlan: {
                    ...current.meetingAnalysis.proposedPaymentPlan,
                    milestones: updatedMilestones,
                  },
                },
                messages: [
                  ...current.messages,
                  {
                    id: `msg-submit-${Date.now()}`,
                    sender: "artisan",
                    senderName: artisan?.name ?? "Artisan",
                    text: `Completed "${submittedMilestone?.title ?? "milestone"}". Ready for inspection and payout release.`,
                    createdAtIso: nowIso,
                  },
                ],
              },
            },
          };
        }),

      recordMilestonePayoutReleased: (
        artisanId,
        milestoneId,
        paypalPayoutBatchId
      ) =>
        set((state) => {
          const current = state.sessionsByArtisanId[artisanId];
          if (!current || !current.meetingAnalysis) return state;
          const artisan = findArtisanInCatalog(
            artisanId,
            state.artisansCatalog
          );
          const nowIso = new Date().toISOString();

          const updatedMilestones =
            current.meetingAnalysis.proposedPaymentPlan.milestones.map((ms) =>
              ms.id === milestoneId
                ? {
                    ...ms,
                    status: "RELEASED_VIA_PAYPAL" as const,
                    paypalPayoutBatchId,
                    releasedAtIso: nowIso,
                  }
                : ms
            );

          const allReleased = updatedMilestones.every(
            (ms) => ms.status === "RELEASED_VIA_PAYPAL"
          );

          const releasedItem = updatedMilestones.find(
            (m) => m.id === milestoneId
          );

          return {
            sessionsByArtisanId: {
              ...state.sessionsByArtisanId,
              [artisanId]: {
                ...current,
                lifecycleState: allReleased ? "COMPLETED" : "IN_PROGRESS",
                meetingAnalysis: {
                  ...current.meetingAnalysis,
                  proposedPaymentPlan: {
                    ...current.meetingAnalysis.proposedPaymentPlan,
                    milestones: updatedMilestones,
                  },
                },
                messages: [
                  ...current.messages,
                  {
                    id: `msg-payout-${Date.now()}`,
                    sender: "agent",
                    senderName: "Shuks Mediator",
                    text: `PayPal Payout Batch #${paypalPayoutBatchId} sent to ${artisan?.paypalEmail ?? "artisan"} for "${releasedItem?.title ?? "milestone"}".`,
                    createdAtIso: nowIso,
                    attachmentType: "payout_receipt",
                  },
                ],
              },
            },
          };
        }),
    }),
    {
      name: "shuks-session",
      partialize: (state) => ({
        currentUser: state.currentUser,
        buyerCoordinates: state.buyerCoordinates,
        buyerAddressLabel: state.buyerAddressLabel,
      }),
    }
  )
);
