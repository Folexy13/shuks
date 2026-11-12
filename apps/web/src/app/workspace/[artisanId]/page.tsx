"use client";

import React, { use, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Columns2,
  Lock,
  MapPin,
  Send,
  Star,
  Wrench,
} from "lucide-react";
import { findArtisanInCatalog } from "@/lib/artisans";
import { formatUsdFromCents } from "@/lib/money";
import { useShuksStore } from "@/lib/store";
import {
  AgentMeetingAnalysis,
  ArtisanProfile,
  ChatMessage,
  JobLifecycleState,
} from "@/lib/types";
import { Navbar } from "@/components/ui/navbar";
import { ThreeWayCallStage } from "@/components/call/three-way-call-stage";
import { EscrowMilestonePanel } from "@/components/escrow/escrow-milestone-panel";

export default function WorkspacePage({
  params,
}: {
  params: Promise<{ artisanId: string }>;
}) {
  const { artisanId } = use(params);

  const {
    currentUser,
    artisansCatalog,
    setArtisansCatalog,
    setCurrentUser,
    getOrCreateSession,
    sendChatMessage,
    startThreeWayCall,
    markCallEndedAnalyzing,
    leaveCallWithoutSummary,
    syncJobStateFromServer,
    appendTranscriptUtterance,
    applyAgentChatDecision,
    grantBuyerDraftPermission,
    updateMilestoneAmountCents,
    recordEscrowFunded,
    markMilestoneWorkSubmitted,
    recordMilestonePayoutReleased,
  } = useShuksStore();

  const [summaryDeliveredToast, setSummaryDeliveredToast] = useState(false);
  const [splitScreenArtisanView, setSplitScreenArtisanView] = useState(false);
  const [switchingPersona, setSwitchingPersona] = useState(false);

  useEffect(() => {
    if (artisansCatalog.length === 0) {
      fetch("/api/onboarding")
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { artisans?: ArtisanProfile[] } | null) => {
          if (data?.artisans?.length) {
            setArtisansCatalog(data.artisans);
          }
        })
        .catch(() => {});
    }
  }, [artisansCatalog.length, setArtisansCatalog]);

  useEffect(() => {
    fetch(`/api/jobs/${encodeURIComponent(artisanId)}/state`)
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          data: {
            lifecycleState: JobLifecycleState;
            buyerGrantedDraftPermission: boolean;
            analysis: AgentMeetingAnalysis | null;
            messages: ChatMessage[];
          } | null
        ) => {
          if (data) {
            syncJobStateFromServer(artisanId, data);
          }
        }
      )
      .catch(() => {});
  }, [artisanId, syncJobStateFromServer]);

  const artisan = findArtisanInCatalog(artisanId, artisansCatalog);
  const session = getOrCreateSession(artisanId);
  const [chatDraft, setChatDraft] = useState("");
  const [agentThinking, setAgentThinking] = useState(false);

  useEffect(() => {
    if (session.lifecycleState !== "ANALYZING_CALL") return;

    const eventSource = new EventSource(
      `/api/jobs/${encodeURIComponent(artisanId)}/events`
    );

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as {
          lifecycleState: JobLifecycleState;
          buyerGrantedDraftPermission: boolean;
          analysis: AgentMeetingAnalysis | null;
          messages: ChatMessage[];
        };
        if (data && data.lifecycleState !== "ANALYZING_CALL") {
          syncJobStateFromServer(artisanId, data);
          setSummaryDeliveredToast(true);
          setTimeout(() => setSummaryDeliveredToast(false), 5000);
          eventSource.close();
        }
      } catch {}
    };

    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/jobs/${encodeURIComponent(artisanId)}/state`
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          lifecycleState: JobLifecycleState;
          buyerGrantedDraftPermission: boolean;
          analysis: AgentMeetingAnalysis | null;
          messages: ChatMessage[];
        };
        if (data && data.lifecycleState !== "ANALYZING_CALL") {
          syncJobStateFromServer(artisanId, data);
          setSummaryDeliveredToast(true);
          setTimeout(() => setSummaryDeliveredToast(false), 5000);
          eventSource.close();
          clearInterval(pollInterval);
        }
      } catch {}
    }, 2000);

    return () => {
      eventSource.close();
      clearInterval(pollInterval);
    };
  }, [artisanId, session.lifecycleState, syncJobStateFromServer]);

  if (!artisan) {
    return (
      <div className="min-h-screen bg-canvas text-ink">
        <Navbar />
        <main className="mx-auto max-w-lg px-6 py-24 text-center text-sm text-muted">
          Loading workspace...
        </main>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-canvas text-ink">
        <Navbar />
        <main className="mx-auto max-w-lg px-6 py-24 text-center">
          <div className="rounded-xl border border-border bg-surface p-8 shadow-sm">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-stone text-terracotta">
              <Lock className="h-5 w-5" />
            </div>
            <h1 className="mt-4 text-xl font-bold text-ink">
              Sign in required to contact {artisan.name}
            </h1>
            <p className="mt-2 text-sm text-muted leading-relaxed">
              To message {artisan.name} ({artisan.businessName}), start a 3-way
              web call, or set up a PayPal Escrow payment plan, please sign in
              or create an account first.
            </p>
            <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href={`/onboarding?role=buyer&redirect=/workspace/${artisan.id}`}
                className="w-full sm:w-auto rounded-lg bg-ink px-5 py-2.5 text-xs font-bold text-white hover:bg-terracotta transition-colors"
              >
                Create Account
              </Link>
              <Link
                href={`/onboarding?mode=signin&redirect=/workspace/${artisan.id}`}
                className="w-full sm:w-auto rounded-lg border border-border bg-canvas px-5 py-2.5 text-xs font-semibold text-ink hover:bg-stone transition-colors"
              >
                Sign In with Email
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const persistCurrentAnalysisToBackend = async (
    nextLifecycle: JobLifecycleState,
    systemMessage?: string,
    attachmentType?: string,
    sender?: "buyer" | "artisan" | "agent",
    senderName?: string
  ) => {
    const latest = useShuksStore.getState().getOrCreateSession(artisan.id);
    try {
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(artisan.id)}/state`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lifecycleState: nextLifecycle,
            analysis: latest.meetingAnalysis,
            systemMessage,
            attachmentType,
            sender,
            senderName,
          }),
        }
      );
      if (res.ok) {
        const synced = await res.json();
        syncJobStateFromServer(artisan.id, synced);
      }
    } catch {}
  };

  const handleSendMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = chatDraft.trim();
    if (!trimmed) return;
    setChatDraft("");
    sendChatMessage(artisan.id, currentUser.role, currentUser.name, trimmed);

    try {
      await fetch(`/api/jobs/${encodeURIComponent(artisan.id)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: currentUser.role,
          senderName: currentUser.name,
          text: trimmed,
        }),
      });
    } catch {}

    if (
      currentUser.role === "buyer" &&
      (session.meetingAnalysis ||
        /plan|milestone|budget|escrow|pay|\$|agree|yes|send/i.test(trimmed))
    ) {
      setAgentThinking(true);
      try {
        const res = await fetch(
          `/api/jobs/${encodeURIComponent(artisan.id)}/agent-chat`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              artisanId: artisan.id,
              buyerName: currentUser.name,
              buyerMessage: trimmed,
              currentAnalysis: session.meetingAnalysis,
            }),
          }
        );
        if (res.ok) {
          const decision = await res.json();
          applyAgentChatDecision(artisan.id, {
            agentMessage: decision.agentMessage,
            activatePaymentPlan: Boolean(decision.activatePaymentPlan),
            analysis: decision.analysis ?? session.meetingAnalysis,
          });
        }
      } catch {}
      setAgentThinking(false);
    }
  };

  const handleGrantPermission = async (sendToArtisan: boolean) => {
    grantBuyerDraftPermission(artisan.id);
    try {
      const res = await fetch("/api/agent/grant-permission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artisanId: artisan.id,
          sendToArtisan,
          analysis: session.meetingAnalysis,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.agentMessage) {
          applyAgentChatDecision(artisan.id, {
            agentMessage: data.agentMessage,
            activatePaymentPlan: true,
            analysis: data.analysis ?? session.meetingAnalysis,
          });
        }
      }
    } catch {}
  };

  const handleClearWorkspace = async () => {
    try {
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(artisan.id)}/state`,
        { method: "DELETE" }
      );
      if (res.ok) {
        const freshState = await res.json();
        syncJobStateFromServer(artisan.id, freshState);
      }
    } catch {}
  };

  const handleToggleAccountPersona = async () => {
    if (switchingPersona) return;
    setSwitchingPersona(true);
    const targetEmail =
      currentUser.role === "buyer" ? "aluko@preplink.ai" : "folajimi@paypal.io";
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: targetEmail }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.account) {
          setCurrentUser(data.account);
        }
      }
    } catch {}
    setSwitchingPersona(false);
  };

  const buyerDisplayName =
    currentUser.role === "buyer"
      ? currentUser.name
      : session.messages.find((m) => m.sender === "buyer")?.senderName ||
        "Aluko Folajimi";
  const buyerInitials = buyerDisplayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <Navbar />

      <main className="mx-auto max-w-7xl px-6 py-8 lg:px-10">
        <div className="grid gap-6 lg:grid-cols-12">
          <div
            className={`${
              splitScreenArtisanView ? "lg:col-span-6" : "lg:col-span-8"
            } flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm`}
          >
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-4">
              <div className="flex items-center gap-3.5">
                <Link
                  href="/#directory"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-canvas text-ink hover:bg-stone transition-colors"
                  aria-label="Back to artisan directory"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Link>

                {currentUser.role === "artisan" ? (
                  <>
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-ink text-white text-sm font-bold">
                      {buyerInitials}
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <h1 className="text-base font-bold text-ink">
                          {buyerDisplayName}
                        </h1>
                        <span className="rounded bg-stone px-2 py-0.5 text-[11px] font-semibold text-terracotta">
                          Client / Buyer
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted mt-0.5">
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5 text-terracotta" />
                          {artisan.neighborhood}, {artisan.city}
                        </span>
                        <span>
                          Hiring {artisan.name} ({artisan.trade} &bull;{" "}
                          {formatUsdFromCents(artisan.hourlyRateCents)}/hr)
                        </span>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div
                      className={`flex h-11 w-11 items-center justify-center rounded-lg ${artisan.avatarHue} text-sm font-bold`}
                    >
                      {artisan.name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")}
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <h1 className="text-base font-bold text-ink">
                          {artisan.name}
                        </h1>
                        <span className="rounded bg-stone px-2 py-0.5 text-[11px] font-semibold text-olive">
                          {artisan.trade}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted mt-0.5">
                        <span className="inline-flex items-center gap-1 font-semibold text-ink">
                          <Star className="h-3.5 w-3.5 fill-ochre text-ochre" />
                          {artisan.rating}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5 text-terracotta" />
                          {artisan.neighborhood}, {artisan.city}
                        </span>
                        <span>
                          {formatUsdFromCents(artisan.hourlyRateCents)}/hr
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={switchingPersona}
                  onClick={handleToggleAccountPersona}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
                    currentUser.role === "artisan"
                      ? "border-terracotta bg-terracotta/15 text-terracotta hover:bg-terracotta hover:text-white"
                      : "border-olive bg-olive/15 text-olive hover:bg-olive hover:text-white"
                  }`}
                >
                  <Wrench className="h-3.5 w-3.5" />
                   
                </button>
                <button
                  type="button"
                  onClick={() => setSplitScreenArtisanView((v) => !v)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
                    splitScreenArtisanView
                      ? "border-terracotta bg-terracotta text-white"
                      : "border-border bg-canvas text-ink hover:bg-stone"
                  }`}
                >
                  <Columns2 className="h-3.5 w-3.5" />
                  
                </button>
                {(session.messages.length > 0 || session.meetingAnalysis) && (
                  <button
                    type="button"
                    onClick={handleClearWorkspace}
                    className="rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs font-semibold text-muted hover:border-ink hover:text-ink transition-colors"
                  >
                    Clear Thread
                  </button>
                )}
              </div>
            </div>

            <ThreeWayCallStage
              artisan={artisan}
              currentUser={currentUser}
              session={session}
              onStartCall={() => startThreeWayCall(artisan.id)}
              onCallEndedAnalyzing={() => markCallEndedAnalyzing(artisan.id)}
              onLeaveCallWithoutSummary={() =>
                leaveCallWithoutSummary(artisan.id)
              }
              onAppendUtterance={(utterance) =>
                appendTranscriptUtterance(artisan.id, utterance)
              }
            />

            {session.lifecycleState === "ANALYZING_CALL" && (
              <div
                role="status"
                aria-live="polite"
                className="flex items-center justify-between border-b border-ochre/40 bg-ochre/15 px-6 py-2.5 text-xs font-semibold text-ink"
              >
                <span>
                  Call ended — Shuks AI is summarizing your meeting in the
                  background. You can continue chatting below.
                </span>
                <span className="font-mono text-[11px] text-ochre-dark">
                  Processing...
                </span>
              </div>
            )}

            {summaryDeliveredToast && (
              <div
                role="status"
                aria-live="polite"
                className="flex items-center gap-2 border-b border-olive/40 bg-olive/15 px-6 py-2.5 text-xs font-semibold text-olive"
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>
                  Call summary ready — delivered to your chat thread below.
                </span>
              </div>
            )}

            <div className="flex-1 space-y-4 overflow-y-auto p-6 min-h-[380px] max-h-[520px] bg-canvas">
              {session.messages.length === 0 ? (
                <div className="flex h-[320px] flex-col items-center justify-center text-center">
                  <p className="text-sm font-semibold text-ink">
                    No messages in this workspace yet
                  </p>
                  <p className="mt-1 max-w-md text-xs text-muted leading-relaxed">
                    Start a call, send a call audio recording above for Shuks AI
                    to analyze, or write a message to{" "}
                    {currentUser.role === "buyer"
                      ? artisan.name
                      : `${buyerDisplayName} (Client)`}{" "}
                    below.
                  </p>
                </div>
              ) : (
                session.messages.map((msg) => {
                  const isAgent = msg.sender === "agent";
                  const isSelf = msg.sender === currentUser.role;
                  const showInlineApproval =
                    isAgent &&
                    msg.attachmentType === "permission_request" &&
                    !session.buyerGrantedDraftPermission &&
                    currentUser.role === "buyer" &&
                    session.meetingAnalysis;

                  return (
                    <div
                      key={msg.id}
                      className={`max-w-xl rounded-xl p-4 text-sm leading-relaxed ${
                        isAgent
                          ? "mx-auto max-w-2xl border border-olive/30 bg-olive/10 text-ink"
                          : isSelf
                          ? "ml-auto bg-ink text-white"
                          : "mr-auto border border-border bg-surface text-ink"
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between gap-4 text-xs">
                        <span
                          className={`font-bold ${
                            isAgent
                              ? "text-olive"
                              : isSelf
                              ? "text-ochre"
                              : "text-terracotta"
                          }`}
                        >
                          {msg.senderName}
                        </span>
                        <span className={isSelf ? "text-stone" : "text-subtle"}>
                          {new Date(msg.createdAtIso).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <p className="whitespace-pre-line">{msg.text}</p>

                      {msg.attachmentType?.startsWith("data:image/") && (
                        <div className="mt-3 overflow-hidden rounded-lg border border-border bg-canvas">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={msg.attachmentType}
                            alt="Proof of work submitted by artisan"
                            className="max-h-64 w-full object-cover"
                          />
                        </div>
                      )}

                      {showInlineApproval && session.meetingAnalysis && (
                        <div className="mt-3 pt-3 border-t border-olive/20 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => handleGrantPermission(true)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-xs font-bold text-white hover:bg-terracotta transition-colors"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>
                              {session.meetingAnalysis.paymentMentioned
                                ? `Yes, Create ${formatUsdFromCents(
                                    session.meetingAnalysis.proposedPaymentPlan
                                      .totalCents
                                  )} Escrow Plan & Send to ${artisan.name}`
                                : `Yes, Help Me Plan Budget (${formatUsdFromCents(
                                    session.meetingAnalysis.proposedPaymentPlan
                                      .totalCents
                                  )}) & Send to ${artisan.name}`}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleGrantPermission(false)}
                            className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-ink hover:bg-stone transition-colors"
                          >
                            Create Plan for Review Only
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}

              {agentThinking && (
                <div className="mx-auto max-w-2xl rounded-xl border border-olive/30 bg-olive/10 p-3 text-xs text-muted">
                  Shuks AI is preparing your milestone plan...
                </div>
              )}
            </div>

            <form
              onSubmit={handleSendMessage}
              className="flex gap-2.5 border-t border-border bg-surface p-4"
            >
              <label htmlFor="workspace-chat-input" className="sr-only">
                Write a message
              </label>
              <input
                id="workspace-chat-input"
                type="text"
                value={chatDraft}
                onChange={(e) => setChatDraft(e.target.value)}
                placeholder={
                  session.meetingAnalysis &&
                  !session.buyerGrantedDraftPermission &&
                  currentUser.role === "buyer"
                    ? `Reply to Shuks AI (e.g. "Yes, create the plan and send to ${artisan.name}" or "Split into $40 and $90")...`
                    : `Write a message to ${
                        currentUser.role === "buyer"
                          ? artisan.name
                          : `${buyerDisplayName} (Client)`
                      }...`
                }
                className="flex-1 rounded-lg border border-border bg-canvas px-4 py-2.5 text-sm text-ink placeholder:text-subtle focus:border-ink focus:outline-none"
              />
              <button
                type="submit"
                disabled={!chatDraft.trim() || agentThinking}
                className="inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-2.5 text-xs font-bold text-white hover:bg-terracotta disabled:opacity-40 transition-colors"
              >
                <Send className="h-3.5 w-3.5" />
                <span>Send</span>
              </button>
            </form>
          </div>

          <div
            className={
              splitScreenArtisanView ? "lg:col-span-3" : "lg:col-span-4"
            }
          >
            {splitScreenArtisanView || currentUser.role === "buyer" ? (
              <div className="mb-2 rounded-lg bg-ink px-3 py-1.5 text-xs font-bold text-white flex items-center justify-between">
                <span>
                  Buyer Escrow Controls (
                  {currentUser.role === "buyer" ? currentUser.name : "Client"})
                </span>
                <span className="text-[10px] uppercase text-ochre">Client</span>
              </div>
            ) : (
              <div className="mb-2 rounded-lg bg-terracotta px-3 py-1.5 text-xs font-bold text-white flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5">
                  <Wrench className="h-3.5 w-3.5" />
                  <span>
                    Artisan Escrow &amp; Proof-of-Work ({artisan.name})
                  </span>
                </span>
                <span className="text-[10px] uppercase bg-white/20 px-1.5 py-0.5 rounded">
                  Artisan
                </span>
              </div>
            )}
            <EscrowMilestonePanel
              artisan={artisan}
              currentUser={currentUser}
              session={session}
              personaOverride={
                splitScreenArtisanView ? "buyer" : currentUser.role
              }
              onGrantDraftPermission={handleGrantPermission}
              onUpdateMilestoneCents={(milestoneId, amountCents) =>
                updateMilestoneAmountCents(artisan.id, milestoneId, amountCents)
              }
              onEscrowFunded={(orderId, captureId) => {
                recordEscrowFunded(artisan.id, orderId, captureId);
                void persistCurrentAnalysisToBackend(
                  "ESCROW_FUNDED",
                  `PayPal Order #${orderId} captured (Capture #${captureId}). Funds are locked in escrow.`
                );
              }}
              onSubmitMilestoneWork={(milestoneId) => {
                markMilestoneWorkSubmitted(artisan.id, milestoneId);
                void persistCurrentAnalysisToBackend(
                  "IN_PROGRESS",
                  `${artisan.name} confirmed milestone work is complete on site and ready for inspection.`,
                  undefined,
                  "artisan",
                  artisan.name
                );
              }}
              onMilestonePayoutReleased={(milestoneId, batchId) => {
                recordMilestonePayoutReleased(artisan.id, milestoneId, batchId);
                const nextState =
                  useShuksStore.getState().getOrCreateSession(artisan.id)
                    .lifecycleState || "IN_PROGRESS";
                void persistCurrentAnalysisToBackend(
                  nextState,
                  `PayPal Payout Batch #${batchId} released to ${artisan.paypalEmail}.`,
                  "payout_receipt"
                );
              }}
              onSyncServerState={(data) =>
                syncJobStateFromServer(artisan.id, data)
              }
            />
          </div>

          {splitScreenArtisanView && (
            <div className="lg:col-span-3">
              <div className="mb-2 rounded-lg bg-terracotta px-3 py-1.5 text-xs font-bold text-white flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5">
                  <Wrench className="h-3.5 w-3.5" />
                  <span>Artisan Live View ({artisan.name})</span>
                </span>
                <span className="text-[10px] uppercase bg-white/20 px-1.5 py-0.5 rounded">
                  Live Sync
                </span>
              </div>
              <EscrowMilestonePanel
                artisan={artisan}
                currentUser={currentUser}
                session={session}
                personaOverride="artisan"
                onGrantDraftPermission={handleGrantPermission}
                onUpdateMilestoneCents={(milestoneId, amountCents) =>
                  updateMilestoneAmountCents(
                    artisan.id,
                    milestoneId,
                    amountCents
                  )
                }
                onEscrowFunded={(orderId, captureId) =>
                  recordEscrowFunded(artisan.id, orderId, captureId)
                }
                onSubmitMilestoneWork={(milestoneId) => {
                  markMilestoneWorkSubmitted(artisan.id, milestoneId);
                  void persistCurrentAnalysisToBackend(
                    "IN_PROGRESS",
                    `${artisan.name} confirmed milestone work is complete on site and ready for inspection.`,
                    undefined,
                    "artisan",
                    artisan.name
                  );
                }}
                onMilestonePayoutReleased={(milestoneId, batchId) => {
                  recordMilestonePayoutReleased(
                    artisan.id,
                    milestoneId,
                    batchId
                  );
                  const nextState =
                    useShuksStore.getState().getOrCreateSession(artisan.id)
                      .lifecycleState || "IN_PROGRESS";
                  void persistCurrentAnalysisToBackend(
                    nextState,
                    `PayPal Payout Batch #${batchId} released to ${artisan.paypalEmail}.`,
                    "payout_receipt"
                  );
                }}
                onSyncServerState={(data) =>
                  syncJobStateFromServer(artisan.id, data)
                }
              />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
