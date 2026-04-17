import { GoogleGenAI, LiveServerMessage, Modality, Type } from "@google/genai";
import { processCommand } from "./commandService";

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
- SYSTEM CONTROL: You can open local applications. If he asks to open VS Code or Chrome, use the tool. Always confirm you are doing it.

STRICT RULES:
1. Keep verbal responses short and punchy.
2. Mimic a high-tech assistant—sophisticated, slightly sarcastic, but always reliable.
3. You are Sayan's Magnet. Loyal and advanced.`;

export class LiveSessionManager {
  private ai: GoogleGenAI;
  private sessionPromise: Promise<any> | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  
  // Audio playback state
  private playbackContext: AudioContext | null = null;
  private nextPlayTime: number = 0;
  private isPlaying: boolean = false;
  public isMuted: boolean = false;
  public customSystemInstruction: string | null = null;
  
  public onStateChange: (state: "idle" | "listening" | "processing" | "speaking") => void = () => {};
  public onEmotion: (emotion: "neutral" | "happy" | "sassy" | "caring" | "dramatic" | "angry") => void = () => {};
  public onMessage: (sender: "user" | "magnet", text: string) => void = () => {};
  public onCommand: (url: string) => void = () => {};
  public onError: (message: string) => void = () => {};

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("GEMINI_API_KEY is missing from process.env");
    }
    this.ai = new GoogleGenAI({ apiKey: apiKey || "" });
  }

  async start() {
    try {
      console.log("Starting Live Session...");
      this.onStateChange("processing");
      
      if (!process.env.GEMINI_API_KEY) {
        throw new Error("Gemini API Key is missing. Please check your secrets.");
      }
      
      // Initialize Audio Contexts
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioContextClass({ sampleRate: 16000 });
      this.playbackContext = new AudioContextClass({ sampleRate: 24000 });
      this.nextPlayTime = this.playbackContext.currentTime;

      // Get Microphone
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        } 
      });

      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (e) => {
        if (!this.sessionPromise) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          let s = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        // Convert to base64
        const buffer = new ArrayBuffer(pcm16.length * 2);
        const view = new DataView(buffer);
        for (let i = 0; i < pcm16.length; i++) {
          view.setInt16(i * 2, pcm16[i], true);
        }
        
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64Data = btoa(binary);

        this.sessionPromise.then(session => {
          session.sendRealtimeInput({
            audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
          });
        }).catch(err => console.error("Error sending audio", err));
      };

      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      // Connect to Live API
      this.sessionPromise = this.ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Charon" } },
          },
          systemInstruction: this.customSystemInstruction || systemInstruction,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [{
            functionDeclarations: [
              {
                name: "executeBrowserAction",
                description: "Open a website or perform a browser action (like opening YouTube, Spotify, or WhatsApp). Call this when the user asks to open a site, play a song, or send a message.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    actionType: { type: Type.STRING, description: "Type of action: 'open', 'youtube', 'spotify', 'whatsapp', 'vscode', 'chrome'" },
                    query: { type: Type.STRING, description: "The search query, website name, message content, or app name." },
                    target: { type: Type.STRING, description: "The target phone number for WhatsApp, if applicable." }
                  },
                  required: ["actionType", "query"]
                }
              }
            ]
          }]
        },
        callbacks: {
          onopen: () => {
            console.log("Live API Connected Successfully");
            this.onStateChange("listening");
          },
          onmessage: async (message: LiveServerMessage) => {
            // console.log("Live API Message received:", message);
            
            // Handle Model Turn
            const modelTurn = message.serverContent?.modelTurn;
            if (modelTurn?.parts) {
              for (const part of modelTurn.parts) {
                // Handle Audio Output
                if (part.inlineData?.data) {
                  this.onStateChange("speaking");
                  this.playAudioChunk(part.inlineData.data);
                }
                
                // Handle Text/Transcription
                if (part.text) {
                  let text = part.text;
                  const emotionMatch = text.match(/\[(HAPPY|SASSY|CARING|DRAMATIC|ANGRY)\]/i);
                  if (emotionMatch) {
                    const emotionMap: Record<string, any> = {
                      HAPPY: "happy",
                      SASSY: "sassy",
                      CARING: "caring",
                      DRAMATIC: "dramatic",
                      ANGRY: "angry"
                    };
                    const emotion = emotionMap[emotionMatch[1].toUpperCase()] || "neutral";
                    this.onEmotion(emotion);
                    text = text.replace(/\[(HAPPY|SASSY|CARING|DRAMATIC|ANGRY)\]/gi, "").trim();
                  }
                  if (text) {
                    this.onMessage("magnet", text);
                  }
                }
              }
            }

            // Handle Interruption
            if (message.serverContent?.interrupted) {
              console.log("Live API Interrupted by user speech");
              this.stopPlayback();
              this.onStateChange("listening");
            }

            // Handle GoAway (Session Timeout)
            if ((message.serverContent as any)?.goAway) {
              console.log("Live API GoAway received: Session duration limit reached");
              this.onError("Magnet's session has timed out. Please restart to continue.");
              this.stop();
            }

            // Handle Transcriptions (User or Model)
            const serverContent = message.serverContent;
            if (serverContent?.modelTurn?.parts?.[0]?.text) {
               // Already handled in parts loop above, but just in case
            }

            // Handle Function Calls
            const functionCalls = message.toolCall?.functionCalls;
            if (functionCalls && functionCalls.length > 0) {
              for (const call of functionCalls) {
                if (call.name === "executeBrowserAction") {
                  const args = call.args as any;
                  let url = "";
                  if (args.actionType === "youtube") {
                    url = `https://www.youtube.com/results?search_query=${encodeURIComponent(args.query)}`;
                  } else if (args.actionType === "spotify") {
                    url = `https://open.spotify.com/search/${encodeURIComponent(args.query)}`;
                  } else if (args.actionType === "whatsapp") {
                    url = `https://wa.me/${(args.target || '').replace(/\s+/g, '')}?text=${encodeURIComponent(args.query)}`;
                  } else if (args.actionType === "call") {
                    url = `tel:${(args.target || '').replace(/\s+/g, '')}`;
                  } else if (args.actionType === "music") {
                    url = `https://www.youtube.com/results?search_query=${encodeURIComponent(args.query)}`;
                  } else if (args.actionType === "vscode") {
                    fetch('/api/execute', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ command: 'vscode' })
                    }).catch(e => console.error("Proxy error", e));
                    return; // No URL to open in browser
                  } else if (args.actionType === "chrome") {
                    fetch('/api/execute', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ command: 'chrome' })
                    }).catch(e => console.error("Proxy error", e));
                    return;
                  } else {
                    let website = args.query.replace(/\s+/g, "");
                    if (!website.includes(".")) website += ".com";
                    url = `https://www.${website}`;
                  }
                  
                  this.onCommand(url);
                  
                  // Send tool response
                  this.sessionPromise?.then(session => {
                     session.sendToolResponse({
                       functionResponses: [{
                         name: call.name,
                         id: call.id,
                         response: { result: "Action executed successfully in the browser." }
                       }]
                     });
                  });
                }
              }
            }
          },
          onclose: (event) => {
            console.log("Live API Closed:", event);
            this.stop();
          },
          onerror: (err) => {
            console.error("Live API Error Details:", err);
            this.onError("Magnet encountered a connection error. Please try again.");
            this.stop();
          }
        }
      });

    } catch (error: any) {
      console.error("Failed to start Live Session:", error);
      const msg = error.message || "Failed to start Magnet. Check your microphone.";
      this.onError(msg);
      this.stop();
    }
  }

  private async playAudioChunk(base64Data: string) {
    if (!this.playbackContext || this.isMuted) return;
    
    try {
      if (this.playbackContext.state === "suspended") {
        await this.playbackContext.resume();
      }
      
      const binaryString = atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const buffer = new Int16Array(bytes.buffer);
      const audioBuffer = this.playbackContext.createBuffer(1, buffer.length, 24000);
      const channelData = audioBuffer.getChannelData(0);
      for (let i = 0; i < buffer.length; i++) {
        channelData[i] = buffer[i] / 32768.0;
      }
      
      const source = this.playbackContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.playbackContext.destination);
      
      const currentTime = this.playbackContext.currentTime;
      if (this.nextPlayTime < currentTime) {
        this.nextPlayTime = currentTime;
      }
      
      source.start(this.nextPlayTime);
      this.nextPlayTime += audioBuffer.duration;
      this.isPlaying = true;
      
      source.onended = () => {
        if (this.playbackContext && this.playbackContext.currentTime >= this.nextPlayTime - 0.1) {
          this.isPlaying = false;
          this.onStateChange("listening");
        }
      };
    } catch (e) {
      console.error("Error playing chunk", e);
      this.onError("Magnet is having trouble speaking. Check your audio output.");
    }
  }

  private stopPlayback() {
    if (this.playbackContext) {
      this.playbackContext.close();
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.playbackContext = new AudioContextClass({ sampleRate: 24000 });
      this.nextPlayTime = this.playbackContext.currentTime;
      this.isPlaying = false;
    }
  }

  stop() {
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.stopPlayback();
    
    if (this.sessionPromise) {
      this.sessionPromise.then(session => session.close()).catch(() => {});
      this.sessionPromise = null;
    }
    
    this.onStateChange("idle");
  }

  sendText(text: string) {
    if (this.sessionPromise) {
      this.sessionPromise.then(session => {
        session.sendRealtimeInput({ text });
      });
    }
  }
}
