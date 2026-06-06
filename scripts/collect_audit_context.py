#!/usr/bin/env python3
"""
Optional local helper: generate a sanitized audit context markdown file.
This is a fallback for tools that cannot access a Private Repo directly.
It does not modify repository files unless you choose to save the output.
"""
import os
import re
from pathlib import Path

IGNORE_DIRS = {'.git','node_modules','.next','out','dist','build','.turbo','.vercel','coverage','vendor'}
ALLOW_EXTS = {'.json','.js','.jsx','.ts','.tsx','.mjs','.cjs','.md','.yml','.yaml','.toml','.css','.scss','.html','.gitignore','.example'}
ALLOW_NAMES = {'Dockerfile','Makefile','.gitignore'}
SECRET_PATTERNS = [
    re.compile(r'(?i)(api[_-]?key|token|secret|password|private[_-]?key)\s*[:=]\s*["\']?([^"\'\s]+)'),
    re.compile(r'sk-[A-Za-z0-9_\-]{20,}'),
]

def sanitize(text: str) -> str:
    for pat in SECRET_PATTERNS:
        text = pat.sub(lambda m: m.group(0).split(m.group(2))[0] + '[REDACTED]' if len(m.groups()) >= 2 else '[REDACTED]', text)
    return text

def main() -> None:
    root = Path.cwd()
    out = []
    out.append('# AUDIT CONTEXT\n\n')
    out.append('## FILE TREE\n\n```text\n')
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]
        rel = Path(dirpath).relative_to(root)
        depth = 0 if str(rel) == '.' else len(rel.parts)
        out.append('  '*depth + ('.' if str(rel)=='.' else rel.name) + '/\n')
        for name in sorted(filenames):
            out.append('  '*(depth+1) + name + '\n')
    out.append('```\n\n## FILE CONTENTS\n')
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]
        for name in sorted(filenames):
            path = Path(dirpath) / name
            rel = path.relative_to(root)
            if path.suffix not in ALLOW_EXTS and name not in ALLOW_NAMES:
                continue
            if path.stat().st_size > 120_000:
                continue
            try:
                text = path.read_text(encoding='utf-8', errors='ignore')
            except Exception as e:
                text = f'[READ ERROR: {e}]'
            out.append(f'\n--- FILE: {rel} ---\n')
            out.append(sanitize(text))
            out.append('\n')
    Path('AI_AUDIT_CONTEXT.generated.md').write_text(''.join(out), encoding='utf-8')
    print('Generated AI_AUDIT_CONTEXT.generated.md')

if __name__ == '__main__':
    main()
