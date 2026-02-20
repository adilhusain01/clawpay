"""
PayClaw Backend API - Arbitrum Sepolia + Lithic virtual card bridge.

Payment flow:
  1. POST /api/v1/payment/initiate  → returns session_id, contract address, USDC amount
  2. Agent approves MockUSDC spending, then calls escrow.deposit(sessionId, amount)
  3. POST /api/v1/payment/confirm   → verifies PaymentReceived event, issues Lithic card
  4. Lithic webhook fires on settlement → unused buffer refunded as MockUSDC
"""
import hashlib
import hmac
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.security import APIKeyHeader
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlmodel import Session, SQLModel, create_engine, select

from .config import settings
from .models import VirtualCard
from .services.lithic import lithic_service
from .services.bnb import arb_service, usd_to_usdc, usdc_to_usd, cents_to_usdc

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# Database
# ─────────────────────────────────────────────

engine = create_engine(
    settings.database_url,
    echo=False,
    connect_args=(
        {"check_same_thread": False}
        if settings.database_url.startswith("sqlite")
        else {}
    ),
)


def get_db():
    with Session(engine) as session:
        yield session


# ─────────────────────────────────────────────
# Auth
# ─────────────────────────────────────────────

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def verify_api_key(x_api_key: Optional[str] = Depends(api_key_header)) -> None:
    if not x_api_key or x_api_key != settings.api_key:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing API key")


# ─────────────────────────────────────────────
# Pydantic schemas
# ─────────────────────────────────────────────


class InitiatePaymentRequest(BaseModel):
    amount_usd: float = Field(..., gt=0, description="Payment amount in USD")
    user_wallet_address: str = Field(..., description="User's EVM wallet address (0x...)")
    merchant_name: Optional[str] = Field(None, description="Merchant name for display")


class InitiatePaymentResponse(BaseModel):
    session_id: str
    contract_address: str
    usdc_contract: str           # MockUSDC token address to approve
    usdc_amount: str             # USDC units as string - safe for JS BigInt
    usdc_amount_display: str     # human-readable, e.g. "52.50 USDC"
    amount_usd_with_buffer: float
    expires_at: datetime
    chain_id: int


class ConfirmPaymentRequest(BaseModel):
    session_id: str = Field(..., description="Session ID from initiate")
    tx_hash: str = Field(..., description="Arbitrum Sepolia transaction hash (0x...)")
    user_wallet_address: str = Field(..., description="User's EVM wallet address (for refunds)")


class CardInfoResponse(BaseModel):
    token: Optional[str] = None
    last_four: Optional[str] = None
    exp_month: Optional[str] = None
    exp_year: Optional[str] = None
    state: Optional[str] = None
    pan: Optional[str] = None
    cvv: Optional[str] = None


class AuthorizationInfo(BaseModel):
    token: Optional[str] = None
    amount_cents: Optional[int] = None
    authorized_at: Optional[datetime] = None


class ClearingInfo(BaseModel):
    cleared: bool = False
    amount_cents: Optional[int] = None
    cleared_at: Optional[datetime] = None
    debug_id: Optional[str] = None


class VirtualCardResponse(BaseModel):
    id: str
    tx_hash: str
    session_id: Optional[str] = None
    amount_cents: int
    spend_limit_cents: Optional[int] = None
    merchant_name: Optional[str] = None
    card: Optional[CardInfoResponse] = None
    authorization: Optional[AuthorizationInfo] = None
    clearing: Optional[ClearingInfo] = None
    created_at: datetime
    updated_at: datetime


class SimulateAuthorizationRequest(BaseModel):
    amount_cents: int = Field(..., gt=0)
    descriptor: str = Field(..., min_length=1, max_length=40)
    mcc: str = Field("5999", min_length=4, max_length=4)


class SimulateAuthorizationResponse(BaseModel):
    transaction_token: str
    debugging_request_id: Optional[str] = None


class SimulateClearingRequest(BaseModel):
    amount_cents: int = Field(..., gt=0)


class SimulateClearingResponse(BaseModel):
    cleared: bool
    debugging_request_id: Optional[str] = None


# ─────────────────────────────────────────────
# App
# ─────────────────────────────────────────────

app = FastAPI(
    title="PayClaw API",
    description="Arbitrum Sepolia → Lithic virtual card bridge",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

static_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")
if os.path.exists(static_path):
    app.mount("/static", StaticFiles(directory=static_path), name="static")


@app.on_event("startup")
def on_startup() -> None:
    SQLModel.metadata.create_all(engine)
    logger.info(
        f"PayClaw started - chain: Arbitrum Sepolia ({settings.arb_chain_id}), "
        f"escrow: {settings.arb_escrow_contract or 'NOT SET'}, "
        f"usdc: {settings.usdc_contract or 'NOT SET'}"
    )


# ─────────────────────────────────────────────
# Health
# ─────────────────────────────────────────────


@app.get("/", include_in_schema=False)
def root():
    p = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "index.html")
    return FileResponse(p) if os.path.exists(p) else {"message": "PayClaw API", "docs": "/docs"}


