export default function handler(req: any, res: any) {
  const { command, args } = req.body;
  
  // NOTE: This runs on Vercel's cloud servers.
  // It CANNOT control your local computer (e.g., opening VS Code).
  
  console.log(`[Vercel API] Received command: ${command} with args: ${args}`);

  // We respond with success so the frontend doesn't show errors,
  // but we clarify that local execution is not possible from the cloud.
  res.status(200).json({ 
    success: true, 
    message: "Command received by cloud backend. Note: System control commands only execute when running the app locally.",
    command,
    args
  });
}
