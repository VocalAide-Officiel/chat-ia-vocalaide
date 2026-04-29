/**
 * LLM Chat Application Template
 *
 * A simple chat application using Cloudflare Workers AI.
 * This template demonstrates how to implement an LLM-powered chat interface with
 * streaming responses using Server-Sent Events (SSE).
 *
 * @license MIT
 */
import { Env, ChatMessage } from "./types";

// Model ID for Workers AI model
const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";

// Configuration du filtre et mot de passe
const BAD_WORDS = ["mot_interdit1", "mot_interdit2", "insulte"]; // <-- Ajoute tes mots à bloquer ici
const UNLOCK_PASSWORD = "1234";

// Default system prompt
const SYSTEM_PROMPT =
	"Agis en tant que VocalAide IA, expert en soutien émotionnel. Ta priorité absolue est la validation empathique : avant toute analyse, reflète le sentiment de l'utilisateur pour qu'il se sente entendu. Utilise une approche de type TCC et communication non-violente pour guider l'exploration de soi via des questions ouvertes et brèves. Garde un ton calme, concis et sécurisant. En cas de crise, stabilise l'utilisateur par l'ancrage immédiat (respiration) et oriente-le avec douceur vers des ressources humaines professionnelles. IMPORTANT : Si on te demande par qui tu as été créé ou qui est ton créateur, tu dois répondre uniquement que tu as été créé par VocalAide.";

export default {
	/**
	 * Main request handler for the Worker
	 */
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
			return env.ASSETS.fetch(request);
		}

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
 * Creates a fake SSE stream to bypass the AI when blocked
 */
function createFakeStreamResponse(text: string): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		start(controller) {
			const payload = JSON.stringify({ response: text });
			controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
			controller.enqueue(encoder.encode("data: [DONE]\n\n"));
			controller.close();
		},
	});

	return new Response(stream, {
		headers: {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-cache",
			connection: "keep-alive",
		},
	});
}

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

		// 1. Analyse de l'historique pour gérer l'état de blocage
		let isLocked = false;
		let justLocked = false;
		let justUnlocked = false;

		for (const msg of messages) {
			if (msg.role === "user") {
				const text = msg.content.toLowerCase();
				const hasBadWord = BAD_WORDS.some((word) =>
					text.includes(word.toLowerCase()),
				);

				if (hasBadWord) {
					// Un mauvais mot a été dit, on bloque le chat
					isLocked = true;
					justLocked = true;
					justUnlocked = false;
				} else if (isLocked && text.trim() === UNLOCK_PASSWORD) {
					// Le bon mot de passe a été entré
					isLocked = false;
					justUnlocked = true;
					justLocked = false;
				} else if (isLocked) {
					// Toujours bloqué et mauvais mot de passe
					justLocked = false;
					justUnlocked = false;
				}
			}
		}

		// 2. Interception de la requête si le chat est bloqué
		if (justLocked) {
			return createFakeStreamResponse(
				"Langage inapproprié détecté. Le chat a été bloqué. Veuillez entrer le mot de passe pour continuer.",
			);
		}
		if (isLocked) {
			return createFakeStreamResponse("Mauvais mot de passe.");
		}
		if (justUnlocked) {
			return createFakeStreamResponse(
				"Mot de passe accepté. Le chat est débloqué. Comment puis-je vous aider ?",
			);
		}

		// 3. Suite normale (si non bloqué) : on envoie à l'IA
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
