# Pilot participant instructions

For a real person claiming a real deed. Read this before recruiting anyone.

## What you need

1. **Your own Base wallet** — MetaMask, Coinbase Wallet, Rainbow, anything that
   holds an EVM key you control. We never see it and never ask for it.
2. **A small amount of ETH on the network we are using**, for gas. You send the
   transaction yourself, so you pay its gas. There is no sponsored gas.
3. **A movement session that was verified by MovenRun**, which is what makes a
   cell eligible in the first place.

## What happens

1. You go for a run or a walk with MovenRun, and save the session.
2. The server verifies it and works out which map cells the route passed
   through.
3. We generate an authorization for **one** of those cells, tied to **your**
   wallet address, valid for 15 minutes.
4. You submit the claim yourself, from your own wallet.
5. You hold the deed. It is a normal ERC-721 — you can transfer it, and nobody
   at MovenRun can take it back, move it, or destroy it.

## What we will never do

- Ask for your seed phrase or private key. **Never send those to MovenRun, to
  an operator, or to anyone claiming to be us.** We do not need them and cannot
  use them.
- Claim on your behalf. The authorization only works from your address.
- Take the deed back. There is no reclaim, no burn, and no admin seizure in the
  contract.

## What this deed is, honestly

It is an experimental, early-stage record that one map cell has one registered
holder.

It **does not** pay income, yield, dividends, or a revenue share. It has no
price, no guaranteed value, and no promised return. There is no token, no
airdrop, and no financial product attached to it. If any of that changes it will
be because it was built and announced, not because it was implied here.

Do not treat it as an investment. Treat it as taking part in a test of whether a
location registry backed by verified movement is worth building.

## If something goes wrong

An authorization expires after 15 minutes — ask for a new one. A cell that is
already claimed cannot be claimed again by anyone, including you. A failed
transaction costs gas and mints nothing; nothing is lost but the fee.

---

**Operator note.** Test wallets you control are not pilot participants. If ten
of the fifteen deeds are held by addresses the project funded and controls, the
honest holder count is five.
