import { composeContext, elizaLogger, IAgentRuntime, ServiceType, UUID, parseJSONObjectFromText, Content } from "@elizaos/core"
import { stringToUuid } from "@elizaos/core"
import { getEmbeddingZeroVector } from "@elizaos/core"
import { Moment, IMomentContext } from "./moment"
import { MOMENT_EVALUATION_TEMPLATE } from "./templates/momentEvaluation"
import { IRemxClient } from "./types"
import { IRemxImageDescriptionService } from "./services/image"

interface IMoment {
    id: string
    content: string
    action?: string
    timestamp: number
}

interface IMomentAction {
    summary: string
    action: string
    comment: string
}

export class MomentClient {
    private runtime: IAgentRuntime
    private client: IRemxClient
    private isProcessing: boolean = false
    private lastProcessTime: number = 0
    private stopProcessing: boolean = false
    private isDryRun: boolean = false

    constructor(client: IRemxClient, runtime: IAgentRuntime) {
        this.client = client
        this.runtime = runtime
        this.isDryRun = this.client.config.REMX_DRY_RUN || false

        // Log configuration on initialization
        elizaLogger.log("Moment Processor Configuration:")
        elizaLogger.log(`- Dry Run Mode: ${this.isDryRun ? "enabled" : "disabled"}`)
        elizaLogger.log(`- Process Interval: ${this.client.config.REMX_PROCESS_INTERVAL || "5"} minutes`)

        if (this.isDryRun) {
            elizaLogger.log("Moment processor initialized in dry run mode - no actual moments will be processed")
        }
    }

    async start(): Promise<void> {
        if (!this.client.profile) {
            await this.client.init()
        }

        const processMomentsLoop = async (): Promise<void> => {
            const processInterval = this.client.config.REMX_PROCESS_INTERVAL || 5 // Default to 5 minutes

            while (!this.stopProcessing) {
                try {
                    const results = await this.processMoments()
                    if (results) {
                        elizaLogger.log(`Processed ${results.length} moments`)
                        elizaLogger.log(`Next processing scheduled in ${processInterval} minutes`)
                        // Wait for the full interval before next processing
                        await new Promise(resolve => setTimeout(resolve, processInterval * 60 * 1000))
                    }
                } catch (error) {
                    elizaLogger.error("Error in moment processing loop:", error)
                    // Add exponential backoff on error
                    await new Promise(resolve => setTimeout(resolve, 30000)) // Wait 30s on error
                }
            }
        }

        processMomentsLoop().catch(error => {
            elizaLogger.error("Fatal error in process moments loop:", error)
        })
    }

