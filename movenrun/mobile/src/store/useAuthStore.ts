/**
 * Auth/wallet UI state (Zustand).
 *
 * This store holds ONLY non-secret, server-derived state — the current user,
 * linked auth methods, wallets, and a status flag. It is deliberately NOT
 * persisted (no AsyncStorage), and it NEVER holds an access/refresh token:
 * tokens live exclusively in the secure store (see lib/secureSession.ts). The
 * server remains authoritative — every action refetches from the API rather
 * than mutating optimistic local truth for security-relevant fields.
 */
import { create } from "zustand";
import {
  IdentityApiClient,
  IdentityApiError,
  type PublicIdentity,
  type PublicUser,
  type PublicWallet,
} from "../services/identityApi";

export type AuthStatus = "signedOut" | "authenticating" | "signedIn" | "error";

interface AuthState {
  status: AuthStatus;
  user: PublicUser | null;
  identities: PublicIdentity[];
  wallets: PublicWallet[];
  /** Public error CODE (never a raw message with sensitive detail). */
  errorCode: string | null;
  /** Injected so screens/tests can supply a configured client. */
  client: IdentityApiClient | null;

  setClient: (client: IdentityApiClient) => void;
  beginEmailOtp: (email: string) => Promise<void>;
  completeEmailOtp: (email: string, code: string) => Promise<void>;
  refresh: () => Promise<void>;
  setActiveWallet: (walletId: string) => Promise<void>;
  revokeWallet: (walletId: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Server-side revoke-all (every device), then local credential clear. */
  signOutEverywhere: () => Promise<void>;
}

function codeOf(err: unknown): string {
  return err instanceof IdentityApiError ? err.code : "request_failed";
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "signedOut",
  user: null,
  identities: [],
  wallets: [],
  errorCode: null,
  client: null,

  setClient: (client) => set({ client }),

  beginEmailOtp: async (email) => {
    const client = get().client;
    if (!client) return set({ status: "error", errorCode: "client_unavailable" });
    set({ status: "authenticating", errorCode: null });
    try {
      await client.beginEmailOtp(email);
      // Stay in 'authenticating' — the UI now collects the code.
    } catch (err) {
      set({ status: "error", errorCode: codeOf(err) });
    }
  },

  completeEmailOtp: async (email, code) => {
    const client = get().client;
    if (!client) return set({ status: "error", errorCode: "client_unavailable" });
    set({ status: "authenticating", errorCode: null });
    try {
      const result = await client.completeEmailOtp(email, code);
      const wallets = await client.listWallets();
      const me = await client.me();
      set({
        status: "signedIn",
        user: result.user,
        identities: me.identities,
        wallets: wallets.wallets,
        errorCode: null,
      });
    } catch (err) {
      set({ status: "error", errorCode: codeOf(err) });
    }
  },

  refresh: async () => {
    const client = get().client;
    if (!client) return;
    try {
      const [me, wallets] = await Promise.all([client.me(), client.listWallets()]);
      set({ status: "signedIn", user: me.user, identities: me.identities, wallets: wallets.wallets });
    } catch (err) {
      set({ status: "signedOut", errorCode: codeOf(err) });
    }
  },

  setActiveWallet: async (walletId) => {
    const client = get().client;
    if (!client) return;
    try {
      await client.setActiveWallet(walletId);
      const wallets = await client.listWallets();
      set({ wallets: wallets.wallets, errorCode: null });
    } catch (err) {
      set({ errorCode: codeOf(err) });
    }
  },

  revokeWallet: async (walletId) => {
    const client = get().client;
    if (!client) return;
    try {
      await client.revokeWallet(walletId);
      const wallets = await client.listWallets();
      set({ wallets: wallets.wallets, errorCode: null });
    } catch (err) {
      set({ errorCode: codeOf(err) });
    }
  },

  signOut: async () => {
    const client = get().client;
    try {
      await client?.signOut();
      set({ status: "signedOut", user: null, identities: [], wallets: [], errorCode: null });
    } catch (err) {
      // The UI state is cleared regardless, but a failed credential clear is
      // surfaced honestly — never silently reported as a clean sign-out.
      set({ status: "signedOut", user: null, identities: [], wallets: [], errorCode: codeOf(err) });
    }
  },

  signOutEverywhere: async () => {
    const client = get().client;
    try {
      await client?.signOutEverywhere();
      set({ status: "signedOut", user: null, identities: [], wallets: [], errorCode: null });
    } catch (err) {
      set({ status: "signedOut", user: null, identities: [], wallets: [], errorCode: codeOf(err) });
    }
  },
}));
