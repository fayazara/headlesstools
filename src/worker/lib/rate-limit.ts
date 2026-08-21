export async function checkRateLimit(limiter: RateLimit, key: string): Promise<boolean> {
	const { success } = await limiter.limit({ key });
	return success;
}

export function clientIp(request: Request): string {
	return request.headers.get("CF-Connecting-IP") ?? "unknown";
}
