import { elizaLogger, IAgentRuntime } from "@elizaos/core"
import { IRemxClient } from "./types"
import Table from 'table-layout'
import schedule from 'node-schedule'

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
    regularAmount: number
    regularValue: number
    highValueAmount: number
    highValueValue: number
}

interface ITippingSummary {
    totalTips: number
    uniqueArtistsTipped: number
}

interface ITip {
    slug: string
    tip: number
}

interface IReport {
    date: string
    totalTips: number
    uniqueArtists: number
    tipsGiven: ITip[]
}

interface ITippingSummary {
    totalTips: number
    uniqueArtistsTipped: number
}

interface ITip {
    slug: string
    tip: number
}

interface IReport {
    date: string
    totalTips: number
    uniqueArtists: number
    tipsGiven: ITip[]
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
with artist, totalMoments, totalTipsReceived, totalTipsGiven, count(t) as totalZanTips
optional match (artist)-[:TO]-(t:Tip)-[:FROM]-(zan:Account {id: $agentId}) where t.created >= datetime() - duration('P1D')
with artist, totalMoments, totalTipsGiven, totalTipsReceived, round(100 * totalTipsGiven / totalTipsReceived) as tipPercentage, sum(t.amount) as recentZanTips, totalZanTips
where recentZanTips = 0
return artist.id as artistId, artist.slug as username, totalMoments, totalTipsGiven, totalTipsReceived, round(100 * totalTipsGiven / totalTipsReceived) as tipPercentage, totalZanTips
order by totalMoments desc
`

const GET_WEEKLY_HIGH_VALUE_TIPS = `
match (zan:Account {id: $agentId})-[:FROM]-(t:Tip)-[:TO]-(artist:Account {id: $artistId})
where t.amount >= 20 and t.created >= datetime() - duration('P7D')
return count(t) as tipCount, sum(t.amount) as totalAmount
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
        elizaLogger.log(`- Weekly High-Value Tip Budget: $${this.client.config.REMX_WEEKLY_HIGH_VALUE_BUDGET || "200"}`)

