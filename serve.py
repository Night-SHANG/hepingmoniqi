"""Start the prebuilt game over loopback HTTP and open the default browser."""
import functools
import http.server
import pathlib
import socketserver
import threading
import webbrowser

ROOT = pathlib.Path(__file__).resolve().parent
WEB_ROOT = ROOT / 'dist' if (ROOT / 'dist' / 'index.html').is_file() else ROOT
if not (WEB_ROOT / 'assets').is_dir():
    raise SystemExit('A production build is required. Run npm ci then npm run build, or use the browser-build ZIP.')
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(WEB_ROOT))
with socketserver.TCPServer(('127.0.0.1', 0), handler) as server:
    url = f'http://127.0.0.1:{server.server_address[1]}/'
    print('Cottage experiment is ready:', url, flush=True)
    print('Keep this window open while playing. Close it to stop the server.', flush=True)
    threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
