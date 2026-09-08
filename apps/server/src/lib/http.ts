import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Express 4 n'attrape pas les rejets des handlers `async` : sans ce wrapper, une
 * erreur Prisma ou réseau part en `unhandledRejection` au lieu de produire une
 * réponse HTTP. Toutes les routes asynchrones passent par ici.
 */
export function ah<T extends Request>(
  handler: (req: T, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req as unknown as T, res, next)).catch(next);
  };
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function notFoundHandler(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api/")) {
    next();
    return;
  }
  res.status(404).json({ error: "Ressource introuvable." });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
    return;
  }

  console.error("Erreur non gérée :", err);
  res.status(500).json({ error: "Une erreur interne est survenue. Réessayez." });
}
