# Pilot recruitment pack

For recruiting **real** participants. Everything here assumes the person is a
stranger doing you a favour, not a user you have leverage over.

Never request a seed phrase or private key. Never describe this as an
investment opportunity. Never count a wallet you control as a participant.

---

## Short message (WhatsApp / Telegram)

> Hey — I'm testing something I've built and could use a hand.
>
> It's an app that records a walk or run, verifies it server-side, and then
> lets you claim one map cell you actually passed through as an NFT on Base.
> One cell, one deed, permanently yours — I can't take it back.
>
> You'd need your own crypto wallet and a small amount of ETH for the
> transaction fee. There's no payment, no rewards, and it's not worth money —
> it's an experiment and I want real people in it rather than my own test
> accounts.
>
> Interested? Takes about 20 minutes plus the walk.

## Longer direct message

> I've been building MovenRun — the idea is that the places you actually move
> through should be something you can hold, rather than data someone else
> collects about you.
>
> How it works: you record a session in the app, the server verifies the
> movement really happened and works out which map cells your route crossed,
> and then you can claim one of those cells. You get a deed for it as an NFT
> on Base. It's an ordinary NFT — transferable, yours, and there's no
> mechanism for me to reclaim it.
>
> What you'd need:
> - your own wallet (MetaMask, Coinbase Wallet, Rainbow — anything)
> - a small amount of ETH on the network we're testing on, for gas
> - a real walk or run
>
> What I'd need from you: your wallet **address** only. Never your seed
> phrase or private key — I don't need them and wouldn't accept them.
>
> To be straight about it: this pays nothing. No income, no yield, no
> guaranteed value, no token. It's an early test and the deed is a record,
> not a financial product. I'm asking because I'd rather have a handful of
> real participants than a number I made up.

## Social post

> Testing MovenRun: record a real walk, the server verifies it, and you claim
> one map cell you actually crossed as a deed on Base. One cell, one holder,
> permanent — no reclaim mechanism.
>
> Looking for a few real testers. You need your own wallet and a bit of gas.
> No rewards, no token, no promised value — it's an experiment and I want real
> people in it.
>
> Reply if you're up for it. I will never ask for your seed phrase.

---

## Participant checklist

One row per participant. Nothing is ticked on someone's behalf.

- [ ] Has their own wallet
- [ ] Wallet **address** supplied (never a key)
- [ ] Understands there is no payment or financial return
- [ ] Movement session completed
- [ ] Session verified server-side
- [ ] Eligible cell confirmed present in server-derived traversal
- [ ] Authorization generated and handed over
- [ ] Has enough gas on the target network
- [ ] **Participant** submitted the claim transaction themselves
- [ ] Transaction hash recorded
- [ ] Holder confirmed on-chain

## Tracker

Empty on purpose. Do not pre-fill rows, and do not add wallets the project
controls — deployer, admin, oracle and test wallets are not participants.

| Alias | Wallet address | Contacted | Agreed | Session done | Verified | Eligible cell | Sepolia claim tx | Mainnet claim tx | Holder confirmed |
|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | |

**Honest count rule.** The reportable holder count is the number of rows where
*Holder confirmed* is true **and** the wallet is not controlled by the project.
If that is three, the answer is three.

---

## Questions people will ask

**"Is it worth anything?"** No. There is no market, no income and no promised
value. It is a record that one map cell has one holder.

**"Will there be a token?"** Not one that exists today, and claiming a deed
requires no token. Anything beyond that would be speculation.

**"What data do you keep?"** The route is used to verify the session and work
out which cells it crossed. The route itself never goes on-chain — what goes
on-chain is the conclusion, which cell has which holder.

**"Can you take it back?"** No. There is no reclaim, no burn and no admin
transfer in the contract. That was a deliberate removal from an earlier design.

**"What if I lose my wallet?"** Then the deed is gone, the same as any NFT.
Nobody can restore it, including us.
