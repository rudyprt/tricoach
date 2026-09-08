import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { rateLimit } from "../lib/rateLimit.js";

function fakeRes() {
  const res = {
    statusCode: 0,
    body: null as unknown,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & typeof res;
}

const req = (ip: string) => ({ ip }) as Request;

describe("rateLimit", () => {
  it("laisse passer jusqu'à la limite puis répond 429", () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 3, message: "trop" });
    const next = vi.fn();

    for (let i = 0; i < 3; i++) limiter(req("1.1.1.1"), fakeRes(), next);
    expect(next).toHaveBeenCalledTimes(3);

    const res = fakeRes();
    limiter(req("1.1.1.1"), res, next);
    expect(next).toHaveBeenCalledTimes(3);
    expect(res.statusCode).toBe(429);
    expect(res.headers["Retry-After"]).toBeDefined();
  });

  it("compte séparément chaque adresse", () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 1, message: "trop" });
    const next = vi.fn();
    limiter(req("1.1.1.1"), fakeRes(), next);
    limiter(req("2.2.2.2"), fakeRes(), next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("réautorise après la fenêtre", () => {
    vi.useFakeTimers();
    try {
      const limiter = rateLimit({ windowMs: 1000, max: 1, message: "trop" });
      const next = vi.fn();
      limiter(req("1.1.1.1"), fakeRes(), next);
      limiter(req("1.1.1.1"), fakeRes(), next);
      expect(next).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1001);
      limiter(req("1.1.1.1"), fakeRes(), next);
      expect(next).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("peut limiter par utilisateur plutôt que par IP", () => {
    const limiter = rateLimit({
      windowMs: 60_000,
      max: 1,
      message: "trop",
      keyFor: (r) => (r as Request & { userId?: string }).userId ?? "anon",
    });
    const next = vi.fn();
    const withUser = (id: string) => ({ ip: "1.1.1.1", userId: id }) as unknown as Request;
    limiter(withUser("a"), fakeRes(), next);
    limiter(withUser("b"), fakeRes(), next);
    expect(next).toHaveBeenCalledTimes(2);
    limiter(withUser("a"), fakeRes(), next);
    expect(next).toHaveBeenCalledTimes(2);
  });
});
