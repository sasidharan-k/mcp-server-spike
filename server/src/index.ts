import express, { Request, Response } from 'express';
import cors from 'cors';

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import stdioVectorServerApp from './transport/stdio/vectorServer.js';
import { MCPVectorClient } from './helper/mcpVectorClient.js';
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

app.use('stdio_spike', stdioVectorServerApp);
const mcpVectorClient = new MCPVectorClient()

// Chatbot API endpoint
app.post("/chatbot", async (req: Request, res: any) => {
    try {
        const { query } = req.body;

        if (!query || typeof query !== 'string') {
            return res.status(400).json({ error: 'Invalid or missing query parameter' });
        }

        // Process the query through the MCP client
        const response = await mcpVectorClient.processQuery(query);

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

app.get('/stdio.js', (req, res) => {
    res.sendFile('/app/server/build/transport/stdio/index.js');
});

app.get('/stdio_path', (req, res) => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    console.log("====> sso__filename", __filename, "====> __dirname", __dirname);
    res.send(__dirname+'/transport/stdio/index.js');
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`MCP Server running...`);
});