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

  /** Écriture : sert à produire les séances structurées pour les montres. */
  export class Encoder {
    constructor(options?: { fieldDescriptions?: Record<number, unknown> });
    onMesg(mesgNum: number, mesg: Record<string, unknown>): void;
    writeMesg(mesg: Record<string, unknown>): void;
    close(): Uint8Array;
  }

  export const Profile: {
    MesgNum: Record<string, number>;
    types: Record<string, Record<number, string>>;
  };
}
