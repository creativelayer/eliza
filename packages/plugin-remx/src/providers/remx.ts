import { IAgentRuntime, Memory, Provider, State } from "@elizaos/core";

const remxProvider: Provider = {
    get: async (_runtime: IAgentRuntime, _message: Memory, _state?: State) => {
        console.log("remxProvider");
        return "";
    },
};
export { remxProvider };
