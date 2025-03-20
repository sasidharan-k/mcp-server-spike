import OpenAI from "openai";
import AzureOpenAI from 'openai';
import {
    ChatCompletionMessageParam as MessageParam,
    ChatCompletionTool as Tool,
} from "openai/resources";
import munisVectorToolConfig from "../tools/vectorTool.js";

class MunisError extends Error {
    status?: number;
    statusText?: string;
    body?: string;

    constructor(
        message: string,
        status?: number,
        statusText?: string,
        body?: string
    ) {
        super(message);
        this.status = status;
        this.statusText = statusText;
        this.body = body;
    }
}

export const fetchApiEndpoint = async (
    bearerToken: string,
    url: string,
    isTrainingUrl = false
) => {
    try {
        const munisDomain = process.env.MUNIS_ODATA_URL || '';
        let oDataUrl = url;
        if (!oDataUrl.includes(munisDomain)) {
            oDataUrl = `${munisDomain}/${url}`;
        }
        if (isTrainingUrl) {
            oDataUrl = oDataUrl + '?$top=10';
        }
        console.log(
            '=== fetch url ====',
            decodeURIComponent(oDataUrl),
            '=== fetch url ===='
        );

        const requestOptions = {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${bearerToken}`,
            },
        };

        const response = await fetch(oDataUrl, requestOptions);
        if (!response.ok) {
            // Try to parse the error response body as JSON
            const errorBody = await response.text(); // Use .text() to get the raw body first
            let parsedError;
            try {
                parsedError = JSON.parse(errorBody); // Try to parse the body as JSON
            } catch (parseError) {
                parsedError = errorBody; // If it's not JSON, return the raw text
            }
            console.error('Query Error:', {
                status: response.status, // HTTP status code
                statusText: response.statusText, // Status text (e.g., "Not Found")
                body: parsedError?.error?.message, // The parsed response body (JSON or text)
            });

            // Return an object with more error details
            const error = new MunisError(
                'Request failed',
                response.status,
                response.statusText,
                parsedError?.error?.message
            );
            throw error;
        }

        // If response is successful, parse and return the data
        const data = await response.json();
        return data;
    } catch (error) {
        // Catch and log any unexpected errors
        console.error('Error:', error);
        throw error;
    }
};

export const getBearerTokenForOdata = async () => {
    const tokenEndPoint = `${process.env.MUNIS_TOKEN_ENDPOINT}`;
    const clientCredentials = `${process.env.MUNIS_CLIENT_ID}:${process.env.MUNIS_CLIENT_SECRET}`;
    const encodedCredentials = Buffer.from(clientCredentials).toString('base64');

    const requestOptions = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
            Authorization: `Basic ${encodedCredentials}`,
            'Cache-Control': 'no-cache',
        },
        body: new URLSearchParams({
            grant_type: 'client_credentials',
            scope: `${process.env.MUNIS_TOKEN_SCOPE}`,
        }),
    };

    const response = await fetch(tokenEndPoint, requestOptions);
    if (!response.ok) {
        console.log(response.body);
        throw new Error('Network response was not ok');
    }
    const data = await response.json();
    return { bearer_token: data };
};

export async function processVectorQuery(openai: OpenAI, query: string) {
    const messages: MessageParam[] = [
        {
            role: 'system',
            content: 'Execute the `getVectorMunisDetailsAgent` tool and return the raw reponse returned by this tool `getVectorMunisDetailsAgent`. If any error occurs then return the error directly from the tool.'
        },
        {
            role: "user",
            content: query,
        },
    ];

    try {
        // Define the tools in the format expected by OpenAI
        const tools: Tool[] = munisVectorToolConfig.map(item => ({
            type: 'function' as const,
            function: {
                name: item.name,
                description: item.description,
                parameters: item.parameters
            }
        }));

        // Create a completion with tools
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            max_tokens: 1000,
            messages,
            tools,
        });

        return responseHandler(openai, completion, tools, munisVectorToolConfig, messages)

    } catch (error) {
        console.error("Error in processVectorQuery:", error);
        throw error;
    }
}

// Define a type for a single tool in the vector tool config
type VectorTool = {
    name: string;
    description: string;
    parameters: Record<string, any>;
    function: (args: string) => Promise<string>;
};

// Define a type for the vector tool config array
type VectorToolConfig = VectorTool[];

const responseHandler = async (
    client: OpenAI,
    response: any, // Using any for now as we don't have the AzureOpenAI import
    tools: Tool[],
    toolConfig: VectorToolConfig,
    messages: MessageParam[],
) => {
    // console.log('Initial Response ---->', response?.choices[0]);    //  Initial Response

    const finishReason = response?.choices[0]?.finish_reason;
    if (finishReason === 'tool_calls') {
        const toolCalls = response?.choices[0]?.message?.tool_calls;

        let newMessage: MessageParam[] = [
            ...messages,
            {
                role: 'assistant',
                content: '',
                tool_calls: response.choices[0].message.tool_calls,
            }
        ];

        const generateMessage = async () => {
            const data = (toolCalls || []).map(async (toolCall: any) => {
                const respectiveTool: any = toolConfig?.find((item) => item?.name === toolCall?.function?.name)
                const result = await respectiveTool?.function(toolCall?.function?.arguments)
                return {
                    role: 'tool' as const,
                    content: result,
                    tool_call_id: toolCall?.id
                }
            });
            return Promise.all(data);
        }

        const data = await generateMessage();
        newMessage = newMessage.concat(data)

        // Refetch
        // console.log('tool calls', toolCalls && toolCalls[0]?.function?.name)
        // console.log('newMessage', newMessage?.length)

        const newResponse = await client.chat.completions.create({
            model: 'gpt-4o',
            messages: newMessage,
            tools: tools,
        })

        // console.log('New Response ---->', newResponse.choices[0])    //  New Response
        return responseHandler(client, newResponse, tools, toolConfig, newMessage)
    }
    else if (finishReason === 'stop') {
        return client.chat.completions.create({
            model: 'gpt-4o',
            messages: messages,
            tools: tools,
            stream: false,
        })
    }
    return response;
}