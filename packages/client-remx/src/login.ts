import { CognitoIdentityProviderClient, AdminInitiateAuthCommand, AdminRespondToAuthChallengeCommand } from '@aws-sdk/client-cognito-identity-provider'
import { gql } from 'graphql-request'

import { graphQLRequest } from './utils.js'
import { signMessage } from './wallet.js'

const client = new CognitoIdentityProviderClient({
  region: 'us-east-1',
})

const LOGIN_BY_WALLET = gql`
mutation LoginByWallet($address: String!, $connectionType: String!) {
  loginByWallet(address: $address, connectionType: $connectionType) {
    id
    defaultWallet
  }
}
`

let AccessToken = null
let ExpiresAt = null

const getTokenExpiry = (token) => {
  const base64Url = token.split('.')[1]
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
  const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => {
    return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
  }).join(''))
  const payload = JSON.parse(jsonPayload)
  return new Date(payload.exp * 1000)
}


export const login = async (remxConfig, state, address) => {

  if (state?.AccessToken && state?.ExpiresAt && state?.ExpiresAt > new Date()) {
    console.log("[REMX] Login already done");
    return state
  }

  // call loginByWallet
  const { loginByWallet: account } = await graphQLRequest(remxConfig, LOGIN_BY_WALLET, {
    address,
    connectionType: 'wallet',
  })

  console.log("[REMX] Login by wallet", account);

  const initiateAuthResponse = await initiateAuth(remxConfig, account.id)

  console.log("[REMX] Initiate auth response", initiateAuthResponse);

  const message = initiateAuthResponse.ChallengeParameters.message
  const session = initiateAuthResponse.Session
  const signature = await signMessage(remxConfig, message)

  console.log("[REMX] Signature", signature);

  const respondToAuthChallengeResponse = await respondToAuthChallenge(remxConfig, session, account.id, signature)

  console.log("[REMX] Respond to auth challenge response", respondToAuthChallengeResponse);

  AccessToken = respondToAuthChallengeResponse.AuthenticationResult.AccessToken
  ExpiresAt = getTokenExpiry(AccessToken)

  console.log("[REMX] Access token", AccessToken);
  console.log("[REMX] Expires at", ExpiresAt);

  state.account = account
  state.AccessToken = AccessToken
  state.ExpiresAt = ExpiresAt

  console.log("[REMX] State", state);

  return state
}

const initiateAuth = async (remxConfig, USERNAME) => {
  const command = new AdminInitiateAuthCommand({
    UserPoolId: remxConfig.COGNITO_POOL_ID,
    ClientId: remxConfig.COGNITO_WEB_CLIENT_ID,
    AuthFlow: 'CUSTOM_AUTH',
    AuthParameters: {
      USERNAME,
    },
  })
  return await client.send(command)
}

const respondToAuthChallenge = async (remxConfig, Session, USERNAME, ANSWER) => {
  const command = new AdminRespondToAuthChallengeCommand({
    UserPoolId: remxConfig.COGNITO_POOL_ID,
    ClientId: remxConfig.COGNITO_WEB_CLIENT_ID,
    ChallengeName: 'CUSTOM_CHALLENGE',
    Session,
    ChallengeResponses: {
      USERNAME,
      ANSWER,
    },
  })
  return await client.send(command)
}
