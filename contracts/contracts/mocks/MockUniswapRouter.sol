// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IMintable {
    function mint(address to, uint256 amount) external;
}

/// @dev Swap router mock: accepts any input token and returns outputToken
///      at a 1:100 ratio. The outputToken must be a MockERC20 (freely mintable).
///      For the real MoveToken tests, pre-fund this contract with MOVE via seedLiquidity.
contract MockUniswapRouter {
    // When set, router calls mint() on output token instead of transferring
    bool public useMint;

    function setUseMint(bool v) external { useMint = v; }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 /* amountOutMin */,
        address[] calldata path,
        address to,
        uint256 /* deadline */
    ) external returns (uint256[] memory amounts) {
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = amountIn * 100; // 100× rate

        // Pull input token
        IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);

        // Push output token
        if (useMint) {
            IMintable(path[1]).mint(to, amounts[1]);
        } else {
            IERC20(path[1]).transfer(to, amounts[1]);
        }
    }
}
