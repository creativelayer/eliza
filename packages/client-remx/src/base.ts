import path from 'node:path'
import fs from 'node:fs'
import {
    Content,
    IAgentRuntime,
    IImageDescriptionService,
    Memory,
    State,
    UUID,
    getEmbeddingZeroVector,
    elizaLogger,
    stringToUuid,
    ActionTimelineType,
} from "@elizaos/core";
import { EventEmitter } from "events";

import { GraphQLClient, gql } from 'graphql-request'
import { AdminInitiateAuthCommand, AdminRespondToAuthChallengeCommand, CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { Coinbase, Wallet, WalletData, hashMessage } from "@coinbase/coinbase-sdk";

import { RemxConfig } from "./environment.ts";

export function extractAnswer(text: string): string {
    const startIndex = text.indexOf("Answer: ") + 8;
    const endIndex = text.indexOf("<|endoftext|>", 11);
    return text.slice(startIndex, endIndex);
}

type RemxProfile = {
    id: string;
    username: string;
    screenName: string;
    bio: string;
};

const LOGIN_BY_WALLET = gql`
mutation LoginByWallet($address: String!, $connectionType: String!) {
  loginByWallet(address: $address, connectionType: $connectionType) {
    id
    defaultWallet
  }
}
`

const cognitoClient = new CognitoIdentityProviderClient({
    region: 'us-east-1',
})


export class ClientBase extends EventEmitter {
    runtime: IAgentRuntime;
    remxConfig: RemxConfig;
    lastCheckedMomentId: bigint | null = null;
    imageDescriptionService: IImageDescriptionService;
    temperature: number = 0.5;
    wallet: Wallet | null = null;
    profile: RemxProfile | null;

    callback: (self: ClientBase) => any = null;

    onReady() {
        throw new Error(
            "Not implemented in base class, please call from subclass"
        );
    }

    constructor(runtime: IAgentRuntime, remxConfig: RemxConfig) {
        super();
        this.runtime = runtime;
        this.remxConfig = remxConfig;
    }

    async init() {
        const username = this.remxConfig.REMX_WALLET_ADDRESS;

        if (!username) {
            throw new Error("Remx wallet address not configured");
        }


        elizaLogger.log("[REMX] Initializing wallet");

        this.wallet = await this.getWallet();

        elizaLogger.log("[REMX] Logging in");
        const loginResult = await this.login();

        // TODO: decide what to do if loginResult is false?

        elizaLogger.log("[REMX] Login result", loginResult);
    }

    async login() {
        const accessToken = await this.runtime.cacheManager.get(`remx/${this.remxConfig.REMX_WALLET_ADDRESS}/accessToken`);
        const accessTokenExpiresAt = await this.runtime.cacheManager.get(`remx/${this.remxConfig.REMX_WALLET_ADDRESS}/accessTokenExpiresAt`) as number;

        // if we have an access token that is valid for at least 1 minute, we can use it
        if (accessToken && accessTokenExpiresAt > new Date().getTime() - 60 * 1000) {
            elizaLogger.log("[REMX] Using existing access token");
            return
        }

        elizaLogger.debug("[REMX] Logging in");
        const { loginByWallet: account } = await this.graphQLRequest(LOGIN_BY_WALLET, {
            address: this.remxConfig.REMX_WALLET_ADDRESS,
            connectionType: 'wallet',
        })
        elizaLogger.debug("[REMX] found existing account", account);

        // TODO: handle account not found, maybe create account?

        const command = new AdminInitiateAuthCommand({
            UserPoolId: this.remxConfig.COGNITO_POOL_ID,
            ClientId: this.remxConfig.COGNITO_WEB_CLIENT_ID,
            AuthFlow: 'CUSTOM_AUTH',
            AuthParameters: {
              USERNAME: account.id,
            },
          })
        const initiateAuthResponse = await cognitoClient.send(command)

        // TODO: handle error

        const message = initiateAuthResponse.ChallengeParameters.message
        const session = initiateAuthResponse.Session

        const signature = await this.signMessage(message)

        const respondToAuthChallengeCommand = new AdminRespondToAuthChallengeCommand({
            UserPoolId: this.remxConfig.COGNITO_POOL_ID,
            ClientId: this.remxConfig.COGNITO_WEB_CLIENT_ID,
            ChallengeName: 'CUSTOM_CHALLENGE',
            Session: session,
            ChallengeResponses: {
              USERNAME: account.id,
              ANSWER: signature,
            },
          })

        const respondToAuthChallengeResponse = await cognitoClient.send(respondToAuthChallengeCommand)
        // TODO: handle error

        const remxAccessToken = respondToAuthChallengeResponse.AuthenticationResult.AccessToken
        const remxExpiresAt = this.getTokenExpiry(remxAccessToken)
        elizaLogger.debug("[REMX] Remx access token", remxAccessToken);
        elizaLogger.debug("[REMX] Remx expires at", remxExpiresAt);

        // TODO: cache manager seems to support expiresAt, so we can use that
        await this.runtime.cacheManager.set(`remx/${this.remxConfig.REMX_WALLET_ADDRESS}/accessToken`, remxAccessToken)
        await this.runtime.cacheManager.set(`remx/${this.remxConfig.REMX_WALLET_ADDRESS}/accessTokenExpiresAt`, remxExpiresAt)
    }

    /**
     * Populate the moments from the database
     */
    async populateMoments() {
    }

    async graphQLRequest(query: string, variables: Record<string, any>): Promise<any> {
        const accessToken = await this.runtime.cacheManager.get(`remx/${this.remxConfig.REMX_WALLET_ADDRESS}/accessToken`) as string|null;
        const client = this.getGraphQLClient(accessToken);
        return client.request(query, variables);
    }

    private getGraphQLClient(accessToken: string | null) {
        const headers: Record<string, string> = {}
        if (accessToken) {
          headers.Authorization = `Bearer ${accessToken}`
        }
        const client = new GraphQLClient(this.remxConfig.GRAPHQL_URL, {
          headers
        })
        return client
    }

    async signMessage(message: string): Promise<string> {
        const hashedMessage = hashMessage(message)
        let signature = await this.wallet.createPayloadSignature(hashedMessage)
        signature = await signature.wait()
        return signature.getSignature()
    }

    async getWallet(): Promise<Wallet> {
        Coinbase.configure({
            apiKeyName: this.remxConfig.COINBASE_API_KEY_NAME,
            privateKey: this.remxConfig.COINBASE_API_KEY_PRIVATE_KEY
        })
        if (!this.wallet) {
            const storedSeed = this.runtime.getSetting("REMX_WALLET_SEED") ?? process.env.REMX_WALLET_SEED;
            const storedWalletId = this.runtime.getSetting("REMX_WALLET_ID") ?? process.env.REMX_WALLET_ID;

            if (storedSeed && storedWalletId) {
                this.wallet = await Wallet.import({
                    seed: storedSeed,
                    walletId: storedWalletId,
                })
            } else {
                this.wallet = await Wallet.create({ networkId: Coinbase.networks.EthereumMainnet })
                const walletData: WalletData = this.wallet.export();
                const walletAddress = await this.wallet.getDefaultAddress();
                await this.updateCharacterSecrets({
                    REMX_WALLET_ADDRESS: walletAddress.toString(),
                    REMX_WALLET_SEED: walletData.seed,
                    REMX_WALLET_ID: walletData.walletId,
                });
            }
        }
        return this.wallet
    }

    /**
     * Update the character secrets with the given secrets
     * @param secrets - The secrets to update
     * @returns true if the secrets were updated successfully, false otherwise
     */
    private async updateCharacterSecrets(secrets: Record<string, string>) {
        try {
            const characterFilePath = path.resolve(
                process.cwd(),
                `characters/${this.runtime.character.name.toLowerCase()}.character.json`
            );
            if (!fs.existsSync(characterFilePath)) {
                elizaLogger.error("Character file not found:", characterFilePath);
                return false
            }
            const characterData = JSON.parse(fs.readFileSync(characterFilePath, "utf-8"));
            if (!characterData.settings) {
                characterData.settings = {};
            }
            if (!characterData.settings.secrets) {
                characterData.settings.secrets = {};
            }
            characterData.settings.secrets = Object.assign(characterData.settings.secrets, secrets);
            fs.writeFileSync(characterFilePath, JSON.stringify(characterData, null, 2));
            return true
        } catch (error) {
            elizaLogger.error("Error updating character secrets:", error);
            return false
        }
    }

    private getTokenExpiry(token: string) {
        const base64Url = token.split('.')[1]
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
        }).join(''))
        const payload = JSON.parse(jsonPayload)
        return new Date(payload.exp * 1000)
    }
}