@app.get("/health", tags=["Health"])
def health_check():
    return {
        "status": "ok",
        "chain": f"Arbitrum Sepolia ({settings.arb_chain_id})",
        "rpc_connected": arb_service.is_connected(),
        "escrow_contract": settings.arb_escrow_contract or "not configured",
        "usdc_contract": settings.usdc_contract or "not configured",
        "lithic_environment": settings.lithic_environment,
        "timestamp": datetime.utcnow().isoformat(),
    }


# ─────────────────────────────────────────────
# Payment - Initiate
# ─────────────────────────────────────────────


@app.post(
    "/api/v1/payment/initiate",
    response_model=InitiatePaymentResponse,
    tags=["Payment"],
    dependencies=[Depends(verify_api_key)],
)
async def initiate_payment(req: InitiatePaymentRequest) -> InitiatePaymentResponse:
    """
    Start a new payment session.

    Returns the MockUSDC amount the agent must approve and deposit.
    USD amount + 5% buffer for tax / fee slippage.

    Agent flow:
      1. usdc.approve(contract_address, usdc_amount)
      2. escrow.deposit(session_id, usdc_amount)
      3. POST /api/v1/payment/confirm with tx_hash
    """
    if not settings.arb_escrow_contract:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="Escrow contract not configured")
    if not settings.usdc_contract:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="USDC contract not configured")

    amount_with_buffer = req.amount_usd * 1.05
    usdc_amount = usd_to_usdc(amount_with_buffer)
    session_id = str(uuid4())

    logger.info(
        f"Payment initiated: session={session_id}, "
        f"${req.amount_usd} → {amount_with_buffer:.2f} USDC ({usdc_amount} units)"
    )

    return InitiatePaymentResponse(
        session_id=session_id,
        contract_address=settings.arb_escrow_contract,
        usdc_contract=settings.usdc_contract,
        usdc_amount=str(usdc_amount),
        usdc_amount_display=f"{amount_with_buffer:.2f} USDC",
        amount_usd_with_buffer=round(amount_with_buffer, 2),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
        chain_id=settings.arb_chain_id,
    )


# ─────────────────────────────────────────────
# Payment - Confirm
# ─────────────────────────────────────────────


