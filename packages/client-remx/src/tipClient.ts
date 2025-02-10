import { elizaLogger, IAgentRuntime } from "@elizaos/core"
import { IRemxClient } from "./types"

interface IArtistToTip {
    id: string
    username: string
    totalMoments: number
    totalTipsGiven: number
    totalTipsReceived: number
    tipPercentage: number
    totalZanTips: number
}

interface ITipCalculation {
    amount: number
    value: number
}

const GET_ARTISTS_TO_TIP = `
match (artist:Account)-[:CREATED]-(m:Moment) where m.saleDate >= datetime()-duration('P1D')
with artist
match (artist)-[:CREATED]-(m:Moment)
with artist, count(m) as totalMoments
match (artist)-[:TO]-(t:Tip)
with artist, totalMoments, sum(t.amount) as totalTipsReceived
match (artist)-[:FROM]-(t:Tip)
with artist, totalMoments, totalTipsReceived, sum(t.amount) as totalTipsGiven
optional match (artist)<-[:TO]-(t:Tip)-[:FROM]->(zan:Account {id: $agentId}) 
with artist, totalMoments, totalTipsReceived, sum(t.amount) as totalTipsGiven, count(t) as totalZanTips
optional match (artist)-[:TO]-(t:Tip)-[:FROM]-(zan:Account {id: $agentId}) where t.created >= datetime() - duration('P1D')
with artist, totalMoments, totalTipsGiven, totalTipsReceived, round(100 * totalTipsGiven / totalTipsReceived) as tipPercentage, sum(t.amount) as recentZanTips, totalZanTips
where recentZanTips = 0
return artist.id as artistId, artist.slug as username, totalMoments, totalTipsGiven, totalTipsReceived, round(100 * totalTipsGiven / totalTipsReceived) as tipPercentage, totalZanTips
order by totalMoments desc
`

export class TipClient {
    private runtime: IAgentRuntime
    private client: IRemxClient
    private isProcessing: boolean = false
    private stopProcessing: boolean = false
    private isDryRun: boolean = false

    constructor(client: IRemxClient, runtime: IAgentRuntime) {
        this.client = client
        this.runtime = runtime
        this.isDryRun = this.client.config.REMX_DRY_RUN || false

        // Log configuration on initialization
        elizaLogger.log("Tip Processor Configuration:")
        elizaLogger.log(`- Dry Run Mode: ${this.isDryRun ? "enabled" : "disabled"}`)
        elizaLogger.log(`- Tip Process Interval: ${this.client.config.REMX_TIP_INTERVAL || "60"} minutes`)
    }

    async start(): Promise<void> {
        if (!this.client.profile) {
            await this.client.init()
        }

        const processTipsLoop = async (): Promise<void> => {
            const processInterval = this.client.config.REMX_TIP_INTERVAL || 60 // Default to 60 minutes

            while (!this.stopProcessing) {
                try {
                    const results = await this.processTips()
                    elizaLogger.log(`Processed tips for ${results?.length || 0} artists`)
                    elizaLogger.log(`Next tip processing scheduled in ${processInterval} minutes`)
                    // Wait for the full interval before next processing
                    await new Promise(resolve => setTimeout(resolve, processInterval * 60 * 1000))
                } catch (error) {
                    elizaLogger.error("Error in tip processing loop:", error)
                    // Add exponential backoff on error
                    await new Promise(resolve => setTimeout(resolve, 30000)) // Wait 30s on error
                }
            }
        }

        processTipsLoop().catch(error => {
            elizaLogger.error("Fatal error in process tips loop:", error)
        })
    }

    private async getArtistsToTip(): Promise<IArtistToTip[]> {
        const artists = await this.client.graphDBQuery(GET_ARTISTS_TO_TIP, {
            agentId: this.client.profile?.id
        })
        return artists.map((artist: any) => ({
            id: artist.get("artistId"),
            username: artist.get("username"),
            totalMoments: artist.get("totalMoments"),
            totalTipsGiven: artist.get("totalTipsGiven"),
            totalTipsReceived: artist.get("totalTipsReceived"),
            tipPercentage: artist.get("tipPercentage"),
            totalZanTips: artist.get("totalZanTips"),
        }))
    }

    private async calculateTipAmount(artist: IArtistToTip): Promise<ITipCalculation> {
        let amount = 0
        if (artist.totalZanTips < 5) {
            amount = 1
        } else if (artist.tipPercentage < 10) {
            amount = 0
        } else if (artist.tipPercentage < 20) {
            amount = 1
        } else if (artist.tipPercentage < 50) {
            amount = 2
        } else if (artist.tipPercentage < 90) {
            amount = 4
        } else {
            amount = 20
        }

        const exchangeRate = await this.client.getExchangeRate()
        return {
            amount,
            value: amount / exchangeRate
        }
    }

    private async tipDecision(artist: IArtistToTip, tipCalc: ITipCalculation): Promise<boolean> {
        const balance = await this.client.getBalance()
        const recentTip = await this.client.getRecentTips(artist.id)
        const recentTipsAmount = recentTip.reduce((acc, tip) => acc + tip.amount, 0)

        console.log(`Tip Decision for ${artist.username}
 - Agent balance: ${balance}
 - Recent tips: ${recentTipsAmount}
 - Tip percentage: ${artist.tipPercentage}
 - Tip amount and value: $${tipCalc.amount} : ${tipCalc.value} ETH`)

        // can't tip if we are low on funds
        if (balance < tipCalc.value * 2) {
            elizaLogger.log(`Not tipping ${artist.username} because balance is too low`)
            return false
        }

        // always tip the top artists, regardless of daily limit
        if (artist.tipPercentage >= 90) {
            elizaLogger.log(`Tipping ${artist.username} because they are a top tipper`)
            return true
        }

        // can't tip if we have tipped too much in the last 24 hours
        if (recentTipsAmount >= this.client.config.REMX_DAILY_TIP_LIMIT) {
            elizaLogger.log(`Not tipping ${artist.username} because we've reached our daily limit`)
            return false
        }

        return true
    }

    async processTips(): Promise<IArtistToTip[] | null> {
        if (this.isProcessing) {
            elizaLogger.log("Already processing tips, skipping")
            return null
        }

        try {
            this.isProcessing = true
            const artists = await this.getArtistsToTip()
            const results: IArtistToTip[] = []

            for (const artist of artists) {
                try {
                    const tipCalc = await this.calculateTipAmount(artist)

                    if (tipCalc.amount > 0 && await this.tipDecision(artist, tipCalc)) {
                        if (!this.isDryRun) {
                            await this.client.tipCreator(artist.id, tipCalc.amount, tipCalc.value)
                            results.push(artist)
                            elizaLogger.log(`Tipped ${artist.username} $${tipCalc.amount} (${tipCalc.value} ETH)`)
                        } else {
                            elizaLogger.log(`[DRY RUN] Tipped ${artist.username} $${tipCalc.amount} (${tipCalc.value} ETH)`)
                        }
                    }
                } catch (error) {
                    elizaLogger.error(`Error processing tip for artist ${artist.username}:`, error)
                }
            }

            return results
        } catch (error) {
            elizaLogger.error("Error in processTips:", error)
            throw error
        } finally {
            this.isProcessing = false
        }
    }

    async stop(): Promise<void> {
        this.stopProcessing = true
    }
}