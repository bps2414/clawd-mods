// What a shell command does to files that Edit/Write should have done. Pure, so check.ts can run it.

const RULES: [RegExp, string][] = [
  [/(^|[;&|]\s*)sed\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*i/, 'sed -i edita arquivo às cegas: use Edit (Read antes).'],
  [/(^|[;&|]\s*)(cat|tee)\b[^|;&\n]*>{1,2}\s*[^\s&|;]+[^\n]*<<|(^|[;&|]\s*)cat\s*<<[^\n]*>{1,2}\s*[^\s&]/, 'heredoc gravando arquivo: use Write.'],
  [/\btee\s+(-a\s+)?[^\s|;&-][^\n]*<<|<<[^\n]*\|\s*tee\s+(-a\s+)?[^\s|;&-]/, 'heredoc gravando arquivo com tee: use Write.'],
  [/\bpython3?\b[\s\S]*(\.write_text\(|\.write_bytes\(|open\([^)]*,\s*['"][wa]b?\+?['"])/, 'python gravando arquivo: use Edit/Write.'],
  [/\b(Set-Content|Add-Content|Out-File)\b/i, 'PowerShell gravando arquivo: use Write/Edit.'],
]

/** The reason to refuse `command`, or undefined to let it run. `# guard:ok` in the command lets anything through. */
export const verdict = (command: string): string | undefined =>
  /#\s*guard:ok/.test(command) ? undefined : RULES.find(([re]) => re.test(command))?.[1]
