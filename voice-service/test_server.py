import importlib.util
import json
from pathlib import Path
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

spec = importlib.util.spec_from_file_location("voice_service", Path(__file__).with_name("server.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class FakeEngine:
    def status(self):
        return {"schemaVersion": 1, "voices": []}
    def synthesize(self, body):
        module.validate_tts(body, [{"id": "test"}])
        return b"RIFFfixture", 1000, "fixture"
    def transcribe(self, data, language):
        return {"rawTranscript": " raw  words ", "text": " raw  words ", "backend": "fixture"}

class GatewayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lock = threading.Lock()
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), module.make_handler(FakeEngine(), "secret", ["http://localhost:8787"], cls.lock))
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
    def request(self, path, body=None, headers=None, method=None):
        req = urllib.request.Request(self.url + path, data=body, headers=headers or {"Authorization": "Bearer secret"}, method=method)
        try:
            return urllib.request.urlopen(req, timeout=2)
        except urllib.error.HTTPError as error:
            return error
    def test_requires_token(self):
        self.assertEqual(self.request("/v1/status", headers={"X-Other": "x"}).code, 401)
    def test_rejects_foreign_origins_even_with_valid_token(self):
        self.assertEqual(self.request("/v1/status", headers={"Origin": "https://evil.example", "Authorization": "Bearer secret"}).code, 403)
    def test_cors_preflight_is_explicit(self):
        response = self.request("/v1/tts", headers={"Origin": "http://localhost:8787"}, method="OPTIONS")
        self.assertEqual(response.code, 204)
        self.assertEqual(response.headers["Access-Control-Allow-Origin"], "http://localhost:8787")
    def test_tts_contract_and_timing_headers(self):
        response = self.request("/v1/tts", json.dumps({"text": "Hello", "voice": "test", "language": "it"}).encode())
        self.assertEqual(response.code, 200)
        self.assertEqual(response.headers["Content-Type"], "audio/wav")
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(response.headers["X-Audio-Duration-Ms"], "1000")
    def test_unknown_voice_and_unbounded_text_are_rejected(self):
        for payload in ({"text": "hello", "voice": "../../secret"}, {"text": "x" * 601, "voice": "test"}, {"text": "ok", "voice": "test", "speech": {"pace": "nan"}}):
            self.assertEqual(self.request("/v1/tts", json.dumps(payload).encode()).code, 400)
    def test_stt_raw_text_is_preserved(self):
        response = self.request("/v1/stt?language=ja", b"audio")
        self.assertEqual(json.load(response)["rawTranscript"], " raw  words ")
    def test_inference_busy_is_retryable(self):
        self.lock.acquire()
        try:
            self.assertEqual(self.request("/v1/stt", b"audio").code, 429)
        finally:
            self.lock.release()
        self.assertEqual(self.request("/v1/stt", b"audio").code, 200)
    def test_status_does_not_expose_configuration(self):
        engine = module.SpeechEngine({"token": "private", "voices": [{"id": "a", "label": "A", "reference": "C:/private/audio.wav", "styles": []}]})
        output = json.dumps(engine.status())
        self.assertNotIn("private", output)
        self.assertNotIn("reference", output)
    def test_unknown_endpoints_and_empty_body(self):
        self.assertEqual(self.request("/unknown").code, 404)
        self.assertEqual(self.request("/v1/tts", b"").code, 413)

if __name__ == "__main__":
    unittest.main()
