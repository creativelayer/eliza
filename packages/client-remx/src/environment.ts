import {
    parseBooleanFromText,
    IAgentRuntime,
} from "@elizaos/core";
import { z, ZodError } from "zod";

export const remxEnvSchema = z.object({
    REMX_DRY_RUN: z.boolean(),
    REMX_WALLET_ADDRESS: z.string(),
    REMX_ACCOUNT_ID: z.string(),
    COGNITO_POOL_ID: z.string(),
    COGNITO_WEB_CLIENT_ID: z.string(),
    NEO4J_URI: z.string(),
    NEO4J_USERNAME: z.string(),
    NEO4J_PASSWORD: z.string(),
    NEO4J_DATABASE: z.string(),
    GRAPHQL_URL: z.string(),
    IMAGE_SERVER_URL: z.string(),
    COINBASE_API_KEY_NAME: z.string(),
    COINBASE_API_KEY_PRIVATE_KEY: z.string(),
    REMX_ENV: z.string(),
    REMX_BASE_URL: z.string(),
    REMX_ASSET_URL: z.string(),
    REMX_ASSET_BUCKET: z.string(),
    REMX_PROCESS_INTERVAL: z.number(),
    REMX_DAILY_TIP_LIMIT: z.number(),
    REMX_SLACK_WEBHOOK_URL: z.string(),
    REMX_AGENT_ID: z.string(),
    REMX_TIP_INTERVAL: z.number().optional(),
});

export type RemxConfig = z.infer<typeof remxEnvSchema>;

export async function validateRemxConfig(
    runtime: IAgentRuntime
): Promise<RemxConfig> {
    try {
        const remxConfig = {
            REMX_DRY_RUN:
                parseBooleanFromText(
                    runtime.getSetting("REMX_DRY_RUN") ||
                        process.env.REMX_DRY_RUN
                ) ?? false, // parseBooleanFromText return null if "", map "" to false

            REMX_WALLET_ADDRESS:
                runtime.getSetting("REMX_WALLET_ADDRESS") ||
                process.env.REMX_WALLET_ADDRESS,
            REMX_ACCOUNT_ID:
                runtime.getSetting("REMX_ACCOUNT_ID") ||
                process.env.REMX_ACCOUNT_ID,
            COGNITO_POOL_ID:
                runtime.getSetting("COGNITO_POOL_ID") ||
                process.env.COGNITO_POOL_ID,
            COGNITO_WEB_CLIENT_ID:
                runtime.getSetting("COGNITO_WEB_CLIENT_ID") ||
                process.env.COGNITO_WEB_CLIENT_ID,
            NEO4J_URI:
                runtime.getSetting("NEO4J_URI") ||
                process.env.NEO4J_URI,
            NEO4J_USERNAME:
                runtime.getSetting("NEO4J_USERNAME") ||
                process.env.NEO4J_USERNAME || 'neo4j',
            NEO4J_PASSWORD:
                runtime.getSetting("NEO4J_PASSWORD") ||
                process.env.NEO4J_PASSWORD,
            NEO4J_DATABASE:
                runtime.getSetting("NEO4J_DATABASE") ||
                process.env.NEO4J_DATABASE || 'neo4j',
            GRAPHQL_URL:
                runtime.getSetting("GRAPHQL_URL") ||
                process.env.GRAPHQL_URL,
            IMAGE_SERVER_URL:
                runtime.getSetting("IMAGE_SERVER_URL") ||
                process.env.IMAGE_SERVER_URL,
            REMX_ASSET_BUCKET:
                runtime.getSetting("REMX_ASSET_BUCKET") ||
                process.env.REMX_ASSET_BUCKET,
            COINBASE_API_KEY_NAME:
                runtime.getSetting("COINBASE_API_KEY_NAME") ||
                process.env.COINBASE_API_KEY_NAME,
            COINBASE_API_KEY_PRIVATE_KEY:
                runtime.getSetting("COINBASE_API_KEY_PRIVATE_KEY") ||
                process.env.COINBASE_API_KEY_PRIVATE_KEY,
            REMX_ENV:
                runtime.getSetting("REMX_ENV") ||
                process.env.REMX_ENV,
            REMX_BASE_URL:
                runtime.getSetting("REMX_BASE_URL") ||
                process.env.REMX_BASE_URL,
            REMX_PROCESS_INTERVAL:
                parseInt(
                    runtime.getSetting("REMX_PROCESS_INTERVAL") ||
                    process.env.REMX_PROCESS_INTERVAL ||
                    "5"
                ),
            REMX_ASSET_URL:
                runtime.getSetting("REMX_ASSET_URL") ||
                process.env.REMX_ASSET_URL,
            REMX_DAILY_TIP_LIMIT:
                parseInt(
                    runtime.getSetting("REMX_DAILY_TIP_LIMIT") ||
                    process.env.REMX_DAILY_TIP_LIMIT ||
                    "100"
                ),
            REMX_SLACK_WEBHOOK_URL:
                runtime.getSetting("REMX_SLACK_WEBHOOK_URL") ||
                process.env.REMX_SLACK_WEBHOOK_URL,
            REMX_AGENT_ID:
                runtime.getSetting("REMX_AGENT_ID") ||
                process.env.REMX_AGENT_ID,
            REMX_TIP_INTERVAL:
                parseInt(
                    runtime.getSetting("REMX_TIP_INTERVAL") ||
                    process.env.REMX_TIP_INTERVAL ||
                    "60"
                ),
        };

        return remxEnvSchema.parse(remxConfig);
    } catch (error) {
        if (error instanceof ZodError) {
            const errorMessages = error.errors
                .map((err) => `${err.path.join(".")}: ${err.message}`)
                .join("\n");
            throw new Error(
                `Remx configuration validation failed:\n${errorMessages}`
            );
        }
        throw error;
    }
}
