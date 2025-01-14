import {
    parseBooleanFromText,
    IAgentRuntime,
} from "@elizaos/core";
import { z, ZodError } from "zod";

export const remxEnvSchema = z.object({
    REMX_DRY_RUN: z.boolean(),
    REMX_WALLET_ADDRESS: z.string(),
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
