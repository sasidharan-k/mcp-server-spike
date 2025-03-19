import { OpenAI } from "openai";
import {
    ChatCompletionMessageParam as MessageParam,
    ChatCompletionTool as Tool,
} from "openai/resources";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import readline from "readline/promises";
import dotenv from "dotenv";

dotenv.config();
console.log(process.env)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
}

export class MCPClient {
    private mcp: Client;
    private openai: OpenAI;
    private transport: StdioClientTransport | null = null;
    private tools: Tool[] = [];
    private connected: boolean = false;

    constructor() {
        this.openai = new OpenAI({
            apiKey: OPENAI_API_KEY,
        });
        this.mcp = new Client({ name: "mcp-client-cli", version: "1.0.0" });
    }

    async connectToServer() {
        if (this.connected) return;

        try {
            // Use SSE transport for web-based communication
            // this.transport = new StdioClientTransport({command: process.execPath, args: ['/Users/sasidharank/Projects/Spike/mcp-server-spike/server/build/transport/stdio/index.js']});
            this.transport = new StdioClientTransport({command: process.execPath, args: ['/app/server/build/transport/stdio/index.js']});

            await this.mcp.connect(this.transport);

            const toolsResult = await this.mcp.listTools();
            this.tools = toolsResult.tools.map((tool) => {
                return {
                    type: "function",
                    function: {
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.inputSchema,
                    }
                };
            });

            this.connected = true;
            console.log("Connected to server with tools:", this.tools.map(tool => tool.function.name));
        } catch (e) {
            console.log("Failed to connect to MCP server: ", e);
            throw e;
        }
    }

    async processQuery(query: string) {
        // Ensure connection is established
        if (!this.connected) {
            await this.connectToServer();
        }

        const messages: MessageParam[] = [
            {
                role: "user",
                content: query,
            },
        ];

        const response = await this.openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            max_tokens: 1000,
            messages,
            tools: this.tools,
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

                    const result = await this.mcp.callTool({
                        name: toolName,
                        arguments: toolArgs,
                    });
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

                    const followUpResponse = await this.openai.chat.completions.create({
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

    async chatLoop() {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        try {
            console.log("\nMCP Client Started!");
            console.log("Type your queries or 'quit' to exit.");

            while (true) {
                const message = await rl.question("\nQuery: ");
                if (message.toLowerCase() === "quit") {
                    break;
                }
                const response = await this.processQuery(message);
                console.log("\n" + response);
            }
        } finally {
            rl.close();
        }
    }

    async cleanup() {
        await this.mcp.close();
    }
}