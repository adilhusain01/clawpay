// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockUSDC
 * @notice Test ERC-20 token mimicking USDC on opBNB Testnet.
 *
 *   - Symbol  : USDC
 *   - Decimals: 6  (1 USDC = 1_000_000 units, same as real USDC)
 *   - Minting : owner-only (call mint() to fund agent wallets)
 *
 * Deploy this first, then pass its address to PayClawEscrow's constructor.
 *
 * opBNB Testnet:
 *   ChainID : 5611 (0x15eb)
 *   RPC     : https://opbnb-testnet-rpc.bnbchain.org
 *   Explorer: https://testnet.opbnbscan.com
 */
contract MockUSDC {
    string public constant name     = "Mock USD Coin";
    string public constant symbol   = "USDC";
    uint8  public constant decimals = 6;

    address public owner;
    uint256 public totalSupply;

    mapping(address => uint256)                     public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    modifier onlyOwner() {
        require(msg.sender == owner, "MockUSDC: not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // -------------------------
    // Owner
    // -------------------------

    /**
     * @notice Mint USDC to any address. Owner only.
     * @param to     Recipient address
     * @param amount Amount in USDC units (e.g. 100_000_000 = 100 USDC)
     */
    function mint(address to, uint256 amount) external onlyOwner {
        totalSupply   += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "MockUSDC: zero address");
        owner = newOwner;
    }

    // -------------------------
    // ERC-20
    // -------------------------

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        return _transfer(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "MockUSDC: allowance exceeded");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        return _transfer(from, to, amount);
    }

    // -------------------------
    // Internal
    // -------------------------

    function _transfer(address from, address to, uint256 amount) internal returns (bool) {
        require(balanceOf[from] >= amount, "MockUSDC: insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to]   += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}
