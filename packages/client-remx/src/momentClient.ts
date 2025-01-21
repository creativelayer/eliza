import { composeContext, elizaLogger, generateText, IAgentRuntime, ModelClass, ServiceType, UUID, parseJSONObjectFromText, IImageDescriptionService } from "@elizaos/core"
import { stringToUuid } from "@elizaos/core"
import { getEmbeddingZeroVector } from "@elizaos/core"
import { Moment } from "./moment"
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

    async processMoments(): Promise<IMoment[] | null> {
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

            // Process moments logic will go here
            const results: IMoment[] = []

            for (const moment of moments) {
                const action = await this.momentAction(moment)
                elizaLogger.debug('REMX Moment Action:', action)
                if (action.action === 'LIKE') {
                    if (!moment.creator.isFollowing) {
                        await this.client.followCreator(moment.creator.id)
                    }
                    if (moment.reaction !== 'like') {
                        await this.client.likeMoment(moment.id)
                    }
                    // TODO: if this is the user's first moment, customize the comment to welcome them
                    await this.client.commentMoment(moment.id, action.comment, moment.creator.id)
                    // TODO: tip creator
                    // 1. do we have enough funds in our balance?
                    const balance = await this.client.getBalance()
                    elizaLogger.log("[REMX] Agent balance is", balance)
                    // how much is needed to tip $1?
                    const exchangeRate = await this.client.getExchangeRate()
                    elizaLogger.log("[REMX] Exchange rate is", exchangeRate)
                    const tipAmount = 1 / exchangeRate
                    elizaLogger.log("[REMX] Tip amount is", tipAmount)

                    const recentTips = await this.client.getRecentTips(moment.creator.id)
                    const recentTipsAmount = recentTips.reduce((acc, tip) => acc + tip.amount, 0)
                    elizaLogger.log(`[REMX] Tipped ${recentTipsAmount} of ${this.client.config.REMX_DAILY_TIP_LIMIT} in the last 24 hours`)

                    // 1. make sure we have enough balance to tip $1
                    if (balance < tipAmount * 2) {
                        elizaLogger.log("[REMX] Not enough balance to tip")
                        continue
                    }

                    // 2. check if we have already tipped our limit in the last 24 hours
                    if (recentTipsAmount >= this.client.config.REMX_DAILY_TIP_LIMIT) {
                        elizaLogger.log("[REMX] Tip budget used up")
                        continue
                    }

                    // 3. have we tipped this creator in the last 24 hours?
                    const artistTips = recentTips.filter(tip => tip.toAccount === moment.creator.id)
                    elizaLogger.log("[REMX] Artist tips", artistTips)
                    if (artistTips.length > 0) {
                        elizaLogger.log("[REMX] Already tipped this creator in the last 24 hours")
                        continue
                    }

                    // 4. if not, tip the creator $1
                    const tipResult = await this.client.tipCreator(moment.creator.id, 1, tipAmount)
                    elizaLogger.log("[REMX] Tip result", tipResult)
                }
            }

            return results

        } catch (error) {
            elizaLogger.error("Error in processMoments:", error)
            throw error
        } finally {
            this.isProcessing = false
        }
    }

    async createMemory(moment: IMoment, roomId: UUID): Promise<void> {
        try {
            // Add these checks before creating memory
            await this.runtime.ensureRoomExists(roomId)
            await this.runtime.ensureParticipantInRoom(this.runtime.agentId, roomId)

            if (!this.isDryRun) {
                // Create the memory
                await this.runtime.messageManager.createMemory({
                    id: stringToUuid(moment.id + "-" + this.runtime.agentId),
                    userId: this.runtime.agentId,
                    content: {
                        text: moment.content,
                        source: "remx",
                        action: moment.action
                    },
                    agentId: this.runtime.agentId,
                    roomId,
                    embedding: getEmbeddingZeroVector(),
                    createdAt: moment.timestamp
                })
            }
        } catch (error) {
            elizaLogger.error(`Error creating memory for moment ${moment.id}:`, error)
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

        const momentResponse = await imageDescriptionService.describeImageWithPrompt(momentContext, moment.assetFile)

        const momentResponseObject = parseJSONObjectFromText(momentResponse) as IMomentAction
        console.log('[REMX] Moment Response Object', momentResponseObject)

        return momentResponseObject
    }
}
