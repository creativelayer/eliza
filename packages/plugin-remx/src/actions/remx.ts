import {
    ActionExample,
    IAgentRuntime,
    Memory,
    type Action,
} from "@elizaos/core";

export const remxAction : Action = {
    name: "REMX",
    similes: [
    ],
    validate: async (_runtime: IAgentRuntime, _message: Memory) => {
        return true;
    },
    description: "",
    handler: async (
        _runtime: IAgentRuntime,
        _message: Memory
    ): Promise<boolean> => {
        console.log("[REMX]:remxAction handler invoked");
        return true;
    },
    examples: [
    ] as ActionExample[][],
} as Action;
