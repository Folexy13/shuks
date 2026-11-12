"use client";

import React, { use, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Lock,
  Send,
  ShieldCheck,
  Wallet,
  Wrench,
} from "lucide-react";
import { formatUsdFromCents } from "@/lib/money";
import {
  AgentMeetingAnalysis,
  ArtisanProfile,
  ChatMessage,
  JobLifecycleState,
} from "@/lib/types";
import { Navbar } from "@/components/ui/navbar";

interface ServerContractState {
  jobId: string;
  artisan: ArtisanProfile;
  lifecycleState: JobLifecycleState;
  buyerGrantedDraftPermission: boolean;
  artisanAcceptedOffer: boolean;
  analysis: AgentMeetingAnalysis | null;
  messages: ChatMessage[];
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = reader.result;
      if (typeof res === "string" && res.includes(",")) {
        resolve(res.split(",")[1]);
      } else {
        reject(new Error("Could not encode file"));
      }
    };
    reader.onerror = () => reject(new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

export default function ShareableContractPage({
  params,
}: {
  params: Promise<{ artisanId: string }>;
}) {
  const { artisanId } = use(params);
  const [contractState, setContractState] =
    useState<ServerContractState | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const [artisanName, setArtisanName] = useState("");
  const [paypalEmail, setPaypalEmail] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [claimSuccess, setClaimSuccess] = useState(false);

  const [verifyingMsId, setVerifyingMsId] = useState<string | null>(null);
  const [proofNotes, setProofNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    setLoading(true);
    fetch(`/api/jobs/${encodeURIComponent(artisanId)}/state`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load contract details.");
        return res.json();
      })
      .then((data: ServerContractState) => {
        setContractState(data);
        if (data.artisan) {
          setArtisanName(data.artisan.name);
          setPaypalEmail(data.artisan.paypalEmail);
        }
        setLoading(false);
      })
      .catch((err) => {
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to load contract."
        );
        setLoading(false);
      });
  }, [artisanId]);

  const handleClaimContract = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!artisanName.trim() || !paypalEmail.trim() || claiming) return;
    setClaiming(true);
    setErrorMessage("");

    try {
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(artisanId)}/claim-contract`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            artisanName: artisanName.trim(),
            paypalEmail: paypalEmail.trim(),
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Could not claim contract.");
      }
      setContractState(data);
      setClaimSuccess(true);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Contract claim failed."
      );
    } finally {
      setClaiming(false);
    }
  };

  const handleUploadProofPhoto = async (
    milestoneId: string,
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file || verifyingMsId) return;
    setVerifyingMsId(milestoneId);
    setErrorMessage("");

    try {
      const imageBase64 = await fileToBase64(file);
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(artisanId)}/verify-proof`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            milestoneId,
            imageBase64,
            imageMimeType: file.type || "image/jpeg",
            artisanNotes: proofNotes[milestoneId] || "",
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Proof verification failed.");
      }
      setContractState(data);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to verify proof photo."
      );
    } finally {
      setVerifyingMsId(null);
    }
  };

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <Navbar />

      <main className="mx-auto max-w-4xl px-6 py-10 lg:px-8">
        {loading ? (
          <div className="rounded-xl border border-border bg-surface p-12 text-center text-sm text-muted">
            Loading Shuks Escrow Contract...
          </div>
        ) : !contractState || !contractState.analysis ? (
          <div className="rounded-xl border border-border bg-surface p-10 text-center space-y-3">
            <Wrench className="mx-auto h-10 w-10 text-terracotta" />
            <h1 className="text-lg font-bold text-ink">
              Contract Not Generated Yet
            </h1>
            <p className="text-xs text-muted max-w-md mx-auto">
              Once a call recording is analyzed by Shuks AI in the workspace,
              the actionable checklist and PayPal Escrow milestones will be
              available at this shareable link.
            </p>
            <Link
              href={`/workspace/${artisanId}`}
              className="inline-block rounded-lg bg-ink px-4 py-2 text-xs font-bold text-white hover:bg-terracotta"
            >
              Go to Workspace
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="rounded-xl border border-border bg-surface p-6 flex flex-wrap items-center justify-between gap-4">
              <div>
                <span className="rounded bg-stone px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-terracotta">
                  Shuks Shareable Artisan Contract
                </span>
                <h1 className="mt-2 text-2xl font-bold text-ink">
                  {contractState.artisan.trade} Contract —{" "}
                  {contractState.artisan.neighborhood},{" "}
                  {contractState.artisan.city}
                </h1>
                <p className="mt-1 text-xs text-muted flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-terracotta" />
                  <span>
                    Scheduled: {contractState.analysis.scheduledWindow}
                  </span>
                </p>
              </div>

              <div className="text-right">
                <span className="block text-[10px] uppercase tracking-wider text-subtle">
                  Total Escrow Value
                </span>
                <span className="font-mono text-2xl font-extrabold text-ink">
                  {formatUsdFromCents(
                    contractState.analysis.proposedPaymentPlan.totalCents
                  )}
                </span>
                <span className="mt-1 block text-xs font-semibold text-olive">
                  {contractState.analysis.proposedPaymentPlan.paypalOrderId
                    ? `Escrow Funded (Order #${contractState.analysis.proposedPaymentPlan.paypalOrderId})`
                    : "Awaiting Buyer Escrow Funding"}
                </span>
              </div>
            </div>

            {errorMessage && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-lg border border-terracotta/40 bg-terracotta/10 p-4 text-xs text-ink"
              >
                <AlertCircle className="h-4 w-4 text-terracotta shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="grid gap-6 md:grid-cols-12">
              <div className="md:col-span-5 space-y-6">
                <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
                  <div className="flex items-center gap-2 border-b border-stone pb-3">
                    <ClipboardCheck className="h-4 w-4 text-terracotta" />
                    <h2 className="text-sm font-bold text-ink">
                      Your Actionable Checklist
                    </h2>
                  </div>
                  <ul className="space-y-2 text-xs text-muted">
                    {contractState.analysis.artisanActionItems.map(
                      (item, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-terracotta mt-0.5" />
                          <span>{item}</span>
                        </li>
                      )
                    )}
                  </ul>
                </div>

                <form
                  onSubmit={handleClaimContract}
                  className="rounded-xl border border-border bg-surface p-5 space-y-4"
                >
                  <div className="flex items-center gap-2 border-b border-stone pb-3">
                    <Wallet className="h-4 w-4 text-olive" />
                    <h2 className="text-sm font-bold text-ink">
                      Connect Your PayPal for Payouts
                    </h2>
                  </div>

                  <div>
                    <label
                      htmlFor="claim-name"
                      className="block text-xs font-bold text-ink mb-1"
                    >
                      Your Name / Business *
                    </label>
                    <input
                      id="claim-name"
                      type="text"
                      required
                      value={artisanName}
                      onChange={(e) => setArtisanName(e.target.value)}
                      className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-xs text-ink"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="claim-paypal"
                      className="block text-xs font-bold text-ink mb-1"
                    >
                      PayPal Payout Receiver Email *
                    </label>
                    <input
                      id="claim-paypal"
                      type="email"
                      required
                      value={paypalEmail}
                      onChange={(e) => setPaypalEmail(e.target.value)}
                      className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-xs text-ink"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={claiming}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-ink px-4 py-2.5 text-xs font-bold text-white hover:bg-terracotta disabled:opacity-50 transition-colors"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    <span>
                      {claiming
                        ? "Saving..."
                        : contractState.artisanAcceptedOffer || claimSuccess
                        ? "Contract Accepted & PayPal Connected"
                        : "Accept Contract & Connect PayPal"}
                    </span>
                  </button>
                </form>
              </div>

              <div className="md:col-span-7">
                <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-stone pb-3">
                    <h2 className="text-sm font-bold text-ink">
                      Escrow Milestones &amp; Proof-of-Work Upload
                    </h2>
                    <span className="text-xs text-muted">
                      {
                        contractState.analysis.proposedPaymentPlan.milestones
                          .length
                      }{" "}
                      Milestones
                    </span>
                  </div>

                  <div className="space-y-3.5">
                    {contractState.analysis.proposedPaymentPlan.milestones.map(
                      (ms, idx) => (
                        <div
                          key={ms.id}
                          className="rounded-lg border border-border bg-canvas p-4 space-y-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="rounded bg-ink px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                                  M{idx + 1}
                                </span>
                                <h3 className="text-xs font-bold text-ink">
                                  {ms.title}
                                </h3>
                              </div>
                              <p className="mt-1 text-xs text-muted">
                                {ms.description}
                              </p>
                            </div>
                            <span className="font-mono text-sm font-extrabold text-ink">
                              {formatUsdFromCents(ms.amountCents)}
                            </span>
                          </div>

                          {ms.proofVerification && (
                            <div className="rounded border border-olive/40 bg-olive/10 p-2.5 text-xs">
                              <strong className="text-olive">
                                AI Proof Check:{" "}
                                {ms.proofVerification.verified
                                  ? "Verified"
                                  : "Flagged"}{" "}
                                (
                                {Math.round(
                                  ms.proofVerification.confidenceScore * 100
                                )}
                                %)
                              </strong>
                              <p className="mt-1 text-ink">
                                {ms.proofVerification.summary}
                              </p>
                            </div>
                          )}

                          {ms.status !== "RELEASED_VIA_PAYPAL" && (
                            <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-stone">
                              <input
                                type="text"
                                value={proofNotes[ms.id] || ""}
                                onChange={(e) =>
                                  setProofNotes((prev) => ({
                                    ...prev,
                                    [ms.id]: e.target.value,
                                  }))
                                }
                                placeholder="Add completion note..."
                                className="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-ink"
                              />
                              <label className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-xs font-bold text-white hover:bg-terracotta transition-colors">
                                <Camera className="h-3.5 w-3.5" />
                                <span>
                                  {verifyingMsId === ms.id
                                    ? "Inspecting Photo..."
                                    : "Upload Proof Photo"}
                                </span>
                                <input
                                  type="file"
                                  accept="image/*"
                                  disabled={verifyingMsId === ms.id}
                                  onChange={(e) =>
                                    handleUploadProofPhoto(ms.id, e)
                                  }
                                  className="hidden"
                                />
                              </label>
                            </div>
                          )}
                        </div>
                      )
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
