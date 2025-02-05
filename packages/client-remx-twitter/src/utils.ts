import { Tweet } from "agent-twitter-client";
import { getEmbeddingZeroVector } from "@elizaos/core";
import { Content, Memory, UUID } from "@elizaos/core";
import { stringToUuid } from "@elizaos/core";
import { ClientBase } from "./base";
import { elizaLogger } from "@elizaos/core";
import { Media } from "@elizaos/core";
import fs from "fs";
import path from "path";
import sharp from 'sharp';

export const wait = (minTime: number = 1000, maxTime: number = 3000) => {
    const waitTime =
        Math.floor(Math.random() * (maxTime - minTime + 1)) + minTime;
    return new Promise((resolve) => setTimeout(resolve, waitTime));
};

export const isValidTweet = (tweet: Tweet): boolean => {
    // Filter out tweets with too many hashtags, @s, or $ signs, probably spam or garbage
    const hashtagCount = (tweet.text?.match(/#/g) || []).length;
    const atCount = (tweet.text?.match(/@/g) || []).length;
    const dollarSignCount = (tweet.text?.match(/\$/g) || []).length;
    const totalCount = hashtagCount + atCount + dollarSignCount;

    return (
        hashtagCount <= 1 &&
        atCount <= 2 &&
        dollarSignCount <= 1 &&
        totalCount <= 3
    );
};

export async function buildConversationThread(
    tweet: Tweet,
    client: ClientBase,
    maxReplies: number = 10
): Promise<Tweet[]> {
    const thread: Tweet[] = [];
    const visited: Set<string> = new Set();

    async function processThread(currentTweet: Tweet, depth: number = 0) {
        elizaLogger.debug("Processing tweet:", {
            id: currentTweet.id,
            inReplyToStatusId: currentTweet.inReplyToStatusId,
            depth: depth,
        });

        if (!currentTweet) {
            elizaLogger.debug("No current tweet found for thread building");
            return;
        }

        // Stop if we've reached our reply limit
        if (depth >= maxReplies) {
            elizaLogger.debug("Reached maximum reply depth", depth);
            return;
        }

        // Handle memory storage
        const memory = await client.runtime.messageManager.getMemoryById(
            stringToUuid(currentTweet.id + "-" + client.runtime.agentId)
        );
        if (!memory) {
            const roomId = stringToUuid(
                currentTweet.conversationId + "-" + client.runtime.agentId
            );
            const userId = stringToUuid(currentTweet.userId);

            await client.runtime.ensureConnection(
                userId,
                roomId,
                currentTweet.username,
                currentTweet.name,
                "twitter"
            );

            await client.runtime.messageManager.createMemory({
                id: stringToUuid(
                    currentTweet.id + "-" + client.runtime.agentId
                ),
                agentId: client.runtime.agentId,
                content: {
                    text: currentTweet.text,
                    source: "twitter",
                    url: currentTweet.permanentUrl,
                    inReplyTo: currentTweet.inReplyToStatusId
                        ? stringToUuid(
                              currentTweet.inReplyToStatusId +
                                  "-" +
                                  client.runtime.agentId
                          )
                        : undefined,
                },
                createdAt: currentTweet.timestamp * 1000,
                roomId,
                userId:
                    currentTweet.userId === client.profile.id
                        ? client.runtime.agentId
                        : stringToUuid(currentTweet.userId),
                embedding: getEmbeddingZeroVector(),
            });
        }

        if (visited.has(currentTweet.id)) {
            elizaLogger.debug("Already visited tweet:", currentTweet.id);
            return;
        }

        visited.add(currentTweet.id);
        thread.unshift(currentTweet);

        elizaLogger.debug("Current thread state:", {
            length: thread.length,
            currentDepth: depth,
            tweetId: currentTweet.id,
        });

        // If there's a parent tweet, fetch and process it
        if (currentTweet.inReplyToStatusId) {
            elizaLogger.debug(
                "Fetching parent tweet:",
                currentTweet.inReplyToStatusId
            );
            try {
                const parentTweet = await client.twitterClient.getTweet(
                    currentTweet.inReplyToStatusId
                );

                if (parentTweet) {
                    elizaLogger.debug("Found parent tweet:", {
                        id: parentTweet.id,
                        text: parentTweet.text?.slice(0, 50),
                    });
                    await processThread(parentTweet, depth + 1);
                } else {
                    elizaLogger.debug(
                        "No parent tweet found for:",
                        currentTweet.inReplyToStatusId
                    );
                }
            } catch (error) {
                elizaLogger.error("Error fetching parent tweet:", {
                    tweetId: currentTweet.inReplyToStatusId,
                    error,
                });
            }
        } else {
            elizaLogger.debug(
                "Reached end of reply chain at:",
                currentTweet.id
            );
        }
    }

    await processThread(tweet, 0);

    elizaLogger.debug("Final thread built:", {
        totalTweets: thread.length,
        tweetIds: thread.map((t) => ({
            id: t.id,
            text: t.text?.slice(0, 50),
        })),
    });

    return thread;
}

export async function sendTweet(
    client: ClientBase,
    content: Content,
    roomId: UUID,
    twitterUsername: string,
    inReplyTo: string
): Promise<Memory[]> {
    const maxTweetLength = client.twitterConfig.MAX_TWEET_LENGTH;
    const isLongTweet = maxTweetLength > 280;

    const tweetChunks = splitTweetContent(content.text, maxTweetLength);
    const sentTweets: Tweet[] = [];
    let previousTweetId = inReplyTo;

    for (const chunk of tweetChunks) {
        let mediaData: { data: Buffer; mediaType: string }[] | undefined;

        if (content.attachments && content.attachments.length > 0) {
            mediaData = await Promise.all(
                content.attachments.map(async (attachment: Media) => {
                    if (/^(http|https):\/\//.test(attachment.url)) {
                        // Handle HTTP URLs
                        const response = await fetch(attachment.url);
                        if (!response.ok) {
                            throw new Error(
                                `Failed to fetch file: ${attachment.url}`
                            );
                        }
                        const mediaBuffer = Buffer.from(
                            await response.arrayBuffer()
                        );
                        const mediaType = attachment.contentType;
                        return { data: mediaBuffer, mediaType };
                    } else if (fs.existsSync(attachment.url)) {
                        // Handle local file paths
                        const mediaBuffer = await fs.promises.readFile(
                            path.resolve(attachment.url)
                        );
                        const mediaType = attachment.contentType;
                        return { data: mediaBuffer, mediaType };
                    } else {
                        throw new Error(
                            `File not found: ${attachment.url}. Make sure the path is correct.`
                        );
                    }
                })
            );
        }

        const cleanChunk = deduplicateMentions(chunk.trim())

        const result = await client.requestQueue.add(async () =>
            isLongTweet
                ? client.twitterClient.sendLongTweet(
                      cleanChunk,
                      previousTweetId,
                      mediaData
                  )
                : client.twitterClient.sendTweet(
                      cleanChunk,
                      previousTweetId,
                      mediaData
                  )
        );

        const body = await result.json();
        const tweetResult = isLongTweet
            ? body?.data?.notetweet_create?.tweet_results?.result
            : body?.data?.create_tweet?.tweet_results?.result;

        // if we have a response
        if (tweetResult) {
            // Parse the response
            const finalTweet: Tweet = {
                id: tweetResult.rest_id,
                text: tweetResult.legacy.full_text,
                conversationId: tweetResult.legacy.conversation_id_str,
                timestamp:
                    new Date(tweetResult.legacy.created_at).getTime() / 1000,
                userId: tweetResult.legacy.user_id_str,
                inReplyToStatusId: tweetResult.legacy.in_reply_to_status_id_str,
                permanentUrl: `https://twitter.com/${twitterUsername}/status/${tweetResult.rest_id}`,
                hashtags: [],
                mentions: [],
                photos: [],
                thread: [],
                urls: [],
                videos: [],
            };
            sentTweets.push(finalTweet);
            previousTweetId = finalTweet.id;
        } else {
            elizaLogger.error("Error sending tweet chunk:", {
                chunk,
                response: body,
            });
        }

        // Wait a bit between tweets to avoid rate limiting issues
        await wait(1000, 2000);
    }

    const memories: Memory[] = sentTweets.map((tweet) => ({
        id: stringToUuid(tweet.id + "-" + client.runtime.agentId),
        agentId: client.runtime.agentId,
        userId: client.runtime.agentId,
        content: {
            text: tweet.text,
            source: "twitter",
            url: tweet.permanentUrl,
            inReplyTo: tweet.inReplyToStatusId
                ? stringToUuid(
                      tweet.inReplyToStatusId + "-" + client.runtime.agentId
                  )
                : undefined,
        },
        roomId,
        embedding: getEmbeddingZeroVector(),
        createdAt: tweet.timestamp * 1000,
    }));

    return memories;
}

function splitTweetContent(content: string, maxLength: number): string[] {
    const paragraphs = content.split("\n\n").map((p) => p.trim());
    const tweets: string[] = [];
    let currentTweet = "";

    for (const paragraph of paragraphs) {
        if (!paragraph) continue;

        if ((currentTweet + "\n\n" + paragraph).trim().length <= maxLength) {
            if (currentTweet) {
                currentTweet += "\n\n" + paragraph;
            } else {
                currentTweet = paragraph;
            }
        } else {
            if (currentTweet) {
                tweets.push(currentTweet.trim());
            }
            if (paragraph.length <= maxLength) {
                currentTweet = paragraph;
            } else {
                // Split long paragraph into smaller chunks
                const chunks = splitParagraph(paragraph, maxLength);
                tweets.push(...chunks.slice(0, -1));
                currentTweet = chunks[chunks.length - 1];
            }
        }
    }

    if (currentTweet) {
        tweets.push(currentTweet.trim());
    }

    return tweets;
}

function extractUrls(paragraph: string): {
    textWithPlaceholders: string;
    placeholderMap: Map<string, string>;
} {
    // replace https urls with placeholder
    const urlRegex = /https?:\/\/[^\s]+/g;
    const placeholderMap = new Map<string, string>();

    let urlIndex = 0;
    const textWithPlaceholders = paragraph.replace(urlRegex, (match) => {
        // twitter url would be considered as 23 characters
        // <<URL_CONSIDERER_23_1>> is also 23 characters
        const placeholder = `<<URL_CONSIDERER_23_${urlIndex}>>`; // Placeholder without . ? ! etc
        placeholderMap.set(placeholder, match);
        urlIndex++;
        return placeholder;
    });

    return { textWithPlaceholders, placeholderMap };
}

function splitSentencesAndWords(text: string, maxLength: number): string[] {
    // Split by periods, question marks and exclamation marks
    // Note that URLs in text have been replaced with `<<URL_xxx>>` and won't be split by dots
    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
    const chunks: string[] = [];
    let currentChunk = "";

    for (const sentence of sentences) {
        if ((currentChunk + " " + sentence).trim().length <= maxLength) {
            if (currentChunk) {
                currentChunk += " " + sentence;
            } else {
                currentChunk = sentence;
            }
        } else {
            // Can't fit more, push currentChunk to results
            if (currentChunk) {
                chunks.push(currentChunk.trim());
            }

            // If current sentence itself is less than or equal to maxLength
            if (sentence.length <= maxLength) {
                currentChunk = sentence;
            } else {
                // Need to split sentence by spaces
                const words = sentence.split(" ");
                currentChunk = "";
                for (const word of words) {
                    if (
                        (currentChunk + " " + word).trim().length <= maxLength
                    ) {
                        if (currentChunk) {
                            currentChunk += " " + word;
                        } else {
                            currentChunk = word;
                        }
                    } else {
                        if (currentChunk) {
                            chunks.push(currentChunk.trim());
                        }
                        currentChunk = word;
                    }
                }
            }
        }
    }

    // Handle remaining content
    if (currentChunk) {
        chunks.push(currentChunk.trim());
    }

    return chunks;
}

function deduplicateMentions(paragraph: string) {
    // Regex to match mentions at the beginning of the string
  const mentionRegex = /^@(\w+)(?:\s+@(\w+))*(\s+|$)/;

  // Find all matches
  const matches = paragraph.match(mentionRegex);

  if (!matches) {
    return paragraph; // If no matches, return the original string
  }

  // Extract mentions from the match groups
  let mentions = matches.slice(0, 1)[0].trim().split(' ')

  // Deduplicate mentions
  mentions = [...new Set(mentions)];

  // Reconstruct the string with deduplicated mentions
  const uniqueMentionsString = mentions.join(' ');

  // Find where the mentions end in the original string
  const endOfMentions = paragraph.indexOf(matches[0]) + matches[0].length;

  // Construct the result by combining unique mentions with the rest of the string
  return uniqueMentionsString + ' ' + paragraph.slice(endOfMentions);
}

function restoreUrls(
    chunks: string[],
    placeholderMap: Map<string, string>
): string[] {
    return chunks.map((chunk) => {
        // Replace all <<URL_CONSIDERER_23_>> in chunk back to original URLs using regex
        return chunk.replace(/<<URL_CONSIDERER_23_(\d+)>>/g, (match) => {
            const original = placeholderMap.get(match);
            return original || match; // Return placeholder if not found (theoretically won't happen)
        });
    });
}

function splitParagraph(paragraph: string, maxLength: number): string[] {
    // 1) Extract URLs and replace with placeholders
    const { textWithPlaceholders, placeholderMap } = extractUrls(paragraph);

    // 2) Use first section's logic to split by sentences first, then do secondary split
    const splittedChunks = splitSentencesAndWords(
        textWithPlaceholders,
        maxLength
    );

    // 3) Replace placeholders back to original URLs
    const restoredChunks = restoreUrls(splittedChunks, placeholderMap);

    return restoredChunks;
}

interface TextOverlayOptions {
  textColor?: string;
  outputFormat?: string;
  quality?: number;
  fontSize?: number;
  padding?: number;
  fontFamily?: string;
  lineHeight?: number;
}

// Memoized font loader
const fontCache = new Map<string, string>();

async function getFontDataUri(fontPath: string): Promise<string> {
  const absoluteFontPath = path.resolve(fontPath);

  // Check cache first
  if (fontCache.has(absoluteFontPath)) {
    return fontCache.get(absoluteFontPath)!;
  }

  // Load and convert font file to base64
  console.log('Loading font from:', absoluteFontPath);
  const fontBuffer = await fs.promises.readFile(absoluteFontPath);
  const fontBase64 = fontBuffer.toString('base64');
  const fontDataUri = `data:font/opentype;base64,${fontBase64}`;

  // Cache the result
  fontCache.set(absoluteFontPath, fontDataUri);
  return fontDataUri;
}

function trimToWordLimit(text: string, wordLimit: number = 15): string {
  const words = text.split(/\s+/);
  if (words.length <= wordLimit) {
    return text;
  }
  return words.slice(0, wordLimit).join(' ') + '...';
}

export async function createTextOverlay(
  text: string,
  backgroundPath: string,
  fontPath: string,
  options: TextOverlayOptions = {}
): Promise<Buffer> {
  const {
    textColor = '#FF69B4',
    outputFormat = 'jpeg',
    quality = 90,
    fontSize = 60,
    padding = 40,
    fontFamily = 'CustomFont',
    lineHeight = 1.5
  } = options;

  try {
    // Trim text to 15 words
    const trimmedText = trimToWordLimit(text);

    // Get font data URI from cache or load it
    const fontDataUri = await getFontDataUri(fontPath);

    // Get image metadata first
    const metadata = await sharp(backgroundPath).metadata();
    const imageWidth = metadata.width || 1080;
    const imageHeight = metadata.height || 1080;

    // Calculate middle third dimensions
    const middleThirdStart = Math.floor(imageHeight / 3);
    const middleThirdHeight = Math.floor(imageHeight / 3);

    // Calculate actual line height in pixels
    const lineHeightPx = fontSize * lineHeight;

    // Split text into lines and calculate total height
    const lines = trimmedText.split('\n');
    const totalTextHeight = lines.length * lineHeightPx;

    // Calculate vertical centering within middle third
    const startY = middleThirdStart + (middleThirdHeight - totalTextHeight) / 2;

    // Escape special characters for XML
    const escapeXml = (unsafe: string) => {
      return unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
          case '<': return '&lt;';
          case '>': return '&gt;';
          case '&': return '&amp;';
          case '\'': return '&apos;';
          case '"': return '&quot;';
          default: return c;
        }
      });
    };

    // Create text elements with proper spacing
    const textLines = lines.map((line, index) => {
      const yPosition = startY + (lineHeightPx * index);
      return `<text
        x="${padding}"
        y="${yPosition}"
        class="text"
        dominant-baseline="hanging">${escapeXml(line)}</text>`;
    }).join('\n');

    // Create an SVG with the text content
    const svgText = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="${imageWidth}"
        height="${imageHeight}"
        version="1.1">
        <defs>
          <style type="text/css">
            @font-face {
              font-family: '${fontFamily}';
              src: url('${fontDataUri}') format('opentype');
            }
            .text {
              font-family: '${fontFamily}', sans-serif;
              font-size: ${fontSize}px;
              fill: ${textColor};
              white-space: pre;
            }
          </style>
        </defs>
        <!-- Debug guides for middle third -->
        <rect x="0" y="${middleThirdStart}" width="${imageWidth}" height="${middleThirdHeight}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
        ${textLines}
      </svg>`;

    // Save SVG file next to the output JPEG
    const outputDir = path.dirname(backgroundPath);
    const timestamp = Date.now();
    const svgPath = path.join(outputDir, `tweet_${timestamp}.svg`);
    await fs.promises.writeFile(svgPath, svgText);

    // Load and process the background image
    const image = await sharp(backgroundPath)
      .resize(imageWidth, imageHeight, {
        fit: 'cover',
        position: 'center'
      });

    // Composite the SVG text over the background
    const result = await image
      .composite([
        {
          input: Buffer.from(svgText),
          top: 0,
          left: 0,
        },
      ])
      .toFormat(outputFormat as keyof sharp.FormatEnum, { quality });

    return result.toBuffer();

  } catch (error) {
    console.error('Error creating text overlay:', error);
    throw error;
  }
}

