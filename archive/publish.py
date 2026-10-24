import os,json,hashlib,urllib.request,urllib.error,pathlib,base64
REPO='Night-SHANG/hepingmoniqi'
TAG='archive-v0.7-user-baseline'
SHA='35608ea460b85bbf9c5cd05897b39d8c93e86d42f5ccbdee953eb37e21330a3f'
NAME='hepingmoniqi-v0.7-browser.zip'
COMMIT=os.environ['GITHUB_SHA']
token=os.environ['GH_TOKEN']
def request(url,method='GET',data=None,ctype='application/json'):
 req=urllib.request.Request(url,data=data,method=method,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','Content-Type':ctype,'X-GitHub-Api-Version':'2022-11-28'})
 try:
  with urllib.request.urlopen(req,timeout=120) as r:return r.read()
 except urllib.error.HTTPError as e:
  print('HTTP_ERROR',method,url,e.code,e.read().decode('utf-8','replace'),flush=True)
  raise
def api(path,method='GET',data=None):
 return json.loads(request('https://api.github.com/repos/'+REPO+path,method,json.dumps(data).encode() if data is not None else None))
assert api('')['private'] is False,'Public repository required'
assert api('/git/ref/heads/archive-v07-original-package')['object']['sha']==COMMIT,'Archive head changed; refusing alternate target'
parts=sorted(pathlib.Path('archive/parts').glob('*.b64'))
data=b''.join(base64.b64decode(p.read_bytes(),validate=True) for p in parts)
assert len(data)==2092276 and hashlib.sha256(data).hexdigest()==SHA,'Original archive mismatch'
releases=api('/releases?per_page=100')
matches=[r for r in releases if r['tag_name']==TAG]
assert len(matches)<=1
if matches: release=matches[0]
else: release=api('/releases','POST',{'tag_name':TAG,'target_commitish':COMMIT,'name':'v0.7 用户指定流畅基准 · 历史归档','draft':True,'prerelease':False,'make_latest':'false','body':'''用户指定保留的历史浏览器基准，不是现行最新版，也不表示本项目继续开发。用户反馈此版本在其设备上运行流畅，不保证所有设备性能。\n\n附件是2026-10-23原交付ZIP，未重建、未修改。\n\n文件：hepingmoniqi-v0.7-browser.zip\n字节：2092276\nSHA256：35608ea460b85bbf9c5cd05897b39d8c93e86d42f5ccbdee953eb37e21330a3f\n\n当时交付记录关联提交：73270278ccbf97e8e1b646e511ea1ac46ea1c263；运行代码记录：a519eabc92ba5f259ba1ccee7b63c08347b34e7b；验证运行：39950134768。本草稿仅将当前归档提交作为附件容器，非历史游戏源码标签。GitHub自动生成的Source code (zip/tar.gz)不是v0.7源码，不可作为v0.7开发基准。请以本页命名的hepingmoniqi-v0.7-browser.zip为用户指定原版基准。\n\n完整解压后，Windows安装Python3并运行START-WINDOWS.bat；切换版本前关闭旧服务窗口。此归档没有设置自动过期，不修改main或删除其他历史。'''})
assert release['tag_name']==TAG and release['draft'] and not release['prerelease']
assert release['target_commitish']==COMMIT,'Existing draft targets a different commit; no overwrite'
assets=[a for a in release['assets'] if a['name']==NAME]
assert len(assets)<=1
if assets: asset=assets[0]
else: asset=json.loads(request(release['upload_url'].split('{')[0]+'?name='+NAME,'POST',data,'application/zip'))
assert asset['size']==len(data)
# Draft assets require authenticated API download, not public URLs.
req=urllib.request.Request('https://api.github.com/repos/'+REPO+'/releases/assets/'+str(asset['id']),headers={'Authorization':'Bearer '+token,'Accept':'application/octet-stream','X-GitHub-Api-Version':'2022-11-28'})
with urllib.request.urlopen(req,timeout=120) as r: downloaded=r.read()
assert hashlib.sha256(downloaded).hexdigest()==SHA,'Uploaded asset mismatch; no overwrite attempted'
try:
 latest=api('/releases/latest')
 assert latest['id']!=release['id'],'Archive unexpectedly marked latest'
except urllib.error.HTTPError as e:
 if e.code!=404:raise
print(json.dumps({'release':release['html_url'],'asset':asset['browser_download_url'],'sha256':SHA,'bytes':len(downloaded),'non_latest':True,'draft':True},ensure_ascii=False))
