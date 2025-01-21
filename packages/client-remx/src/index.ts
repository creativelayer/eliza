import { Client, elizaLogger, IAgentRuntime, ServiceType } from "@elizaos/core";
import { ClientBase } from "./base.ts";
import { RemxConfig, validateRemxConfig } from "./environment.ts";
import { MomentClient } from "./momentClient.ts";
import { RemxImageDescriptionService } from "./services/image.ts"
/**
 * A manager that orchestrates all specialized Remx logic
 */
class RemxManager {
    client: ClientBase;
    momentClient: MomentClient;

    constructor(runtime: IAgentRuntime, config: RemxConfig) {
        // Pass remxConfig to the base client
        this.client = new ClientBase(runtime, config);

        this.momentClient = new MomentClient(this.client, runtime);

    }
}

export const RemxClientInterface: Client = {
    async start(runtime: IAgentRuntime) {
        const config: RemxConfig =
            await validateRemxConfig(runtime);

        elizaLogger.log("Remx client started");

        const imageDescriptionService = new RemxImageDescriptionService();
        await imageDescriptionService.initialize(runtime);
        runtime.services.set(ServiceType.IMAGE_DESCRIPTION, imageDescriptionService);
        // runtime.services.delete(ServiceType.IMAGE_DESCRIPTION);
        // runtime.registerService(imageDescriptionService);

        const manager = new RemxManager(runtime, config);

        // Initialize login/session
        await manager.client.init();

        // Start the posting loop
        await manager.momentClient.start();

        return manager;
    },

    async stop(_runtime: IAgentRuntime) {
        elizaLogger.warn("[REMX]  client does not support stopping yet");
    },
};

export default RemxClientInterface;