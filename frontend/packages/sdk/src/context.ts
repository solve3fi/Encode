import type { Idl } from "anchor-legacy";
import { AnchorProvider, Program } from "anchor-legacy";
import type {
  BuildOptions,
  LookupTableFetcher,
  TransactionBuilderOptions,
  Wallet,
  WrappedSolAccountCreateMethod,
} from "@solve3fi/common";
import type {
  Commitment,
  Connection,
  PublicKey,
  SendOptions,
} from "@solana/web3.js";
import type { Solve } from "./artifacts/solve";
import SolveIDL from "./artifacts/solve.json";
import type { SolveAccountFetcherInterface } from "./network/public";
import { buildDefaultAccountFetcher } from "./network/public";
import { contextOptionsToBuilderOptions } from "./utils/txn-utils";

/**
 * Default settings used when interacting with transactions.
 * @category Core
 */
export type SolveContextOpts = {
  userDefaultBuildOptions?: Partial<BuildOptions>;
  userDefaultSendOptions?: Partial<SendOptions>;
  userDefaultConfirmCommitment?: Commitment;
  accountResolverOptions?: AccountResolverOptions;
};

/**
 * Default settings used when resolving token accounts.
 * @category Core
 */
export type AccountResolverOptions = {
  createWrappedSolAccountMethod: WrappedSolAccountCreateMethod;
  allowPDAOwnerAddress: boolean;
};

const DEFAULT_ACCOUNT_RESOLVER_OPTS: AccountResolverOptions = {
  createWrappedSolAccountMethod: "keypair",
  allowPDAOwnerAddress: false,
};

/**
 * Context for storing environment classes and objects for usage throughout the SDK
 * @category Core
 */
export class SolveContext {
  readonly connection: Connection;
  readonly wallet: Wallet;
  readonly program: Program<Solve>;
  readonly provider: AnchorProvider;
  readonly fetcher: SolveAccountFetcherInterface;
  readonly lookupTableFetcher: LookupTableFetcher | undefined;
  readonly opts: SolveContextOpts;
  readonly txBuilderOpts: TransactionBuilderOptions | undefined;
  readonly accountResolverOpts: AccountResolverOptions;

  public static from(
    connection: Connection,
    wallet: Wallet,
    programId: PublicKey,
    fetcher: SolveAccountFetcherInterface = buildDefaultAccountFetcher(
      connection,
    ),
    lookupTableFetcher?: LookupTableFetcher,
    opts: SolveContextOpts = {},
  ): SolveContext {
    const anchorProvider = new AnchorProvider(connection, wallet, {
      commitment: opts.userDefaultConfirmCommitment || "confirmed",
      preflightCommitment: opts.userDefaultConfirmCommitment || "confirmed",
    });
    const program = new Program(SolveIDL as Idl, programId, anchorProvider);
    return new SolveContext(
      anchorProvider,
      anchorProvider.wallet,
      program,
      fetcher,
      lookupTableFetcher,
      opts,
    );
  }

  public static fromWorkspace(
    provider: AnchorProvider,
    program: Program,
    fetcher: SolveAccountFetcherInterface = buildDefaultAccountFetcher(
      provider.connection,
    ),
    lookupTableFetcher?: LookupTableFetcher,
    opts: SolveContextOpts = {},
  ) {
    return new SolveContext(
      provider,
      provider.wallet,
      program,
      fetcher,
      lookupTableFetcher,
      opts,
    );
  }

  public static withProvider(
    provider: AnchorProvider,
    programId: PublicKey,
    fetcher: SolveAccountFetcherInterface = buildDefaultAccountFetcher(
      provider.connection,
    ),
    lookupTableFetcher?: LookupTableFetcher,
    opts: SolveContextOpts = {},
  ): SolveContext {
    const program = new Program(SolveIDL as Idl, programId, provider);
    return new SolveContext(
      provider,
      provider.wallet,
      program,
      fetcher,
      lookupTableFetcher,
      opts,
    );
  }

  public constructor(
    provider: AnchorProvider,
    wallet: Wallet,
    program: Program,
    fetcher: SolveAccountFetcherInterface,
    lookupTableFetcher?: LookupTableFetcher,
    opts: SolveContextOpts = {},
  ) {
    this.connection = provider.connection;
    this.wallet = wallet;
    // It's a hack but it works on Anchor workspace *shrug*
    this.program = program as unknown as Program<Solve>;
    this.provider = provider;
    this.fetcher = fetcher;
    this.lookupTableFetcher = lookupTableFetcher;
    this.opts = opts;
    this.txBuilderOpts = contextOptionsToBuilderOptions(this.opts);
    this.accountResolverOpts =
      opts.accountResolverOptions ?? DEFAULT_ACCOUNT_RESOLVER_OPTS;
  }

  // TODO: Add another factory method to build from on-chain IDL
}
