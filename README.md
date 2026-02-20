# ClawPay

The payment layer for your AI agent. Plug it in - Claw pays anywhere on the web, autonomously, without a card on file and without you touching anything.

## The Problem

Your agent can browse, decide, and act - but it can't pay. The only native option is [x402](https://x402.org/), which requires the merchant to explicitly support it. That's a tiny fraction of the internet.

Giving your agent a real debit card is worse: it has persistent access to your funds, and one bad checkout later your card number is compromised.

## What ClawPay Is

ClawPay is the abstraction layer between your agent and the web's payment infrastructure:

- Your agent calls `buy_virtual_card()` with an amount
- USDC is deposited into an on-chain escrow - nothing moves without your wallet signature
- A **single-use virtual card** is issued with an exact spend limit
- Your agent uses that card at any website checkout, just like a human would
- Card is dead after one charge. Unused balance refunded as USDC.

**No merchant opt-in. No card on file. No human in the loop.**

> x402 requires the website to support it. ClawPay works on every site that accepts Visa/Mastercard.

## Why It's Secure

- **On-demand, per-transaction cards** - a fresh card with an exact spend limit, every time. Your agent never holds a reusable number.
- **Spend-capped** - even if the card leaks, it can only be charged once for that exact amount, then it's dead.
- **You hold the crypto** - USDC stays in your wallet until you sign. ClawPay never custodies your funds.
- **No conversion** - you don't sell crypto for fiat. Escrow holds USDC, card issuance is triggered on-chain confirmation.

## How It Works

```
Your Agent (Claw / Claude / any MCP agent)
      │
      │  buy_virtual_card(amount_usd=25.00)
      ▼
ClawPay MCP Server
      │  signs + submits USDC escrow tx
      ▼
Arbitrum Sepolia Escrow Contract
      │  on-chain confirmation
      ▼
ClawPay Backend
      │  verifies tx, issues card
      ▼
Lithic Single-Use Virtual Card
  (exact spend limit, one-time use, dead after charge)
      │
      ▼
Agent checks out on any website - no human needed
```

## Architecture

```
┌──────────────────────────────────────┐
│     Your Agent (Claw, Claude, etc.)  │
│   "buy X from website Y for $25"     │
└───────────────┬──────────────────────┘
                │ MCP: buy_virtual_card()
                ▼
┌──────────────────────────────────────┐
│         ClawPay MCP Server           │
│  Signs & submits USDC escrow tx      │
└───────────────┬──────────────────────┘
                │ POST /api/v1/payment/confirm
                ▼
┌──────────────────────────────────────┐
│         ClawPay Backend (FastAPI)    │
│  Verifies on-chain deposit           │
│  Issues Lithic single-use card       │
└───────────────┬──────────────────────┘
                │ {pan, cvv, expiry}
                ▼
┌──────────────────────────────────────┐
│   Agent fills card at any checkout   │
│   Works on any website, no opt-in    │
└──────────────────────────────────────┘
```

## vs. x402

| | x402 | ClawPay |
|---|---|---|
| Merchant opt-in required | Yes | No |
| Card exposure risk | N/A | None - single-use, spend-capped |
| Crypto stays as crypto | Yes | Yes - USDC, no conversion |
| Agent autonomy | Full | Full |
| Coverage | ~handful of sites | Every site that accepts cards |

## Tech Stack

| Layer | Technology |
|---|---|
| Blockchain | Arbitrum Sepolia · USDC (ERC-20) |
| Smart contract | Solidity escrow (`ClawPayEscrow.sol`) |
| Card issuance | Lithic virtual cards (SINGLE_USE) |
| Backend | Python / FastAPI |
| Agent interface | MCP (FastMCP) |
| Dashboard | React + Vite |

## Deployed Contracts (Arbitrum Sepolia)

