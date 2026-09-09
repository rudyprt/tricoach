/**
 * Les déclarations livrées par @garmin/fitsdk réexportent leurs types avec des
 * chemins sans extension, que la résolution NodeNext ne suit pas. On décrit
 * donc localement la portion du SDK réellement utilisée, plutôt que de tout
 * traiter en `any`.
 */
declare module "@garmin/fitsdk" {
  export class Stream {
    static fromBuffer(buffer: Buffer): Stream;
    static fromByteArray(data: number[] | Uint8Array): Stream;
  }

  export interface FitMessages {
    sessionMesgs?: Record<string, unknown>[];
    recordMesgs?: Record<string, unknown>[];
    activityMesgs?: Record<string, unknown>[];
    [key: string]: Record<string, unknown>[] | undefined;
  }

  export class Decoder {
    constructor(stream: Stream);
    isFIT(): boolean;
    checkIntegrity(): boolean;
    read(): { messages: FitMessages; errors: unknown[] };
  }
}
