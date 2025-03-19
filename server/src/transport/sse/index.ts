import express, { Request, Response } from 'express';
import cors from 'cors';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { AlertsResponse, ForecastResponse, PointsResponse } from "../../interface/interface.js";
import { formatAlert, makeNWSRequest } from "../../helper/helper.js";
import { IncomingMessage } from 'http';
import { MCPClient } from "../../helper/mcpClient.js";

export const NWS_API_BASE = "https://api.weather.gov";
export const USER_AGENT = "weather-app/1.0";

// Create server instance with server info
const serverInfo = {
    name: "weather",
    version: "1.0.0",
};

const server = new McpServer(serverInfo);

// Create Express app
const app = express();
app.use(cors());
app.use(express.json());

// Track active transports by session ID
const transports = new Map<string, SSEServerTransport>();

// Register weather tools directly in the index file to avoid circular dependencies
server.tool(
    "get-alerts",
    "Get weather alerts for a state",
    {
        state: z.string().length(2).describe("Two-letter state code (e.g. CA, NY)"),
    },
    async ({ state }) => {
        const stateCode = state.toUpperCase();
        const alertsUrl = `${NWS_API_BASE}/alerts?area=${stateCode}`;
        const alertsData: AlertsResponse | null = await makeNWSRequest(alertsUrl);

        if (!alertsData) {
            return {
                content: [
                    {
                        type: "text",
                        text: "Failed to retrieve alerts data",
                    },
                ],
            };
        }

        const features = alertsData.features || [];
        if (features.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: `No active alerts for ${stateCode}`,
                    },
                ],
            };
        }

        const formattedAlerts = features.map(formatAlert);
        const alertsText = `Active alerts for ${stateCode}:\n\n${formattedAlerts.join("\n")}`;

        return {
            content: [
                {
                    type: "text",
                    text: alertsText,
                },
            ],
        };
    },
);

