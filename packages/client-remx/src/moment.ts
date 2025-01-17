import { Content, Memory } from "@elizaos/core"
import { RemxConfig } from "./environment"

export interface Creator {
    id: string
    displayName: string
    username: string
    bio: string
    isFollowing: boolean
    twitterUsername: string | null
}

export interface MomentData {
    id: string
    title: string
    description: string
    url: string
    creator: Creator
    saleDate: Date | null
    assetFile: string | null
    assetType: string | null
    reaction: string | null
}

export class Moment {
    public id: string
    public title: string
    public description: string
    public url: string
    public creator: Creator
    public saleDate: Date | null
    public assetFile: string | null
    public assetType: string | null
    public tags: string[]
    public reaction: string | null
    constructor() {
        this.id = ''
        this.title = ''
        this.description = ''
        this.url = ''
        this.creator = {
            id: '',
            displayName: '',
            username: '',
            bio: '',
            isFollowing: false,
            twitterUsername: null
        }
        this.saleDate = null
        this.assetFile = null
        this.assetType = null
        this.tags = []
        this.reaction = null
    }

    static fromGraphQL(config: RemxConfig, momentData: any): Moment {
        const moment = new Moment()
        moment.id = momentData.benefit.id
        moment.title = momentData.benefit.title
        moment.description = momentData.benefit.description
        moment.url = `${config.REMX_BASE_URL}/${momentData.community.account.profile.username}/${momentData.benefit.id}`
        moment.creator = {
            id: momentData.community.account.id,
            displayName: momentData.community.account.profile.displayName,
            username: momentData.community.account.profile.username,
            bio: momentData.community.account.profile.bio,
            isFollowing: momentData.community.account.profile.isFollowing,
            twitterUsername: momentData.community.account.profile.twitterUsername || null
        }
        moment.saleDate = momentData.collection.auction.saleDate ? new Date(momentData.collection.auction.saleDate) : null
        moment.assetFile = `${config.REMX_ASSET_URL}/${momentData.collection.metadata?.assetFile}`
        moment.assetType = momentData.collection.metadata?.assetType || null
        moment.tags = momentData.benefit.categories || []
        moment.reaction = momentData.benefit.reaction || null
        return moment
    }

    static fromJSON(json: MomentData): Moment {
        const moment = new Moment()
        moment.id = json.id
        moment.title = json.title
        moment.description = json.description
        moment.url = json.url
        moment.creator = json.creator
        moment.saleDate = json.saleDate
        moment.assetFile = json.assetFile
        moment.assetType = json.assetType
        moment.reaction = json.reaction
        return moment
    }

    static fromMemory(memory: Memory): Moment {
        // Extract moment data from memory content
        const momentData = memory.content.moment as MomentData
        if (!momentData) {
            throw new Error(`Invalid memory content: missing moment data`)
        }

        // Create new moment from the stored data
        return Moment.fromJSON(momentData)
    }

    getMemoryContent(baseUrl: string): Content {
        return {
            text: `A Collectible Moment by ${this.creator.displayName} with title ${this.title} and description ${this.description}`,
            url: `${baseUrl}/${this.url}`,
            source: 'remx',
            inReplyTo: undefined,
            moment: this.toJSON()
        }
    }

    getCreatedAt(): number {
        return this.saleDate ? Math.min(this.saleDate.getTime(), new Date().getTime()) : new Date().getTime()
    }

    toJSON(): MomentData {
        return {
            id: this.id,
            title: this.title,
            description: this.description,
            url: this.url,
            creator: this.creator,
            saleDate: this.saleDate,
            assetFile: this.assetFile,
            assetType: this.assetType,
            reaction: this.reaction
        }
    }
}
