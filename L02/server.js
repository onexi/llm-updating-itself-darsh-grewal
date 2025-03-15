import express from 'express';
import bodyParser from 'body-parser';
import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from "fs";

// Load environment variables from .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

// Verify that the API key is loaded
if (!process.env.OPENAI_API_KEY) {
    console.error("❌ Missing OPENAI_API_KEY. Please check your .env file.");
    process.exit(1);
} else {
    console.log("✅ OpenAI API Key Loaded");
}

// Initialize Express server
const app = express();
app.use(bodyParser.json());

// Serve static files from the public folder
app.use(express.static(path.resolve(__dirname, './public')));

// OpenAI API configuration
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Default route to serve index.html
app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, './public/index.html'));
});

// Function to load all existing functions
async function getFunctions() {
    const functionsDir = path.resolve(__dirname, "./functions");
    const files = fs.readdirSync(functionsDir);
    const openAIFunctions = {};

    for (const file of files) {
        if (file.endsWith(".js")) {
            const moduleName = file.slice(0, -3);
            const modulePath = `./functions/${moduleName}.js`;
            const { details, execute } = await import(modulePath);

            openAIFunctions[moduleName] = {
                "details": details,
                "execute": execute
            };
        }
    }

    return openAIFunctions;
}

// Function to generate a missing function using OpenAI
async function generateFunction(functionName, userPrompt) {
    const prompt = `Generate a JavaScript function named "${functionName}" based on this request: "${userPrompt}". 
    The function should include appropriate parameters and return meaningful output. 
    Format it as a CommonJS module with 'export const details' and 'export function execute()'.`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [{ role: "system", content: prompt }],
            max_tokens: 300
        });

        const functionCode = response.choices[0].message.content.trim();
        const functionPath = path.join(__dirname, "functions", `${functionName}.js`);

        fs.writeFileSync(functionPath, functionCode);
        console.log(`✅ Generated new function: ${functionName}.js`);

        return import(functionPath);
    } catch (error) {
        console.error("❌ Error generating function:", error);
        return null;
    }
}

// Route to execute a function
app.post('/execute-function', async (req, res) => {
    const { functionName, parameters, userPrompt } = req.body;

    // Load functions
    let functions = await getFunctions();

    if (!functions[functionName]) {
        console.log(`⚠️ Function ${functionName} not found. Generating it...`);
        const newFunction = await generateFunction(functionName, userPrompt);

        if (!newFunction) {
            return res.status(500).json({ error: 'Failed to generate function' });
        }

        // Reload functions after generation
        functions = await getFunctions();
    }

    try {
        // Execute the function
        const result = await functions[functionName].execute(...Object.values(parameters));
        res.json(result);
    } catch (err) {
        console.error("❌ Function execution failed:", err);
        res.status(500).json({ error: 'Function execution failed', details: err.message });
    }
});

// Start the server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});
