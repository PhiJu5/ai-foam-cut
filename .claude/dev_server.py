import http.server, socketserver, os, sys
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
class H(http.server.SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
    def do_GET(self):
        if self.path.split('?')[0] == '/__machine__':
            b = b'{"name":"Testmaschine"}'
            self.send_response(200); self.send_header('Content-Type','application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b); return
        return super().do_GET()
    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0) or 0); self.rfile.read(n)
        self.send_response(204); self.send_header('Content-Length', '0'); self.end_headers()
    def log_message(self, *a): pass
class S(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True; daemon_threads = True
S(('127.0.0.1', int(os.environ.get('PORT') or 8766)), H).serve_forever()
