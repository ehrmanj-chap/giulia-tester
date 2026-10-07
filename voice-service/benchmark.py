"""Reproducible audio audition/latency probe; never used for agent-to-agent handoff.

python voice-service/benchmark.py --config .voice-local/voice.local.json --output .voice-local/benchmarks
The token is read locally and never included in the report.
"""
import argparse
import json
from pathlib import Path
import time
import urllib.request

TEXTS = {
    "en-us": "Let us take a moment. What matters most is how we make people feel welcome.",
    "it": "Buongiorno, sono Giulia. Piacere di conoscerla.",
    "ja": "こんにちは、メイです。よろしくお願いします。",
}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--url", default="http://127.0.0.1:8792")
    parser.add_argument("--roundtrip", action="store_true")
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text(encoding="utf-8-sig"))
    import os
    token = os.environ.get("VOICE_LAB_TOKEN") or config.get("token")
    if not token:
        raise ValueError("Set VOICE_LAB_TOKEN or a private config token.")
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    def request(endpoint, body, content_type):
        return urllib.request.urlopen(urllib.request.Request(args.url.rstrip("/") + endpoint, data=body,
            headers={"Content-Type": content_type, "Authorization": "Bearer " + token}), timeout=240)
    report = []
    for index, voice in enumerate(config["voices"]):
        for language in ("en-us", "it" if voice.get("agent") == "giulia" else "ja"):
            text = TEXTS[language]
            entry = {"voice": voice["id"], "language": language, "text": text, "trial": "cold-or-warm: inspect ordering"}
            try:
                started = time.perf_counter()
                response = request("/v1/tts", json.dumps({"voice": voice["id"], "text": text, "language": language, "speech": {"pace": 1, "seed": 24}}).encode(), "application/json")
                audio = response.read()
                # Generated names only: a configured voice ID never becomes a filesystem path.
                filename = f"voice-{index+1:02d}-{language}.wav"
                (output / filename).write_bytes(audio)
                entry.update(file=filename, clientMs=round((time.perf_counter()-started)*1000, 1),
                             generationMs=float(response.headers["X-Generation-Ms"]), durationMs=float(response.headers["X-Audio-Duration-Ms"]))
                if args.roundtrip:
                    transcription = json.load(request("/v1/stt?language=" + ("en" if language == "en-us" else language), audio, "audio/wav"))
                    entry.update(rawTranscript=transcription["rawTranscript"], sttMs=transcription["latencyMs"])
            except Exception as error:
                entry["error"] = str(error)
            report.append(entry)
            print(json.dumps(entry, ensure_ascii=True), flush=True)
            (output / "benchmark.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

if __name__ == "__main__":
    main()