server.tool(
    "get-forecast",
    "Get weather forecast for a location",
    {
        latitude: z.number().min(-90).max(90).describe("Latitude of the location"),
        longitude: z.number().min(-180).max(180).describe("Longitude of the location"),
    },
    async ({ latitude, longitude }) => {
        // Get grid point data
        const pointsUrl = `${NWS_API_BASE}/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`;
        const pointsData: PointsResponse | null = await makeNWSRequest(pointsUrl);

        if (!pointsData) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Failed to retrieve grid point data for coordinates: ${latitude}, ${longitude}. This location may not be supported by the NWS API (only US locations are supported).`,
                    },
                ],
            };
        }

        const forecastUrl = pointsData.properties?.forecast;
        if (!forecastUrl) {
            return {
                content: [
                    {
                        type: "text",
                        text: "Failed to get forecast URL from grid point data",
                    },
                ],
            };
        }

        // Get forecast data
        const forecastData: ForecastResponse | null = await makeNWSRequest(forecastUrl);
        if (!forecastData) {
            return {
                content: [
                    {
                        type: "text",
                        text: "Failed to retrieve forecast data",
                    },
                ],
            };
        }

        const periods = forecastData.properties?.periods || [];
        if (periods.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: "No forecast periods available",
                    },
                ],
            };
        }

        // Format forecast periods
        const formattedForecast = periods.map((period) =>
            [
                `${period.name || "Unknown"}:`,
                `Temperature: ${period.temperature || "Unknown"}°${period.temperatureUnit || "F"}`,
                `Wind: ${period.windSpeed || "Unknown"} ${period.windDirection || ""}`,
                `${period.shortForecast || "No forecast available"}`,
                "---",
            ].join("\n"),
        );

        const forecastText = `Forecast for ${latitude}, ${longitude}:\n\n${formattedForecast.join("\n")}`;

        return {
            content: [
                {
                    type: "text",
                    text: forecastText,
                },
            ],
        };
    },
);

// Setup SSE endpoint
app.get("/sse", async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Create a new transport for this connection
    const transport = new SSEServerTransport("/api/messages", res);
     console.log("====> Session id", transport.sessionId);
    // Store the transport keyed by session ID
    transports.set(transport.sessionId, transport);

    // Clean up when the connection is closed
    res.on('close', () => {
        transports.delete(transport.sessionId);
    });

    // Connect server to the transport
    await transport.start();
    await server.connect(transport);

    console.log(`New SSE connection established: ${transport.sessionId}`);
});

// Setup message endpoint to receive client messages
app.post("/api/messages", async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;

    if (!sessionId) {
        res.status(400).send("Missing sessionId query parameter");
        return;
    }

    const transport = transports.get(sessionId);

    if (!transport) {
        res.status(404).send("Session not found");
        return;
    }

    // Cast Express Request to IncomingMessage for compatibility with SDK
    await transport.handlePostMessage(req as unknown as IncomingMessage, res);
});


// Create MCP client instance
const mcpClient = new MCPClient();
// Chatbot API endpoint
app.post("/chatbot", async (req: Request, res: any) => {
    try {
        const { query } = req.body;

        if (!query || typeof query !== 'string') {
            return res.status(400).json({ error: 'Invalid or missing query parameter' });
        }

        // Process the query through the MCP client
        const response = await mcpClient.processQuery(query);

        // Return the response
        return res.json({ response });
    } catch (error) {
        console.error('Error processing chatbot query:', error);
        return res.status(500).json({
            error: 'Failed to process query',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Set up a default route for the root path
app.get("/", (_: Request, res: Response) => {
    res.send(`
        <html>
            <head>
                <title>Weather MCP Server</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        max-width: 800px;
                        margin: 0 auto;
                        padding: 20px;
                    }
                    h1 {
                        color: #333;
                    }
                    #chat-container {
                        border: 1px solid #ccc;
                        border-radius: 5px;
                        padding: 10px;
                        height: 400px;
                        overflow-y: auto;
                        margin-bottom: 10px;
                        background: #f9f9f9;
                    }
                    #user-input {
                        display: flex;
                        gap: 10px;
                    }
                    #question {
                        flex-grow: 1;
                        padding: 8px;
                        border: 1px solid #ccc;
                        border-radius: 4px;
                    }
                    button {
                        padding: 8px 16px;
                        background: #4CAF50;
                        color: white;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                    }
                    button:hover {
                        background: #45a049;
                    }
                    .message {
                        margin-bottom: 10px;
                        padding: 8px;
                        border-radius: 4px;
                    }
                    .user-message {
                        background: #e3f2fd;
                        text-align: right;
                    }
                    .bot-message {
                        background: #f1f1f1;
                    }
                    .thinking {
                        font-style: italic;
                        color: #666;
                    }
                </style>
            </head>
            <body>
                <h1>Weather Assistant</h1>
                <p>Ask questions about weather forecasts and alerts</p>

                <div id="chat-container"></div>

                <div id="user-input">
                    <input type="text" id="question" placeholder="Ask about the weather...">
                    <button id="send-btn">Send</button>
                </div>

                <script>
                    const chatContainer = document.getElementById('chat-container');
                    const questionInput = document.getElementById('question');
                    const sendButton = document.getElementById('send-btn');

                    // Function to add messages to the chat
                    function addMessage(text, isUser = false) {
                        const messageDiv = document.createElement('div');
                        messageDiv.classList.add('message');
                        messageDiv.classList.add(isUser ? 'user-message' : 'bot-message');
                        messageDiv.textContent = text;
                        chatContainer.appendChild(messageDiv);
                        chatContainer.scrollTop = chatContainer.scrollHeight;
                    }

                    // Function to handle sending a message
                    async function sendMessage() {
                        const question = questionInput.value.trim();
                        if (!question) return;

                        // Add user message to chat
                        addMessage(question, true);
                        questionInput.value = '';

                        // Add thinking message
                        const thinkingDiv = document.createElement('div');
                        thinkingDiv.classList.add('message', 'bot-message', 'thinking');
                        thinkingDiv.textContent = 'Thinking...';
                        chatContainer.appendChild(thinkingDiv);

                        try {
                            // Send request to API
                            const response = await fetch('/chatbot', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({ query: question })
                            });

                            const data = await response.json();

                            // Remove thinking message
                            chatContainer.removeChild(thinkingDiv);

                            // Add bot response
                            addMessage(data.response);
                        } catch (error) {
                            // Remove thinking message
                            chatContainer.removeChild(thinkingDiv);

                            // Add error message
                            addMessage('Sorry, there was an error processing your request.');
                            console.error('Error:', error);
                        }
                    }

                    // Event listeners
                    sendButton.addEventListener('click', sendMessage);
                    questionInput.addEventListener('keypress', (e) => {
                        if (e.key === 'Enter') {
                            sendMessage();
                        }
                    });

                    // Add welcome message
                    addMessage('Hello! Ask me anything about the weather. Try asking about forecasts or alerts.');
                </script>
            </body>
        </html>
    `);
});

const PORT = process.env.PORT || 4000;

async function main() {
    app.listen(PORT, () => {
        console.log(`Weather MCP Server running on http://localhost:${PORT}`);
        console.log(`SSE endpoint: http://localhost:${PORT}/sse`);
        console.log(`Messages endpoint: http://localhost:${PORT}/api/messages`);
    });
}
app.get('/stdio.js', (req, res) => {
    res.sendFile('/app/server/build/transport/stdio/index.js ');
});

main()
    .catch((error) => {
        console.error("Fatal error in main():", error);
        process.exit(1);
    });