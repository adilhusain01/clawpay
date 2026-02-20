// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title PayClawEscrow
 * @notice Escrow contract for PayClaw payments on opBNB Testnet (chainId: 5611)
 * @dev Users approve this contract to spend their MockUSDC, then call deposit().
 *      The backend listens for PaymentReceived events, creates a Lithic virtual
 *      card, and refunds any unused buffer in USDC after the merchant charges.
 *
 * Deploy order:
 *   1. Deploy MockUSDC.sol  → get USDC address
 *   2. Deploy PayClawEscrow(usdcAddress)
 *   3. Call MockUSDC.mint(agentWallet, amount) to fund the agent
 *
 * opBNB Testnet:
 *   ChainID : 5611 (0x15eb)
 *   RPC     : https://opbnb-testnet-rpc.bnbchain.org
 *   Explorer: https://testnet.opbnbscan.com
 */

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract PayClawEscrow {
    address public owner;
    IERC20  public usdc;

    // -------------------------
    // Events
    // -------------------------

    /**
     * @notice Emitted when a user deposits USDC for a payment session.
     * @param payer     The depositing wallet address
     * @param amount    Amount in USDC units (6 decimals)
     * @param sessionId Unique session ID from the PayClaw backend
     * @param timestamp Block timestamp of the deposit
     */
    event PaymentReceived(
        address indexed payer,
        uint256 amount,
        string  sessionId,
        uint256 timestamp
    );

    /**
     * @notice Emitted when a USDC refund is sent back to a user.
     * @param recipient Wallet that received the refund
     * @param amount    Amount refunded in USDC units
     * @param sessionId Original session ID
     */
    event Refunded(
        address indexed recipient,
        uint256 amount,
        string  sessionId
    );

    // -------------------------
    // Modifiers
    // -------------------------

    modifier onlyOwner() {
        require(msg.sender == owner, "PayClawEscrow: not owner");
        _;
    }

    // -------------------------
    // Constructor
    // -------------------------

    /**
     * @param _usdc Address of the MockUSDC (or real USDC) token contract
     */
    constructor(address _usdc) {
        require(_usdc != address(0), "PayClawEscrow: zero usdc address");
        owner = msg.sender;
        usdc  = IERC20(_usdc);
    }

    // -------------------------
    // User-facing
    // -------------------------

    /**
     * @notice Deposit USDC for a payment session.
     *         Caller must have called usdc.approve(escrowAddress, amount) first.
     * @param sessionId Unique session ID from POST /api/v1/payment/initiate
     * @param amount    USDC amount in units (e.g. 52_500_000 = $52.50)
     */
    function deposit(string calldata sessionId, uint256 amount) external {
        require(amount > 0, "PayClawEscrow: amount must be > 0");
        require(
            usdc.transferFrom(msg.sender, address(this), amount),
            "PayClawEscrow: USDC transfer failed - did you approve?"
        );
        emit PaymentReceived(msg.sender, amount, sessionId, block.timestamp);
    }

    // -------------------------
    // Platform-only
    // -------------------------

    /**
     * @notice Refund unused USDC buffer to a user after card settlement.
     *         Called by the platform wallet from the Lithic webhook handler.
     * @param recipient  User's wallet address
     * @param amount     USDC amount in units to refund
     * @param sessionId  Original session ID (for event tracking)
     */
    function refund(
        address recipient,
        uint256 amount,
        string calldata sessionId
    ) external onlyOwner {
        require(
            usdc.transfer(recipient, amount),
            "PayClawEscrow: USDC refund failed"
        );
        emit Refunded(recipient, amount, sessionId);
    }

    /**
     * @notice Withdraw USDC to the owner wallet.
     * @param amount USDC amount in units to withdraw
     */
    function withdraw(uint256 amount) external onlyOwner {
        require(
            usdc.transfer(owner, amount),
            "PayClawEscrow: USDC withdraw failed"
        );
    }

    /**
     * @notice Transfer contract ownership to a new address.
     * @param newOwner New owner wallet
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "PayClawEscrow: zero address");
        owner = newOwner;
    }
}
