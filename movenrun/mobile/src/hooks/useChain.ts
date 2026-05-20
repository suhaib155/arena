import { useEffect, useCallback } from "react";
import { usePrivy, useWallets } from "@privy-io/expo";
import { ethers } from "ethers";
import { CONTRACT_ADDRESSES } from "@movenrun/shared";
import { useStore } from "../store/index.js";
import MoveTokenABI from "../contracts/MoveToken.json";
import ZoneNFTABI from "../contracts/ZoneNFT.json";
import ZoneChallengeABI from "../contracts/ZoneChallenge.json";

const CHAIN_ID = 84532; // Base Sepolia
const CONTRACTS = CONTRACT_ADDRESSES.baseSepolia;

export function useChain() {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const setWalletAddress = useStore((s) => s.setWalletAddress);
  const updateMoveBalance = useStore((s) => s.updateMoveBalance);

  const wallet = wallets.find((w) => w.walletClientType === "privy") ?? null;

  useEffect(() => {
    setWalletAddress(wallet?.address ?? null);
  }, [wallet, setWalletAddress]);

  const getProvider = useCallback(async (): Promise<ethers.BrowserProvider> => {
    if (!wallet) throw new Error("No wallet connected");
    await wallet.switchChain(CHAIN_ID);
    const ethereumProvider = await wallet.getEthereumProvider();
    return new ethers.BrowserProvider(
      ethereumProvider as ethers.Eip1193Provider,
    );
  }, [wallet]);

  const getSigner = useCallback(async (): Promise<ethers.JsonRpcSigner> => {
    const provider = await getProvider();
    return provider.getSigner();
  }, [getProvider]);

  const getMoveBalance = useCallback(async (): Promise<bigint> => {
    if (!wallet) throw new Error("No wallet connected");
    const provider = await getProvider();
    const contract = new ethers.Contract(
      CONTRACTS.MoveToken,
      MoveTokenABI.abi,
      provider,
    );
    const balance = (await contract.balanceOf(wallet.address)) as bigint;
    updateMoveBalance(balance);
    return balance;
  }, [wallet, getProvider, updateMoveBalance]);

  const mintZone = useCallback(
    async (
      hexId: string,
      mintCost: bigint,
      oracleSig: string,
    ): Promise<ethers.TransactionReceipt | null> => {
      const signer = await getSigner();
      const contract = new ethers.Contract(
        CONTRACTS.ZoneNFT,
        ZoneNFTABI.abi,
        signer,
      );
      // H3 hex IDs are base-16 strings; contract expects uint64
      const hexIdU64 = BigInt(`0x${hexId}`);
      const tx = (await contract.mintZone(
        hexIdU64,
        mintCost,
        oracleSig,
      )) as ethers.TransactionResponse;
      return tx.wait();
    },
    [getSigner],
  );

  const declareChallenge = useCallback(
    async (
      hexId: string,
      defenderBaseScore: bigint,
      oracleSig: string,
    ): Promise<ethers.TransactionReceipt | null> => {
      const signer = await getSigner();
      const contract = new ethers.Contract(
        CONTRACTS.ZoneChallenge,
        ZoneChallengeABI.abi,
        signer,
      );
      const hexIdU64 = BigInt(`0x${hexId}`);
      const tx = (await contract.declareChallenge(
        hexIdU64,
        defenderBaseScore,
        oracleSig,
      )) as ethers.TransactionResponse;
      return tx.wait();
    },
    [getSigner],
  );

  const claimYield = useCallback(
    async (hexId: string): Promise<ethers.TransactionReceipt | null> => {
      const signer = await getSigner();
      const contract = new ethers.Contract(
        CONTRACTS.ZoneNFT,
        ZoneNFTABI.abi,
        signer,
      );
      const hexIdU64 = BigInt(`0x${hexId}`);
      const tx = (await contract.withdrawYield(
        hexIdU64,
      )) as ethers.TransactionResponse;
      return tx.wait();
    },
    [getSigner],
  );

  const connect = useCallback(() => {
    login();
  }, [login]);

  return {
    ready,
    authenticated,
    wallet,
    walletAddress: wallet?.address ?? null,
    connect,
    login,
    logout,
    getProvider,
    getSigner,
    getMoveBalance,
    mintZone,
    declareChallenge,
    claimYield,
  };
}
