"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";
import { Maximize2, Minimize2 } from "lucide-react";
import {
  Circle,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { ArtisanProfile, GeoCoordinates } from "@/lib/types";
import { formatUsdFromCents } from "@/lib/money";

interface MapViewportUpdaterProps {
  center: GeoCoordinates;
  isFullscreen: boolean;
}

function MapViewportUpdater({
  center,
  isFullscreen,
}: MapViewportUpdaterProps) {
  const map = useMap();

  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
      map.setView([center.lat, center.lng], map.getZoom(), {
        animate: true,
      });
    }, 120);
    return () => clearTimeout(timer);
  }, [center.lat, center.lng, isFullscreen, map]);

  return null;
}

function MapClickHandler({
  onPickCoordinates,
}: {
  onPickCoordinates?: (coords: GeoCoordinates) => void;
}) {
  useMapEvents({
    click(event) {
      if (onPickCoordinates) {
        onPickCoordinates({
          lat: event.latlng.lat,
          lng: event.latlng.lng,
        });
      }
    },
  });
  return null;
}

function createBuyerPinIcon(): L.DivIcon {
  return L.divIcon({
    className: "shuks-buyer-pin",
    html: `<div style="display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:9999px;background:#C85A32;border:3px solid #ffffff;box-shadow:0 4px 12px rgba(30,36,48,0.35);color:#ffffff;font-weight:800;font-size:10px;">YOU</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

function createArtisanPinIcon(
  artisan: ArtisanProfile,
  isSelected: boolean
): L.DivIcon {
  const bg = isSelected ? "#C85A32" : "#1E2430";
  const border = isSelected ? "#ffffff" : "#F6F5F0";
  const rateLabel = formatUsdFromCents(artisan.hourlyRateCents).replace(
    ".00",
    ""
  );

  return L.divIcon({
    className: "shuks-artisan-pin",
    html: `<div style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:8px;background:${bg};border:2px solid ${border};color:#ffffff;font-weight:700;font-size:12px;white-space:nowrap;box-shadow:0 6px 16px rgba(30,36,48,0.28);transform:${
      isSelected ? "scale(1.1)" : "scale(1)"
    };transition:transform 0.15s;">
      <span style="width:7px;height:7px;border-radius:9999px;background:${
        artisan.availableNow ? "#84cc16" : "#d97706"
      };display:inline-block;"></span>
      <span>${rateLabel}/hr</span>
    </div>`,
    iconSize: [80, 32],
    iconAnchor: [40, 16],
  });
}

export interface ArtisanMapInnerProps {
  buyerCoordinates: GeoCoordinates;
  radiusKm: number;
  artisans: ArtisanProfile[];
  selectedArtisanId: string | null;
  onSelectArtisan: (artisanId: string) => void;
  onOpenWorkspace: (artisanId: string) => void;
  onPickBuyerCoordinates?: (coords: GeoCoordinates) => void;
}

export default function ArtisanMapInner({
  buyerCoordinates,
  radiusKm,
  artisans,
  selectedArtisanId,
  onSelectArtisan,
  onOpenWorkspace,
  onPickBuyerCoordinates,
}: ArtisanMapInnerProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const mapWrapperRef = useRef<HTMLDivElement | null>(null);
  const buyerIcon = createBuyerPinIcon();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isFullscreen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFullscreen]);

  const mapContent = (
    <div
      ref={mapWrapperRef}
      className={
        isFullscreen
          ? "fixed inset-0 z-[9999] flex flex-col bg-canvas p-4"
          : "relative h-[540px] w-full overflow-hidden rounded-xl border border-border bg-stone"
      }
    >
      <div className="relative h-full w-full overflow-hidden rounded-lg">
        <button
          type="button"
          onClick={() => setIsFullscreen((prev) => !prev)}
          aria-label={
            isFullscreen ? "Exit full screen map" : "View full screen map"
          }
          title={isFullscreen ? "Exit full screen (Esc)" : "Full screen map"}
          className="absolute right-3.5 top-3.5 z-[1000] inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-ink shadow-md hover:bg-stone transition-colors"
        >
          {isFullscreen ? (
            <>
              <Minimize2 className="h-3.5 w-3.5 text-terracotta" />
              <span>Exit Full Screen</span>
            </>
          ) : (
            <>
              <Maximize2 className="h-3.5 w-3.5 text-ink" />
              <span>Expand Map</span>
            </>
          )}
        </button>

        <MapContainer
          center={[buyerCoordinates.lat, buyerCoordinates.lng]}
          zoom={12}
          scrollWheelZoom={true}
          className="h-full w-full z-0"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapViewportUpdater
            center={buyerCoordinates}
            isFullscreen={isFullscreen}
          />
          <MapClickHandler onPickCoordinates={onPickBuyerCoordinates} />

          <Circle
            center={[buyerCoordinates.lat, buyerCoordinates.lng]}
            radius={radiusKm * 1000}
            pathOptions={{
              color: "#5F6F3A",
              fillColor: "#5F6F3A",
              fillOpacity: 0.08,
              weight: 1.5,
              dashArray: "6 6",
            }}
          />

          <Marker
            position={[buyerCoordinates.lat, buyerCoordinates.lng]}
            icon={buyerIcon}
            draggable={true}
            eventHandlers={{
              dragend: (event) => {
                const marker = event.target as L.Marker;
                const pos = marker.getLatLng();
                onPickBuyerCoordinates?.({ lat: pos.lat, lng: pos.lng });
              },
            }}
          >
            <Popup>
              <div className="text-ink text-xs font-medium p-1">
                <strong>Your Pin</strong>
                <p className="mt-0.5 text-muted">
                  Radius: {radiusKm} km (drag or click map to move)
                </p>
              </div>
            </Popup>
          </Marker>

          {artisans.map((artisan) => {
            const isSelected = artisan.id === selectedArtisanId;
            return (
              <Marker
                key={artisan.id}
                position={[artisan.coordinates.lat, artisan.coordinates.lng]}
                icon={createArtisanPinIcon(artisan, isSelected)}
                eventHandlers={{
                  click: () => onSelectArtisan(artisan.id),
                }}
              >
                <Popup>
                  <div className="min-w-[190px] p-1 text-ink">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-sm">{artisan.name}</span>
                      <span className="rounded bg-stone px-2 py-0.5 text-[10px] font-semibold text-olive">
                        {artisan.trade}
                      </span>
                    </div>
                    <p className="text-xs text-muted mt-0.5">
                      {artisan.neighborhood}, {artisan.city}
                    </p>
                    <p className="text-xs font-semibold text-ink mt-1">
                      {formatUsdFromCents(artisan.hourlyRateCents)}/hr •{" "}
                      {artisan.responseMinutes}m response
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setIsFullscreen(false);
                        onOpenWorkspace(artisan.id);
                      }}
                      className="mt-2.5 w-full rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white hover:bg-terracotta transition-colors"
                    >
                      Open Workspace
                    </button>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );

  if (isFullscreen && mounted) {
    return (
      <>
        <div className="h-[540px] w-full rounded-xl border border-border bg-stone" />
        {createPortal(mapContent, document.body)}
      </>
    );
  }

  return mapContent;
}
