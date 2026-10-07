"""Optional local speech gateway. No microphone persistence or model downloads at startup.

Run: python voice-service/server.py --config /path/to/voice.local.json
The text lab has no dependency on this process.
"""
from __future__ import annotations
import argparse
import hmac
import importlib.util
import io
import json
import math
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

LANGUAGES = {"en-us", "en-gb", "it", "ja"}
MAX_BODY = 8 * 1024 * 1024

def validate_tts(body, voices):
    if not isinstance(body, dict):
        raise ValueError("Expected a JSON object.")
    text = body.get("text")
    if not isinstance(text, str) or not text.strip() or len(text) > 600:
        raise ValueError("Each speech chunk must contain 1–600 characters.")
    voice = next((v for v in voices if v["id"] == body.get("voice")), None)
    if voice is None:
        raise ValueError("Unknown voice. Refresh the voice list.")
    language = body.get("language", "en-us")
    if language not in LANGUAGES:
        raise ValueError("Unsupported speech language.")
    spec = body.get("speech") or {}
    if not isinstance(spec, dict):
        raise ValueError("Speech settings must be an object.")
    pace = float(spec.get("pace", 1))
    if not math.isfinite(pace) or not .6 <= pace <= 1.5:
        raise ValueError("Pace must be between 0.6 and 1.5.")
    seed = int(spec.get("seed", 24))
    if not 0 <= seed <= 2147483647:
        raise ValueError("Seed out of range.")
    return text, voice, language, {"pace": pace, "seed": seed}

