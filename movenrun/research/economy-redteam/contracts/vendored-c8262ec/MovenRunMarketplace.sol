// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IMovenRunToken} from "./interfaces/IMovenRunToken.sol";
import {IMovenRunDeed} from "./interfaces/IMovenRunDeed.sol";

/// @title MovenRunMarketplace
/// @notice Minimal voluntary secondary transfer of deeds that already exist.
/// @dev Initial deeds are never sold by MovenRun; this contract only moves deeds between
///      holders. It takes no protocol fee, never holds a deed, and never holds seller
///      proceeds: payment goes straight from buyer to seller in the same call. Purchases
///      settle in MOVE, so the token's own transfer rules apply and locked MOVE can never
///      pay for a deed. A listing whose deed has since moved, including into contest
///      escrow, fails closed. There is no administrator, no seizure path and no pause, so
///      voluntary transfers stay available even while claims or settlements are paused.
contract MovenRunMarketplace is ReentrancyGuard {
    struct Listing {
        address seller;
        uint256 price;
    }

    /// @notice The MovenRun MOVE token used for settlement.
    IMovenRunToken public immutable moveToken;
    /// @notice The deed collection traded through this contract.
    IMovenRunDeed public immutable deed;

    mapping(uint256 tokenId => Listing listing) private _listings;

    event DeedListed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event DeedListingCancelled(uint256 indexed tokenId, address indexed seller);
    event DeedSold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price);

    error ZeroAddress();
    error ZeroPrice();
    error NotDeedHolder(address holder, address caller);
    error MarketplaceNotApproved(uint256 tokenId);
    error ListingNotFound(uint256 tokenId);
    error NotListingSeller(address seller, address caller);
    error ListingStale(uint256 tokenId, address currentHolder, address listedSeller);
    error PriceAboveMaximum(uint256 price, uint256 maxPrice);
    error PaymentFailed();
    error SelfPurchase();

    constructor(address moveToken_, address deed_) {
        if (moveToken_ == address(0) || deed_ == address(0)) revert ZeroAddress();
        moveToken = IMovenRunToken(moveToken_);
        deed = IMovenRunDeed(deed_);
    }

    /// @notice Lists a deed the caller currently holds at a fixed MOVE price.
    function list(uint256 tokenId, uint256 price) external {
        if (price == 0) revert ZeroPrice();

        address holder = deed.ownerOf(tokenId);
        if (holder != msg.sender) revert NotDeedHolder(holder, msg.sender);
        if (
            deed.getApproved(tokenId) != address(this) &&
            !deed.isApprovedForAll(msg.sender, address(this))
        ) revert MarketplaceNotApproved(tokenId);

        _listings[tokenId] = Listing({seller: msg.sender, price: price});

        emit DeedListed(tokenId, msg.sender, price);
    }

    /// @notice Withdraws the caller's own listing.
    function cancelListing(uint256 tokenId) external {
        Listing memory listing = _listings[tokenId];
        if (listing.seller == address(0)) revert ListingNotFound(tokenId);
        if (listing.seller != msg.sender) revert NotListingSeller(listing.seller, msg.sender);

        delete _listings[tokenId];

        emit DeedListingCancelled(tokenId, msg.sender);
    }

    /// @notice Buys a listed deed, paying the seller directly in MOVE.
    /// @param maxPrice Highest price the caller is willing to pay.
    function buy(uint256 tokenId, uint256 maxPrice) external nonReentrant {
        Listing memory listing = _listings[tokenId];
        if (listing.seller == address(0)) revert ListingNotFound(tokenId);
        if (listing.seller == msg.sender) revert SelfPurchase();
        if (listing.price > maxPrice) revert PriceAboveMaximum(listing.price, maxPrice);

        address holder = deed.ownerOf(tokenId);
        if (holder != listing.seller) revert ListingStale(tokenId, holder, listing.seller);

        delete _listings[tokenId];

        if (!moveToken.transferFrom(msg.sender, listing.seller, listing.price)) revert PaymentFailed();
        deed.safeTransferFrom(listing.seller, msg.sender, tokenId);

        emit DeedSold(tokenId, listing.seller, msg.sender, listing.price);
    }

    /// @notice Current listing for a deed, if any.
    function listingOf(uint256 tokenId) external view returns (Listing memory) {
        return _listings[tokenId];
    }

    /// @notice Whether a listing would currently succeed if bought.
    function isListingLive(uint256 tokenId) external view returns (bool) {
        Listing memory listing = _listings[tokenId];
        if (listing.seller == address(0)) return false;
        if (deed.ownerOf(tokenId) != listing.seller) return false;
        return
            deed.getApproved(tokenId) == address(this) ||
            deed.isApprovedForAll(listing.seller, address(this));
    }
}
