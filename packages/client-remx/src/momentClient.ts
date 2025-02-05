import { composeContext, elizaLogger, generateText, IAgentRuntime, ModelClass, ServiceType, UUID, parseJSONObjectFromText } from "@elizaos/core"
import { IImageDescriptionService } from "@elizaos/core"
import { stringToUuid } from "@elizaos/core"
import { getEmbeddingZeroVector } from "@elizaos/core"
import { RemxConfig } from "./environment"
import { Moment } from "./moment"
import { MOMENT_EVALUATION_TEMPLATE } from "./templates/momentEvaluation"
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

interface IClientConfig {
    DRY_RUN?: boolean
    PROCESS_INTERVAL?: number
}

interface IClientProfile {
    username: string
}

interface IRemxClient {
    config: RemxConfig
    profile?: IClientProfile
    init(): Promise<void>
    loadMoments(): Promise<Moment[]>
    likeMoment(momentId: string): Promise<void>
    commentMoment(momentId: string, text: string, profileId: string): Promise<void>
    followCreator(creatorId: string): Promise<void>
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
                if (action.action === 'LIKE') {
                    if (!moment.creator.isFollowing) {
                        await this.client.followCreator(moment.creator.id)
                    }
                    if (moment.reaction !== 'like') {
                        await this.client.likeMoment(moment.id)
                    }
                    await this.client.commentMoment(moment.id, action.comment, moment.creator.id)
                    // maybe tip?
                }
                console.log('REMX Moment Action:', action)
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
        const roomId = stringToUuid(moment.creator.id + "-" + this.runtime.agentId)

        const imageDescriptionService = this.runtime.getService<IImageDescriptionService>(ServiceType.IMAGE_DESCRIPTION)

        const { description} = await imageDescriptionService.describeImage(moment.assetFile)
        console.log(description)

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
            imageDescription: description,
        })

        const momentContext = composeContext({
            state: momentState,
            template: MOMENT_EVALUATION_TEMPLATE,
        });

        const momentResponse = await generateText({
            runtime: this.runtime,
            context: momentContext,
            modelClass: ModelClass.SMALL,
        });

        const momentResponseObject = parseJSONObjectFromText(momentResponse) as IMomentAction
        console.log(momentResponseObject)

        return momentResponseObject
    }
}
