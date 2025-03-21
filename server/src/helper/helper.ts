import OpenAI from "openai";
import { AlertFeature } from "../interface/interface.js";
import {
    ChatCompletionMessageParam as MessageParam,
    ChatCompletionTool as Tool,
} from "openai/resources";
import { weatherToolConfig } from "../tools/tools.js";

export const NWS_API_BASE = "https://api.weather.gov";
const USER_AGENT = "weather-app/1.0";

// Format alert data
export function formatAlert(feature: AlertFeature): string {
    const props = feature.properties;
    return [
        `Event: ${props.event || "Unknown"}`,
        `Area: ${props.areaDesc || "Unknown"}`,
        `Severity: ${props.severity || "Unknown"}`,
        `Status: ${props.status || "Unknown"}`,
        `Headline: ${props.headline || "No headline"}`,
        "---",
    ].join("\n");
}

// Helper function for making NWS API requests
export async function makeNWSRequest<T>(url: string): Promise<T | null> {
    const headers = {
        "User-Agent": USER_AGENT,
        Accept: "application/geo+json",
    };

    try {
        const response = await fetch(url, { headers });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return (await response.json()) as T;
    } catch (error) {
        console.error("Error making NWS request:", error);
        return null;
    }
}

export async function processWeatherQuery(openai: OpenAI, query: string) {
    const messages: MessageParam[] = [
        {
            role: "user",
            content: query,
        },
    ];

    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 1000,
        messages,
        tools: weatherToolConfig.map(item => ({
            type: 'function',
            function: {
                name: item?.name,
                description: item?.description,
                parameters: item?.parameters
            }
        }))
    });

    const finalText = [];
    const toolResults = [];

    if (response.choices && response.choices[0] && response.choices[0].message) {
        const message = response.choices[0].message;

        if (message.content) {
            finalText.push(message.content);
        }

        if (message.tool_calls && message.tool_calls.length > 0) {
            for (const toolCall of message.tool_calls) {
                const toolName = toolCall.function.name;
                const toolArgs = JSON.parse(toolCall.function.arguments);

                console.log("Tool Calling  -----", toolName, toolArgs)

                const respectiveTool: any = weatherToolConfig?.find((item: any) => item?.name === toolName)
                const result = await respectiveTool?.function(toolArgs)

                console.log("Tool result  -----", result)

                toolResults.push(result);
                finalText.push(
                    `${JSON.stringify(result.content)}`
                );

                messages.push({
                    role: "assistant",
                    content: null,
                    tool_calls: [{
                        id: toolCall.id,
                        type: "function",
                        function: {
                            name: toolName,
                            arguments: toolCall.function.arguments
                        }
                    }]
                });

                messages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: result.content as string,
                });

                const followUpResponse = await openai.chat.completions.create({
                    model: "gpt-3.5-turbo",
                    max_tokens: 1000,
                    messages,
                });

                if (followUpResponse.choices && followUpResponse.choices[0] && followUpResponse.choices[0].message.content) {
                    finalText.push(followUpResponse.choices[0].message.content);
                }
            }
        }
    }

    return finalText.join("\n");
}