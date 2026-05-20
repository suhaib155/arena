import { ethers } from "ethers";
import { getConfig } from "../config.js";

export class OracleService {
  private wallet: ethers.Wallet;

  constructor() {
    const config = getConfig();
    this.wallet = new ethers.Wallet(config.ORACLE_PRIVATE_KEY);
  }

  get address(): string {
    return this.wallet.address;
  }

  // Sign GPS proof: (walletAddress, routeHash, distanceMeters)
  async signRouteProof(
    walletAddress: string,
    routeHash: string,
    distanceMeters: number,
  ): Promise<string> {
    const message = ethers.solidityPackedKeccak256(
      ["address", "bytes32", "uint256"],
      [walletAddress, routeHash, BigInt(distanceMeters)],
    );
    return this.wallet.signMessage(ethers.getBytes(message));
  }

  // Sign zone mint: (hexId as uint64, topMoverAddress, mintCost)
  async signZoneMint(hexId: string, topMover: string, mintCost: bigint): Promise<string> {
    const hexIdUint64 = BigInt("0x" + hexId);
    const message = ethers.solidityPackedKeccak256(
      ["uint64", "address", "uint256"],
      [hexIdUint64, topMover, mintCost],
    );
    return this.wallet.signMessage(ethers.getBytes(message));
  }

  // Sign challenge declaration: (hexId, defenderAddress, defenderBaseScore)
  async signChallengeDeclaration(
    hexId: string,
    defenderAddress: string,
    defenderBaseScore: bigint,
  ): Promise<string> {
    const hexIdUint64 = BigInt("0x" + hexId);
    const message = ethers.solidityPackedKeccak256(
      ["uint64", "address", "uint256"],
      [hexIdUint64, defenderAddress, defenderBaseScore],
    );
    return this.wallet.signMessage(ethers.getBytes(message));
  }

  // Sign score submission: (hexId, submitterAddress, score)
  async signScore(hexId: string, submitter: string, score: bigint): Promise<string> {
    const hexIdUint64 = BigInt("0x" + hexId);
    const message = ethers.solidityPackedKeccak256(
      ["uint64", "address", "uint256"],
      [hexIdUint64, submitter, score],
    );
    return this.wallet.signMessage(ethers.getBytes(message));
  }

  // Sign zone mint eligibility for frontend: (hexId, userAddress, mintCost, expiry)
  async signMintEligibility(
    hexId: string,
    userAddress: string,
    mintCost: bigint,
    expiry: number,
  ): Promise<string> {
    const hexIdUint64 = BigInt("0x" + hexId);
    const message = ethers.solidityPackedKeccak256(
      ["uint64", "address", "uint256", "uint256"],
      [hexIdUint64, userAddress, mintCost, BigInt(expiry)],
    );
    return this.wallet.signMessage(ethers.getBytes(message));
  }

  // Sign Great Burn payload: (seasonNumber, hexIds[], yields[])
  async signGreatBurn(seasonNumber: number, hexIds: bigint[], yields: bigint[]): Promise<string> {
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const payload = abiCoder.encode(
      ["uint256", "uint64[]", "uint256[]"],
      [BigInt(seasonNumber), hexIds, yields],
    );
    const hash = ethers.keccak256(payload);
    return this.wallet.signMessage(ethers.getBytes(hash));
  }
}
