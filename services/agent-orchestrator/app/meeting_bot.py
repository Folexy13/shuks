import asyncio
import json
import os
import re
import socket
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
import websockets

SINK_NAME = "shuks_bot_sink"


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _ensure_isolated_bot_sink() -> str:
    try:
        res_sinks = subprocess.run(
            ["pactl", "list", "short", "sinks"],
            capture_output=True,
            text=True,
            timeout=3.0,
        )
        if SINK_NAME not in res_sinks.stdout:
            subprocess.run(
                [
                    "pactl",
                    "load-module",
                    "module-null-sink",
                    f"sink_name={SINK_NAME}",
                    "sink_properties=device.description=ShuksAIMeetingBotSink",
                ],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=3.0,
            )
    except Exception:
        pass
    return f"{SINK_NAME}.monitor"


def normalize_meeting_url(raw_url: str) -> tuple[str, str]:
    url = raw_url.strip()
    lower = url.lower()

    if "zoom.us/j/" in lower:
        match = re.search(r"zoom\.us/j/(\d+)(?:\?pwd=([^&#]+))?", url)
        if match:
            meeting_id = match.group(1)
            pwd = match.group(2)
            wc_url = f"https://app.zoom.us/wc/join/{meeting_id}"
            if pwd:
                wc_url += f"?pwd={pwd}"
            return wc_url, "Zoom"
        return url, "Zoom"

    if "meet.google.com" in lower:
        return url, "Google Meet"
    if "meet.jit.si" in lower:
        return url, "Jitsi Meet"
    if "slack.com" in lower:
        return url, "Slack Huddle"
    if "teams.microsoft.com" in lower or "teams.live.com" in lower:
        return url, "Microsoft Teams"
    return url, "External Meeting"


STEALTH_INIT_JS = r"""
(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    const origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await origGetUserMedia(constraints);
      stream.getAudioTracks().forEach((t) => { t.enabled = false; });
      stream.getVideoTracks().forEach((t) => { t.enabled = false; });
      return stream;
    };
  }
})();
"""

JOIN_AUTOMATION_JS = r"""
(() => {
  const botName = "Shuks AI Mediator";
  const bodyText = (document.body ? document.body.innerText : "") || "";
  const lowerBody = bodyText.toLowerCase();

  if (
    lowerBody.includes("you can't join this video call") ||
    lowerBody.includes("no one can join a meeting unless invited")
  ) {
    return { status: "blocked_by_host_settings", bodySnippet: bodyText.slice(0, 300) };
  }

  const clickable = Array.from(document.querySelectorAll('button, [role="button"]'));

  // Always mute bot microphone and turn off bot camera if currently active
  for (const btn of clickable) {
    if (btn.offsetParent === null) continue;
    const aria = (btn.getAttribute("aria-label") || btn.getAttribute("data-tooltip") || "").toLowerCase();
    if (
      aria.includes("turn off microphone") ||
      aria.includes("turn off camera") ||
      aria.includes("mute microphone") ||
      aria.includes("stop video")
    ) {
      btn.click();
    }
  }

  const hasLeaveBtn = clickable.some((b) => {
    const t = ((b.innerText || "") + " " + (b.getAttribute("aria-label") || "")).toLowerCase();
    return t.includes("leave call") || t.includes("leave meeting") || t.includes("hang up");
  });

  if (hasLeaveBtn) {
    return { status: "in_call", bodySnippet: bodyText.slice(0, 300) };
  }

  if (
    lowerBody.includes("asking to be let in") ||
    lowerBody.includes("someone in the call should let you in") ||
    lowerBody.includes("waiting for the host") ||
    lowerBody.includes("please wait, the meeting host will let you in")
  ) {
    return { status: "knocking", bodySnippet: bodyText.slice(0, 300) };
  }

  const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])'));
  for (const inp of inputs) {
    const label = (
      (inp.getAttribute("aria-label") || "") + " " +
      (inp.getAttribute("placeholder") || "") + " " +
      (inp.name || "") + " " +
      (inp.id || "")
    ).toLowerCase();
    if (
      (label.includes("name") || label.includes("your name") || inputs.length === 1) &&
      inp.offsetParent !== null &&
      inp.value !== botName
    ) {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(inp, botName);
      } else {
        inp.value = botName;
      }
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      inp.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  for (const btn of clickable) {
    if (btn.offsetParent === null) continue;
    const txt = (btn.innerText || btn.getAttribute("aria-label") || "").trim().toLowerCase();
    if (
      txt === "continue without microphone and camera" ||
      txt === "got it" ||
      txt === "dismiss" ||
      txt === "do not use audio"
    ) {
      btn.click();
    }
  }

  for (const btn of clickable) {
    if (btn.offsetParent === null) continue;
    const txt = (btn.innerText || btn.getAttribute("aria-label") || "").trim().toLowerCase();
    if (
      txt === "ask to join" ||
      txt === "join now" ||
      txt === "join meeting" ||
      txt === "join" ||
      txt === "join audio by computer"
    ) {
      btn.click();
      return { clickedJoin: txt, bodySnippet: bodyText.slice(0, 300) };
    }
  }

  return { status: "lobby", bodySnippet: bodyText.slice(0, 300) };
})();
"""


