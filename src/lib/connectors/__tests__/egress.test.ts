import { createHttp } from "@/lib/connectors/egress";
import { ConnectorError } from "@/lib/connectors/errors";
import {
  type EgressPolicy,
  hostMatches,
  isGraphqlWrite,
  normalizeSite,
} from "@/lib/connectors/policy";

const fixed: EgressPolicy = {
  name: "Acme",
  host: { kind: "fixed", hosts: ["api.acme.com", "*.acme.dev"] },
  allowPost: false,
};

function respond(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function httpWith(
  policy: EgressPolicy,
  answer: (url: string, init: RequestInit) => Response,
  options: { maxRequests?: number; maxBytes?: number } = {}
) {
  const seen: { url: string; init: RequestInit }[] = [];
  const http = createHttp(policy, {
    ...options,
    checkPublic: async (url) => {
      if (url.hostname.endsWith(".internal")) throw new Error("private");
    },
    fetch: (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return answer(url, init);
    }) as unknown as typeof fetch,
  });
  return { http, seen };
}

async function kindOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
    return "ok";
  } catch (error) {
    return error instanceof ConnectorError ? error.kind : "other";
  }
}

describe("hostMatches", () => {
  it("matches exact hosts and anything under a wildcard, not the bare domain", () => {
    expect(hostMatches("api.acme.com", ["api.acme.com"])).toBe(true);
    expect(hostMatches("API.ACME.COM", ["api.acme.com"])).toBe(true);
    expect(hostMatches("x.acme.dev", ["*.acme.dev"])).toBe(true);
    expect(hostMatches("acme.dev", ["*.acme.dev"])).toBe(false);
    expect(hostMatches("evilacme.dev", ["*.acme.dev"])).toBe(false);
    expect(hostMatches("api.acme.com.evil.io", ["api.acme.com"])).toBe(false);
  });
});

describe("normalizeSite", () => {
  it("keeps an https origin and its path, without a trailing slash", () => {
    expect(normalizeSite("https://blog.example.com/news/")).toEqual({
      site: "https://blog.example.com/news",
    });
    expect(normalizeSite("example.atlassian.net")).toEqual({
      site: "https://example.atlassian.net",
    });
  });

  it("refuses plain http, credentials, and hosts outside the list", () => {
    expect(normalizeSite("http://example.com")).toHaveProperty("problem");
    expect(normalizeSite("https://me:pw@example.com")).toHaveProperty(
      "problem"
    );
    expect(
      normalizeSite("https://example.com", ["*.atlassian.net"])
    ).toHaveProperty("problem");
  });
});

describe("isGraphqlWrite", () => {
  it("spots mutations and subscriptions, not queries", () => {
    expect(isGraphqlWrite({ query: "query { viewer { id } }" })).toBe(false);
    expect(isGraphqlWrite({ query: "{ viewer { id } }" })).toBe(false);
    expect(isGraphqlWrite({ query: "mutation { issueDelete(id: 1) }" })).toBe(
      true
    );
    expect(isGraphqlWrite({ query: "  mutation Kill($id: ID!) { x }" })).toBe(
      true
    );
    expect(isGraphqlWrite({ query: "subscription { a }" })).toBe(true);
    expect(
      isGraphqlWrite({ query: "# mutation in a comment\nquery { a }" })
    ).toBe(false);
  });
});