        // In your initialization code
        this.scheduleDailyReport().catch(error => {
            elizaLogger.error("Error scheduling daily report:", error)
        })
    }

    async start(): Promise<void> {
        if (!this.client.profile) {

        // run an immediate report
        const report = await this.generateDailyReport()
        await this.sendReportToSlack(report)
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

        // run an immediate report
        const report = await this.generateDailyReport()
        await this.sendReportToSlack(report)
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
        let regularAmount = 0
        let highValueAmount = 0
        const exchangeRate = await this.client.getExchangeRate()

        if (artist.tipPercentage >= 90) {
            regularAmount = 5
            // Check if artist already received a high-value tip this week
            const weeklyTips = await this.checkWeeklyHighValueTips(artist.id)
            highValueAmount = weeklyTips.tipCount === 0 ? 20 : 0
        } else if (artist.tipPercentage >= 50 && artist.tipPercentage < 90) {
            regularAmount = 4
        } else if (artist.tipPercentage >= 20 && artist.tipPercentage < 50) {
            regularAmount = 2
        } else if (artist.tipPercentage >= 10 && artist.tipPercentage < 20) {
            regularAmount = 1
        } else if (artist.tipPercentage < 10 && artist.totalZanTips < 5) {
            regularAmount = 1
        }

        return {
            regularAmount,
            regularValue: regularAmount / exchangeRate,
            highValueAmount,
            highValueValue: highValueAmount / exchangeRate
        }
    }

    private async checkWeeklyHighValueTips(artistId: string): Promise<{tipCount: number, totalAmount: number}> {
        const results = await this.client.graphDBQuery(GET_WEEKLY_HIGH_VALUE_TIPS, {
            agentId: this.client.profile?.id,
            artistId
        })
        
        return {
            tipCount: results[0].get("tipCount"),
            totalAmount: results[0].get("totalAmount") || 0
        }
    }

    private async tipDecision(artist: IArtistToTip, tipCalc: ITipCalculation): Promise<{shouldTip: boolean, useHighValue: boolean}> {
        const balance = await this.client.getBalance()
        const recentTip = await this.client.getRecentTips(artist.id)
        const recentTipsAmount = recentTip.reduce((acc, tip) => acc + tip.amount, 0)

        // First check if we can do a high-value tip
        let useHighValue = false
        if (tipCalc.highValueAmount > 0) {
            // Check if we're within weekly high-value budget
            const allWeeklyTips = await this.client.graphDBQuery(`
                match (zan:Account {id: $agentId})-[:FROM]-(t:Tip)-[:TO]-(artist:Account)
                where t.amount >= 20 and t.created >= datetime() - duration('P7D')
                return sum(t.amount) as totalAmount
            `, { agentId: this.client.profile?.id })

            const weeklyHighValueTotal = allWeeklyTips[0].get("totalAmount") || 0
            const weeklyBudget = this.client.config.REMX_WEEKLY_HIGH_VALUE_BUDGET

            useHighValue = weeklyHighValueTotal + tipCalc.highValueAmount <= weeklyBudget
        }

        const tipAmount = useHighValue ? tipCalc.highValueValue : tipCalc.regularValue
        const dollarAmount = useHighValue ? tipCalc.highValueAmount : tipCalc.regularAmount

        console.log(`Tip Decision for ${artist.username}:
 - Agent balance: ${balance}
 - Recent tips: ${recentTipsAmount}
 - Tip percentage: ${artist.tipPercentage}
 - Using high value tip: ${useHighValue}
 - Tip amount and value: $${dollarAmount} : ${tipAmount} ETH`)

        // can't tip if we are low on funds
        if (balance < tipAmount * 1.5) {
            elizaLogger.log(`Not tipping ${artist.username} because balance is too low`)
            return { shouldTip: false, useHighValue }
        }

        // Check daily limit only for regular tips
        if (!useHighValue && recentTipsAmount >= this.client.config.REMX_DAILY_TIP_LIMIT) {
            elizaLogger.log(`Not tipping ${artist.username} because we've reached our daily limit`)
            return { shouldTip: false, useHighValue }
        }

        return { shouldTip: true, useHighValue }
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
                    const decision = await this.tipDecision(artist, tipCalc)

                    if (decision.shouldTip) {
                        const amount = decision.useHighValue ? tipCalc.highValueAmount : tipCalc.regularAmount
                        const value = decision.useHighValue ? tipCalc.highValueValue : tipCalc.regularValue

                        if (!this.isDryRun) {
                            await this.client.tipCreator(artist.id, amount, value)
                            results.push(artist)
                            elizaLogger.log(`Tipped ${artist.username} $${amount} (${value} ETH)`)
                        } else {
                            elizaLogger.log(`[DRY RUN] Tipped ${artist.username} $${amount} (${value} ETH)`)
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

    private async getTippingSummary(): Promise<ITippingSummary> {
        const results = await this.client.graphDBQuery(`match (zan:Account {id: $agentId})-[:FROM]-(tip:Tip)-[:TO]-(artist:Account) 
where tip.created > datetime() - duration('P1D') 
return sum(tip.amount) as totalTips, count(artist) as uniqueArtistsTipped`, {
            agentId: this.client.profile?.id
        })

        return {
            totalTips: results[0].get("totalTips"),
            uniqueArtistsTipped: results[0].get("uniqueArtistsTipped")
        }
    }    

    private async getTipsGiven(): Promise<ITip[]> {
        const results = await this.client.graphDBQuery(`match (zan:Account {id: $agentId})-[:FROM]-(tip:Tip)-[:TO]-(artist:Account) 
where tip.created > datetime() - duration('P1D') 
return artist.slug as slug, sum(tip.amount) as tip order by tip desc`, {
            agentId: this.client.profile?.id
        })

        return results.map((result: any) => ({
            slug: result.get("slug"),
            tip: result.get("tip")
        }))
    }

    private async generateDailyReport(): Promise<IReport> {
        const tippingSummary = await this.getTippingSummary()
        const tipsGiven = await this.getTipsGiven()
        return {
            date: new Date().toISOString(),
            totalTips: tippingSummary.totalTips,
            uniqueArtists: tippingSummary.uniqueArtistsTipped,
            tipsGiven: tipsGiven
        }
    }

    private async formatSlackReport(report: IReport): Promise<any> {

        const balance = await this.client.getBalance()
        const exchangeRate = await this.client.getExchangeRate()
        const balanceUSD = balance * exchangeRate

        // Format the date for display
        const reportDate = new Date().toLocaleString('en-US', {
            dateStyle: 'full',
            timeStyle: 'short'
        })

        // Create table of tip details
        const table = new Table(report.tipsGiven, {
            columns: [
                { name: "artistName" },
                { name: "tipAmount" },
            ]
        })
        const tableOutput = table.toString()

        // Construct Slack blocks
        const blocks = [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": "🤖 Daily Tipping Report",
                    "emoji": true
                }
            },
            {
                "type": "context",
                "elements": [
                    {
                        "type": "plain_text",
                        "text": `Generated on ${reportDate} by ${this.client.profile?.username}`,
                        "emoji": true
                    }
                ]
            },
            {
                "type": "divider"
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*Current Balance:* ${balance.toFixed(4)} ETH ($${balanceUSD.toFixed(2)})`
                }
            },
    {
                "type": "section",
                "fields": [
                    {
                        "type": "mrkdwn",
                        "text": `*Total Tips:*\n$${report.totalTips?.toFixed(2)}`
                    },
                    {
                        "type": "mrkdwn",
                        "text": `*Artists Tipped:*\n${report.uniqueArtists}`
                    }
                ]
            },
            {
                "type": "divider"
            },
            {
                "type": "rich_text",
                "elements": [
                    {
                        "type": "rich_text_section",
                        "elements": [
                            {
                                "type": "text",
                                "text": "Detailed Tip Activity:"
                            }
                        ]
                    },
                    {
                        "type": "rich_text_preformatted",
                        "elements": [
                            {
                                "type": "text",
                                "text": tableOutput
                            }
                        ]
                    }
                ]
            }
        ]

        return {
            text: "🤖 Daily Tipping Report",
            username: this.client.profile?.username,
            icon_emoji: ":robot_face:",
            channel: "#zan-tipping-reports",            
            blocks
        }
    }

    private async sendReportToSlack(report: IReport): Promise<void> {
        try {
            const formattedReport = await this.formatSlackReport(report)
            await this.client.sendSlackMessage(formattedReport)
            console.log(`Report sent to Slack successfully at ${new Date().toISOString()}`)
        } catch (error) {
            console.log(`Error sending report to Slack: ${error}`)
            throw error
        }
    }

    public async scheduleDailyReport(): Promise<void> {
        
        const that = this
        // Schedule for 9:00 AM every day
        console.log(`Scheduling daily report`)
        schedule.scheduleJob('0 9 * * *', async () => {
            try {
                console.log(`Generating daily report at ${new Date().toISOString()}`)
                const report = await that.generateDailyReport()
                await that.sendReportToSlack(report)
                console.log(`Daily report generated and sent at ${new Date().toISOString()}`)
            } catch (error) {
                console.log(`Error generating daily report: ${error}`)
            }
        })
    }
}