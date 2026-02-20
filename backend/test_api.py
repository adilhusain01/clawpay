#!/usr/bin/env python3
"""
Quick test script for the payclaw Backend API.
Run this after starting the server with: uvicorn src.main:app --reload
"""
import requests
import json
import sys

API_BASE = "http://localhost:8000"
API_KEY = "sk_payclaw_dev_b03352ef1d68164c675023b82538ea3d1d1902f69bc408b7"

headers = {
    "X-API-Key": API_KEY,
    "Content-Type": "application/json"
}

def test_health():
    """Test the health endpoint."""
    print("Testing health endpoint...")
    response = requests.get(f"{API_BASE}/health")
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    print()

def test_initiate_payment():
    """Test initiating a payment session."""
    print("Testing payment initiate endpoint...")
    payload = {
        "amount_usd": 10.00,
        "user_wallet_address": "0x1234567890abcdef1234567890abcdef12345678",
        "merchant_name": "Test Merchant"
    }

    try:
        response = requests.post(
            f"{API_BASE}/api/v1/payment/initiate",
            headers=headers,
            json=payload
        )
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            print(f"Response: {json.dumps(data, indent=2)}")
            return data.get("session_id")
        else:
            print(f"Error: {response.text}")
    except Exception as e:
        print(f"Error: {e}")
    print()
    return None

def test_confirm_payment(session_id: str):
    """Test confirming a payment (will fail without a real tx hash)."""
    print("Testing payment confirm endpoint...")
    payload = {
        "session_id": session_id,
        "tx_hash": "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        "user_wallet_address": "0x1234567890abcdef1234567890abcdef12345678"
    }

    try:
        response = requests.post(
            f"{API_BASE}/api/v1/payment/confirm",
            headers=headers,
            json=payload
        )
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            print(f"Response: {json.dumps(response.json(), indent=2)}")
        else:
            print(f"Error: {response.text}")
    except Exception as e:
        print(f"Error: {e}")
    print()

def test_list_cards():
    """Test listing all cards."""
    print("Testing list cards endpoint...")
    response = requests.get(f"{API_BASE}/api/v1/cards", headers=headers)
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    print()

if __name__ == "__main__":
    print("=" * 60)
    print("payclaw Backend API Tests")
    print("=" * 60)
    print()

    try:
        test_health()
        test_list_cards()

        print("Note: Payment confirm will fail without a real opBNB tx hash.")
        print("   Deploy the escrow contract and set BNB_ESCROW_CONTRACT in .env.")
        print()
        session_id = test_initiate_payment()
        if session_id:
            test_confirm_payment(session_id)

        print("=" * 60)
        print("All basic tests completed!")
        print("=" * 60)

    except requests.exceptions.ConnectionError:
        print("Error: Could not connect to server.")
        print("   Make sure the server is running: uvicorn src.main:app --reload")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
