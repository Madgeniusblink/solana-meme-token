import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PartyOtter } from "../target/types/party_otter";
import { Helius } from "helius-sdk";

import {
  TOKEN_2022_PROGRAM_ID,
  createBurnInstruction,
  createInitializeInstruction,
  createInitializeTransferFeeConfigInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  getTransferFeeAmount,
  mintTo,
  unpackAccount,
  withdrawWithheldTokensFromAccounts,
} from "@solana/spl-token";

import {
  createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction,
  ExtensionType,
  getMintLen,
  LENGTH_SIZE,
  TYPE_SIZE,
} from "@solana/spl-token";
import {
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { ASSOCIATED_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";

describe("transfer-fee", () => {
  const provider = anchor.AnchorProvider.env();
  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet;
  anchor.setProvider(provider);

  const program = anchor.workspace.PartyOtter as Program<PartyOtter>;

  const mintKeypair = new anchor.web3.Keypair();
  const recipient = new anchor.web3.Keypair();

  const senderTokenAccountAddress = getAssociatedTokenAddressSync(
    mintKeypair.publicKey,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  const recipientTokenAccountAddress = getAssociatedTokenAddressSync(
    mintKeypair.publicKey,
    recipient.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  it("Create Mint with Transfer Fee", async () => {
    const transferFeeBasisPoints = 100;
    const maximumFee = 1;

    const metadata = {
      name: "MGB LLC",
      symbol: "MGB",
      uri: "https://sapphire-sophisticated-panda-344.mypinata.cloud/ipfs/QmUPJSv5SKAG9eugZhiwBH1XwXqd1x6mgZN7aYrunJa2DF",
    };

    const transactionSignature = await program.methods
      .initialize(transferFeeBasisPoints, new anchor.BN(maximumFee), metadata)
      .accounts({
        payer: wallet.payer.publicKey,
        mintAccount: mintKeypair.publicKey,
      })
      .signers([wallet.payer, mintKeypair])
      .rpc({ skipPreflight: true });

    console.log(
      "Transaction: ",
      `https://solscan.io/tx/${transactionSignature}?cluster=devnet`
    );
    console.log(
      "Meme Token: ",
      `https://solscan.io/token/${mintKeypair.publicKey}?cluster=devnet`
    );
  });

  it("Mint Tokens", async () => {
    await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      mintKeypair.publicKey,
      wallet.publicKey,
      false,
      null,
      null,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_PROGRAM_ID
    );

    await mintTo(
      connection,
      wallet.payer,
      mintKeypair.publicKey,
      senderTokenAccountAddress,
      wallet.payer,
      300,
      [],
      null,
      TOKEN_2022_PROGRAM_ID
    );
  });

  it("Transfer", async () => {
    const transactionSignature = await program.methods
      .transfer(new anchor.BN(100))
      .accounts({
        sender: wallet.publicKey,
        recipient: recipient.publicKey,
        mintAccount: mintKeypair.publicKey,
        senderTokenAccount: senderTokenAccountAddress,
        recipientTokenAccount: recipientTokenAccountAddress,
      })
      .rpc({ skipPreflight: true });
    console.log(
      "Transaction: ",
      `https://solscan.io/tx/${transactionSignature}?cluster=devnet`
    );
  });

  it("Transfer Again, fee limit by maximumFee", async () => {
    const transactionSignature = await program.methods
      .transfer(new anchor.BN(200))
      .accounts({
        sender: wallet.publicKey,
        recipient: recipient.publicKey,
        mintAccount: mintKeypair.publicKey,
        senderTokenAccount: senderTokenAccountAddress,
        recipientTokenAccount: recipientTokenAccountAddress,
      })
      .rpc({ skipPreflight: true });
    console.log(
      "Transaction: ",
      `https://solscan.io/tx/${transactionSignature}?cluster=devnet`
    );
  });

  it("Withdraw Transfer fees from Token Accounts and burn them", async () => {
    // Retrieve all Token Accounts for the Mint Account
    // const helius = new Helius("9d3e4574-749b-4a39-8318-6f437bf7199a", "devnet");
    const allAccounts = await connection.getProgramAccounts(
      TOKEN_2022_PROGRAM_ID,
      {
        commitment: "confirmed",
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: mintKeypair.publicKey.toString(), // Mint Account address
            },
          },
        ],
      }
    );

    // List of Token Accounts to withdraw fees from
    const accountsToWithdrawFrom = [];

    for (const accountInfo of allAccounts) {
      const account = unpackAccount(
        accountInfo.pubkey, // Token Account address
        accountInfo.account, // Token Account data
        TOKEN_2022_PROGRAM_ID // Token Extension Program ID
      );

      // Extract transfer fee data from each account
      const transferFeeAmount = getTransferFeeAmount(account);

      // Check if fees are available to be withdrawn
      if (transferFeeAmount !== null && transferFeeAmount.withheldAmount > 0) {
        accountsToWithdrawFrom.push(accountInfo.pubkey); // Add account to withdrawal list
      }
    }

    const transactionSignature = await withdrawWithheldTokensFromAccounts(
      connection,
      wallet.payer, // Transaction fee payer
      mintKeypair.publicKey, // Mint Account address
      senderTokenAccountAddress, // Destination account for fee withdrawal
      wallet.payer.publicKey, // Authority for fee withdrawal
      [], // Additional signers
      accountsToWithdrawFrom, // Token Accounts to withdrawal from
      undefined, // Confirmation options
      TOKEN_2022_PROGRAM_ID // Token Extension Program ID
    );

    console.log(
      "Transaction: ",
      `https://solscan.io/tx/${transactionSignature}?cluster=devnet`
    );

    const delegateTokenAccountInfo = await getAccount(
      connection,
      senderTokenAccountAddress,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    const total_amount = delegateTokenAccountInfo.amount;

    const burnInstruction = createBurnInstruction(
      senderTokenAccountAddress,
      mintKeypair.publicKey,
      wallet.payer.publicKey,
      total_amount,
      [],
      TOKEN_2022_PROGRAM_ID
    );

    const burn_transaction = new Transaction().add(burnInstruction);

    const burn_tx = await provider.sendAndConfirm(burn_transaction, [
      wallet.payer,
    ]);

    console.log(
      `Burn Transaction Signature: https://solscan.io/tx/${burn_tx}?cluster=devnet`
    );
  });
  it("Harvest Transfer Fees to Mint Account", async () => {
    const transactionSignature = await program.methods
      .harvest()
      .accounts({ mintAccount: mintKeypair.publicKey })
      .remainingAccounts([
        {
          pubkey: recipientTokenAccountAddress,
          isSigner: false,
          isWritable: true,
        },
      ])
      .rpc({ skipPreflight: true });
    console.log(
      "Transaction: ",
      `https://solscan.io/tx/${transactionSignature}?cluster=devnet`
    );
  });

  it("Withdraw Transfer Fees from Mint Account", async () => {
    const transactionSignature = await program.methods
      .withdraw()
      .accounts({
        mintAccount: mintKeypair.publicKey,
        tokenAccount: senderTokenAccountAddress,
      })
      .rpc({ skipPreflight: true });
    console.log(
      "Transaction: ",
      `https://solscan.io/tx/${transactionSignature}?cluster=devnet`
    );
  });

  it("Update Transfer Fee", async () => {
    const transferFeeBasisPoints = 0;
    const maximumFee = 0;

    const transactionSignature = await program.methods
      .updateFee(transferFeeBasisPoints, new anchor.BN(maximumFee))
      .accounts({ mintAccount: mintKeypair.publicKey })
      .rpc({ skipPreflight: true });
    console.log(
      "Transaction: ",
      `https://solscan.io/tx/${transactionSignature}?cluster=devnet`
    );
  });
});
