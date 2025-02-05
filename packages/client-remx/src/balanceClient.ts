import { elizaLogger, IAgentRuntime } from "@elizaos/core"
import { RemxConfig } from "./environment"
import { IRemxClient } from "./types"

interface IBalanceState {
    balance: number
    lastUpdated: number
}

export class BalanceClient {
    private runtime: IAgentRuntime
    private client: IRemxClient
    private isProcessing: boolean = false
    private stopProcessing: boolean = false
    private state: IBalanceState = {
        balance: 0,
        lastUpdated: 0
    }

    constructor(client: IRemxClient, runtime: IAgentRuntime) {
        this.client = client
        this.runtime = runtime

        // Log configuration on initialization
        elizaLogger.log("Balance Client Configuration:")
        elizaLogger.log(`- Process Interval: 60 minutes`)
    }

    async start(): Promise<void> {
        if (!this.client.profile) {
            await this.client.init()
        }

        const processBalanceLoop = async (): Promise<void> => {
            const processInterval = 60 // 60 minutes

            while (!this.stopProcessing) {
                try {
                    await this.processBalance()
                    elizaLogger.log(`Next balance check scheduled in ${processInterval} minutes`)
                    // Wait for the full interval before next processing
                    await new Promise(resolve => setTimeout(resolve, processInterval * 60 * 1000))
                } catch (error) {
                    elizaLogger.error("Error in balance processing loop:", error)
                    // Add exponential backoff on error
                    await new Promise(resolve => setTimeout(resolve, 30000)) // Wait 30s on error
                }
            }
        }

        processBalanceLoop().catch(error => {
            elizaLogger.error("Fatal error in process balance loop:", error)
        })
    }

    async processBalance(): Promise<void> {
        if (this.isProcessing) {
            elizaLogger.log("Already processing balance, skipping")
            return
        }

        try {
            this.isProcessing = true

            elizaLogger.log("Checking balance")
            const balance = await this.client.getBalance()

            this.state = {
                balance,
                lastUpdated: Date.now()
            }

            elizaLogger.log(`Current balance: ${balance}`)

        } catch (error) {
            elizaLogger.error("Error in processBalance:", error)
            throw error
        } finally {
            this.isProcessing = false
        }
    }

    async stop(): Promise<void> {
        this.stopProcessing = true
    }

    getBalance(): IBalanceState {
        return this.state
    }
}