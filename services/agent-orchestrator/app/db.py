import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row

BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_SQLITE_FILE = BASE_DIR / "data" / "shuks.db"
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()

SEED_ARTISANS: list[dict[str, Any]] = [
    {
        "id": "art-marcus-plumbing",
        "name": "Marcus Rivera",
        "email": "aluko@preplink.ai",
        "businessName": "South Congress Plumbing & Drain",
        "trade": "Plumbing",
        "rating": 4.9,
        "completedJobsCount": 184,
        "responseMinutes": 10,
        "hourlyRateCents": 6500,
        "baseCalloutCents": 2000,
        "neighborhood": "South Congress",
        "city": "Austin, TX",
        "coordinates": {"lat": 30.2518, "lng": -97.7495},
        "paypalEmail": "aluko@preplink.ai",
        "verifiedBadges": ["TDLR Master Plumber", "PayPal Escrow Verified"],
        "bio": "Emergency pipe bursts, under-sink angle stops, water heater pressure valves, and kitchen drain clearing.",
        "skills": ["Copper & PEX Repiping", "Angle Stop Valves", "Leak Detection"],
        "avatarHue": "bg-terracotta text-white",
        "availableNow": True,
    },
    {
        "id": "art-elena-electrical",
        "name": "Elena Rostova",
        "email": "elena@shuks.app",
        "businessName": "VoltCraft Residential Electrical",
        "trade": "Electrical",
        "rating": 4.95,
        "completedJobsCount": 239,
        "responseMinutes": 12,
        "hourlyRateCents": 8000,
        "baseCalloutCents": 2500,
        "neighborhood": "East Cesar Chavez",
        "city": "Austin, TX",
        "coordinates": {"lat": 30.2591, "lng": -97.7244},
        "paypalEmail": "sb-voltcraft@business.example.com",
        "verifiedBadges": ["TDLR Master Electrician", "PayPal Escrow Verified"],
        "bio": "200A breaker panel diagnostics, GFCI/AFCI circuit upgrades, transfer switches, and Level-2 EV charger wiring.",
        "skills": ["Breaker Panels", "GFCI/AFCI Circuits", "EV Charger Wiring"],
        "avatarHue": "bg-olive text-white",
        "availableNow": True,
    },
    {
        "id": "art-owen-carpentry",
        "name": "Owen Whitaker",
        "email": "owen@shuks.app",
        "businessName": "Clarksville Finish Carpentry",
        "trade": "Carpentry",
        "rating": 4.85,
        "completedJobsCount": 142,
        "responseMinutes": 15,
        "hourlyRateCents": 7000,
        "baseCalloutCents": 2000,
        "neighborhood": "Clarksville",
        "city": "Austin, TX",
        "coordinates": {"lat": 30.2795, "lng": -97.7601},
        "paypalEmail": "sb-clarksville.wood@business.example.com",
        "verifiedBadges": ["Bonded & Insured", "PayPal Escrow Verified"],
        "bio": "Exterior door frame alignment, weatherstripping, cabinet hinge rebuilds, and custom shelving.",
        "skills": ["Solid Core Doors", "Cabinetry Repair", "Trim & Molding"],
        "avatarHue": "bg-ochre text-white",
        "availableNow": True,
    },
    {
        "id": "art-nadia-hvac",
        "name": "Nadia Haddad",
        "email": "nadia@shuks.app",
        "businessName": "BreezeLine Express HVAC",
        "trade": "HVAC & Cooling",
        "rating": 4.92,
        "completedJobsCount": 211,
        "responseMinutes": 14,
        "hourlyRateCents": 8500,
        "baseCalloutCents": 3000,
        "neighborhood": "Mueller",
        "city": "Austin, TX",
        "coordinates": {"lat": 30.2974, "lng": -97.7055},
        "paypalEmail": "sb-breezeline@business.example.com",
        "verifiedBadges": ["EPA 608 Certified", "PayPal Escrow Verified"],
        "bio": "Run capacitor replacement, refrigerant pressure diagnostics, condensate drain line flushes, and smart thermostats.",
        "skills": ["Run Capacitors", "Condensate Line Flush", "Blower Motors"],
        "avatarHue": "bg-ink text-white",
        "availableNow": True,
    },
    {
        "id": "art-devon-locksmith",
        "name": "Devon Brooks",
        "email": "devon@shuks.app",
        "businessName": "Keystone Mobile Lock & Deadbolt",
        "trade": "Locksmith",
        "rating": 4.88,
        "completedJobsCount": 310,
        "responseMinutes": 8,
        "hourlyRateCents": 6000,
        "baseCalloutCents": 1500,
        "neighborhood": "Bouldin Creek",
        "city": "Austin, TX",
        "coordinates": {"lat": 30.2542, "lng": -97.7568},
        "paypalEmail": "sb-keystone.lock@business.example.com",
        "verifiedBadges": ["TX DPS Licensed", "PayPal Escrow Verified"],
        "bio": "Multipoint patio door locks, smart deadbolt installation, cylinder rekeying, and strike plate reinforcement.",
        "skills": ["Smart Deadbolts", "Cylinder Rekeying", "Multipoint Locks"],
        "avatarHue": "bg-terracotta text-white",
        "availableNow": True,
    },
    {
        "id": "art-caleb-appliance",
        "name": "Caleb Mercer",
        "email": "caleb@shuks.app",
        "businessName": "Hyde Park Appliance Repair",
        "trade": "Appliance Repair",
        "rating": 4.91,
        "completedJobsCount": 167,
        "responseMinutes": 18,
        "hourlyRateCents": 7500,
        "baseCalloutCents": 2500,
        "neighborhood": "Hyde Park",
        "city": "Austin, TX",
        "coordinates": {"lat": 30.3052, "lng": -97.7265},
        "paypalEmail": "sb-hydepark.fix@business.example.com",
        "verifiedBadges": ["Factory Authorized", "PayPal Escrow Verified"],
        "bio": "Washer drain pumps, refrigerator evaporator fans, gas range igniters, and dryer heating elements.",
        "skills": ["Washer Drain Pumps", "Evaporator Fans", "Dryer Elements"],
        "avatarHue": "bg-olive text-white",
        "availableNow": False,
    },
]