describe("createHttp", () => {
  it("reads JSON from a declared host and sends a plain user agent", async () => {
    const { http, seen } = httpWith(fixed, () => respond(200, { ok: 1 }));
    await expect(
      http.json({
        url: "https://api.acme.com/me",
        query: { a: 1, b: ["x", "y"], c: null },
      })
    ).resolves.toEqual({ ok: 1 });
    expect(seen[0].url).toBe("https://api.acme.com/me?a=1&b=x&b=y");
    expect(
      (seen[0].init.headers as Record<string, string>)["User-Agent"]
    ).toMatch(/^Sigwald/);
    expect(http.count).toBe(1);
  });

  it("refuses hosts the service doesn't name, and plain http to them", async () => {
    const { http, seen } = httpWith(fixed, () => respond(200, {}));
    expect(await kindOf(http.json("https://evil.example.com/"))).toBe(
      "refused"
    );
    expect(await kindOf(http.json("http://api.acme.com/"))).toBe("refused");
    expect(seen).toHaveLength(0);
  });

  it("sends POST only for a service that reads with it, and never a mutation", async () => {
    const reads = httpWith(fixed, () => respond(200, {}));
    expect(
      await kindOf(
        reads.http.json({
          url: "https://api.acme.com/q",
          method: "POST",
          json: {},
        })
      )
    ).toBe("refused");
    const graphql = httpWith({ ...fixed, allowPost: true }, () =>
      respond(200, { data: {} })
    );
    expect(
      await kindOf(
        graphql.http.json({
          url: "https://api.acme.com/graphql",
          method: "POST",
          json: { query: "{ a }" },
        })
      )
    ).toBe("ok");
    expect(
      await kindOf(
        graphql.http.json({
          url: "https://api.acme.com/graphql",
          method: "POST",
          json: { query: "mutation { delete }" },
        })
      )
    ).toBe("refused");
    expect(graphql.seen).toHaveLength(1);
  });

  it("follows a redirect on the same host and refuses one elsewhere", async () => {
    const same = httpWith(fixed, (url) =>
      url.endsWith("/old")
        ? respond(301, "", { location: "https://api.acme.com/new" })
        : respond(200, { moved: true })
    );
    await expect(same.http.json("https://api.acme.com/old")).resolves.toEqual({
      moved: true,
    });

    const away = httpWith(fixed, () =>
      respond(302, "", { location: "https://x.acme.dev/" })
    );
    expect(await kindOf(away.http.json("https://api.acme.com/old"))).toBe(
      "refused"
    );
  });

  it("follows a redirected POST only when it asks for the same request again", async () => {
    const post = { ...fixed, allowPost: true };
    const seeOther = httpWith(post, () =>
      respond(303, "", { location: "https://api.acme.com/result" })
    );
    expect(
      await kindOf(
        seeOther.http.json({
          url: "https://api.acme.com/q",
          method: "POST",
          form: { wstoken: "a-token-in-the-body" },
        })
      )
    ).toBe("bad_response");
    expect(seeOther.seen).toHaveLength(1);

    const again = httpWith(post, (url) =>
      url.endsWith("/q")
        ? respond(307, "", { location: "https://api.acme.com/q2" })
        : respond(200, { ok: true })
    );
    await expect(
      again.http.json({
        url: "https://api.acme.com/q",
        method: "POST",
        json: { query: "{ a }" },
      })
    ).resolves.toEqual({ ok: true });
    expect(again.seen[1].init).toMatchObject({
      method: "POST",
      body: JSON.stringify({ query: "{ a }" }),
    });
  });

  it("calls an answer cut off partway a network failure", async () => {
    const { http } = httpWith(
      fixed,
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"a":'));
              controller.error(new TypeError("terminated"));
            },
          }),
          { status: 200 }
        )
    );
    expect(await kindOf(http.json("https://api.acme.com/x"))).toBe("network");
  });

  it("sends nothing more once the pull's time is up, and says why", async () => {
    const stop = new AbortController();
    const seen: string[] = [];
    const http = createHttp(fixed, {
      signal: stop.signal,
      // A service that never answers: only the signal ends the wait.
      fetch: (async (url: string, init: RequestInit) => {
        seen.push(url);
        return new Promise<Response>((_, reject) => {
          const signal = init.signal!;
          if (signal.aborted) reject(signal.reason);
          signal.addEventListener("abort", () => reject(signal.reason));
        });
      }) as unknown as typeof fetch,
    });
    const late = new ConnectorError("network", "Acme took too long to read");
    const inFlight = http.json("https://api.acme.com/slow");
    await new Promise((resolve) => setTimeout(resolve, 0));
    stop.abort(late);
    await expect(inFlight).rejects.toBe(late);
    await expect(http.json("https://api.acme.com/next")).rejects.toBe(late);
    expect(seen).toEqual(["https://api.acme.com/slow"]);
  });

  it("checks a typed site's host and its DNS answer", async () => {
    const site: EgressPolicy = {
      name: "Ghost",
      host: { kind: "site", field: "site" },
      site: "https://blog.example.com",
      allowPost: false,
    };
    const { http } = httpWith(site, () => respond(200, {}));
    expect(await kindOf(http.json("https://blog.example.com/ghost/api"))).toBe(
      "ok"
    );
    expect(await kindOf(http.json("https://other.example.com/"))).toBe(
      "refused"
    );

    const internal = httpWith({ ...site, site: "https://db.internal" }, () =>
      respond(200, {})
    );
    expect(await kindOf(internal.http.json("https://db.internal/"))).toBe(
      "refused"
    );
  });

  it("lets a public source read plain http, still DNS-checked", async () => {
    const policy: EgressPolicy = {
      name: "Feeds",
      host: { kind: "public" },
      allowPost: false,
    };
    const { http } = httpWith(policy, () =>
      respond(200, "<rss/>", { "content-type": "text/xml" })
    );
    await expect(http.text("http://example.com/feed.xml")).resolves.toBe(
      "<rss/>"
    );
    expect(await kindOf(http.text("http://wiki.internal/feed"))).toBe(
      "refused"
    );
    expect(await kindOf(http.text("file:///etc/passwd"))).toBe("refused");
  });

  it("names each refusal by kind, and never repeats a token back", async () => {
    const statuses: [number, Record<string, string>, string][] = [
      [401, {}, "auth"],
      [403, {}, "forbidden"],
      [403, { "x-ratelimit-remaining": "0" }, "rate_limited"],
      [404, {}, "not_found"],
      [429, { "retry-after": "30" }, "rate_limited"],
      [503, {}, "server"],
      [422, {}, "bad_response"],
    ];
    for (const [status, headers, kind] of statuses) {
      const { http } = httpWith(fixed, () =>
        respond(status, { message: "bad token sk_live_SECRET123" }, headers)
      );
      expect(await kindOf(http.json("https://api.acme.com/"))).toBe(kind);
    }
    const { http } = httpWith(fixed, () =>
      respond(422, { echo: "sk_live_SECRET123" })
    );
    const error = await http
      .json({
        url: "https://api.acme.com/",
        headers: { Authorization: "Bearer sk_live_SECRET123" },
      })
      .catch((e: unknown) => e);
    expect(String((error as Error).message)).not.toContain("sk_live_SECRET123");
  });

  it("stops at its request budget and its size cap", async () => {
    const { http } = httpWith(fixed, () => respond(200, {}), {
      maxRequests: 2,
    });
    await http.json("https://api.acme.com/1");
    await http.json("https://api.acme.com/2");
    expect(await kindOf(http.json("https://api.acme.com/3"))).toBe("refused");

    const big = httpWith(fixed, () => respond(200, "x".repeat(2048)), {
      maxBytes: 1024,
    });
    expect(await kindOf(big.http.text("https://api.acme.com/big"))).toBe(
      "refused"
    );
  });

  it("refuses everything when the install turns connectors off", async () => {
    const before = process.env.SIGWALD_CONNECTORS;
    process.env.SIGWALD_CONNECTORS = "off";
    try {
      const { http, seen } = httpWith(fixed, () => respond(200, {}));
      expect(await kindOf(http.json("https://api.acme.com/"))).toBe("refused");
      expect(seen).toHaveLength(0);
    } finally {
      if (before === undefined) delete process.env.SIGWALD_CONNECTORS;
      else process.env.SIGWALD_CONNECTORS = before;
    }
  });
});
