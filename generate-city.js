const https = require("https");
const fs = require("fs");
const path = require("path");

const USERNAME = process.env.GITHUB_USERNAME || "lucasdias1707";
const TOKEN = process.env.GITHUB_TOKEN;

// ─── GitHub API ───────────────────────────────────────────────────────────────

function graphql(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const req = https.request(
      {
        hostname: "api.github.com",
        path: "/graphql",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Authorization: `bearer ${TOKEN}`,
          "User-Agent": "commit-city-generator",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function fetchRepos() {
  const query = `{
    user(login: "${USERNAME}") {
      repositories(
        first: 20
        ownerAffiliations: OWNER
        orderBy: { field: PUSHED_AT, direction: DESC }
        isFork: false
        privacy: PUBLIC
      ) {
        nodes {
          name
          defaultBranchRef {
            target {
              ... on Commit {
                history(author: { id: "" }) {
                  totalCount
                }
              }
            }
          }
          stargazerCount
          primaryLanguage { name color }
        }
      }
      contributionsCollection {
        totalCommitContributions
      }
    }
  }`;

  // Fallback query without author filter (works even without id)
  const query2 = `{
    user(login: "${USERNAME}") {
      repositories(
        first: 20
        ownerAffiliations: OWNER
        orderBy: { field: PUSHED_AT, direction: DESC }
        isFork: false
        privacy: PUBLIC
      ) {
        nodes {
          name
          defaultBranchRef {
            target {
              ... on Commit {
                history { totalCount }
              }
            }
          }
          stargazerCount
          primaryLanguage { name color }
        }
      }
    }
  }`;

  let result = await graphql(query2);

  if (result.errors) {
    console.error("GraphQL errors:", JSON.stringify(result.errors));
    process.exit(1);
  }

  const nodes = result.data.user.repositories.nodes;

  return nodes
    .map((r) => ({
      name: r.name,
      commits: r.defaultBranchRef?.target?.history?.totalCount ?? 0,
      stars: r.stargazerCount ?? 0,
      lang: r.primaryLanguage?.name ?? null,
      langColor: r.primaryLanguage?.color ?? null,
    }))
    .filter((r) => r.commits > 0)
    .sort((a, b) => b.commits - a.commits)
    .slice(0, 12); // max 12 buildings
}

// ─── SVG Generator ───────────────────────────────────────────────────────────

function commitLevel(commits) {
  if (commits >= 200) return 4; // skyscraper
  if (commits >= 80)  return 3; // tall
  if (commits >= 30)  return 2; // medium
  if (commits >= 10)  return 1; // small-medium
  return 0;                     // small
}

function buildingHeight(level) {
  return [48, 70, 95, 130, 165][level];
}

function buildingWidth(level) {
  return [36, 44, 52, 62, 72][level];
}

// Window color based on commit intensity
function windowColor(level, alt) {
  const palettes = [
    ["#0e4429", "#006d32"],           // level 0 — dim green
    ["#26a641", "#0e4429"],           // level 1
    ["#39d353", "#26a641"],           // level 2 — bright green
    ["#58a6ff", "#39d353"],           // level 3 — blue + green
    ["#58a6ff", "#f0a848"],           // level 4 — blue + gold (skyscraper)
  ];
  return palettes[level][alt ? 1 : 0];
}

function roofColor(level) {
  return ["#21262d", "#21262d", "#30363d", "#30363d", "#21262d"][level];
}

// Generate window rows for a building
function windows(bx, by, bw, bh, level, id) {
  const ww = level >= 3 ? 10 : 8;
  const wh = level >= 3 ? 8  : 6;
  const gap = level >= 3 ? 14 : 12;
  const padX = 8;
  const padY = 8;
  const cols = Math.floor((bw - padX * 2) / gap);
  const rows = Math.floor((bh - padY * 2 - 18) / (wh + 5));

  let svg = "";
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const wx = bx + padX + c * gap;
      const wy = by + padY + r * (wh + 5);
      const cls = `win-${id}-${(r * cols + c) % 3}`;
      const col = windowColor(level, (r + c) % 2 === 0);
      const op = (0.55 + Math.random() * 0.4).toFixed(2);
      svg += `<rect x="${wx}" y="${wy}" width="${ww}" height="${wh}" rx="1" fill="${col}" opacity="${op}" class="${cls}"/>`;
    }
  }
  return svg;
}

// Entrance door
function entrance(bx, by, bw, bh, level) {
  if (level < 1) return "";
  const dw = level >= 3 ? 32 : 22;
  const dh = level >= 3 ? 18 : 14;
  const dx = bx + Math.floor((bw - dw) / 2);
  const dy = by + bh - dh;
  return `<rect x="${dx}" y="${dy}" width="${dw}" height="${dh}" fill="#0d1117" rx="1"/>
<rect x="${dx + 3}" y="${dy + 2}" width="${Math.floor(dw / 2) - 4}" height="${dh - 3}" fill="${windowColor(level, false)}" opacity="0.12" rx="1"/>
<rect x="${dx + Math.floor(dw / 2) + 1}" y="${dy + 2}" width="${Math.floor(dw / 2) - 4}" height="${dh - 3}" fill="${windowColor(level, true)}" opacity="0.1" rx="1"/>`;
}

// Antenna/spire
function antenna(bx, by, bw, level, idx) {
  if (level < 2) return "";
  const ax = bx + Math.floor(bw / 2);
  const colors = ["#f97316", "#58a6ff", "#f97316", "#39d353", "#f0a848"];
  const col = colors[idx % colors.length];
  const animClass = level >= 4 ? "tower-top" : `sign-${idx % 2}`;
  const aLen = level >= 4 ? 28 : 16;
  return `<rect x="${ax - 1}" y="${by - aLen}" width="3" height="${aLen}" fill="#30363d"/>
<circle cx="${ax}" cy="${by - aLen - 2}" r="${level >= 4 ? 5 : 3.5}" fill="${col}" class="${animClass}" filter="url(#glow-orange)"/>`;
}

// Truncate long repo names
function label(name, maxLen = 12) {
  return name.length > maxLen ? name.slice(0, maxLen - 1) + "…" : name;
}

function generateSVG(repos) {
  const W = 900;
  const H = 340;
  const groundY = 278;
  const BUILDING_COUNT = Math.min(repos.length, 12);

  // Layout: distribute buildings evenly
  const marginX = 30;
  const usableW = W - marginX * 2;
  const slotW = Math.floor(usableW / BUILDING_COUNT);

  // Build CSS keyframes for per-building window blinks
  let cssRules = "";
  for (let i = 0; i < BUILDING_COUNT; i++) {
    const dur = (2.2 + (i * 0.37) % 2.1).toFixed(1);
    const delay0 = 0;
    const delay1 = (0.4 + (i * 0.19) % 0.6).toFixed(1);
    const delay2 = (0.8 + (i * 0.23) % 0.8).toFixed(1);
    const offPct = (30 + (i * 7) % 30);
    const onPct  = offPct + 12;
    cssRules += `
.win-${i}-0 { animation: blink${i}a ${dur}s ease-in-out ${delay0}s infinite; }
.win-${i}-1 { animation: blink${i}a ${dur}s ease-in-out ${delay1}s infinite; }
.win-${i}-2 { animation: blink${i}a ${dur}s ease-in-out ${delay2}s infinite; }
@keyframes blink${i}a {
  0%,100%{opacity:var(--op,0.8)} ${offPct}%{opacity:0.12} ${onPct}%{opacity:0.12}
}`;
  }

  const style = `<style>
    .tower-top { animation: towerGlow 3s ease-in-out infinite; }
    @keyframes towerGlow {
      0%,100%{fill:#f97316;filter:drop-shadow(0 0 6px #f97316)}
      50%{fill:#fbbf24;filter:drop-shadow(0 0 14px #fbbf24)}
    }
    .sign-0 { animation: signB 1.5s ease-in-out infinite; }
    .sign-1 { animation: signB 1.5s ease-in-out infinite 0.75s; }
    @keyframes signB { 0%,100%{opacity:1} 50%{opacity:0.25} }
    .moon { animation: moonP 6s ease-in-out infinite; }
    @keyframes moonP {
      0%,100%{filter:drop-shadow(0 0 8px #e2c97e)}
      50%{filter:drop-shadow(0 0 18px #f0d98a)}
    }
    .car1 { animation: carR 13s linear infinite; }
    .car2 { animation: carL 19s linear infinite 5s; }
    @keyframes carR {
      0%{transform:translateX(-60px);opacity:0} 4%{opacity:1}
      96%{opacity:1} 100%{transform:translateX(960px);opacity:0}
    }
    @keyframes carL {
      0%{transform:translateX(960px) scaleX(-1);opacity:0} 4%{opacity:1}
      96%{opacity:1} 100%{transform:translateX(-60px) scaleX(-1);opacity:0}
    }
    .lamp { animation: lampG 4s ease-in-out infinite; }
    @keyframes lampG { 0%,100%{opacity:0.9} 50%{opacity:1} }
    ${cssRules}
  </style>`;

  const defs = `<defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0d1117"/>
      <stop offset="100%" stop-color="#161b22"/>
    </linearGradient>
    <pattern id="stars" x="0" y="0" width="120" height="120" patternUnits="userSpaceOnUse">
      <circle cx="12" cy="18" r="0.8" fill="#fff" opacity="0.5"/>
      <circle cx="40" cy="9"  r="0.6" fill="#fff" opacity="0.4"/>
      <circle cx="65" cy="28" r="0.7" fill="#58a6ff" opacity="0.5"/>
      <circle cx="85" cy="6"  r="0.5" fill="#fff" opacity="0.3"/>
      <circle cx="95" cy="45" r="0.8" fill="#fff" opacity="0.6"/>
      <circle cx="22" cy="60" r="0.5" fill="#fff" opacity="0.4"/>
      <circle cx="55" cy="75" r="0.6" fill="#58a6ff" opacity="0.4"/>
      <circle cx="78" cy="90" r="0.4" fill="#fff" opacity="0.3"/>
      <circle cx="8"  cy="95" r="0.7" fill="#fff" opacity="0.5"/>
      <circle cx="48" cy="50" r="0.5" fill="#fff" opacity="0.35"/>
      <circle cx="110" cy="30" r="0.6" fill="#58a6ff" opacity="0.45"/>
    </pattern>
    <filter id="glow-orange" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="2.5" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="glow-soft" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="1.5" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    ${style}
  </defs>`;

  // Background
  let body = `<rect width="${W}" height="${H}" fill="url(#sky)"/>
<rect width="${W}" height="220" fill="url(#stars)" opacity="0.85"/>
<circle cx="830" cy="42" r="22" fill="#f0d98a" class="moon"/>
<circle cx="841" cy="35" r="16" fill="#161b22"/>`;

  // Ground & road
  body += `<rect x="0" y="${groundY}" width="${W}" height="${H - groundY}" fill="#161b22"/>
<rect x="0" y="${groundY}" width="${W}" height="16" fill="#1c2128"/>`;
  for (let x = 0; x < W; x += 80) {
    body += `<rect x="${x}" y="${groundY + 6}" width="50" height="3" fill="#30363d" rx="1"/>`;
  }
  body += `<rect x="0" y="${groundY + 16}" width="${W}" height="4" fill="#21262d"/>`;

  // Buildings
  for (let i = 0; i < BUILDING_COUNT; i++) {
    const repo = repos[i];
    const level = commitLevel(repo.commits);
    const bh = buildingHeight(level);
    const bw = buildingWidth(level);
    const slotCenter = marginX + i * slotW + Math.floor(slotW / 2);
    const bx = slotCenter - Math.floor(bw / 2);
    const by = groundY - bh;

    // Face
    body += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="#161b22" rx="1"/>`;
    // Side shadow
    body += `<rect x="${bx + bw}" y="${by + 4}" width="${Math.max(6, Math.floor(bw * 0.12))}" height="${bh - 4}" fill="#0d1117" rx="1"/>`;
    // Roof
    body += `<rect x="${bx - 2}" y="${by - 6}" width="${bw + 4}" height="8" fill="${roofColor(level)}" rx="1"/>`;
    // Antenna
    body += antenna(bx, by - 6, bw, level, i);
    // Windows
    body += windows(bx, by, bw, bh, level, i);
    // Entrance
    body += entrance(bx, by, bw, bh, level);

    // Repo name label
    const lbl = label(repo.name);
    const commitTxt = repo.commits >= 1000 ? `${(repo.commits/1000).toFixed(1)}k` : `${repo.commits}`;
    body += `<text x="${slotCenter}" y="${groundY + 16}" text-anchor="middle" font-family="monospace" font-size="7.5" fill="#8b949e">${lbl}</text>`;
    body += `<text x="${slotCenter}" y="${groundY + 25}" text-anchor="middle" font-family="monospace" font-size="7" fill="#39d353">${commitTxt}c</text>`;
  }

  // Lamp posts between every 3 buildings
  for (let i = 1; i < BUILDING_COUNT; i += 3) {
    const lx = marginX + i * slotW;
    body += `<rect x="${lx}" y="${groundY - 30}" width="2" height="30" fill="#30363d"/>
<rect x="${lx - 8}" y="${groundY - 30}" width="12" height="2" fill="#30363d" rx="1"/>
<circle cx="${lx - 8}" cy="${groundY - 30}" r="4" fill="#fbbf24" opacity="0.9" filter="url(#glow-soft)" class="lamp"/>`;
  }

  // Cars
  body += `<g class="car1">
  <rect x="10" y="${groundY + 2}" width="22" height="10" fill="#da3633" rx="2"/>
  <rect x="14" y="${groundY - 1}" width="14" height="5" fill="#da3633" rx="1" opacity="0.8"/>
  <rect x="15" y="${groundY}" width="12" height="3" fill="#58a6ff" opacity="0.35" rx="1"/>
  <circle cx="14" cy="${groundY + 12}" r="3" fill="#1c2128"/>
  <circle cx="28" cy="${groundY + 12}" r="3" fill="#1c2128"/>
  <rect x="30" y="${groundY + 4}" width="3" height="4" fill="#fbbf24" opacity="0.9" rx="1"/>
</g>
<g class="car2" style="transform-origin:450px ${groundY + 7}px">
  <rect x="440" y="${groundY + 2}" width="20" height="10" fill="#1f6feb" rx="2"/>
  <rect x="443" y="${groundY - 1}" width="14" height="5" fill="#1f6feb" rx="1" opacity="0.8"/>
  <rect x="444" y="${groundY}" width="12" height="3" fill="#58a6ff" opacity="0.3" rx="1"/>
  <circle cx="443" cy="${groundY + 12}" r="3" fill="#1c2128"/>
  <circle cx="457" cy="${groundY + 12}" r="3" fill="#1c2128"/>
  <rect x="438" y="${groundY + 4}" width="3" height="4" fill="#f97316" opacity="0.7" rx="1"/>
</g>`;

  // Legend
  body += `<rect x="4" y="${H - 26}" width="200" height="22" fill="#0d1117" rx="3" opacity="0.85"/>
<text x="10" y="${H - 11}" font-family="monospace" font-size="9" fill="#58a6ff">// commit city — lucasdias1707</text>`;

  body += `<rect x="${W - 186}" y="${H - 26}" width="182" height="22" fill="#0d1117" rx="3" opacity="0.85"/>
<rect x="${W - 181}" y="${H - 21}" width="9" height="9" rx="1" fill="#0e4429"/>
<text x="${W - 169}" y="${H - 13}" font-family="monospace" font-size="8" fill="#8b949e">&lt;10</text>
<rect x="${W - 152}" y="${H - 21}" width="9" height="9" rx="1" fill="#26a641"/>
<text x="${W - 140}" y="${H - 13}" font-family="monospace" font-size="8" fill="#8b949e">10–29</text>
<rect x="${W - 116}" y="${H - 21}" width="9" height="9" rx="1" fill="#39d353"/>
<text x="${W - 104}" y="${H - 13}" font-family="monospace" font-size="8" fill="#8b949e">30–79</text>
<rect x="${W - 80}" y="${H - 21}" width="9" height="9" rx="1" fill="#58a6ff"/>
<text x="${W - 68}" y="${H - 13}" font-family="monospace" font-size="8" fill="#8b949e">80–199</text>
<rect x="${W - 36}" y="${H - 21}" width="9" height="9" rx="1" fill="#f0a848"/>
<text x="${W - 24}" y="${H - 13}" font-family="monospace" font-size="8" fill="#8b949e">200+</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${defs}${body}</svg>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!TOKEN) {
    console.error("❌  GITHUB_TOKEN not set.");
    process.exit(1);
  }

  console.log(`Fetching repos for ${USERNAME}…`);
  const repos = await fetchRepos();
  console.log(`Found ${repos.length} repos:`);
  repos.forEach((r) => console.log(`  ${r.name}: ${r.commits} commits`));

  const svg = generateSVG(repos);
  const outDir = path.join(__dirname, "dist");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  fs.writeFileSync(path.join(outDir, "commit-city.svg"), svg);
  console.log("✅  dist/commit-city.svg generated!");
}

main().catch((e) => { console.error(e); process.exit(1); });
