"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  LocateFixed,
  MapPin,
  PhoneCall,
  Search,
  ShieldCheck,
  Star,
  Video,
  Wrench,
} from "lucide-react";
import { calculateDistanceKm, formatUsdFromCents } from "@/lib/money";
import { useShuksStore } from "@/lib/store";
import { ArtisanProfile, TradeCategory } from "@/lib/types";
import { Navbar } from "@/components/ui/navbar";
import { ArtisanMap } from "@/components/map/artisan-map";

const TRADE_FILTERS: (TradeCategory | "All")[] = [
  "All",
  "Plumbing",
  "Electrical",
  "Carpentry",
  "HVAC & Cooling",
  "Locksmith",
  "Appliance Repair",
];

export default function HomePage() {
  const router = useRouter();
  const {
    currentUser,
    artisansCatalog,
    buyerCoordinates,
    buyerAddressLabel,
    selectedTrade,
    maxRadiusKm,
    searchQuery,
    setArtisansCatalog,
    setBuyerLocation,
    setSelectedTrade,
    setMaxRadiusKm,
    setSearchQuery,
  } = useShuksStore();

  const [selectedArtisanId, setSelectedArtisanId] = useState<string | null>(
    null
  );
  const [locationInput, setLocationInput] = useState("");
  const [geocodeState, setGeocodeState] = useState<
    "idle" | "loading" | "error" | "success"
  >("idle");
  const [geocodeErrorMessage, setGeocodeErrorMessage] = useState("");

  const [catalogState, setCatalogState] = useState<
    "loading" | "error" | "success"
  >("loading");
  const [catalogError, setCatalogError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setCatalogState("loading");
    fetch("/api/onboarding", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load artisan directory (${res.status})`);
        }
        return res.json();
      })
      .then((data: { artisans?: ArtisanProfile[] }) => {
        const list = data.artisans ?? [];
        setArtisansCatalog(list);
        if (list.length > 0) {
          setSelectedArtisanId((prev) => prev ?? list[0].id);
        }
        setCatalogState("success");
      })
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setCatalogState("error");
        setCatalogError(
          err instanceof Error
            ? err.message
            : "Could not load artisan directory from server."
        );
      });

    return () => controller.abort();
  }, [setArtisansCatalog]);

  const handleGeocodeLookup = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = locationInput.trim();
    if (!trimmed || geocodeState === "loading") return;

    setGeocodeState("loading");
    setGeocodeErrorMessage("");

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
        trimmed
      )}`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error("Could not look up that location right now.");
      }

      const results: Array<{ lat: string; lon: string; display_name: string }> =
        await response.json();

      if (!results.length) {
        setGeocodeState("error");
        setGeocodeErrorMessage(
          `No location found for "${trimmed}". Try a neighborhood or city name.`
        );
        return;
      }

      const first = results[0];
      setBuyerLocation(
        { lat: Number(first.lat), lng: Number(first.lon) },
        first.display_name.split(",").slice(0, 2).join(",")
      );
      setGeocodeState("success");
      document
        .getElementById("directory")
        ?.scrollIntoView({ behavior: "smooth" });
    } catch (error) {
      setGeocodeState("error");
      setGeocodeErrorMessage(
        error instanceof Error ? error.message : "Location lookup failed."
      );
    }
  };

  const resolveLocationNameFromCoords = useCallback(
    async (lat: number, lng: number) => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
          {
            signal: AbortSignal.timeout(6000),
            headers: { Accept: "application/json" },
          }
        );
        if (!res.ok) throw new Error("Reverse geocode failed");
        const data: {
          address?: {
            suburb?: string;
            neighbourhood?: string;
            city_district?: string;
            city?: string;
            town?: string;
            state?: string;
            country?: string;
          };
          display_name?: string;
        } = await res.json();

        const addr = data.address;
        const area =
          addr?.suburb ||
          addr?.neighbourhood ||
          addr?.city_district ||
          addr?.town ||
          addr?.city;
        const region = addr?.city || addr?.state || addr?.country;
        if (area && region && area !== region) {
          return `${area}, ${region}`;
        }
        if (area || region) {
          return area || region || "Your Area";
        }
        if (data.display_name) {
          return data.display_name.split(",").slice(0, 2).join(", ");
        }
      } catch {
        return `Location (${lat.toFixed(3)}, ${lng.toFixed(3)})`;
      }
      return `Location (${lat.toFixed(3)}, ${lng.toFixed(3)})`;
    },
    []
  );

  const handlePickMapCoordinates = useCallback(
    async (coords: { lat: number; lng: number }) => {
      setBuyerLocation(coords, "Updating location...");
      const label = await resolveLocationNameFromCoords(coords.lat, coords.lng);
      setBuyerLocation(coords, label);
    },
    [resolveLocationNameFromCoords, setBuyerLocation]
  );

  const handleUseBrowserGps = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setGeocodeState("error");
      setGeocodeErrorMessage("Geolocation is not supported on this browser.");
      return;
    }

    setGeocodeState("loading");
    setGeocodeErrorMessage("");

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const coords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        const label = await resolveLocationNameFromCoords(
          coords.lat,
          coords.lng
        );
        setBuyerLocation(coords, label);
        setGeocodeState("success");
      },
      () => {
        setGeocodeState("error");
        setGeocodeErrorMessage(
          "Location permission declined. Type your neighborhood or city above."
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
  }, [resolveLocationNameFromCoords, setBuyerLocation]);

  const filteredArtisans = useMemo(() => {
    return artisansCatalog
      .map((artisan) => {
        const distanceKm = calculateDistanceKm(
          buyerCoordinates.lat,
          buyerCoordinates.lng,
          artisan.coordinates.lat,
          artisan.coordinates.lng
        );
        return { artisan, distanceKm };
      })
      .filter(({ artisan, distanceKm }) => {
        const matchesTrade =
          selectedTrade === "All" || artisan.trade === selectedTrade;
        const matchesRadius = distanceKm <= maxRadiusKm;
        const q = searchQuery.trim().toLowerCase();
        const matchesQuery =
          !q ||
          artisan.name.toLowerCase().includes(q) ||
          artisan.businessName.toLowerCase().includes(q) ||
          artisan.trade.toLowerCase().includes(q) ||
          artisan.neighborhood.toLowerCase().includes(q) ||
          artisan.city.toLowerCase().includes(q) ||
          artisan.skills.some((s) => s.toLowerCase().includes(q));

        return matchesTrade && matchesRadius && matchesQuery;
      });
  }, [
    artisansCatalog,
    buyerCoordinates,
    selectedTrade,
    maxRadiusKm,
    searchQuery,
  ]);

  const handleOpenArtisanWorkspace = (artisanId: string) => {
    if (!currentUser) {
      router.push(
        `/onboarding?role=buyer&redirect=/workspace/${encodeURIComponent(
          artisanId
        )}`
      );
      return;
    }
    router.push(`/workspace/${artisanId}`);
  };

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <Navbar />

      <main>
        <section className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-6xl flex-col justify-center px-6 py-16 lg:px-10">
          <div className="max-w-3xl">
            <span className="inline-block rounded bg-stone px-3 py-1 text-xs font-bold uppercase tracking-wider text-terracotta">
              Local Artisan Marketplace &amp; PayPal Escrow
            </span>

            <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-ink sm:text-6xl leading-[1.08]">
              Book a neighborhood tradesperson today.{" "}
              <span className="text-terracotta">
                Finalize on a call, pay through escrow.
              </span>
            </h1>

            <p className="mt-5 max-w-2xl text-base text-muted sm:text-lg leading-relaxed">
              Find plumbers, electricians, carpenters, and HVAC technicians near
              you. Agree on the scope during a live web call while our mediator
              records the action checklist and sets up milestone payments in
              PayPal Escrow.
            </p>

            <form
              onSubmit={handleGeocodeLookup}
              className="mt-8 flex flex-col gap-2 rounded-xl border border-border bg-surface p-2.5 shadow-sm sm:flex-row sm:items-center"
            >
              <div className="relative flex-1">
                <label htmlFor="hero-location-input" className="sr-only">
                  Search neighborhood or city
                </label>
                <MapPin className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-terracotta" />
                <input
                  id="hero-location-input"
                  type="text"
                  value={locationInput}
                  onChange={(e) => setLocationInput(e.target.value)}
                  placeholder={`Search street or neighborhood (Active: ${buyerAddressLabel})`}
                  className="w-full rounded-lg bg-transparent py-3 pl-11 pr-4 text-sm text-ink placeholder:text-subtle focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleUseBrowserGps}
                  disabled={geocodeState === "loading"}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-canvas px-4 py-3 text-xs font-semibold text-ink hover:bg-stone disabled:opacity-50 transition-colors"
                >
                  <LocateFixed className="h-4 w-4 text-terracotta" />
                  <span>Use GPS</span>
                </button>

                <button
                  type="submit"
                  disabled={geocodeState === "loading"}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-ink px-6 py-3 text-xs font-bold text-white hover:bg-terracotta disabled:opacity-50 transition-colors"
                >
                  <span>
                    {geocodeState === "loading"
                      ? "Locating..."
                      : "Search Area"}
                  </span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </form>

            {geocodeState === "error" && (
              <div
                role="alert"
                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-terracotta/40 bg-terracotta/10 px-3.5 py-2 text-xs text-ink"
              >
                <AlertCircle className="h-4 w-4 text-terracotta" />
                <span>{geocodeErrorMessage}</span>
              </div>
            )}

            {geocodeState === "success" && (
              <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-olive/40 bg-olive/10 px-3.5 py-2 text-xs text-ink">
                <CheckCircle2 className="h-4 w-4 text-olive" />
                <span>Map centered on {buyerAddressLabel}</span>
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-2">
              {TRADE_FILTERS.filter((t) => t !== "All").map((trade) => (
                <button
                  key={trade}
                  type="button"
                  onClick={() => {
                    setSelectedTrade(trade);
                    document
                      .getElementById("directory")
                      ?.scrollIntoView({ behavior: "smooth" });
                  }}
                  className="rounded-lg border border-border bg-surface px-3.5 py-2 text-xs font-semibold text-muted hover:border-ink hover:text-ink transition-colors"
                >
                  {trade}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section
          id="how-it-works"
          className="border-y border-border bg-stone py-16"
        >
          <div className="mx-auto max-w-7xl px-6 lg:px-10">
            <div className="grid gap-8 md:grid-cols-3">
              <div className="rounded-xl border border-border bg-surface p-7">
                <MapPin className="h-5 w-5 text-terracotta" />
                <h2 className="mt-4 text-lg font-bold text-ink">
                  1. Find a neighborhood pro
                </h2>
                <p className="mt-2 text-sm text-muted leading-relaxed">
                  Browse verified tradespeople on the OpenStreetMap directory
                  with transparent hourly rates and callout fees.
                </p>
              </div>

              <div className="rounded-xl border border-border bg-surface p-7">
                <Video className="h-5 w-5 text-olive" />
                <h2 className="mt-4 text-lg font-bold text-ink">
                  2. Agree on scope via web call
                </h2>
                <p className="mt-2 text-sm text-muted leading-relaxed">
                  Get on a live voice or video call. The Shuks Mediator records
                  what was discussed, creates checklists for both sides, and
                  prepares the milestone payment plan.
                </p>
              </div>

              <div className="rounded-xl border border-border bg-surface p-7">
                <ShieldCheck className="h-5 w-5 text-ochre-dark" />
                <h2 className="mt-4 text-lg font-bold text-ink">
                  3. Pay safely with PayPal Escrow
                </h2>
                <p className="mt-2 text-sm text-muted leading-relaxed">
                  Approve the payment plan through PayPal Checkout. Funds stay
                  in escrow and are disbursed to the artisan only when you
                  confirm each milestone is complete.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section
          id="directory"
          className="mx-auto max-w-7xl px-6 py-20 lg:px-10"
        >
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-olive">
                Neighborhood Directory
              </span>
              <h2 className="mt-1 text-2xl font-bold text-ink sm:text-3xl">
                Artisans near {buyerAddressLabel}
              </h2>
              {catalogState === "loading" && (
                <p className="mt-1 text-xs text-muted">
                  Loading artisan directory...
                </p>
              )}
              {catalogState === "error" && (
                <p className="mt-1 text-xs text-terracotta">{catalogError}</p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-2">
                <label
                  htmlFor="radius-slider"
                  className="text-xs font-semibold text-ink whitespace-nowrap"
                >
                  Radius: {maxRadiusKm} km
                </label>
                <input
                  id="radius-slider"
                  type="range"
                  min={2}
                  max={500}
                  step={2}
                  value={maxRadiusKm}
                  onChange={(e) => setMaxRadiusKm(Number(e.target.value))}
                  className="w-28 accent-terracotta"
                />
              </div>

              <div className="relative w-full sm:w-64">
                <label htmlFor="artisan-search-input" className="sr-only">
                  Filter by skill or name
                </label>
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-subtle" />
                <input
                  id="artisan-search-input"
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter by trade, neighborhood..."
                  className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-xs text-ink placeholder:text-subtle focus:border-ink focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            {TRADE_FILTERS.map((trade) => {
              const active = selectedTrade === trade;
              return (
                <button
                  key={trade}
                  type="button"
                  onClick={() => setSelectedTrade(trade)}
                  className={`rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
                    active
                      ? "bg-ink text-white"
                      : "border border-border bg-surface text-muted hover:text-ink"
                  }`}
                >
                  {trade}
                </button>
              );
            })}
          </div>

          <div className="mt-8 grid gap-8 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <div className="sticky top-28 space-y-2.5">
                <ArtisanMap
                  buyerCoordinates={buyerCoordinates}
                  radiusKm={maxRadiusKm}
                  artisans={filteredArtisans.map((entry) => entry.artisan)}
                  selectedArtisanId={selectedArtisanId}
                  onSelectArtisan={(id) => setSelectedArtisanId(id)}
                  onOpenWorkspace={handleOpenArtisanWorkspace}
                  onPickBuyerCoordinates={handlePickMapCoordinates}
                />
                <div className="flex items-center justify-between px-1 text-xs text-muted">
                  <span>
                    <strong>{filteredArtisans.length}</strong> artisans within{" "}
                    {maxRadiusKm} km
                  </span>
                  <span>Click map or drag YOU pin to change location</span>
                </div>
              </div>
            </div>

            <div className="lg:col-span-7">
              {filteredArtisans.length === 0 ? (
                <div className="flex h-[540px] flex-col items-center justify-center rounded-xl border border-border bg-surface p-10 text-center">
                  <Wrench className="h-10 w-10 text-subtle mb-3" />
                  <h3 className="text-base font-bold text-ink">
                    No artisans within {maxRadiusKm} km of {buyerAddressLabel}
                  </h3>
                  <p className="mt-1.5 max-w-md text-xs text-muted leading-relaxed">
                    Expand the distance slider or register a new artisan in your
                    neighborhood.
                  </p>
                  <div className="mt-5 flex flex-wrap justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setBuyerLocation(
                          { lat: 30.2672, lng: -97.7431 },
                          "South Congress, Austin, TX"
                        );
                        setSelectedTrade("All");
                        setMaxRadiusKm(35);
                      }}
                      className="rounded-lg bg-ink px-4 py-2 text-xs font-bold text-white hover:bg-terracotta transition-colors"
                    >
                      View Austin Directory
                    </button>
                    <button
                      type="button"
                      onClick={() => router.push("/onboarding?role=artisan")}
                      className="rounded-lg border border-border bg-canvas px-4 py-2 text-xs font-semibold text-ink hover:bg-stone transition-colors"
                    >
                      Register as an Artisan Here
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid gap-5 sm:grid-cols-2">
                  {filteredArtisans.map(({ artisan, distanceKm }) => {
                    const isHighlighted = artisan.id === selectedArtisanId;
                    return (
                      <div
                        key={artisan.id}
                        className={`flex flex-col justify-between rounded-xl border bg-surface p-6 transition-all ${
                          isHighlighted
                            ? "border-terracotta ring-2 ring-terracotta/20"
                            : "border-border"
                        }`}
                      >
                        <div>
                          <div className="flex items-start justify-between gap-3">
                            <button
                              type="button"
                              onClick={() => setSelectedArtisanId(artisan.id)}
                              className="flex items-center gap-3 text-left focus:outline-none"
                            >
                              <div
                                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${artisan.avatarHue} text-sm font-bold`}
                              >
                                {artisan.name
                                  .split(" ")
                                  .map((n) => n[0])
                                  .join("")}
                              </div>
                              <div>
                                <h3 className="text-base font-bold text-ink hover:text-terracotta transition-colors">
                                  {artisan.name}
                                </h3>
                                <p className="text-xs text-muted">
                                  {artisan.trade} • {artisan.neighborhood},{" "}
                                  {artisan.city}
                                </p>
                              </div>
                            </button>

                            <span
                              className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                                artisan.availableNow
                                  ? "bg-olive/15 text-olive"
                                  : "bg-ochre/20 text-ochre-dark"
                              }`}
                            >
                              {artisan.availableNow ? "Available" : "On Job"}
                            </span>
                          </div>

                          <div className="mt-3.5 flex items-center gap-3 text-xs text-muted">
                            <span className="inline-flex items-center gap-1 font-semibold text-ink">
                              <Star className="h-3.5 w-3.5 fill-ochre text-ochre" />
                              {artisan.rating} ({artisan.completedJobsCount})
                            </span>
                            <span>• {distanceKm} km</span>
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3 w-3" />~
                              {artisan.responseMinutes}m
                            </span>
                          </div>

                          <p className="mt-3 text-xs text-muted leading-relaxed">
                            {artisan.bio}
                          </p>
                        </div>

                        <div className="mt-5 border-t border-stone pt-4 flex items-center justify-between gap-2">
                          <div>
                            <span className="block text-[10px] uppercase tracking-wider text-subtle">
                              Rate
                            </span>
                            <span className="text-sm font-bold text-ink">
                              {formatUsdFromCents(artisan.hourlyRateCents)}/hr
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              handleOpenArtisanWorkspace(artisan.id)
                            }
                            className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-xs font-bold text-white hover:bg-terracotta transition-colors"
                          >
                            <PhoneCall className="h-3.5 w-3.5" />
                            <span>
                              {currentUser
                                ? "Message & Call"
                                : "Sign In to Call"}
                            </span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
