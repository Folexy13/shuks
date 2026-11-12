# Shuks

Shuks is an AI meeting mediator and PayPal Escrow orchestration prototype for local physical services. It listens to service calls between a customer ("Buyer") and a local tradesperson ("Artisan"), extracts diarized transcripts and actionable checklists, structures milestone payment plans, holds funds in PayPal Escrow, and verifies proof-of-work photos before releasing payouts.

The web interface (`apps/web`) is built as an **interactive simulation studio** so judges and developers can observe the Buyer, the Artisan, and the Shuks AI Mediator side-by-side on one screen. Unlike traditional escrow systems that are locked inside a single freelance website, Shuks AI is platform-agnostic: it joins external calls (Google Meet, Zoom, Jitsi, or LiveKit) and in production delivers summaries, checklists, and PayPal Escrow approval/withdrawal links directly to both parties via WhatsApp, Email, or shareable contract URLs.

---

## Repository Layout

- `apps/web` — Next.js 15 (TypeScript, Tailwind CSS) frontend, OpenStreetMap directory, workspace UI, LiveKit call stage, and PayPal Checkout / Payouts API routes.
- `services/agent-orchestrator` — FastAPI backend running the AutoGen (`ScribeAgent`, `ContractMediatorAgent`, `ChangeOrderMediator`, `DisputeArbiterAgent`) and LangGraph (`StateGraph`) workflow engine, multimodal Gemini audio/vision analysis, headless Chrome meeting bot, and SQLite / PostgreSQL persistence.
- `infra/postgres/init.sql` — PostgreSQL schema initialization script.
- `docker-compose.yml` — Optional container stack for PostgreSQL 16, Redis 7, LiveKit Server, and the agent orchestrator.

---

## Prerequisites

