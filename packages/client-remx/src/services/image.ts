import {
    elizaLogger,
    IAgentRuntime,
    IImageDescriptionService,
    Service,
    ServiceType,
} from "@elizaos/core";
import fs from "fs";
import gifFrames from "gif-frames";
import os from "os";
import path from "path";

const IMAGE_DESCRIPTION_PROMPT =
    "Describe this image and give it a title. The first line should be the title, and then a line break, then a detailed description of the image. Respond with the format 'title\\ndescription'";

interface ImageProvider {
    initialize(): Promise<void>;
    describeImage(
        imageData: Buffer,
        mimeType: string
    ): Promise<{ title: string; description: string }>;
    describeImageWithPrompt(
        text: string,
        imageData: Buffer,
        mimeType: string
    ): Promise<string>;
}

interface IRemxImageDescriptionService extends IImageDescriptionService {
    describeImageWithPrompt(
        text: string,
        imageUrl: string
    ): Promise<string>;
}

// Utility functions
const convertToBase64DataUrl = (
    imageData: Buffer,
    mimeType: string
): string => {
    const base64Data = imageData.toString("base64");
    return `data:${mimeType};base64,${base64Data}`;
};

const handleApiError = async (
    response: Response,
    provider: string
): Promise<never> => {
    const responseText = await response.text();
    elizaLogger.error(
        `${provider} API error:`,
        response.status,
        "-",
        responseText
    );
    throw new Error(`HTTP error! status: ${response.status}`);
};

const parseImageResponse = (
    text: string
): { title: string; description: string } => {
    const [title, ...descriptionParts] = text.split("\n");
    return { title, description: descriptionParts.join("\n") };
};

class OpenAIImageProvider implements ImageProvider {
    constructor(private runtime: IAgentRuntime) {}

    async initialize(): Promise<void> {}

    async describeImage(
        imageData: Buffer,
        mimeType: string
    ): Promise<{ title: string; description: string }> {
        const result = await this.describeImageWithPrompt(IMAGE_DESCRIPTION_PROMPT, imageData, mimeType);
        return parseImageResponse(result);
    }

    async describeImageWithPrompt(
        text: string,
        imageData: Buffer,
        mimeType: string
    ): Promise<string> {
        const imageUrl = convertToBase64DataUrl(imageData, mimeType);

        const content = [
            { type: "text", text },
            { type: "image_url", image_url: { url: imageUrl } },
        ];

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.runtime.getSetting("OPENAI_API_KEY")}`,
            },
            body: JSON.stringify({
                model: "gpt-4-vision-preview",
                messages: [{ role: "user", content }],
                max_tokens: 500,
            }),
        });

        if (!response.ok) {
            await handleApiError(response, "OpenAI");
        }

        const data = await response.json();
        return data.choices[0].message.content;
    }
}

export class ImageDescriptionService extends Service implements IRemxImageDescriptionService {
    static serviceType: ServiceType = ServiceType.IMAGE_DESCRIPTION;
    private runtime: IAgentRuntime | null = null;
    private provider: ImageProvider | null = null;
    private initialized: boolean = false;

    async initialize(runtime: IAgentRuntime): Promise<void> {
        this.runtime = runtime;
        await this.initializeProvider();
    }

    private async initializeProvider(): Promise<void> {
        if (!this.runtime) {
            throw new Error("Runtime is required for image recognition");
        }

        this.provider = new OpenAIImageProvider(this.runtime);
        await this.provider.initialize();
        this.initialized = true;
    }

    private async loadImageData(
        imageUrl: string
    ): Promise<{ data: Buffer; mimeType: string }> {
        let imageData: Buffer;
        let mimeType: string;

        if (imageUrl.startsWith("data:")) {
            const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
            if (!matches) {
                throw new Error("Invalid data URL");
            }
            mimeType = matches[1];
            imageData = Buffer.from(matches[2], "base64");
        } else if (imageUrl.startsWith("http")) {
            const response = await fetch(imageUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch image: ${response.statusText}`);
            }
            mimeType = response.headers.get("content-type") || "image/jpeg";
            imageData = Buffer.from(await response.arrayBuffer());
        } else {
            imageData = fs.readFileSync(imageUrl);
            mimeType = "image/jpeg"; // Default to JPEG
        }

        // Handle GIF files by extracting the first frame
        if (mimeType === "image/gif") {
            const frames = await gifFrames({
                url: imageUrl,
                frames: 1,
                outputType: "jpg",
            });
            imageData = frames[0].getImage()._obj;
            mimeType = "image/jpeg";
        }

        return { data: imageData, mimeType };
    }

    async describeImage(
        imageUrl: string
    ): Promise<{ title: string; description: string }> {
        if (!this.initialized) {
            await this.initializeProvider();
        }

        try {
            const { data, mimeType } = await this.loadImageData(imageUrl);
            return await this.provider!.describeImage(data, mimeType);
        } catch (error) {
            elizaLogger.error("Error in describeImage:", error);
            throw error;
        }
    }

    async describeImageWithPrompt(
        text: string,
        imageUrl: string
    ): Promise<string> {
        if (!this.initialized) {
            await this.initializeProvider();
        }

        try {
            const { data, mimeType } = await this.loadImageData(imageUrl);
            return await this.provider!.describeImageWithPrompt(text, data, mimeType);
        } catch (error) {
            elizaLogger.error("Error in describeImage:", error);
            throw error;
        }
    }
}

export default ImageDescriptionService;