import { RemxConfig } from "./environment"
import { Moment } from "./moment"

export interface IClientProfile {
    username: string
}

export interface IRemxClient {
    config: RemxConfig
    profile?: IClientProfile
    init(): Promise<void>
    loadMoments(): Promise<Moment[]>
    likeMoment(momentId: string): Promise<void>
    commentMoment(momentId: string, text: string, profileId: string): Promise<void>
    followCreator(creatorId: string): Promise<void>
    getBalance(): Promise<number>
    getExchangeRate(): Promise<number>
}