import { ChainId } from "@certusone/wormhole-sdk";
import { ethers } from "ethers";
import fs from "fs";

import { WormholeRelayer } from "../../../ethers-contracts";
import { DeliveryProvider } from "../../../ethers-contracts";
import { MockRelayerIntegration } from "../../../ethers-contracts";

import { DeliveryProvider__factory } from "../../../ethers-contracts";
import { WormholeRelayer__factory } from "../../../ethers-contracts";
import { MockRelayerIntegration__factory } from "../../../ethers-contracts";
import {
  Create2Factory,
  Create2Factory__factory,
} from "../../../ethers-contracts";

export type ChainInfo = {
  evmNetworkId: number;
  chainId: ChainId;
  rpc: string;
  wormholeAddress: string;
};

export type Deployment = {
  chainId: ChainId;
  address: string;
};

export interface OperationDescriptor {
  /**
   * Txs will be signed for these chains
   */
  operatingChains: ChainInfo[];
  /**
   * Deployment artifacts exist for these chains and may be used to perform
   * cross registration or sanity checks.
   * Excludes operating chains.
   */
  supportedChains: ChainInfo[];
}

const DEFAULT_ENV = "testnet";

export let env = "";

export function init(): string {
  env = get_env_var("ENV");
  if (!env) {
    throw new Error(
      "ENV must be defined to the name of the deployment/network that you want to use.",
    );
  }

  require("dotenv").config({
    path: `./ts-scripts/relayer/.env${env != DEFAULT_ENV ? "." + env : ""}`,
  });
  return env;
}

function get_env_var(env: string): string {
  return process.env[env] || "";
}

/**
 * Beware if deciding to cache the JSON in these two.
 * Some scripts may depend on reading updates to the JSON file.
 */

export function readChains() {
  const filepath = `./ts-scripts/relayer/config/${env}/chains.json`;
  const chainFile = fs.readFileSync(filepath, "utf8");
  return JSON.parse(chainFile);
}

export function readContracts() {
  const filepath = `./ts-scripts/relayer/config/${env}/contracts.json`;
  const contractsFile = fs.readFileSync(filepath, "utf8");
  if (!contractsFile) {
    throw Error(`Failed to find contracts file at ${filepath}!`);
  }
  return JSON.parse(contractsFile);
}

/**********************/

function getContainer(): string | null {
  const container = get_env_var("CONTAINER");
  if (!container) {
    return null;
  }

  return container;
}

export function loadScriptConfig(processName: string): any {
  const configFile = fs.readFileSync(
    `./ts-scripts/relayer/config/${env}/scriptConfigs/${processName}.json`,
  );
  const config = JSON.parse(configFile.toString());
  if (!config) {
    throw Error("Failed to pull config file!");
  }
  return config;
}

function getOperatingChainIds() {
  const container = getContainer();
  let operatingChains: number[] | undefined = undefined;

  if (container == "evm1") {
    operatingChains = [2];
  }
  if (container == "evm2") {
    operatingChains = [4];
  }

  const chains = readChains();
  if (chains.operatingChains !== undefined) {
    operatingChains = chains.operatingChains;
  }
  return operatingChains;
}

export function getOperatingChains(): ChainInfo[] {
  const allChains = loadChains();
  const operatingChains = getOperatingChainIds();

  if (operatingChains === undefined) {
    return allChains;
  }

  const output: ChainInfo[] = [];
  for (const chain of operatingChains) {
    const item = allChains.find((y) => {
      return chain == y.chainId;
    });
    if (item !== undefined) {
      output.push(item);
    }
  }

  return output;
}

export function getOperationDescriptor(): OperationDescriptor {
  const allChains = loadChains();
  const operatingChains = getOperatingChainIds();

  if (operatingChains === undefined) {
    return { operatingChains: allChains, supportedChains: [] };
  }

  const result: OperationDescriptor = {
    operatingChains: [],
    supportedChains: [],
  };
  for (const chain of allChains) {
    const item = operatingChains.find((y) => {
      return chain.chainId == y;
    });
    if (item !== undefined) {
      result.operatingChains.push(chain);
    } else {
      result.supportedChains.push(chain);
    }
  }

  return result;
}

export function loadChains(): ChainInfo[] {
  const chains = readChains();
  if (!chains.chains) {
    throw Error("Couldn't find chain information!");
  }
  return chains.chains;
}

export function getChain(chain: ChainId): ChainInfo {
  const chains = loadChains();
  const output = chains.find((x) => x.chainId == chain);
  if (!output) {
    throw Error(`Bad chain ID ${chain}`);
  }

  return output;
}

export function loadPrivateKey(): string {
  const privateKey = get_env_var("WALLET_KEY");
  if (!privateKey) {
    throw Error("WALLET_KEY must be explicitly set.");
  }
  return privateKey;
}

