"""Autoscaling private speech inference for the original Giulia/Mei voice profiles.

Deploy from repository root:
    pip install modal
    modal deploy cloud_voice/modal_app.py

No weights, reference recordings, credentials, or source transcripts are
committed or downloaded at request time. Models reside in a private Modal
Volume; the upstream bearer token resides in a Modal Secret.
"""
from __future__ import annotations

import hmac
import logging
import os
from pathlib import Path

import modal

ROOT = Path(__file__).resolve().parents[1]
APP_NAME = "chapman-kokoro-voices"
ASSET_ROOT = Path("/voice-assets")
CONFIG_PATH = ASSET_ROOT / "config.json"
MAX_BYTES = 8 * 1024 * 1024
MAX_TEXT = 600


def deployment_settings():
    """Budget guardrails are deployment-time settings, not public requests."""
    warm = int(os.environ.get("VOICE_MODAL_MIN_CONTAINERS", "0"))
    maximum = int(os.environ.get("VOICE_MODAL_MAX_CONTAINERS", "5"))
    if not (0 <= warm <= maximum <= 100):
        raise ValueError("Require 0 <= min containers <= max containers <= 100.")
    gpu = os.environ.get("VOICE_MODAL_GPU", "L4").strip()
    return warm, maximum, (None if gpu.lower() in {"", "none", "cpu"} else gpu)


WARM, MAXIMUM, GPU = deployment_settings()
app = modal.App(APP_NAME)
assets = modal.Volume.from_name("chapman-voice-assets", create_if_missing=True)
auth = modal.Secret.from_name("chapman-voice-service", required_keys=["VOICE_BACKEND_TOKEN"])

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install_from_requirements(str(ROOT / "voice-service" / "requirements.txt"))
    .pip_install("fastapi>=0.115,<1")
    .add_local_file(str(ROOT / "voice-service" / "server.py"), "/root/voice_service_server.py")
)


@app.cls(
    image=image,
    cpu=4,
    memory=8192,
    gpu=GPU,
    volumes={str(ASSET_ROOT): assets.with_mount_options(read_only=True)},
    secrets=[auth],
    min_containers=WARM,
    max_containers=MAXIMUM,
    scaledown_window=60,
    timeout=120,
)
@modal.concurrent(max_inputs=1)
class VoiceService:
    @modal.enter()
    def initialize(self):
        # Fail closed if private profiles or weights are not uploaded.
        from voice_service_server import SpeechEngine, load_config

        if not CONFIG_PATH.is_file():
            raise RuntimeError("Private voice config missing on Modal Volume.")
        config = load_config(str(CONFIG_PATH))
        if not config.get("voices"):
            raise RuntimeError("No original Giulia/Mei voice profiles configured.")
        configured_agents = {p.get("agent") for p in config["voices"]}
        if not {"giulia", "mei"}.issubset(configured_agents):
            raise RuntimeError("Original Giulia AND Mei voice profiles must both be configured.")
        if any(p.get("reference") for p in config["voices"]):
            if not config.get("seedVc") or not Path(config["seedVc"]["root"]).is_dir():
                raise RuntimeError("Private reference-conditioned voices need a mounted Seed-VC checkout.")
        for key in ("kokoroModel", "kokoroVoices"):
            if not config.get(key) or not Path(config[key]).is_file():
                raise RuntimeError("Required private Kokoro asset missing.")
        if config.get("whisperModel") and not Path(config["whisperModel"]).exists():
            raise RuntimeError("Configured Whisper model snapshot is missing.")
        for profile in config["voices"]:
            if profile.get("reference") and not Path(profile["reference"]).is_file():
                raise RuntimeError("Configured reference voice recording is missing.")
        # Seed-VC requires its dependencies and model weights in the private volume.
        self.engine = SpeechEngine(config)
        self.engine.load_tts()
        self._token = os.environ.get("VOICE_BACKEND_TOKEN", "")
        if len(self._token) < 24:
            raise RuntimeError("Set a strong VOICE_BACKEND_TOKEN in Modal Secret.")
        self._voices = {p.get("id"): p.get("agent") for p in config["voices"]}

    @modal.asgi_app()
    def web(self):
        from fastapi import FastAPI, HTTPException, Request
        from fastapi.responses import JSONResponse, Response
        import json
        import time

        service = FastAPI(
            title="Chapman private voice inference",
            docs_url=None, redoc_url=None, openapi_url=None,
        )

        def authorize(request: Request):
            received = request.headers.get("authorization", "")
            if not hmac.compare_digest(received.encode(), ("Bearer " + self._token).encode()):
                raise HTTPException(status_code=401, detail="Unauthorized.")

        async def bounded_body(request: Request):
            try:
                declared = int(request.headers.get("content-length", "0"))
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid content length.")
            if declared > MAX_BYTES:
                raise HTTPException(status_code=413, detail="Speech request too large.")
            raw = await request.body()
            if not raw or len(raw) > MAX_BYTES:
                raise HTTPException(status_code=413, detail="Speech request too large.")
            return raw

        @service.get("/v1/status")
        def status(request: Request):
            authorize(request)
            return JSONResponse(self.engine.status(), headers={"Cache-Control": "no-store"})

        @service.post("/v1/tts")
        async def tts(request: Request):
            authorize(request)
            raw = await bounded_body(request)
            try:
                payload = json.loads(raw)
                if not isinstance(payload, dict) or not isinstance(payload.get("text"), str):
                    raise ValueError("Malformed synthesis input.")
                if len(payload["text"]) > MAX_TEXT:
                    raise ValueError("Speech chunks are limited to 600 characters.")
                if payload.get("voice") not in self._voices:
                    raise ValueError("Unknown voice ID.")
                started = time.perf_counter()
                wav, duration, backend = self.engine.synthesize(payload)
                elapsed = (time.perf_counter() - started) * 1000
                return Response(
                    content=wav, media_type="audio/wav",
                    headers={
                        "Cache-Control": "no-store",
                        "X-Content-Type-Options": "nosniff",
                        "X-Generation-Ms": str(round(elapsed, 1)),
                        "X-Audio-Duration-Ms": str(round(duration, 1)),
                        "X-Voice-Backend": str(backend),
                    },
                )
            except (ValueError, TypeError, json.JSONDecodeError):
                raise HTTPException(status_code=400, detail="Invalid speech text, voice, or settings.")
            except Exception as exc:
                logging.error("Kokoro request failure: %s", type(exc).__name__)
                raise HTTPException(status_code=503, detail="Speech inference unavailable; original transcript preserved.")

        @service.post("/v1/stt")
        async def stt(request: Request):
            authorize(request)
            raw = await bounded_body(request)
            language = request.query_params.get("language", "auto")
            if language not in {"auto", "en", "it", "ja"}:
                raise HTTPException(status_code=400, detail="Unsupported recognition language.")
            try:
                started = time.perf_counter()
                result = self.engine.transcribe(raw, language)
                result["latencyMs"] = round((time.perf_counter() - started) * 1000, 1)
                return JSONResponse(result, headers={"Cache-Control": "no-store"})
            except (ValueError, TypeError):
                raise HTTPException(status_code=400, detail="Invalid audio or unsupported format.")
            except Exception as exc:
                logging.error("Whisper request failure: %s", type(exc).__name__)
                raise HTTPException(status_code=503, detail="Speech recognition unavailable; retry without losing text.")

        return service
