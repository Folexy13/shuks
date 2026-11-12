-- Shuks PostgreSQL Schema (Integer Cents + UTC Timestamps)

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('buyer', 'artisan')),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    paypal_email TEXT NOT NULL,
    location_label TEXT NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    linked_artisan_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS artisans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    business_name TEXT NOT NULL,
    trade TEXT NOT NULL,
    rating NUMERIC(3, 2) NOT NULL DEFAULT 5.00,
    completed_jobs_count INTEGER NOT NULL DEFAULT 0,
    response_minutes INTEGER NOT NULL DEFAULT 10,
    hourly_rate_cents INTEGER NOT NULL CHECK (hourly_rate_cents > 0),
    base_callout_cents INTEGER NOT NULL CHECK (base_callout_cents > 0),
    neighborhood TEXT NOT NULL,
    city TEXT NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    paypal_email TEXT NOT NULL,
    verified_badges JSONB NOT NULL DEFAULT '[]'::jsonb,
    bio TEXT NOT NULL,
    skills JSONB NOT NULL DEFAULT '[]'::jsonb,
    avatar_hue TEXT NOT NULL DEFAULT 'bg-terracotta text-white',
    available_now BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_artisans_trade ON artisans (trade);

CREATE TABLE IF NOT EXISTS job_sessions (
    job_id TEXT PRIMARY KEY,
    artisan_id TEXT NOT NULL REFERENCES artisans(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    lifecycle_state TEXT NOT NULL DEFAULT 'DISCOVERY',
    buyer_granted_draft_permission BOOLEAN NOT NULL DEFAULT FALSE,
    artisan_accepted_offer BOOLEAN NOT NULL DEFAULT FALSE,
    meeting_analysis JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_sessions_artisan_id ON job_sessions (artisan_id);

CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES job_sessions(job_id) ON DELETE CASCADE,
    sender TEXT NOT NULL CHECK (sender IN ('buyer', 'artisan', 'agent')),
    sender_name TEXT NOT NULL,
    text TEXT NOT NULL,
    attachment_type TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_job_id ON chat_messages (job_id, created_at);

CREATE TABLE IF NOT EXISTS paypal_escrow_ledger (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES job_sessions(job_id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN ('ORDER_CREATED', 'ORDER_CAPTURED', 'MILESTONE_PAYOUT_RELEASED')),
    paypal_reference_id TEXT NOT NULL,
    milestone_id TEXT,
    recipient_paypal_email TEXT,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    currency TEXT NOT NULL DEFAULT 'USD',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_paypal_escrow_ledger_job_id ON paypal_escrow_ledger (job_id);
