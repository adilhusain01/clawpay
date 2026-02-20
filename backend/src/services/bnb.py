"""Arbitrum Sepolia service - MockUSDC payment verification and USDC refunds."""
import logging
from typing import Optional

from web3 import Web3

from ..config import settings

logger = logging.getLogger(__name__)

# USDC has 6 decimals: 1 USDC = 1_000_000 units = $1.00
USDC_DECIMALS = 6
USDC_UNIT = 10 ** USDC_DECIMALS  # 1_000_000

# ─────────────────────────────────────────────
# ABIs (minimal - only what we use)
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
    },
    {
        "inputs": [
            {"name": "recipient",  "type": "address"},
            {"name": "amount",     "type": "uint256"},
            {"name": "sessionId",  "type": "string"},
        ],
        "name": "refund",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True,  "name": "payer",     "type": "address"},
            {"indexed": False, "name": "amount",    "type": "uint256"},
            {"indexed": False, "name": "sessionId", "type": "string"},
            {"indexed": False, "name": "timestamp", "type": "uint256"},
        ],
        "name": "PaymentReceived",
        "type": "event",
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True,  "name": "recipient", "type": "address"},
            {"indexed": False, "name": "amount",    "type": "uint256"},
            {"indexed": False, "name": "sessionId", "type": "string"},
        ],
        "name": "Refunded",
        "type": "event",
    },
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
    {
        "inputs": [
            {"name": "from",   "type": "address"},
            {"name": "to",     "type": "address"},
            {"name": "amount", "type": "uint256"},
        ],
        "name": "transferFrom",
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [
            {"name": "to",     "type": "address"},
            {"name": "amount", "type": "uint256"},
        ],
        "name": "transfer",
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "nonpayable",
        "type": "function",
    },
]


# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────

def _inject_poa(w3: Web3) -> None:
    """Inject POA middleware - handles both web3.py v5 and v6."""
    try:
        from web3.middleware import ExtraDataToPOAMiddleware  # v6+
        w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
    except ImportError:
        from web3.middleware import geth_poa_middleware  # v5
        w3.middleware_onion.inject(geth_poa_middleware, layer=0)


def usd_to_usdc(usd_amount: float) -> int:
    """Convert a USD float to MockUSDC units (6 decimals). e.g. 52.50 → 52_500_000."""
    return int(round(usd_amount * USDC_UNIT))


def usdc_to_usd(usdc_amount: int) -> float:
    """Convert MockUSDC units to USD float. e.g. 52_500_000 → 52.50."""
    return usdc_amount / USDC_UNIT