export function loadGuardianSetIndex(): number {
  const chains = readChains();
  if (chains.guardianSetIndex == undefined) {
    throw Error("Failed to pull guardian set index from the chains file!");
  }
  return chains.guardianSetIndex;
}

export function loadDeliveryProviders(): Deployment[] {
  const contracts = readContracts();
  if (contracts.useLastRun) {
    const lastRun = loadLastRun(
      "deployDeliveryProvider",
      `Failed to open last run file for DeliveryProvider contracts. Using only the addresses provided in contracts.json`
    );
    if (lastRun !== undefined) {
      return mergeContractAddresses(contracts.deliveryProviders, lastRun.deliveryProviderProxies);
    }
  }

  return contracts.deliveryProviders;
}

export function loadWormholeRelayers(dev: boolean): Deployment[] {
  const contracts = readContracts();
  // TODO: do we really want this dev flag?
  const wormholeRelayers = dev ? contracts.wormholeRelayersDev : contracts.wormholeRelayers;
  if (contracts.useLastRun) {
    const lastRun = loadLastRun(
      "deployWormholeRelayer",
      `Failed to open last run file for WormholeRelayer proxy contracts. Using only the addresses provided in contracts.json`
    );
    if (lastRun !== undefined) {
      return mergeContractAddresses(wormholeRelayers, lastRun.wormholeRelayerProxies);
    }
  }

  return wormholeRelayers;
}

export function loadMockIntegrations(): Deployment[] {
  const contracts = readContracts();
  if (contracts.useLastRun) {
    const lastRun = loadLastRun(
      "deployMockIntegration",
      `Failed to open last run file for MockIntegration contracts. Using only the addresses provided in contracts.json`
    );
    if (lastRun !== undefined) {
      return mergeContractAddresses(contracts.mockIntegrations, lastRun.mockIntegrations);
    }
  }

  return contracts.mockIntegrations;
}

export function loadWormholeRelayerImplementations(): Deployment[] {
  const contracts = readContracts();

  if (contracts.useLastRun) {
    const lastRun = loadLastRun(
      "deployWormholeRelayerImplementation",
      `Failed to open last run file for WormholeRelayer implementations. Using only the addresses provided in contracts.json`
    );
    if (lastRun !== undefined) {
      return mergeContractAddresses(contracts.wormholeRelayerImplementations, lastRun.wormholeRelayerImplementations);
    }
  }

  return contracts.wormholeRelayerImplementations;
}

export function loadCreate2Factories(): Deployment[] {
  const contracts = readContracts();
  if (contracts.useLastRun) {
    const lastRun = loadLastRun(
      "deployCreate2Factory",
      `Failed to open last run file for create2 factories. Using only the addresses provided in contracts.json`
    );
    if (lastRun !== undefined) {
      return mergeContractAddresses(contracts.create2Factories, lastRun.create2Factories);
    }
  }

  return contracts.create2Factories;
}

//TODO load these keys more intelligently,
//potentially from devnet-consts.
//Also, make sure the signers are correctly ordered by index,
//As the index gets encoded into the signature.
export function loadGuardianKeys(): string[] {
  const output = [];
  const NUM_GUARDIANS = get_env_var("NUM_GUARDIANS");
  const guardianKey = get_env_var("GUARDIAN_KEY");
  const guardianKey2 = get_env_var("GUARDIAN_KEY2");

  let numGuardians: number = 0;
  console.log("NUM_GUARDIANS variable : " + NUM_GUARDIANS);

  if (!NUM_GUARDIANS) {
    numGuardians = 1;
  } else {
    numGuardians = parseInt(NUM_GUARDIANS);
  }

  if (!guardianKey) {
    throw Error("Failed to find guardian key for this process!");
  }
  output.push(guardianKey);

  if (numGuardians >= 2) {
    if (!guardianKey2) {
      throw Error("Failed to find guardian key 2 for this process!");
    }
    output.push(guardianKey2);
  }

  return output;
}

export function writeOutputFiles(output: unknown, processName: string) {
  fs.mkdirSync(`./ts-scripts/relayer/output/${env}/${processName}`, {
    recursive: true,
  });
  fs.writeFileSync(
    `./ts-scripts/relayer/output/${env}/${processName}/lastrun.json`,
    JSON.stringify(output),
    { flag: "w" },
  );
  fs.writeFileSync(
    `./ts-scripts/relayer/output/${env}/${processName}/${Date.now()}.json`,
    JSON.stringify(output),
    { flag: "w" },
  );
}

export function loadLastRun(processName: string, errorMessage?: string): any {
  try {
    return JSON.parse(
      fs.readFileSync(
        `./ts-scripts/relayer/output/${env}/${processName}/lastrun.json`,
        "utf8",
      ),
    );
  } catch (error: unknown) {
    if (error instanceof Error && (error as any).code === "ENOENT") {
      if (errorMessage !== undefined) {
        console.error(errorMessage);
      }
      return undefined;
    } else {
      throw error;
    }
  }
}

