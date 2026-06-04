import { usePrivy, useWallets } from "@privy-io/expo";
import { ethers } from "ethers";
import { useStore } from "../store/index.js";
import { useEffect } from "react";

const BASE_SEPOLIA_CHAIN_ID = 84532;

export function useChain() {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const setWalletAddress = useStore((s) => s.setWalletAddress);

  const embeddedWallet = wallets.find((w) => w.walletClientType === "privy");

  useEffect(() => {
    if (embeddedWallet) {
      setWalletAddress(embeddedWallet.address);
    } else {
      setWalletAddress(null);
    }
  }, [embeddedWallet, setWalletAddress]);

  const getProvider = async () => {
    if (!embeddedWallet) throw new Error("No wallet connected");
    await embeddedWallet.switchChain(BASE_SEPOLIA_CHAIN_ID);
    const ethereumProvider = await embeddedWallet.getEthereumProvider();
    return new ethers.BrowserProvider(ethereumProvider as any);
  };

  const getSigner = async () => {
    const provider = await getProvider();
    return provider.getSigner();
  };

  return {
    ready,
    authenticated,
    login,
    logout,
    walletAddress: embeddedWallet?.address ?? null,
    getProvider,
    getSigner,
  };
}
