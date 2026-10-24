import importlib.util,pathlib,tempfile,threading,urllib.request,unittest
ROOT=pathlib.Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('scale_launcher',ROOT/'scale-launcher/serve.py');app=importlib.util.module_from_spec(spec);spec.loader.exec_module(app)
class LauncherTests(unittest.TestCase):
 def test_isolated_defaults(self):
  self.assertEqual(app.PORT,7770);self.assertEqual(app.APP_ID,'hepingmoniqi-scale-slice')
  self.assertIn('PORT = 7769',(ROOT/'serve.py').read_text())
 def test_real_http_and_safe_reuse(self):
  with tempfile.TemporaryDirectory() as temp:
   root=pathlib.Path(temp);(root/'assets').mkdir();(root/'index.html').write_text('scale slice')
   server,url=app.start_server(root=root,port=0);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
   try:
    self.assertEqual(urllib.request.urlopen(url).read(),b'scale slice')
    self.assertTrue(app.is_game_service(port=server.server_port))
    other,same=app.start_server(root=root,port=server.server_port);self.assertIsNone(other);self.assertEqual(same,url)
   finally:server.shutdown();server.server_close();thread.join()
 def test_build_required(self):
  with tempfile.TemporaryDirectory() as temp:
   with self.assertRaises(app.LauncherError):app.start_server(root=temp,port=0)
if __name__=='__main__':unittest.main()
