import { Coinbase, Wallet, hashMessage } from "@coinbase/coinbase-sdk"

import { getState, setState } from './state.js'

export const getWallet = async (remxConfig) => {
  let apiKeyName = remxConfig.COINBASE_API_KEY_NAME
  let privateKey = remxConfig.COINBASE_API_KEY_PRIVATE_KEY

  Coinbase.configure({ apiKeyName, privateKey })

  const state = await getState()
  let wallet
  if (state.wallet) {
    // load the wallet from the state file
    wallet = await Wallet.import(state.wallet)
  } else {
    // otherwise, create a new wallet
    wallet = await Wallet.create()

    let data = wallet.export()
    console.log('data', data)
    state.wallet = data
    await setState(state)
  }

  return wallet
}

export const signMessage = async (remxConfig, message) => {
  const wallet = await getWallet(remxConfig)
  const hashedMessage = hashMessage(message)
  let signature = await wallet.createPayloadSignature(hashedMessage)
  signature = await signature.wait()
  return signature.model.signature
}

// export const buyNFT = async (wallet, _collection, tokenId, expiryBlock, signature, amount) => {

//   const buyNFTArgs = {
//     _collection,
//     tokenId,
//     expiryBlock,
//     signature,
//   }

//   console.log('buyNFTArgs', buyNFTArgs)

//   const contractInvocation = await wallet.invokeContract({
//     contractAddress: REVENUE_SPLITTER_ADDRESS,
//     method: "buyNFT",
//     args: buyNFTArgs,
//     abi: BUY_NFT,
//     amount,
//     assetId: Coinbase.assets.Eth,
//   });

//   // Wait for the contract invocation transaction to land on-chain.
//   await contractInvocation.wait();

//   // return the transaction hash
//   return contractInvocation.getTransactionHash()
// }