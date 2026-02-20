import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

const TERMINAL_LINES = [
  { t: 'cmd',  s: '$ clawpay buy "cadbury dairy milk"' },
  { t: 'dim',  s: '  connecting to agent...' },
  { t: 'log',  s: '  ◆  browsing ChocoBazaar.io...' },
  { t: 'log',  s: '  ◆  found: Cadbury Dairy Milk · $4.99' },
  { t: 'log',  s: '  ◆  initiating payment session' },
  { t: 'hi',   s: '  ◆  usdc_amount: 5.249 USDC (incl. 5% buffer)' },
  { t: 'log',  s: '  ◆  submitting approve tx...' },
  { t: 'ok',   s: '  ✓  0x7f3a...b2c9  approved' },
  { t: 'log',  s: '  ◆  depositing to escrow...' },
  { t: 'ok',   s: '  ✓  0xb29c...4af1  confirmed (block #8821043)' },
  { t: 'card', s: '  ┌─ VIRTUAL CARD ISSUED ──────────────┐' },
  { t: 'card', s: '  │  4111  1111  1111  8777              │' },
  { t: 'card', s: '  │  CVV 792  ·  Exp 02/2032  ·  $5.24  │' },
  { t: 'card', s: '  └──────────────────────────────────────┘' },
  { t: 'ok',   s: '  ✓  checkout complete · order #PCL-4A2F9B' },
]

const LINE_DELAYS = { cmd: 900, dim: 300, log: 450, hi: 350, ok: 200, card: 150 }

const STEPS = [
  { icon: '🦀', label: 'Claw calls ClawPay', desc: 'Your agent hits the MCP tool with an amount. No human steps. No approval prompts.' },
  { icon: '🔐', label: 'Escrow on-chain',    desc: 'USDC is deposited into a smart contract. Funds only move when the card is issued - you stay in control.' },
  { icon: '💳', label: 'Card issued',         desc: 'A single-use Lithic virtual card is created with an exact spend limit. Dead after one charge.' },
  { icon: '🌐', label: 'Pays anywhere',       desc: 'Agent uses the card at any website checkout. No merchant opt-in. Unused balance refunded.' },
]

