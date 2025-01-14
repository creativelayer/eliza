import { Plugin } from "@elizaos/core";
import { remxAction } from "./actions/remx.ts";
import { remxEvaluator } from "./evaluators/remx.ts";
import { remxProvider } from "./providers/remx.ts";

export * as actions from "./actions";
export * as evaluators from "./evaluators";
export * as providers from "./providers";

export const remxPlugin: Plugin = {
    name: "remx",
    description: "Remx plugin",
    actions: [remxAction],
    evaluators: [remxEvaluator],
    providers: [remxProvider],
};
export default remxPlugin;
