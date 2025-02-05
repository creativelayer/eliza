import { composeContext } from "@elizaos/core";
import { generateText } from "@elizaos/core";
import { getGoals } from "@elizaos/core";
import { parseJsonArrayFromText } from "@elizaos/core";
import {
    IAgentRuntime,
    Memory,
    ModelClass,
    Objective,
    type Goal,
    type State,
    Evaluator,
} from "@elizaos/core";

const remxTemplate = ``;

async function handler(
    runtime: IAgentRuntime,
    message: Memory,
    state: State | undefined,
    options: { [key: string]: unknown } = { onlyInProgress: true }
): Promise<Goal[]> {

    console.log("[REMX]:remxEvaluator handler invoked");
    return [];
}

export const remxEvaluator: Evaluator = {
    name: "REMX",
    similes: [
    ],
    validate: async (
        runtime: IAgentRuntime,
        message: Memory
    ): Promise<boolean> => {
        console.log("[REMX]:remxEvaluator validate invoked");
        return true
    },
    description: "",
    handler,
    examples: [],
};
