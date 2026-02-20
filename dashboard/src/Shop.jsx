import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

const BACKEND_URL = import.meta.env.DEV ? 'http://localhost:8000' : 'https://payclaw-production-bad6.up.railway.app'
const API_KEY     = 'sk_payclaw_dev_b03352ef1d68164c675023b82538ea3d1d1902f69bc408b7'
const UNIT_PRICE  = 4.99

const sleep = ms => new Promise(r => setTimeout(r, ms))

const formatPan    = v => v.replace(/\D/g, '').slice(0,16).replace(/(.{4})/g,'$1 ').trim()
const formatExpiry = v => { const d = v.replace(/\D/g,'').slice(0,4); return d.length > 2 ? d.slice(0,2)+'/'+d.slice(2) : d }

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,400&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=JetBrains+Mono:wght@400;500&display=swap');

  .shop { min-height:100vh; background:#080604; color:#f0ebe5; font-family:'DM Sans',sans-serif; position:relative; }

  .shop::before {
    content:''; position:fixed; inset:0; pointer-events:none; z-index:0;
    background-image:radial-gradient(circle,rgba(200,150,62,.045) 1px,transparent 1px);
    background-size:28px 28px;
  }
  .shop::after {
    content:''; position:fixed; pointer-events:none; z-index:0;
    width:700px; height:700px; border-radius:50%; filter:blur(70px);
    background:radial-gradient(circle,rgba(200,150,62,.07) 0%,transparent 70%);
    top:-220px; right:-200px;
  }

  /* Nav */
  .sh-nav {
    position:sticky; top:0; z-index:100;
    display:flex; align-items:center; justify-content:space-between;
    padding:0 52px; height:66px;
    background:rgba(8,6,4,.94); backdrop-filter:blur(20px);
    border-bottom:1px solid rgba(255,255,255,.07);
  }
  .sh-back {
    background:none; border:1px solid rgba(255,255,255,.08); color:rgba(255,255,255,.4);
    padding:7px 14px; border-radius:7px; cursor:pointer; font-family:'DM Sans',sans-serif;
    font-size:.81rem; font-weight:500; transition:border-color .2s,color .2s;
    display:flex; align-items:center; gap:6px;
  }
  .sh-back:hover { border-color:rgba(200,150,62,.35); color:#c8963e; }
  .sh-logo {
    font-family:'Cormorant Garamond',serif; font-size:1.5rem; font-weight:600;
    background:linear-gradient(135deg,#c8963e,#e8b860);
    -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text;
  }
  .sh-logo em { font-style:normal; -webkit-text-fill-color:#f0ebe5; color:#f0ebe5; }
  .sh-nav-links { display:flex; gap:28px; font-size:.85rem; color:#6b5a48; font-weight:500; }

  /* Breadcrumb */
  .sh-crumb {
    position:relative; z-index:1; padding:10px 52px;
    font-size:.76rem; color:#6b5a48;
    border-bottom:1px solid rgba(255,255,255,.07); background:#0d0a06;
  }
  .sh-crumb span { color:#c8963e; }

  /* Product layout */
  .sh-product {
    position:relative; z-index:1;
    max-width:1140px; margin:52px auto;
    padding:0 24px;
    display:grid; grid-template-columns:1fr 1fr; gap:68px; align-items:start;
  }

  /* Image box */
  .sh-img-box {
    background:rgba(255,255,255,.035);
    border:1px solid rgba(255,255,255,.07); border-radius:22px;
    padding:52px 40px; text-align:center;
    position:sticky; top:82px;
    backdrop-filter:blur(12px);
    box-shadow:0 32px 80px rgba(0,0,0,.35),0 0 0 1px rgba(200,150,62,.06);
  }
  .sh-badge {
    display:inline-block;
    background:linear-gradient(135deg,#c8963e,#e8b860);
    color:#080604; font-size:.65rem; font-weight:700;
    letter-spacing:1.8px; text-transform:uppercase;
    padding:4px 14px; border-radius:100px; margin-bottom:12px;
  }
  .sh-emoji {
    font-size:8.5rem; line-height:1; display:block; margin-bottom:20px;
    filter:drop-shadow(0 20px 40px rgba(200,150,62,.3));
    animation:shFloat 4.5s ease-in-out infinite;
  }
  @keyframes shFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-12px)} }
  .sh-thumbs { display:flex; justify-content:center; gap:10px; margin-top:4px; }
  .sh-thumb {
    width:54px; height:54px; border-radius:10px;
    background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.07);
    cursor:pointer; font-size:1.75rem;
    display:flex; align-items:center; justify-content:center;
    transition:border-color .2s,background .2s,transform .2s;
  }
  .sh-thumb.active, .sh-thumb:hover {
    border-color:#c8963e; background:rgba(200,150,62,.09); transform:scale(1.08);
  }

  /* Product info */
  .sh-brand { font-size:.7rem; font-weight:600; color:#c8963e; letter-spacing:2.5px; text-transform:uppercase; margin-bottom:12px; }
  .sh-title { font-family:'Cormorant Garamond',serif; font-size:3.2rem; font-weight:300; line-height:1.08; margin-bottom:14px; letter-spacing:-.5px; }
  .sh-stars { color:#e8b860; font-size:1rem; margin-bottom:4px; }
  .sh-reviews { font-size:.78rem; color:#6b5a48; margin-bottom:26px; }

  .sh-price-row { display:flex; align-items:baseline; gap:12px; margin-bottom:8px; }
  .sh-price {
    font-family:'Cormorant Garamond',serif; font-size:3.2rem; font-weight:600;
    background:linear-gradient(135deg,#c8963e,#e8b860);
    -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text;
  }
  .sh-price-old { font-size:1.1rem; color:#6b5a48; text-decoration:line-through; }
  .sh-save { font-size:.76rem; padding:2px 10px; border-radius:5px; font-weight:600; background:rgba(200,150,62,.1); border:1px solid rgba(200,150,62,.2); color:#c8963e; }

  .sh-stock {
    font-size:.78rem; color:#4ade80; margin-bottom:22px;
    display:flex; align-items:center; gap:7px;
  }
  .sh-stock-dot { width:7px; height:7px; border-radius:50%; background:#4ade80; animation:shPulse 2s ease-in-out infinite; }
  @keyframes shPulse { 0%,100%{opacity:1} 50%{opacity:.35} }

  .sh-divider { height:1px; background:rgba(255,255,255,.07); margin:24px 0; }
  .sh-desc { font-size:.92rem; color:#6b5a48; line-height:1.78; margin-bottom:24px; }
  .sh-meta { display:flex; gap:22px; margin-bottom:24px; flex-wrap:wrap; }
  .sh-meta-item { font-size:.8rem; color:#6b5a48; }
  .sh-meta-item strong { display:block; color:#f0ebe5; font-size:.9rem; font-weight:600; margin-bottom:2px; }

  /* Qty */
  .sh-qty-label { font-size:.7rem; font-weight:600; color:#6b5a48; letter-spacing:1.5px; text-transform:uppercase; margin-bottom:10px; }
  .sh-qty-row { display:flex; align-items:center; margin-bottom:28px; width:fit-content; }
  .sh-qty-btn {
    width:40px; height:40px;
    background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.08);
    color:#f0ebe5; font-size:1.2rem; cursor:pointer;
    border-radius:10px 0 0 10px; flex-shrink:0;
    transition:background .2s,border-color .2s; font-family:inherit;
  }
  .sh-qty-btn:last-child { border-radius:0 10px 10px 0; }
  .sh-qty-btn:hover { background:rgba(200,150,62,.1); border-color:rgba(200,150,62,.3); }
  .sh-qty-val {
    width:50px; height:40px; text-align:center;
    background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08);
    border-left:none; border-right:none;
    color:#f0ebe5; font-size:.95rem; font-weight:600; font-family:'DM Sans',sans-serif;
  }

  /* Buttons */
  .sh-btn-buy {
    width:100%; padding:17px;
    background:linear-gradient(135deg,#c8963e,#e8b860);
    color:#080604; border:none; border-radius:12px;
    font-family:'DM Sans',sans-serif; font-size:1rem; font-weight:600; cursor:pointer;
    transition:opacity .2s,transform .15s; margin-bottom:12px;
    display:flex; align-items:center; justify-content:center; gap:8px;
  }
  .sh-btn-buy:hover { opacity:.9; transform:translateY(-1px); }
  .sh-btn-cart {
    width:100%; padding:15px;
    background:rgba(255,255,255,.04); color:#f0ebe5;
    border:1px solid rgba(255,255,255,.08); border-radius:12px;
    font-family:'DM Sans',sans-serif; font-size:1rem; font-weight:500; cursor:pointer;
    transition:background .2s,border-color .2s;
  }
  .sh-btn-cart:hover { background:rgba(255,255,255,.07); border-color:rgba(255,255,255,.12); }
  .sh-trust { display:flex; gap:10px; margin-top:20px; flex-wrap:wrap; }
  .sh-trust-item {
    display:flex; align-items:center; gap:6px;
    font-size:.74rem; color:#6b5a48;
    background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.07);
    border-radius:100px; padding:5px 13px;
  }

  /* Modal overlay */
  .sh-overlay {
    position:fixed; inset:0;
    background:rgba(0,0,0,.82); backdrop-filter:blur(12px);
    z-index:200; display:flex; align-items:center; justify-content:center; padding:20px;
    animation:shFadeIn .2s ease;
  }
  @keyframes shFadeIn { from{opacity:0} to{opacity:1} }
  .sh-modal {
    background:rgba(12,9,5,.98);
    border:1px solid rgba(255,255,255,.08); border-radius:22px;
    width:100%; max-width:500px; padding:40px;
    position:relative;
    box-shadow:0 48px 96px rgba(0,0,0,.65);
    animation:shSlideUp .28s ease;
    max-height:90vh; overflow-y:auto;
  }
  @keyframes shSlideUp { from{transform:translateY(18px);opacity:0} to{transform:translateY(0);opacity:1} }

  .sh-modal-close {
    position:absolute; top:16px; right:18px;
    background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.08);
    color:#6b5a48; width:33px; height:33px; border-radius:8px;
    display:flex; align-items:center; justify-content:center;
    cursor:pointer; font-size:1.15rem; transition:background .2s; line-height:1;
  }
  .sh-modal-close:hover { background:rgba(255,255,255,.1); color:#f0ebe5; }

  .sh-modal-title { font-family:'Cormorant Garamond',serif; font-size:1.65rem; font-weight:400; margin-bottom:4px; }
  .sh-modal-sub { font-size:.8rem; color:#6b5a48; margin-bottom:24px; }

  .sh-order-summary {
    background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.07);
    border-radius:12px; padding:14px 18px; margin-bottom:24px;
    display:flex; align-items:center; gap:14px;
  }
  .sh-order-emoji { font-size:2rem; }
  .sh-order-name { font-weight:600; font-size:.92rem; }
  .sh-order-desc { font-size:.75rem; color:#6b5a48; }
  .sh-order-price {
    margin-left:auto;
    font-family:'Cormorant Garamond',serif; font-size:1.5rem; font-weight:600;
    background:linear-gradient(135deg,#c8963e,#e8b860);
    -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text;
  }

  /* Tabs */
  .sh-tabs { display:flex; align-items:center; gap:8px; margin-bottom:22px; font-size:.79rem; font-weight:600; }
  .sh-tab { color:rgba(255,255,255,.2); }
  .sh-tab.active { color:#c8963e; }
  .sh-tab-sep { color:rgba(255,255,255,.1); }

  .sh-ship-summary {
    background:rgba(200,150,62,.07); border:1px solid rgba(200,150,62,.14);
    border-radius:10px; padding:12px 16px;
    font-size:.81rem; color:#6b5a48; margin-bottom:20px; line-height:1.65;
  }

  /* Form */
  .sh-form-row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .sh-field { margin-bottom:16px; }
  .sh-label {
    font-size:.7rem; font-weight:600; color:#6b5a48;
    letter-spacing:1px; text-transform:uppercase; margin-bottom:7px; display:block;
  }
  .sh-input {
    width:100%; padding:12px 14px;
    background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.09);
    border-radius:9px; font-size:.9rem; font-family:'DM Sans',sans-serif;
    color:#f0ebe5; transition:border-color .2s,box-shadow .2s; outline:none;
  }
  .sh-input:focus { border-color:rgba(200,150,62,.5); box-shadow:0 0 0 3px rgba(200,150,62,.1); }
  .sh-input::placeholder { color:rgba(255,255,255,.17); }
  .sh-select {
    width:100%; padding:12px 14px;
    background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.09);
    border-radius:9px; font-size:.9rem; font-family:'DM Sans',sans-serif;
    color:#f0ebe5; outline:none; appearance:none; cursor:pointer;
  }
  .sh-select option { background:#1a1208; color:#f0ebe5; }

  .sh-pan-wrap { position:relative; }
  .sh-pan-icon { position:absolute; left:13px; top:50%; transform:translateY(-50%); font-size:1rem; }
  .sh-pan-wrap .sh-input { padding-left:40px; }

  .sh-err {
    font-size:.8rem; margin-bottom:10px; display:block; padding:9px 13px;
    background:rgba(248,113,113,.08); border:1px solid rgba(248,113,113,.2);
    border-left:3px solid #f87171; color:#fca5a5;
    border-radius:8px; line-height:1.4;
  }

  .sh-btn-pay {
    width:100%; padding:15px;
    background:linear-gradient(135deg,#c8963e,#e8b860);
    color:#080604; border:none; border-radius:10px;
    font-family:'DM Sans',sans-serif; font-size:1rem; font-weight:600; cursor:pointer;
    margin-top:8px; transition:opacity .2s,transform .15s;
    display:flex; align-items:center; justify-content:center; gap:8px;
  }
  .sh-btn-pay:hover { opacity:.9; transform:translateY(-1px); }
  .sh-btn-pay:disabled { background:rgba(255,255,255,.08); color:#6b5a48; cursor:not-allowed; transform:none; }
  .sh-btn-back-link { width:100%; padding:10px; background:none; border:none; color:#6b5a48; font-size:.79rem; cursor:pointer; margin-top:6px; font-family:'DM Sans',sans-serif; }
  .sh-secure { text-align:center; font-size:.72rem; color:#6b5a48; margin-top:10px; }

  /* Processing */
  .sh-proc { text-align:center; padding:24px 0; }
  .sh-spinner {
    width:64px; height:64px; margin:0 auto 24px;
    border:4px solid rgba(200,150,62,.1); border-top-color:#c8963e;
    border-radius:50%; animation:shSpin .85s linear infinite;
  }
  @keyframes shSpin { to{transform:rotate(360deg)} }
  .sh-proc-title { font-family:'Cormorant Garamond',serif; font-size:1.4rem; font-weight:400; margin-bottom:8px; }
  .sh-proc-sub { font-size:.82rem; color:#6b5a48; }
  .sh-steps { margin-top:24px; text-align:left; }
  .sh-step { font-size:.8rem; color:rgba(255,255,255,.18); padding:7px 0; display:flex; align-items:center; gap:10px; transition:color .3s; }
  .sh-step.done { color:#4ade80; }
  .sh-step.active { color:#c8963e; font-weight:600; }
  .sh-step-dot { width:7px; height:7px; border-radius:50%; background:currentColor; flex-shrink:0; }

  /* Success */
  .sh-success { text-align:center; padding:10px 0; }
  .sh-success-icon { font-size:3.8rem; margin-bottom:20px; filter:drop-shadow(0 10px 24px rgba(74,222,128,.35)); }
  .sh-success-title { font-family:'Cormorant Garamond',serif; font-size:1.9rem; font-weight:400; margin-bottom:8px; }
  .sh-success-sub { font-size:.87rem; color:#6b5a48; margin-bottom:28px; }
  .sh-receipt {
    background:rgba(255,255,255,.025); border:1px solid rgba(255,255,255,.07);
    border-radius:14px; padding:22px; text-align:left; margin-bottom:22px;
  }
  .sh-rcpt-row { display:flex; justify-content:space-between; font-size:.86rem; padding:6px 0; }
  .sh-rcpt-row.total { border-top:1px solid rgba(255,255,255,.07); margin-top:10px; padding-top:14px; font-weight:700; font-size:1rem; }
  .sh-rcpt-row.total span:last-child {
    background:linear-gradient(135deg,#c8963e,#e8b860);
    -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text;
  }
  .sh-rcpt-label { color:#6b5a48; }
  .sh-rcpt-order { font-family:'JetBrains Mono',monospace; font-size:.67rem; color:rgba(255,255,255,.2); margin-top:8px; }
  .sh-btn-done {
    width:100%; padding:14px;
    background:linear-gradient(135deg,#c8963e,#e8b860);
    color:#080604; border:none; border-radius:10px;
    font-family:'DM Sans',sans-serif; font-size:.95rem; font-weight:600; cursor:pointer;
    transition:opacity .2s;
  }
  .sh-btn-done:hover { opacity:.9; }

  @media(max-width:720px) {
    .sh-product { grid-template-columns:1fr; gap:32px; }
    .sh-img-box { position:static; }
    .sh-nav, .sh-crumb { padding-left:24px; padding-right:24px; }
    .sh-form-row { grid-template-columns:1fr; }
  }
`

const COUNTRIES = ['India','United States','United Kingdom','Canada','Australia','Germany','France']

export default function Shop() {
  const navigate = useNavigate()
  const [emoji, setEmoji]         = useState('🍫')
  const [qty, setQty]             = useState(1)
  const [modal, setModal]         = useState(false)
  const [view, setView]           = useState('form')      // form | processing | success
  const [checkStep, setCheckStep] = useState('shipping')  // shipping | payment
  const [ship, setShip]           = useState({ first:'', last:'', email:'', addr:'', city:'', zip:'', state:'Punjab', country:'India', phone:'' })
  const [pay, setPay]             = useState({ pan:'', expiry:'', cvv:'', name:'' })
  const [shipErr, setShipErr]     = useState('')
  const [payErr, setPayErr]       = useState('')
  const [procStep, setProcStep]   = useState(0)
  const [receipt, setReceipt]     = useState(null)

  useEffect(() => {
    document.body.classList.add('lp-body')
    return () => document.body.classList.remove('lp-body')
  }, [])

  const total = (UNIT_PRICE * qty).toFixed(2)

  const openModal = () => {
    setModal(true)
    setView('form')
    setCheckStep('shipping')
    setShipErr('')
    setPayErr('')
  }

  const closeModal = () => {
    setModal(false)
    setTimeout(() => { setView('form'); setCheckStep('shipping') }, 300)
  }

  const goToPayment = () => {
    if (!ship.first || !ship.last) { setShipErr('Enter your full name');   return }
    if (!ship.email)               { setShipErr('Enter your email');        return }
    if (!ship.addr)                { setShipErr('Enter your address');      return }
    if (!ship.city || !ship.zip)   { setShipErr('Enter city and postcode'); return }
    setShipErr('')
    setPay(p => ({ ...p, name: ship.first + ' ' + ship.last }))
    setCheckStep('payment')
  }

  const submitPayment = async () => {
    const pan = pay.pan.replace(/\s/g, '')
    if (pan.length < 13) { setPayErr('Enter a valid card number'); return }
    if (!pay.cvv)         { setPayErr('Enter your CVV');            return }
    if (!pay.name)        { setPayErr('Enter the name on card');    return }
    setPayErr('')
    setView('processing')
    setProcStep(1)

    try {
      await sleep(900)
      setProcStep(2)

      const amountCents = Math.round(parseFloat(total) * 100)
      const res = await fetch(`${BACKEND_URL}/api/v1/cards/test-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
        body: JSON.stringify({ pan, amount_cents: amountCents }),
      })
      if (!res.ok) { const err = await res.json(); throw new Error(err.detail || 'Payment declined') }
      const result = await res.json()

      await sleep(900)
      setProcStep(3)
      await sleep(400)

      setReceipt({
        qty,
        card:    '•••• ' + pan.slice(-4),
        total:   '$' + total,
        shipTo:  `${ship.first} ${ship.last} · ${ship.city}, ${ship.country}`,
        orderId: 'Order #PCL-' + Math.random().toString(36).slice(2,9).toUpperCase() +
                 ' · Tx: ' + (result.transaction_token || '').slice(0,12) + '...',
      })
      setView('success')
    } catch (err) {
      setView('form')
      setPayErr(err.message || 'Payment failed - try again')
    }
  }

  const stepClass = n => {
    if (procStep > n) return 'sh-step done'
    if (procStep === n) return 'sh-step active'
    return 'sh-step'
  }

  return (
    <>
      <style>{CSS}</style>
      <div className="shop">

        {/* Nav */}
        <nav className="sh-nav">
          <button className="sh-back" onClick={() => navigate('/')}>← ClawPay</button>
          <div className="sh-logo">Choco<em>Bazaar</em></div>
          <div className="sh-nav-links">
            <span>Chocolates</span>
            <span>Gifts</span>
            <span>Offers</span>
            <span>🛒 Cart</span>
          </div>
        </nav>

        {/* Breadcrumb */}
        <div className="sh-crumb">
          Home › Chocolates › Milk Chocolate › <span>Cadbury Dairy Milk</span>
        </div>

        {/* Product */}
        <div className="sh-product">

          {/* Image */}
          <div className="sh-img-box">
            <div className="sh-badge">Best Seller</div>
            <span className="sh-emoji">{emoji}</span>
            <div className="sh-thumbs">
              {['🍫','🎁','🧁'].map(e => (
                <button key={e} className={`sh-thumb${emoji===e?' active':''}`} onClick={() => setEmoji(e)}>{e}</button>
              ))}
            </div>
          </div>

          {/* Info */}
          <div>
            <div className="sh-brand">Cadbury</div>
            <h1 className="sh-title">Dairy Milk<br />Chocolate Bar</h1>
            <div className="sh-stars">★★★★★</div>
            <div className="sh-reviews">4.9 out of 5 · 12,847 reviews</div>

            <div className="sh-price-row">
              <span className="sh-price">$4.99</span>
              <span className="sh-price-old">$6.49</span>
              <span className="sh-save">Save 23%</span>
            </div>
            <div className="sh-stock"><div className="sh-stock-dot" />In stock - ships today</div>

            <div className="sh-divider" />
            <p className="sh-desc">
              The original, much-loved Cadbury Dairy Milk recipe - rich, creamy milk chocolate
              crafted with a glass and a half of full-cream milk. The perfect everyday indulgence
              or a thoughtful gift for any chocolate lover.
            </p>

            <div className="sh-meta">
              <div className="sh-meta-item"><strong>200g</strong>Weight</div>
              <div className="sh-meta-item"><strong>Milk Choc</strong>Type</div>
              <div className="sh-meta-item"><strong>UK</strong>Origin</div>
              <div className="sh-meta-item"><strong>Box of 6</strong>Pack</div>
            </div>
            <div className="sh-divider" />

            <button className="sh-btn-buy" onClick={openModal}>Buy Now</button>
            <button className="sh-btn-cart">Add to Cart</button>

            <div className="sh-trust">
              <div className="sh-trust-item">🔒 Secure checkout</div>
              <div className="sh-trust-item">🚚 Free shipping over $25</div>
              <div className="sh-trust-item">↩ 30-day returns</div>
            </div>
          </div>
        </div>

        {/* Modal */}
        {modal && (
          <div className="sh-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
            <div className="sh-modal">
              <button className="sh-modal-close" onClick={closeModal}>×</button>

              {/* ── Form ── */}
              {view === 'form' && (
                <>
                  <div className="sh-modal-title">Secure Checkout</div>
                  <div className="sh-modal-sub">ChocoBazaar · Powered by ClawPay</div>

                  <div className="sh-order-summary">
                    <div className="sh-order-emoji">🍫</div>
                    <div>
                      <div className="sh-order-name">Cadbury Dairy Milk</div>
                      <div className="sh-order-desc">×{qty} · 200g</div>
                    </div>
                    <div className="sh-order-price">${total}</div>
                  </div>

                  <div className="sh-tabs">
                    <div className={`sh-tab${checkStep==='shipping'?' active':''}`}>1 · Shipping</div>
                    <div className="sh-tab-sep">›</div>
                    <div className={`sh-tab${checkStep==='payment'?' active':''}`}>2 · Payment</div>
                  </div>

                  {/* Shipping step */}
                  {checkStep === 'shipping' && (
                    <>
                      <div className="sh-form-row">
                        <div className="sh-field">
                          <label className="sh-label">First Name</label>
                          <input className="sh-input" placeholder="John" value={ship.first} onChange={e => setShip(s=>({...s,first:e.target.value}))} />
                        </div>
                        <div className="sh-field">
                          <label className="sh-label">Last Name</label>
                          <input className="sh-input" placeholder="Smith" value={ship.last} onChange={e => setShip(s=>({...s,last:e.target.value}))} />
                        </div>
                      </div>
                      <div className="sh-field">
                        <label className="sh-label">Email</label>
                        <input className="sh-input" placeholder="john@example.com" value={ship.email} onChange={e => setShip(s=>({...s,email:e.target.value}))} />
                      </div>
                      <div className="sh-field">
                        <label className="sh-label">Address</label>
                        <input className="sh-input" placeholder="123 Main Street" value={ship.addr} onChange={e => setShip(s=>({...s,addr:e.target.value}))} />
                      </div>
                      <div className="sh-form-row">
                        <div className="sh-field">
                          <label className="sh-label">City</label>
                          <input className="sh-input" placeholder="Chandigarh" value={ship.city} onChange={e => setShip(s=>({...s,city:e.target.value}))} />
                        </div>
                        <div className="sh-field">
                          <label className="sh-label">ZIP / Postcode</label>
                          <input className="sh-input" placeholder="160001" value={ship.zip} onChange={e => setShip(s=>({...s,zip:e.target.value}))} />
                        </div>
                      </div>
                      <div className="sh-form-row">
                        <div className="sh-field">
                          <label className="sh-label">State</label>
                          <input className="sh-input" placeholder="Punjab" value={ship.state} onChange={e => setShip(s=>({...s,state:e.target.value}))} />
                        </div>
                        <div className="sh-field">
                          <label className="sh-label">Country</label>
                          <select className="sh-select" value={ship.country} onChange={e => setShip(s=>({...s,country:e.target.value}))}>
                            {COUNTRIES.map(c => <option key={c}>{c}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="sh-field">
                        <label className="sh-label">Phone</label>
                        <input className="sh-input" type="tel" placeholder="+1 555 000 0000" value={ship.phone} onChange={e => setShip(s=>({...s,phone:e.target.value}))} />
                      </div>
                      {shipErr && <span className="sh-err">⚠ {shipErr}</span>}
                      <button className="sh-btn-pay" onClick={goToPayment}>Continue to Payment →</button>
                    </>
                  )}

                  {/* Payment step */}
                  {checkStep === 'payment' && (
                    <>
                      <div className="sh-ship-summary">
                        📦 <strong>{ship.first} {ship.last}</strong> · {ship.email}<br />
                        {ship.addr}, {ship.city} {ship.zip}, {ship.state}, {ship.country}
                      </div>
                      <div className="sh-field">
                        <label className="sh-label">Card Number</label>
                        <div className="sh-pan-wrap">
                          <span className="sh-pan-icon">💳</span>
                          <input className="sh-input" type="tel" placeholder="4111 1111 1111 1111" maxLength={19}
                            value={pay.pan} onChange={e => setPay(p=>({...p,pan:formatPan(e.target.value)}))} />
                        </div>
                      </div>
                      <div className="sh-form-row">
                        <div className="sh-field">
                          <label className="sh-label">Expiry</label>
                          <input className="sh-input" type="tel" placeholder="MM/YY" maxLength={5}
                            value={pay.expiry} onChange={e => setPay(p=>({...p,expiry:formatExpiry(e.target.value)}))} />
                        </div>
                        <div className="sh-field">
                          <label className="sh-label">CVV</label>
                          <input className="sh-input" type="tel" placeholder="•••" maxLength={4}
                            value={pay.cvv} onChange={e => setPay(p=>({...p,cvv:e.target.value}))} />
                        </div>
                      </div>
                      <div className="sh-field">
                        <label className="sh-label">Name on Card</label>
                        <input className="sh-input" placeholder="John Smith" value={pay.name} onChange={e => setPay(p=>({...p,name:e.target.value}))} />
                      </div>
                      {payErr && <span className="sh-err">⚠ {payErr}</span>}
                      <button className="sh-btn-pay" onClick={submitPayment}>🔒 Pay ${total}</button>
                      <button className="sh-btn-back-link" onClick={() => setCheckStep('shipping')}>← Back to shipping</button>
                      <div className="sh-secure">256-bit SSL · Your card details are never stored</div>
                    </>
                  )}
                </>
              )}

              {/* ── Processing ── */}
              {view === 'processing' && (
                <div className="sh-proc">
                  <div className="sh-spinner" />
                  <div className="sh-proc-title">Processing payment…</div>
                  <div className="sh-proc-sub">Please do not close this window</div>
                  <div className="sh-steps">
                    <div className={stepClass(1)}><div className="sh-step-dot" />Validating card details</div>
                    <div className={stepClass(2)}><div className="sh-step-dot" />Authorising with issuer</div>
                    <div className={stepClass(3)}><div className="sh-step-dot" />Confirming payment</div>
                  </div>
                </div>
              )}

              {/* ── Success ── */}
              {view === 'success' && receipt && (
                <div className="sh-success">
                  <div className="sh-success-icon">✅</div>
                  <div className="sh-success-title">Order Placed!</div>
                  <div className="sh-success-sub">Your Cadbury Dairy Milk is on its way 🍫</div>
                  <div className="sh-receipt">
                    <div className="sh-rcpt-row"><span className="sh-rcpt-label">Item</span><span>Cadbury Dairy Milk ×{receipt.qty}</span></div>
                    <div className="sh-rcpt-row"><span className="sh-rcpt-label">Card</span><span>{receipt.card}</span></div>
                    <div className="sh-rcpt-row"><span className="sh-rcpt-label">Ship to</span><span>{receipt.shipTo}</span></div>
                    <div className="sh-rcpt-row"><span className="sh-rcpt-label">Status</span><span style={{color:'#4ade80',fontWeight:600}}>CLEARED ✓</span></div>
                    <div className="sh-rcpt-row total"><span>Total charged</span><span>{receipt.total}</span></div>
                    <div className="sh-rcpt-order">{receipt.orderId}</div>
                  </div>
                  <button className="sh-btn-done" onClick={closeModal}>Continue Shopping</button>
                </div>
              )}

            </div>
          </div>
        )}
      </div>
    </>
  )
}
