/**
 * The rules every module in the marketplace keeps, and every connector
 * module on top: a shelf and an audience, its own task source, beta and off
 * until someone turns it on, egress that names its service, a connection
 * check for any account it needs, and no way out but the egress.
 */
import fs from "node:fs";
import path from "node:path";

import { needsAccount } from "@/lib/connectors/types";
import { VERIFIERS } from "@/lib/connectors/verifiers";

import { MODULES } from "@/modules";
import { servicesInUse } from "@/modules/connect/views";
import { SERVER_MODULES } from "@/modules/server";
import { SHELVES } from "@/modules/shelves";

const ROOT = path.resolve(__dirname, "../../../..");
const CONNECTORS = MODULES.filter((m) => m.connect);

describe("the marketplace", () => {
  it("puts every module on a known shelf, made for someone", () => {
    const shelves = new Set(SHELVES.map((s) => s.id));
    for (const m of MODULES) {
      expect(shelves.has(m.shelf)).toBe(true);
      expect(m.madeFor.length).toBeGreaterThan(0);
      expect(m.summary.length).toBeLessThanOrEqual(200);
    }
  });

  it("gives every task source exactly one owner", () => {
    const sources = MODULES.flatMap((m) => m.sources);
    expect(new Set(sources).size).toBe(sources.length);
  });
});

describe("connector modules", () => {
  it.each(CONNECTORS.map((m) => [m.id, m] as const))(
    "%s keeps the rules",
    (_id, m) => {
      const spec = m.connect!;
      expect(m.beta).toBe(true);
      expect(m.defaultOn).toBe(false);
      if (spec.makes.includes("tasks")) {
        expect(m.sources.length).toBeGreaterThan(0);
        expect(m.linkLabels?.[m.sources[0]]).toBeTruthy();
      }
      if (spec.service) {
        expect(m.egress).toContainEqual(spec.service.egress);
      }
      const keys = spec.settings.map((s) => s.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(SERVER_MODULES[m.id].connector).toBeDefined();
    }
  );

  it("checks every account before keeping it", () => {
    for (const service of servicesInUse()) {
      if (needsAccount(service)) expect(VERIFIERS[service.id]).toBeDefined();
    }
  });

  it("uses one manifest per service", () => {
    const byId = new Map<string, unknown>();
    for (const m of CONNECTORS) {
      const service = m.connect!.service;
      if (!service) continue;
      if (byId.has(service.id)) expect(byId.get(service.id)).toBe(service);
      byId.set(service.id, service);
    }
  });

  it("keeps secrets out of plain config, and a public source holds none", () => {
    for (const service of servicesInUse()) {
      if (service.host.kind === "public") {
        expect(service.fields.some((f) => f.kind === "secret")).toBe(false);
      }
      if (service.host.kind === "site") {
        const field = service.fields.find(
          (f) => f.key === (service.host as { field: string }).field
        );
        expect(field?.kind).toBe("url");
      }
      if (service.host.kind === "fixed") {
        for (const host of service.host.hosts)
          expect(host).toMatch(/^(\*\.)?[a-z0-9.-]+\.[a-z]{2,}$/);
      }
    }
  });

  it("names every service and fixed host in DATAFLOW.md", () => {
    const dataflow = fs.readFileSync(path.join(ROOT, "DATAFLOW.md"), "utf8");
    for (const service of servicesInUse()) {
      expect(dataflow).toContain(service.name);
      if (service.host.kind === "fixed") {
        for (const host of service.host.hosts) expect(dataflow).toContain(host);
      }
    }
  });
});

describe("the egress", () => {
  function files(dir: string): string[] {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) return [];
    return fs.readdirSync(full, { withFileTypes: true }).flatMap((e) => {
      const rel = path.posix.join(dir, e.name);
      if (e.isDirectory())
        return e.name === "__tests__" || e.name === "components"
          ? []
          : files(rel);
      return /\.ts$/.test(e.name) ? [rel] : [];
    });
  }

  it("is the only thing under src/lib/connectors or a connector module that calls fetch", () => {
    const scanned = [
      ...files("src/lib/connectors"),
      ...files("src/modules/connect"),
      ...CONNECTORS.flatMap((m) => files(`src/modules/${m.id}`)),
    ].filter((f) => f !== "src/lib/connectors/egress.ts");
    expect(scanned.length).toBeGreaterThan(0);
    // A way out of its own: fetch, XHR, or Node's http, https, net, tls or
    // undici. (The egress's own `Http`, called as `http.request(…)`, is the
    // way in, so the name alone proves nothing: the import does.)
    const offenders = scanned.filter((f) =>
      /\bfetch\s*\(|\bXMLHttpRequest\b|(from|require\()\s*["'](node:)?(https?|net|tls|http2|undici)["']/.test(
        fs.readFileSync(path.join(ROOT, f), "utf8")
      )
    );
    expect(offenders).toEqual([]);
  });
});