class SpeechEngine:
    def __init__(self, config):
        self.config = config
        self.kokoro = None
        self.japanese = None
        self.whisper = None
        self.seed_module = None
        self.voices = config.get("voices", [])

    def status(self):
        # Expose labels and capabilities, never local paths, reference filenames, or tokens.
        voices = [{k: v[k] for k in ("id", "label", "agent", "backend", "default") if k in v} for v in self.voices]
        return {"schemaVersion": 1, "ok": True, "voices": voices,
                "tts": {"backend": "kokoro-onnx / optional Seed-VC", "controls": ["pace"], "languages": sorted(LANGUAGES),
                        "streaming": False, "chunked": True, "maxChunkChars": 600},
                "stt": {"backend": "whisper-small", "available": bool(self.config.get("whisperModel")),
                        "languages": ["auto", "en", "it", "ja"], "streaming": False},
                "privacy": {"recordingsPersisted": False, "audioRetention": "request lifetime"}}

    def load_tts(self):
        if self.kokoro is not None:
            return
        import onnxruntime as ort
        from kokoro_onnx import Kokoro
        settings = ort.SessionOptions()
        settings.intra_op_num_threads = int(self.config.get("cpuThreads", 4))
        settings.inter_op_num_threads = 1
        runtime = ort.InferenceSession(self.config["kokoroModel"], sess_options=settings, providers=["CPUExecutionProvider"])
        self.kokoro = Kokoro.from_session(runtime, self.config["kokoroVoices"])

    def synthesize(self, body):
        import numpy as np
        import soundfile as sf
        text, voice, language, speech = validate_tts(body, self.voices)
        self.load_tts()
        styles = voice.get("styles", [{"name": "af_heart", "weight": 1}])
        total = sum(float(item["weight"]) for item in styles)
        if total <= 0:
            raise ValueError("Invalid configured voice weights.")
        style = sum(self.kokoro.get_voice_style(item["name"]) * float(item["weight"]) / total for item in styles)
        # Keep exactly the same style embedding across language spans.
        kwargs = {"voice": style, "speed": speech["pace"], "lang": language}
        if language == "ja":
            if self.japanese is None:
                from misaki.ja import JAG2P
                self.japanese = JAG2P()
            phonemes, _ = self.japanese(text)
            if not phonemes:
                raise ValueError("No Japanese pronunciation could be produced.")
            samples, sample_rate = self.kokoro.create(phonemes, is_phonemes=True, **kwargs)
        else:
            samples, sample_rate = self.kokoro.create(text, **kwargs)
        if voice.get("reference"):
            samples, sample_rate = self.convert(samples, sample_rate, voice["reference"], speech["seed"])
        samples = np.asarray(samples, dtype=np.float32)
        if not len(samples) or not np.isfinite(samples).all():
            raise RuntimeError("Invalid generated audio.")
        samples *= min(1.0, .98 / max(float(np.abs(samples).max()), 1e-8))
        output = io.BytesIO()
        sf.write(output, samples, sample_rate, format="WAV", subtype="PCM_16")
        return output.getvalue(), 1000 * len(samples) / sample_rate, voice.get("backend", "kokoro-onnx")

    def convert(self, samples, sample_rate, reference, seed):
        import argparse as ap
        import numpy as np
        import soundfile as sf
        import torch
        config = self.config["seedVc"]
        root = Path(config["root"]).resolve()
        if self.seed_module is None:
            # The upstream inference loader uses paths relative to its checkout.
            # All gateway config paths have already been made absolute.
            os.chdir(root)
            sys.path.insert(0, str(root))
            os.environ["HF_HUB_OFFLINE"] = "1"
            os.environ["TRANSFORMERS_OFFLINE"] = "1"
            os.environ["TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD"] = "1"
            spec = importlib.util.spec_from_file_location("voice_lab_seed", root / "inference.py")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            original_loader = module.load_models
            cache = {}
            def cached_loader(args):
                if "models" not in cache:
                    cache["models"] = original_loader(args)
                return cache["models"]
            module.load_models = cached_loader
            self.seed_module = module
        torch.set_num_threads(int(self.config.get("cpuThreads", 4)))
        torch.manual_seed(seed)
        np.random.seed(seed)
        with tempfile.TemporaryDirectory(prefix="voice-lab-vc-") as temporary:
            folder = Path(temporary)
            source = folder / "source.wav"
            sf.write(source, samples, sample_rate)
            args = ap.Namespace(source=str(source), target=reference, output=str(folder / "converted"),
                                diffusion_steps=int(config.get("steps", 25)), length_adjust=1.0,
                                inference_cfg_rate=float(config.get("cfg", .7)),
                                f0_condition=bool(config.get("f0Condition", True)),
                                auto_f0_adjust=True, semi_tone_shift=0, checkpoint=None, config=None, fp16=True)
            self.seed_module.main(args)
            result = next((folder / "converted").glob("*.wav"))
            return sf.read(result, dtype="float32")

    def transcribe(self, data, language):
        import numpy as np
        import torch
        if language not in {"auto", "en", "it", "ja"}:
            raise ValueError("Unsupported recognition language.")
        if not self.config.get("whisperModel"):
            raise ValueError("Speech recognition is not configured.")
        # Decode in a bounded subprocess; ffmpeg receives only a generated local file path.
        # Uploaded bytes cannot supply command-line arguments or a network URL.
        with tempfile.TemporaryDirectory(prefix="voice-lab-stt-") as temporary:
            path = Path(temporary) / "input.audio"
            path.write_bytes(data)
            result = subprocess.run([self.config.get("ffmpeg", "ffmpeg"), "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe", "-i", str(path),
                                     "-t", "61", "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1"], capture_output=True, timeout=20, check=True)
            audio = np.frombuffer(result.stdout, dtype="<f4").copy()
        if len(audio) > 60 * 16000:
            raise ValueError("Audio must be at most 60 seconds; split longer clips.")
        if len(audio) < 1600 or not np.isfinite(audio).all():
            raise ValueError("Audio is empty or invalid.")
        if self.whisper is None:
            from transformers import pipeline
            torch.set_num_threads(int(self.config.get("cpuThreads", 4)))
            self.whisper = pipeline("automatic-speech-recognition", model=self.config["whisperModel"], device=-1, torch_dtype=torch.float32)
        options = {"task": "transcribe"}
        if language != "auto":
            options["language"] = {"en": "english", "it": "italian", "ja": "japanese"}[language]
        answer = self.whisper({"raw": audio, "sampling_rate": 16000}, chunk_length_s=25, generate_kwargs=options)
        raw = answer.get("text", "")
        return {"rawTranscript": raw, "text": raw, "normalizedTranscript": " ".join(raw.split()), "backend": "whisper-small", "language": language}