| Contract | Address |
|---|---|
| MockUSDC | [`0xFCABF780284B0d5997914C5b1ab7Ac34F0F01eaE`](https://sepolia.arbiscan.io/address/0xFCABF780284B0d5997914C5b1ab7Ac34F0F01eaE) |
| ClawPayEscrow | [`0x9ee0141d3FD09E4C15D183bD5017ef86e37b4254`](https://sepolia.arbiscan.io/address/0x9ee0141d3FD09E4C15D183bD5017ef86e37b4254) |

## Plug Into Your Agent

The MCP server gives your agent two tools:

- **`buy_virtual_card(amount_usd, merchant_name?)`** - deposits USDC, returns a single-use card
- **`check_wallet_balance()`** - returns the agent wallet's USDC and ETH balances

Add to your Claude Desktop config (`~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "clawpay": {
      "command": "python",
      "args": ["/path/to/clawpay/mcp/server.py"],
      "env": {
        "AGENT_PRIVATE_KEY": "0x...",
        "CLAWPAY_API_URL": "https://payclaw-production-bad6.up.railway.app",
        "CLAWPAY_API_KEY": "sk_payclaw_..."
      }
    }
  }
}
```

Your agent now handles payments autonomously:

```
"Buy me a Cadbury Dairy Milk from ChocoBazaar"

# Claw calls ClawPay - no human steps:
#  ◆  deposits USDC into escrow on-chain
#  ◆  receives a single-use virtual card
#  ◆  checks out on the merchant site
#  ✓  card is dead after one charge
```

## Payment Flow (Technical)

```mermaid
sequenceDiagram
    participant Agent as Your Agent (Claw)
    participant MCP as ClawPay MCP Server
    participant Chain as Arbitrum Sepolia
    participant API as ClawPay Backend
    participant Lithic

    Agent->>MCP: buy_virtual_card(amount_usd=25.00)
    MCP->>API: POST /api/v1/payment/initiate
    API-->>MCP: session_id, usdc_amount, contract_address
    MCP->>Chain: approve(escrow, usdc_amount)
    MCP->>Chain: deposit(session_id, usdc_amount)
    Chain-->>MCP: tx_hash (confirmed)
    MCP->>API: POST /api/v1/payment/confirm {session_id, tx_hash}
    API->>Chain: verify deposit event
    API->>Lithic: create SINGLE_USE card, spend_limit = amount
    Lithic-->>API: pan, cvv, exp_month, exp_year
    API-->>MCP: card details
    MCP-->>Agent: {pan, cvv, exp_month, exp_year}
    Agent->>Agent: fills card at merchant checkout
```

## Running Locally

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 -m uvicorn src.main:app --reload --port 8000
```

Set in `backend/.env`:

```
LITHIC_API_KEY=...
ARB_ESCROW_CONTRACT=0x9ee0141d3FD09E4C15D183bD5017ef86e37b4254
USDC_CONTRACT=0xFCABF780284B0d5997914C5b1ab7Ac34F0F01eaE
ARB_PLATFORM_PRIVATE_KEY=0x...
```

### MCP Server

```bash
cd mcp
pip install -r requirements.txt
cp .env.example .env   # fill AGENT_PRIVATE_KEY + CLAWPAY_API_KEY
python server.py
```

### Dashboard

```bash
cd dashboard && npm install && npm run dev
```

Runs at `http://localhost:3001` - manual MetaMask flow for testing without an agent.

## Project Structure

```
backend/      FastAPI server - payment sessions, card issuance
contracts/    Solidity escrow (ClawPayEscrow.sol) on Arbitrum Sepolia
dashboard/    React UI - manual payment + card display
extension/    Browser extension - "Pay with ClawPay" button
mcp/          MCP server - agent payment tools
```

## Deployed

**Backend API**: [https://payclaw-production-bad6.up.railway.app](https://payclaw-production-bad6.up.railway.app)

## Notes

- Arbitrum Sepolia - get free ETH from the [Arbitrum Sepolia faucet](https://faucet.triangleplatform.com/arbitrum/sepolia)
- Lithic sandbox - no real money involved
- Cards are SINGLE_USE and closed after first charge
- 5% buffer on every card spend limit to cover taxes/fees; unused amount refunded as USDC
