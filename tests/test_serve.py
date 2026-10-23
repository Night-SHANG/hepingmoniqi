"""Launcher regressions. Run with: python3 -m unittest discover -s tests -v."""
import contextlib
import errno
import http.client
import http.server
import importlib.util
import io
import pathlib
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[1]


class ImportSafetyTests(unittest.TestCase):
    def test_import_does_not_bind_a_port_or_open_the_browser(self):
        result = subprocess.run(
            [sys.executable, '-c', '''
from unittest import mock
with mock.patch('socketserver.TCPServer.__init__', side_effect=AssertionError('import bound a port')):
    with mock.patch('webbrowser.open', side_effect=AssertionError('import opened a browser')):
        import serve
'''],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=5,
        )
        self.assertEqual(result.returncode, 0, result.stderr)


@contextlib.contextmanager
def running_server(server):
    with server:
        worker = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': 0.01}, daemon=True)
        worker.start()
        try:
            yield server
        finally:
            server.shutdown()
            worker.join(timeout=3)


class LauncherTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('game_launcher', ROOT / 'serve.py')
        self.launcher = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.launcher)
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        (self.root / 'assets').mkdir()
        (self.root / 'index.html').write_text('ready game', encoding='utf-8')

    def fetch(self, port, path='/'):
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=2)
        try:
            connection.request('GET', path)
            response = connection.getresponse()
            return response.status, response.read()
        finally:
            connection.close()

    def test_default_start_requests_the_fixed_loopback_port(self):
        requested = []
        real_server = self.launcher.GameHTTPServer

        def isolated_server(address, handler):
            requested.append(address)
            return real_server((address[0], 0), handler)

        with mock.patch.object(self.launcher, 'GameHTTPServer', side_effect=isolated_server):
            server, url = self.launcher.start_server(root=self.root)
        with server:
            self.assertEqual(requested, [('127.0.0.1', 7769)])
            self.assertEqual(url, 'http://127.0.0.1:%d/' % server.server_port)

    def test_restart_reuses_the_same_origin_and_serves_the_game(self):
        first, first_url = self.launcher.start_server(root=self.root, port=0)
        port = first.server_port
        with running_server(first):
            self.assertEqual(self.fetch(port), (200, b'ready game'))
        second, second_url = self.launcher.start_server(root=self.root, port=port)
        with running_server(second):
            self.assertEqual(second_url, first_url)
            self.assertEqual(self.fetch(port), (200, b'ready game'))

    def test_repeated_launch_reuses_only_a_verified_game_service(self):
        first, first_url = self.launcher.start_server(root=self.root, port=0)
        with running_server(first):
            second, second_url = self.launcher.start_server(root=self.root, port=first.server_port)
            self.assertIsNone(second)
            self.assertEqual(second_url, first_url)
            self.assertTrue(self.launcher.is_game_service(port=first.server_port))

    def test_unrelated_service_is_not_reused_or_opened(self):
        class Unrelated(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'unrelated app')
            def log_message(self, *args):
                pass

        unrelated = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Unrelated)
        opened = []
        errors = io.StringIO()
        with running_server(unrelated), contextlib.redirect_stderr(errors):
            with self.assertRaises(self.launcher.LauncherError):
                self.launcher.start_server(root=self.root, port=unrelated.server_port)
            result = self.launcher.main(root=self.root, port=unrelated.server_port, browser_open=opened.append)
        self.assertEqual(result, 1)
        self.assertEqual(opened, [])
        self.assertIn(str(unrelated.server_port), errors.getvalue())
        self.assertIn('Close', errors.getvalue())

    def test_identity_requires_exact_status_header_and_body(self):
        valid_body = b'{"app":"hepingmoniqi","launcherProtocol":1}'
        cases = [
            (200, 'hepingmoniqi', valid_body, True),
            (200, None, valid_body, False),
            (200, 'other-game', valid_body, False),
            (200, 'hepingmoniqi', b'{"app":"other-game","launcherProtocol":1}', False),
            (200, 'hepingmoniqi', valid_body + b'x' * 2000, False),
            (302, 'hepingmoniqi', valid_body, False),
            (404, 'hepingmoniqi', valid_body, False),
        ]
        for status, identity, body, expected in cases:
            class IdentityResponse(http.server.BaseHTTPRequestHandler):
                def do_GET(self):
                    if self.path != '/__hepingmoniqi__/identity':
                        self.send_error(404)
                        return
                    self.send_response(status)
                    if identity:
                        self.send_header('X-Game-App', identity)
                    self.end_headers()
                    self.wfile.write(body)
                def log_message(self, *args):
                    pass
            with self.subTest(status=status, identity=identity, body=body[:60]):
                server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), IdentityResponse)
                with running_server(server):
                    self.assertEqual(self.launcher.is_game_service(port=server.server_port), expected)

    def test_silent_listener_times_out_without_being_accepted(self):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            listener.listen()
            self.assertFalse(self.launcher.is_game_service(port=listener.getsockname()[1], timeout=0.05))

    def test_non_conflict_bind_error_does_not_probe_or_open_a_browser(self):
        errors = io.StringIO()
        opened = []
        with mock.patch.object(self.launcher, 'GameHTTPServer', side_effect=OSError(errno.EACCES, 'permission denied')):
            with mock.patch.object(self.launcher, 'is_game_service', side_effect=AssertionError('must not probe')):
                with contextlib.redirect_stderr(errors):
                    result = self.launcher.main(root=self.root, port=0, browser_open=opened.append)
        self.assertEqual(result, 1)
        self.assertEqual(opened, [])
        self.assertIn('permission denied', errors.getvalue())

    def test_new_server_opens_browser_and_stops_cleanly(self):
        opened = []
        def browser(url):
            opened.append(url)
            port = int(url.split(':')[2].rstrip('/'))
            self.assertEqual(self.fetch(port), (200, b'ready game'))
            raise KeyboardInterrupt
        with contextlib.redirect_stdout(io.StringIO()):
            result = self.launcher.main(root=self.root, port=0, browser_open=browser)
        self.assertEqual(result, 0)
        self.assertEqual(len(opened), 1)

    def test_reused_server_opens_browser_without_stopping_existing_server(self):
        server, url = self.launcher.start_server(root=self.root, port=0)
        opened = []
        with running_server(server), contextlib.redirect_stdout(io.StringIO()):
            result = self.launcher.main(root=self.root, port=server.server_port, browser_open=opened.append)
            self.assertEqual(self.fetch(server.server_port), (200, b'ready game'))
        self.assertEqual(result, 0)
        self.assertEqual(opened, [url])

    def test_prefers_production_build_when_present(self):
        dist = self.root / 'dist'
        (dist / 'assets').mkdir(parents=True)
        (dist / 'index.html').write_text('production game', encoding='utf-8')
        server, _ = self.launcher.start_server(root=self.root, port=0)
        with running_server(server):
            self.assertEqual(self.fetch(server.server_port), (200, b'production game'))

    def test_missing_build_fails_without_opening_browser(self):
        (self.root / 'assets').rmdir()
        opened = []
        errors = io.StringIO()
        with contextlib.redirect_stderr(errors):
            result = self.launcher.main(root=self.root, port=0, browser_open=opened.append)
        self.assertEqual(result, 1)
        self.assertEqual(opened, [])
        self.assertIn('production build', errors.getvalue())


if __name__ == '__main__':
    unittest.main()