def cents_to_usdc(cents: int) -> int:
    """Convert USD cents to MockUSDC units. e.g. 5250 cents → 52_500_000."""
    return cents * (USDC_UNIT // 100)  # cents * 10_000


# ─────────────────────────────────────────────
# Service
# ─────────────────────────────────────────────

class ArbitrumService:
    """
    Handles Arbitrum Sepolia interactions for ClawPay.

    Responsibilities:
    - Verify MockUSDC PaymentReceived events in transaction receipts
    - Send MockUSDC refunds from the platform wallet via the escrow contract
    """

    def __init__(self) -> None:
        self.w3 = Web3(Web3.HTTPProvider(settings.arb_rpc_url))
        _inject_poa(self.w3)
        self.chain_id = settings.arb_chain_id

        # Platform wallet (for sending USDC refunds)
        self.platform_account = None
        if settings.arb_platform_private_key:
            try:
                self.platform_account = self.w3.eth.account.from_key(
                    settings.arb_platform_private_key
                )
                logger.info(f"Arbitrum service ready. Platform: {self.platform_account.address}")
            except Exception as exc:
                logger.error(f"Failed to load platform key: {exc}")

        # Escrow contract
        self.contract = None
        if settings.arb_escrow_contract:
            self.contract = self.w3.eth.contract(
                address=Web3.to_checksum_address(settings.arb_escrow_contract),
                abi=ESCROW_ABI,
            )
            logger.info(f"Escrow contract: {settings.arb_escrow_contract}")
        else:
            logger.warning("ARB_ESCROW_CONTRACT not set - payment verification disabled")

        # MockUSDC contract
        self.usdc = None
        if settings.usdc_contract:
            self.usdc = self.w3.eth.contract(
                address=Web3.to_checksum_address(settings.usdc_contract),
                abi=ERC20_ABI,
            )
            logger.info(f"USDC contract: {settings.usdc_contract}")
        else:
            logger.warning("USDC_CONTRACT not set - USDC operations disabled")


    # ------------------------------------------------------------------
    # Payment verification
    # ------------------------------------------------------------------

    def verify_payment(
        self,
        tx_hash: str,
        session_id: str,
        min_usdc: int = 0,
    ) -> dict:
        """
        Verify that tx_hash contains a valid PaymentReceived event for session_id.

        Args:
            tx_hash:    Arbitrum Sepolia transaction hash (0x...)
            session_id: Expected session ID inside the event
            min_usdc:   Minimum acceptable payment in USDC units (0 = no minimum)

        Returns:
            {
                "payer":        "0x...",
                "paid_usdc":    52_500_000,
                "paid_usd":     52.50,
                "session_id":   "uuid",
                "block_number": 12345678,
            }

        Raises:
            ValueError: on any verification failure
        """
        if not self.contract:
            raise ValueError("Escrow contract not configured (ARB_ESCROW_CONTRACT)")

        # Fetch receipt
        try:
            receipt = self.w3.eth.get_transaction_receipt(tx_hash)
        except Exception as exc:
            raise ValueError(f"Transaction not found: {tx_hash} - {exc}")

        if receipt is None:
            raise ValueError(f"Transaction receipt not found: {tx_hash}")

        if receipt["status"] != 1:
            raise ValueError(f"Transaction reverted: {tx_hash}")

        # Verify destination is the escrow contract
        if receipt["to"].lower() != settings.arb_escrow_contract.lower():
            raise ValueError(
                f"Transaction sent to {receipt['to']}, "
                f"expected escrow {settings.arb_escrow_contract}"
            )

        # Parse PaymentReceived event
        try:
            events = self.contract.events.PaymentReceived().process_receipt(receipt)
        except Exception as exc:
            raise ValueError(f"Failed to parse PaymentReceived event: {exc}")

        if not events:
            raise ValueError("No PaymentReceived event in transaction")

        event = events[0]
        if event["args"]["sessionId"] != session_id:
            raise ValueError(
                f"Session ID mismatch: got '{event['args']['sessionId']}', "
                f"expected '{session_id}'"
            )

        paid_usdc = event["args"]["amount"]
        if paid_usdc < min_usdc:
            raise ValueError(
                f"Underpayment: got {paid_usdc} USDC units, minimum {min_usdc}"
            )

        return {
            "payer":        event["args"]["payer"],
            "paid_usdc":    paid_usdc,
            "paid_usd":     usdc_to_usd(paid_usdc),
            "session_id":   session_id,
            "block_number": receipt["blockNumber"],
        }

    # ------------------------------------------------------------------
    # Refunds
    # ------------------------------------------------------------------

    def send_refund(
        self,
        recipient: str,
        usdc_amount: int,
        session_id: str,
    ) -> dict:
        """
        Send a MockUSDC refund to a user via the escrow contract.

        Args:
            recipient:   User's EVM address
            usdc_amount: Amount in USDC units to refund
            session_id:  Original session ID (emitted in Refunded event)

        Returns:
            {"success": True, "tx_hash": "0x...", "amount_usd": 2.50, "recipient": "0x..."}
        """
        if not self.platform_account:
            raise ValueError("Platform account not configured (ARB_PLATFORM_PRIVATE_KEY)")
        if not self.contract:
            raise ValueError("Escrow contract not configured (ARB_ESCROW_CONTRACT)")

        checksum_recipient = Web3.to_checksum_address(recipient)
        nonce = self.w3.eth.get_transaction_count(self.platform_account.address)

        tx = self.contract.functions.refund(
            checksum_recipient,
            usdc_amount,
            session_id,
        ).build_transaction(
            {
                "chainId":  self.chain_id,
                "gas":      120_000,
                "gasPrice": self.w3.eth.gas_price,
                "nonce":    nonce,
            }
        )

        signed = self.platform_account.sign_transaction(tx)
        raw_tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = self.w3.eth.wait_for_transaction_receipt(raw_tx_hash)

        if receipt["status"] != 1:
            raise RuntimeError(f"Refund transaction reverted: {raw_tx_hash.hex()}")

        return {
            "success":    True,
            "tx_hash":    raw_tx_hash.hex(),
            "amount_usd": usdc_to_usd(usdc_amount),
            "recipient":  recipient,
        }

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------

    def is_connected(self) -> bool:
        try:
            return self.w3.is_connected()
        except Exception:
            return False


arb_service = ArbitrumService()
