export function processCommand(command: string): {
  action: string;
  url?: string;
  isBrowserAction: boolean;
} {
  const lowerCmd = command.toLowerCase().trim();

  // Helper to detect mobile (very basic check, usually handled by browser/OS redirecting deep links)
  // We use universal links/deep links which most apps handle automatically
  
  // General Browsing: "Open [website name]"
  const openMatch = lowerCmd.match(/^open\s+(.+)$/);
  if (
    openMatch &&
    !lowerCmd.includes("youtube") &&
    !lowerCmd.includes("spotify") &&
    !lowerCmd.includes("whatsapp")
  ) {
    let website = openMatch[1].trim().replace(/\s+/g, "");
    if (!website.includes(".")) {
      website += ".com";
    }
    return {
      action: `Opening ${openMatch[1]} for you, ugh.`,
      url: `https://www.${website}`,
      isBrowserAction: true,
    };
  }

  // YouTube: "Play [song/video] on YouTube"
  const ytMatch = lowerCmd.match(/^play\s+(.+?)\s+on\s+youtube$/);
  if (ytMatch) {
    const query = encodeURIComponent(ytMatch[1].trim());
    // YouTube Deep Link: youtube://results?search_query=... (Mobile) 
    // But https://www.youtube.com/results?search_query=... is a Universal Link
    // which opens the app if installed on iOS/Android.
    return {
      action: `Playing ${ytMatch[1]} on YouTube. Don't judge my music taste.`,
      url: `https://www.youtube.com/results?search_query=${query}`,
      isBrowserAction: true,
    };
  }

  // Spotify: "Search [query] on Spotify"
  const spotifyMatch = lowerCmd.match(/^search\s+(.+?)\s+on\s+spotify$/);
  if (spotifyMatch) {
    const query = encodeURIComponent(spotifyMatch[1].trim());
    // Spotify Universal Link
    return {
      action: `Searching ${spotifyMatch[1]} on Spotify. Hope it's a banger.`,
      url: `https://open.spotify.com/search/${query}`,
      isBrowserAction: true,
    };
  }

  // WhatsApp: "Send a WhatsApp message to [number] saying [message]"
  const waMatch = lowerCmd.match(
    /^send\s+a\s+whatsapp\s+message\s+to\s+([\d\+\s]+)\s+saying\s+(.+)$/,
  );
  if (waMatch) {
    const number = waMatch[1].replace(/\s+/g, "");
    const message = encodeURIComponent(waMatch[2].trim());
    // wa.me is the official universal link for WhatsApp.
    // On PC: Opens WhatsApp Web or Desktop App.
    // On Mobile: Opens WhatsApp App directly.
    return {
      action: `Sending your message. Let's hope they reply, Sayan.`,
      url: `https://wa.me/${number}?text=${message}`,
      isBrowserAction: true,
    };
  }

  // Phone Calls: "Call [number]"
  const callMatch = lowerCmd.match(/^call\s+([\d\+\s]+)$/);
  if (callMatch) {
    const number = callMatch[1].replace(/\s+/g, "");
    return {
      action: `Dialing ${callMatch[1]}... Don't say anything embarrassing.`,
      url: `tel:${number}`,
      isBrowserAction: true,
    };
  }

  // Generic Music: "Play [song]" (Defaults to YouTube as it's the most universal)
  const musicMatch = lowerCmd.match(/^play\s+(.+)$/);
  if (musicMatch && !lowerCmd.includes("on youtube") && !lowerCmd.includes("on spotify")) {
    const query = encodeURIComponent(musicMatch[1].trim());
    return {
      action: `Playing ${musicMatch[1]} for you. Enjoy the vibes.`,
      url: `https://www.youtube.com/results?search_query=${query}`,
      isBrowserAction: true,
    };
  }

  // System Commands (Local Proxy)
  const vscodeMatch = lowerCmd.match(/^open\s+vs\s*code$/);
  if (vscodeMatch) {
    fetch('/api/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'vscode' })
    }).catch(e => console.error("Proxy error", e));
    
    return {
      action: "Accessing your workbench. VS Code is loading, Sayan.",
      isBrowserAction: false, // Handled by proxy
    };
  }

  const chromeMatch = lowerCmd.match(/^open\s+chrome$/);
  if (chromeMatch) {
    fetch('http://localhost:3001/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'chrome' })
    }).catch(e => console.error("Proxy error", e));
    
    return {
      action: "Starting Chrome. Ready for the deep dive?",
      isBrowserAction: false,
    };
  }

  return { action: "", isBrowserAction: false };
}