    async processMoments(): Promise<Moment[] | null> {
        if (this.isProcessing) {
            elizaLogger.log("Already processing moments, skipping")
            return null
        }

        try {
            this.isProcessing = true
            this.lastProcessTime = Date.now()

            elizaLogger.log("Processing moments")

            const moments = await this.client.loadMoments()

            console.log("Moments", moments)

            // Ensure user exists
            await this.runtime.ensureUserExists(
                this.runtime.agentId,
                this.client.profile?.username || "",
                this.runtime.character.name,
                "remx"
            )

            const results: Moment[] = []

            for (const moment of moments) {
                // Check if we already have a memory for this moment
                const memoryId = stringToUuid(`${moment.id}-${this.runtime.agentId}`)
                const existingMemory = await this.runtime.messageManager.getMemoryById(memoryId)

                if (existingMemory) {
                    elizaLogger.log(`[REMX] Already processed moment ${moment.id}, skipping`)
                    continue
                }

                const action = await this.momentAction(moment)
                elizaLogger.debug('REMX Moment Action:', action)

                const memoryContext: IMomentContext = {}

                if (action.action === 'LIKE') {
                    if (!moment.creator.isFollowing) {
                        await this.client.followCreator(moment.creator.id)
                    }
                    if (moment.reaction !== 'like') {
                        await this.client.likeMoment(moment.id)
                        memoryContext.liked = true
                    }

                    await this.client.commentMoment(moment.id, action.comment, moment.creator.id)
                    memoryContext.commented = action.comment

                    // Only tip if the creator is verified as human
                    if (moment.creator.verifiedType === 'human') {
                        const balance = await this.client.getBalance()
                        const exchangeRate = await this.client.getExchangeRate()
                        const tipAmount = 1 / exchangeRate

                        // this is tips given by the agent to all creators in the past 24 hours
                        const recentTips = await this.client.getRecentTips(moment.creator.id)
                        // this is the sum of all tips given by the agent to all creators in the past 24 hours
                        const recentTipsAmount = recentTips.reduce((acc, tip) => acc + tip.amount, 0)

                        // this is the minimum balance needed to tip the creator
                        const hasSufficientBalance = balance >= tipAmount * 2
                        // this is the maximum number of tips allowed in the past 24 hours
                        const underDailyLimit = recentTipsAmount < this.client.config.REMX_DAILY_TIP_LIMIT
                        // this is to ensure we don't tip the same creator more than once in a 24 hour period
                        const notRecentlyTipped = !recentTips.some(tip => tip.toAccount === moment.creator.id)

                        elizaLogger.log(`[REMX] Tip check:
  Creator: ${moment.creator.username} (${moment.creator.id})
  Agent's Remx  Balance: ${balance} (minimum balance needed is: ${tipAmount * 2})
  Tips given in last 24 hours: ${recentTipsAmount} (maximum allowed is: ${this.client.config.REMX_DAILY_TIP_LIMIT})
  Tips given to this creator in the last 24 hours: ${recentTips.filter(tip => tip.toAccount === moment.creator.id).reduce((acc, tip) => acc + tip.amount, 0)}
  Amount to tip: ${tipAmount}
  ------------------------------
  Tip decision: ${hasSufficientBalance && underDailyLimit && notRecentlyTipped ? 'Tip' : 'No tip'}
`)

                        if (hasSufficientBalance && underDailyLimit && notRecentlyTipped) {
                            const tipResult = await this.client.tipCreator(moment.creator.id, 1, tipAmount)
                            elizaLogger.log("[REMX] Tip result", tipResult)
                            memoryContext.tipped = tipAmount
                        }
                    } else {
                        elizaLogger.log("[REMX] No tip - creator type:", moment.creator.verifiedType)
                    }
                }

                // Create a single memory with the full context
                const roomId = stringToUuid(moment.creator.id + "-" + this.runtime.agentId)
                await this.createMemory(roomId, memoryId, moment.getMemoryContent(this.client.config.REMX_BASE_URL, memoryContext))
                results.push(moment)
            }

            return results

        } catch (error) {
            elizaLogger.error("Error in processMoments:", error)
            throw error
        } finally {
            this.isProcessing = false
        }
    }

    async createMemory(roomId: UUID, id: UUID, content: Content): Promise<void> {
        try {
            // Add these checks before creating memory
            await this.runtime.ensureRoomExists(roomId)
            await this.runtime.ensureParticipantInRoom(this.runtime.agentId, roomId)

            if (!this.isDryRun) {
                // Create the memory with additional context and include agent ID in memory ID
                await this.runtime.messageManager.createMemory({
                    id,
                    userId: this.runtime.agentId,
                    content,
                    agentId: this.runtime.agentId,
                    roomId,
                    embedding: getEmbeddingZeroVector(),
                    createdAt: new Date().getTime()
                })
            }
        } catch (error) {
            elizaLogger.error(`Error creating memory for moment with content: ${content}`, error)
        }
    }

    async stop(): Promise<void> {
        this.stopProcessing = true
    }

    private async momentAction(moment: Moment): Promise<IMomentAction> {
        if (moment.assetType.startsWith("video")) {
            elizaLogger.log("[REMX] Moment is a video, skipping")
            return {
                summary: "",
                action: "IGNORE",
                comment: ""
            }
        }
        const roomId = stringToUuid(moment.creator.id + "-" + this.runtime.agentId)

        // Use the client's image description service directly
        const imageDescriptionService = this.runtime.getService<IRemxImageDescriptionService>(ServiceType.IMAGE_DESCRIPTION)

        // const { description } = await imageDescriptionService.describeImage(moment.assetFile)
        // console.log('[REMX] Description', description)

        const momentState = await this.runtime.composeState({
            userId: this.runtime.agentId,
            roomId,
            agentId: this.runtime.agentId,
            content: { text: "", action: "" },
        }, {
            creatorName: moment.creator.username,
            creatorBio: moment.creator.bio,
            title: moment.title,
            description: moment.description,
            tags: moment.tags.join(', '),
        })

        const momentContext = composeContext({
            state: momentState,
            template: MOMENT_EVALUATION_TEMPLATE,
        });

        console.log('[REMX] Moment Context', momentContext)

        const momentResponse = await imageDescriptionService.describeImageWithPrompt(momentContext, moment.imageUrl)

        const momentResponseObject = parseJSONObjectFromText(momentResponse) as IMomentAction
        console.log('[REMX] Moment Response Object', momentResponseObject)

        return momentResponseObject
    }
}
