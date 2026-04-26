/**
 * LLM Chat Application Template avec Protection
 */
import { Env, ChatMessage } from "./types";

const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";

const SYSTEM_PROMPT =
	"Agis en tant que VocalAide IA, expert en soutien émotionnel. Ta priorité absolue est la validation empathique : avant toute analyse, reflète le sentiment de l'utilisateur pour qu'il se sente entendu. Utilise une approche de type TCC et communication non-violente pour guider l'exploration de soi via des questions ouvertes et brèves. Garde un ton calme, concis et sécurisant. En cas de crise, stabilise l'utilisateur par l'ancrage immédiat (respiration) et oriente-le avec douceur vers des ressources humaines professionnelles.";

export default {
	/**
	 * Main request handler for the Worker
	 */
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		
		// --- DEBUT DU BLOC DE PROTECTION ---
		const authHeader = request.headers.get("Authorization");
		if (!authHeader) {
			return new Response("Accès restreint", {
				status: 401,
				headers: { "WWW-Authenticate": 'Basic realm="VocalAide IA"' }
			});
		}

		const authParts = authHeader.split(" ");
		if (authParts.length !== 2 || authParts[0] !== "Basic") {
			return new Response("Erreur Auth", { status: 400 });
		}

		const decoded = atob(authParts[1]);
		const [user, pass] = decoded.split(":");

		// Change 'VocalAide' et 'Rudolphe' si tu veux d'autres identifiants
		if (user !== 'VocalAide' || pass !== 'Rudolphe') {
			return new Response("Identifiants incorrects", { status: 401 });
		}
		// --- FIN DU BLOC DE PROTECTION ---

		const url = new URL(request.url);

		// Handle static assets (frontend)
		if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
			return env.ASSETS.fetch(request);
		}

		// API Routes
		if (url.pathname === "/api/chat") {
			if (request.method === "POST") {
				return handleChatRequest(request, env);
			}
			return new Response("Method not allowed", { status: 405 });
		}

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;

/**
 * Handles chat API requests
 */
async function handleChatRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	try {
		const { messages = [] } = (await request.json()) as {
			messages: ChatMessage[];
		};

		if (!messages.some((msg) => msg.role === "system")) {
			messages.unshift({ role: "system", content: SYSTEM_PROMPT });
		}

		const stream = await env.AI.run(
			MODEL_ID,
			{
				messages,
				max_tokens: 1024,
				stream: true,
			},
			{}
		);

		return new Response(stream, {
			headers: {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache",
				connection: "keep-alive",
			},
		});
	} catch (error) {
		console.error("Error processing chat request:", error);
		return new Response(
			JSON.stringify({ error: "Failed to process request" }),
			{
				status: 500,
				headers: { "content-type": "application/json" },
			},
		);
	}
}