def _use_postgres() -> bool:
    return DATABASE_URL.startswith("postgresql://") or DATABASE_URL.startswith(
        "postgres://"
    )


def _sqlite_conn() -> sqlite3.Connection:
    DEFAULT_SQLITE_FILE.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DEFAULT_SQLITE_FILE), timeout=10.0)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    now_iso = datetime.now(timezone.utc).isoformat()
    if _use_postgres():
        with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                for item in SEED_ARTISANS:
                    cur.execute(
                        """
                        INSERT INTO artisans (
                            id, name, business_name, trade, rating, completed_jobs_count,
                            response_minutes, hourly_rate_cents, base_callout_cents,
                            neighborhood, city, lat, lng, paypal_email, verified_badges,
                            bio, skills, avatar_hue, available_now
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s::jsonb, %s, %s)
                        ON CONFLICT (id) DO NOTHING
                        """,
                        (
                            item["id"],
                            item["name"],
                            item["businessName"],
                            item["trade"],
                            item["rating"],
                            item["completedJobsCount"],
                            item["responseMinutes"],
                            item["hourlyRateCents"],
                            item["baseCalloutCents"],
                            item["neighborhood"],
                            item["city"],
                            item["coordinates"]["lat"],
                            item["coordinates"]["lng"],
                            item["paypalEmail"],
                            json.dumps(item["verifiedBadges"]),
                            item["bio"],
                            json.dumps(item["skills"]),
                            item["avatarHue"],
                            item["availableNow"],
                        ),
                    )
                    cur.execute(
                        """
                        INSERT INTO users (
                            id, role, name, email, phone, paypal_email,
                            location_label, lat, lng, linked_artisan_id
                        ) VALUES (%s, 'artisan', %s, %s, '+1 (512) 555-0192', %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO NOTHING
                        """,
                        (
                            f"usr-{item['id']}",
                            item["name"],
                            item.get("email", f"{item['id']}@shuks.app"),
                            item["paypalEmail"],
                            f"{item['neighborhood']}, {item['city']}",
                            item["coordinates"]["lat"],
                            item["coordinates"]["lng"],
                            item["id"],
                        ),
                    )
            conn.commit()
        return

    with _sqlite_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                role TEXT NOT NULL,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                phone TEXT NOT NULL,
                paypal_email TEXT NOT NULL,
                location_label TEXT NOT NULL,
                lat REAL NOT NULL,
                lng REAL NOT NULL,
                linked_artisan_id TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS artisans (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                business_name TEXT NOT NULL,
                trade TEXT NOT NULL,
                rating REAL NOT NULL,
                completed_jobs_count INTEGER NOT NULL,
                response_minutes INTEGER NOT NULL,
                hourly_rate_cents INTEGER NOT NULL,
                base_callout_cents INTEGER NOT NULL,
                neighborhood TEXT NOT NULL,
                city TEXT NOT NULL,
                lat REAL NOT NULL,
                lng REAL NOT NULL,
                paypal_email TEXT NOT NULL,
                verified_badges TEXT NOT NULL,
                bio TEXT NOT NULL,
                skills TEXT NOT NULL,
                avatar_hue TEXT NOT NULL,
                available_now INTEGER NOT NULL,
                is_custom INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS job_sessions (
                job_id TEXT PRIMARY KEY,
                artisan_id TEXT NOT NULL,
                title TEXT NOT NULL,
                lifecycle_state TEXT NOT NULL,
                buyer_granted_draft_permission INTEGER NOT NULL DEFAULT 0,
                artisan_accepted_offer INTEGER NOT NULL DEFAULT 0,
                transcript_json TEXT NOT NULL DEFAULT '[]',
                meeting_analysis_json TEXT,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                sender TEXT NOT NULL,
                sender_name TEXT NOT NULL,
                text TEXT NOT NULL,
                attachment_type TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS paypal_escrow_ledger (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                paypal_reference_id TEXT NOT NULL,
                milestone_id TEXT,
                recipient_paypal_email TEXT,
                amount_cents INTEGER NOT NULL,
                currency TEXT NOT NULL DEFAULT 'USD',
                created_at TEXT NOT NULL
            );
            """
        )

        conn.execute("DELETE FROM artisans WHERE is_custom = 0")
        for item in SEED_ARTISANS:
            conn.execute(
                """
                INSERT OR REPLACE INTO artisans (
                    id, name, business_name, trade, rating, completed_jobs_count,
                    response_minutes, hourly_rate_cents, base_callout_cents,
                    neighborhood, city, lat, lng, paypal_email, verified_badges,
                    bio, skills, avatar_hue, available_now, is_custom, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
                """,
                (
                    item["id"],
                    item["name"],
                    item["businessName"],
                    item["trade"],
                    item["rating"],
                    item["completedJobsCount"],
                    item["responseMinutes"],
                    item["hourlyRateCents"],
                    item["baseCalloutCents"],
                    item["neighborhood"],
                    item["city"],
                    item["coordinates"]["lat"],
                    item["coordinates"]["lng"],
                    item["paypalEmail"],
                    json.dumps(item["verifiedBadges"]),
                    item["bio"],
                    json.dumps(item["skills"]),
                    item["avatarHue"],
                    1 if item["availableNow"] else 0,
                    now_iso,
                ),
            )
            conn.execute(
                """
                INSERT OR REPLACE INTO users (
                    id, role, name, email, phone, paypal_email,
                    location_label, lat, lng, linked_artisan_id, created_at
                ) VALUES (?, 'artisan', ?, ?, '+1 (512) 555-0192', ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"usr-{item['id']}",
                    item["name"],
                    item.get("email", f"{item['id']}@shuks.app"),
                    item["paypalEmail"],
                    f"{item['neighborhood']}, {item['city']}",
                    item["coordinates"]["lat"],
                    item["coordinates"]["lng"],
                    item["id"],
                    now_iso,
                ),
            )
        conn.execute(
            """
            INSERT OR IGNORE INTO users (
                id, role, name, email, phone, paypal_email,
                location_label, lat, lng, linked_artisan_id, created_at
            ) VALUES ('usr-demo-buyer', 'buyer', 'Aluko Folajimi', 'buyer@shuks.app', '+1 (512) 555-0140', 'sb-buyer@personal.example.com', 'South Congress, Austin, TX', 30.2672, -97.7431, NULL, ?)
            """,
            (now_iso,),
        )
        conn.commit()


def _format_artisan_row(row: Any) -> dict[str, Any]:
    badges = row["verified_badges"]
    skills = row["skills"]
    return {
        "id": row["id"],
        "name": row["name"],
        "businessName": row["business_name"],
        "trade": row["trade"],
        "rating": float(row["rating"]),
        "completedJobsCount": int(row["completed_jobs_count"]),
        "responseMinutes": int(row["response_minutes"]),
        "hourlyRateCents": int(row["hourly_rate_cents"]),
        "baseCalloutCents": int(row["base_callout_cents"]),
        "neighborhood": row["neighborhood"],
        "city": row["city"],
        "coordinates": {
            "lat": float(row["lat"]),
            "lng": float(row["lng"]),
        },
        "paypalEmail": row["paypal_email"],
        "verifiedBadges": json.loads(badges) if isinstance(badges, str) else badges,
        "bio": row["bio"],
        "skills": json.loads(skills) if isinstance(skills, str) else skills,
        "avatarHue": row["avatar_hue"],
        "availableNow": bool(row["available_now"]),
        "isCustom": bool(row["is_custom"]) if "is_custom" in row.keys() else False,
    }


def list_all_artisans() -> list[dict[str, Any]]:
    if _use_postgres():
        with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
            rows = conn.execute(
                "SELECT * FROM artisans ORDER BY created_at DESC"
            ).fetchall()
            return [_format_artisan_row(r) for r in rows]

    with _sqlite_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM artisans ORDER BY is_custom DESC, created_at DESC"
        ).fetchall()
        return [_format_artisan_row(r) for r in rows]


def get_artisan(artisan_id: str) -> dict[str, Any]:
    if _use_postgres():
        with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
            row = conn.execute(
                "SELECT * FROM artisans WHERE id = %s", (artisan_id,)
            ).fetchone()
            if row:
                return _format_artisan_row(row)
    else:
        with _sqlite_conn() as conn:
            row = conn.execute(
                "SELECT * FROM artisans WHERE id = ?", (artisan_id,)
            ).fetchone()
            if row:
                return _format_artisan_row(row)
    return SEED_ARTISANS[0]


def find_user_by_email(email: str) -> dict[str, Any] | None:
    normalized = email.strip().lower()
    if _use_postgres():
        with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
            row = conn.execute(
                "SELECT * FROM users WHERE LOWER(email) = %s OR LOWER(paypal_email) = %s LIMIT 1",
                (normalized, normalized),
            ).fetchone()
            if not row:
                art_row = conn.execute(
                    "SELECT * FROM artisans WHERE LOWER(paypal_email) = %s LIMIT 1",
                    (normalized,),
                ).fetchone()
                if art_row:
                    return {
                        "id": f"usr-{art_row['id']}",
                        "role": "artisan",
                        "name": art_row["name"],
                        "email": normalized,
                        "phone": "+1 (512) 555-0192",
                        "paypalEmail": art_row["paypal_email"],
                        "locationLabel": f"{art_row['neighborhood']}, {art_row['city']}",
                        "coordinates": {
                            "lat": float(art_row["lat"]),
                            "lng": float(art_row["lng"]),
                        },
                        "linkedArtisanId": art_row["id"],
                    }
    else:
        with _sqlite_conn() as conn:
            row = conn.execute(
                "SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(paypal_email) = ? LIMIT 1",
                (normalized, normalized),
            ).fetchone()
            if not row:
                art_row = conn.execute(
                    "SELECT * FROM artisans WHERE LOWER(paypal_email) = ? LIMIT 1",
                    (normalized,),
                ).fetchone()
                if art_row:
                    return {
                        "id": f"usr-{art_row['id']}",
                        "role": "artisan",
                        "name": art_row["name"],
                        "email": normalized,
                        "phone": "+1 (512) 555-0192",
                        "paypalEmail": art_row["paypal_email"],
                        "locationLabel": f"{art_row['neighborhood']}, {art_row['city']}",
                        "coordinates": {
                            "lat": float(art_row["lat"]),
                            "lng": float(art_row["lng"]),
                        },
                        "linkedArtisanId": art_row["id"],
                    }

    if not row:
        return None

    return {
        "id": row["id"],
        "role": row["role"],
        "name": row["name"],
        "email": row["email"],
        "phone": row["phone"],
        "paypalEmail": row["paypal_email"],
        "locationLabel": row["location_label"],
        "coordinates": {
            "lat": float(row["lat"]),
            "lng": float(row["lng"]),
        },
        "linkedArtisanId": row["linked_artisan_id"],
    }


def insert_client_user(data: dict[str, Any]) -> dict[str, Any]:
    existing = find_user_by_email(data["email"])
    if existing:
        return existing

    now_iso = datetime.now(timezone.utc).isoformat()
    user_id = f"usr-client-{int(datetime.now(timezone.utc).timestamp() * 1000)}"
    lat = float(data["coordinates"]["lat"])
    lng = float(data["coordinates"]["lng"])

    if _use_postgres():
        with psycopg.connect(DATABASE_URL) as conn:
            conn.execute(
                """
                INSERT INTO users (
                    id, role, name, email, phone, paypal_email,
                    location_label, lat, lng, linked_artisan_id, created_at
                ) VALUES (%s, 'buyer', %s, %s, %s, %s, %s, %s, %s, NULL, %s)
                """,
                (
                    user_id,
                    data["name"],
                    data["email"].strip().lower(),
                    data.get("phone", ""),
                    data["paypalEmail"],
                    data["locationLabel"],
                    lat,
                    lng,
                    now_iso,
                ),
            )
            conn.commit()
    else:
        with _sqlite_conn() as conn:
            conn.execute(
                """
                INSERT INTO users (
                    id, role, name, email, phone, paypal_email,
                    location_label, lat, lng, linked_artisan_id, created_at
                ) VALUES (?, 'buyer', ?, ?, ?, ?, ?, ?, ?, NULL, ?)
                """,
                (
                    user_id,
                    data["name"],
                    data["email"].strip().lower(),
                    data.get("phone", ""),
                    data["paypalEmail"],
                    data["locationLabel"],
                    lat,
                    lng,
                    now_iso,
                ),
            )
            conn.commit()

    return {
        "id": user_id,
        "role": "buyer",
        "name": data["name"],
        "email": data["email"].strip().lower(),
        "phone": data.get("phone", ""),
        "paypalEmail": data["paypalEmail"],
        "locationLabel": data["locationLabel"],
        "coordinates": {"lat": lat, "lng": lng},
    }


def insert_artisan_user(data: dict[str, Any]) -> dict[str, Any]:
    now_iso = datetime.now(timezone.utc).isoformat()
    ts_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    artisan_id = f"art-{ts_ms}"
    user_id = f"usr-artisan-{ts_ms}"

    parts = [p.strip() for p in data["locationLabel"].split(",") if p.strip()]
    neighborhood = parts[0] if parts else "South Congress"
    city = parts[1] if len(parts) > 1 else "Austin, TX"

    lat = round(float(data["coordinates"]["lat"]), 5)
    lng = round(float(data["coordinates"]["lng"]), 5)

    if _use_postgres():
        with psycopg.connect(DATABASE_URL) as conn:
            conn.execute(
                """
                INSERT INTO artisans (
                    id, name, business_name, trade, rating, completed_jobs_count,
                    response_minutes, hourly_rate_cents, base_callout_cents,
                    neighborhood, city, lat, lng, paypal_email, verified_badges,
                    bio, skills, avatar_hue, available_now
                ) VALUES (%s, %s, %s, %s, 5.0, 1, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s::jsonb, 'bg-terracotta text-white', TRUE)
                """,
                (
                    artisan_id,
                    data["name"],
                    data["businessName"],
                    data["trade"],
                    int(data["responseMinutes"]),
                    int(data["hourlyRateCents"]),
                    int(data["baseCalloutCents"]),
                    neighborhood,
                    city,
                    lat,
                    lng,
                    data["paypalEmail"],
                    json.dumps(["Verified Pro", "PayPal Escrow Verified"]),
                    data["bio"],
                    json.dumps(data.get("skills") or [data["trade"]]),
                ),
            )
            conn.execute(
                """
                INSERT INTO users (
                    id, role, name, email, phone, paypal_email,
                    location_label, lat, lng, linked_artisan_id, created_at
                ) VALUES (%s, 'artisan', %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    user_id,
                    data["name"],
                    data["email"].strip().lower(),
                    data.get("phone", ""),
                    data["paypalEmail"],
                    data["locationLabel"],
                    lat,
                    lng,
                    artisan_id,
                    now_iso,
                ),
            )
            conn.commit()
    else:
        with _sqlite_conn() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO artisans (
                    id, name, business_name, trade, rating, completed_jobs_count,
                    response_minutes, hourly_rate_cents, base_callout_cents,
                    neighborhood, city, lat, lng, paypal_email, verified_badges,
                    bio, skills, avatar_hue, available_now, is_custom, created_at
                ) VALUES (?, ?, ?, ?, 5.0, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bg-terracotta text-white', 1, 1, ?)
                """,
                (
                    artisan_id,
                    data["name"],
                    data["businessName"],
                    data["trade"],
                    int(data["responseMinutes"]),
                    int(data["hourlyRateCents"]),
                    int(data["baseCalloutCents"]),
                    neighborhood,
                    city,
                    lat,
                    lng,
                    data["paypalEmail"],
                    json.dumps(["Verified Pro", "PayPal Escrow Verified"]),
                    data["bio"],
                    json.dumps(data.get("skills") or [data["trade"]]),
                    now_iso,
                ),
            )
            conn.execute(
                """
                INSERT OR REPLACE INTO users (
                    id, role, name, email, phone, paypal_email,
                    location_label, lat, lng, linked_artisan_id, created_at
                ) VALUES (?, 'artisan', ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    data["name"],
                    data["email"].strip().lower(),
                    data.get("phone", ""),
                    data["paypalEmail"],
                    data["locationLabel"],
                    lat,
                    lng,
                    artisan_id,
                    now_iso,
                ),
            )
            conn.commit()

    artisan_profile = get_artisan(artisan_id)
    account = {
        "id": user_id,
        "role": "artisan",
        "name": data["name"],
        "email": data["email"].strip().lower(),
        "phone": data.get("phone", ""),
        "paypalEmail": data["paypalEmail"],
        "locationLabel": data["locationLabel"],
        "coordinates": {"lat": lat, "lng": lng},
        "linkedArtisanId": artisan_id,
    }
    return {"account": account, "artisan": artisan_profile}


def ensure_job_session(artisan_id: str) -> str:
    artisan = get_artisan(artisan_id)
    job_id = f"job-{artisan_id}"
    now_iso = datetime.now(timezone.utc).isoformat()
    title = f"{artisan['trade']} — {artisan['neighborhood']}"

    if _use_postgres():
        with psycopg.connect(DATABASE_URL) as conn:
            conn.execute(
                """
                INSERT INTO job_sessions (
                    job_id, artisan_id, title, lifecycle_state,
                    buyer_granted_draft_permission, artisan_accepted_offer, updated_at
                ) VALUES (%s, %s, %s, 'DISCOVERY', FALSE, FALSE, %s)
                ON CONFLICT (job_id) DO NOTHING
                """,
                (job_id, artisan_id, title, now_iso),
            )
            conn.commit()
    else:
        with _sqlite_conn() as conn:
            conn.execute(
                """
                INSERT OR IGNORE INTO job_sessions (
                    job_id, artisan_id, title, lifecycle_state,
                    buyer_granted_draft_permission, artisan_accepted_offer,
                    transcript_json, meeting_analysis_json, updated_at
                ) VALUES (?, ?, ?, 'DISCOVERY', 0, 0, '[]', NULL, ?)
                """,
                (job_id, artisan_id, title, now_iso),
            )
            conn.commit()

    return job_id


def get_job_state(artisan_id: str) -> dict[str, Any]:
    job_id = ensure_job_session(artisan_id)
    artisan = get_artisan(artisan_id)
    messages = list_chat_messages(artisan_id)

    if _use_postgres():
        with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
            row = conn.execute(
                "SELECT * FROM job_sessions WHERE job_id = %s", (job_id,)
            ).fetchone()
            if not row:
                return {
                    "jobId": job_id,
                    "artisan": artisan,
                    "lifecycleState": "DISCOVERY",
                    "buyerGrantedDraftPermission": False,
                    "artisanAcceptedOffer": False,
                    "analysis": None,
                    "messages": messages,
                }
            raw_analysis = row.get("meeting_analysis")
            analysis = (
                json.loads(raw_analysis)
                if isinstance(raw_analysis, str)
                else raw_analysis
            )
            return {
                "jobId": job_id,
                "artisan": artisan,
                "lifecycleState": row["lifecycle_state"],
                "buyerGrantedDraftPermission": bool(
                    row["buyer_granted_draft_permission"]
                ),
                "artisanAcceptedOffer": bool(row.get("artisan_accepted_offer")),
                "analysis": analysis,
                "messages": messages,
            }

    with _sqlite_conn() as conn:
        row = conn.execute(
            "SELECT * FROM job_sessions WHERE job_id = ?", (job_id,)
        ).fetchone()
        if not row:
            return {
                "jobId": job_id,
                "artisan": artisan,
                "lifecycleState": "DISCOVERY",
                "buyerGrantedDraftPermission": False,
                "artisanAcceptedOffer": False,
                "analysis": None,
                "messages": messages,
            }
        raw_analysis = row["meeting_analysis_json"]
        analysis = json.loads(raw_analysis) if raw_analysis else None
        return {
            "jobId": job_id,
            "artisan": artisan,
            "lifecycleState": row["lifecycle_state"],
            "buyerGrantedDraftPermission": bool(
                row["buyer_granted_draft_permission"]
            ),
            "artisanAcceptedOffer": bool(row["artisan_accepted_offer"]),
            "analysis": analysis,
            "messages": messages,
        }


def claim_artisan_contract(
    artisan_id: str, artisan_name: str, paypal_email: str
) -> dict[str, Any]:
    job_id = ensure_job_session(artisan_id)
    now_iso = datetime.now(timezone.utc).isoformat()
    if _use_postgres():
        with psycopg.connect(DATABASE_URL) as conn:
            conn.execute(
                "UPDATE artisans SET name = %s, paypal_email = %s WHERE id = %s",
                (artisan_name.strip(), paypal_email.strip(), artisan_id),
            )
            conn.execute(
                "UPDATE users SET name = %s, paypal_email = %s WHERE linked_artisan_id = %s",
                (artisan_name.strip(), paypal_email.strip(), artisan_id),
            )
            conn.execute(
                "UPDATE job_sessions SET artisan_accepted_offer = TRUE, updated_at = %s WHERE job_id = %s",
                (now_iso, job_id),
            )
            conn.commit()
    else:
        with _sqlite_conn() as conn:
            conn.execute(
                "UPDATE artisans SET name = ?, paypal_email = ? WHERE id = ?",
                (artisan_name.strip(), paypal_email.strip(), artisan_id),
            )
            conn.execute(
                "UPDATE users SET name = ?, paypal_email = ? WHERE linked_artisan_id = ?",
                (artisan_name.strip(), paypal_email.strip(), artisan_id),
            )
            conn.execute(
                "UPDATE job_sessions SET artisan_accepted_offer = 1, updated_at = ? WHERE job_id = ?",
                (now_iso, job_id),
            )
            conn.commit()

    insert_chat_message(
        artisan_id=artisan_id,
        sender="artisan",
        sender_name=artisan_name.strip(),
        text=f"Accepted the Shuks contract and connected PayPal receiver email ({paypal_email.strip()}).",
        attachment_type=None,
    )
    return get_job_state(artisan_id)


def list_chat_messages(artisan_id: str) -> list[dict[str, Any]]:
    job_id = ensure_job_session(artisan_id)

    if _use_postgres():
        with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
            rows = conn.execute(
                "SELECT * FROM chat_messages WHERE job_id = %s ORDER BY created_at ASC",
                (job_id,),
            ).fetchall()
    else:
        with _sqlite_conn() as conn:
            rows = conn.execute(
                "SELECT * FROM chat_messages WHERE job_id = ? ORDER BY created_at ASC",
                (job_id,),
            ).fetchall()

    return [
        {
            "id": r["id"],
            "sender": r["sender"],
            "senderName": r["sender_name"],
            "text": r["text"],
            "attachmentType": r["attachment_type"],
            "createdAtIso": str(r["created_at"]),
        }
        for r in rows
    ]


def reset_job_session(artisan_id: str) -> dict[str, Any]:
    job_id = f"job-{artisan_id}"
    if _use_postgres():
        with psycopg.connect(DATABASE_URL) as conn:
            conn.execute("DELETE FROM chat_messages WHERE job_id = %s", (job_id,))
            conn.execute("DELETE FROM job_sessions WHERE job_id = %s", (job_id,))
            conn.commit()
    else:
        with _sqlite_conn() as conn:
            conn.execute("DELETE FROM chat_messages WHERE job_id = ?", (job_id,))
            conn.execute("DELETE FROM job_sessions WHERE job_id = ?", (job_id,))
            conn.commit()
    return get_job_state(artisan_id)


def insert_chat_message(
    artisan_id: str,
    sender: str,
    sender_name: str,
    text: str,
    attachment_type: str | None = None,
) -> dict[str, Any]:
    job_id = ensure_job_session(artisan_id)
    now_iso = datetime.now(timezone.utc).isoformat()
    msg_id = f"msg-{int(datetime.now(timezone.utc).timestamp() * 1000)}"

    if _use_postgres():
        with psycopg.connect(DATABASE_URL) as conn:
            conn.execute(
                """
                INSERT INTO chat_messages (
                    id, job_id, sender, sender_name, text, attachment_type, created_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (msg_id, job_id, sender, sender_name, text, attachment_type, now_iso),
            )
            conn.commit()
    else:
        with _sqlite_conn() as conn:
            conn.execute(
                """
                INSERT INTO chat_messages (
                    id, job_id, sender, sender_name, text, attachment_type, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (msg_id, job_id, sender, sender_name, text, attachment_type, now_iso),
            )
            conn.commit()

    return {
        "id": msg_id,
        "sender": sender,
        "senderName": sender_name,
        "text": text,
        "attachmentType": attachment_type,
        "createdAtIso": now_iso,
    }


def save_job_checkpoint(
    artisan_id: str,
    lifecycle_state: str,
    transcript: list[dict[str, Any]],
    analysis: dict[str, Any] | None,
    buyer_granted_permission: bool = False,
) -> None:
    artisan = get_artisan(artisan_id)
    job_id = f"job-{artisan_id}"
    now_iso = datetime.now(timezone.utc).isoformat()

    if _use_postgres():
        with psycopg.connect(DATABASE_URL) as conn:
            conn.execute(
                """
                INSERT INTO job_sessions (
                    job_id, artisan_id, title, lifecycle_state,
                    buyer_granted_draft_permission, artisan_accepted_offer,
                    meeting_analysis, updated_at
                ) VALUES (%s, %s, %s, %s, %s, FALSE, %s::jsonb, %s)
                ON CONFLICT (job_id) DO UPDATE SET
                    lifecycle_state = EXCLUDED.lifecycle_state,
                    buyer_granted_draft_permission = EXCLUDED.buyer_granted_draft_permission,
                    meeting_analysis = EXCLUDED.meeting_analysis,
                    updated_at = EXCLUDED.updated_at
                """,
                (
                    job_id,
                    artisan_id,
                    f"{artisan['trade']} — {artisan['neighborhood']}",
                    lifecycle_state,
                    buyer_granted_permission,
                    json.dumps(analysis) if analysis else None,
                    now_iso,
                ),
            )
            conn.commit()
        return

    with _sqlite_conn() as conn:
        conn.execute(
            """
            INSERT INTO job_sessions (
                job_id, artisan_id, title, lifecycle_state,
                buyer_granted_draft_permission, artisan_accepted_offer,
                transcript_json, meeting_analysis_json, updated_at
            ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
            ON CONFLICT(job_id) DO UPDATE SET
                lifecycle_state = excluded.lifecycle_state,
                buyer_granted_draft_permission = excluded.buyer_granted_draft_permission,
                transcript_json = excluded.transcript_json,
                meeting_analysis_json = excluded.meeting_analysis_json,
                updated_at = excluded.updated_at
            """,
            (
                job_id,
                artisan_id,
                f"{artisan['trade']} — {artisan['neighborhood']}",
                lifecycle_state,
                1 if buyer_granted_permission else 0,
                json.dumps(transcript),
                json.dumps(analysis) if analysis else None,
                now_iso,
            ),
        )
        conn.commit()


def record_paypal_ledger_entry(
    job_id: str,
    event_type: str,
    paypal_reference_id: str,
    amount_cents: int,
    milestone_id: str | None = None,
    recipient_paypal_email: str | None = None,
) -> dict[str, Any]:
    now_iso = datetime.now(timezone.utc).isoformat()
    entry_id = f"ledger-{int(datetime.now(timezone.utc).timestamp() * 1000)}"

    if _use_postgres():
        with psycopg.connect(DATABASE_URL) as conn:
            conn.execute(
                """
                INSERT INTO paypal_escrow_ledger (
                    id, job_id, event_type, paypal_reference_id,
                    milestone_id, recipient_paypal_email, amount_cents, currency, created_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, 'USD', %s)
                """,
                (
                    entry_id,
                    job_id,
                    event_type,
                    paypal_reference_id,
                    milestone_id,
                    recipient_paypal_email,
                    int(amount_cents),
                    now_iso,
                ),
            )
            conn.commit()
    else:
        with _sqlite_conn() as conn:
            conn.execute(
                """
                INSERT INTO paypal_escrow_ledger (
                    id, job_id, event_type, paypal_reference_id,
                    milestone_id, recipient_paypal_email, amount_cents, currency, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'USD', ?)
                """,
                (
                    entry_id,
                    job_id,
                    event_type,
                    paypal_reference_id,
                    milestone_id,
                    recipient_paypal_email,
                    int(amount_cents),
                    now_iso,
                ),
            )
            conn.commit()

    return {
        "id": entry_id,
        "jobId": job_id,
        "eventType": event_type,
        "paypalReferenceId": paypal_reference_id,
        "amountCents": int(amount_cents),
        "createdAtIso": now_iso,
    }
