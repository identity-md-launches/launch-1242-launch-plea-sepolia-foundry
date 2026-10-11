// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface PreviewToken {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

/// @notice Never deployed or sent as a transaction. eth_call temporarily installs this code at
/// the connected account using a state override. The router still sees the actual buyer as its
/// caller, and the hook's direct PLEA delivery is measured from that buyer's token balance.
contract BalancePreview {
    function preview(address router, address input, address output, uint256 amount, bytes calldata data)
        external returns (uint256 received, uint256 spent, bytes memory callResult)
    {
        require(msg.sender == address(this), "Preview only");
        uint256 beforeOutput = PreviewToken(output).balanceOf(address(this));
        uint256 beforeInput = PreviewToken(input).balanceOf(address(this));
        require(beforeInput >= amount, "Insufficient token balance");
        require(PreviewToken(input).approve(router, amount), "Approval failed");
        (bool success, bytes memory result) = router.call(data);
        if (!success) assembly ("memory-safe") { revert(add(result, 32), mload(result)) }
        received = PreviewToken(output).balanceOf(address(this)) - beforeOutput;
        spent = beforeInput - PreviewToken(input).balanceOf(address(this));
        callResult = result;
    }
}