export async function getSigner(chain: ChainInfo): Promise<ethers.Signer> {
  const provider = getProvider(chain);
  const privateKey = loadPrivateKey();

  if (privateKey === "ledger") {
    if (process.env.LEDGER_BIP32_PATH === undefined) {
      throw new Error(`Missing BIP32 derivation path.
With ledger devices the path needs to be specified in env var 'LEDGER_BIP32_PATH'.`);
    }
    const { LedgerSigner } = await import("@xlabs-xyz/ledger-signer");
    return LedgerSigner.create(provider, process.env.LEDGER_BIP32_PATH);
  }

  const signer = new ethers.Wallet(privateKey, provider);
  return signer;
}

export function getProvider(
  chain: ChainInfo,
): ethers.providers.StaticJsonRpcProvider {
  const provider = new ethers.providers.StaticJsonRpcProvider(
    loadChains().find((x) => x.chainId == chain.chainId)?.rpc || "",
  );

  return provider;
}

export function getDeliveryProviderAddress(chain: ChainInfo): string {
  const thisChainsProvider = loadDeliveryProviders().find(
    (x) => x.chainId == chain.chainId,
  )?.address;
  if (!thisChainsProvider) {
    throw new Error(
      "Failed to find a DeliveryProvider contract address on chain " +
        chain.chainId,
    );
  }
  return thisChainsProvider;
}

export async function getDeliveryProvider(
  chain: ChainInfo,
  provider?: ethers.providers.StaticJsonRpcProvider,
): Promise<DeliveryProvider> {
  const thisChainsProvider = getDeliveryProviderAddress(chain);
  const contract = DeliveryProvider__factory.connect(
    thisChainsProvider,
    provider || (await getSigner(chain)),
  );
  return contract;
}

export async function getWormholeRelayerAddress(
  chain: ChainInfo,
): Promise<string> {
  // See if we are in dev mode (i.e. forge contracts compiled without via-ir)
  const dev = get_env_var("DEV") == "True" ? true : false;

  const thisChainsRelayer = loadWormholeRelayers(dev).find(
    (x) => x.chainId == chain.chainId,
  )?.address;
  if (thisChainsRelayer) {
    return thisChainsRelayer;
  } else {
    throw Error(
      "Failed to find a WormholeRelayer contract address on chain " +
        chain.chainId,
    );
  }
}

export async function getWormholeRelayerImplementationAddress(
  chain: ChainInfo,
): Promise<string> {

  const thisChainsRelayer = loadWormholeRelayerImplementations().find(
    (x) => x.chainId == chain.chainId,
  )?.address;
  if (thisChainsRelayer) {
    return thisChainsRelayer;
  } else {
    throw Error(
      "Failed to find a WormholeRelayer implementation contract address on chain " +
        chain.chainId,
    );
  }
}

export async function getWormholeRelayer(
  chain: ChainInfo,
  provider?: ethers.providers.StaticJsonRpcProvider,
): Promise<WormholeRelayer> {
  const thisChainsRelayer = await getWormholeRelayerAddress(chain);
  return WormholeRelayer__factory.connect(
    thisChainsRelayer,
    provider || (await getSigner(chain)),
  );
}

export function getMockIntegrationAddress(chain: ChainInfo): string {
  const thisMock = loadMockIntegrations().find(
    (x) => x.chainId == chain.chainId,
  )?.address;
  if (!thisMock) {
    throw new Error(
      "Failed to find a mock integration contract address on chain " +
        chain.chainId,
    );
  }
  return thisMock;
}

export async function getMockIntegration(
  chain: ChainInfo,
  provider?: ethers.providers.StaticJsonRpcProvider,
): Promise<MockRelayerIntegration> {
  const thisIntegration = getMockIntegrationAddress(chain);
  const contract = MockRelayerIntegration__factory.connect(
    thisIntegration,
    provider || (await getSigner(chain)),
  );
  return contract;
}

export function getCreate2FactoryAddress(chain: ChainInfo): string {
  const address = loadCreate2Factories().find((x) => x.chainId == chain.chainId)
    ?.address;
  if (!address) {
    throw new Error(
      "Failed to find a create2Factory contract address on chain " +
        chain.chainId,
    );
  }
  return address;
}

export const getCreate2Factory = async (
  chain: ChainInfo,
): Promise<Create2Factory> =>
  Create2Factory__factory.connect(
    getCreate2FactoryAddress(chain),
    await getSigner(chain),
  );

export function updateContractAddress(arr: Deployment[], newAddress: Deployment) {
  const idx = arr.findIndex((a) => a.chainId === newAddress.chainId);
  if (idx === -1) {
    arr.push(newAddress);
  } else {
    arr[idx] = newAddress;
  }
}

export function mergeContractAddresses(arr: Deployment[], newAddresses: Deployment[]): Deployment[] {
  const newArray = [...arr];
  for (const newAddress of newAddresses) {
    updateContractAddress(newArray, newAddress);
  }
  return newArray;
}
