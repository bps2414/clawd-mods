// bun check.ts — fails loudly if the guard blocks what it should not, or lets through what it should block
import { verdict } from './guard'

const blocked = [
  "sed -i 's/a/b/' src/app.ts",
  'cd x && sed -E -i "s/a/b/" f.ts',
  "cat > out.ts <<'EOF'\nx\nEOF",
  "cat <<EOF > out.ts\nx\nEOF",
  "tee out.ts <<EOF\nx\nEOF",
  "python - <<'PY'\nfrom pathlib import Path\nPath('a.ts').write_text('x')\nPY",
  `python3 -c "open('a.ts','w').write('x')"`,
  'Set-Content -Path a.ts -Value x',
]
const allowed = [
  "sed -n '10,20p' src/app.ts",
  'git status | sed s/a/b/',
  "python - <<'PY'\nprint(open('a.ts').read())\nPY",
  'cat a.ts > /dev/null',
  "cat <<EOF\nhello\nEOF",
  'echo hi | tee log.txt',
  "sed -i 's/a/b/' f.ts # guard:ok",
  'bun test',
]
for (const c of blocked) if (!verdict(c)) throw new Error(`should block: ${c}`)
for (const c of allowed) if (verdict(c)) throw new Error(`should allow: ${c} -> ${verdict(c)}`)
console.log('guard ok', blocked.length + allowed.length)