@app.post(
    "/api/v1/payment/confirm",
    tags=["Payment"],
    dependencies=[Depends(verify_api_key)],
)
async def confirm_payment(
    req: ConfirmPaymentRequest,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    Verify an on-chain deposit and issue a Lithic virtual card.

    1. Checks the tx_hash hasn't been used before (anti-replay).
    2. Verifies the PaymentReceived event on opBNB matches the session_id.
    3. Converts paid wei → USD at current BNB price.
    4. Creates a Lithic SINGLE_USE card with a 5 % spend-limit buffer.
    5. Saves to DB and returns full card details.
    """
    # Anti-replay: ensure tx_hash not already used
    existing = db.exec(select(VirtualCard).where(VirtualCard.tx_hash == req.tx_hash)).first()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Transaction already used")

    # Verify on-chain
    try:
        payment = bnb_service.verify_payment(
            tx_hash=req.tx_hash,
            session_id=req.session_id,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc))

    # USDC is 1:1 with USD - no price oracle needed
    amount_usd = payment["paid_usd"]
    amount_cents = int(amount_usd * 100)
    spend_limit_cents = int(amount_cents * 1.05)

    logger.info(
        f"Payment verified: session={req.session_id}, "
        f"{payment['paid_usdc']} USDC units = ${amount_usd:.2f}"
    )

    # Create Lithic card
    try:
        card_data = lithic_service.create_virtual_card(
            memo=f"PayClaw {req.session_id[:8]}",
            spend_limit_cents=spend_limit_cents,
        )
    except Exception as exc:
        logger.error(f"Lithic card creation failed: {exc}", exc_info=True)
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Card creation failed: {exc}",
        )

    # Persist
    record = VirtualCard(
        tx_hash=req.tx_hash,
        session_id=req.session_id,
        user_wallet_address=req.user_wallet_address,
        amount_cents=amount_cents,
        spend_limit_cents=spend_limit_cents,
        usdc_paid=str(payment["paid_usdc"]),
        lithic_card_token=card_data.get("token"),
        last_four=card_data.get("last_four"),
        exp_month=str(card_data.get("exp_month", "")).zfill(2),
        exp_year=str(card_data.get("exp_year", "")),
        card_state=card_data.get("state"),
        card_pan=card_data.get("pan"),
        card_cvv=card_data.get("cvv"),
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    logger.info(f"Card issued: ...{record.last_four} for session {req.session_id}")

    return {
        "success": True,
        "tx_hash": req.tx_hash,
        "amount_usd": round(amount_usd, 2),
        "card": {
            "pan":       card_data.get("pan"),
            "cvv":       card_data.get("cvv"),
            "exp_month": record.exp_month,
            "exp_year":  record.exp_year,
            "last_four": card_data.get("last_four"),
            "token":     card_data.get("token"),
            "state":     card_data.get("state"),
        },
    }


# ─────────────────────────────────────────────
# Cards
# ─────────────────────────────────────────────


def _card_response(card: VirtualCard) -> VirtualCardResponse:
    card_info = (
        CardInfoResponse(
            token=card.lithic_card_token,
            last_four=card.last_four,
            exp_month=card.exp_month,
            exp_year=card.exp_year,
            state=card.card_state,
            pan=card.card_pan,
            cvv=card.card_cvv,
        )
        if card.lithic_card_token
        else None
    )
    auth_info = (
        AuthorizationInfo(
            token=card.authorization_token,
            amount_cents=card.authorization_amount_cents,
            authorized_at=card.authorized_at,
        )
        if card.authorization_token
        else None
    )
    clearing_info = ClearingInfo(
        cleared=card.cleared,
        amount_cents=card.cleared_amount_cents,
        cleared_at=card.cleared_at,
        debug_id=card.clearing_debug_id,
    )
    return VirtualCardResponse(
        id=card.id,
        tx_hash=card.tx_hash,
        session_id=card.session_id,
        amount_cents=card.amount_cents,
        spend_limit_cents=card.spend_limit_cents,
        merchant_name=card.merchant_name,
        card=card_info,
        authorization=auth_info,
        clearing=clearing_info,
        created_at=card.created_at,
        updated_at=card.updated_at,
    )


@app.get(
    "/api/v1/cards",
    response_model=List[VirtualCardResponse],
    tags=["Cards"],
    dependencies=[Depends(verify_api_key)],
)
def list_cards(
    db: Session = Depends(get_db),
    limit: int = 100,
    offset: int = 0,
    session_id: Optional[str] = None,
    tx_hash: Optional[str] = None,
) -> List[VirtualCardResponse]:
    stmt = select(VirtualCard)
    if session_id:
        stmt = stmt.where(VirtualCard.session_id == session_id)
    elif tx_hash:
        stmt = stmt.where(VirtualCard.tx_hash == tx_hash)
    return [_card_response(c) for c in db.exec(stmt.offset(offset).limit(limit)).all()]


@app.get(
    "/api/v1/cards/{card_id}",
    response_model=VirtualCardResponse,
    tags=["Cards"],
    dependencies=[Depends(verify_api_key)],
)
def get_card(card_id: str, db: Session = Depends(get_db)) -> VirtualCardResponse:
    card = db.get(VirtualCard, card_id)
    if not card:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Card {card_id} not found")
    return _card_response(card)


@app.post(
    "/api/v1/cards/test-payment",
    tags=["Cards"],
    dependencies=[Depends(verify_api_key)],
)
def test_payment(request: Dict[str, Any]) -> Dict[str, Any]:
    """Simulate a Lithic sandbox authorization + clearing against a card PAN."""
    import time

    pan = request.get("pan")
    amount_cents = request.get("amount_cents")
    if not pan or not amount_cents:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="pan and amount_cents required")

    auth = lithic_service.simulate_authorization(
        pan=pan, amount_cents=amount_cents, descriptor="TEST MERCHANT"
    )

    time.sleep(2)
    cleared = False
    try:
        lithic_service.simulate_clearing(
            transaction_token=auth["token"], amount_cents=amount_cents
        )
        cleared = True
    except Exception as exc:
        logger.warning(f"Clearing skipped: {exc}")

    return {
        "success": True,
        "message": f"Test payment of ${amount_cents/100:.2f} authorized",
        "transaction_token": auth.get("token"),
        "status": "CLEARED" if cleared else "AUTHORIZED",
    }


@app.post(
    "/api/v1/cards/{card_id}/simulate/authorize",
    response_model=SimulateAuthorizationResponse,
    tags=["Testing"],
    dependencies=[Depends(verify_api_key)],
)
def simulate_authorization(
    card_id: str,
    req: SimulateAuthorizationRequest,
    db: Session = Depends(get_db),
) -> SimulateAuthorizationResponse:
    card = db.get(VirtualCard, card_id)
    if not card:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Card {card_id} not found")
    if not card.card_pan:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Card PAN not available")

    auth = lithic_service.simulate_authorization(
        pan=card.card_pan, amount_cents=req.amount_cents, descriptor=req.descriptor, mcc=req.mcc
    )
    card.mark_authorized(auth["token"], req.amount_cents)
    db.commit()

    return SimulateAuthorizationResponse(
        transaction_token=auth["token"],
        debugging_request_id=auth.get("debugging_request_id"),
    )


@app.post(
    "/api/v1/cards/{card_id}/simulate/clear",
    response_model=SimulateClearingResponse,
    tags=["Testing"],
    dependencies=[Depends(verify_api_key)],
)
def simulate_clearing(
    card_id: str,
    req: SimulateClearingRequest,
    db: Session = Depends(get_db),
) -> SimulateClearingResponse:
    card = db.get(VirtualCard, card_id)
    if not card:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Card {card_id} not found")
    if not card.authorization_token:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="No authorization found. Call /simulate/authorize first.")

    result = lithic_service.simulate_clearing(
        transaction_token=card.authorization_token, amount_cents=req.amount_cents
    )
    card.mark_cleared(req.amount_cents, result.get("debugging_request_id"))
    db.commit()

    return SimulateClearingResponse(cleared=True, debugging_request_id=result.get("debugging_request_id"))


# ─────────────────────────────────────────────
# Lithic Webhooks - Buffer & Refund
# ─────────────────────────────────────────────


def _verify_lithic_signature(payload: bytes, signature: str, secret: str) -> bool:
    if not secret:
        logger.warning("Webhook secret not set - skipping verification (dev mode)")
        return True
    expected = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature, expected)


@app.post("/webhooks/lithic", tags=["Webhooks"], include_in_schema=False)
async def lithic_webhook(
    request: Request,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    body = await request.body()
    signature = request.headers.get("X-Lithic-Signature", "")

    if not _verify_lithic_signature(body, signature, settings.lithic_webhook_secret):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid webhook signature")

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid JSON")

    event_type = payload.get("event_type")
    logger.info(f"Lithic webhook: {event_type}")

    if event_type == "transaction.settled":
        return await _handle_settled(payload, db)
    elif event_type in ("transaction.authorization", "card.state_changed"):
        return {"status": "logged"}
    return {"status": "ignored"}


async def _handle_settled(payload: Dict[str, Any], db: Session) -> Dict[str, Any]:
    """
    On settlement:
    1. Find card in DB by Lithic card token.
    2. Calculate unused buffer (spend_limit − actual_charged).
    3. Send tBNB refund via escrow contract if buffer > 0.
    """
    card_token = payload.get("card_token")
    actual_cents = payload.get("amount")

    if not card_token or actual_cents is None:
        return {"status": "error", "reason": "missing_fields"}

    card = db.exec(
        select(VirtualCard).where(VirtualCard.lithic_card_token == card_token)
    ).first()

    if not card:
        logger.warning(f"Webhook: card not found for token {card_token}")
        return {"status": "error", "reason": "card_not_found"}

    card.actual_charged_cents = actual_cents
    card.updated_at = datetime.utcnow()

    spend_limit = card.spend_limit_cents or card.amount_cents
    refund_cents = spend_limit - actual_cents

    logger.info(
        f"Settlement: limit=${spend_limit/100:.2f}, "
        f"charged=${actual_cents/100:.2f}, "
        f"refund=${refund_cents/100:.2f}"
    )

    if refund_cents > 0 and card.user_wallet_address:
        try:
            refund_usdc = cents_to_usdc(refund_cents)

            result = bnb_service.send_refund(
                recipient=card.user_wallet_address,
                usdc_amount=refund_usdc,
                session_id=card.session_id or card.id,
            )

            card.refund_amount_cents = refund_cents
            card.refund_tx = result["tx_hash"]
            card.refunded_at = datetime.utcnow()
            db.commit()

            logger.info(
                f"Refund sent: ${result['amount_usd']:.2f} USDC "
                f"to {card.user_wallet_address[:10]}... "
                f"tx: {result['tx_hash'][:16]}..."
            )
            return {
                "status": "refunded",
                "refund_amount_cents": refund_cents,
                "refund_usd": result["amount_usd"],
                "refund_tx": result["tx_hash"],
            }
        except Exception as exc:
            logger.error(f"Refund failed: {exc}")
            db.commit()
            return {"status": "refund_failed", "error": str(exc)}

    elif refund_cents <= 0:
        db.commit()
        return {"status": "no_refund_needed"}
    else:
        db.commit()
        return {"status": "no_wallet_address_for_refund"}
