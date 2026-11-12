"use client";

import React, { useState } from "react";
import Link from "next/link";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import {
  AlertCircle,
  Camera,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Copy,
  DollarSign,
  ExternalLink,
  Gavel,
  Lock,
  PlusCircle,
  Scale,
  Send,
  ShieldAlert,
  Unlock,
  Wallet,
} from "lucide-react";
import {
  AgentMeetingAnalysis,
  ArtisanProfile,
  ChatMessage,
  JobLifecycleState,
  JobWorkspaceSession,
  OnboardedUserAccount,
} from "@/lib/types";
import {
  formatPayPalDecimalFromCents,
  formatUsdFromCents,
  sumMilestoneCents,
} from "@/lib/money";

interface EscrowMilestonePanelProps {
  artisan: ArtisanProfile;
  currentUser: OnboardedUserAccount;
  session: JobWorkspaceSession;
  personaOverride?: "buyer" | "artisan";
  onGrantDraftPermission: (sendToArtisan: boolean) => void;
  onUpdateMilestoneCents: (milestoneId: string, amountCents: number) => void;
  onEscrowFunded: (paypalOrderId: string, paypalCaptureId: string) => void;
  onSubmitMilestoneWork: (milestoneId: string) => void;
  onMilestonePayoutReleased: (
    milestoneId: string,
    paypalPayoutBatchId: string
  ) => void;
  onSyncServerState?: (state: {
    lifecycleState: JobLifecycleState;
    buyerGrantedDraftPermission: boolean;
    analysis: AgentMeetingAnalysis | null;
    messages: ChatMessage[];
  }) => void;
}

function compressImageToJpegBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== "string") {
        reject(new Error("Could not read image file"));
        return;
      }
      const img = new Image();
      img.onload = () => {
        const maxDim = 900;
        let width = img.width || 640;
        let height = img.height || 480;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(dataUrl.split(",")[1] || "");
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const jpegUrl = canvas.toDataURL("image/jpeg", 0.78);
        resolve(jpegUrl.split(",")[1] || "");
      };
      img.onerror = () => {
        const fallback = dataUrl.includes(",") ? dataUrl.split(",")[1] : "";
        if (fallback) resolve(fallback);
        else reject(new Error("Unsupported image format"));
      };
      img.src = dataUrl;
    };
    reader.onerror = () => reject(new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

export function EscrowMilestonePanel({
  artisan,
  currentUser,
  session,
  personaOverride,
  onGrantDraftPermission,
  onUpdateMilestoneCents,
  onEscrowFunded,
  onSubmitMilestoneWork,
  onMilestonePayoutReleased,
  onSyncServerState,
}: EscrowMilestonePanelProps) {
  const [checkoutError, setCheckoutError] = useState("");
  const [fundingSandboxOrder, setFundingSandboxOrder] = useState(false);
  const [releasingMilestoneId, setReleasingMilestoneId] = useState<
    string | null
  >(null);
  const [payoutError, setPayoutError] = useState("");
  const [copiedLink, setCopiedLink] = useState(false);

  const [verifyingProofId, setVerifyingProofId] = useState<string | null>(null);
  const [proofNotesByMs, setProofNotesByMs] = useState<Record<string, string>>(
    {}
  );
  const [proofError, setProofError] = useState("");

  const [showChangeOrderForm, setShowChangeOrderForm] = useState(false);
  const [changeDesc, setChangeDesc] = useState("");
  const [changeAmountUsd, setChangeAmountUsd] = useState("45");
  const [submittingChangeOrder, setSubmittingChangeOrder] = useState(false);
  const [changeOrderError, setChangeOrderError] = useState("");

  const [activeDisputeMsId, setActiveDisputeMsId] = useState<string | null>(
    null
  );
  const [disputeReason, setDisputeReason] = useState("");
  const [submittingDispute, setSubmittingDispute] = useState(false);
  const [disputeError, setDisputeError] = useState("");

  const [withdrawalEmail, setWithdrawalEmail] = useState(
    currentUser.role === "artisan" && currentUser.paypalEmail
      ? currentUser.paypalEmail
      : artisan.paypalEmail
  );
  const [paypalPassword, setPaypalPassword] = useState("shuks-sandbox-2026");
  const [paypalConnected, setPaypalConnected] = useState(false);
  const [showPayPalLoginModal, setShowPayPalLoginModal] = useState(false);
  const [connectingPayPal, setConnectingPayPal] = useState(false);
  const [withdrawingFunds, setWithdrawingFunds] = useState(false);
  const [withdrawnReceipt, setWithdrawnReceipt] = useState<{
    amountCents: number;
    paypalEmail: string;
    referenceId: string;
    timestampIso: string;
  } | null>(null);

  const analysis = session.meetingAnalysis;
  const userRole = personaOverride ?? currentUser.role;

  const handleConnectArtisanPayPal = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!withdrawalEmail.trim() || !paypalPassword.trim() || connectingPayPal)
      return;
    setConnectingPayPal(true);
    setPayoutError("");

    try {
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(artisan.id)}/claim-contract`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            artisanName: artisan.name,
            paypalEmail: withdrawalEmail.trim(),
          }),
        }
      );
      if (res.ok) {
        const synced = await res.json();
        onSyncServerState?.(synced);
      }
      setPaypalConnected(true);
      setShowPayPalLoginModal(false);
    } catch {
      setPayoutError("Could not authenticate with PayPal Sandbox.");
    } finally {
      setConnectingPayPal(false);
    }
  };

  const handleWithdrawToPayPal = async (amountCents: number) => {
    if (withdrawingFunds || amountCents <= 0) return;
    setWithdrawingFunds(true);
    setPayoutError("");

    try {
      const refId = `PP-WD-${Date.now().toString(36).toUpperCase()}`;
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(artisan.id)}/state`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lifecycleState: session.lifecycleState,
            analysis: session.meetingAnalysis,
            systemMessage: `${artisan.name} withdrew ${formatUsdFromCents(
              amountCents
            )} USD of released escrow earnings to PayPal account ${withdrawalEmail.trim()} (Transfer Ref #${refId}).`,
            attachmentType: "payout_receipt",
          }),
        }
      );
      if (res.ok) {
        const synced = await res.json();
        onSyncServerState?.(synced);
      }
      setWithdrawnReceipt({
        amountCents,
        paypalEmail: withdrawalEmail.trim(),
        referenceId: refId,
        timestampIso: new Date().toISOString(),
      });
    } catch {
      setPayoutError("Unable to process PayPal withdrawal right now.");
    } finally {
      setWithdrawingFunds(false);
    }
  };

  const handleCopyContractLink = () => {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/contract/${artisan.id}`;
    navigator.clipboard.writeText(url).catch(() => {});
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 3000);
  };

  const handleUploadProofPhoto = async (
    milestoneId: string,
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file || verifyingProofId) return;
    setVerifyingProofId(milestoneId);
    setProofError("");

    try {
      const imageBase64 = await compressImageToJpegBase64(file);
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(artisan.id)}/verify-proof`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            milestoneId,
            imageBase64,
            imageMimeType: "image/jpeg",
            artisanNotes: proofNotesByMs[milestoneId] || "",
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Proof verification failed.");
      }
      onSyncServerState?.(data);
    } catch (error) {
      setProofError(
        error instanceof Error
          ? error.message
          : "Unable to verify proof photo."
      );
    } finally {
      setVerifyingProofId(null);
      event.target.value = "";
    }
  };

  const handleCreateChangeOrder = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!changeDesc.trim() || submittingChangeOrder) return;
    setSubmittingChangeOrder(true);
    setChangeOrderError("");

    try {
      const amountCents = Math.max(
        500,
        Math.round(Number(changeAmountUsd || 45) * 100)
      );
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(artisan.id)}/change-order`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestedBy: userRole,
            description: changeDesc.trim(),
            requestedAmountCents: amountCents,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Change order failed.");
      }
      onSyncServerState?.(data);
      setChangeDesc("");
      setShowChangeOrderForm(false);
    } catch (error) {
      setChangeOrderError(
        error instanceof Error ? error.message : "Could not add change order."
      );
    } finally {
      setSubmittingChangeOrder(false);
    }
  };

  const handleSubmitDispute = async (
    event: React.FormEvent,
    milestoneId: string
  ) => {
    event.preventDefault();
    if (!disputeReason.trim() || submittingDispute) return;
    setSubmittingDispute(true);
    setDisputeError("");

    try {
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(artisan.id)}/dispute`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            milestoneId,
            reason: disputeReason.trim(),
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Dispute arbitration failed.");
      }
      onSyncServerState?.(data);
      setDisputeReason("");
      setActiveDisputeMsId(null);
    } catch (error) {
      setDisputeError(
        error instanceof Error ? error.message : "Dispute arbitration failed."
      );
    } finally {
      setSubmittingDispute(false);
    }
  };

  const handleReleaseMilestonePayout = async (
    milestoneId: string,
    amountCents: number,
    title: string
  ) => {
    if (releasingMilestoneId) return;
    setReleasingMilestoneId(milestoneId);
    setPayoutError("");

    try {
      const response = await fetch("/api/paypal/release-payout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: session.jobId,
          milestoneId,
          recipientPayPalEmail: artisan.paypalEmail,
          amountCents,
          note: `Shuks Milestone Payout for "${title}"`,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          data.error || "PayPal Payouts API rejected the request."
        );
      }

      onMilestonePayoutReleased(milestoneId, data.payoutBatchId);
    } catch (error) {
      setPayoutError(
        error instanceof Error
          ? error.message
          : "Unable to release milestone payout."
      );
    } finally {
      setReleasingMilestoneId(null);
    }
  };

  const handleSandboxFundEscrow = async () => {
    if (!analysis || fundingSandboxOrder) return;
    setFundingSandboxOrder(true);
    setCheckoutError("");
    try {
      const totalCents = analysis.proposedPaymentPlan.totalCents;
      const createRes = await fetch("/api/paypal/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: session.jobId,
          totalCents,
          description: `Shuks Escrow: ${session.title} with ${artisan.name}`,
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) {
        throw new Error(createData.error || "Could not create PayPal order.");
      }

      const captureRes = await fetch("/api/paypal/capture-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: createData.orderId,
          jobId: session.jobId,
          amountCents: totalCents,
        }),
      });
      const captureData = await captureRes.json();
      if (!captureRes.ok) {
        throw new Error(captureData.error || "Could not capture PayPal order.");
      }

      onEscrowFunded(createData.orderId, captureData.captureId);
    } catch (error) {
      setCheckoutError(
        error instanceof Error
          ? error.message
          : "Unable to fund PayPal Sandbox Escrow."
      );
    } finally {
      setFundingSandboxOrder(false);
    }
  };

  if (!analysis) {
    return (
      <aside className="rounded-xl border border-border bg-surface p-6">
        <div className="flex items-center gap-2.5 border-b border-stone pb-4">
          <ClipboardCheck className="h-5 w-5 text-olive" />
          <h2 className="text-sm font-bold text-ink">
            Meeting Notes &amp; PayPal Escrow
          </h2>
        </div>
        <div className="py-10 text-center">
          <p className="text-sm font-semibold text-ink">No call summary yet</p>
          <p className="mt-1.5 text-xs text-muted leading-relaxed">
            Start a call, connect Zoom / Meet / Slack, or send a call recording
            above. Shuks AI will listen silently, send the summary to your chat,
            and ask before creating a payment plan.
          </p>
        </div>
      </aside>
    );
  }

  const plan = analysis.proposedPaymentPlan;
  const releasedCents = sumMilestoneCents(
    plan.milestones
      .filter((m) => m.status === "RELEASED_VIA_PAYPAL")
      .map((m) => m.amountCents)
  );
  const remainingEscrowCents = plan.totalCents - releasedCents;
  const showPaymentPlanOffer = session.buyerGrantedDraftPermission;

  const paypalClientId =
    process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID &&
    process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID !== "sb"
      ? process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID
      : "test";

  return (
    <aside className="space-y-5">
      {userRole === "artisan" ? (
        <div className="rounded-xl border-2 border-olive bg-surface p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-stone pb-3">
            <div className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-olive" />
              <div>
                <h3 className="text-sm font-bold text-ink">
                  Artisan PayPal Earnings &amp; Withdrawal
                </h3>
                <p className="text-[11px] text-muted">
                  Released milestone funds ready for your PayPal wallet
                </p>
              </div>
            </div>
            <span className="rounded bg-olive/15 px-2 py-0.5 text-[10px] font-bold uppercase text-olive">
              Artisan Wallet
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-olive/30 bg-olive/10 p-3">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-olive">
                Available to Withdraw
              </span>
              <span className="mt-1 block font-mono text-xl font-extrabold text-ink">
                {formatUsdFromCents(
                  withdrawnReceipt?.amountCents === releasedCents
                    ? 0
                    : releasedCents
                )}
              </span>
            </div>
            <div className="rounded-lg border border-border bg-canvas p-3">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-muted">
                Still Locked in Escrow
              </span>
              <span className="mt-1 block font-mono text-xl font-extrabold text-ink">
                {formatUsdFromCents(remainingEscrowCents)}
              </span>
            </div>
          </div>

          {!paypalConnected ? (
            <div className="space-y-3 rounded-lg border border-border bg-canvas p-3.5">
              <div className="flex items-start gap-2.5">
                <Lock className="h-4 w-4 text-terracotta shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-ink">
                    PayPal Account Not Connected Yet
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted leading-relaxed">
                    Log in with your PayPal Sandbox account (or use the pre-set
                    test account) to authorize payouts and withdraw your{" "}
                    {releasedCents > 0
                      ? formatUsdFromCents(releasedCents)
                      : "released"}{" "}
                    earnings.
                  </p>
                </div>
              </div>

              {!showPayPalLoginModal ? (
                <button
                  type="button"
                  onClick={() => setShowPayPalLoginModal(true)}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#0070ba] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#005ea6] transition-colors"
                >
                  <Wallet className="h-4 w-4" />
                  <span>Log in with PayPal to Connect Payouts</span>
                </button>
              ) : (
                <form
                  onSubmit={handleConnectArtisanPayPal}
                  className="space-y-2.5 rounded-lg border border-[#0070ba]/40 bg-surface p-3"
                >
                  <div className="flex items-center justify-between border-b border-stone pb-2">
                    <span className="text-xs font-extrabold text-[#0070ba]">
                      PayPal Sandbox Sign In
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setWithdrawalEmail(
                          "sb-marcus.rivera@business.example.com"
                        );
                        setPaypalPassword("shuks-sandbox-2026");
                      }}
                      className="rounded bg-[#0070ba]/10 px-2 py-0.5 text-[10px] font-bold text-[#0070ba] hover:bg-[#0070ba]/20"
                    >
                      Fill Test Account
                    </button>
                  </div>

                  <div>
                    <label
                      htmlFor="artisan-paypal-login-email"
                      className="block text-[10px] font-bold uppercase text-muted mb-1"
                    >
                      PayPal Email
                    </label>
                    <input
                      id="artisan-paypal-login-email"
                      type="email"
                      required
                      value={withdrawalEmail}
                      onChange={(e) => setWithdrawalEmail(e.target.value)}
                      placeholder="sb-marcus.rivera@business.example.com"
                      className="w-full rounded border border-border bg-canvas px-2.5 py-1.5 font-mono text-xs text-ink"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="artisan-paypal-login-pwd"
                      className="block text-[10px] font-bold uppercase text-muted mb-1"
                    >
                      Sandbox Password
                    </label>
                    <input
                      id="artisan-paypal-login-pwd"
                      type="password"
                      required
                      value={paypalPassword}
                      onChange={(e) => setPaypalPassword(e.target.value)}
                      className="w-full rounded border border-border bg-canvas px-2.5 py-1.5 text-xs text-ink"
                    />
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      type="submit"
                      disabled={connectingPayPal}
                      className="flex-1 rounded-lg bg-[#0070ba] px-3 py-2 text-xs font-bold text-white hover:bg-[#005ea6] disabled:opacity-50"
                    >
                      {connectingPayPal
                        ? "Authenticating..."
                        : "Log In & Connect PayPal"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowPayPalLoginModal(false)}
                      className="rounded-lg border border-border bg-canvas px-3 py-2 text-xs font-semibold text-muted hover:text-ink"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between rounded-lg border border-olive/30 bg-canvas px-3 py-2 text-xs">
                <div className="truncate">
                  <span className="block text-[10px] font-bold uppercase text-olive">
                    PayPal Connected &amp; Verified
                  </span>
                  <span className="font-mono text-xs font-semibold text-ink">
                    {withdrawalEmail}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPaypalConnected(false);
                    setShowPayPalLoginModal(true);
                  }}
                  className="text-[11px] font-semibold text-terracotta hover:underline ml-2 shrink-0"
                >
                  Switch
                </button>
              </div>

              {withdrawnReceipt &&
              withdrawnReceipt.amountCents === releasedCents ? (
                <div className="rounded-lg border border-olive bg-olive/15 p-3.5 text-xs space-y-1.5">
                  <div className="flex items-center gap-1.5 font-bold text-olive">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>
                      {formatUsdFromCents(withdrawnReceipt.amountCents)}{" "}
                      Withdrawn to PayPal!
                    </span>
                  </div>
                  <p className="text-ink">
                    Sent to:{" "}
                    <strong className="font-mono">
                      {withdrawnReceipt.paypalEmail}
                    </strong>
                  </p>
                  <p className="font-mono text-[11px] text-muted">
                    Transfer Ref: #{withdrawnReceipt.referenceId}
                  </p>
                </div>
              ) : releasedCents > 0 ? (
                <div className="space-y-2.5 rounded-lg border border-olive/40 bg-canvas p-3.5">
                  <p className="text-xs font-semibold text-ink">
                    Client released{" "}
                    <strong className="text-olive">
                      {formatUsdFromCents(releasedCents)}
                    </strong>{" "}
                    from escrow! Click below to transfer it to your connected
                    PayPal balance:
                  </p>
                  <button
                    type="button"
                    disabled={withdrawingFunds || !withdrawalEmail.trim()}
                    onClick={() => handleWithdrawToPayPal(releasedCents)}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-olive px-4 py-2.5 text-xs font-bold text-white hover:bg-olive-dark disabled:opacity-50 transition-colors"
                  >
                    <Wallet className="h-4 w-4" />
                    <span>
                      {withdrawingFunds
                        ? "Transferring to PayPal..."
                        : `Withdraw ${formatUsdFromCents(
                            releasedCents
                          )} to PayPal Now`}
                    </span>
                  </button>
                </div>
              ) : (
                <p className="rounded-lg bg-canvas p-3 text-xs text-muted">
                  Your PayPal account is connected. Once the client releases a
                  completed milestone, you can withdraw the funds here.
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-ink">
                Shareable Artisan Contract Link
              </p>
              <p className="text-[11px] text-muted">
                Send to any artisan to claim &amp; connect PayPal
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleCopyContractLink}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-canvas px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-stone transition-colors"
              >
                {copiedLink ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-olive" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5 text-terracotta" />
                    <span>Copy Link</span>
                  </>
                )}
              </button>
              <Link
                href={`/contract/${artisan.id}`}
                target="_blank"
                title="Open Shareable Contract Page"
                className="inline-flex items-center justify-center rounded-lg border border-border bg-canvas p-1.5 text-ink hover:bg-stone transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-center justify-between gap-2 border-b border-stone pb-3.5">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-olive" />
            <h3 className="text-sm font-bold text-ink">
              Call Notes &amp; Action Items
            </h3>
          </div>
          <span
            className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
              showPaymentPlanOffer
                ? "bg-olive/15 text-olive"
                : "bg-ochre/20 text-ochre-dark"
            }`}
          >
            {showPaymentPlanOffer ? "Plan Approved" : "Awaiting Buyer Decision"}
          </span>
        </div>

        <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-ink">
          <Clock className="h-3.5 w-3.5 text-terracotta" />
          <span>{analysis.scheduledWindow}</span>
        </div>

        <div className="mt-4 space-y-3">
          <div className="rounded-lg bg-canvas p-3.5">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-ink">
              Client Actionable Points
            </h4>
            <ul className="mt-2 space-y-1.5 text-xs text-muted">
              {analysis.buyerActionItems.map((item, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-olive mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg bg-canvas p-3.5">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-ink">
              Artisan Actionable Points ({artisan.name})
            </h4>
            <ul className="mt-2 space-y-1.5 text-xs text-muted">
              {analysis.artisanActionItems.map((item, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-terracotta mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {analysis.carvedTranscript &&
            analysis.carvedTranscript.length > 0 && (
              <div className="rounded-lg border border-border bg-canvas p-3.5">
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-ink">
                  Diarized Audio Transcript Carved Out by Shuks AI
                </h4>
                <div className="mt-2 max-h-48 space-y-2 overflow-y-auto pr-1 text-xs">
                  {analysis.carvedTranscript.map((utt) => (
                    <div
                      key={utt.id}
                      className="rounded border border-stone bg-surface p-2"
                    >
                      <strong
                        className={
                          utt.speaker === "buyer"
                            ? "text-olive"
                            : "text-terracotta"
                        }
                      >
                        {utt.speakerName}:{" "}
                      </strong>
                      <span className="text-ink">{utt.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
        </div>
      </div>

      {!showPaymentPlanOffer && (
        <div className="rounded-xl border border-ochre bg-canvas p-5 space-y-3">
          <h3 className="text-sm font-bold text-ink">
            {analysis.paymentMentioned
              ? "Create Milestone Plan & Send to Artisan?"
              : "Need Help Planning the Financial Budget & Milestones?"}
          </h3>
          <p className="text-xs text-muted leading-relaxed">
            {analysis.paymentMentioned ? (
              <>
                Payment terms were discussed on the call (
                <strong>{formatUsdFromCents(plan.totalCents)}</strong>). Should
                Shuks AI create this PayPal Escrow milestone plan to hold your
                funds and send the offer to {artisan.name}?
              </>
            ) : (
              <>
                Nothing about payment was mentioned during the call. Would you
                like Shuks AI to structure a{" "}
                <strong>{formatUsdFromCents(plan.totalCents)}</strong> financial
                budget and milestone plan (or reply in chat with your preferred
                budget) and send it to {artisan.name}?
              </>
            )}
          </p>

          {userRole === "buyer" ? (
            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={() => onGrantDraftPermission(true)}
                className="w-full rounded-lg bg-ink px-4 py-2.5 text-xs font-bold text-white hover:bg-terracotta transition-colors"
              >
                {analysis.paymentMentioned
                  ? `Create ${formatUsdFromCents(
                      plan.totalCents
                    )} Plan & Send to ${artisan.name}`
                  : `Plan ${formatUsdFromCents(
                      plan.totalCents
                    )} Budget & Send to ${artisan.name}`}
              </button>
              <button
                type="button"
                onClick={() => onGrantDraftPermission(false)}
                className="w-full rounded-lg border border-border bg-surface px-4 py-2 text-xs font-semibold text-ink hover:bg-stone transition-colors"
              >
                Create Plan for Review First (Don&apos;t Send Yet)
              </button>
            </div>
          ) : (
            <p className="text-xs font-medium text-ochre-dark">
              Waiting for the client to approve creating and sending the
              milestone payment plan.
            </p>
          )}
        </div>
      )}

      {showPaymentPlanOffer && (
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="flex items-center justify-between gap-2 border-b border-stone pb-3.5">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-terracotta" />
              <h3 className="text-sm font-bold text-ink">PayPal Escrow Plan</h3>
            </div>
            <span className="font-mono text-base font-extrabold text-ink">
              {formatUsdFromCents(plan.totalCents)}
            </span>
          </div>

          <div className="mt-3 rounded-lg border border-border bg-canvas px-3 py-2 text-xs space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted">Artisan PayPal Sandbox:</span>
              <span className="font-mono text-[11px] font-bold text-terracotta truncate">
                {artisan.paypalEmail}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted">Paid to {artisan.name}:</span>
              <span className="font-mono font-bold text-olive">
                {formatUsdFromCents(releasedCents)} /{" "}
                {formatUsdFromCents(plan.totalCents)}
              </span>
            </div>
          </div>

          {plan.paypalOrderId && (
            <div className="mt-3.5 rounded-lg bg-stone p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted">PayPal Order:</span>
                <span className="font-mono font-bold text-ink">
                  {plan.paypalOrderId}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">In Escrow:</span>
                <span className="font-mono font-bold text-ink">
                  {formatUsdFromCents(remainingEscrowCents)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Released:</span>
                <span className="font-mono font-bold text-olive">
                  {formatUsdFromCents(releasedCents)}
                </span>
              </div>
            </div>
          )}

          <div className="mt-4 space-y-3">
            {plan.milestones.map((ms, index) => {
              const isEditable = !plan.paypalOrderId && userRole === "buyer";
              const canArtisanSubmit =
                userRole === "artisan" && ms.status === "ESCROW_LOCKED";
              const canBuyerRelease =
                userRole === "buyer" &&
                (ms.status === "WORK_SUBMITTED" || ms.status === "DISPUTED");
              const isBuyerWaitingOnArtisan =
                userRole === "buyer" && ms.status === "ESCROW_LOCKED";

              return (
                <div
                  key={ms.id}
                  className="rounded-lg border border-border bg-canvas p-3.5 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded bg-ink px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                          M{index + 1}
                        </span>
                        <h4 className="text-xs font-bold text-ink">
                          {ms.title}
                        </h4>
                        {ms.isAmendment && (
                          <span className="rounded bg-terracotta/15 px-1.5 py-0.5 text-[10px] font-bold text-terracotta">
                            Change Order
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        {ms.description}
                      </p>
                      <span className="mt-1.5 inline-block text-[10px] font-semibold uppercase tracking-wider text-olive">
                        {ms.status === "RELEASED_VIA_PAYPAL"
                          ? `Paid (Batch #${ms.paypalPayoutBatchId})`
                          : ms.status === "DISPUTED"
                          ? "Disputed — AI Ruling Ready"
                          : ms.status === "WORK_SUBMITTED"
                          ? "Proof Verified — Ready for Release"
                          : ms.status === "ESCROW_LOCKED"
                          ? "Locked in Escrow"
                          : "Awaiting Escrow Funding"}
                      </span>
                    </div>

                    <div className="text-right">
                      {isEditable ? (
                        <div className="relative w-24">
                          <label
                            htmlFor={`ms-edit-${ms.id}`}
                            className="sr-only"
                          >
                            Milestone amount USD
                          </label>
                          <DollarSign className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted" />
                          <input
                            id={`ms-edit-${ms.id}`}
                            type="number"
                            min={5}
                            step={5}
                            value={Math.round(ms.amountCents / 100)}
                            onChange={(e) =>
                              onUpdateMilestoneCents(
                                ms.id,
                                Number(e.target.value) * 100
                              )
                            }
                            className="w-full rounded-lg border border-border bg-surface py-1 pl-6 pr-2 font-mono text-xs font-bold text-ink"
                          />
                        </div>
                      ) : (
                        <span className="font-mono text-sm font-bold text-ink">
                          {formatUsdFromCents(ms.amountCents)}
                        </span>
                      )}
                    </div>
                  </div>

                  {ms.proofVerification && (
                    <div
                      className={`rounded-lg border p-3 text-xs ${
                        ms.proofVerification.verified
                          ? "border-olive/40 bg-olive/10 text-ink"
                          : "border-terracotta/40 bg-terracotta/10 text-ink"
                      }`}
                    >
                      <div className="flex items-center justify-between font-bold">
                        <span className="inline-flex items-center gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5 text-olive" />
                          AI Proof-of-Work:{" "}
                          {ms.proofVerification.verified
                            ? "Verified"
                            : "Needs Review"}
                        </span>
                        <span className="font-mono text-[10px]">
                          {Math.round(
                            ms.proofVerification.confidenceScore * 100
                          )}
                          % match
                        </span>
                      </div>
                      <p className="mt-1 text-muted leading-relaxed">
                        {ms.proofVerification.summary}
                      </p>
                      {ms.proofVerification.imageDataUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={ms.proofVerification.imageDataUrl}
                          alt="Submitted proof of work"
                          className="mt-2 h-28 w-full rounded border border-border object-cover"
                        />
                      )}
                    </div>
                  )}

                  {ms.disputeRuling && (
                    <div className="rounded-lg border border-ochre bg-surface p-3 text-xs space-y-2">
                      <div className="flex items-center gap-1.5 font-bold text-ink">
                        <Scale className="h-4 w-4 text-terracotta" />
                        <span>Shuks AI Dispute Arbiter Ruling</span>
                      </div>
                      <p className="text-muted leading-relaxed">
                        {ms.disputeRuling.rulingSummary}
                      </p>
                      <div className="grid grid-cols-2 gap-2 rounded bg-canvas p-2 font-mono text-[11px]">
                        <div>
                          <span className="block text-subtle">To Artisan:</span>
                          <strong className="text-olive">
                            {formatUsdFromCents(
                              ms.disputeRuling.recommendedArtisanPayoutCents
                            )}
                          </strong>
                        </div>
                        <div>
                          <span className="block text-subtle">
                            Buyer Refund:
                          </span>
                          <strong className="text-terracotta">
                            {formatUsdFromCents(
                              ms.disputeRuling.recommendedBuyerRefundCents
                            )}
                          </strong>
                        </div>
                      </div>
                      {userRole === "buyer" &&
                        ms.status !== "RELEASED_VIA_PAYPAL" && (
                          <button
                            type="button"
                            disabled={releasingMilestoneId === ms.id}
                            onClick={() =>
                              handleReleaseMilestonePayout(
                                ms.id,
                                ms.disputeRuling!.recommendedArtisanPayoutCents,
                                `${ms.title} (Arbitrated Split)`
                              )
                            }
                            className="w-full rounded-lg bg-ink px-3 py-2 text-xs font-bold text-white hover:bg-olive transition-colors"
                          >
                            Execute Split Settlement (
                            {formatUsdFromCents(
                              ms.disputeRuling.recommendedArtisanPayoutCents
                            )}{" "}
                            via PayPal)
                          </button>
                        )}
                    </div>
                  )}

                  {canArtisanSubmit && (
                    <div className="space-y-2 pt-1 border-t border-stone">
                      <input
                        type="text"
                        value={proofNotesByMs[ms.id] || ""}
                        onChange={(e) =>
                          setProofNotesByMs((prev) => ({
                            ...prev,
                            [ms.id]: e.target.value,
                          }))
                        }
                        placeholder="Add note about completed work or installed parts..."
                        className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-ink placeholder:text-subtle"
                      />
                      <div className="flex gap-2">
                        <label className="flex-1 inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-xs font-bold text-white hover:bg-terracotta transition-colors">
                          <Camera className="h-3.5 w-3.5" />
                          <span>
                            {verifyingProofId === ms.id
                              ? "AI Vision Inspecting..."
                              : "Upload Proof Photo"}
                          </span>
                          <input
                            type="file"
                            accept="image/*"
                            disabled={verifyingProofId === ms.id}
                            onChange={(e) => handleUploadProofPhoto(ms.id, e)}
                            className="hidden"
                          />
                        </label>
                        {ms.status === "ESCROW_LOCKED" && (
                          <button
                            type="button"
                            onClick={() => onSubmitMilestoneWork(ms.id)}
                            className="inline-flex items-center justify-center gap-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-ink hover:bg-stone transition-colors"
                          >
                            <Send className="h-3 w-3" />
                            <span>Mark Done</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {isBuyerWaitingOnArtisan && (
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-[11px] text-muted">
                      <Lock className="h-3.5 w-3.5 shrink-0 text-ochre-dark" />
                      <span>
                        Waiting for <strong>{artisan.name}</strong> to upload
                        Proof-of-Work or confirm completion before release is
                        unlocked.
                      </span>
                    </div>
                  )}

                  {canBuyerRelease && (
                    <div className="space-y-2 pt-1 border-t border-stone">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={releasingMilestoneId === ms.id}
                          onClick={() =>
                            handleReleaseMilestonePayout(
                              ms.id,
                              ms.amountCents,
                              ms.title
                            )
                          }
                          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-olive px-3 py-2 text-xs font-bold text-white hover:bg-olive-dark disabled:opacity-50 transition-colors"
                        >
                          <Unlock className="h-3.5 w-3.5" />
                          <span>
                            {releasingMilestoneId === ms.id
                              ? "Sending Payout..."
                              : `Release ${formatUsdFromCents(ms.amountCents)}`}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setActiveDisputeMsId((prev) =>
                              prev === ms.id ? null : ms.id
                            )
                          }
                          className="inline-flex items-center gap-1 rounded-lg border border-terracotta/50 bg-surface px-2.5 py-2 text-xs font-semibold text-terracotta hover:bg-terracotta/10 transition-colors"
                        >
                          <ShieldAlert className="h-3.5 w-3.5" />
                          <span>Dispute</span>
                        </button>
                      </div>

                      {activeDisputeMsId === ms.id && (
                        <form
                          onSubmit={(e) => handleSubmitDispute(e, ms.id)}
                          className="space-y-2 rounded-lg border border-terracotta/40 bg-surface p-2.5"
                        >
                          <label
                            htmlFor={`dispute-reason-${ms.id}`}
                            className="block text-[11px] font-bold text-ink"
                          >
                            Describe issue for AI Dispute Arbiter:
                          </label>
                          <textarea
                            id={`dispute-reason-${ms.id}`}
                            rows={2}
                            required
                            value={disputeReason}
                            onChange={(e) => setDisputeReason(e.target.value)}
                            placeholder="e.g., Parts were installed on site, but secondary valve still drips..."
                            className="w-full rounded border border-border bg-canvas p-2 text-xs text-ink"
                          />
                          <button
                            type="submit"
                            disabled={submittingDispute}
                            className="inline-flex w-full items-center justify-center gap-1.5 rounded bg-terracotta px-3 py-1.5 text-xs font-bold text-white hover:bg-terracotta-dark disabled:opacity-50"
                          >
                            <Gavel className="h-3.5 w-3.5" />
                            <span>
                              {submittingDispute
                                ? "AI Arbiter Reviewing Call & Proof..."
                                : "Run AI Dispute Arbitration"}
                            </span>
                          </button>
                        </form>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {(proofError || changeOrderError || disputeError || payoutError) && (
            <div
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-lg border border-terracotta/40 bg-terracotta/10 p-3 text-xs text-ink"
            >
              <AlertCircle className="h-4 w-4 shrink-0 text-terracotta mt-0.5" />
              <span>
                {proofError || changeOrderError || disputeError || payoutError}
              </span>
            </div>
          )}

          <div className="mt-4 border-t border-stone pt-3">
            <button
              type="button"
              onClick={() => setShowChangeOrderForm((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-terracotta hover:underline"
            >
              <PlusCircle className="h-3.5 w-3.5" />
              <span>Add Mid-Job Extra Work (Change Order)</span>
            </button>

            {showChangeOrderForm && (
              <form
                onSubmit={handleCreateChangeOrder}
                className="mt-2.5 space-y-2.5 rounded-lg border border-border bg-canvas p-3"
              >
                <p className="text-[11px] font-semibold text-ink">
                  Shuks AI compares extra work against the original call and
                  adds an Amendment Milestone:
                </p>
                <input
                  type="text"
                  required
                  value={changeDesc}
                  onChange={(e) => setChangeDesc(e.target.value)}
                  placeholder="Describe newly discovered issue (e.g., Corroded wall tee fitting replacement)..."
                  className="w-full rounded border border-border bg-surface px-2.5 py-1.5 text-xs text-ink"
                />
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <DollarSign className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted" />
                    <input
                      type="number"
                      min={5}
                      max={2000}
                      required
                      value={changeAmountUsd}
                      onChange={(e) => setChangeAmountUsd(e.target.value)}
                      className="w-full rounded border border-border bg-surface py-1.5 pl-6 pr-2 font-mono text-xs font-bold text-ink"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submittingChangeOrder}
                    className="rounded bg-ink px-3.5 py-1.5 text-xs font-bold text-white hover:bg-terracotta disabled:opacity-50"
                  >
                    {submittingChangeOrder
                      ? "Evaluating..."
                      : "Add Amendment"}
                  </button>
                </div>
              </form>
            )}
          </div>

          {!plan.paypalOrderId && (
            <div className="mt-5 border-t border-stone pt-4 space-y-3">
              {userRole === "buyer" ? (
                <>
                  <p className="text-xs text-muted">
                    Approve and fund{" "}
                    <strong>{formatUsdFromCents(plan.totalCents)}</strong> with
                    PayPal to hold your funds in escrow until {artisan.name}{" "}
                    completes each milestone.
                  </p>

                  <button
                    type="button"
                    disabled={fundingSandboxOrder}
                    onClick={handleSandboxFundEscrow}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-xs font-bold text-white hover:bg-terracotta disabled:opacity-50 transition-colors"
                  >
                    <Lock className="h-3.5 w-3.5" />
                    <span>
                      {fundingSandboxOrder
                        ? "Capturing PayPal Sandbox Order..."
                        : `Pay & Lock ${formatUsdFromCents(
                            plan.totalCents
                          )} in PayPal Sandbox`}
                    </span>
                  </button>

                  <PayPalScriptProvider
                    options={{
                      clientId: paypalClientId,
                      currency: "USD",
                      intent: "capture",
                    }}
                  >
                    <PayPalButtons
                      style={{
                        layout: "vertical",
                        height: 40,
                        tagline: false,
                      }}
                      createOrder={(_data, actions) => {
                        setCheckoutError("");
                        return actions.order.create({
                          intent: "CAPTURE",
                          purchase_units: [
                            {
                              reference_id: session.jobId,
                              description: `Shuks Escrow: ${session.title} with ${artisan.name}`.slice(
                                0,
                                120
                              ),
                              amount: {
                                currency_code: "USD",
                                value: formatPayPalDecimalFromCents(
                                  plan.totalCents
                                ),
                              },
                            },
                          ],
                        });
                      }}
                      onApprove={async (data, actions) => {
                        setCheckoutError("");
                        const details = await actions.order?.capture();
                        const captureId =
                          details?.purchase_units?.[0]?.payments?.captures?.[0]
                            ?.id ??
                          details?.id ??
                          data.orderID;
                        onEscrowFunded(data.orderID, captureId);
                      }}
                      onError={(err) => {
                        setCheckoutError(
                          err instanceof Error
                            ? err.message
                            : "PayPal Checkout error occurred."
                        );
                      }}
                    />
                  </PayPalScriptProvider>

                  {checkoutError && (
                    <div
                      role="alert"
                      className="flex items-start gap-2 rounded-lg border border-terracotta/40 bg-terracotta/10 p-3 text-xs text-ink"
                    >
                      <AlertCircle className="h-4 w-4 shrink-0 text-terracotta mt-0.5" />
                      <span>{checkoutError}</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-2 rounded-lg bg-canvas p-3 text-xs text-muted">
                  <Lock className="h-4 w-4 text-terracotta shrink-0" />
                  <span>
                    Waiting for client to approve and fund the{" "}
                    <strong>{formatUsdFromCents(plan.totalCents)}</strong>{" "}
                    PayPal Escrow plan.
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
