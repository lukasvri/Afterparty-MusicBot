import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ValidationLifecycle(unittest.TestCase):
    def run_case(self, scenario):
        workflow = (ROOT / '.github/workflows/core.yml').read_text()
        step = workflow.split('      - name: Check native release desktop and mobile journeys with synthetic data\n', 1)[1]
        block = step.split('        run: |\n', 1)[1].split('\n      - ', 1)[0]
        script = textwrap.dedent(block)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            script = script.replace('/tmp/afterparty-web-preview.log', str(root / 'preview.log'))
            (root / 'check.sh').write_text(script)
            (root / 'node').write_text(
                '#!/bin/sh\ncase "$1" in *browser-ci.ts) exec "$CI_FIXTURE_ROOT/npm" run test:browser;; esac\nexit 0\n'
            )
            (root / 'npm').write_text(f'#!{sys.executable}\n' + textwrap.dedent('''
                import os,sys,time,signal
                from pathlib import Path
                root=Path(os.environ['CI_FIXTURE_ROOT'])
                kind='preview' if 'start' in sys.argv else 'suite'
                (root/f'{kind}.group').write_text(str(os.getpgrp()))
                def stopped(*_):
                    (root/f'{kind}.stopped').touch()
                    sys.exit(0)
                signal.signal(signal.SIGTERM,stopped)
                scenario=os.environ['CI_SCENARIO']
                if kind=='preview':
                    if scenario=='preview-exit':
                        time.sleep(.3)
                        sys.exit(0)
                    time.sleep(30)
                else:
                    with (root/'calls').open('a') as f:f.write(sys.argv[-1]+'\\n')
                    if scenario in ['preview-exit','cancel']:time.sleep(30)
                    time.sleep(.1)
                    if scenario=='suite-failure' and sys.argv[-1]=='test:browser':sys.exit(7)
            '''))
            for name in ['npm', 'node']:
                (root / name).chmod(0o755)
            env={**os.environ,'PATH':str(root)+os.pathsep+os.environ['PATH'],'CI_FIXTURE_ROOT':str(root),'CI_SCENARIO':scenario}
            start=time.monotonic()
            proc=subprocess.Popen(['bash','-e','-o','pipefail',str(root/'check.sh')],env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
            try:
                if scenario=='cancel':
                    deadline=time.monotonic()+3
                    while not (root/'calls').exists() and time.monotonic()<deadline:
                        time.sleep(.01)
                    self.assertTrue((root/'calls').exists(),'Validation must start before cancellation')
                    proc.send_signal(signal.SIGTERM)
                out,_=proc.communicate(timeout=4)
                stopped=['suite'] if scenario=='preview-exit' else ['preview']
                if scenario=='cancel':
                    stopped.append('suite')
                for kind in stopped:
                    self.assertTrue((root/f'{kind}.stopped').exists(),'Cleanup must signal the remaining child processes')
                calls=(root/'calls').read_text().splitlines() if (root/'calls').exists() else []
                return proc.returncode,time.monotonic()-start,out.decode(),calls
            finally:
                for group in [proc.pid]+[int(p.read_text()) for p in root.glob('*.group')]:
                    try:
                        os.killpg(group,signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                proc.wait(timeout=4)

    def test_success_runs_every_gate(self):
        status,_,out,calls=self.run_case('success')
        self.assertEqual(status,0,out)
        self.assertEqual(calls,['measure:startup','test:browser','test:stack'])

    def test_preview_death_fails_promptly_even_with_zero_exit(self):
        status,elapsed,out,_=self.run_case('preview-exit')
        self.assertNotEqual(status,0,out)
        self.assertLess(elapsed,4)
        self.assertIn('preview exited',out)

    def test_suite_failure_preserves_exit_and_stops_later_gates(self):
        status,_,out,calls=self.run_case('suite-failure')
        self.assertEqual(status,7,out)
        self.assertEqual(calls,['measure:startup','test:browser'])

    def test_cancellation_cleans_up_both_process_trees(self):
        status,_,out,_=self.run_case('cancel')
        self.assertEqual(status,130,out)

if __name__ == '__main__':
    unittest.main()