- **Node.js** 20+ and **npm** 10+
- **Python** 3.11+
- **ffmpeg** installed on `PATH` (used by the backend to normalize `.wav` / `.webm` call recordings before multimodal transcription)
- **Google Gemini API Key** (`GEMINI_API_KEY`) for multimodal audio transcription, AutoGen agent reasoning, and proof-of-work photo inspection
- **PayPal Developer Sandbox Credentials** (`PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` from [developer.paypal.com/dashboard/applications/sandbox](https://developer.paypal.com/dashboard/applications/sandbox))

---

## 1. Local Setup (Fresh Machine)

### Step 1: Clone the repository

```bash
git clone https://github.com/Folexy13/shuks.git
cd shuks
```

### Step 2: Set up the Python Agent Orchestrator (`services/agent-orchestrator`)

```bash
cd services/agent-orchestrator
python3 -m venv .venv
./.venv/bin/pip install --upgrade pip
./.venv/bin/pip install -r requirements.txt
```

Create `services/agent-orchestrator/.env`:

```env
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3.8-flash
# Optional: defaults to local SQLite (services/agent-orchestrator/data/shuks.db) if omitted
# DATABASE_URL=postgresql://shuks:shuks_dev_password@localhost:5432/shuks_db
```

Start the FastAPI backend on port `8000`:

```bash
./.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Verify the backend is healthy:

```bash
curl http://localhost:8000/health
```

### Step 3: Set up the Next.js Web Application (`apps/web`)

Open a second terminal:

```bash
cd apps/web
npm install --legacy-peer-deps
cp .env.example .env.local
```

Edit `apps/web/.env.local` with your credentials:

```env
# Use "test" for the PayPal JS SDK US Sandbox popup, or your US Sandbox Client ID
NEXT_PUBLIC_PAYPAL_CLIENT_ID=test
PAYPAL_CLIENT_ID=your_paypal_sandbox_client_id
PAYPAL_CLIENT_SECRET=your_paypal_sandbox_client_secret
PAYPAL_API_BASE_URL=https://api-m.sandbox.paypal.com

GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3.8-flash

NEXT_PUBLIC_LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret

AGENT_ORCHESTRATOR_URL=http://127.0.0.1:8000
```

Start the Next.js development server (on port `3000`, or port `3005` if `3000` is in use):

```bash
npm run dev
# Or on a custom port:
npx next dev -p 3005
```

---

## 2. How to Test End-to-End with the Included Call Recordings

Two real 2-speaker `.wav` call recordings are included in `apps/web/public/recordings/` (and `services/agent-orchestrator/data/recordings/`):

1. **`conversation.wav` (Fee Mentioned on Call):** A customer and an artisan discuss a job and explicitly agree on a price during the call.
2. **`conversation_2.wav` (No Fee Mentioned on Call):** A customer and an artisan discuss the project requirements, but end the call without mentioning pricing or payment terms.

### Step-by-Step Walkthrough

1. **Create a Client Account:**
   - Open `http://localhost:3000` (or `http://localhost:3005`).
   - Click **Get Started** in the top navigation bar (`/onboarding?role=buyer`).
   - Enter your name, email, neighborhood, and a PayPal email, then click **Complete Client Registration**.
   - Click **Message & Call** on any artisan card (for example, **Marcus Rivera**) to enter `/workspace/art-marcus-plumbing`.

2. **Test Scenario 1 — Fee Mentioned (`conversation.wav`):**
   - In the call bar at the top of the workspace, click **Test Call Recordings (2 Scenarios)**.
   - Press play on the **`conversation.wav (Fee Mentioned)`** audio player to listen to the recording, or click **Send conversation.wav to Shuks AI**.
   - **What happens:**
     - The request returns `202 Accepted` immediately while the backend transcodes the audio via `ffmpeg`, transcribes and diarizes both speakers with Gemini, and runs the AutoGen (`ScribeAgent` + `ContractMediatorAgent`) and LangGraph pipeline in the background.
     - Once complete, the **Diarized Audio Transcript Carved Out by Shuks AI** appears in the right-hand Call Notes panel, and Shuks AI posts a summary in the chat asking if you want to create the milestone payment plan to hold your funds in PayPal Escrow and send the offer to the artisan.
   - Click **Yes, Create Escrow Plan & Send to Marcus Rivera** (or reply in the chat box, e.g., `"Yes, create the plan and send it to Marcus"`).

3. **Test Scenario 2 — No Fee Mentioned (`conversation_2.wav`):**
   - Click **Clear Thread** in the top-right header of the workspace to reset the session.
   - Click **Test Call Recordings (2 Scenarios)** and click **Send conversation_2.wav to Shuks AI**.
   - **What happens:**
     - Shuks AI summarizes what was discussed, detects that **payment was never mentioned on the call** (`paymentMentioned: false`), and asks in chat whether you want help planning a financial budget and milestone structure for the job.
   - Reply in the chat input (for example: `"Yes, help me plan a $140 budget split into $40 on arrival and $100 on completion, and send it to Marcus"`) or click the approval button to generate the milestone plan.

4. **Test Side-by-Side Buyer + Artisan Split View, Proof-of-Work Gate, and PayPal Withdrawal:**
   - In the top-right header of the workspace, click **Split View: Buyer + Artisan**.
   - **Fund Escrow (Buyer Pane):** In the **Buyer Escrow Controls** column, fund the contract using the PayPal Sandbox button. All milestones transition to `LOCKED IN ESCROW`.
   - **Strict Release Gate:** Notice that while a milestone is `LOCKED IN ESCROW`, the Buyer **cannot** release the funds yet (`Waiting for Marcus Rivera to upload Proof-of-Work or confirm completion before release is unlocked`).
   - **Upload Proof-of-Work Photo (Artisan Pane):** In the **Artisan Live View** column, click **Upload Proof Photo** on Milestone 1 and select any image file (or click **Mark Done**).
     - The Artisan's completion note and **uploaded Proof-of-Work photo are posted directly into the shared chat thread** for both parties to inspect.
     - Right below the photo in chat, **Shuks AI Vision Inspector** posts its multimodal verification verdict (`VERIFIED` + confidence percentage + visual findings), and the milestone transitions to `WORK_SUBMITTED`.
   - **Release Milestone Payout (Buyer Pane):** Now that proof has been submitted, the **Release $...** and **Dispute** buttons unlock in the Buyer column. Click **Release $...** on Milestone 1.
   - **Connect PayPal & Withdraw (Artisan Pane):** In the Artisan column's **Artisan PayPal Earnings & Withdrawal** wallet card, click **Log in with PayPal to Connect Payouts** -> click **Fill Test Account** -> click **Log In & Connect PayPal**, then click **Withdraw to PayPal Now** to transfer the released balance and generate a transfer receipt.

5. **Test Shareable Contract Link, Mid-Job Change Orders, and AI Dispute Arbitration:**
   - **Shareable Artisan Contract Link:** Click **Copy Link** (or the external link icon) at the top of the Buyer Escrow panel to open `/contract/art-marcus-plumbing`, where an external artisan can review the checklist, connect their PayPal email, and upload Proof-of-Work photos without navigating the main marketplace.
   - **Mid-Job Change Order:** Click **+ Add Mid-Job Extra Work (Change Order)** in the Escrow panel, describe newly discovered work and an amount, and click **Add Amendment** to have the `ChangeOrderMediator` agent append an Amendment Milestone (`M3`).
   - **AI Dispute Arbitration:** On a submitted milestone, click **Dispute** in the Buyer column, enter the issue description, and click **Run AI Dispute Arbitration** to have the `DisputeArbiterAgent` cross-examine the call transcript and proof-of-work and compute a recommended PayPal split settlement.

---

## 3. Verification Commands

Run TypeScript type-checking and Python syntax checks before committing changes:

```bash
# Frontend typecheck
cd apps/web
npm run typecheck

# Backend syntax check
cd ../../services/agent-orchestrator
./.venv/bin/python -m py_compile app/*.py
```

---

## Notes & Gotchas

- **PayPal Sandbox Country Restrictions:** PayPal Sandbox accounts created with country set to Nigeria (`NG`) are send-only in PayPal's system and cannot hold a USD balance or receive payments (`PAYEE_ACCOUNT_LOCKED_OR_CLOSED`). When creating test Buyer or Business accounts at [developer.paypal.com/dashboard/accounts](https://developer.paypal.com/dashboard/accounts), select **United States (`US`)** as the country so the account is provisioned with a USD wallet balance.
- **Google Meet Autonomous Bot:** The external meeting bot (`services/agent-orchestrator/app/meeting_bot.py`) uses `/usr/bin/google-chrome` and a PipeWire/PulseAudio virtual sink (`pactl`). When dispatching the bot into a Google Meet link, ensure the host admits `"Shuks AI Mediator"` from the Google Meet lobby (or set Google Meet Host Controls -> Meeting access to `Open`).
