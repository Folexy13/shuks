"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  DollarSign,
  LocateFixed,
  MapPin,
  User,
  Wallet,
  Wrench,
} from "lucide-react";
import { useShuksStore } from "@/lib/store";
import { TradeCategory } from "@/lib/types";
import { Navbar } from "@/components/ui/navbar";

const TRADES: TradeCategory[] = [
  "Plumbing",
  "Electrical",
  "Carpentry",
  "HVAC & Cooling",
  "Locksmith",
  "Appliance Repair",
];

export default function OnboardingPage() {
  const router = useRouter();
  const {
    buyerCoordinates,
    buyerAddressLabel,
    setCurrentUser,
    registerClientAccount,
    registerArtisanAccount,
  } = useShuksStore();

  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [role, setRole] = useState<"buyer" | "artisan">("buyer");
  const [redirectTo, setRedirectTo] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const roleParam = params.get("role");
      const modeParam = params.get("mode");
      const nextParam = params.get("redirect");
      if (roleParam === "artisan" || roleParam === "buyer") {
        setRole(roleParam);
      }
      if (modeParam === "signin") {
        setMode("signin");
      }
      if (nextParam) {
        setRedirectTo(nextParam);
      }
    }
  }, []);

  const [loginEmail, setLoginEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [paypalEmail, setPaypalEmail] = useState("");
  const [locationLabel, setLocationLabel] = useState(buyerAddressLabel);
  const [coords, setCoords] = useState(buyerCoordinates);

  const [businessName, setBusinessName] = useState("");
  const [trade, setTrade] = useState<TradeCategory>("Plumbing");
  const [hourlyRateUsd, setHourlyRateUsd] = useState("65");
  const [calloutFeeUsd, setCalloutFeeUsd] = useState("20");
  const [responseMinutes, setResponseMinutes] = useState("10");
  const [bio, setBio] = useState("");
  const [skillsInput, setSkillsInput] = useState(
    "Pipe Repair, Leak Detection, Valve Replacement"
  );

  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleUseGpsForOnboarding = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setErrorMessage("Geolocation is not supported by your browser.");
      return;
    }

    setLocating(true);
    setErrorMessage("");

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const nextCoords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        setCoords(nextCoords);

        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${nextCoords.lat}&lon=${nextCoords.lng}`,
            {
              signal: AbortSignal.timeout(6000),
              headers: { Accept: "application/json" },
            }
          );
          if (res.ok) {
            const data = await res.json();
            const addr = data.address;
            const area =
              addr?.suburb ||
              addr?.neighbourhood ||
              addr?.city_district ||
              addr?.town ||
              addr?.city;
            const region = addr?.city || addr?.state || addr?.country;
            if (area && region && area !== region) {
              setLocationLabel(`${area}, ${region}`);
            } else if (area || region) {
              setLocationLabel(area || region);
            }
          }
        } catch {
          setLocationLabel(
            `${nextCoords.lat.toFixed(3)}, ${nextCoords.lng.toFixed(3)}`
          );
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocating(false);
        setErrorMessage(
          "Could not access GPS. Please type your neighborhood or city."
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
  }, []);

  const resolveTypedAddressCoords = async (label: string) => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
          label
        )}`,
        {
          signal: AbortSignal.timeout(6000),
          headers: { Accept: "application/json" },
        }
      );
      if (res.ok) {
        const results: Array<{ lat: string; lon: string }> = await res.json();
        if (results.length > 0) {
          return {
            lat: Number(results[0].lat),
            lng: Number(results[0].lon),
          };
        }
      }
    } catch {
      return coords;
    }
    return coords;
  };

  const executeEmailSignIn = async (targetEmail: string) => {
    const trimmed = targetEmail.trim();
    if (submitting || !trimmed) return;
    setLoginEmail(trimmed);
    setSubmitting(true);
    setErrorMessage("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Sign in failed.");
      }
      setCurrentUser(data.account);
      if (redirectTo) {
        router.push(redirectTo);
      } else if (data.account.linkedArtisanId) {
        router.push(`/workspace/${data.account.linkedArtisanId}`);
      } else {
        router.push("/#directory");
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not sign in."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignInSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await executeEmailSignIn(loginEmail);
  };

  const handleSignUpSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setErrorMessage("");

    if (!fullName.trim() || !email.trim() || !paypalEmail.trim()) {
      setErrorMessage(
        "Please enter your name, email address, and PayPal email."
      );
      return;
    }

    if (role === "artisan" && (!businessName.trim() || !bio.trim())) {
      setErrorMessage(
        "Please enter your workshop name and a short service description."
      );
      return;
    }

    setSubmitting(true);

    try {
      const finalLocationLabel =
        locationLabel.trim() || "South Congress, Austin, TX";
      const resolvedCoords = await resolveTypedAddressCoords(
        finalLocationLabel
      );

      if (role === "buyer") {
        const clientPayload = {
          role: "buyer" as const,
          name: fullName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          paypalEmail: paypalEmail.trim(),
          locationLabel: finalLocationLabel,
          coordinates: resolvedCoords,
        };
        const response = await fetch("/api/onboarding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(clientPayload),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Failed to save client account.");
        }
        registerClientAccount(data.account);
        router.push(redirectTo || "/#directory");
        return;
      }

      const hourlyRateCents = Math.max(
        1000,
        Math.round(Number(hourlyRateUsd || 65) * 100)
      );
      const baseCalloutCents = Math.max(
        500,
        Math.round(Number(calloutFeeUsd || 20) * 100)
      );

      const parsedSkills = skillsInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const artisanPayload = {
        role: "artisan" as const,
        name: fullName.trim(),
        businessName: businessName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        paypalEmail: paypalEmail.trim(),
        trade,
        hourlyRateCents,
        baseCalloutCents,
        responseMinutes: Math.max(3, Number(responseMinutes || 10)),
        bio: bio.trim(),
        skills: parsedSkills,
        locationLabel: finalLocationLabel,
        coordinates: resolvedCoords,
      };

      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(artisanPayload),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to register artisan profile.");
      }

      registerArtisanAccount(data.account, data.artisan);
      router.push(redirectTo || `/workspace/${data.artisan.id}`);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Registration failed."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <Navbar />

      <main className="mx-auto max-w-3xl px-6 py-12 lg:px-8">
        <div className="flex items-center justify-between border-b border-border pb-6">
          <div>
            <h1 className="text-2xl font-bold text-ink sm:text-3xl">
              {mode === "signin"
                ? "Sign in to Shuks"
                : "Create your Shuks account"}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {redirectTo
                ? "Sign in or register to message and call this artisan."
                : "Connect your neighborhood location and PayPal account."}
            </p>
          </div>

          <div className="inline-flex rounded-lg border border-border bg-stone p-1">
            <button
              type="button"
              onClick={() => {
                setMode("signup");
                setErrorMessage("");
              }}
              className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                mode === "signup"
                  ? "bg-surface text-ink shadow-sm"
                  : "text-muted hover:text-ink"
              }`}
            >
              Register
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("signin");
                setErrorMessage("");
              }}
              className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                mode === "signin"
                  ? "bg-surface text-ink shadow-sm"
                  : "text-muted hover:text-ink"
              }`}
            >
              Sign In
            </button>
          </div>
        </div>

        {mode === "signin" ? (
          <form
            onSubmit={handleSignInSubmit}
            className="mt-8 rounded-xl border border-border bg-surface p-6 sm:p-8 space-y-5"
          >
            <div>
              <label
                htmlFor="signin-email"
                className="block text-xs font-bold uppercase tracking-wider text-ink mb-2"
              >
                Registered Email Address
              </label>
              <input
                id="signin-email"
                type="email"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="aluko@preplink.ai or folajimi@paypal.io"
                className="w-full rounded-lg border border-border bg-canvas px-4 py-3 text-sm text-ink placeholder:text-subtle focus:border-ink focus:outline-none"
              />
            </div>

            <div className="rounded-lg border border-stone bg-canvas p-4 space-y-2.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted">
                Quick Sign-In Accounts (1-Click)
              </p>
              <div className="grid gap-2.5 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void executeEmailSignIn("aluko@preplink.ai")}
                  className="flex items-center gap-3 rounded-lg border border-terracotta/40 bg-surface p-3 text-left hover:border-terracotta transition-colors"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-terracotta text-xs font-bold text-white">
                    MR
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-ink truncate">
                      Marcus Rivera (Artisan)
                    </div>
                    <div className="font-mono text-[11px] text-terracotta truncate">
                      aluko@preplink.ai
                    </div>
                    <div className="text-[10px] text-muted truncate">
                      PayPal: aluko@preplink.ai
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void executeEmailSignIn("folajimi@paypal.io")}
                  className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3 text-left hover:border-ink transition-colors"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink text-xs font-bold text-white">
                    AF
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-ink truncate">
                      Aluko Folajimi (Buyer)
                    </div>
                    <div className="font-mono text-[11px] text-olive truncate">
                      folajimi@paypal.io
                    </div>
                    <div className="text-[10px] text-muted truncate">
                      Client / Homeowner Account
                    </div>
                  </div>
                </button>
              </div>
            </div>

            {errorMessage && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-lg border border-terracotta/40 bg-terracotta/10 px-4 py-3 text-xs text-ink"
              >
                <AlertCircle className="h-4 w-4 text-terracotta shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-6 py-3 text-sm font-bold text-white hover:bg-terracotta disabled:opacity-50 transition-colors"
            >
              <span>{submitting ? "Signing in..." : "Sign In"}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        ) : (
          <>
            <div className="mt-8 grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setRole("buyer")}
                className={`flex items-center gap-3 rounded-xl border p-4 text-left transition-colors ${
                  role === "buyer"
                    ? "border-ink bg-surface shadow-sm"
                    : "border-border bg-stone/60 text-muted hover:bg-surface"
                }`}
              >
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                    role === "buyer"
                      ? "bg-ink text-white"
                      : "bg-border text-ink"
                  }`}
                >
                  <User className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-bold text-ink">
                    I Need an Artisan
                  </div>
                  <div className="text-xs text-muted">Client / Homeowner</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setRole("artisan")}
                className={`flex items-center gap-3 rounded-xl border p-4 text-left transition-colors ${
                  role === "artisan"
                    ? "border-terracotta bg-surface shadow-sm"
                    : "border-border bg-stone/60 text-muted hover:bg-surface"
                }`}
              >
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                    role === "artisan"
                      ? "bg-terracotta text-white"
                      : "bg-border text-ink"
                  }`}
                >
                  <Wrench className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-bold text-ink">
                    I Am an Artisan
                  </div>
                  <div className="text-xs text-muted">Local Tradesperson</div>
                </div>
              </button>
            </div>

            <form
              onSubmit={handleSignUpSubmit}
              className="mt-6 rounded-xl border border-border bg-surface p-6 sm:p-8 space-y-6"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="onboard-name"
                    className="block text-xs font-bold uppercase tracking-wider text-ink mb-1.5"
                  >
                    Full Name *
                  </label>
                  <input
                    id="onboard-name"
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Jordan Taylor"
                    className="w-full rounded-lg border border-border bg-canvas px-3.5 py-2.5 text-sm text-ink focus:border-ink focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="onboard-email"
                    className="block text-xs font-bold uppercase tracking-wider text-ink mb-1.5"
                  >
                    Email Address *
                  </label>
                  <input
                    id="onboard-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full rounded-lg border border-border bg-canvas px-3.5 py-2.5 text-sm text-ink focus:border-ink focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="onboard-phone"
                    className="block text-xs font-bold uppercase tracking-wider text-ink mb-1.5"
                  >
                    Phone Number
                  </label>
                  <input
                    id="onboard-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1 (512) 555-0140"
                    className="w-full rounded-lg border border-border bg-canvas px-3.5 py-2.5 text-sm text-ink focus:border-ink focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="onboard-location"
                    className="block text-xs font-bold uppercase tracking-wider text-ink mb-1.5"
                  >
                    Neighborhood / City *
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <MapPin className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-terracotta" />
                      <input
                        id="onboard-location"
                        type="text"
                        required
                        value={locationLabel}
                        onChange={(e) => setLocationLabel(e.target.value)}
                        placeholder="South Congress, Austin, TX"
                        className="w-full rounded-lg border border-border bg-canvas py-2.5 pl-9 pr-3 text-sm text-ink focus:border-ink focus:outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleUseGpsForOnboarding}
                      disabled={locating}
                      className="inline-flex items-center gap-1 rounded-lg border border-border bg-stone px-3 py-2.5 text-xs font-semibold text-ink hover:bg-border transition-colors"
                    >
                      <LocateFixed className="h-3.5 w-3.5 text-terracotta" />
                      <span>{locating ? "..." : "GPS"}</span>
                    </button>
                  </div>
                </div>
              </div>

              {role === "artisan" && (
                <div className="border-t border-stone pt-6 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="onboard-business"
                      className="block text-xs font-bold uppercase tracking-wider text-ink mb-1.5"
                    >
                      Workshop / Business Name *
                    </label>
                    <input
                      id="onboard-business"
                      type="text"
                      required
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      placeholder="Apex Plumbing Works"
                      className="w-full rounded-lg border border-border bg-canvas px-3.5 py-2.5 text-sm text-ink focus:border-ink focus:outline-none"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="onboard-trade"
                      className="block text-xs font-bold uppercase tracking-wider text-ink mb-1.5"
                    >
                      Trade Category *
                    </label>
                    <select
                      id="onboard-trade"
                      value={trade}
                      onChange={(e) =>
                        setTrade(e.target.value as TradeCategory)
                      }
                      className="w-full rounded-lg border border-border bg-canvas px-3.5 py-2.5 text-sm text-ink focus:border-ink focus:outline-none"
                    >
                      {TRADES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="onboard-hourly"
                      className="block text-xs font-bold uppercase tracking-wider text-ink mb-1.5"
                    >
                      Hourly Rate (USD) *
                    </label>
                    <div className="relative">
                      <DollarSign className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted" />
                      <input
                        id="onboard-hourly"
                        type="number"
                        min={10}
                        max={500}
                        required
                        value={hourlyRateUsd}
                        onChange={(e) => setHourlyRateUsd(e.target.value)}
                        className="w-full rounded-lg border border-border bg-canvas py-2.5 pl-9 pr-3 text-sm text-ink focus:border-ink focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="onboard-callout"
                        className="block text-xs font-bold uppercase tracking-wider text-ink mb-1.5"
                      >
                        Callout (USD)
                      </label>
                      <input
                        id="onboard-callout"
                        type="number"
                        min={5}
                        max={200}
                        value={calloutFeeUsd}
                        onChange={(e) => setCalloutFeeUsd(e.target.value)}
                        className="w-full rounded-lg border border-border bg-canvas px-3 py-2.5 text-sm text-ink focus:border-ink focus:outline-none"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="onboard-response"
                        className="block text-xs font-bold uppercase tracking-wider text-ink mb-1.5"
                      >
                        Reply (Mins)
                      </label>
                      <input
                        id="onboard-response"
                        type="number"
                        min={2}
                        max={60}
                        value={responseMinutes}
                        onChange={(e) => setResponseMinutes(e.target.value)}
                        className="w-full rounded-lg border border-border bg-canvas px-3 py-2.5 text-sm text-ink focus:border-ink focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="sm:col-span-2">
                    <label
                      htmlFor="onboard-skills"
                      className="block text-xs font-bold uppercase tracking-wider text-ink mb-1.5"
                    >
                      Specialties (Comma-separated)
                    </label>
                    <input
                      id="onboard-skills"
                      type="text"
                      value={skillsInput}
                      onChange={(e) => setSkillsInput(e.target.value)}
                      className="w-full rounded-lg border border-border bg-canvas px-3.5 py-2.5 text-sm text-ink focus:border-ink focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label
                      htmlFor="onboard-bio"
                      className="block text-xs font-bold uppercase tracking-wider text-ink mb-1.5"
                    >
                      Service Description *
                    </label>
                    <textarea
                      id="onboard-bio"
                      rows={3}
                      required
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      placeholder="Describe the repairs and installations you handle..."
                      className="w-full rounded-lg border border-border bg-canvas p-3.5 text-sm text-ink focus:border-ink focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <div className="border-t border-stone pt-6">
                <div className="rounded-lg border border-border bg-canvas p-4">
                  <div className="flex items-start gap-3">
                    <Wallet className="h-5 w-5 text-terracotta shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <label
                        htmlFor="onboard-paypal"
                        className="block text-xs font-bold uppercase tracking-wider text-ink"
                      >
                        {role === "buyer"
                          ? "PayPal Account Email *"
                          : "PayPal Payouts Receiver Email *"}
                      </label>
                      <input
                        id="onboard-paypal"
                        type="email"
                        required
                        value={paypalEmail}
                        onChange={(e) => setPaypalEmail(e.target.value)}
                        placeholder={
                          role === "buyer"
                            ? "sb-buyer@personal.example.com"
                            : "sb-artisan@business.example.com"
                        }
                        className="mt-2 w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm text-ink focus:border-ink focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {errorMessage && (
                <div
                  role="alert"
                  className="flex items-center gap-2 rounded-lg border border-terracotta/40 bg-terracotta/10 px-4 py-3 text-xs text-ink"
                >
                  <AlertCircle className="h-4 w-4 text-terracotta shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-6 py-3.5 text-sm font-bold text-white hover:bg-terracotta disabled:opacity-50 transition-colors"
              >
                <span>
                  {submitting
                    ? "Creating Account..."
                    : role === "buyer"
                    ? "Complete Client Registration"
                    : "Register Artisan Profile"}
                </span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
