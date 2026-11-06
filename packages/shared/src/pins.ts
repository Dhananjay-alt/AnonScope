// Pinned specifier reads, produced at build time by scripts/pin-specifiers.ts.
import pinsFile from "./pins.json";
import type { Chain } from "./types";

export interface Pin {
  network: string;
  chain: Chain;
  chainId: number;
  address: string;
  workerHash: `0x${string}`;
  resolvers: string[];
  pinnedAtBlock: number;
}

export interface PinsFile {
  pinnedAt: string | null;
  pins: Pin[];
}

export const PINS = pinsFile as PinsFile;

export function getPin(network: string): Pin | undefined {
  return PINS.pins.find((p) => p.network === network);
}
