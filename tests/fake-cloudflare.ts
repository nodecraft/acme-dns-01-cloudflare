// In-memory stand-in for the parts of the Cloudflare v4 API this package uses, served through `fetch` so the real SDK runs end-to-end.

export interface FakeZone {
	id: string;
	name: string;
}

export interface FakeRecord {
	id: string;
	zone_id: string;
	type: string;
	name: string;
	content: string;
	ttl?: number;
}

export interface RecordedRequest {
	method: string;
	url: URL;
	headers: Headers;
	body: Record<string, unknown> | undefined;
}

interface Failure {
	method: string;
	pathPattern: RegExp;
	status: number;
	errors: { code: number; message: string; }[];
}

interface Seed {
	zones?: Omit<FakeZone, 'id'>[];
	records?: FakeRecord[];
}

function json(status: number, body: unknown): Response {
	return Response.json(body, {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

function paginate(items: unknown[], searchParams: URLSearchParams): Response {
	const perPage = Number(searchParams.get('per_page') || 20);
	const page = Number(searchParams.get('page') || 1);
	const result = items.slice((page - 1) * perPage, page * perPage);
	return json(200, {
		success: true,
		errors: [],
		messages: [],
		result,
		result_info: {
			page,
			per_page: perPage,
			count: result.length,
			total_count: items.length,
			total_pages: Math.ceil(items.length / perPage),
		},
	});
}

export function createFakeCloudflare({ zones = [], records = [] }: Seed = {}) {
	const state = {
		zones: zones.map((zone, index): FakeZone => {
			return { id: `zone-${index + 1}`, ...zone };
		}),
		records: [...records],
		requests: [] as RecordedRequest[],
		nextId: 1,
		failures: [] as Failure[],
	};

	function failNext(method: string, pathPattern: RegExp, status: number, errors: Failure['errors']): void {
		state.failures.push({ method, pathPattern, status, errors });
	}

	async function fetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
		const url = new URL(input instanceof Request ? input.url : input);
		const method = init.method || 'GET';
		const headers = new Headers(init.headers);
		const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
		state.requests.push({ method, url, headers, body });

		const failureIndex = state.failures.findIndex(failure => failure.method === method && failure.pathPattern.test(url.pathname));
		if (failureIndex !== -1) {
			const [failure] = state.failures.splice(failureIndex, 1);
			return json(failure.status, {
				success: false,
				errors: failure.errors,
				messages: [],
				result: null,
			});
		}

		const path = url.pathname.replace(/^\/client\/v4/, '');
		if (method === 'GET' && path === '/zones') {
			return paginate(state.zones, url.searchParams);
		}

		const recordsMatch = path.match(/^\/zones\/([^/]+)\/dns_records(?:\/([^/]+))?$/);
		if (recordsMatch) {
			const [, zoneId, recordId] = recordsMatch;
			if (method === 'GET' && !recordId) {
				const type = url.searchParams.get('type');
				const name = url.searchParams.get('name.exact');
				const matches = state.records.filter((record) => {
					if (record.zone_id !== zoneId) {
						return false;
					}
					if (type && record.type !== type) {
						return false;
					}
					// mirrors the real API, whose name filters ignore case
					if (name && record.name.toLowerCase() !== name.toLowerCase()) {
						return false;
					}
					return true;
				});
				return paginate(matches, url.searchParams);
			}
			if (method === 'POST' && !recordId) {
				const record = { id: `record-${state.nextId++}`, zone_id: zoneId, ...body } as FakeRecord;
				state.records.push(record);
				return json(200, { success: true, errors: [], messages: [], result: record });
			}
			if (method === 'DELETE' && recordId) {
				state.records = state.records.filter(record => record.id !== recordId);
				return json(200, { success: true, errors: [], messages: [], result: { id: recordId } });
			}
		}

		return json(404, {
			success: false,
			errors: [{ code: 7003, message: `No route for ${method} ${path}` }],
			messages: [],
			result: null,
		});
	}

	return { state, fetch, failNext };
}

export type FakeCloudflare = ReturnType<typeof createFakeCloudflare>;
