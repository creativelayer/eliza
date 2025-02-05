import {
    ActionExample,
    IAgentRuntime,
    Memory,
    type Action,
} from "@elizaos/core";

export const likeAction : Action = {
    name: "LIKE",
    similes: [
        "LIKE_MOMENT",
    ],
    validate: async (_runtime: IAgentRuntime, _message: Memory) => {
        // TODO: should return false if the agent has not liked this moment, otherwise true
        return true;
    },
    description: "Like a moment on Remx",
    handler: async (
        _runtime: IAgentRuntime,
        _message: Memory
    ): Promise<boolean> => {
        console.log("[REMX]:likeAction handler invoked");
        // TODO: like a moment on Remx
        return true;
    },
    examples: [
    ] as ActionExample[][],
} as Action;