@dataclass
class ActiveMeetingBot:
    artisan_id: str
    meeting_url: str
    platform: str
    debug_port: int
    user_data_dir: str
    audio_path: Path
    monitor_source: str
    chrome_proc: subprocess.Popen[bytes] | None = None
    ffmpeg_proc: subprocess.Popen[bytes] | None = None
    status: str = "launching"
    status_detail: str = "Opening Shuks AI Bot browser & dialing into meeting..."
    entered_call: bool = False
    started_at: float = field(default_factory=time.time)
    preview_image_data_url: str | None = None
    stop_requested: bool = False
    monitor_task: asyncio.Task[None] | None = None


_active_bots: dict[str, ActiveMeetingBot] = {}


def _start_ffmpeg_for_bot(bot: ActiveMeetingBot) -> None:
    if bot.ffmpeg_proc is not None:
        return
    ffmpeg_cmd = [
        "ffmpeg",
        "-y",
        "-f",
        "pulse",
        "-i",
        bot.monitor_source,
        "-ar",
        "16000",
        "-ac",
        "1",
        "-b:a",
        "64k",
        str(bot.audio_path),
    ]
    bot.ffmpeg_proc = subprocess.Popen(
        ffmpeg_cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


async def _cdp_automate_and_monitor(bot: ActiveMeetingBot) -> None:
    ws_url: str | None = None
    for _ in range(25):
        if bot.stop_requested:
            return
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                resp = await client.get(f"http://127.0.0.1:{bot.debug_port}/json")
                if resp.is_success:
                    targets = resp.json()
                    page_target = next(
                        (
                            t
                            for t in targets
                            if t.get("type") == "page"
                            and "webSocketDebuggerUrl" in t
                        ),
                        None,
                    )
                    if page_target:
                        ws_url = page_target["webSocketDebuggerUrl"]
                        break
        except Exception:
            pass
        await asyncio.sleep(0.5)

    if not ws_url:
        bot.status = "error"
        bot.status_detail = "Could not connect CDP controller to bot browser."
        return

    msg_id = 1
    try:
        async with websockets.connect(ws_url, max_size=16 * 1024 * 1024) as ws:
            await ws.send(
                json.dumps(
                    {
                        "id": msg_id,
                        "method": "Page.addScriptToEvaluateOnNewDocument",
                        "params": {"source": STEALTH_INIT_JS},
                    }
                )
            )
            msg_id += 1

            await ws.send(
                json.dumps(
                    {
                        "id": msg_id,
                        "method": "Page.navigate",
                        "params": {"url": bot.meeting_url},
                    }
                )
            )
            msg_id += 1
            await asyncio.sleep(2.5)

            while not bot.stop_requested:
                if bot.chrome_proc and bot.chrome_proc.poll() is not None:
                    bot.status = "ended"
                    bot.status_detail = "Bot browser window was closed."
                    break

                eval_id = msg_id
                msg_id += 1
                await ws.send(
                    json.dumps(
                        {
                            "id": eval_id,
                            "method": "Runtime.evaluate",
                            "params": {
                                "expression": JOIN_AUTOMATION_JS,
                                "returnByValue": True,
                            },
                        }
                    )
                )

                shot_id = msg_id
                msg_id += 1
                await ws.send(
                    json.dumps(
                        {
                            "id": shot_id,
                            "method": "Page.captureScreenshot",
                            "params": {"format": "jpeg", "quality": 55},
                        }
                    )
                )

                got_eval = False
                got_shot = False
                deadline = time.time() + 4.0
                while time.time() < deadline and not (got_eval and got_shot):
                    try:
                        raw_msg = await asyncio.wait_for(ws.recv(), timeout=1.5)
                        data = json.loads(raw_msg)
                        if data.get("id") == eval_id:
                            got_eval = True
                            val = (
                                data.get("result", {})
                                .get("result", {})
                                .get("value")
                            )
                            if isinstance(val, dict):
                                st = val.get("status")
                                clicked = val.get("clickedJoin")
                                if clicked:
                                    bot.status = "knocking"
                                    bot.status_detail = (
                                        f"Bot clicked '{clicked}' as 'Shuks AI Mediator' — "
                                        f"click 'Admit' in your {bot.platform} window!"
                                    )
                                elif st == "knocking":
                                    bot.status = "knocking"
                                    bot.status_detail = (
                                        f"Knocking on {bot.platform} as 'Shuks AI Mediator' — "
                                        "click 'Admit' in your meeting window to let the bot in!"
                                    )
                                elif st == "in_call":
                                    bot.status = "in_call"
                                    bot.entered_call = True
                                    _start_ffmpeg_for_bot(bot)
                                    bot.status_detail = (
                                        f"Admitted inside {bot.platform} — silently recording meeting audio."
                                    )
                                elif st == "blocked_by_host_settings":
                                    bot.status = "blocked_by_host_settings"
                                    bot.status_detail = (
                                        "Google Meet blocked anonymous guest entry. In your Google Meet window, click the "
                                        "Host Controls lock icon (bottom-right) -> set 'Meeting access' to 'Open', OR sign into "
                                        "a Google account in the bot window."
                                    )
                                else:
                                    bot.status = "lobby"
                                    bot.status_detail = (
                                        f"In {bot.platform} pre-join lobby — preparing to knock as 'Shuks AI Mediator'..."
                                    )
                        elif data.get("id") == shot_id:
                            got_shot = True
                            b64_img = data.get("result", {}).get("data")
                            if b64_img:
                                bot.preview_image_data_url = (
                                    f"data:image/jpeg;base64,{b64_img}"
                                )
                    except asyncio.TimeoutError:
                        break

                await asyncio.sleep(2.0)
    except Exception as exc:
        if not bot.stop_requested:
            bot.status_detail = f"Bot session notice: {exc}"


async def dispatch_meeting_bot(artisan_id: str, raw_url: str) -> dict[str, Any]:
    if artisan_id in _active_bots:
        await stop_meeting_bot(artisan_id)

    meeting_url, platform = normalize_meeting_url(raw_url)
    monitor_source = _ensure_isolated_bot_sink()
    debug_port = _find_free_port()

    base_data_dir = Path(__file__).resolve().parent.parent / "data"
    profile_dir = base_data_dir / "bot-chrome-profile"
    profile_dir.mkdir(parents=True, exist_ok=True)

    recordings_dir = base_data_dir / "recordings"
    recordings_dir.mkdir(parents=True, exist_ok=True)
    audio_path = recordings_dir / f"bot-{artisan_id}-{int(time.time())}.mp3"

    env = os.environ.copy()
    env["PULSE_SINK"] = SINK_NAME

    has_display = bool(env.get("DISPLAY") or env.get("WAYLAND_DISPLAY"))

    silence_wav = base_data_dir / "bot_silence.wav"
    card_y4m = base_data_dir / "shuks_bot_card.y4m"
    if not silence_wav.exists():
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "anullsrc=r=16000:cl=mono",
                "-t",
                "5",
                str(silence_wav),
            ],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    if not card_y4m.exists():
        logo_src = (
            base_data_dir.parent.parent
            / "apps"
            / "web"
            / "public"
            / "shuks_logo.jpeg"
        )
        if logo_src.exists():
            subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-loop",
                    "1",
                    "-i",
                    str(logo_src),
                    "-vf",
                    "scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2:color=#F6F5F0,format=yuv420p",
                    "-t",
                    "2",
                    "-r",
                    "15",
                    str(card_y4m),
                ],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

    chrome_cmd = [
        "/usr/bin/google-chrome",
        f"--remote-debugging-port={debug_port}",
        "--remote-allow-origins=*",
        f"--user-data-dir={profile_dir}",
        "--window-size=960,640",
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        f"--use-file-for-fake-audio-capture={silence_wav}",
        f"--use-file-for-fake-video-capture={card_y4m}",
        "--autoplay-policy=no-user-gesture-required",
        "--disable-blink-features=AutomationControlled",
        "--no-first-run",
        "--no-default-browser-check",
    ]
    if not has_display:
        chrome_cmd.append("--headless=new")
    chrome_cmd.append("about:blank")

    chrome_proc = subprocess.Popen(
        chrome_cmd,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    bot = ActiveMeetingBot(
        artisan_id=artisan_id,
        meeting_url=meeting_url,
        platform=platform,
        debug_port=debug_port,
        user_data_dir=str(profile_dir),
        audio_path=audio_path,
        monitor_source=monitor_source,
        chrome_proc=chrome_proc,
        ffmpeg_proc=None,
    )
    bot.monitor_task = asyncio.create_task(_cdp_automate_and_monitor(bot))
    _active_bots[artisan_id] = bot
    return get_meeting_bot_status(artisan_id)


def get_meeting_bot_status(artisan_id: str) -> dict[str, Any]:
    bot = _active_bots.get(artisan_id)
    if not bot:
        return {"active": False}

    elapsed = max(0, int(time.time() - bot.started_at))
    audio_bytes = bot.audio_path.stat().st_size if bot.audio_path.exists() else 0
    return {
        "active": True,
        "artisanId": bot.artisan_id,
        "platform": bot.platform,
        "meetingUrl": bot.meeting_url,
        "status": bot.status,
        "enteredCall": bot.entered_call,
        "statusDetail": bot.status_detail,
        "elapsedSeconds": elapsed,
        "recordedBytes": audio_bytes,
        "previewImageDataUrl": bot.preview_image_data_url,
    }


async def stop_meeting_bot(artisan_id: str) -> tuple[Path | None, bool]:
    bot = _active_bots.pop(artisan_id, None)
    if not bot:
        return None, False

    was_in_call = bot.entered_call
    bot.stop_requested = True
    if bot.monitor_task:
        bot.monitor_task.cancel()

    if bot.ffmpeg_proc and bot.ffmpeg_proc.poll() is None:
        try:
            bot.ffmpeg_proc.terminate()
            bot.ffmpeg_proc.wait(timeout=3.0)
        except Exception:
            bot.ffmpeg_proc.kill()

    if bot.chrome_proc and bot.chrome_proc.poll() is None:
        try:
            bot.chrome_proc.terminate()
            bot.chrome_proc.wait(timeout=3.0)
        except Exception:
            bot.chrome_proc.kill()

    valid_audio = (
        bot.audio_path
        if (was_in_call and bot.audio_path.exists() and bot.audio_path.stat().st_size > 1000)
        else None
    )
    return valid_audio, was_in_call
