/** Extension → display name + color, loosely following GitHub linguist colors. */

export interface LanguageInfo {
  name: string
  color: string
}

const LANGUAGES: Record<string, LanguageInfo> = {
  ts: { name: 'TypeScript', color: '#3178c6' },
  tsx: { name: 'TypeScript', color: '#3178c6' },
  js: { name: 'JavaScript', color: '#f1e05a' },
  jsx: { name: 'JavaScript', color: '#f1e05a' },
  mjs: { name: 'JavaScript', color: '#f1e05a' },
  cjs: { name: 'JavaScript', color: '#f1e05a' },
  py: { name: 'Python', color: '#3572a5' },
  rb: { name: 'Ruby', color: '#701516' },
  go: { name: 'Go', color: '#00add8' },
  rs: { name: 'Rust', color: '#dea584' },
  java: { name: 'Java', color: '#b07219' },
  kt: { name: 'Kotlin', color: '#a97bff' },
  swift: { name: 'Swift', color: '#f05138' },
  c: { name: 'C', color: '#555555' },
  h: { name: 'C header', color: '#6e6e6e' },
  cpp: { name: 'C++', color: '#f34b7d' },
  cc: { name: 'C++', color: '#f34b7d' },
  hpp: { name: 'C++ header', color: '#c76b8c' },
  cs: { name: 'C#', color: '#178600' },
  php: { name: 'PHP', color: '#4f5d95' },
  html: { name: 'HTML', color: '#e34c26' },
  css: { name: 'CSS', color: '#563d7c' },
  scss: { name: 'SCSS', color: '#c6538c' },
  less: { name: 'Less', color: '#1d365d' },
  vue: { name: 'Vue', color: '#41b883' },
  svelte: { name: 'Svelte', color: '#ff3e00' },
  json: { name: 'JSON', color: '#8a8a8a' },
  yml: { name: 'YAML', color: '#cb171e' },
  yaml: { name: 'YAML', color: '#cb171e' },
  toml: { name: 'TOML', color: '#9c4221' },
  xml: { name: 'XML', color: '#0060ac' },
  md: { name: 'Markdown', color: '#519aba' },
  txt: { name: 'Text', color: '#7f8899' },
  sh: { name: 'Shell', color: '#89e051' },
  bash: { name: 'Shell', color: '#89e051' },
  ps1: { name: 'PowerShell', color: '#012456' },
  bat: { name: 'Batch', color: '#c1f12e' },
  sql: { name: 'SQL', color: '#e38c00' },
  lua: { name: 'Lua', color: '#000080' },
  dart: { name: 'Dart', color: '#00b4ab' },
  ex: { name: 'Elixir', color: '#6e4a7e' },
  exs: { name: 'Elixir', color: '#6e4a7e' },
  erl: { name: 'Erlang', color: '#b83998' },
  hs: { name: 'Haskell', color: '#5e5086' },
  scala: { name: 'Scala', color: '#c22d40' },
  clj: { name: 'Clojure', color: '#db5855' },
  r: { name: 'R', color: '#198ce7' },
  m: { name: 'Objective-C', color: '#438eff' },
  zig: { name: 'Zig', color: '#ec915c' },
  proto: { name: 'Protobuf', color: '#4a76c6' },
  graphql: { name: 'GraphQL', color: '#e10098' },
  dockerfile: { name: 'Dockerfile', color: '#384d54' },
  tf: { name: 'Terraform', color: '#7b42bc' },
  ipynb: { name: 'Notebook', color: '#da5b0b' },
  svg: { name: 'SVG', color: '#ff9900' },
  png: { name: 'Image', color: '#8e7cc3' },
  jpg: { name: 'Image', color: '#8e7cc3' },
  gif: { name: 'Image', color: '#8e7cc3' },
  ico: { name: 'Image', color: '#8e7cc3' },
  lock: { name: 'Lockfile', color: '#5f6a7d' }
}

/** Deterministic fallback color for unknown extensions. */
function hashColor(key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  const hue = ((h % 360) + 360) % 360
  return `hsl(${hue}, 45%, 55%)`
}

export function languageOf(path: string): LanguageInfo {
  const base = path.split('/').pop() ?? path
  const lower = base.toLowerCase()
  if (lower === 'dockerfile') return LANGUAGES.dockerfile
  const dot = lower.lastIndexOf('.')
  const ext = dot >= 0 ? lower.slice(dot + 1) : ''
  if (ext && LANGUAGES[ext]) return LANGUAGES[ext]
  return { name: ext ? `.${ext}` : base, color: hashColor(ext || lower) }
}
