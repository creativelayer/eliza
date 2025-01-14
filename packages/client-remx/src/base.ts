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
import { RemxConfig } from "./environment.ts";

import { login } from "./login.ts";
import { setState } from "./state.ts";
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

export class ClientBase extends EventEmitter {
    runtime: IAgentRuntime;
    remxConfig: RemxConfig;
    lastCheckedMomentId: bigint | null = null;
    imageDescriptionService: IImageDescriptionService;
    temperature: number = 0.5;

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
        const username = remxConfig.REMX_WALLET_ADDRESS;
    }

    async init() {
        const username = this.remxConfig.REMX_WALLET_ADDRESS;

        if (!username) {
            throw new Error("Remx wallet address not configured");
        }


        elizaLogger.log("Waiting for Remx login");

        await this.login();
    }

    async login() {
        console.log("[REMX] Login initiated");
        const state = await login(this.remxConfig, {}, this.remxConfig.REMX_WALLET_ADDRESS);

        console.log("[REMX] Login state", state);
        await setState(state);
    }
}
