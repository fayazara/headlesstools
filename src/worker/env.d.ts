import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

declare global {
	interface Env {
		OAUTH_PROVIDER: OAuthHelpers;
	}
}

export {};
