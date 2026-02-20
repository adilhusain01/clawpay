"""Database models for card and transaction state management."""
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    """Return current UTC datetime."""
    return datetime.now(timezone.utc)


class VirtualCard(SQLModel, table=True):
    """
    Represents a virtual card created via Lithic.

    Links an opBNB transaction to a Lithic virtual card,
    tracking the full lifecycle from creation to clearing and refund.

    NOTE: If migrating from the old schema, delete payclaw.db
    and let the app recreate it on startup.
    """

    __tablename__ = "virtual_cards"

    # Primary key
    id: str = Field(
        default_factory=lambda: str(uuid4()),
        primary_key=True,
        index=True,
    )

    # On-chain tracking (opBNB)
    tx_hash: str = Field(
        index=True,
        description="opBNB transaction hash of the deposit",
    )
    user_wallet_address: Optional[str] = Field(
        default=None,
        index=True,
        description="User's EVM wallet address (for refunds)",
    )
    session_id: Optional[str] = Field(
        default=None,
        index=True,
        description="Payment session ID used in the deposit call",
    )

    # Amounts
    amount_cents: int = Field(
        description="Payment amount in USD cents",
    )
    spend_limit_cents: Optional[int] = Field(
        default=None,
        description="Card spend limit in cents (amount + 5% buffer)",
    )
    usdc_paid: Optional[str] = Field(
        default=None,
        description="MockUSDC paid in smallest units (6 decimals), stored as string",
    )

    # Merchant
    merchant_name: Optional[str] = Field(default=None)

    # Lithic card details
    lithic_card_token: Optional[str] = Field(default=None, index=True)
    last_four: Optional[str] = Field(default=None)
    exp_month: Optional[str] = Field(default=None)
    exp_year: Optional[str] = Field(default=None)
    card_state: Optional[str] = Field(default=None)

    # Sensitive (sandbox only)
    card_pan: Optional[str] = Field(default=None)
    card_cvv: Optional[str] = Field(default=None)

    # Authorization lifecycle
    authorization_token: Optional[str] = Field(default=None)
    authorization_amount_cents: Optional[int] = Field(default=None)
    authorized_at: Optional[datetime] = Field(default=None)

    # Clearing lifecycle
    cleared: bool = Field(default=False)
    cleared_amount_cents: Optional[int] = Field(default=None)
    cleared_at: Optional[datetime] = Field(default=None)
    clearing_debug_id: Optional[str] = Field(default=None)

    # Buffer & Refund
    actual_charged_cents: Optional[int] = Field(default=None)
    refund_amount_cents: Optional[int] = Field(default=None)
    refund_tx: Optional[str] = Field(
        default=None,
        description="opBNB tx hash of the MockUSDC refund sent to the user",
    )
    refunded_at: Optional[datetime] = Field(default=None)

    # Audit
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    def mark_authorized(self, authorization_token: str, amount_cents: int) -> None:
        self.authorization_token = authorization_token
        self.authorization_amount_cents = amount_cents
        self.authorized_at = utc_now()
        self.updated_at = utc_now()

    def mark_cleared(self, amount_cents: int, clearing_debug_id: Optional[str] = None) -> None:
        self.cleared = True
        self.cleared_amount_cents = amount_cents
        self.cleared_at = utc_now()
        if clearing_debug_id:
            self.clearing_debug_id = clearing_debug_id
        self.updated_at = utc_now()
