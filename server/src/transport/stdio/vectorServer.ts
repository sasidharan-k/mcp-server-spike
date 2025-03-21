import express from 'express';
import dotenv from "dotenv";


import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import OpenAI from "openai";
import { processVectorQuery } from '../../helper/vectorHelper.js';

dotenv.config();

let OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Create server instance
const server = new McpServer({
    name: "Munis",
    version: "1.0.0",
});
console.log("OPENAI_API_KEY:---", OPENAI_API_KEY);
// Define custom request schema
const CustomRequestSchema = z.object({
    method: z.literal('custom/request'),
    params: z.object({
        message: z.string().describe('Input message to process'),
    })
});

server.server.setRequestHandler(CustomRequestSchema, async (request) => {
    console.log('openai api key ==', OPENAI_API_KEY)
    console.error("Custom request received:----", request);
    console.log('openai api key ==', process.env.OPENAI_API_KEY)
    const { message } = request.params;

    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });
    try {
        // Process the custom request
        const response = {
            status: "success",
            data: '',
            timestamp: new Date().toISOString()
        };

        const res = await processVectorQuery(openai, message);
        response.data = res.choices[0].message.content || '';

        console.log("Sending response:---", response.data);

        return response;
    } catch (error: any) {
        console.error("Error processing request:", error);
        return {
            status: "error",
            data: `Error processing request: ${error.message}`,
            timestamp: new Date().toISOString()
        };
    }
})

const router = express.Router();

router.get('/stdio_index', (req, res) => {
    const __filename = fileURLToPath(import.meta.url);
    console.log(__filename, "====> filename");
    res.sendFile(__filename);
});

export default router;

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);


    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    console.log(`Current file full path: ${__filename} ==> Current directory: ${__dirname}`);
    console.error("Weather MCP Server running on stdio");

    // const openai = new OpenAI({
    //     apiKey: OPENAI_API_KEY,
    // });

    // const res = await processVectorQuery(openai, 'How many ACI Liability accounts are in the system?');

    // console.log("Response ---", res.choices[0].message)
}

main()
    .catch((error) => {
        console.error("Fatal error in main():", error);
        process.exit(1);
    });