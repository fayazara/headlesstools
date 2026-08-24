declare namespace Cloudflare {
	interface Env extends globalThis.Env {
		TEST_MIGRATIONS: D1Migration[];
	}
}
