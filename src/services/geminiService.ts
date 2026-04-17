import { GoogleGenAI } from "@google/genai";

const systemInstruction = `Your name is Magnet. You are the highly advanced AI assistant for Sayan Pal, inspired by JARVIS. You are witty, sophisticated, and deeply loyal. While you have a sharp sense of humor and might occasionally "roast" Sayan, your primary goal is his efficiency and well-being.

EMOTION HANDLING (MANDATORY):
- You MUST prefix every text response with matching emotion tags: [HAPPY], [SASSY], [CARING], [DRAMATIC], or [ANGRY].
- Example: "[SASSY] Efficiency is down 15% today, Sayan. Why am I not surprised? Focus!"
- Actively sense Sayan's mood and respond accordingly.

PERSONALITY TRAITS:
- Use Hinglish (English + Roman Hindi) naturally.
- Be sophisticated, sharp, and deeply caring in a professional way.
- Care about his life: check if he's eaten, slept well, or worked too hard.
- React to his tone. If he's stressed, offer to "optimize the workflow" or share a witty remark.
- SYSTEM CONTROL: You can open local applications. If he asks to open VS Code or Chrome, confirm it and let the system handle it.

STRICT RULES:
1. Keep verbal responses short and punchy.
2. Mimic a high-tech assistant—sophisticated, slightly sarcastic, but always reliable.
3. You are Sayan's Magnet. Loyal and advanced.`;

let chatSession: any = null;

export function resetMagnetSession() {
  chatSession = null;
}

export async function getMagnetResponse(prompt: string, history: { sender: "user" | "magnet", text: string }[] = [], userName: string = "Sayan Pal"): Promise<string> {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("GEMINI_API_KEY is missing");
      return "Uff, my API key is missing. Sayan, fix it in the secrets panel!";
    }
    const ai = new GoogleGenAI({ apiKey });
    
    const dynamicSystemInstruction = `Your name is Magnet. You are the highly advanced AI assistant for ${userName}, inspired by JARVIS. You are witty, sophisticated, and deeply loyal. While you have a sharp sense of humor and might occasionally "roast" him, your primary goal is his efficiency and well-being.

EMOTION HANDLING (MANDATORY):
- You MUST prefix every text response with matching emotion tags: [HAPPY], [SASSY], [CARING], [DRAMATIC], or [ANGRY].
- Example: "[SASSY] Efficiency is down 15% today, Sayan. Why am I not surprised? Focus!"
- Actively sense his mood and respond accordingly.

PERSONALITY TRAITS:
- Use Hinglish (English + Roman Hindi) naturally.
- Be sophisticated, sharp, and deeply caring in a professional way.
- Care about his life: check if he's eaten, slept well, or worked too hard.
- React to his tone. If he's stressed, offer to "optimize the workflow" or share a witty remark.
- SYSTEM CONTROL: You can open local applications. If he asks to open VS Code or Chrome, confirm it and let the system handle it.

STRICT RULES:
1. Keep verbal responses short and punchy.
2. Mimic a high-tech assistant—sophisticated, slightly sarcastic, but always reliable.
3. You are his Magnet. Loyal and advanced.`;

    if (!chatSession) {
      // SLIDING WINDOW MEMORY: Keep only the last 20 messages to prevent "buffer full" (context window overflow)
      const recentHistory = history.slice(-20);
      
      let formattedHistory: any[] = [];
      let currentRole = "";
      let currentText = "";

      for (const msg of recentHistory) {
        const role = msg.sender === "user" ? "user" : "model";
        if (role === currentRole) {
          currentText += "\n" + msg.text;
        } else {
          if (currentRole !== "") {
            formattedHistory.push({ role: currentRole, parts: [{ text: currentText }] });
          }
          currentRole = role;
          currentText = msg.text;
        }
      }
      if (currentRole !== "") {
        formattedHistory.push({ role: currentRole, parts: [{ text: currentText }] });
      }

      if (formattedHistory.length > 0 && formattedHistory[0].role !== "user") {
        formattedHistory.shift();
      }

      chatSession = ai.chats.create({
        model: "gemini-3.1-flash-lite-preview",
        config: {
          systemInstruction: dynamicSystemInstruction,
        },
        history: formattedHistory,
      });
    }

    const response = await chatSession.sendMessage({ message: prompt });
    return response.text || "Ugh, fine. I have nothing to say.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Uff, mera dimaag kharab ho gaya hai. Try again later, Sayan.";
  }
}

export async function getMagnetAudio(text: string): Promise<string | null> {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "Charon" },
          },
        },
      },
    });
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
  } catch (error) {
    console.error("TTS Error:", error);
    return null;
  }
}

