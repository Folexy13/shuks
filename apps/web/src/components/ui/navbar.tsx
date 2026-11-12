"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { LogOut, User } from "lucide-react";
import { useShuksStore } from "@/lib/store";

export function Navbar() {
  const { currentUser, signOutUser } = useShuksStore();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-canvas/95 backdrop-blur-sm">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6 lg:px-10">
        <Link href="/" className="flex items-center focus:outline-none">
          <Image
            src="/shuks_logo.jpeg"
            alt="Shuks — The Marketplace"
            width={168}
            height={54}
            priority
            className="h-12 w-auto object-contain"
          />
        </Link>

        <nav
          aria-label="Primary navigation"
          className="hidden md:flex items-center gap-8 text-sm font-medium text-muted"
        >
          <a href="/#directory" className="hover:text-ink transition-colors">
            Artisan Directory
          </a>
          <a
            href="/#how-it-works"
            className="hover:text-ink transition-colors"
          >
            How Escrow Works
          </a>
          <Link
            href="/onboarding?role=artisan"
            className="hover:text-terracotta transition-colors"
          >
            List Your Trade
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          {currentUser ? (
            <div className="flex items-center gap-2.5">
              <Link
                href={
                  currentUser.linkedArtisanId
                    ? `/workspace/${currentUser.linkedArtisanId}`
                    : "/#directory"
                }
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3.5 py-2 text-xs font-semibold text-ink hover:border-ink transition-colors"
              >
                <User className="h-3.5 w-3.5 text-terracotta" />
                <span>{currentUser.name}</span>
                <span className="rounded bg-stone px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-olive">
                  {currentUser.role === "buyer" ? "Client" : "Artisan"}
                </span>
              </Link>
              <button
                type="button"
                onClick={signOutUser}
                aria-label="Sign out"
                title="Sign out"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-muted hover:text-ink hover:border-ink transition-colors"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <>
              <Link
                href="/onboarding?mode=signin"
                className="rounded-lg px-4 py-2 text-sm font-semibold text-ink hover:bg-stone transition-colors"
              >
                Sign In
              </Link>
              <Link
                href="/onboarding?role=buyer"
                className="rounded-lg bg-ink px-4 py-2.5 text-xs font-semibold text-white hover:bg-terracotta transition-colors"
              >
                Get Started
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
