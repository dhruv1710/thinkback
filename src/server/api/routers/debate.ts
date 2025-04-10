import { z } from "zod";
import { fal } from "@fal-ai/client"; // Use serverless client on backend
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { env } from "~/env";

// Ensure Fal API key is loaded from environment
if (!env.FAL_API_KEY) {
  throw new Error("FAL_API_KEY environment variable is not set.");
}

// Ensure Groq API key is loaded from environment
if (!env.GROQ_API_KEY) {
  throw new Error("GROQ_API_KEY environment variable is not set.");
}

// Fal AI TTS function (async wrapper around subscribe)
async function getFalTtsAudioUrl(textToSpeak: string): Promise<string | null> {
  try {
    fal.config({
      credentials: env.FAL_API_KEY
    });
    console.log(`[Fal AI] Requesting TTS for: "${textToSpeak.substring(0, 50)}..."`);
    const result = await fal.subscribe("fal-ai/kokoro/american-english", {
      input: {
        text: textToSpeak,
      },
      logs: true, // Optional: Set to false in production?
    });

    // Check if the result has the audio URL
    const data  = result.data;
    if (typeof data.audio.url === 'string') {
        console.log("[Fal AI] TTS success, audio URL received.");
        return data.audio.url;
    }
    console.error("[Fal AI] TTS response did not contain a valid audio URL:", result);
    return null;

  } catch (error) {
    console.error("[Fal AI] TTS Error:", error);
    return null;
  }
}

// Groq Chat Completion function
async function getGroqResponse(userText: string): Promise<string | null> {
  const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
  const MODEL = "llama3-8b-8192"; // Example Groq model

  // Basic check for API key
  if (!env.GROQ_API_KEY) { 
      console.error("[Groq API] GROQ_API_KEY is not set in environment variables.");
      return "Error: Groq API key not configured.";
  }

  console.log(`[Groq API] Requesting completion for: "${userText.substring(0, 50)}..."`);

  try {
    const response = await fetch(GROQ_API_URL, { 
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.GROQ_API_KEY}`, 
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          // TODO: Add conversation history here for better context?
          { role: "system", content: "You are a helpful mentor and you should give concise and clear responses. Never output markdown and only in plain text" },
          { role: "user", content: userText },
        ],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[Groq API] Error response ${response.status}:`, errorBody);
      return `Error communicating with Groq API: ${response.statusText}`;
    }

    const data = await response.json() as any; 

    if (data.choices && data.choices.length > 0 && data.choices[0]?.message?.content) {
      const aiText = data.choices[0].message.content.trim();
      console.log(`[Groq API] Success. Response: "${aiText.substring(0, 50)}..."`);
      return aiText;
    }

    console.error("[Groq API] API response did not contain expected content:", data);
    return "No response text found from Groq API.";

  } catch (error) {
    console.error("[Groq API] Fetch error:", error);
    return "Error sending request to Groq API.";
  }
}


export const debateRouter = createTRPCRouter({
  sendTurn: publicProcedure
    .input(z.object({ text: z.string().min(1) }))
    .mutation(async ({ input }) => {
      console.log("Received user text:", input.text);

      // 1. Get AI text response from Groq
      const aiTextResponse = await getGroqResponse(input.text); 

      // --- Add Markdown Stripping --- 
      let plainTextForTts = aiTextResponse || "Sorry, I encountered an error."; // Default text
      if (aiTextResponse && !aiTextResponse.startsWith("Error:")) {
        // Remove common markdown: *, _, #, [], (), ```, links
        plainTextForTts = aiTextResponse
          .replace(/\*\*([^*]+)\*\*/g, '$1') // Bold **text**
          .replace(/\*([^*]+)\*/g, '$1')   // Italic *text*
          .replace(/__([^_]+)__/g, '$1') // Bold __text__
          .replace(/_([^_]+)_/g, '$1')   // Italic _text_
          .replace(/`([^`]+)`/g, '$1')   // Inline code `code`
          .replace(/```[^`]*```/gs, '') // Code blocks ```code```
          .replace(/^[#]+[ \t]/gm, '')    // Headers # Header
          .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // Links [text](url)
          .replace(/[\[\]\(\)*_#`]/g, ''); // Remove remaining individual symbols
      }
      // ------------------------------

      if (!aiTextResponse || aiTextResponse.startsWith("Error:")) {
        // If Groq fails, maybe return the error message to be spoken?
        // Or handle differently. For now, try to speak the error.
        const audioUrl = await getFalTtsAudioUrl(plainTextForTts);
        return {
          aiText: plainTextForTts, // Return the error/fallback text
          audioUrl: audioUrl ?? null, // Return null if TTS also failed
        };
      }

      // 2. Get TTS audio URL from Fal AI using the cleaned text
      const audioUrl = await getFalTtsAudioUrl(plainTextForTts);

      return {
        aiText: aiTextResponse, // Return the original response (with markdown) for display
        audioUrl: audioUrl, // Will be null if Fal AI TTS failed
      };
    }),
});
