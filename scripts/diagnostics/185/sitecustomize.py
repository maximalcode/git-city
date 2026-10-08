"""Temporary #185 tracing for the Python child used by packaged smoke.

The hook records only bounded command labels and timing. It is inert unless
GIT_CITY_185_TRACE is set by the diagnostic workflow's smoke step.
"""

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import time


_run = subprocess.run
_KNOWN_GIT_OPERATIONS = {
    'add',
    'branch',
    'checkout',
    'commit',
    'config',
    'init',
    'rev-parse',
    'status',
    'version',
}
_KNOWN_REHEARSE_OPERATIONS = {'apply', 'merge', 'show', 'version'}
_sequence = 0


def _text(value):
    if isinstance(value, bytes):
        return os.fsdecode(value)
    return os.fspath(value) if isinstance(value, os.PathLike) else str(value)


def _command_label(args):
    if isinstance(args, (str, bytes, os.PathLike)):
        parts = [_text(args)]
    else:
        parts = [_text(part) for part in args]
    if not parts:
        return 'empty'

    executable = Path(parts[0]).name.lower()
    if executable.endswith('.exe'):
        executable = executable[:-4]
    if executable in {'git', 'git-rehearse'}:
        operations = (
            _KNOWN_REHEARSE_OPERATIONS if executable == 'git-rehearse' else _KNOWN_GIT_OPERATIONS
        )
        operation = (
            'version'
            if '--version' in parts[1:]
            else next((part for part in parts[1:] if part in operations), 'other')
        )
        return f'{executable}:{operation}'
    return executable or 'unknown'


def _emit(event):
    trace = os.environ.get('GIT_CITY_185_TRACE')
    if not trace:
        return
    line = json.dumps(event, separators=(',', ':'))
    path = Path(trace)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a', encoding='utf-8') as output:
        output.write(line + '\n')
        output.flush()
    print(f'[DEBUG-185] {line}', file=sys.stderr, flush=True)


def _traced_run(*args, **kwargs):
    global _sequence
    command = _command_label(args[0] if args else kwargs.get('args', []))
    _sequence += 1
    sequence = _sequence
    started = time.time()
    started_clock = time.perf_counter()
    started_at = datetime.fromtimestamp(started, timezone.utc).isoformat()
    _emit({
        'phase': 'start',
        'sequence': sequence,
        'pid': os.getpid(),
        'timestamp': started_at,
        'started_at': started_at,
        'command': command,
    })
    try:
        result = _run(*args, **kwargs)
    except subprocess.TimeoutExpired:
        ended = time.time()
        _emit({
            'phase': 'end',
            'sequence': sequence,
            'pid': os.getpid(),
            'timestamp': datetime.fromtimestamp(ended, timezone.utc).isoformat(),
            'started_at': started_at,
            'ended_at': datetime.fromtimestamp(ended, timezone.utc).isoformat(),
            'duration_ms': round((time.perf_counter() - started_clock) * 1000, 3),
            'command': command,
            'exit_code': None,
            'timed_out': True,
            'error': 'TimeoutExpired',
        })
        raise
    except BaseException as error:
        ended = time.time()
        _emit({
            'phase': 'end',
            'sequence': sequence,
            'pid': os.getpid(),
            'timestamp': datetime.fromtimestamp(ended, timezone.utc).isoformat(),
            'started_at': started_at,
            'ended_at': datetime.fromtimestamp(ended, timezone.utc).isoformat(),
            'duration_ms': round((time.perf_counter() - started_clock) * 1000, 3),
            'command': command,
            'exit_code': None,
            'timed_out': False,
            'error': type(error).__name__,
        })
        raise
    else:
        ended = time.time()
        _emit({
            'phase': 'end',
            'sequence': sequence,
            'pid': os.getpid(),
            'timestamp': datetime.fromtimestamp(ended, timezone.utc).isoformat(),
            'started_at': started_at,
            'ended_at': datetime.fromtimestamp(ended, timezone.utc).isoformat(),
            'duration_ms': round((time.perf_counter() - started_clock) * 1000, 3),
            'command': command,
            'exit_code': result.returncode,
            'timed_out': False,
        })
        return result


subprocess.run = _traced_run
