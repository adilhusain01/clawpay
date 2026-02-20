"""Application configuration using Pydantic Settings."""
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # API Security
    api_key: str = "changeme"

    # Lithic Configuration
    lithic_api_key: str = ""
    lithic_environment: Literal["sandbox", "production"] = "sandbox"
    lithic_webhook_secret: str = ""

    # Arbitrum Sepolia Configuration
    arb_rpc_url: str = "https://arbitrum-sepolia-testnet.api.pocket.network"
    arb_chain_id: int = 421614
    # Platform wallet private key (hex, with or without 0x) - used to send refunds
    arb_platform_private_key: str = ""
    # Deployed PayClawEscrow contract address (0x...)
    arb_escrow_contract: str = ""
    # Deployed MockUSDC contract address (0x...)
    usdc_contract: str = ""

    # Database
    database_url: str = "sqlite:///./payclaw.db"

    # Server
    host: str = "0.0.0.0"
    port: int = 8000

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


settings = Settings()
