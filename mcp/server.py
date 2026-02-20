"""
ClawPay MCP Server - buy virtual cards with MockUSDC on Arbitrum Sepolia.

Exposes two tools:
    buy_virtual_card(amount_usd, merchant_name?) → card details
    check_wallet_balance()                       → USDC + ETH balances

The server holds the agent's EVM private key and autonomously:
  1. Calls the ClawPay backend to initiate a payment session.
  2. Approves MockUSDC spending on the escrow contract.
  3. Calls escrow.deposit(sessionId, amount) to lock funds.
  4. Calls the backend confirm endpoint to get the Lithic virtual card.

Setup:
  pip install -r requirements.txt
  cp .env.example .env   # fill in values
  python server.py

Claude Desktop config (~/.claude/claude_desktop_config.json):
  {
    "mcpServers": {
      "clawpay": {
        "command": "python",
        "args": ["/path/to/clawpay/mcp/server.py"],
        "env": {
          "AGENT_PRIVATE_KEY":     "0x...",
          "CLAWPAY_API_URL":       "https://clawpay-production-bad6.up.railway.app",
          "CLAWPAY_API_KEY":       "sk_clawpay_...",
          "USDC_CONTRACT_ADDRESS": "0x..."
        }
      }
    }
  }
"""

import asyncio
import os
from typing import Optional

import httpx
from mcp.server.fastmcp import FastMCP
from web3 import Web3

# ─────────────────────────────────────────────
# Config (from environment)
# ─────────────────────────────────────────────

AGENT_PRIVATE_KEY     = os.environ.get("AGENT_PRIVATE_KEY", "")
CLAWPAY_API_URL       = os.environ.get("CLAWPAY_API_URL", "https://clawpay-production-bad6.up.railway.app")
CLAWPAY_API_KEY       = os.environ.get("CLAWPAY_API_KEY", "")
ARB_RPC               = os.environ.get("ARB_RPC", "https://arbitrum-sepolia-testnet.api.pocket.network")
CHAIN_ID              = int(os.environ.get("CHAIN_ID", "421614"))
USDC_CONTRACT_ADDRESS = os.environ.get("USDC_CONTRACT_ADDRESS", "")

# ─────────────────────────────────────────────
# ABIs
# ─────────────────────────────────────────────

ESCROW_ABI = [
    {
        "inputs": [
            {"name": "sessionId", "type": "string"},
            {"name": "amount",    "type": "uint256"},
        ],
        "name": "deposit",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    }
]

