import React, { useState, useEffect, useRef, useCallback } from "react";
import { Mic, MicOff, Loader2, Volume2, VolumeX, Keyboard, Send, Trash2, LogIn, LogOut } from "lucide-react";
import { getMagnetResponse, getMagnetAudio, resetMagnetSession } from "./services/geminiService";
import { processCommand } from "./services/commandService";
import { LiveSessionManager } from "./services/liveService";
import Visualizer from "./components/Visualizer";
import PermissionModal from "./components/PermissionModal";
import { playPCM } from "./utils/audioUtils";
import { motion, AnimatePresence } from "motion/react";
import { auth, db, handleFirestoreError, OperationType } from "./lib/firebase";
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User
} from "firebase/auth";
import { 
  collection, 
  addDoc, 
  query, 
  orderBy, 
  limit, 
  onSnapshot, 
  serverTimestamp,
  doc,
  setDoc,
  getDoc
} from "firebase/firestore";

type AppState = "idle" | "listening" | "processing" | "speaking";

interface ChatMessage {
  id: string;
  sender: "user" | "magnet";
  text: string;
}

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [appState, setAppState] = useState<AppState>("idle");
  const [currentEmotion, setCurrentEmotion] = useState<any>("neutral");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef(messages);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      setIsAuthReady(true);
      if (user) {
        // Ensure user profile exists
        const userRef = doc(db, "users", user.uid);
        try {
          const userDoc = await getDoc(userRef);
          if (!userDoc.exists()) {
            await setDoc(userRef, {
              uid: user.uid,
              name: user.displayName || "Sayan",
              createdAt: serverTimestamp(),
            });
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Firestore Messages Listener
  useEffect(() => {
    if (!user) {
      setMessages([]);
      return;
    }

    const q = query(
      collection(db, "users", user.uid, "messages"),
      orderBy("timestamp", "asc"),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loadedMessages: ChatMessage[] = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          sender: data.role === "user" ? "user" : "magnet",
          text: data.content,
        };
      });
      setMessages(loadedMessages);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/messages`);
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const login = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  const saveMessage = async (role: "user" | "model", content: string) => {
    if (!user) return;
    try {
      await addDoc(collection(db, "users", user.uid, "messages"), {
        userId: user.uid,
        role,
        content,
        timestamp: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/messages`);
    }
  };

  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    if (liveSessionRef.current) {
      liveSessionRef.current.isMuted = isMuted;
    }
  }, [isMuted]);

  const [showTextInput, setShowTextInput] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSessionActive, setIsSessionActive] = useState(false);

  const liveSessionRef = useRef<LiveSessionManager | null>(null);

  const handleTextCommand = useCallback(async (finalTranscript: string) => {
    if (!finalTranscript.trim()) {
      setAppState("idle");
      return;
    }

    if (user) {
      saveMessage("user", finalTranscript);
    } else {
      setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "user", text: finalTranscript }]);
    }
    
    // If live session is active, send text through it
    if (isSessionActive && liveSessionRef.current) {
      liveSessionRef.current.sendText(finalTranscript);
      return;
    }

    setAppState("processing");

    // 1. Check for browser commands
    const commandResult = processCommand(finalTranscript);

    let responseText = "";

    if (commandResult.isBrowserAction) {
      responseText = commandResult.action;
      if (user) {
        saveMessage("model", responseText);
      } else {
        setMessages((prev) => [...prev, { id: Date.now().toString() + "-m", sender: "magnet", text: responseText }]);
      }
      
      if (!isMuted) {
        setAppState("speaking");
        const audioBase64 = await getMagnetAudio(responseText);
        if (audioBase64) {
          await playPCM(audioBase64);
        }
      }

      setAppState("idle");

      setTimeout(() => {
        if (commandResult.url) {
          window.open(commandResult.url, "_blank");
        }
      }, 1500);
    } else {
      // 2. General Chit-Chat via Gemini
      responseText = await getMagnetResponse(finalTranscript, messagesRef.current, user?.displayName || "Sayan Pal");
      
      // Extract emotion from text responses
      const emotionMatch = responseText.match(/\[(HAPPY|SASSY|CARING|DRAMATIC|ANGRY)\]/i);
      if (emotionMatch) {
        const emotionMap: Record<string, any> = {
          HAPPY: "happy",
          SASSY: "sassy",
          CARING: "caring",
          DRAMATIC: "dramatic",
          ANGRY: "angry"
        };
        setCurrentEmotion(emotionMap[emotionMatch[1].toUpperCase()] || "neutral");
        responseText = responseText.replace(/\[(HAPPY|SASSY|CARING|DRAMATIC|ANGRY)\]/gi, "").trim();
      }
      if (user) {
        saveMessage("model", responseText);
      } else {
        setMessages((prev) => [...prev, { id: Date.now().toString() + "-m", sender: "magnet", text: responseText }]);
      }
      
      if (!isMuted) {
        setAppState("speaking");
        const audioBase64 = await getMagnetAudio(responseText);
        if (audioBase64) {
          await playPCM(audioBase64);
        }
      }
      setAppState("idle");
    }
  }, [isMuted, isSessionActive, user]);

  useEffect(() => {
    return () => {
      if (liveSessionRef.current) {
        liveSessionRef.current.stop();
      }
    };
  }, []);

  const toggleListening = async () => {
    if (isSessionActive) {
      if (liveSessionRef.current) {
        liveSessionRef.current.stop();
        liveSessionRef.current = null;
      }
      setIsSessionActive(false);
      setAppState("idle");
      resetMagnetSession();
    } else {
      try {
        setAppState("processing");
        resetMagnetSession();
        
        const session = new LiveSessionManager();
        session.isMuted = isMuted;
        
        // Build dynamic context for Magnet's memory
        const recentContext = messages.slice(-10).map(m => `${m.sender}: ${m.text}`).join("\n");
        const userName = user?.displayName || "Sayan Pal";

        session.customSystemInstruction = `Your name is Magnet. You are the highly advanced AI assistant for ${userName}, inspired by JARVIS. You are witty, sophisticated, and deeply loyal. While you have a sharp sense of humor and might occasionally "roast" him, your primary goal is his efficiency and well-being.
        
        CONTEXT OF RECENT CONVERSATION:
        ${recentContext || "No recent messages. This is a fresh start."}
        
        Keep your verbal responses very short, punchy, and highly entertaining. Speak in a mix of natural English and Roman Hindi (Hinglish). Mimic a high-tech assistant—sophisticated, slightly sarcastic, but always reliable.`;
        
        session.onStateChange = (state) => {
          setAppState(state);
        };
        
        session.onEmotion = (emotion) => {
          setCurrentEmotion(emotion);
        };
        
        session.onMessage = (sender, text) => {
          if (text.trim()) {
            if (user) {
              saveMessage(sender === "user" ? "user" : "model", text);
            } else {
              setMessages((prev) => [...prev, { id: Date.now().toString() + "-" + sender, sender, text }]);
            }
          }
        };
        
        session.onCommand = (url) => {
          setTimeout(() => {
            window.open(url, "_blank");
          }, 1000);
        };

        session.onError = (message) => {
          setErrorMessage(message);
        };

        await session.start();
        liveSessionRef.current = session;
        setIsSessionActive(true);
        setErrorMessage(null);
      } catch (e: any) {
        console.error("Failed to start session", e);
        if (e.message?.includes("Permission") || e.message?.includes("NotAllowedError")) {
          setShowPermissionModal(true);
        } else {
          setErrorMessage(e.message || "A network error occurred while connecting to Magnet.");
        }
        setIsSessionActive(false);
        setAppState("idle");
      }
    }
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim()) return;
    
    handleTextCommand(textInput);
    setTextInput("");
    setShowTextInput(false);
  };

  return (
    <div className="h-[100dvh] w-screen bg-[#050505] text-white flex flex-col items-center justify-between font-sans relative overflow-hidden m-0 p-0">
      {showPermissionModal && (
        <PermissionModal 
          onClose={() => setShowPermissionModal(false)} 
        />
      )}

      {/* Cinematic Background Gradients */}
      <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="scanlines" />
        <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-violet-600/10 blur-[120px] rounded-full animate-[pulse_8s_infinite_ease-in-out]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-cyan-600/10 blur-[120px] rounded-full animate-[pulse_8s_infinite_ease-in-out] [animation-delay:4s]" />
      </div>

      {/* Header */}
      <header className="absolute top-0 left-0 w-full flex justify-between items-center z-20 shrink-0 px-6 py-4 md:px-12 md:py-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-violet-500/50 shadow-[0_0_15px_rgba(139,92,246,0.3)] hover:shadow-[0_0_20px_rgba(139,92,246,0.6)] transition-all duration-500">
            <img 
              src="/magnet-logo.png" 
              alt="Magnet Avatar" 
              className="w-full h-full object-cover magnet-avatar"
              referrerPolicy="no-referrer"
            />
          </div>
          <h1 className="text-xl font-serif font-medium tracking-wide opacity-90">Magnet</h1>
          {errorMessage && (
            <div className="ml-4 px-3 py-1 bg-red-500/20 border border-red-500/50 rounded-full text-[10px] text-red-400 animate-pulse">
              {errorMessage}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {user ? (
            <div className="flex items-center gap-3">
              <span className="text-xs text-white/50 hidden md:inline">Hi, {user.displayName?.split(' ')[0]}</span>
              <button
                onClick={logout}
                className="p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors border border-white/10"
                title="Logout"
              >
                <LogOut size={18} className="opacity-70" />
              </button>
            </div>
          ) : (
            <button
              onClick={login}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-500/20 hover:bg-violet-500/30 transition-colors border border-violet-500/50 text-xs"
            >
              <LogIn size={14} />
              <span>Login</span>
            </button>
          )}
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors border border-white/10"
            title={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? (
              <VolumeX size={18} className="opacity-70" />
            ) : (
              <Volume2 size={18} className="opacity-70" />
            )}
          </button>
        </div>
      </header>

      {/* Main Content - Visualizer & Chat */}
      <main className="absolute inset-0 flex flex-row items-center justify-between w-full h-full z-10 overflow-hidden pt-20 pb-24 px-4 md:px-12">
        
        {/* Left Column: Magnet Status */}
        <div className="flex w-[30%] lg:w-[25%] h-full flex-col justify-end gap-6 z-10 pb-4 pointer-events-none">
          <div className="h-6">
            <AnimatePresence>
              {appState === "processing" && (
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="flex items-center gap-2 text-cyan-300/80 text-sm md:text-base italic font-serif"
                >
                  <Loader2 size={16} className="animate-spin" />
                  {isSessionActive ? "Magnet is thinking..." : "Connecting to Magnet..."}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Center Visualizer (Fixed Full Screen Background) */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
          <Visualizer state={appState} emotion={currentEmotion} imageUrl="/magnet-logo.png" />
        </div>

        {/* Right Column: User Status */}
        <div className="flex w-[30%] lg:w-[25%] h-full flex-col justify-center gap-4 z-10">
          <div className="h-6 flex justify-end">
            <AnimatePresence>
              {appState === "listening" && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="flex items-center gap-2 text-violet-300/80 text-sm md:text-base italic"
                >
                  <div className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
                  Listening...
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

      </main>

      {/* Controls */}
      <footer className="absolute bottom-0 left-0 w-full flex flex-col items-center justify-center pb-6 md:pb-8 z-20 shrink-0 gap-4">
        <AnimatePresence>
          {showTextInput && (
            <motion.form 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              onSubmit={handleTextSubmit}
              className="w-full max-w-md flex items-center gap-2 bg-white/5 border border-white/10 rounded-full p-1 pl-4 backdrop-blur-md shadow-2xl"
            >
              <input 
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Type a message to Magnet..."
                className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/30 text-sm"
                autoFocus
              />
              <button 
                type="submit"
                disabled={!textInput.trim()}
                className="p-2 rounded-full bg-violet-500 hover:bg-violet-600 disabled:opacity-50 disabled:hover:bg-violet-500 transition-colors"
              >
                <Send size={16} />
              </button>
            </motion.form>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-4">
          <button
            onClick={toggleListening}
            className={`
              group relative flex items-center gap-3 px-8 py-4 rounded-full font-medium tracking-wide transition-all duration-300 shadow-2xl
              ${
                isSessionActive
                  ? "bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30"
                  : "bg-white/10 text-white border border-white/20 hover:bg-white/20 hover:scale-105"
              }
            `}
          >
            {isSessionActive ? (
              <>
                <MicOff size={20} />
                <span>End Session</span>
              </>
            ) : (
              <>
                <Mic size={20} className="group-hover:animate-bounce" />
                <span>Start Session</span>
              </>
            )}
          </button>
          
          {!isSessionActive && (
            <button
              onClick={() => setShowTextInput(!showTextInput)}
              className="p-4 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors shadow-2xl"
              title="Type instead"
            >
              <Keyboard size={20} className="opacity-70" />
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