const STACK = [
  { dot: '#28a0f0', label: 'Arbitrum Sepolia' },
  { dot: '#2775ca', label: 'USDC (ERC-20)' },
  { dot: '#6366f1', label: 'Claude MCP'   },
  { dot: '#22c55e', label: 'Lithic Cards' },
  { dot: '#e45735', label: 'FastAPI'      },
  { dot: '#61dafb', label: 'React + Vite' },
  { dot: '#627eea', label: 'Ethers.js'   },
  { dot: '#8b5cf6', label: 'Web3.py'     },
]

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500;600&family=DM+Serif+Display&display=swap');

  .lp { font-family:'Syne',sans-serif; background:#09090f; color:#e8e8f0; min-height:100vh; overflow-x:hidden; position:relative; }

  /* dot grid */
  .lp::before {
    content:''; position:fixed; inset:0; pointer-events:none; z-index:0;
    background-image: radial-gradient(circle, rgba(255,255,255,0.055) 1px, transparent 1px);
    background-size: 30px 30px;
  }

  /* ambient orbs */
  .lp-orb { position:fixed; border-radius:50%; pointer-events:none; z-index:0; filter:blur(80px); }
  .lp-orb-1 { width:700px;height:700px; background:radial-gradient(circle,rgba(201,162,39,.07) 0%,transparent 70%); top:-220px; right:-180px; }
  .lp-orb-2 { width:500px;height:500px; background:radial-gradient(circle,rgba(6,182,212,.055) 0%,transparent 70%); bottom:5%; left:-120px; }

  /* ── Nav ── */
  .lp-nav {
    position:sticky; top:0; z-index:100;
    display:flex; align-items:center; justify-content:space-between;
    padding:0 56px; height:66px;
    background:rgba(9,9,15,.88); backdrop-filter:blur(18px);
    border-bottom:1px solid rgba(255,255,255,.055);
  }
  .lp-logo {
    font-weight:800; font-size:1.25rem; letter-spacing:-.4px;
    background:linear-gradient(135deg,#c9a227,#ffd060); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text;
  }
  .lp-logo em { font-style:normal; -webkit-text-fill-color:#e8e8f0; color:#e8e8f0; }
  .lp-nav-links { display:flex; gap:30px; align-items:center; font-size:.88rem; color:#6c6c88; font-weight:600; }
  .lp-nav-links button, .lp-nav-links a { background:none; border:none; color:inherit; font-family:'Syne',sans-serif; font-size:.88rem; font-weight:600; cursor:pointer; text-decoration:none; transition:color .2s; padding:0; }
  .lp-nav-links button:hover, .lp-nav-links a:hover { color:#e8e8f0; }
  .lp-nav-cta {
    background:linear-gradient(135deg,#c9a227,#e8b830) !important; color:#09090f !important;
    padding:9px 22px !important; border-radius:7px !important; font-weight:700 !important;
    transition:opacity .2s, transform .15s !important;
  }
  .lp-nav-cta:hover { opacity:.9 !important; transform:translateY(-1px) !important; }

  /* ── Hero ── */
  .lp-hero {
    position:relative; z-index:1;
    display:grid; grid-template-columns:1fr 1fr; align-items:center; gap:64px;
    padding:88px 56px; max-width:1220px; margin:0 auto;
    min-height:calc(100vh - 66px);
  }
  .lp-eyebrow {
    font-size:.72rem; font-weight:700; letter-spacing:2.8px; text-transform:uppercase;
    color:#c9a227; margin-bottom:22px; display:flex; align-items:center; gap:12px;
  }
  .lp-eyebrow::before { content:''; display:inline-block; width:22px; height:2px; background:#c9a227; border-radius:2px; }
  .lp-h1 {
    font-family:'DM Serif Display',serif; font-size:clamp(3rem,5.2vw,5rem);
    line-height:1.04; font-weight:400; margin:0 0 26px; letter-spacing:-1.5px; color:#f0f0f8;
  }
  .lp-h1 .grad {
    background:linear-gradient(135deg,#c9a227 0%,#ffd060 45%,#06b6d4 100%);
    -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text;
    animation:gradPulse 5s ease infinite alternate;
  }
  @keyframes gradPulse { from{filter:hue-rotate(0deg)} to{filter:hue-rotate(22deg)} }
  .lp-sub { font-size:1.02rem; line-height:1.75; color:#6868848; margin-bottom:38px; max-width:460px; color:#70708a; }
  .lp-ctas { display:flex; gap:14px; flex-wrap:wrap; }
  .btn-hero-p {
    background:linear-gradient(135deg,#c9a227,#e8b830); color:#09090f;
    border:none; padding:15px 30px; border-radius:9px;
    font-family:'Syne',sans-serif; font-size:.96rem; font-weight:700; cursor:pointer;
    transition:transform .2s,box-shadow .2s; letter-spacing:.2px;
  }
  .btn-hero-p:hover { transform:translateY(-2px); box-shadow:0 10px 28px rgba(201,162,39,.35); }
  .btn-hero-s {
    background:rgba(255,255,255,.05); color:#e8e8f0;
    border:1px solid rgba(255,255,255,.11); padding:15px 30px; border-radius:9px;
    font-family:'Syne',sans-serif; font-size:.96rem; font-weight:600; cursor:pointer;
    text-decoration:none; display:inline-flex; align-items:center; gap:7px;
    transition:background .2s,border-color .2s;
  }
  .btn-hero-s:hover { background:rgba(255,255,255,.09); border-color:rgba(255,255,255,.2); }

  /* ── Terminal ── */
  .lp-terminal {
    background:#0c0c1c; border:1px solid rgba(255,255,255,.08); border-radius:14px;
    box-shadow:0 40px 80px rgba(0,0,0,.55), 0 0 0 1px rgba(201,162,39,.07), inset 0 1px 0 rgba(255,255,255,.04);
    overflow:hidden; font-family:'JetBrains Mono',monospace;
  }
  .term-bar {
    display:flex; align-items:center; gap:8px; padding:12px 16px;
    background:rgba(255,255,255,.025); border-bottom:1px solid rgba(255,255,255,.05);
  }
  .tdot { width:12px; height:12px; border-radius:50%; flex-shrink:0; }
  .tdot-r{background:#ff5f57} .tdot-y{background:#febc2e} .tdot-g{background:#28c840}
  .term-ttl { margin-left:8px; font-size:.7rem; color:#44445a; font-family:'JetBrains Mono',monospace; }
  .term-body {
    padding:20px 22px; min-height:340px; max-height:390px; overflow-y:auto;
    scrollbar-width:none;
  }
  .term-body::-webkit-scrollbar { display:none; }
  .tline { font-size:.77rem; line-height:1.85; white-space:pre; animation:tslide .25s ease; }
  @keyframes tslide { from{opacity:0;transform:translateX(-5px)} to{opacity:1;transform:translateX(0)} }
  .tline.cmd  { color:#f0f0f8; font-weight:600; }
  .tline.dim  { color:#38384e; }
  .tline.log  { color:#7878a0; }
  .tline.hi   { color:#06b6d4; }
  .tline.ok   { color:#4ade80; }
  .tline.card { color:#c9a227; font-weight:500; }
  .tcursor {
    display:inline-block; width:7px; height:13px; background:#c9a227;
    animation:blink .85s step-end infinite; vertical-align:middle; margin-left:2px; border-radius:1px;
  }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }

  /* ── How it works ── */
  .lp-how { position:relative; z-index:1; padding:100px 56px; max-width:1220px; margin:0 auto; }
  .sec-tag {
    font-size:.7rem; font-weight:700; letter-spacing:3px; text-transform:uppercase;
    color:#c9a227; text-align:center; margin-bottom:14px;
  }
  .sec-title {
    font-family:'DM Serif Display',serif; font-size:clamp(1.9rem,3vw,2.8rem);
    text-align:center; margin-bottom:72px; color:#f0f0f8; letter-spacing:-.4px;
  }
  .lp-steps { display:grid; grid-template-columns:repeat(4,1fr); gap:0; position:relative; }
  .lp-steps::before {
    content:''; position:absolute; top:31px; left:12.5%; right:12.5%; height:1px;
    background:linear-gradient(90deg,transparent,rgba(201,162,39,.35),rgba(6,182,212,.35),rgba(201,162,39,.35),transparent);
  }
  .lp-step { text-align:center; padding:0 18px; }
  .step-icon {
    width:62px; height:62px; border-radius:50%; border:1px solid rgba(255,255,255,.09);
    background:rgba(255,255,255,.03); display:flex; align-items:center; justify-content:center;
    font-size:1.55rem; margin:0 auto 20px; position:relative; z-index:1;
    backdrop-filter:blur(8px); transition:border-color .3s,box-shadow .3s;
  }
  .lp-step:hover .step-icon { border-color:rgba(201,162,39,.4); box-shadow:0 0 28px rgba(201,162,39,.14); }
  .step-num {
    position:absolute; top:-5px; right:-4px; width:20px; height:20px; border-radius:50%;
    background:#c9a227; color:#09090f; font-size:.64rem; font-weight:700;
    display:flex; align-items:center; justify-content:center;
  }
  .step-lbl { font-size:.94rem; font-weight:700; color:#e8e8f0; margin-bottom:9px; }
  .step-dsc { font-size:.8rem; color:#52526a; line-height:1.65; }

  /* ── Feature cards ── */
  .lp-cards { position:relative; z-index:1; padding:80px 56px; max-width:1220px; margin:0 auto; }
  .lp-cards-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:18px; }
  .fc {
    background:rgba(255,255,255,.024); border:1px solid rgba(255,255,255,.07); border-radius:16px;
    padding:32px; cursor:pointer; display:block; text-decoration:none; color:inherit;
    transition:background .25s,border-color .25s,transform .25s,box-shadow .25s;
    backdrop-filter:blur(12px); position:relative; overflow:hidden;
  }
  .fc:hover { background:rgba(255,255,255,.042); transform:translateY(-4px); }
  .fc.gold:hover   { border-color:rgba(201,162,39,.38);  box-shadow:0 18px 52px rgba(201,162,39,.12); }
  .fc.cyan:hover   { border-color:rgba(6,182,212,.38);   box-shadow:0 18px 52px rgba(6,182,212,.1); }
  .fc.green:hover  { border-color:rgba(74,222,128,.38);  box-shadow:0 18px 52px rgba(74,222,128,.1); }
  .fc.purple:hover { border-color:rgba(168,85,247,.38);  box-shadow:0 18px 52px rgba(168,85,247,.1); }
  .fc-icon {
    width:52px; height:52px; border-radius:13px; display:flex; align-items:center;
    justify-content:center; font-size:1.5rem; margin-bottom:22px;
  }
  .fc-icon.gold   { background:rgba(201,162,39,.11);  border:1px solid rgba(201,162,39,.18); }
  .fc-icon.cyan   { background:rgba(6,182,212,.1);    border:1px solid rgba(6,182,212,.18); }
  .fc-icon.green  { background:rgba(74,222,128,.1);   border:1px solid rgba(74,222,128,.18); }
  .fc-icon.purple { background:rgba(168,85,247,.1);   border:1px solid rgba(168,85,247,.18); }
  .fc-title { font-size:1.12rem; font-weight:700; color:#f0f0f8; margin-bottom:10px; display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
  .fc-badge {
    font-size:.63rem; font-weight:700; letter-spacing:1px; text-transform:uppercase;
    padding:2px 9px; border-radius:100px; font-family:'JetBrains Mono',monospace;
  }
  .badge-gold   { background:rgba(201,162,39,.14);  color:#c9a227; }
  .badge-cyan   { background:rgba(6,182,212,.12);   color:#06b6d4; }
  .badge-green  { background:rgba(74,222,128,.12);  color:#4ade80; }
  .badge-purple { background:rgba(168,85,247,.12);  color:#a855f7; }
  .fc-desc { font-size:.87rem; color:#52526a; line-height:1.68; margin-bottom:20px; }
  .fc-code {
    background:rgba(0,0,0,.38); border:1px solid rgba(255,255,255,.055); border-radius:8px;
    padding:11px 16px; font-family:'JetBrains Mono',monospace; font-size:.71rem;
    color:#4ade80; margin-bottom:20px;
  }
  .fc-arrow { font-size:.84rem; color:#38385a; font-weight:600; display:inline-flex; align-items:center; gap:5px; transition:color .2s; }
  .fc:hover .fc-arrow { color:#e8e8f0; }

  /* ── Stack ── */
  .lp-stack {
    position:relative; z-index:1;
    border-top:1px solid rgba(255,255,255,.05); border-bottom:1px solid rgba(255,255,255,.05);
    padding:52px 56px; overflow:hidden;
  }
  .lp-stack-inner { max-width:1220px; margin:0 auto; display:flex; align-items:center; gap:36px; flex-wrap:wrap; }
  .stack-lbl { font-size:.7rem; font-weight:700; letter-spacing:2.5px; text-transform:uppercase; color:#38385a; white-space:nowrap; }
  .stack-div { width:1px; height:22px; background:rgba(255,255,255,.07); flex-shrink:0; }
  .stack-pills { display:flex; gap:10px; flex-wrap:wrap; }
  .stack-pill {
    display:flex; align-items:center; gap:8px;
    background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.07); border-radius:100px;
    padding:7px 15px; font-size:.81rem; font-weight:600; color:#7878a0;
    transition:border-color .2s,color .2s;
  }
  .stack-pill:hover { border-color:rgba(255,255,255,.14); color:#e8e8f0; }
  .stack-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }

  /* ── Footer ── */
  .lp-footer {
    position:relative; z-index:1;
    display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px;
    padding:44px 56px; max-width:1220px; margin:0 auto;
  }
  .footer-logo { font-weight:800; font-size:1.05rem; background:linear-gradient(135deg,#c9a227,#ffd060); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
  .footer-note { font-size:.78rem; color:#38385a; }
  .footer-links { display:flex; gap:22px; font-size:.82rem; color:#38385a; }
  .footer-links button, .footer-links a { background:none; border:none; color:inherit; font-family:'Syne',sans-serif; font-size:.82rem; cursor:pointer; text-decoration:none; transition:color .2s; padding:0; }
  .footer-links button:hover, .footer-links a:hover { color:#9090a8; }

  /* ── MCP Modal ── */
  .modal-bg {
    position:fixed; inset:0; background:rgba(0,0,0,.78); backdrop-filter:blur(10px);
    z-index:1000; display:flex; align-items:center; justify-content:center; padding:20px;
    animation:fadein .2s ease;
  }
  @keyframes fadein { from{opacity:0} to{opacity:1} }
  .modal-box {
    background:#0f0f20; border:1px solid rgba(255,255,255,.09); border-radius:20px;
    padding:42px; max-width:600px; width:100%; position:relative;
    box-shadow:0 48px 96px rgba(0,0,0,.55); animation:slideup .28s ease;
    max-height:90vh; overflow-y:auto;
  }
  @keyframes slideup { from{transform:translateY(18px);opacity:0} to{transform:translateY(0);opacity:1} }
  .modal-x {
    position:absolute; top:16px; right:18px;
    background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.08);
    color:#9090a8; width:32px; height:32px; border-radius:8px;
    display:flex; align-items:center; justify-content:center;
    cursor:pointer; font-size:1rem; transition:background .2s; line-height:1;
  }
  .modal-x:hover { background:rgba(255,255,255,.11); }
  .modal-h { font-family:'DM Serif Display',serif; font-size:1.6rem; margin-bottom:8px; color:#f0f0f8; }
  .modal-sub { font-size:.87rem; color:#52526a; line-height:1.65; margin-bottom:30px; }
  .mcp-step { margin-bottom:26px; }
  .mcp-tag { font-size:.7rem; font-weight:700; letter-spacing:2.5px; text-transform:uppercase; color:#c9a227; margin-bottom:9px; }
  .mcp-code {
    background:#090918; border:1px solid rgba(255,255,255,.07); border-radius:10px;
    padding:14px 18px; font-family:'JetBrains Mono',monospace; font-size:.78rem;
    color:#4ade80; line-height:1.75; overflow-x:auto; white-space:pre;
  }
  .mcp-note { font-size:.79rem; color:#52526a; line-height:1.6; margin-top:9px; }
  .mcp-note code { color:#c9a227; font-family:'JetBrains Mono',monospace; font-size:.77rem; }

  /* ── Responsive ── */
  @media(max-width:920px) {
    .lp-nav { padding:0 24px; }
    .lp-hero { grid-template-columns:1fr; padding:56px 24px; min-height:auto; gap:40px; }
    .lp-how, .lp-cards { padding:64px 24px; }
    .lp-steps { grid-template-columns:repeat(2,1fr); gap:44px; }
    .lp-steps::before { display:none; }
    .lp-cards-grid { grid-template-columns:1fr; }
    .lp-stack { padding:36px 24px; }
    .lp-footer { padding:36px 24px; flex-direction:column; align-items:flex-start; }
    .modal-box { padding:28px; }
  }
`

function MCPModal({ onClose }) {
  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <button className="modal-x" onClick={onClose}>×</button>
        <div className="modal-h">Install MCP Server</div>
        <div className="modal-sub">
          Plug ClawPay into your agent (Claude, or any MCP-compatible tool).
          Your agent gets two tools - it handles payments autonomously from there.
          No cards on file. No human approval loops.
        </div>

        <div className="mcp-step">
          <div className="mcp-tag">1 · Clone & install</div>
          <div className="mcp-code">{`git clone https://github.com/adilhusain01/clawpay
cd clawpay/mcp
pip install -r requirements.txt`}</div>
        </div>

        <div className="mcp-step">
          <div className="mcp-tag">2 · Configure .env</div>
          <div className="mcp-code">{`cp .env.example .env
# Fund agent wallet with USDC on Arbitrum Sepolia, then set:
AGENT_PRIVATE_KEY=0x...
CLAWPAY_API_URL=https://clawpay-production.up.railway.app
CLAWPAY_API_KEY=sk_clawpay_dev_...
USDC_CONTRACT_ADDRESS=0x8353fF5b...
ESCROW_CONTRACT_ADDRESS=0x4B4837...`}</div>
        </div>

        <div className="mcp-step">
          <div className="mcp-tag">3 · Add to Claude Desktop</div>
          <div className="mcp-code">{`{
  "mcpServers": {
    "clawpay": {
      "command": "python",
      "args": ["/path/to/clawpay/mcp/server.py"]
    }
  }
}`}</div>
          <div className="mcp-note">
            File: <code>~/Library/Application Support/Claude/claude_desktop_config.json</code>
          </div>
        </div>

        <div className="mcp-step">
          <div className="mcp-tag">4 · Talk to your agent</div>
          <div className="mcp-code" style={{color:'#e8e8f0'}}>{`# Your agent now has payment superpowers:
"Buy me a Cadbury Dairy Milk from ChocoBazaar"

# Claw calls ClawPay autonomously:
#  ◆  deposits USDC into escrow on-chain
#  ◆  receives a single-use virtual card
#  ◆  checks out - no human needed
#  ✓  card is dead after one charge`}</div>
        </div>
      </div>
    </div>
  )
}

export default function Landing() {
  const navigate = useNavigate()
  const onGetCard = () => navigate('/pay')
  const onShop    = () => navigate('/shop')
  const [visibleLines, setVisibleLines] = useState(0)
  const [showMCP, setShowMCP]           = useState(false)
  const termRef                          = useRef(null)

  // Terminal animation
  useEffect(() => {
    if (visibleLines >= TERMINAL_LINES.length) {
      const t = setTimeout(() => setVisibleLines(0), 4500)
      return () => clearTimeout(t)
    }
    const prev = TERMINAL_LINES[visibleLines - 1]
    const delay = visibleLines === 0 ? 700 : (LINE_DELAYS[prev?.t] ?? 400)
    const t = setTimeout(() => setVisibleLines(v => v + 1), delay)
    return () => clearTimeout(t)
  }, [visibleLines])

  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight
  }, [visibleLines])

  // Ensure body allows full width while landing is mounted
  useEffect(() => {
    document.body.classList.add('lp-body')
    return () => document.body.classList.remove('lp-body')
  }, [])

  const scrollToHow = () => document.getElementById('lp-how')?.scrollIntoView({ behavior: 'smooth' })

  return (
    <>
      <style>{CSS}</style>
      <div className="lp">
        <div className="lp-orb lp-orb-1" />
        <div className="lp-orb lp-orb-2" />

        {/* ── Nav ── */}
        <nav className="lp-nav">
          <div className="lp-logo">Pay<em>Claw</em></div>
          <div className="lp-nav-links">
            <button onClick={scrollToHow}>How it works</button>
            <button onClick={onShop}>Demo</button>
            <a href="https://github.com/adilhusain01/clawpay" target="_blank" rel="noreferrer">GitHub</a>
            <button className="lp-nav-cta" onClick={onGetCard}>Launch App</button>
          </div>
        </nav>

        {/* ── Hero ── */}
        <section className="lp-hero">
          <div>
            <div className="lp-eyebrow">Payment infrastructure for AI agents</div>
            <h1 className="lp-h1">
              Claw 🦀 pays.<br />
              <span className="grad">Anywhere.</span><br />
              In crypto.
            </h1>
            <p className="lp-sub">
              Abstract layer between your claw and the web. It deposits USDC, gets a
              single-use virtual card - uses on any site, securely and autonomously
            </p>
            <div className="lp-ctas">
              <button className="btn-hero-p" onClick={onGetCard}>Get a Virtual Card →</button>
              <button className="btn-hero-s" onClick={onShop}>
                🍫 Live demo
              </button>
            </div>
          </div>

          {/* Terminal */}
          <div className="lp-terminal">
            <div className="term-bar">
              <div className="tdot tdot-r" />
              <div className="tdot tdot-y" />
              <div className="tdot tdot-g" />
              <div className="term-ttl">clawpay-agent - zsh</div>
            </div>
            <div className="term-body" ref={termRef}>
              {TERMINAL_LINES.slice(0, visibleLines).map((line, i) => (
                <div key={i} className={`tline ${line.t}`}>{line.s}</div>
              ))}
              {visibleLines <= TERMINAL_LINES.length && <span className="tcursor" />}
            </div>
          </div>
        </section>

        {/* ── How it works ── */}
        <section className="lp-how" id="lp-how">
          <div className="sec-tag">How it works</div>
          <h2 className="sec-title">Plug in. Your agent does the rest.</h2>
          <div className="lp-steps">
            {STEPS.map((s, i) => (
              <div className="lp-step" key={i}>
                <div className="step-icon">
                  {s.icon}
                  <div className="step-num">{i + 1}</div>
                </div>
                <div className="step-lbl">{s.label}</div>
                <div className="step-dsc">{s.desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Feature cards ── */}
        <section className="lp-cards">
          <div className="sec-tag">Get started</div>
          <h2 className="sec-title">Everything you need</h2>
          <div className="lp-cards-grid">

            {/* MCP */}
            <div className="fc gold" onClick={() => setShowMCP(true)} role="button" tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && setShowMCP(true)}>
              <div className="fc-icon gold">⚡</div>
              <div className="fc-title">
                Install MCP Server
                <span className="fc-badge badge-gold">Agents</span>
              </div>
              <div className="fc-desc">
                Give your agent the ability to pay anywhere. Two MCP tools:{' '}
                <span style={{color:'#c9a227',fontFamily:'JetBrains Mono',fontSize:'.82rem'}}>buy_virtual_card</span> and{' '}
                <span style={{color:'#c9a227',fontFamily:'JetBrains Mono',fontSize:'.82rem'}}>check_wallet_balance</span>.
                No human intervention, no card on file.
              </div>
              <div className="fc-code">python mcp/server.py</div>
              <span className="fc-arrow">View setup instructions →</span>
            </div>

            {/* Get card */}
            <div className="fc cyan" onClick={onGetCard} role="button" tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && onGetCard()}>
              <div className="fc-icon cyan">💳</div>
              <div className="fc-title">
                Get a Virtual Card
                <span className="fc-badge badge-cyan">MetaMask</span>
              </div>
              <div className="fc-desc">
                Don't have an agent yet? Pay manually with MetaMask - deposit USDC, get a
                single-use card instantly. Same security guarantees. Unused balance refunded.
              </div>
              <div className="fc-code" style={{color:'#06b6d4'}}>USDC → Escrow → Lithic card → Checkout</div>
              <span className="fc-arrow">Open payment dashboard →</span>
            </div>

            {/* ChocoBazaar */}
            <div className="fc green" onClick={onShop} role="button" tabIndex={0} onKeyDown={e => e.key==='Enter' && onShop()}>
              <div className="fc-icon green">🍫</div>
              <div className="fc-title">
                ChocoBazaar Demo
                <span className="fc-badge badge-green">Live</span>
              </div>
              <div className="fc-desc">
                A full e-commerce demo. Browse, enter shipping details, and checkout with
                your ClawPay virtual card using the real Lithic sandbox payment flow.
              </div>
              <div className="fc-code" style={{color:'#4ade80'}}>clawpay.app/shop - powered by Lithic</div>
              <span className="fc-arrow">Open ChocoBazaar →</span>
            </div>

            {/* GitHub */}
            <a className="fc purple" href="https://github.com/adilhusain01/clawpay" target="_blank" rel="noreferrer">
              <div className="fc-icon purple">📦</div>
              <div className="fc-title">
                View Source
                <span className="fc-badge badge-purple">Open</span>
              </div>
              <div className="fc-desc">
                Full codebase: FastAPI backend, React dashboard, MCP server,
                and Solidity escrow contracts on Arbitrum Sepolia.
              </div>
              <div className="fc-code" style={{color:'#a855f7'}}>git clone github.com/adilhusain01/clawpay</div>
              <span className="fc-arrow">View on GitHub →</span>
            </a>

          </div>
        </section>

        {/* ── Tech stack ── */}
        <section className="lp-stack">
          <div className="lp-stack-inner">
            <span className="stack-lbl">Built with</span>
            <div className="stack-div" />
            <div className="stack-pills">
              {STACK.map((b, i) => (
                <span className="stack-pill" key={i}>
                  <span className="stack-dot" style={{ background: b.dot }} />
                  {b.label}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ── Footer ── */}
        <footer className="lp-footer">
          <div className="footer-logo">ClawPay</div>
          <div className="footer-note">Arbitrum Sepolia · Lithic Sandbox · ETHGlobal Hackathon 2025</div>
          <div className="footer-links">
            <button onClick={() => setShowMCP(true)}>MCP Docs</button>
            <button onClick={onShop}>Demo</button>
            <a href="https://github.com/adilhusain01/clawpay" target="_blank" rel="noreferrer">GitHub</a>
          </div>
        </footer>

        {showMCP && <MCPModal onClose={() => setShowMCP(false)} />}
      </div>
    </>
  )
}
