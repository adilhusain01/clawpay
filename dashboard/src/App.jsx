import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ethers } from 'ethers'
import './App.css'

const BACKEND_URL = import.meta.env.DEV ? 'http://localhost:8000' : 'https://clawpay-production.up.railway.app'
const API_KEY = 'sk_clawpay_dev_b03352ef1d68164c675023b82538ea3d1d1902f69bc408b7'

// Arbitrum Sepolia
const ARBITRUM_SEPOLIA = {
  chainId: '0x66eee',  // 421614
  chainName: 'Arbitrum Sepolia',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: [
    'https://arbitrum-sepolia-testnet.api.pocket.network',
    'https://arbitrum-sepolia.drpc.org',
  ],
  blockExplorerUrls: ['https://sepolia.arbiscan.io'],
}

// Escrow: deposit(sessionId, amount) - no native value
const ESCROW_ABI = [
  'function deposit(string calldata sessionId, uint256 amount) external'
]

// ERC-20: approve(spender, amount)
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)'
]

function App() {
  const navigate = useNavigate()
  const [walletConnected, setWalletConnected] = useState(false)
  const [account, setAccount] = useState(null)
  const [amount, setAmount] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [processing, setProcessing] = useState(false)
  const [card, setCard] = useState(null)
  const [testingPayment, setTestingPayment] = useState(false)
  const [paymentResult, setPaymentResult] = useState(null)
  const [merchantName, setMerchantName] = useState('')
  const [merchantDomain, setMerchantDomain] = useState('')
  const [originalAmount, setOriginalAmount] = useState('')
  const [usdcInfo, setUsdcInfo] = useState(null) // { usdc_amount_display, amount_usd_with_buffer }

  // Restore MetaMask session if already authorized (no popup)
  useEffect(() => {
    if (!window.ethereum) return
    window.ethereum.request({ method: 'eth_accounts' }).then(accounts => {
      if (accounts.length > 0) {
        setAccount(accounts[0])
        setWalletConnected(true)
      }
    })
    // Keep in sync if user switches account or disconnects in MetaMask
    const onAccountsChanged = (accounts) => {
      if (accounts.length > 0) {
        setAccount(accounts[0])
        setWalletConnected(true)
      } else {
        setAccount(null)
        setWalletConnected(false)
      }
    }
    window.ethereum.on('accountsChanged', onAccountsChanged)
    return () => window.ethereum.removeListener('accountsChanged', onAccountsChanged)
  }, [])

  // Read URL params set by the extension
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const amountParam = params.get('amount')
    const merchantParam = params.get('merchant')
    const domainParam = params.get('domain')
    const originalAmountParam = params.get('originalAmount')

    if (amountParam) setAmount(amountParam)
    if (merchantParam) setMerchantName(merchantParam)
    if (domainParam) setMerchantDomain(domainParam)
    if (originalAmountParam) {
      setOriginalAmount(originalAmountParam)
      setStatus(`Converted ${originalAmountParam} → $${parseFloat(amountParam).toFixed(2)} USD`)
    } else if (merchantParam) {
      setStatus(`Payment for ${merchantParam}`)
    }
  }, [])

  // Listen for confirm-transaction message from extension
  useEffect(() => {
    const handler = (event) => {
      if (event.data?.type === 'CLAWPAY_CONFIRM_TRANSACTION' && card && !testingPayment) {
        handleTestPayment()
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [card, testingPayment])

  // ──────────────────────────────────────
  // Wallet connection
  // ──────────────────────────────────────

  async function connectWallet() {
    setError('')
    setStatus('Connecting MetaMask...')

    if (!window.ethereum) {
      setError('MetaMask is not installed. Please install from https://metamask.io')
      setStatus('')
      return
    }

    try {
      // Request accounts
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
      const userAccount = accounts[0]

      // Switch (or add) Arbitrum Sepolia
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: ARBITRUM_SEPOLIA.chainId }],
        })
      } catch (switchErr) {
        if (switchErr.code === 4902) {
          // Network not in MetaMask - add it
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [ARBITRUM_SEPOLIA],
          })
        } else {
          throw switchErr
        }
      }

      setAccount(userAccount)
      setWalletConnected(true)
      setStatus(`Connected: ${userAccount.slice(0, 6)}...${userAccount.slice(-4)}`)
    } catch (err) {
      setError(err.message || 'Failed to connect wallet')
      setStatus('')
    }
  }

  // ──────────────────────────────────────
  // Payment
  // ──────────────────────────────────────

  async function handlePayment() {
    if (!amount || parseFloat(amount) <= 0) {
      setError('Please enter a valid amount')
      return
    }

    setProcessing(true)
    setError('')
    setCard(null)
    setUsdcInfo(null)

    try {
      // 1. Initiate session
      setStatus('Creating payment session...')
      const initRes = await fetch(`${BACKEND_URL}/api/v1/payment/initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
        body: JSON.stringify({
          amount_usd: parseFloat(amount),
          user_wallet_address: account,
          merchant_name: merchantName || 'ClawPay Merchant',
        }),
      })

      if (!initRes.ok) {
        const err = await initRes.json()
        throw new Error(err.detail || 'Failed to create payment session')
      }

      const session = await initRes.json()
      console.log('Session:', session)

      setUsdcInfo({
        usdc_amount_display: session.usdc_amount_display,
        amount_usd_with_buffer: session.amount_usd_with_buffer,
      })

      const provider = new ethers.BrowserProvider(window.ethereum)
      const signer = await provider.getSigner()
      const usdcAmount = BigInt(session.usdc_amount)

      // Fetch live fee data and apply 2× buffer so MetaMask never falls below base fee
      const feeData = await provider.getFeeData()
      const gasOverrides = {
        maxFeePerGas: feeData.maxFeePerGas * 2n,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
      }

      // 2a. Approve USDC spending
      setStatus(`Approving ${session.usdc_amount_display} USDC - confirm in MetaMask...`)
      const usdc = new ethers.Contract(session.usdc_contract, ERC20_ABI, signer)
      const approveTx = await usdc.approve(session.contract_address, usdcAmount, gasOverrides)
      setStatus('Approval submitted - waiting for confirmation...')
      await approveTx.wait()

      // 2b. Deposit USDC into escrow
      setStatus(`Depositing ${session.usdc_amount_display} into escrow - confirm in MetaMask...`)
      const escrow = new ethers.Contract(session.contract_address, ESCROW_ABI, signer)
      const tx = await escrow.deposit(session.session_id, usdcAmount, gasOverrides)

      setStatus('Deposit submitted - waiting for confirmation...')
      const receipt = await tx.wait()

      console.log('TX receipt:', receipt)
      setStatus('Transaction confirmed! Creating virtual card...')

      // 3. Confirm with backend → get card
      const confirmRes = await fetch(`${BACKEND_URL}/api/v1/payment/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
        body: JSON.stringify({
          session_id: session.session_id,
          tx_hash: receipt.hash,
          user_wallet_address: account,
        }),
      })

      if (!confirmRes.ok) {
        const err = await confirmRes.json()
        throw new Error(err.detail || 'Failed to confirm payment')
      }

      const result = await confirmRes.json()
      console.log('Payment confirmed:', result)

      if (result.card) {
        const cardData = {
          pan:       result.card.pan,
          cvv:       result.card.cvv,
          exp_month: result.card.exp_month,
          exp_year:  result.card.exp_year,
          last_four: result.card.last_four,
          token:     result.card.token,
          state:     result.card.state,
        }
        setCard(cardData)
        setStatus('Virtual card ready!')

        // Notify parent window (merchant page)
        if (window.opener) {
          window.opener.postMessage({ type: 'CLAWPAY_CARD_READY', card: cardData }, '*')
        }
      } else {
        throw new Error('Card not returned from backend')
      }
    } catch (err) {
      console.error('Payment error:', err)
      setError(err.message || 'Payment failed')
      setStatus('')
    } finally {
      setProcessing(false)
    }
  }

  // ──────────────────────────────────────
  // Test payment (sandbox)
  // ──────────────────────────────────────

  async function handleTestPayment() {
    if (!card?.pan) { setError('No card available'); return }

    setTestingPayment(true)
    setPaymentResult(null)
    setError('')

    try {
      const amountCents = Math.floor(parseFloat(amount) * 100)
      const res = await fetch(`${BACKEND_URL}/api/v1/cards/test-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
        body: JSON.stringify({ pan: card.pan, amount_cents: amountCents }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Test payment failed')
      }

      const result = await res.json()
      setPaymentResult(result)
      setStatus('Test payment successful!')

      setTimeout(() => {
        if (window.opener) {
          window.opener.postMessage({
            type: 'CLAWPAY_PAYMENT_COMPLETE',
            paymentDetails: {
              amount,
              merchant: merchantName || 'Merchant',
              domain: merchantDomain || '',
              originalAmount: originalAmount || null,
            },
          }, '*')
        }
        setTimeout(() => window.close(), 500)
      }, 1500)
    } catch (err) {
      console.error('Test payment error:', err)
      setError(err.message || 'Test payment failed')
    } finally {
      setTestingPayment(false)
    }
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text)
    setStatus('Copied!')
    setTimeout(() => setStatus('Virtual card ready!'), 1500)
  }

  // ──────────────────────────────────────
  // Render
  // ──────────────────────────────────────

  // Body class for dark full-page treatment
  useEffect(() => {
    document.body.classList.add('pay-body')
    return () => document.body.classList.remove('pay-body')
  }, [])

  return (
    <div className="pay-root">
      <div className="pay-orb pay-orb-1" />
      <div className="pay-orb pay-orb-2" />
      <button className="btn-back" onClick={() => navigate('/')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5M12 5l-7 7 7 7"/>
        </svg>
        Home
      </button>
      <div className="container">
      <div className="card">
        <div className="header">
          <h1>ClawPay</h1>
          <p className="subtitle">Pay with USDC · Arbitrum Sepolia</p>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {!walletConnected ? (
          <div className="connect-section">
            <p className="info-text">
              Connect MetaMask to pay with USDC on Arbitrum Sepolia.<br />
              The network will be added automatically if needed.
            </p>
            <button onClick={connectWallet} className="btn-primary">
              Connect MetaMask
            </button>
          </div>

        ) : !card ? (
          <div className="payment-section">
            {merchantName && (
              <div className="merchant-info">
                <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1.2px', color: '#44445a', marginBottom: '8px' }}>Merchant</div>
                <div style={{ fontSize: '17px', fontWeight: '700', marginBottom: '4px', color: '#f0f0f8' }}>{merchantName}</div>
                {merchantDomain && <div style={{ fontSize: '13px', color: '#52526a' }}>{merchantDomain}</div>}
                {originalAmount && (
                  <div style={{ marginTop: '12px', padding: '10px', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <div style={{ fontSize: '10px', color: '#44445a', marginBottom: '4px', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '600' }}>Original Amount</div>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: '#e8e8f0' }}>{originalAmount}</div>
                    <div style={{ fontSize: '11px', color: '#52526a', marginTop: '4px' }}>
                      Converted to ${parseFloat(amount).toFixed(2)} USD
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', marginBottom: '4px' }}>
              <div className="wallet-info" style={{ flex: 1 }}>
                <svg className="label" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="5" width="20" height="14" rx="2"/><path d="M16 12h2"/>
                  <path d="M2 10h20"/>
                </svg>
                <span className="value">{account.slice(0, 6)}...{account.slice(-4)}</span>
              </div>
              <div className="wallet-info" style={{ flex: 1 }}>
                <svg className="label" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><path d="M4.93 4.93 19.07 19.07"/>
                  <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                </svg>
                <span className="value">Arbitrum Sepolia</span>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="amount">Payment Amount (USD)</label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', fontWeight: '600', color: '#44445a' }}>$</span>
                <input
                  id="amount"
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="10.00"
                  step="0.01"
                  min="1"
                  disabled={processing}
                  style={{ paddingLeft: '28px' }}
                />
              </div>
              {usdcInfo && (
                <div style={{ fontSize: '12px', color: '#06b6d4', marginTop: '6px', fontFamily: "'JetBrains Mono', monospace" }}>
                  {usdcInfo.usdc_amount_display} (incl. 5% buffer for tax/fees)
                </div>
              )}
            </div>

            <button
              onClick={handlePayment}
              disabled={processing || !amount}
              className="btn-primary"
            >
              {processing ? 'Processing...' : 'Pay with USDC'}
            </button>

          </div>

        ) : (
          <div className="card-section">
            <h2>Virtual Card Ready</h2>
            <p className="card-instruction">
              Use the details below at any online checkout
            </p>

            {/* ── Virtual card visual ── */}
            <div className="virtual-card">
              <div className="vc-top">
                <div className="vc-logo">ClawPay</div>
              </div>
              <div className="vc-pan">
                {card.pan
                  ? card.pan.replace(/(\d{4})(?=\d)/g, '$1 ')
                  : '•••• •••• •••• ••••'}
              </div>
              <div className="vc-bottom">
                <div>
                  <div className="vc-field-label">Valid thru</div>
                  <div className="vc-field-val">{card.exp_month}/{card.exp_year}</div>
                </div>
                <div>
                  <div className="vc-field-label">CVV</div>
                  <div className="vc-field-val">{card.cvv || '•••'}</div>
                </div>
                <div className="vc-brand">USDC Powered<br />Arbitrum Sepolia</div>
              </div>
            </div>

            {/* ── Card data + actions ── */}
            <div className="card-display">
              <div className="card-field">
                <label>Card Number</label>
                <div className="card-value">
                  <code>{card.pan || 'N/A'}</code>
                  <button onClick={() => copyToClipboard(card.pan)} className="btn-copy">Copy</button>
                </div>
              </div>

              <div className="card-row">
                <div className="card-field">
                  <label>Expiry</label>
                  <div className="card-value">
                    <code>{card.exp_month}/{card.exp_year}</code>
                  </div>
                </div>
                <div className="card-field">
                  <label>CVV</label>
                  <div className="card-value">
                    <code>{card.cvv || 'N/A'}</code>
                    <button onClick={() => copyToClipboard(card.cvv)} className="btn-copy">Copy</button>
                  </div>
                </div>
              </div>

              <div className="card-field">
                <label>State</label>
                <div className="card-value"><strong>{card.state || 'OPEN'}</strong></div>
              </div>

              <div className="card-note">
                Single-use card. Any unused amount is automatically refunded as USDC to your wallet.
              </div>

              <button
                onClick={handleTestPayment}
                disabled={testingPayment || card.state === 'CLOSED'}
                className="btn-primary"
                style={{ marginTop: '18px' }}
              >
                {testingPayment ? 'Payment in progress...' : 'Test Payment (Sandbox)'}
              </button>

              {testingPayment && (
                <div className="loading-modal">
                  <div className="loading-content">
                    <div className="spinner"></div>
                    <h3>Payment in progress</h3>
                    <p>Please wait...</p>
                  </div>
                </div>
              )}

              {paymentResult && (
                <div className="status-message" style={{ marginTop: '14px', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.25)', color: '#4ade80' }}>
                  {paymentResult.message}
                  <br />
                  <small style={{ opacity: 0.7 }}>Status: {paymentResult.status}</small>
                </div>
              )}
            </div>

            <button onClick={() => window.close()} className="btn-secondary">
              Close Window
            </button>
          </div>
        )}

        {status && !walletConnected && (
          <div className="status-message" style={{ marginTop: '12px' }}>{status}</div>
        )}
      </div>
    </div>
    </div>
  )
}

export default App
