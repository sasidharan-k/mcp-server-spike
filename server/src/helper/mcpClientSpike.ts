import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// const SERVER_PATH = process.env.SERVER_PATH || '/app/server/build/transport/stdio/index.js';
const SERVER_PATH = '/Users/vigneshwaraperumal/spike/mcp/weather/server/build/transport/stdio/spike.js';
if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
}

// Define custom request schema
const CustomRequestSchema = z.object({
    status: z.string(),
    data: z.string(),
    timestamp: z.string(),
});

export class MCPClientSpike {
    private mcp: Client;
    private transport: StdioClientTransport | null = null;
    private connected: boolean = false;

    constructor() {
        this.mcp = new Client({ name: "mcp-client-cli", version: "1.0.0" });
    }

    async connectToServer() {
        if (this.connected) return;

        try {
            // Use SSE transport for web-based communication
            this.transport = new StdioClientTransport({command: process.execPath, args: [SERVER_PATH]});

            await this.mcp.connect(this.transport);

            this.connected = true;
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

        console.log("Sending AI Chatbot request...");
        const response = await this.mcp.request(
            {
                method: "custom/request",
                params: {
                    message: query
                }
            },
            CustomRequestSchema
        );

        return response.data
    }

    async cleanup() {
        await this.mcp.close();
    }
}