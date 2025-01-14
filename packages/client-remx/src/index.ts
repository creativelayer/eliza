import { Client, elizaLogger, IAgentRuntime } from "@elizaos/core";
import { ClientBase } from "./base.ts";
import { RemxConfig, validateRemxConfig } from "./environment.ts";
// import { RemxMomentClient } from "./moment.ts";

/**
 * A manager that orchestrates all specialized Remx logic
 */
class RemxManager {
    client: ClientBase;
    // moment: RemxMomentClient;

    constructor(runtime: IAgentRuntime, remxConfig: RemxConfig) {
        // Pass remxConfig to the base client
        this.client = new ClientBase(runtime, remxConfig);

        // Posting logic
        // this.moment = new RemxMomentClient(this.client, runtime);

    }
}

export const RemxClientInterface: Client = {
    async start(runtime: IAgentRuntime) {
        const remxConfig: RemxConfig =
            await validateRemxConfig(runtime);

        elizaLogger.log("Remx client started");

        const manager = new RemxManager(runtime, remxConfig);

        // Initialize login/session
        await manager.client.init();

        // Start the posting loop
        // await manager.moment.start();

        return manager;
    },

    async stop(_runtime: IAgentRuntime) {
        elizaLogger.warn("[REMX]  client does not support stopping yet");
    },
};

export default RemxClientInterface;