ERC20_ABI = [
    {
        "inputs": [
            {"name": "spender", "type": "address"},
            {"name": "amount",  "type": "uint256"},
        ],
        "name": "approve",
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [{"name": "account", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
]

# ─────────────────────────────────────────────
# Web3 setup
# ─────────────────────────────────────────────

def _build_w3() -> Web3:
    w3 = Web3(Web3.HTTPProvider(ARB_RPC))
    try:
        from web3.middleware import ExtraDataToPOAMiddleware
        w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
    except ImportError:
        from web3.middleware import geth_poa_middleware
        w3.middleware_onion.inject(geth_poa_middleware, layer=0)
    return w3


w3 = _build_w3()

if AGENT_PRIVATE_KEY:
    agent_account = w3.eth.account.from_key(AGENT_PRIVATE_KEY)
    print(f"[clawpay-mcp] Agent wallet: {agent_account.address}")
else:
    agent_account = None
    print("[clawpay-mcp] WARNING: AGENT_PRIVATE_KEY not set - transactions will fail")

# ─────────────────────────────────────────────
# MCP server
# ─────────────────────────────────────────────

mcp = FastMCP("clawpay")


async def _wait_for_receipt(tx_hash_bytes, retries: int = 30, delay: float = 2.0) -> dict:
    """Poll for a transaction receipt, raising on timeout."""
    for _ in range(retries):
        await asyncio.sleep(delay)
        try:
            receipt = w3.eth.get_transaction_receipt(tx_hash_bytes)
            if receipt:
                return receipt
        except Exception:
            continue
    raise TimeoutError(f"Transaction not mined within {retries * delay}s")


@mcp.tool()
async def buy_virtual_card(
    amount_usd: float,
    merchant_name: Optional[str] = None,
) -> dict:
    """
    Purchase a Lithic virtual card by paying MockUSDC on Arbitrum Sepolia.

    The card is single-use. Any unused spend-limit buffer is automatically
    refunded as MockUSDC to the agent wallet after the merchant settles.

    Args:
        amount_usd:    Payment amount in USD (e.g. 25.00)
        merchant_name: Optional label for the card (e.g. "Amazon")

    Returns:
        {
          "pan":       "4111111111111111",
          "cvv":       "123",
          "exp_month": "01",
          "exp_year":  "2027",
          "last_four": "1111",
          "token":     "lithic-card-token",
          "state":     "OPEN",
          "amount_usd": 25.0,
          "tx_hash":   "0x...",
        }
    """
    if not agent_account:
        return {"error": "AGENT_PRIVATE_KEY not configured in environment"}
    if not USDC_CONTRACT_ADDRESS:
        return {"error": "USDC_CONTRACT_ADDRESS not configured in environment"}
    if amount_usd <= 0:
        return {"error": "amount_usd must be positive"}

    headers = {
        "Content-Type": "application/json",
        "X-API-Key": CLAWPAY_API_KEY,
    }

    async with httpx.AsyncClient(timeout=30.0, base_url=CLAWPAY_API_URL) as client:

        # ── Step 1: Initiate session ────────────────────────────────────
        init_payload = {
            "amount_usd": amount_usd,
            "user_wallet_address": agent_account.address,
            "merchant_name": merchant_name or "Agent Purchase",
        }
        init_resp = await client.post("/api/v1/payment/initiate", json=init_payload, headers=headers)
        if init_resp.status_code != 200:
            return {"error": f"Initiate failed: {init_resp.text}"}

        session = init_resp.json()
        session_id       = session["session_id"]
        contract_address = session["contract_address"]
        usdc_contract    = session["usdc_contract"]
        usdc_amount      = int(session["usdc_amount"])

        print(
            f"[clawpay-mcp] Session {session_id}: "
            f"${amount_usd} → {session['usdc_amount_display']}"
        )

        # ── Step 2: Approve MockUSDC spending ───────────────────────────
        usdc = w3.eth.contract(
            address=Web3.to_checksum_address(usdc_contract),
            abi=ERC20_ABI,
        )
        escrow = w3.eth.contract(
            address=Web3.to_checksum_address(contract_address),
            abi=ESCROW_ABI,
        )

        gas_price = w3.eth.gas_price
        nonce = w3.eth.get_transaction_count(agent_account.address)

        approve_tx = usdc.functions.approve(
            Web3.to_checksum_address(contract_address),
            usdc_amount,
        ).build_transaction({
            "chainId":  CHAIN_ID,
            "gas":      100_000,
            "gasPrice": gas_price,
            "nonce":    nonce,
        })

        signed_approve = agent_account.sign_transaction(approve_tx)
        approve_hash = w3.eth.send_raw_transaction(signed_approve.raw_transaction)
        print(f"[clawpay-mcp] Approve TX: {approve_hash.hex()}")

        approve_receipt = await _wait_for_receipt(approve_hash)
        if approve_receipt["status"] != 1:
            return {"error": f"USDC approval reverted: {approve_hash.hex()}"}

        print(f"[clawpay-mcp] Approval confirmed in block {approve_receipt['blockNumber']}")

        # ── Step 3: Deposit MockUSDC to escrow ──────────────────────────
        nonce = w3.eth.get_transaction_count(agent_account.address)

        deposit_tx = escrow.functions.deposit(
            session_id,
            usdc_amount,
        ).build_transaction({
            "chainId":  CHAIN_ID,
            "gas":      150_000,
            "gasPrice": gas_price,
            "nonce":    nonce,
        })

        signed_deposit = agent_account.sign_transaction(deposit_tx)
        deposit_hash = w3.eth.send_raw_transaction(signed_deposit.raw_transaction)
        tx_hash = deposit_hash.hex()
        print(f"[clawpay-mcp] Deposit TX: {tx_hash}")

        deposit_receipt = await _wait_for_receipt(deposit_hash)
        if deposit_receipt["status"] != 1:
            return {"error": f"Deposit reverted: {tx_hash}"}

        print(f"[clawpay-mcp] Deposit confirmed in block {deposit_receipt['blockNumber']}")

        # ── Step 4: Confirm with backend → get card ─────────────────────
        confirm_payload = {
            "session_id":          session_id,
            "tx_hash":             tx_hash,
            "user_wallet_address": agent_account.address,
        }
        confirm_resp = await client.post(
            "/api/v1/payment/confirm", json=confirm_payload, headers=headers
        )
        if confirm_resp.status_code != 200:
            return {"error": f"Confirm failed: {confirm_resp.text}"}

        result = confirm_resp.json()
        card   = result["card"]

        print(f"[clawpay-mcp] Card issued: ...{card.get('last_four')}")

        return {
            "pan":        card.get("pan"),
            "cvv":        card.get("cvv"),
            "exp_month":  card.get("exp_month"),
            "exp_year":   card.get("exp_year"),
            "last_four":  card.get("last_four"),
            "token":      card.get("token"),
            "state":      card.get("state"),
            "amount_usd": result.get("amount_usd"),
            "tx_hash":    tx_hash,
            "session_id": session_id,
        }


@mcp.tool()
async def check_wallet_balance() -> dict:
    """
    Return the agent wallet's MockUSDC and ETH (gas) balances on Arbitrum Sepolia.

    Returns:
        {
          "address":      "0x...",
          "usdc_balance": 100.50,
          "usdc_units":   100500000,
          "eth_balance":  0.01,
          "network":      "Arbitrum Sepolia"
        }
    """
    if not agent_account:
        return {"error": "AGENT_PRIVATE_KEY not configured"}

    bnb_wei = w3.eth.get_balance(agent_account.address)

    result = {
        "address":     agent_account.address,
        "eth_balance": float(w3.from_wei(bnb_wei, "ether")),
        "network":     "Arbitrum Sepolia",
        "chain_id":    CHAIN_ID,
    }

    if USDC_CONTRACT_ADDRESS:
        try:
            usdc = w3.eth.contract(
                address=Web3.to_checksum_address(USDC_CONTRACT_ADDRESS),
                abi=ERC20_ABI,
            )
            usdc_units = usdc.functions.balanceOf(agent_account.address).call()
            result["usdc_balance"] = usdc_units / 1_000_000
            result["usdc_units"]   = usdc_units
        except Exception as exc:
            result["usdc_balance"] = f"error: {exc}"
    else:
        result["usdc_balance"] = "USDC_CONTRACT_ADDRESS not configured"

    return result


if __name__ == "__main__":
    mcp.run()