def make_handler(engine, token, origins, lock=None):
    inference_lock = lock or threading.Lock()
    class Handler(BaseHTTPRequestHandler):
        server_version = "VoiceLab/1"
        def log_message(self, *_args):
            pass  # no audio, transcript, token, or local path in access logs

        def respond(self, status, payload, content_type="application/json", extra=None):
            data = json.dumps(payload).encode() if content_type == "application/json" else payload
            self.send_response(status)
            origin = self.headers.get("Origin")
            if origin in origins:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
            self.send_header("Access-Control-Expose-Headers", "X-Generation-Ms, X-Audio-Duration-Ms, X-Voice-Backend")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            for key, value in (extra or {}).items():
                self.send_header(key, str(value))
            self.end_headers()
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass

        def check_origin(self):
            origin = self.headers.get("Origin")
            if origin and origin not in origins:
                self.respond(403, {"error": "This browser origin is not allowed by the voice service."})
                return False
            return True

        def authorized(self):
            if not self.check_origin():
                return False
            if not hmac.compare_digest(self.headers.get("Authorization", ""), f"Bearer {token}"):
                self.respond(401, {"error": "Enter the voice service token in Connections & developer tools."})
                return False
            return True

        def do_OPTIONS(self):
            if self.check_origin():
                self.respond(204, b"", content_type="text/plain")

        def do_GET(self):
            if not self.authorized():
                return
            if self.path != "/v1/status":
                return self.respond(404, {"error": "Unknown voice endpoint."})
            self.respond(200, engine.status())

        def do_POST(self):
            if not self.authorized():
                return
            url = urlsplit(self.path)
            if url.path not in {"/v1/tts", "/v1/stt"}:
                return self.respond(404, {"error": "Unknown voice endpoint."})
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                return self.respond(400, {"error": "Invalid content length."})
            if not 0 < length <= MAX_BODY:
                return self.respond(413, {"error": "Audio must be under 8 MB; speech text under 600 characters per chunk."})
            if not inference_lock.acquire(blocking=False):
                return self.respond(429, {"error": "Voice service is busy. Wait for the current inference, then retry."})
            try:
                self.connection.settimeout(30)
                body = self.rfile.read(length)
                if len(body) != length:
                    raise ValueError("Incomplete request body.")
                started = time.perf_counter()
                if url.path == "/v1/tts":
                    audio, duration, backend = engine.synthesize(json.loads(body))
                    self.respond(200, audio, "audio/wav", {"X-Generation-Ms": round((time.perf_counter() - started) * 1000, 1),
                                                        "X-Audio-Duration-Ms": round(duration, 1), "X-Voice-Backend": backend})
                else:
                    result = engine.transcribe(body, parse_qs(url.query).get("language", ["auto"])[0])
                    result["latencyMs"] = round((time.perf_counter() - started) * 1000, 1)
                    self.respond(200, result)
            except (ValueError, TypeError, UnicodeDecodeError):
                self.respond(400, {"error": "Invalid speech request. Check the voice, language, text length, pace, and audio duration."})
            except Exception as exc:
                # Keep full local diagnostics on the desktop, never in browser responses.
                print(f"Voice inference failed: {type(exc).__name__}", file=sys.stderr, flush=True)
                self.respond(503, {"error": "Speech inference failed. Check local model configuration, then retry; your transcript is preserved."})
            finally:
                inference_lock.release()
    return Handler

def load_config(path):
    path = Path(path).resolve()
    config = json.loads(path.read_text(encoding="utf-8-sig"))
    def resolve(value):
        return str((path.parent / value).resolve())
    for key in ("kokoroModel", "kokoroVoices", "whisperModel"):
        if config.get(key):
            config[key] = resolve(config[key])
    if config.get("seedVc"):
        config["seedVc"]["root"] = resolve(config["seedVc"]["root"])
    for voice in config.get("voices", []):
        if voice.get("reference"):
            voice["reference"] = resolve(voice["reference"])
    return config

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8792)
    args = parser.parse_args()
    config = load_config(args.config)
    token = os.environ.get("VOICE_LAB_TOKEN") or config.get("token") or secrets.token_urlsafe(24)
    origins = config.get("allowedOrigins", ["http://127.0.0.1:8787", "http://localhost:8787"])
    if "*" in origins:
        raise ValueError("Use explicit browser origins, not a wildcard.")
    if args.host not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("This desktop service binds only to loopback. Use an authenticated HTTPS gateway for remote access.")
    if not os.environ.get("VOICE_LAB_TOKEN") and not config.get("token"):
        print(f"Temporary voice service token: {token}", flush=True)
    httpd = ThreadingHTTPServer((args.host, args.port), make_handler(SpeechEngine(config), token, origins))
    print(f"Voice Lab ready at http://{args.host}:{args.port}; models load on first use.", flush=True)
    httpd.serve_forever()

if __name__ == "__main__":
    main()
