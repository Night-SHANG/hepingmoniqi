"""Measure process launch and observed Godot readiness lines, not GPU performance."""
import subprocess,sys,time,threading,json

def run(command, timeout=120):
    begun=time.perf_counter(); rows=[]
    p=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding='utf-8',errors='replace')
    timed_out=[]
    def stop():
        timed_out.append(True);p.kill()
    timer=threading.Timer(timeout,stop);timer.start()
    try:
        for line in p.stdout:
            observed_ms=(time.perf_counter()-begun)*1000
            print(line,end='',flush=True)
            for tag in ['NATIVE_SESSION_READY','NATIVE_STARTUP_PROFILE','NATIVE_STARTUP_DRAW','NATIVE_STARTUP_RESULT']:
                if line.startswith(tag):rows.append({'tag':tag,'observed_since_process_spawn_ms':round(observed_ms,3),'line':line.strip()})
        code=p.wait()
    finally:timer.cancel()
    result={'schema':'native-process-startup/v1','exit':code,'timeout':bool(timed_out),'wall_ms':round((time.perf_counter()-begun)*1000,3),'observations':rows,'boundary':'Observed stdout readiness, not hardware GPU completion. Launcher unpack is separate.'}
    print('NATIVE_PROCESS_STARTUP '+json.dumps(result),flush=True)
    return 124 if timed_out else code

if __name__=='__main__':
    command=sys.argv[1:]
    if command and command[0]=='--':command=command[1:]
    if not command:raise SystemExit('Pass the engine command after --')
    raise SystemExit(run(command))
