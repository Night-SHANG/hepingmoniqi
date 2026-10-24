"""Serve the prebuilt game at a stable loopback origin and open its browser tab."""
import errno
import functools
import http.client
import http.server
import os
import pathlib
import sys
import threading
import webbrowser

ROOT = pathlib.Path(__file__).resolve().parent
HOST = '127.0.0.1'
PORT = 7770
IDENTITY_PATH = '/__hepingmoniqi_scale_slice__/identity'
APP_ID = 'hepingmoniqi-scale-slice'
IDENTITY_BODY = b'{"app":"hepingmoniqi-scale-slice","launcherProtocol":1}'


class LauncherError(Exception):
    """A startup problem the player can resolve without changing save origin."""


class GameHTTPServer(http.server.ThreadingHTTPServer):
    # POSIX can restart promptly after TIME_WAIT. On Windows, SO_REUSEADDR
    # can permit a second listener on an occupied port, so do not enable it.
    allow_reuse_address = os.name != 'nt'
    allow_reuse_port = False


class GameRequestHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == IDENTITY_PATH:
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(IDENTITY_BODY)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Game-App', APP_ID)
            self.end_headers()
            self.wfile.write(IDENTITY_BODY)
            return
        super().do_GET()


def is_game_service(*, port=PORT, timeout=1.0):
    """Verify the local listener directly, without proxies or redirects."""
    connection = http.client.HTTPConnection(HOST, port, timeout=timeout)
    try:
        connection.request('GET', IDENTITY_PATH, headers={'Connection': 'close'})
        response = connection.getresponse()
        return (
            response.status == 200
            and response.getheader('X-Game-App') == APP_ID
            and response.read(len(IDENTITY_BODY) + 1) == IDENTITY_BODY
        )
    except (OSError, http.client.HTTPException):
        return False
    finally:
        connection.close()


def start_server(*, root=ROOT, port=PORT):
    """Return (new server, URL), or (None, URL) for a verified running game.

    Tests may explicitly request port 0. Normal launches always use PORT and
    never fall back to another origin, preserving the browser's save storage.
    """
    root = pathlib.Path(root)
    web_root = root / 'dist' if (root / 'dist' / 'index.html').is_file() else root
    if not (web_root / 'index.html').is_file() or not (web_root / 'assets').is_dir():
        raise LauncherError(
            'A production build is required. Run npm ci then npm run build, '
            'or use the browser-build ZIP.'
        )
    handler = functools.partial(GameRequestHandler, directory=str(web_root))
    try:
        server = GameHTTPServer((HOST, port), handler)
    except OSError as error:
        if error.errno == errno.EADDRINUSE or getattr(error, 'winerror', None) == 10048:
            if is_game_service(port=port):
                return None, 'http://%s:%d/' % (HOST, port)
            raise LauncherError(
                'Port %d is occupied by another program or an unverified older game server. '
                'Close the old game server window or the application using this port, then try again. '
                'No alternate port was selected, to keep browser saves at the same address.' % port
            ) from error
        raise LauncherError('Could not start the local game server: %s' % error) from error
    return server, 'http://%s:%d/' % (HOST, server.server_port)


def main(*, root=ROOT, port=PORT, browser_open=None):
    browser_open = webbrowser.open if browser_open is None else browser_open
    try:
        server, url = start_server(root=root, port=port)
    except LauncherError as error:
        print(error, file=sys.stderr, flush=True)
        return 1

    if server is None:
        print('The game is already running. Reopening:', url, flush=True)
        browser_open(url)
        return 0

    with server:
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        print('Scale-priority experiment is ready:', url, flush=True)
        print('Keep this window open while playing. Close it to stop the server.', flush=True)
        try:
            browser_open(url)
            while worker.is_alive():
                worker.join(timeout=0.5)
        except KeyboardInterrupt:
            pass
        finally:
            server.shutdown()
            worker.join()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
