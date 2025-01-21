import path from 'node:path'
import fs from 'node:fs'
import {
    Content,
    IAgentRuntime,
    Memory,
    State,
    UUID,
    getEmbeddingZeroVector,
    elizaLogger,
    stringToUuid,
    ActionTimelineType,
    composeContext,
    ModelClass,
    generateText,
} from "@elizaos/core";
import { EventEmitter } from "events";

import { AdminInitiateAuthCommand, AdminRespondToAuthChallengeCommand, CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { Coinbase, Wallet, WalletData, hashMessage } from "@coinbase/coinbase-sdk";

import { RemxConfig } from "./environment.ts";
import { Moment } from './moment.ts';
import { GraphQLClient, GraphQLConfig } from './graphQLClient'
import { GraphDBClient, Neo4jAuth } from './graphDBClient'

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

import { LOGIN_BY_WALLET } from './graphql/mutations/loginByWallet.ts';
import { GET_PROFILE } from './graphql/queries/getProfile.ts';
import { GET_MOMENTS } from './graphql/queries/getMoments.ts';
import { TOGGLE_REACTION } from './graphql/mutations/likeMoment.ts';
import { CREATE_COMMENT } from './graphql/mutations/commentMoment.ts';
import { FOLLOW_USER } from './graphql/mutations/followUser.ts';
import { GET_BALANCES } from './graphql/queries/getBalances.ts';
import { GET_SUPPORTED_NETWORKS } from './graphql/queries/getSupportedNetworks.ts';
import { GET_EXCHANGE_PRICES } from './graphql/queries/getExchangeRates.ts';
import { TIP_ARTIST } from './graphql/mutations/tipArtist.ts';

const momentActionTemplate = `# INSTRUCTIONS: Determine actions for {{agentName}} based on:
{{bio}}

Guidelines:
- analyze the moment and decide if you want to like it or not based on the moment's content and the creator's bio

Actions (respond only with tags):
[LIKE] - Resonates with interests (9.9/10)
[IGNORE] - Not relevant (10/10)

Creator bio:
{{creatorBio}}

Moment:
{{currentMoment}}

# Respond with qualifying action tags only.
Choose any combination of [LIKE] or [IGNORE] that are appropriate. Each action must be on its own line. Your response must only include the chosen actions.`;

const MOMENTS_BATCH_SIZE = 5

const cognitoClient = new CognitoIdentityProviderClient({
    region: 'us-east-1',
})

export class ClientBase extends EventEmitter {
    runtime: IAgentRuntime;
    config: RemxConfig;
    lastCheckedMomentId: bigint | null = null;
    temperature: number = 0.5;
    wallet: Wallet | null = null;
    profile: RemxProfile | null;
    private cacheKeyPrefix: string;
    chainId: number;
    callback: (self: ClientBase) => any = null;
    private graphQLClient: GraphQLClient
    private graphDBClient: GraphDBClient
    private loginInterval: NodeJS.Timeout | null = null;

    onReady() {
        throw new Error(
            "Not implemented in base class, please call from subclass"
        );
    }

    constructor(runtime: IAgentRuntime, config: RemxConfig) {
        super();
        this.runtime = runtime;
        this.config = config;
        this.graphQLClient = new GraphQLClient(this.config as GraphQLConfig)
        this.graphDBClient = new GraphDBClient(this.config as Neo4jAuth)
    }

    async init() {
        const username = this.config.REMX_WALLET_ADDRESS;

        if (!username) {
            throw new Error("Remx wallet address not configured");
        }

        this.cacheKeyPrefix = `remx/${this.config.REMX_WALLET_ADDRESS}`;

        elizaLogger.log("[REMX] Initializing wallet");

        this.wallet = await this.getWallet();

        elizaLogger.log("[REMX] Logging in");
        await this.login();

        // Set up periodic login check
        this.loginInterval = setInterval(() => {
            this.login().catch(err => {
                elizaLogger.error("[REMX] Periodic login refresh failed:", err);
            });
        }, 5 * 60 * 1000); // 5 minutes

        console.log("Profile", this.profile);
    }

    async login() {
        const accessToken = await this.runtime.cacheManager.get(`${this.cacheKeyPrefix}/accessToken`);
        const accessTokenExpiresAt = await this.runtime.cacheManager.get(`${this.cacheKeyPrefix}/accessTokenExpiresAt`) as number;

        // if we have an access token that is valid for at least 1 minute, we can use it
        if (accessToken && accessTokenExpiresAt > new Date().getTime() - 60 * 1000) {
            elizaLogger.log("[REMX] Using existing access token");
            return;
        }

        elizaLogger.debug("[REMX] Logging in");
        const { loginByWallet: account } = await this.graphQLRequest(LOGIN_BY_WALLET, {
            address: this.config.REMX_WALLET_ADDRESS,
            connectionType: 'wallet',
        })
        elizaLogger.debug("[REMX] found existing account", account);

        const command = new AdminInitiateAuthCommand({
            UserPoolId: this.config.COGNITO_POOL_ID,
            ClientId: this.config.COGNITO_WEB_CLIENT_ID,
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
            UserPoolId: this.config.COGNITO_POOL_ID,
            ClientId: this.config.COGNITO_WEB_CLIENT_ID,
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
        await this.runtime.cacheManager.set(`${this.cacheKeyPrefix}/accessToken`, remxAccessToken)
        await this.runtime.cacheManager.set(`${this.cacheKeyPrefix}/accessTokenExpiresAt`, remxExpiresAt)

        this.profile = await this.getProfile(account.id)
        elizaLogger.log("[REMX] Profile", this.profile)

        this.chainId = await this.getChainId()
        elizaLogger.debug("[REMX] Chain ID", this.chainId)

        const balance = await this.getBalance()
        elizaLogger.debug("[REMX] Agent Balance is", balance)

        const exchangeRate = await this.getExchangeRate()
        elizaLogger.debug("[REMX] Agent Exchange Rate is", exchangeRate)
    }

    /**
     * Populate the moments from the database
     */
    async loadMoments() {
        // get the last seen moment id from the cache
        const lastSeenMomentId = await this.runtime.cacheManager.get(`${this.cacheKeyPrefix}/lastSeenMomentId`) as string | null;
        const theMoments = await this.loadMomentsSince(lastSeenMomentId)
        const newMoments = []

        // for each moment, create a memory if it doesn't exist
        for (const moment of theMoments) {

            const memoryId = stringToUuid(moment.id + "-" + this.runtime.agentId)
            // if the memory already exists, we don't need to create it
            if (await this.runtime.messageManager.getMemoryById(memoryId)) {
                continue
            }
            const roomId = stringToUuid(moment.creator.id + "-" + this.runtime.agentId)

            // create a connection to the creator
            await this.runtime.ensureConnection(
                stringToUuid(moment.creator.id),
                roomId,
                moment.creator.username,
                moment.creator.displayName,
                "remx"
            )

            // this creates a memory associated with the the creator, allowing us to retrieve moments later when
            // composing a context for that creator
            await this.runtime.documentsManager.createMemory({
                id: memoryId,
                userId: stringToUuid(moment.creator.id),
                content: moment.getMemoryContent(this.config.REMX_BASE_URL),
                agentId: this.runtime.agentId,
                roomId,
                embedding: getEmbeddingZeroVector(),
                createdAt: moment.getCreatedAt(),
            })
            // if we want the agent to know about the moment, we can create a second memory with the agentId for the room
            elizaLogger.log(`Memory ${memoryId} created from moment ${moment.id}`)
            newMoments.push(moment)
        }

        // update the last seen moment id in the cache
        if (newMoments.length > 0) {
            await this.runtime.cacheManager.set(`${this.cacheKeyPrefix}/lastSeenMomentId`, newMoments[0].id)
        }
        return newMoments
    }

    async loadMomentsSince(momentId: string) {
        // get the moments since the given moment id

        const result = await this.graphQLRequest(GET_MOMENTS, {
            input: {
                lastMoment: momentId,
                filter: 'all',
                limit: MOMENTS_BATCH_SIZE,
            }
        })
        elizaLogger.log("[REMX] loadMomentsSince", result)

        const moments = result.getMoments.moments.map(moment => Moment.fromGraphQL(this.config, moment))
        return moments
    }

    async getProfile(id: string) {
        const result = await this.graphQLRequest(GET_PROFILE, {
            id,
        })

        const profile = {
            id: result.getProfile.id,
            accountId: result.getProfile.accountId,
            username: result.getProfile.username,
            screenName: result.getProfile.displayName,
            bio: result.getProfile.bio,
            farcasterUsername: result.getProfile.farcasterUsername,
            twitterUsername: result.getProfile.twitterUsername,
            isFollowing: result.getProfile.isFollowing,
            verified: result.getProfile.verified,
        }
        return profile
    }

    async likeMoment(momentId: string) {
        // if not dry run, toggle the reaction
        if (this.config.REMX_DRY_RUN) {
            elizaLogger.log("[REMX] Dry run, would like moment", momentId)
        } else {
            const result = await this.graphQLRequest(TOGGLE_REACTION, {
                input: {
                    relationId:  momentId,
                    relationType: 'Benefit',
                    reactionType: 'like'
                }
            })
        }
    }

    async commentMoment(momentId: string, text: string, creatorId: string) {
        // if not dry run, create the comment
        if (this.config.REMX_DRY_RUN) {
            elizaLogger.log("[REMX] Dry run, would comment on moment", momentId, text)
        } else {

            const result = await this.graphQLRequest(CREATE_COMMENT, {
                input: {
                    relationId: momentId,
                    relationType: 'Benefit',
                    communityId: creatorId,
                    accountId: this.config.REMX_ACCOUNT_ID,
                    content: text,
                }
            })
        }
    }

    async followCreator(creatorId: string) {
        // if not dry run, follow the creator
        if (this.config.REMX_DRY_RUN) {
            elizaLogger.log("[REMX] Dry run, would follow creator", creatorId)
        } else {
            const result = await this.graphQLRequest(FOLLOW_USER, {
                id: creatorId,
            })
        }
    }

    async getChainId(): Promise<number> {
        const result = await this.graphQLRequest(GET_SUPPORTED_NETWORKS, {})
        return result.getSupportedNetworks.defaultChainId
    }

    async getBalance(): Promise<number> {
        try {
            const result = await this.graphQLRequest(GET_BALANCES, {
                input: {
                    id: this.profile.id,
                    chainId: this.chainId,
                }
            })
            return result.getBalances.balances[0].balance
        } catch (error) {
            return 0
        }
    }

    /**
     * Get the exchange rate for ETH -> USD for the current chain
     * @returns the exchange rate for the given chain
     */
    async getExchangeRate(): Promise<number> {
        // use the cacheManager to cache the latest exchange rates for 1 hour
        const cachedExchangeRates = await this.runtime.cacheManager.get(`${this.cacheKeyPrefix}/exchangeRate`) as number
        if (cachedExchangeRates) {
            return cachedExchangeRates
        }

        const result = await this.graphQLRequest(GET_EXCHANGE_PRICES, {})
        await this.runtime.cacheManager.set(`${this.cacheKeyPrefix}/exchangeRate`, result.getExchangePrices.eth, {
            expires: new Date().getTime() + 60 * 60 * 1000
        })
        elizaLogger.log("[REMX] New exchange rate is", result.getExchangePrices.eth)
        return result.getExchangePrices.eth
    }

    /**
     * Get tips given in the past 24 hours
     * @returns the tip history for the past 24 hours
     */
    async getRecentTips(): Promise<any> {
        // use the graphdb client to get the tip history
        const result = await this.graphDBClient.executeQuery(`
           match (user:Account:${this.config.REMX_ENV} {id: $fromAccount})-[:FROM]-(tip:Tip)-[:TO]-(to:Account)
           where tip.created > datetime() - duration('P1D')
           return tip.amount, tip.created, to.id order by tip.created desc
        `, {
            fromAccount: this.profile.id,
        })

        return result.map(tip => ({
            amount: tip.get('tip.amount'),
            created: tip.get('tip.created'),
            toAccount: tip.get('to.id'),
        }))
    }

    async tipCreator(toAccountId: string, amount: number, value: number) {
        // if not dry run, tip the creator
        if (this.config.REMX_DRY_RUN) {
            elizaLogger.log("[REMX] Dry run, would tip creator", toAccountId, amount)
        } else {
            const result = await this.graphQLRequest(TIP_ARTIST, {
                input: {
                    payerId: this.profile.id,
                    recipientId: toAccountId,
                    amount,
                    value,
                    chainId: this.chainId,
                    fundingSource: 'balance'
                }
            })
            elizaLogger.log("[REMX] Tip result", result.tipArtist)
        }
    }

    async graphQLRequest(query: string, variables: Record<string, any>): Promise<any> {
        try {
            const accessToken = await this.runtime.cacheManager.get(`${this.cacheKeyPrefix}/accessToken`) as string|null
            return await this.graphQLClient.request(query, variables, accessToken)
        } catch (error) {
            elizaLogger.error("[REMX] Error in graphQLRequest", error)
            throw error
        }
    }

    async signMessage(message: string): Promise<string> {
        const hashedMessage = hashMessage(message)
        let signature = await this.wallet.createPayloadSignature(hashedMessage)
        signature = await signature.wait()
        return signature.getSignature()
    }

    async getWallet(): Promise<Wallet> {
        Coinbase.configure({
            apiKeyName: this.config.COINBASE_API_KEY_NAME,
            privateKey: this.config.COINBASE_API_KEY_PRIVATE_KEY
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

    async graphDBQuery(query: string, params: Record<string, any> = {}): Promise<any> {
        try {
            return await this.graphDBClient.executeQuery(query, params)
        } catch (error) {
            elizaLogger.error("[REMX] Error in graphDBQuery", error)
            throw error
        }
    }

    async cleanup(): Promise<void> {
        // ... existing cleanup code if any ...
        await this.graphDBClient.close()
    }
}

