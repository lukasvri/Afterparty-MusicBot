"""Small, production-safe resource guard for importing and probing CI images."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time
import urllib.request
import uuid

MIB = 1024 * 1024
WORK_MIB = 512
RESERVE_MIB = 512
START_MIB = WORK_MIB + RESERVE_MIB
PROBE_MIB = 256


def available_mib():
    return next(int(line.split()[1]) // 1024 for line in Path('/proc/meminfo').read_text().splitlines()
                if line.startswith('MemAvailable:'))


def ready():
    try:
        with urllib.request.urlopen('http://127.0.0.1:3990/health',timeout=3) as response:
            return response.status == 200 and json.load(response).get('ready') is True
    except Exception:
        return False


def docker(*args, context='default', **kwargs):
    return subprocess.run(['docker','--context',context,*args],check=True,**kwargs)


def captured(*args, context='default'):
    return docker(*args,context=context,capture_output=True,text=True).stdout.strip()


def info(name, context='default'):
    return json.loads(captured('inspect',name,context=context))[0]


def protected(config):
    result = {}
    names = [config.get('container','gutta-krutt-core'), *config.get('protected_containers',[])]
    for name in dict.fromkeys(names):
        item = info(name, context=config.get('docker_context','default'))
        result[name] = [item['Id'],item['Image'],item['State']['StartedAt'],item['RestartCount'],item['State']['Running']]
    compose = Path(config['compose_file'])
    result['compose'] = hashlib.sha256(compose.read_bytes()).hexdigest()
    return result


def save(path, data):
    temporary=path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data,indent=2)+'\n')
    temporary.chmod(0o600)
    temporary.replace(path)


def check_limits(item, cpu):
    config=item['HostConfig']
    if not (config['Memory']==PROBE_MIB*MIB and config['MemorySwap']==PROBE_MIB*MIB and
            config['NanoCpus']==500000000 and config['CpusetCpus']==str(cpu) and
            config['NetworkMode']=='none' and config['ReadonlyRootfs'] is True):
        raise RuntimeError('Runtime probe limits or isolation differ')


def probe(config_path, args):
    config=json.loads(Path(config_path).read_text())
    context=config.get('docker_context','default')
    prefix=['run','--rm','--network','none','--read-only','--cpus=0.5',
            '--memory=256m','--memory-swap=256m','--pids-limit=64','--entrypoint','node']
    if (args[:len(prefix)] != prefix or len(args)!=len(prefix)+4 or
            not re.fullmatch(r'gutta-krutt-core:git-[0-9a-f]{40}',args[len(prefix)]) or
            args[-3:-1]!=['--input-type=module','-e'] or len(args[-1])>20000):
        raise RuntimeError('Only the fixed isolated CI runtime probe is permitted')
    directory=Path(config['directory'])
    if (directory/'aborted').exists() or available_mib()<START_MIB:
        raise RuntimeError('Runtime probe was canceled or lacks headroom')
    name='afterparty-runtime-'+config['run_id']
    options=['--name',name,'--label','afterparty.runtime.run='+config['run_id'],
             '--cpuset-cpus',str(config['cpu']),'--cpu-shares=32','--ulimit','core=0:0',
             '-e','NODE_OPTIONS=--max-old-space-size=128']
    container=captured('create',*options,*args[2:],context=context)
    try:
        check_limits(info(container,context=context),config['cpu'])
        if (directory/'aborted').exists():
            raise RuntimeError('Runtime probe was canceled before starting')
        result=subprocess.run(['docker','--context',context,'start','--attach',container])
        state=info(container,context=context)['State']
        save(directory/'probe.json',{'exit_code':state['ExitCode'],'oom_killed':state['OOMKilled']})
        return result.returncode or int(state['ExitCode'])
    finally:
        if info(container,context=context)['State']['Running']:
            docker('stop','--time=1',container,context=context,stdout=subprocess.DEVNULL)
        docker('rm',container,context=context,stdout=subprocess.DEVNULL)


class RuntimeSession:
    def __init__(self,config):
        self.config=config
        self.context=config.get('docker_context','default')
        self.failed=threading.Event()
        self.finished=threading.Event()
        self.reason=None

    def __enter__(self):
        os.umask(0o077)
        self.root=Path(self.config['state_dir'])/'runtime-checks'
        self.root.mkdir(parents=True,exist_ok=True,mode=0o700)
        self.lock=(self.root/'runner.lock').open('a')
        try:
            fcntl.flock(self.lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            free=available_mib()
            if free<START_MIB:
                raise RuntimeError('Insufficient headroom: '+str(free)+' MiB available; '+str(START_MIB)+' MiB required. Validation was not started')
            if not ready():
                raise RuntimeError('Core is not ready; validation was not started')
            self.before=protected(self.config)
            self.run_id=uuid.uuid4().hex[:12]
            self.directory=self.root/self.run_id
            self.directory.mkdir(mode=0o700)
            self.cpu=max(os.sched_getaffinity(0))
            self.path=self.directory/'probe-config.json'
            save(self.path,{'run_id':self.run_id,'directory':str(self.directory),'cpu':self.cpu,
                            'docker_context':self.context})
            self.minimum=free
            self.guard=threading.Thread(target=self.watch,daemon=True)
            self.guard.start()
            return self
        except BaseException:
            self.lock.close()
            raise

    def wrap(self,args):
        if self.failed.is_set():
            raise RuntimeError('Runtime checks canceled: '+str(self.reason))
        prefix=['docker','--context',self.context]
        if args[:1]==['docker'] and args[:3]!=prefix:
            raise RuntimeError('Only the configured Docker context is permitted')
        if args[:4]==prefix+['run']:
            return [sys.executable,str(Path(__file__).resolve()),'--probe',str(self.path),*args[3:]]
        if args[:3]==prefix:
            if args[3:5]==['image','inspect']:
                return args
            if args[3:5]==['load','--input'] and len(args)==6:
                path=Path(args[5]).resolve()
                cache=(Path(self.config['state_dir'])/'release-cache').resolve()
                if path.is_relative_to(cache) and path.name=='core-image.tar.gz':
                    return args
            raise RuntimeError('Production Docker mutations are forbidden during validation')
        return args

    def owned(self):
        return captured('ps','-q','--filter','label=afterparty.runtime.run='+self.run_id,context=self.context).split()

    def abort(self,reason):
        self.reason=reason
        self.failed.set()
        (self.directory/'aborted').touch(mode=0o600)
        for container in self.owned():
            docker('stop','--time=1',container,context=self.context,stdout=subprocess.DEVNULL)

    def watch(self):
        ticks=0
        while not self.finished.wait(1):
            try:
                self.minimum=min(self.minimum,available_mib())
                if available_mib()<RESERVE_MIB:
                    self.abort('Less than 512 MiB available during runtime checks')
                    return
                for container in self.owned():
                    check_limits(info(container,context=self.context),self.cpu)
                ticks+=1
                if ticks%10==0 and not ready():
                    self.abort('Core health failed during runtime checks')
                    return
            except Exception:
                self.abort('Runtime resource guard failed')
                return

    def __exit__(self,kind,error,traceback):
        self.finished.set()
        self.guard.join(timeout=15)
        try:
            if kind is not None:
                self.abort('Runtime command failed')
            unchanged=protected(self.config)==self.before
            healthy=ready()
            save(self.root/'latest.json',{'completed':kind is None and not self.failed.is_set(),
                 'minimum_available_mib':self.minimum,'protected_services_unchanged':unchanged,
                 'core_ready_after':healthy,'abort_reason':self.reason,
                 'start_mib':START_MIB,'probe_memory_mib':PROBE_MIB,'swap_allowed':False,'cpu_quota':0.5})
            if kind is None and (self.failed.is_set() or not unchanged or not healthy):
                raise RuntimeError('Runtime safety verification failed; no production switch permitted')
        finally:
            self.lock.close()


if __name__=='__main__':
    if sys.argv[1:2]!=['--probe']:
        raise SystemExit(2)
    raise SystemExit(probe(sys.argv[2],sys.argv[3:]))
